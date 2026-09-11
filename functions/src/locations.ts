import type { Request, Response, Router } from "express";
import type {
	DocumentData,
	DocumentSnapshot,
	QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { apiLocation, etagFor } from "./api-nodes.js";
import { type ApiCaller, caller, homeAccess, recordWrite } from "./auth.js";
import { parseLocationBody } from "./body.js";
import { ApiError } from "./errors.js";
import {
	db,
	homesCollection,
	locationsCollection,
	runsCollection,
} from "./firestore.js";
import { handle, param } from "./handler.js";
import {
	idempotencyKeyOf,
	recordRun,
	replayOf,
	replayResponse,
} from "./idempotency.js";
import { parseBulkLocationsBody, planBulkLocations } from "./locations-bulk.js";
import { childAncestorIds, movedAncestorIds, rankAfter } from "./node.js";
import { type LocationContext, validateLocation } from "./validate.js";
import { checkPrecondition, refuseOversizedSubtree } from "./writes.js";

/**
 * The location verbs (#50): list, create, rename-and-move, delete a place, and
 * write a whole place tree at once.
 *
 * The node verbs, mirrored one endpoint set over, with two things absent on
 * purpose. No visibility split — a location is household furniture,
 * member-only and uniform, so once `homeAccess` has passed there is nothing
 * per-document to check. No counters — a location carries no `childCount`, so
 * a create is one `set` and a delete repairs nothing.
 *
 * These write with the Admin SDK, so `firestore.rules` enforces nothing here;
 * every document goes through `validateLocation` before it is committed. A
 * move rewrites the moved document's path and every descendant's
 * `ancestorIds` in one batch, and a cascading delete removes the subtree in
 * one batch — the `onLocationWritten` trigger unfilms anchored nodes on both
 * paths, the same contract the app's own writes get.
 */

function homeLocations(homeId: string) {
	return db
		.collection(homesCollection)
		.doc(homeId)
		.collection(locationsCollection);
}

function notFound(locationId: string, homeId: string): ApiError {
	return new ApiError(
		404,
		"location_not_found",
		`No location ${locationId} in ${homeId}.`,
	);
}

async function readLocation(
	homeId: string,
	locationId: string,
): Promise<DocumentSnapshot<DocumentData>> {
	const snapshot = await homeLocations(homeId).doc(locationId).get();
	if (!snapshot.exists) throw notFound(locationId, homeId);
	return snapshot;
}

/** What a prospective child needs to know about its parent location. */
interface ParentLocationFacts {
	id: string;
	ancestorIds: string[];
}

function factsOf(
	snapshot: DocumentSnapshot<DocumentData>,
): ParentLocationFacts {
	const ancestorIds = snapshot.get("ancestorIds");
	return {
		id: snapshot.id,
		ancestorIds: Array.isArray(ancestorIds) ? (ancestorIds as string[]) : [],
	};
}

/** The parent a request names, resolved, or `null` for a root place. */
async function resolveParent(
	homeId: string,
	parentId: string | null,
): Promise<ParentLocationFacts | null> {
	if (parentId === null) return null;
	return factsOf(await readLocation(homeId, parentId));
}

/** Every descendant of a location, at any depth. */
async function descendantsOf(
	homeId: string,
	locationId: string,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
	const subtree = await homeLocations(homeId)
		.where("ancestorIds", "array-contains", locationId)
		.get();
	return subtree.docs;
}

/**
 * The rank of a place appended to a parent's children, or to the root.
 *
 * Read whole and filtered in code rather than `where("parentId").orderBy("rank")`,
 * which would want a composite index the app's one-listener tree query never
 * needs. Locations count in tens per home, so the extra reads are nothing.
 */
async function rankAtEndOfSiblings(
	homeId: string,
	parentId: string | null,
): Promise<string> {
	const locations = await homeLocations(homeId).orderBy("rank").get();
	const siblings = locations.docs.filter(
		(doc) => (doc.get("parentId") ?? null) === parentId,
	);
	return rankAfter(siblings.map((doc) => String(doc.get("rank") ?? "")));
}

/** Turn validation issues into the one 400 that names all of them at once. */
function refuseInvalidLocation(
	data: Record<string, unknown>,
	context: LocationContext,
): void {
	const issues = validateLocation(data, context);
	if (issues.length === 0) return;

	throw new ApiError(
		400,
		issues[0].code,
		issues[0].message,
		issues.map((issue) => ({
			field: issue.field,
			code: issue.code,
			message: issue.message,
		})),
	);
}

/** Read the committed document back, so a response never carries a sentinel. */
async function respondWithLocation(
	response: Response,
	homeId: string,
	locationId: string,
	status: number,
): Promise<void> {
	const written = await homeLocations(homeId).doc(locationId).get();
	response.setHeader("ETag", etagFor(written.get("updatedAt")));
	response.status(status).json(apiLocation(written.id, written.data() ?? {}));
}

async function listLocations(
	request: Request,
	response: Response,
): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	await homeAccess(me, homeId);

	const locations = await homeLocations(homeId).orderBy("rank").get();

	response.json({
		locations: locations.docs.map((doc) => apiLocation(doc.id, doc.data())),
	});
}

