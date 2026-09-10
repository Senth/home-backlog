import type { Request, Response, Router } from "express";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { apiLabel, etagForLabel } from "./api-nodes.js";
import { caller, homeAccess, recordWrite } from "./auth.js";
import { parseLabelBody } from "./body.js";
import { ApiError } from "./errors.js";
import { db, homesCollection } from "./firestore.js";
import { handle, param } from "./handler.js";
import {
	type Label,
	maxLabelsPerHome,
	normalizedTitle,
	readLabels,
} from "./label.js";
import { rankAfter } from "./node.js";
import { validateLabel } from "./validate.js";
import { checkEtag } from "./writes.js";

/**
 * The label verbs (#256): list, read, create, edit and delete the home's label
 * definitions — the map on the home document, not a subcollection.
 *
 * Modeled on the location verbs, with the two differences the map shape
 * forces. A write is a field-path update to the home document, so there is no
 * `updatedAt` to build an ETag from — `etagForLabel` hashes the entry's own
 * fields instead. And nothing about a label is per-document: once `homeAccess`
 * has passed there is nothing else to check, exactly as for a location.
 *
 * These write with the Admin SDK, so `firestore.rules` enforces nothing here;
 * every entry goes through `validateLabel` before it is committed. The two
 * checks that read other labels — the 300 cap and the duplicate title — sit
 * inside the same `db.runTransaction` that writes, because a read-then-write
 * done outside one could be raced past by two callers at once.
 */

function homeRef(homeId: string) {
	return db.collection(homesCollection).doc(homeId);
}

function notFound(labelId: string, homeId: string): ApiError {
	return new ApiError(
		404,
		"label_not_found",
		`No label ${labelId} in ${homeId}.`,
	);
}

function refuseInvalidLabel(data: Partial<Record<keyof Label, unknown>>): void {
	const issues = validateLabel(data);
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

function refuseDuplicate(title: string): void {
	throw new ApiError(
		409,
		"duplicate_label",
		`A label named "${title.trim()}" already exists in this home.`,
	);
}

async function listLabels(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	await homeAccess(me, homeId);

	const snapshot = await homeRef(homeId).get();

	response.json({
		labels: readLabels(snapshot.data()).map((label) =>
			apiLabel(label.id, { ...label }),
		),
	});
}

async function getLabel(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	await homeAccess(me, homeId);

	const labelId = param(request, "labelId");
	const snapshot = await homeRef(homeId).get();
	const label = readLabels(snapshot.data()).find(
		(entry) => entry.id === labelId,
	);
	if (!label) throw notFound(labelId, homeId);

	response.setHeader("ETag", etagForLabel(label));
	response.json(apiLabel(label.id, { ...label }));
}

async function createLabel(
	request: Request,
	response: Response,
): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const body = parseLabelBody(request.body, "create");

	const created = await db.runTransaction(async (tx) => {
		const snapshot = await tx.get(homeRef(homeId));
		const existing = readLabels(snapshot.data());

		if (existing.length >= maxLabelsPerHome) {
			throw new ApiError(
				409,
				"label_limit_reached",
				`This home already carries ${maxLabelsPerHome} labels, the most one home holds. Delete one first.`,
			);
		}
		if (body.title !== undefined) {
			const key = normalizedTitle(body.title);
			if (existing.some((label) => normalizedTitle(label.title) === key)) {
				refuseDuplicate(body.title);
			}
		}
		const id = db.collection(homesCollection).doc().id;
		const entry = {
			title: (body.title ?? "").trim(),
			icon: body.icon ?? "",
			color: body.color ?? "",
			// Appended at the end of the set, exactly as a location is appended
			// to its siblings, unless the caller placed it.
			rank: body.rank ?? rankAfter(existing.map((label) => label.rank)),
		};

		refuseInvalidLabel(entry);

		tx.update(homeRef(homeId), new FieldPath("labels", id), entry);
		return { id, entry };
	});

	await recordWrite(me, home);

	response.setHeader("ETag", etagForLabel(created.entry));
	response.status(201).json(apiLabel(created.id, { ...created.entry }));
}

async function patchLabel(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const labelId = param(request, "labelId");
	const body = parseLabelBody(request.body, "update");

	const updated = await db.runTransaction(async (tx) => {
		const snapshot = await tx.get(homeRef(homeId));
		const existing = readLabels(snapshot.data());
		const current = existing.find((entry) => entry.id === labelId);
		if (!current) throw notFound(labelId, homeId);

		checkEtag(request, etagForLabel(current));

		const changes: Partial<Record<keyof Label, string>> = {};
		if (body.title !== undefined) changes.title = body.title.trim();
		if (body.icon !== undefined) changes.icon = body.icon;
		if (body.color !== undefined) changes.color = body.color;

		// The entry exactly as it will be written, so validation costs the
		// same on a patch as on a create and no partial patch can slip past.
		const merged = {
			title: changes.title ?? current.title,
			icon: changes.icon ?? current.icon,
			color: changes.color ?? current.color,
			rank: current.rank,
		};

		// A rename never collides with itself, so the check skips the entry
		// being renamed.
		if (
			merged.title !== current.title &&
			existing.some(
				(label) =>
					label.id !== labelId &&
					normalizedTitle(label.title) === normalizedTitle(merged.title),
			)
		) {
			refuseDuplicate(merged.title);
		}

		refuseInvalidLabel(merged);

		// Each sent field as its own FieldPath, so an edit to one label never
		// rewrites the whole map under another writer's feet.
		for (const [field, value] of Object.entries(changes)) {
			tx.update(
				homeRef(homeId),
				new FieldPath("labels", labelId, field),
				value,
			);
		}
		return merged;
	});

	await recordWrite(me, home);

	response.setHeader("ETag", etagForLabel(updated));
	response.status(200).json(apiLabel(labelId, { ...updated }));
}

async function deleteLabel(
	request: Request,
	response: Response,
): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const labelId = param(request, "labelId");

	await db.runTransaction(async (tx) => {
		const snapshot = await tx.get(homeRef(homeId));
		const current = readLabels(snapshot.data()).find(
			(entry) => entry.id === labelId,
		);
		if (!current) throw notFound(labelId, homeId);

		checkEtag(request, etagForLabel(current));

		// The definition only, deliberately: cards keep the id, the same
		// designed-for dangling state the app's own deleteLabel leaves.
		tx.update(
			homeRef(homeId),
			new FieldPath("labels", labelId),
			FieldValue.delete(),
		);
	});

	await recordWrite(me, home);

	response.json({ id: labelId, deleted: 1 });
}

export function registerLabelRoutes(v1: Router): void {
	v1.get("/homes/:homeId/labels", handle(listLabels));
	v1.post("/homes/:homeId/labels", handle(createLabel));
	v1.get("/homes/:homeId/labels/:labelId", handle(getLabel));
	v1.patch("/homes/:homeId/labels/:labelId", handle(patchLabel));
	v1.delete("/homes/:homeId/labels/:labelId", handle(deleteLabel));
}
