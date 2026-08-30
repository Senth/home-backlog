import type { Request, Response, Router } from "express";
import type {
	DocumentData,
	QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { apiHome, apiNode, etagFor, visibleTo } from "./api-nodes.js";
import { type ApiCaller, caller, homeAccess } from "./auth.js";
import { ApiError } from "./errors.js";
import { db, homesCollection, nodesCollection } from "./firestore.js";
import { handle, param } from "./handler.js";

/**
 * The node and home verbs.
 *
 * Every query here mirrors one the app runs, so that an agent sees the same
 * boards a person does. The app's queries are shaped by *query safety* —
 * Firestore rejects a whole query if any matching document could be denied — and
 * this one is not, because the Admin SDK is subject to no rules. That difference
 * is the hazard: the board's two-query merge is replaced here by one query and a
 * predicate applied in code, and forgetting the predicate leaks another member's
 * private project.
 */

function homeNodes(homeId: string) {
	return db.collection(homesCollection).doc(homeId).collection(nodesCollection);
}

/**
 * The board a request is asking for.
 *
 * Absent means the **root board**, which is where an agent starts and which has
 * no document of its own — the same `parentId == null` the app's board load
 * uses. An explicit empty string means the same thing, because that is what a
 * `?parentId=` with nothing after it produces and refusing it would be a trap
 * rather than a safeguard.
 */
function parentIdOf(request: Request): string | null {
	const value = request.query.parentId;
	if (typeof value !== "string" || value.length === 0) return null;
	return value;
}

/**
 * One node, by id, with the visibility predicate applied — and the *same* answer
 * for "not there" and "not yours".
 *
 * Deliberately identical, exactly as `getNode` in `data/nodes.ts` is:
 * distinguishing them would let a caller enumerate the private cards of everyone
 * else in the home, one guessed id at a time.
 */
async function readNode(
	homeId: string,
	nodeId: string,
	uid: string,
): Promise<QueryDocumentSnapshot<DocumentData>> {
	const snapshot = await homeNodes(homeId).doc(nodeId).get();
	if (!snapshot.exists || !visibleTo(snapshot.data() ?? {}, uid)) {
		throw new ApiError(
			404,
			"node_not_found",
			`No node ${nodeId} in ${homeId}.`,
		);
	}
	return snapshot as QueryDocumentSnapshot<DocumentData>;
}

async function listHomes(_request: Request, response: Response): Promise<void> {
	const me: ApiCaller = caller(response);

	// Exactly `homesQuery` in `data/homes.ts`. A key is its owner, so this is the
	// whole of what it reaches — and it gains a home the moment they join one,
	// with nothing to reconfigure.
	const homes = await db
		.collection(homesCollection)
		.where(`members.${me.uid}`, "in", ["owner", "member"])
		.get();

	response.json({
		homes: homes.docs.map((home) => apiHome(home.id, home.data(), me.uid)),
	});
}

async function listNodes(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	await homeAccess(me, homeId);

	const parentId = parentIdOf(request);

	// The app has to split this into two queries and merge them client-side,
	// because a single query mentioning both disjuncts of the read rule is not
	// query-safe. Here it is one query and a filter — same result, and the filter
	// is the part that must never be dropped.
	const nodes = await homeNodes(homeId)
		.where("archived", "==", false)
		.where("parentId", "==", parentId)
		.orderBy("rank")
		.get();

	response.json({
		nodes: nodes.docs
			.filter((node) => visibleTo(node.data(), me.uid))
			.map((node) => apiNode(node.id, node.data())),
	});
}

async function getNode(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	await homeAccess(me, homeId);

	const snapshot = await readNode(homeId, param(request, "nodeId"), me.uid);

	// The value a later `PATCH` or `DELETE` sends back as `If-Match`. Without it
	// on the read, the API's only concurrency control would be reachable only
	// after a write, which is the wrong way round.
	response.setHeader("ETag", etagFor(snapshot.get("updatedAt")));
	response.json(apiNode(snapshot.id, snapshot.data()));
}

export function registerRoutes(v1: Router): void {
	v1.get("/homes", handle(listHomes));
	v1.get("/homes/:homeId/nodes", handle(listNodes));
	v1.get("/homes/:homeId/nodes/:nodeId", handle(getNode));
}