async function createLocation(
	request: Request,
	response: Response,
): Promise<void> {
	const me: ApiCaller = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const body = parseLocationBody(request.body, "create");
	const parent = await resolveParent(homeId, body.parentId ?? null);

	const ref = homeLocations(homeId).doc();
	const document: Record<string, unknown> = {
		title: (body.title ?? "").trim(),
		parentId: parent?.id ?? null,
		// Derived from parentId, never taken from the body — a caller-supplied
		// path is exactly what cannot be verified from outside.
		ancestorIds: childAncestorIds(parent),
		rank: body.rank ?? (await rankAtEndOfSiblings(homeId, parent?.id ?? null)),
		createdAt: FieldValue.serverTimestamp(),
		createdBy: me.uid,
		updatedAt: FieldValue.serverTimestamp(),
	};

	refuseInvalidLocation(document, { locationId: ref.id, parent });

	await ref.set(document);
	await recordWrite(me, home);

	await respondWithLocation(response, homeId, ref.id, 201);
}

async function patchLocation(
	request: Request,
	response: Response,
): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const locationId = param(request, "locationId");
	const snapshot = await readLocation(homeId, locationId);
	checkPrecondition(request, snapshot);
	const current = snapshot.data() ?? {};
	const body = parseLocationBody(request.body, "update");

	const oldParentId = (current.parentId ?? null) as string | null;
	const moving = "parentId" in body && (body.parentId ?? null) !== oldParentId;
	const newParentId = moving ? (body.parentId ?? null) : oldParentId;
	const parent = await resolveParent(homeId, newParentId);

	if (
		moving &&
		parent !== null &&
		(parent.id === locationId || parent.ancestorIds.includes(locationId))
	) {
		// A location moved inside its own subtree is a cycle: unreachable from
		// the tree screen and from every anchored node's path.
		throw new ApiError(
			400,
			"cycle",
			"A location cannot be moved inside its own subtree.",
		);
	}

	const descendants = moving ? await descendantsOf(homeId, locationId) : [];
	if (moving) refuseOversizedSubtree(descendants.length, "This move");

	const changes: Record<string, unknown> = {
		...(body.title !== undefined ? { title: body.title.trim() } : {}),
		...(moving
			? {
					parentId: newParentId,
					ancestorIds: childAncestorIds(parent),
					rank: await rankAtEndOfSiblings(homeId, newParentId),
				}
			: {}),
		updatedAt: FieldValue.serverTimestamp(),
	};

	refuseInvalidLocation({ ...current, ...changes }, { locationId, parent });

	const batch = db.batch();
	batch.update(homeLocations(homeId).doc(locationId), changes);
	for (const descendant of descendants) {
		batch.update(descendant.ref, {
			ancestorIds: movedAncestorIds(
				(descendant.get("ancestorIds") ?? []) as string[],
				locationId,
				childAncestorIds(parent),
			),
			updatedAt: FieldValue.serverTimestamp(),
		});
	}
	await batch.commit();
	await recordWrite(me, home);

	await respondWithLocation(response, homeId, locationId, 200);
}

