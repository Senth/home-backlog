import {
	collection,
	type DocumentData,
	doc,
	getDocsFromServer,
	orderBy,
	type Query,
	type QueryDocumentSnapshot,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
	where,
	writeBatch,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import {
	childAncestorIds,
	completionChange,
	movedAncestorIds,
	type NewNodeInput,
	type Node,
	type NodeData,
	newNodeData,
	type Status,
	toNode,
} from "@/models/node";

/**
 * Every Firestore read and write that touches a node.
 *
 * Thin on purpose: what is valid lives in `models/node.ts`, what is permitted
 * in `firestore.rules`. What is here is the shape of the queries — chosen so
 * that *every document each one can match* is one the caller is allowed to
 * read, because Firestore rejects a whole query if any matching document could
 * be denied. A query that is merely rule-safe still fails.
 *
 * **Offline.** `createNode`, `updateNode` and `moveNode` queue optimistically:
 * the document lands in the local cache and on every listener immediately, and
 * the promise they return resolves when the *server* acknowledges the write —
 * which, in a shed, is when the connection comes back. Nothing user-facing may
 * block on it.
 *
 * `reparentNode` and `deleteNode` are the opposite, and deliberately so. Both
 * read a subtree first, and reading it from the cache would return only the
 * boards that happen to have been opened — so an offline subtree delete would
 * silently miss descendants and orphan them, which is precisely the failure the
 * uniform-visibility invariant exists to prevent. They read from the server, so
 * offline they fail loudly instead.
 */

const homesCollection = "homes";
const nodesCollection = "nodes";

function nodesRef(homeId: string) {
	return collection(db, homesCollection, homeId, nodesCollection);
}

function nodeRef(homeId: string, nodeId: string) {
	return doc(db, homesCollection, homeId, nodesCollection, nodeId);
}

/*
 * ---------------------------------------------------------------------------
 * Queries
 * ---------------------------------------------------------------------------
 *
 * A board is two listeners, merged. The read rule is `isMember(homeId) &&
 * visibleToMe(resource.data)`; `isMember` is resource-independent, so it holds
 * for every document in the collection, and each query below constrains one of
 * `visibleToMe`'s two disjuncts. No matching document can be denied.
 *
 * One query per board rather than one per column keeps the listener count at
 * two however many statuses a board shows, and costs roughly one extra document
 * read per load — billing is per document, not per query. What it buys is the
 * single permitted `array-contains` slot staying free on Q1, for
 * `locationAncestorIds` later.
 */

/**
 * Q1 — the shared children of one node, or of the root (`parentId: null`).
 *
 * Provably safe: `visibility == 'shared'` is the read rule's first disjunct.
 */
export function sharedBoardQuery(
	homeId: string,
	parentId: string | null,
): Query<DocumentData> {
	return query(
		nodesRef(homeId),
		where("archived", "==", false),
		where("parentId", "==", parentId),
		where("visibility", "==", "shared"),
		orderBy("rank"),
	);
}

/**
 * Q2 — the children of the same node that I am a participant of.
 *
 * Provably safe: `participantIds array-contains uid` is the rule's second
 * disjunct. It returns my private cards *and* any shared card I am on, which is
 * why the two results are deduped by id rather than concatenated.
 */
export function participatingBoardQuery(
	homeId: string,
	parentId: string | null,
	uid: string,
): Query<DocumentData> {
	return query(
		nodesRef(homeId),
		where("archived", "==", false),
		where("parentId", "==", parentId),
		where("participantIds", "array-contains", uid),
		orderBy("rank"),
	);
}

/**
 * Every descendant of a shared node, at any depth.
 *
 * Safe by the same first disjunct, and *complete* by the uniform-visibility
 * invariant: a shared node's descendants are all shared, transitively. No
 * `archived` filter — a subtree operation moves or deletes archived
 * descendants too.
 */
export function sharedSubtreeQuery(
	homeId: string,
	nodeId: string,
): Query<DocumentData> {
	return query(
		nodesRef(homeId),
		where("visibility", "==", "shared"),
		where("ancestorIds", "array-contains", nodeId),
	);
}

/**
 * Every *private* node I am a participant of, from which a private subtree is
 * filtered client-side.
 *
 * A query may contain only one `array-contains` clause, so `ancestorIds
 * array-contains X && participantIds array-contains me` is not expressible.
 * Complete by participant inheritance — I am a participant of every descendant
 * of a private node I can read — and safe by the read rule's second disjunct,
 * which the `participantIds` clause alone already proves.
 *
 * The `visibility` clause is what *bounds* it. Being a participant is also how
 * assignment on an ordinary shared card works, so without it this reads every
 * card assigned to me anywhere in the home on each private reparent or delete.
 * Private nodes are small by construction; assigned ones are not.
 */
export function privateSubtreeQuery(
	homeId: string,
	uid: string,
): Query<DocumentData> {
	return query(
		nodesRef(homeId),
		where("visibility", "==", "private"),
		where("participantIds", "array-contains", uid),
	);
}

/*
 * ---------------------------------------------------------------------------
 * Writes
 * ---------------------------------------------------------------------------
 */

/**
 * What an ordinary edit may change.
 *
 * Not `parentId` or `ancestorIds` — moving a node is `reparentNode`, which has
 * a whole subtree to rewrite. Not `status` or `rank` — moving a card between
 * columns is `moveNode`, which also owns `completedAt`. Not `visibility`: a
 * subtree visibility flip must write top-down, one document at a time (#61).
 */
export type NodeChanges = Partial<
	Omit<NodeData, "parentId" | "ancestorIds" | "visibility" | "status" | "rank">
>;

/**
 * A new node, with its id available immediately.
 *
 * The id is generated on the device rather than by the server, so a caller can
 * navigate to the new card before the write is acknowledged. `acknowledged`
 * resolves when the server has it, which is the only thing worth reporting a
 * failure from — awaiting it before closing a sheet builds a form that hangs in
 * a shed.
 */
export function createNode(
	homeId: string,
	uid: string,
	input: NewNodeInput,
): { id: string; acknowledged: Promise<void> } {
	const data = newNodeData(input);
	const ref = doc(nodesRef(homeId));

	const written = setDoc(ref, {
		...data,
		// Writing yourself out of your own private node strands it where nobody
		// can read or delete it, so the rules refuse it — and the caller of a
		// private *root* card has no parent to inherit participants from.
		participantIds:
			data.visibility === "private" && !data.participantIds.includes(uid)
				? [uid, ...data.participantIds]
				: data.participantIds,
		// A node created straight into Done is unusual by hand and ordinary
		// over the REST API (#7). The rules require the two to agree.
		completedAt: data.status === "done" ? serverTimestamp() : null,
		createdAt: serverTimestamp(),
		createdBy: uid,
		updatedAt: serverTimestamp(),
	});

	// Handled here, and still returned. A caller that only wants the id leaves
	// the promise alone — and an ignored rejection is an unhandled one, which
	// surfaces as a console error nobody owns. Attaching the log keeps the
	// failure reportable while leaving `acknowledged` awaitable by anyone who
	// does want to know.
	written.catch((reason) => {
		console.error("Could not save the card:", reason);
	});

	return { id: ref.id, acknowledged: written };
}

export function updateNode(
	homeId: string,
	nodeId: string,
	changes: NodeChanges,
): Promise<void> {
	return updateDoc(nodeRef(homeId, nodeId), {
		...changes,
		updatedAt: serverTimestamp(),
	});
}

/**
 * A card changing column, or moving within one.
 *
 * `rank` is ordered within its `(parentId, status)` column, so a card arriving
 * in another column takes a rank computed from *that* column's neighbours, in
 * this same write.
 *
 * `completedAt` follows the status, in both directions — and a node that was
 * already done keeps the date it has, because "completed" must not quietly
 * become "last touched".
 */
export function moveNode(
	homeId: string,
	node: Node,
	status: Status,
	rank: string,
): Promise<void> {
	const change = completionChange(node.status, status);

	return updateDoc(nodeRef(homeId, node.id), {
		status,
		rank,
		...(change === "set" ? { completedAt: serverTimestamp() } : {}),
		...(change === "clear" ? { completedAt: null } : {}),
		updatedAt: serverTimestamp(),
	});
}

/**
 * Everything below a node, read from the server.
 *
 * Which query depends on the node's own visibility, and the invariant is what
 * makes either one complete: a shared node's descendants are all shared, and I
 * am a participant of every descendant of a private node I can read.
 *
 * From the server, never the cache: offline the cache holds only the boards
 * that happen to have been opened, and "no children in cache" is not "no
 * children". Both callers batch what this returns, and a batch caps at 500
 * documents — a whole home is scale-checked at ~4k, so a single subtree
 * reaching that is a different problem than these two functions.
 */
async function subtreeOf(
	homeId: string,
	node: Node,
	uid: string,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
	if (node.visibility === "shared") {
		const found = await getDocsFromServer(sharedSubtreeQuery(homeId, node.id));
		return found.docs;
	}

	const found = await getDocsFromServer(privateSubtreeQuery(homeId, uid));
	return found.docs.filter((snapshot) =>
		toNode(snapshot).ancestorIds.includes(node.id),
	);
}

/**
 * Moving a node somewhere else in the project tree, with everything under it.
 *
 * One batch, so the tree is never half-rewritten. That is what the split in
 * `firestore.rules` buys: `ancestorIds` is validated structurally, with no
 * `get()`, and no descendant's `parentId` changes here — so every document in
 * the batch passes against *committed* state, which is all a rule can see.
 *
 * `rank` is rewritten because a rank is ordered within its `(parentId, status)`
 * column, and a new parent is a new column: the caller passes one computed from
 * the target board's neighbours, the same way a column change does. `locationId`
 * is deliberately untouched — a node moving in the project tree never moves in
 * the location tree; the two hierarchies are independent, and neither is a
 * parent of the other.
 *
 * Only the moved node's own write costs a `get()` in the rules, which is what
 * keeps a subtree of any size inside a batched write's twenty-document-access
 * budget. See `privacyUnchanged()` in `firestore.rules`.
 */
export async function reparentNode(
	homeId: string,
	node: Node,
	parent: Node | null,
	rank: string,
	uid: string,
): Promise<void> {
	if (
		parent !== null &&
		(parent.id === node.id || parent.ancestorIds.includes(node.id))
	) {
		throw new Error("A node cannot be moved inside its own subtree.");
	}

	const ancestorIds = childAncestorIds(parent);
	const descendants = await subtreeOf(homeId, node, uid);

	const batch = writeBatch(db);
	batch.update(nodeRef(homeId, node.id), {
		parentId: parent?.id ?? null,
		ancestorIds,
		rank,
		updatedAt: serverTimestamp(),
	});
	for (const snapshot of descendants) {
		batch.update(snapshot.ref, {
			ancestorIds: movedAncestorIds(toNode(snapshot), node.id, ancestorIds),
			updatedAt: serverTimestamp(),
		});
	}

	await batch.commit();
}

/**
 * Deleting a node takes its subtree with it, in one batch.
 *
 * Descendants have to go, and they have to go atomically: a node whose parent
 * is gone is unreachable from every board and every breadcrumb, and nothing in
 * the app could ever find it again.
 */
export async function deleteNode(
	homeId: string,
	node: Node,
	uid: string,
): Promise<void> {
	const descendants = await subtreeOf(homeId, node, uid);

	const batch = writeBatch(db);
	for (const snapshot of descendants) batch.delete(snapshot.ref);
	batch.delete(nodeRef(homeId, node.id));

	await batch.commit();
}
