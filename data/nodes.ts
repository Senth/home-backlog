import {
	collection,
	type DocumentData,
	type DocumentReference,
	doc,
	getDoc,
	getDocs,
	getDocsFromServer,
	increment,
	orderBy,
	type Query,
	type QueryDocumentSnapshot,
	query,
	serverTimestamp,
	updateDoc,
	where,
	writeBatch,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import {
	type CounterChange,
	childAncestorIds,
	childArrives,
	childLeaves,
	completionChange,
	doneChange,
	flipPlan,
	mergeNodeResults,
	movedAncestorIds,
	type NewNodeInput,
	type Node,
	type NodeData,
	newNodeData,
	rootIdOf,
	type Status,
	toNode,
	type Visibility,
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

/**
 * One node, by id. Exported for the board's own single-document listener —
 * three listeners per board rather than two, all constrained, all torn down
 * together.
 *
 * It buys two things a one-shot read cannot: a rename by another member updates
 * the title on the screen you are looking at, and a card deleted under you —
 * `deleteNode` takes the whole subtree — bounces you to the parent board
 * instead of leaving you on a board that no longer exists.
 */
export function nodeRef(
	homeId: string,
	nodeId: string,
): DocumentReference<DocumentData> {
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
 * One node by id, or null if it is not there or cannot be read.
 *
 * The two answers are deliberately the same one. Participant inheritance runs
 * *downward* — a private child holds all of its parent's participants, not the
 * reverse — so being added to a private subtask does not grant a read on the
 * private project above it, and a breadcrumb for it is a crumb the reader is
 * not allowed to see. Neither case is an error worth surfacing.
 *
 * One `getDoc` per ancestor rather than `where(documentId(), 'in', ancestorIds)`:
 * that would be one read instead of *n* and is **query-unsafe** — a single
 * unreadable ancestor rejects the whole query, and every crumb disappears at
 * once.
 */
export async function getNode(
	homeId: string,
	nodeId: string,
): Promise<Node | null> {
	try {
		const snapshot = await getDoc(nodeRef(homeId, nodeId));
		return snapshot.exists() ? toNode(snapshot) : null;
	} catch (reason) {
		// A refusal is the answer, not an error: an unreadable ancestor is the
		// case this function's own contract is built around, and logging it would
		// make an ordinary breadcrumb draw a raw `FirebaseError` over the screen
		// in development. Anything else is worth knowing about.
		if ((reason as { code?: string } | null)?.code !== "permission-denied") {
			console.error("Could not read a node:", reason);
		}
		return null;
	}
}

/**
 * A board read once rather than listened to — what `Move under…` needs to rank
 * a card against its new neighbours, on a board that is not on screen.
 *
 * The same two queries a board load runs, and safe for the same reason. Not
 * from the server: `reparentNode` reads the *subtree* from the server, where a
 * stale answer would orphan documents, but a rank is only ever compared against
 * ranks — a stale neighbour costs a card that lands in the wrong place in the
 * column, which the next reorder fixes.
 */
export async function boardOnce(
	homeId: string,
	parentId: string | null,
	uid: string,
): Promise<Node[]> {
	const [shared, participating] = await Promise.all([
		getDocs(sharedBoardQuery(homeId, parentId)),
		getDocs(participatingBoardQuery(homeId, parentId, uid)),
	]);

	return mergeNodeResults(
		shared.docs.map(toNode),
		participating.docs.map(toNode),
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
 * subtree visibility flip must write top-down, one document at a time, which is
 * `flipVisibility`. And not `childCount` or `doneCount`, which belong to the
 * four structural writes below the same way `status` and `rank` belong to
 * `moveNode`.
 *
 * Both people-fields *are* ordinary edits. `assigneeIds` is read by no rule at
 * all, and `participantIds` on a shared node changes no permission — the read
 * grant's first disjunct already lets every member in. On a private node it is
 * the ACL, and the rules refuse a write that leaves its own author out.
 */
export type NodeChanges = Partial<
	Omit<
		NodeData,
		| "parentId"
		| "ancestorIds"
		| "visibility"
		| "status"
		| "rank"
		| "childCount"
		| "doneCount"
		// Written once, by whoever created the node. `immutable()` in the rules
		// refuses to let it change in either direction — including being added to
		// a node that predates it, which is what keeps the mark trustworthy.
		| "createdVia"
	>
>;

/**
 * A counter change as fields to write — or nothing at all, when it moves
 * neither counter.
 *
 * `increment()` is a **server-side transform**: it queues offline like any other
 * write and it commutes, so two people adding a step to the same project from
 * two sheds both land. It also moves neither `parentId`, `visibility` nor
 * `participantIds`, so `privacyUnchanged()` lets the rules skip the parent
 * `get()` — which is what keeps these updates free against a batch's
 * twenty-document-access budget.
 *
 * `updatedAt` is deliberately not touched. A step appearing under a project is
 * not somebody editing the project, and #55 reads that field as "last touched".
 */
function counterFields(change: CounterChange): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	if (change.childCount !== 0) fields.childCount = increment(change.childCount);
	if (change.doneCount !== 0) fields.doneCount = increment(change.doneCount);
	return fields;
}

function movesACounter(fields: Record<string, unknown>): boolean {
	return Object.keys(fields).length > 0;
}

/** The two shapes the rules refuse a create for: see `createNode` below. */
function needsTheAuthor(data: NodeData, uid: string): boolean {
	if (data.participantIds.includes(uid)) return false;
	return (
		data.visibility === "private" ||
		(data.parentId === null && data.participantIds.length === 0)
	);
}

/**
 * A new node, with its id available immediately.
 *
 * The id is generated on the device rather than by the server, so a caller can
 * navigate to the new card before the write is acknowledged. `acknowledged`
 * resolves when the server has it, which is the only thing worth reporting a
 * failure from — awaiting it before closing a sheet builds a form that hangs in
 * a shed.
 *
 * It is a **batch**: the card and its parent's `childCount` land together, so a
 * card can never exist without having been counted. The child's create still
 * runs `inherits()`, which does a `get()` on the parent — and a rule's `get()`
 * reads *committed* state, which cannot see the rest of this batch. That is
 * sound here precisely because the parent's own update changes neither its
 * visibility nor its participants, so the value the `get()` reads is correct.
 *
 * A root-level card has no parent document, so `parentId === null` means no
 * counter write at all.
 */
export function createNode(
	homeId: string,
	uid: string,
	input: NewNodeInput,
): { id: string; acknowledged: Promise<void> } {
	const data = newNodeData(input);
	const ref = doc(nodesRef(homeId));

	const batch = writeBatch(db);
	batch.set(ref, {
		...data,
		// Writing yourself out of your own private node strands it where nobody
		// can read or delete it, so the rules refuse it — and the caller of a
		// private *root* card has no parent to inherit participants from.
		//
		// A *root* with nobody on it is refused too, since #102: `[]` on one no
		// longer means "everybody". A caller that knows the household passes it
		// (a shared project is born with every member on it); this fallback is
		// only so that no create can write a document the rules deny.
		participantIds: needsTheAuthor(data, uid)
			? [uid, ...data.participantIds]
			: data.participantIds,
		// A node created straight into Done is unusual by hand and ordinary
		// over the REST API (#7). The rules require the two to agree.
		completedAt: data.status === "done" ? serverTimestamp() : null,
		createdAt: serverTimestamp(),
		createdBy: uid,
		updatedAt: serverTimestamp(),
	});
	if (data.parentId !== null) {
		batch.update(
			nodeRef(homeId, data.parentId),
			counterFields(childArrives(data.status)),
		);
	}

	const written = batch.commit();

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
 * Puts a uid on every shared project — what a ticked *Add them to every shared
 * project* does the moment its invitee becomes a member.
 *
 * It has to run *after* the membership write has landed, not before: every read
 * and write here is granted by being a member, and the invitee is not one until
 * then.
 *
 * Provably safe: the query returns only `visibility == 'shared'` documents,
 * which is the read rule's first disjunct, so it cannot match a document the
 * caller could be denied. Private roots are outside it deliberately — joining a
 * household is not joining its private work.
 *
 * Best-effort and re-runnable. Each root is its own write, a root that refuses
 * is reported rather than failing the join, and a rerun writes only the roots
 * still missing the uid. A partial run leaves a member with a thinner board,
 * which anyone can finish by hand on a project's details.
 *
 * Never throws, and reports nothing to the screen. The membership write has
 * already landed by the time this runs, so a failure here cannot be told to the
 * person in front of it: they *are* a member, and they are the invitee, who
 * never asked for this and has never seen the board it would be about. The
 * person who ticked the box is the inviter, who is not here. Console, then.
 */
export async function addToSharedRoots(
	homeId: string,
	uid: string,
): Promise<void> {
	const roots = await getDocs(sharedBoardQuery(homeId, null)).catch(
		(reason) => {
			console.error("Could not list a new member's shared projects:", reason);
			return null;
		},
	);
	if (roots === null) return;

	const results = await Promise.allSettled(
		roots.docs
			.map(toNode)
			.filter((node) => !node.participantIds.includes(uid))
			.map((node) =>
				updateNode(homeId, node.id, {
					participantIds: [...node.participantIds, uid],
				}),
			),
	);

	for (const result of results) {
		if (result.status === "rejected") {
			console.error(
				"Could not share a project with a new member:",
				result.reason,
			);
		}
	}
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
 *
 * The parent's `doneCount` follows the same change. A move that crosses Done in
 * neither direction, and a card with no parent document, are a plain update —
 * there is nothing to keep in step.
 */
export function moveNode(
	homeId: string,
	node: Node,
	status: Status,
	rank: string,
): Promise<void> {
	const change = completionChange(node.status, status);
	const own = {
		status,
		rank,
		...(change === "set" ? { completedAt: serverTimestamp() } : {}),
		...(change === "clear" ? { completedAt: null } : {}),
		updatedAt: serverTimestamp(),
	};

	const counters = counterFields(doneChange(change));
	if (node.parentId === null || !movesACounter(counters)) {
		return updateDoc(nodeRef(homeId, node.id), own);
	}

	const batch = writeBatch(db);
	batch.update(nodeRef(homeId, node.id), own);
	batch.update(nodeRef(homeId, node.parentId), counters);
	return batch.commit();
}

/**
 * Everything below a node, read from the server: **both** subtree queries,
 * unioned and deduped by id.
 *
 * Not one query chosen by the node's own visibility, which is what this was.
 * Uniform visibility says a subtree is all one thing — but a *visibility flip*
 * is n sequential writes that cannot be one batch, so a flip abandoned partway
 * leaves a mixed subtree, and that is the state this has to survive. Choosing by
 * the node's own value, a project left private with fourteen still-shared
 * descendants is a project whose later deletion runs `privateSubtreeQuery` and
 * never sees them: they survive the delete with a dead `parentId`, unreachable
 * from every board and every breadcrumb. Precisely the orphan the whole
 * invariant exists to prevent, and it bites in both directions.
 *
 * Each half is provably safe on its own — one constrains `visibility ==
 * 'shared'`, the other `participantIds array-contains uid` — so the union is.
 * It costs one extra one-shot server read on reparent, delete and flip, and it
 * buys a mixed subtree that still deletes whole and still reparents whole. An
 * abandoned flip then degrades — some cards keep the old visibility — but can
 * never orphan.
 *
 * From the server, never the cache: offline the cache holds only the boards
 * that happen to have been opened, and "no children in cache" is not "no
 * children". The batching callers cap at 500 documents — a whole home is
 * scale-checked at ~4k, so a single subtree reaching that is a different
 * problem than these functions.
 */
async function subtreeOf(
	homeId: string,
	node: Node,
	uid: string,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
	const [shared, participating] = await Promise.all([
		getDocsFromServer(sharedSubtreeQuery(homeId, node.id)),
		getDocsFromServer(privateSubtreeQuery(homeId, uid)),
	]);

	// Q1 already constrains `ancestorIds array-contains nodeId`; Q2 cannot,
	// because a query may hold only one `array-contains` clause, so its half is
	// narrowed to this subtree here. Neither can return the node itself: a node
	// is never in its own `ancestorIds`.
	const byId = new Map<string, QueryDocumentSnapshot<DocumentData>>();
	for (const snapshot of shared.docs) byId.set(snapshot.id, snapshot);
	for (const snapshot of participating.docs) {
		if (toNode(snapshot).ancestorIds.includes(node.id)) {
			byId.set(snapshot.id, snapshot);
		}
	}

	return [...byId.values()];
}

/** How far a flip has got, for the dialog that is holding the screen. */
export interface FlipProgress {
	done: number;
	total: number;
}

/**
 * Making a project private, or showing it to everyone again.
 *
 * Uniform visibility means every descendant physically carries the same
 * `visibility` value — board Q1 filters on it directly, so it cannot be derived
 * — and the *n* writes **cannot be one batch**: a rule's `get()` reads committed
 * state, so a child written to the new visibility while its parent still holds
 * the old one fails `inheritsFrom`. Top-down, one document at a time, in both
 * directions.
 *
 * Which makes a flip that fails partway the failure that matters, and it is
 * answered twice over. `subtreeOf()` unions both queries, so a mixed subtree can
 * never orphan; and this is **idempotent and resumable** — it re-reads from the
 * server, writes in depth order, and `flipPlan` drops every document already at
 * the target, so retrying finishes the job rather than repeating it.
 *
 * Online only, and the caller disables the control offline rather than letting
 * this fail after the fact. Each write changes `visibility`, so
 * `privacyUnchanged()` is false and one parent `get()` is spent per document —
 * affordable because these are single-document writes, not a batch, so the
 * twenty-document-access budget does not apply.
 *
 * *Rejected:* a Cloud Function with the admin SDK. It bypasses rules, so all n
 * writes go in one atomic batch and no half-state exists — but it costs the
 * project's first Cloud Function, a deploy pipeline, and the uniform-visibility
 * invariant no longer enforced by the rules on the one path most likely to
 * break it.
 */
export async function flipVisibility(
	homeId: string,
	node: Node,
	target: Visibility,
	uid: string,
	options: {
		/**
		 * What the root's participants should become. Defaults to what they are —
		 * an ordinary visibility flip does not change who is in on a project. The
		 * other caller is the participants control on an *already private* root,
		 * where the list is the ACL and every descendant has to carry it.
		 */
		participantIds?: readonly string[];
		onProgress?: (progress: FlipProgress) => void;
	} = {},
): Promise<void> {
	const { participantIds, onProgress } = options;

	// Visibility is a question about a *project*. A descendant written away from
	// its parent's value is refused by `inheritsFrom`, so this would be a bare
	// permission error rather than a partial flip.
	if (node.parentId !== null) {
		throw new Error("Only a whole project can change visibility.");
	}

	const descendants = (await subtreeOf(homeId, node, uid)).map(toNode);
	const plan = flipPlan(node, descendants, target, uid, participantIds);

	let done = 0;
	onProgress?.({ done, total: plan.length });

	for (const write of plan) {
		try {
			await updateDoc(nodeRef(homeId, write.id), {
				visibility: write.visibility,
				participantIds: write.participantIds,
				updatedAt: serverTimestamp(),
			});
		} catch (reason) {
			// What is already committed is still true, and the retry re-reads: the
			// count is what the dialog offers *Try again* against.
			onProgress?.({ done, total: plan.length });
			throw reason;
		}

		done += 1;
		onProgress?.({ done, total: plan.length });
	}
}

/**
 * What a move does to `participantIds`, which is a question about a *project*
 * and edited by a root-only control — so both ends of a move need an answer:
 *
 * - a shared root that **becomes a step** has them cleared. The board's
 *   default-hide filter is uniform at every depth, so the step would otherwise
 *   stay hidden from everyone not on it, with no control anywhere able to clear
 *   it short of moving it back to the top;
 * - a shared step that **becomes a root** takes the old project's list. Since
 *   #102 the rules refuse a root with nobody on it, and whose project it came
 *   out of is the only honest answer. It costs one `get()` of that root, which
 *   is shared and therefore readable by every member.
 *
 * A private node needs neither: the rules already require every descendant to
 * carry all of its parent's participants, so a promoted private step is already
 * carrying the right list.
 *
 * A root the #102 backfill has not reached still holds `[]`, and promoting into
 * it is then refused — the same refusal every *other* update to that root
 * already gets. See `OPERATIONS.md` § One-off migrations.
 */
async function movedParticipants(
	homeId: string,
	node: Node,
	parent: Node | null,
): Promise<{ participantIds?: string[] }> {
	if (node.visibility !== "shared") return {};
	if (parent !== null) return { participantIds: [] };
	if (node.parentId === null) return {};
	const root = await getNode(homeId, rootIdOf(node));
	return { participantIds: root?.participantIds ?? [] };
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
	const participants = await movedParticipants(homeId, node, parent);
	const descendants = await subtreeOf(homeId, node, uid);

	const batch = writeBatch(db);
	batch.update(nodeRef(homeId, node.id), {
		parentId: parent?.id ?? null,
		ancestorIds,
		rank,
		...participants,
		updatedAt: serverTimestamp(),
	});
	// The node leaves one board and arrives on another. Either end may be the
	// root, which has no document to count on.
	if (node.parentId !== null) {
		batch.update(
			nodeRef(homeId, node.parentId),
			counterFields(childLeaves(node.status)),
		);
	}
	if (parent !== null) {
		batch.update(
			nodeRef(homeId, parent.id),
			counterFields(childArrives(node.status)),
		);
	}
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
 *
 * Only **one** parent's counters move, however large the subtree: every
 * descendant's parent is inside the subtree and is deleted with it, so the only
 * document left holding a count of something that has gone is the deleted node's
 * own parent.
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
	if (node.parentId !== null) {
		batch.update(
			nodeRef(homeId, node.parentId),
			counterFields(childLeaves(node.status)),
		);
	}

	await batch.commit();
}