async function deleteLocation(
	request: Request,
	response: Response,
): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const locationId = param(request, "locationId");
	const snapshot = await readLocation(homeId, locationId);
	checkPrecondition(request, snapshot);

	const descendants = await descendantsOf(homeId, locationId);
	const cascade = request.query.cascade === "true";

	// The API's confirmation dialog, the same one the node delete gives: the
	// destructive act has to be spelled out rather than stumbled into.
	if (descendants.length > 0 && !cascade) {
		const children = descendants.filter(
			(doc) => doc.get("parentId") === locationId,
		).length;
		throw new ApiError(
			409,
			"has_children",
			`This location has ${children} place${children === 1 ? "" : "s"} and ${descendants.length} document${descendants.length === 1 ? "" : "s"} below it. Repeat with ?cascade=true to delete them all.`,
		);
	}

	refuseOversizedSubtree(descendants.length, "This delete");

	const batch = db.batch();
	for (const descendant of descendants) batch.delete(descendant.ref);
	batch.delete(homeLocations(homeId).doc(locationId));
	await batch.commit();
	await recordWrite(me, home);

	response.json({ id: locationId, deleted: descendants.length + 1 });
}

/**
 * `POST /v1/homes/{homeId}/locations:bulk` — one run, one new place tree, one
 * commit. The node bulk create's shape (`bulk-route.ts`), carried over: the
 * payload is planned whole by `locations-bulk.ts` with no I/O; this handler is
 * the three reads it needs, the batch, and the replay record.
 */
async function bulkCreateLocations(
	request: Request,
	response: Response,
): Promise<void> {
	const me: ApiCaller = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const idempotencyKey = idempotencyKeyOf(request);
	const runRef =
		idempotencyKey === null
			? null
			: me.keyRef.collection(runsCollection).doc(idempotencyKey);

	// The replay, checked before any work — a repeated key answers with the
	// first run's ids even when this payload would not parse.
	if (runRef !== null) {
		const previous = await replayOf(runRef);
		if (previous !== null) {
			replayResponse(response, previous);
			return;
		}
	}

	const payload = parseBulkLocationsBody(request.body);
	const parent =
		payload.parentId === null
			? null
			: factsOf(await readLocation(homeId, payload.parentId));

	// The root's rank, read whole and filtered in code — the same query
	// `rankAtEndOfSiblings` makes, made once for the whole payload rather than
	// once per place. Every place below the root lands under a place this
	// payload is creating, so its siblings need no read at all.
	const existing = await homeLocations(homeId).orderBy("rank").get();
	const rootRank = rankAfter(
		existing.docs
			.filter((doc) => (doc.get("parentId") ?? null) === payload.parentId)
			.map((doc) => String(doc.get("rank") ?? "")),
	);

	const plan = planBulkLocations({
		payload,
		idFor: Object.fromEntries(
			payload.locations.map((location) => [
				location.ref,
				homeLocations(homeId).doc().id,
			]),
		),
		parent,
		rootRank,
		createdBy: me.uid,
		now: FieldValue.serverTimestamp(),
	});

	const batch = db.batch();
	for (const item of plan.items) {
		batch.set(homeLocations(homeId).doc(item.id), item.data);
	}
	if (runRef !== null) {
		// In the same batch as the tree, deliberately — `recordRun` says why.
		recordRun(batch, runRef, plan);
	}

	await batch.commit();
	await recordWrite(me, home);

	response.status(201).json({ rootId: plan.rootId, ids: plan.ids });
}

export function registerLocationRoutes(v1: Router): void {
	v1.get("/homes/:homeId/locations", handle(listLocations));
	v1.post("/homes/:homeId/locations", handle(createLocation));
	// `:bulk` rather than `/bulk`, so the path can never collide with a location id.
	v1.post("/homes/:homeId/locations\\:bulk", handle(bulkCreateLocations));
	v1.patch("/homes/:homeId/locations/:locationId", handle(patchLocation));
	v1.delete("/homes/:homeId/locations/:locationId", handle(deleteLocation));
}
