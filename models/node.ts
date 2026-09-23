import type {
	DocumentData,
	QueryDocumentSnapshot,
	Timestamp,
} from "firebase/firestore";
import {
	BASE_62_DIGITS,
	generateKeyBetween,
	generateNKeysBetween,
} from "fractional-indexing";

/**
 * The one document type every board, task and subtask is made of.
 *
 * A project, a task and a subtask are the same shape at different depths, and
 * any node with children can be opened as a board. Depth is *derived* from
 * `ancestorIds.length`, never stored.
 *
 * Two invariants in here are not conveniences — the rules in `firestore.rules`
 * enforce them, and losing either one loses documents:
 *
 * 1. **A node's `visibility` equals its parent's.** Only a root node sets it.
 *    Firestore has no field-level read rules and allows a single
 *    `array-contains` per query, so `ancestorIds array-contains X &&
 *    participantIds array-contains me` is not expressible. Without uniform
 *    visibility, no client query can see another member's private descendant —
 *    so a reparent leaves it with stale `ancestorIds` and a delete orphans it
 *    permanently, with no error anywhere.
 * 2. **A private node's `participantIds` contains all of its parent's**, which
 *    is what makes "I am a participant of every descendant of a private node I
 *    can read" true, and so makes the private subtree query complete.
 *
 * The cost is a product restriction: a private card cannot live inside a shared
 * project. It sits at the root, or under another private card. That restriction
 * is worth having anyway — a hidden child makes its parent lie, and every count
 * derived from children diverges per viewer.
 *
 * Three questions about people get confused with each other, and they are three
 * separate fields here on purpose:
 *
 * | Question                     | Field            | Scope     | Read by a rule?   |
 * | ---------------------------- | ---------------- | --------- | ----------------- |
 * | Whose project is this?       | `participantIds` | root only | only when private |
 * | Who is doing this card?      | `assigneeIds`    | this node | never             |
 * | Is this anyone else's business? | `visibility`  | root only | yes               |
 *
 * One field for both people-questions was rejected: `participantIds` is the ACL
 * a private read rule consults, so folding assignment into it would make
 * assigning somebody a *permission* change — and would make "my tasks" return
 * every card in every project you are involved in, which in a two-person
 * household is close to everything.
 */

/**
 * The global status vocabulary. A board chooses which of these to show; it
 * cannot invent new ones. Stored as a string id so a custom status is a new
 * value rather than a migration, and so cross-board queries stay comparable.
 *
 * There is no `blocked` here on purpose. A card is in exactly one status, so
 * parking one in Blocked destroys the stage it was in and nothing says where it
 * goes when the blocker clears. Being blocked is not a *stage* of work — it is a
 * *condition* a card at any stage can be in, and `blockedBy[]` already carries
 * it. The card stays in its real column and shows a mark (#66).
 *
 * There is no `research`, `planning` or `review` either, and there was (#99).
 * Living with them showed that finding out, planning and checking are *cards* —
 * a step you put in progress and finish — rather than stages every card passes
 * through. Nobody dragged a card across them; three of the seven columns stood
 * empty on every board and cost the four that were used their width.
 */
export type Status = "backlog" | "next_up" | "execution" | "done";

/** Enum order. A column not in a board's frozen set is appended in this order. */
export const statuses: readonly Status[] = [
	"backlog",
	"next_up",
	"execution",
	"done",
];

/**
 * What a status written before #99 reads as.
 *
 * Production is migrated before that change ships, so no stored document should
 * reach this — but a device holding a node it cached beforehand would otherwise
 * fall back to `backlog` and walk a card in flight all the way back to To do.
 * All three retired stages describe a card somebody is actively holding, so
 * they read as In progress, which is where that work was happening anyway.
 */
const retiredStatuses: Readonly<Record<string, Status>> = {
	research: "execution",
	planning: "execution",
	review: "execution",
};

/*
 * ---------------------------------------------------------------------------
 * Columns
 * ---------------------------------------------------------------------------
 *
 * `columns` on a node is the column set of the board formed by that node's
 * **children**, taken from the default at creation and then frozen.
 *
 * Frozen, because deriving the set at render time strands cards: every later
 * change to the default would silently swap the set under every board that
 * already exists, and each card sitting in a column the new set drops would
 * land nowhere.
 *
 * Frozen does **not** mean immutable — the rules validate the shape and let the
 * value change, because per-board column configuration (#63) is exactly the
 * feature that changes it.
 */

/**
 * The set a new board starts with, at every depth.
 *
 * It used to depend on depth — the root board and the board inside a project
 * got all seven stages, anything deeper got a three-column *To do · In progress
 * · Done*, because a research column whose cards each contain their own
 * research column is nonsense. Removing the stage columns (#99) collapsed the
 * two sets into one, and one set buys more than the depth rule did: every board
 * reads the same, and a card keeps its column when it moves deeper.
 */
export const defaultColumns: readonly Status[] = statuses;

/**
 * What a board actually renders: its frozen columns, plus one extra column per
 * status that is *present in the data but absent from the set*, in enum order.
 *
 * Without it, `Move under…`, the REST API (#7) and a seeded fixture can each put
 * a `next_up` card on a board frozen without that column — a board created
 * before #99, or one configured narrow by #63 — and the board would draw as
 * though the card were not there. A card that exists is visible somewhere — the
 * same principle as the orphaned node the visibility invariant exists to
 * prevent.
 *
 * The extra column appears only while such a card exists and disappears when it
 * is moved out; the move sheet offers only the frozen destinations, so it is a
 * one-way exit.
 */
export function visibleColumns(
	columns: readonly Status[],
	nodes: readonly Node[],
): Status[] {
	const extra = statuses.filter(
		(status) =>
			!columns.includes(status) &&
			nodes.some((candidate) => candidate.status === status),
	);
	return [...columns, ...extra];
}

/*
 * ---------------------------------------------------------------------------
 * Counters
 * ---------------------------------------------------------------------------
 *
 * `childCount` and `doneCount` are denormalized and maintained by the client,
 * with `increment()` — a server-side transform, so it queues offline like any
 * other write and it commutes: two people adding a step to the same project from
 * two sheds both land.
 *
 * They are a **display convenience, never an invariant.** Counts cannot diverge
 * per viewer — every child of a node shares that node's visibility, so anyone who
 * can read the parent can read all of its children — but drift is still possible
 * from a client that crashes between two halves of a batch, or from a future REST
 * writer that forgets. It is asymmetric, and only one direction matters:
 *
 * - **too high** — a chevron on a childless card; you drill in and find an empty
 *   board.
 * - **too low** — a card with children shows no chevron, which could *hide work*.
 *
 * The second is closed by construction rather than by care: the detail screen's
 * Steps section runs the real board queries and lists the true children whatever
 * the counter says. A card that has lost its chevron still opens its details, and
 * its steps are there.
 *
 * For the same reason the rules do not bound either counter. `doneCount >= 0`
 * looks correct and is a trap: one device offline marks a step done while another
 * deletes that step, and the transformed value can dip below zero — which would
 * reject the whole batch and fail a *delete*, an operation whose atomicity this
 * area is built around. `toNode` clamps on read instead.
 */

/**
 * Whether a node is a board.
 *
 * Board-ness is derived, not stored: there is no flag, no *convert to a board*
 * action and no undo, because there is nothing to convert. A card becomes a board
 * the moment it gets its first step and stops being one when the last step goes.
 * No steps means no chevron, and a tap opens the details instead.
 *
 * Every screen goes through this rather than reading the field, so the derivation
 * has one home.
 */
export function hasSteps(node: Node): boolean {
	return node.childCount > 0;
}

/**
 * Whether opening a card's details would show anything at all.
 *
 * What the mark on the board's own details action is for: without it, opening
 * them is a lottery rather than a decision, and the answer is usually "nothing".
 * Steps are deliberately not counted — they have a chevron of their own, and the
 * mark is about the four fields that have no other way of being seen.
 */
export function hasDetails(node: Node): boolean {
	return (
		node.dueDate !== null ||
		node.priority !== null ||
		node.effort !== null ||
		node.notes.length > 0
	);
}

/*
 * ---------------------------------------------------------------------------
 * Blocked-by (#66)
 * ---------------------------------------------------------------------------
 *
 * A card can wait on other cards through `blockedBy[]`. Being blocked is a
 * condition, not a stage — the card stays in its real column and shows a mark —
 * and the relation is **durable**: nothing in the app ever removes an entry
 * except a person. A done blocker stops holding the card without being
 * removed, and reopening it re-blocks the dependents; completing a waiting
 * card keeps its list as inert history.
 */

/*
 * ---------------------------------------------------------------------------
 * Stepping through the columns (#237)
 * ---------------------------------------------------------------------------
 */

/**
 * The column the details screen's forward arrow moves to, or `null` when there
 * is no next.
 *
 * `columns` is the **parent's** column set — `columns` on a node is the set
 * its *children* form, so the board a card sits on is the set its parent
 * carries. The caller falls back to `defaultColumns` for a root.
 *
 * `done` is the end of the ramp: the last working column steps into it, and
 * the forward arrow is the only way there. `done` itself has no next. A
 * status the set does not name (a card sitting in an extra `visibleColumns()`
 * column) steps to the next column the set does have.
 */
export function nextStatus(
	columns: readonly Status[],
	status: Status,
): Status | null {
	if (status === "done") return null;
	const later = statuses
		.slice(statuses.indexOf(status) + 1)
		.find((candidate) => candidate === "done" || columns.includes(candidate));
	return later ?? null;
}

/**
 * The column the details screen's back arrow moves to, or `null` on the first.
 *
 * `done` reads as one past the last working column, so backing out of Done
 * lands the card where work was happening, whatever the set's shape.
 */
export function previousStatus(
	columns: readonly Status[],
	status: Status,
): Status | null {
	const earlier = statuses
		.slice(0, statuses.indexOf(status))
		.filter((candidate) => candidate !== "done" && columns.includes(candidate));
	return earlier.pop() ?? null;
}

/**
 * How deep the picker's home-wide search reaches (Q-S1/Q-S2 in
 * `data/nodes.ts`). The cap is what bounds the search, and the one thing the
 * capped footer line has to name: a home of thousands of dormant cards can
 * miss candidates, and the picker says so rather than pretending
 * completeness.
 */
export const pickerLimit = 50;

/**
 * The entries of `blockedBy` that still hold the card: each id is either
 * missing from `blockerById` — gone, unreadable, or not read yet — or its
 * blocker's `status` is anything but `'done'`.
 *
 * A missing blocker waits deliberately: honest *not yet* beats a mark that
 * lies either way. A done blocker stops holding the card without being
 * removed, which is what makes the relation durable rather than a moment that
 * passes.
 *
 * **Waiting is this list non-empty *and* the node itself not `done`.** A card
 * completed while waiting keeps its `blockedBy` as inert history and never
 * marks, whatever its list holds — so the caller composes the two, and this
 * function answers only "which entries are unresolved".
 *
 * The map's values may be `null` — the board's watcher records a blocker the
 * server confirmed gone, and a `null` reads exactly like a missing entry.
 */
export function unresolvedBlockers(
	node: Node,
	blockerById: ReadonlyMap<string, Node | null>,
): string[] {
	return node.blockedBy.filter((id) => blockerById.get(id)?.status !== "done");
}

/**
 * The blocker ids no card on this board carries — the ones its own query pair
 * cannot see, and so the ones the board's `BlockerWatcher` listens to one
 * single-document listener apiece.
 *
 * A same-board blocker resolves free from the board's merged results, which
 * carry every status column. Deduped: two cards can wait on the same
 * off-board blocker, and it is one document.
 */
export function crossBoardBlockerIds(nodes: readonly Node[]): string[] {
	const onBoard = new Set(nodes.map((node) => node.id));
	const ids = new Set<string>();
	for (const node of nodes) {
		for (const id of node.blockedBy) {
			if (!onBoard.has(id)) ids.add(id);
		}
	}
	return [...ids];
}

/**
 * The picker's home-wide search results, merged.
 *
 * Dedupe by id — a shared card I participate in matches both queries (Q-S1
 * and Q-S2) — then filter client-side: a case-insensitive title substring,
 * and drop self, existing blockers and done. The queries already exclude
 * done, so the status check is what keeps the function honest whichever
 * snapshot list reaches it.
 *
 * The cap is measured on the *raw* hits, before filtering: it answers "the
 * home may hold more candidates than the search saw", not "the filtered list
 * is long". `rawCount` is that raw size, so the footer can say how many hits
 * the search saw even when every one of them filtered away.
 */
export function pickerCandidates(
	query: string,
	self: Node,
	blockedBy: readonly string[],
	shared: readonly Node[],
	participating: readonly Node[],
): { results: Node[]; rawCount: number; capped: boolean } {
	const seen = new Set<string>();
	const merged: Node[] = [];
	for (const node of [...shared, ...participating]) {
		if (seen.has(node.id)) continue;
		seen.add(node.id);
		merged.push(node);
	}

	const needle = query.toLowerCase();
	const results = merged.filter(
		(candidate) =>
			candidate.id !== self.id &&
			!blockedBy.includes(candidate.id) &&
			candidate.status !== "done" &&
			candidate.title.toLowerCase().includes(needle),
	);

	return {
		results,
		rawCount: merged.length,
		capped: shared.length >= pickerLimit || participating.length >= pickerLimit,
	};
}

/**
 * The waiting-on picker's *On this board* candidates — what the board may
 * still offer, from the board's own listener: free, live, and working
 * offline, where the home-wide search cannot. The rows already picked are
 * not candidates; the picker always shows those separately, ticked, so a
 * wait can be taken back off without clearing the search first.
 *
 * A done card blocks nothing, so it is never offered, and the card itself is
 * never its own candidate.
 */
export function siblingCandidates(
	query: string,
	self: Node,
	blockedBy: readonly string[],
	siblings: readonly Node[],
): Node[] {
	const needle = query.toLowerCase();
	return siblings.filter(
		(candidate) =>
			candidate.id !== self.id &&
			!blockedBy.includes(candidate.id) &&
			candidate.status !== "done" &&
			candidate.title.toLowerCase().includes(needle),
	);
}

/**
 * How a *parent's* two counters move. Zero means the field is not written at
 * all, so a write that changes nothing costs nothing.
 */
export interface CounterChange {
	childCount: number;
	doneCount: number;
}

/** A child appearing under a parent — created there, or moved there. */
export function childArrives(status: Status): CounterChange {
	return { childCount: 1, doneCount: status === "done" ? 1 : 0 };
}

/**
 * A child going away — deleted, or moved to another parent.
 *
 * A subtree delete touches only *one* parent: every descendant's parent is
 * inside the subtree and goes with it, so only the top node's parent is
 * decremented.
 */
export function childLeaves(status: Status): CounterChange {
	return { childCount: -1, doneCount: status === "done" ? -1 : 0 };
}

/** A child crossing into or out of Done where it stands. */
export function doneChange(change: CompletionChange): CounterChange {
	if (change === "set") return { childCount: 0, doneCount: 1 };
	if (change === "clear") return { childCount: 0, doneCount: -1 };
	return { childCount: 0, doneCount: 0 };
}

export type Priority = "low" | "normal" | "high" | "urgent";

export const priorities: readonly Priority[] = [
	"low",
	"normal",
	"high",
	"urgent",
];

/**
 * The same scale, urgent-first — for *rendering* only. Validation and sorting
 * keep reading `priorities` / `priorityOrder`, so nothing here may sort or
 * validate through this list.
 */
export const prioritiesHighFirst: readonly Priority[] = [
	...priorities,
].reverse();

/**
 * Sorting and scoring go through the ordinal, never through the id's spelling,
 * so a new value in the middle of the scale needs no migration and no rename.
 */
export const priorityOrder: Record<Priority, number> = {
	low: 0,
	normal: 1,
	high: 2,
	urgent: 3,
};

/**
 * Deliberately semantic rather than duration-shaped: "an evening" has no
 * numeric form, and retuning what "quick" means must not become a migration.
 */
export type Effort = "quick" | "hours" | "evening" | "weekend" | "multi_week";

export const efforts: readonly Effort[] = [
	"quick",
	"hours",
	"evening",
	"weekend",
	"multi_week",
];

export const effortOrder: Record<Effort, number> = {
	quick: 0,
	hours: 1,
	evening: 2,
	weekend: 3,
	multi_week: 4,
};

export type Visibility = "shared" | "private";

/**
 * Who wrote a node — a person in the app, or somebody's agent over the REST API
 * (#7).
 *
 * Written at creation and immutable. Marcus curates everything and needs to know
 * which of forty cards a machine wrote; Ingrid needs to understand eleven cabin
 * cards that appeared at 03:00 without ever meeting the word "API". One plain
 * line on the node detail screen does both, and the card face carries nothing —
 * a chip there would mark every card on the boards that are already fullest.
 *
 * There is deliberately **no backfill**. The absent-field trap bites a field a
 * query has to match *negatively*, and this one is never queried: it is read
 * with the document it sits on and displayed. `toNode` reads an absent value as
 * `'app'`, which is true of every node written before the API existed.
 */
export type CreatedVia = "app" | "api";

export interface ChecklistItem {
	id: string;
	text: string;
	done: boolean;
}

export interface Attachment {
	id: string;
	/**
	 * A Cloud Storage path, never a download URL — URLs carry tokens that
	 * rotate, so a stored one stops working without anything having changed.
	 */
	path: string;
	name: string;
	contentType: string;
	size: number;
	uploadedAt: Timestamp | null;
	uploadedBy: string;
}

/**
 * How a card shows its attachments on the board face. A preference, and
 * rendering degrades when the data moves under it — nothing is ever rewritten
 * on read.
 */
export type AttachmentDisplay = "count" | "thumbnails" | "hero";

export const attachmentDisplays: readonly AttachmentDisplay[] = [
	"count",
	"thumbnails",
	"hero",
];

export interface Node {
	id: string;
	title: string;
	status: Status;
	/** Fractional index, ordered within its `(parentId, status)` column. */
	rank: string;
	/** `null` is a root node. */
	parentId: string | null;
	/** Root → parent. The last element equals `parentId`. */
	ancestorIds: string[];
	/** Inherited from the parent unless overridden. */
	locationId: string | null;
	/** The denormalized location path, so a roll-up is one index lookup. */
	locationAncestorIds: string[];
	/**
	 * **Whose project this is** — set on a root, and on a private node the ACL
	 * the read rule consults. Never "who is doing this card": that is
	 * `assigneeIds`, and the two are deliberately different lists.
	 *
	 * A **root** always names people: the rules refuse an empty list on one
	 * (#102), because `[]` meaning "everybody, including whoever joins later"
	 * is a fiction the participant checkboxes cannot draw honestly. A shared
	 * descendant still carries `[]` — participants are a question about a
	 * project — and `hiddenByParticipants()` still reads an empty list as
	 * everybody's, which is what keeps a step visible.
	 */
	participantIds: string[];
	/**
	 * **Who is doing this node.** Per node, inherited by nothing, read by no
	 * rule — which is what keeps an assignment from being a permission change.
	 */
	assigneeIds: string[];
	/** Always equal to the parent's. Only a root node sets it. */
	visibility: Visibility;
	/**
	 * The columns of the board this node's **children** form. Chosen by depth at
	 * creation and then frozen — never recomputed when the node moves.
	 */
	columns: Status[];
	/** Direct children. What makes this node a board — see `hasSteps()`. */
	childCount: number;
	/** Direct children whose `status` is `'done'`. */
	doneCount: number;
	/** `'YYYY-MM-DD'` — a calendar day, not an instant. */
	dueDate: string | null;
	priority: Priority | null;
	/** Node ids this is waiting on (#66). */
	blockedBy: string[];
	/**
	 * Labels this card carries directly (#100), each an id in the home's
	 * `labels` map. Inherited labels are derived, never stored here — the trail
	 * already answers that. A deleted definition leaves the id in place; it
	 * resolves to nothing and renders nothing.
	 */
	labelIds: string[];
	notes: string;
	checklist: ChecklistItem[];
	effort: Effort | null;
	attachments: Attachment[];
	/**
	 * Denormalized from `attachments.length` so the inventory query has
	 * something to filter on — Firestore cannot ask whether an array is
	 * non-empty.
	 */
	attachmentCount: number;
	/** How the card face shows its images. See `AttachmentDisplay`. */
	attachmentDisplay: AttachmentDisplay;
	/** The image the `hero` mode draws; `null` when none is chosen. */
	heroAttachmentId: string | null;
	/** Constrains every board query, so it is written from the first document. */
	archived: boolean;
	/** Written at creation and never again. See `CreatedVia`. */
	createdVia: CreatedVia;
	/** Set if and only if `status === 'done'`. */
	completedAt: Timestamp | null;
	createdAt: Timestamp | null;
	createdBy: string;
	updatedAt: Timestamp | null;
}

/** Longest title a node may have, matched by `validNode()` in `firestore.rules`. */
export const maxTitleLength = 200;

/** Why a typed title cannot be saved, as the key that says so. */
export type TitleError = "board.titleRequired" | "board.titleTooLong";

/**
 * The one validation a card creation has, checked here rather than in the
 * dialog so the rules are not the first thing that says no.
 */
export function titleError(title: string): TitleError | null {
	const trimmed = title.trim();
	if (trimmed.length === 0) return "board.titleRequired";
	if (trimmed.length > maxTitleLength) return "board.titleTooLong";
	return null;
}

/** Matched by `validNode()`. Notes absorb cost and budget until #57. */
export const maxNotesLength = 10000;
export const maxChecklistItems = 200;
export const maxAttachments = 50;

/*
 * ---------------------------------------------------------------------------
 * Rank
 * ---------------------------------------------------------------------------
 *
 * Drag and drop (#5) landed after the card menu's move sheet; `rank` existed
 * from the first document purely so that adding it was a UI change with no data
 * migration.
 *
 * A rank is ordered **within its `(parentId, status)` column** — that is what a
 * board reorder manipulates. Moving a card to another column recomputes its
 * rank from that column's neighbours in the same write as the status change.
 *
 * Fractional, not float: around fifty repeated midpoint inserts at one spot
 * exhaust double precision, and the renormalization pass that fixes it rewrites
 * a whole column — a batch write that fails offline, which is exactly where
 * drag and drop gets used. `fractional-indexing` has no such limit; a key just
 * grows a character.
 */

/** Base 62 over `0-9A-Za-z`, whose character order is also its sort order. */
const rankDigits = BASE_62_DIGITS;

/**
 * A rank between two neighbours in the same column. Either bound may be null —
 * `rankBetween(null, first)` is "at the top", `rankBetween(last, null)` is "at
 * the end".
 */
export function rankBetween(
	before: string | null,
	after: string | null,
): string {
	return generateKeyBetween(before, after, rankDigits);
}

/** The rank of a card appended to a column, given that column's last rank. */
export function rankAtEnd(last: string | null): string {
	return rankBetween(last, null);
}

/**
 * The rank an item lands on when it moves one step up or down its list —
 * the manual reorder the labels' set (#100) and the location tree's
 * siblings (#182) both use. Only the moved item is written: its swap partner
 * keeps its rank, and the mover lands between the pair that surrounds it
 * afterwards — the item two places away on the side it came from, and the one
 * it passed. The edges answer `null`, and the caller leaves the handle alone
 * there.
 */
export function movedRank(
	items: readonly { rank: string }[],
	index: number,
	delta: -1 | 1,
): string | null {
	const target = index + delta;
	if (target < 0 || target >= items.length) return null;
	return delta === -1
		? rankBetween(
				items[index - 2]?.rank ?? null,
				items[index - 1]?.rank ?? null,
			)
		: rankBetween(
				items[index + 1]?.rank ?? null,
				items[index + 2]?.rank ?? null,
			);
}

/**
 * `count` ranks in order between two neighbours, for a bulk subtree create over
 * the REST API (#7). One call rather than a fold, because generating them
 * pairwise produces keys that grow a character per item.
 */
export function rankSequence(
	before: string | null,
	after: string | null,
	count: number,
): string[] {
	return generateNKeysBetween(before, after, count, rankDigits);
}

/**
 * The board sort: rank, then id.
 *
 * The id is not decoration. Two people offline can produce the same rank
 * between the same neighbours, and a tie that resolves by arrival order renders
 * differently on every device. Breaking it on the id costs no field and no
 * write, and it covers ties arriving from the REST API or a seeded fixture too;
 * the next drag breaks the tie permanently.
 */
export function compareNodes(a: Node, b: Node): number {
	if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The board's **real** sibling set: every card in the list whose parent is
 * this board's own, filtered and hidden alike, in `(rank, id)` order.
 *
 * This is the set the rank arithmetic reads (#90). The screen's list is the
 * participant-filtered half of it — a column whose last card is somebody
 * else's personal project renders empty — and a rank computed against that
 * half lands a new card or a moved card **on top of** the card the filter is
 * holding back, where the next unhide buries it. The hidden half is in the
 * list the board already holds, so no extra read is needed; `parentId` does
 * the deriving, so a stray in the list cannot borrow a rank slot.
 */
export function siblingsOf(
	nodes: readonly Node[],
	parentId: string | null,
): Node[] {
	return nodes.filter((node) => node.parentId === parentId).sort(compareNodes);
}

/*
 * ---------------------------------------------------------------------------
 * Structure
 * ---------------------------------------------------------------------------
 */

/**
 * The `ancestorIds` of a child of `parent` — `[]` for a root node.
 *
 * Structural on purpose, so a location's path (#50) is derived through the
 * same function: the two trees must not drift apart on the shape of a path.
 */
export function childAncestorIds(
	parent: { id: string; ancestorIds: readonly string[] } | null,
): string[] {
	return parent === null ? [] : [...parent.ancestorIds, parent.id];
}

/**
 * A descendant's `ancestorIds` after the subtree it sits in has been moved.
 *
 * `movedAncestors` is the moved node's *new* path. Everything from the moved
 * node downwards keeps its own relative path — a reparent moves a subtree
 * whole, and no descendant's `parentId` changes — so the rewrite is a splice at
 * the point where the moved node appears.
 *
 * This is the function the split in `firestore.rules` leans on. The rules check
 * the path structurally rather than walking it, so a wrong *grandparent* id
 * passes them; `parentId` stays the source of truth and this is what derives
 * the rest of it, which is why it is tested rather than trusted. A location
 * move (#50) reuses it for the same reason.
 */
export function movedAncestorIds(
	ancestorIds: readonly string[],
	movedId: string,
	movedAncestors: readonly string[],
): string[] {
	const index = ancestorIds.indexOf(movedId);
	if (index === -1) return [...ancestorIds];
	return [...movedAncestors, ...ancestorIds.slice(index)];
}

/**
 * The results of the two board queries, as one board.
 *
 * Deduping is required rather than defensive: a *shared* node I participate in
 * matches both queries, and would otherwise be drawn twice. The merge lives
 * here, not in the hook, so it can be tested without Firestore.
 */
export function mergeNodeResults(
	shared: readonly Node[],
	participating: readonly Node[],
): Node[] {
	const byId = new Map<string, Node>();
	for (const node of [...shared, ...participating]) byId.set(node.id, node);
	return [...byId.values()].sort(compareNodes);
}

/**
 * Whether a status change must also write `completedAt`.
 *
 * A node that is already done and stays done keeps the date it has — rewriting
 * it on every edit would make "completed" mean "last touched", which is the
 * same mistake as deriving the date from `updatedAt`.
 */
export type CompletionChange = "keep" | "set" | "clear";

export function completionChange(
	current: Status,
	next: Status,
): CompletionChange {
	if (next === "done") return current === "done" ? "keep" : "set";
	return current === "done" ? "clear" : "keep";
}

/*
 * ---------------------------------------------------------------------------
 * People
 * ---------------------------------------------------------------------------
 *
 * `participantIds` and `visibility` are both **root-only** — they answer a
 * question about a *project*, not about a step inside one, and a household that
 * learns the rule once has learned it for both. The practical gain is that
 * neither ever needs a greyed-out inherited row on a descendant: no dimmed
 * control, no `aria-disabled` trap, nothing to explain about where a value came
 * from. A descendant carries one sentence and the action that unblocks it.
 *
 * *Rejected:* participants editable at every depth, inherited and greyed below.
 * It needs the ancestor named and linked on every card to not be a dead end —
 * and if the inherited value were *stored*, editing participants on a thirty-card
 * project becomes a second top-down subtree cascade, with the same half-failure
 * problems as the visibility flip, inside the same feature.
 *
 * *Rejected:* participants per node with no inheritance at all. The default-hide
 * predicate then bites unpredictably on drill-down boards, hiding individual
 * steps from people who can see the project they are in.
 */

/** The id of the root of this node's subtree — itself, when it is one. */
export function rootIdOf(node: Node): string {
	return node.ancestorIds[0] ?? node.id;
}

/**
 * The ancestors' titles, root first — what a path above the card's title shows.
 *
 * An ancestor the map cannot answer is `null` in its own position rather than
 * skipped, so the array's length always equals `ancestorIds.length` and a hole
 * never shortens the path. `null` means *unresolvable* — the same case
 * `Breadcrumbs` draws as a hidden crumb — and the word for it stays with the
 * component, so i18n stays out of `models/`.
 */
export function crumbTitlesOf(
	node: Node,
	nodeById: ReadonlyMap<string, Node>,
): (string | null)[] {
	return node.ancestorIds.map((id) => nodeById.get(id)?.title ?? null);
}

/**
 * Whose project this is, from the root — `[]` while the root is still being
 * read, which is the frame every descendant's detail screen opens on.
 */
export function effectiveParticipants(root: Node | null): string[] {
	return root === null ? [] : [...root.participantIds];
}

/** The place a card answers to: which one, and its own path in the place tree. */
export interface EffectiveLocation {
	locationId: string;
	/** The place's stored path — what an "in or under" roll-up reads. */
	locationAncestorIds: string[];
}

/**
 * The place a card answers to (#290): its own, or the nearest one an ancestor
 * passes down — labels' rule, applied to locations.
 *
 * `ancestors` is the trail root-first, as `useAncestors` hands it out; a crumb
 * it could not resolve is `null`, and a place it may have carried is unknown —
 * the trail reads as one without, the same neutral answer the crumb renders.
 * Derived at read time, never written down the tree: filing the project in
 * another room moves every card under it, and a card that was never filed
 * keeps no stale copy of a place it only borrowed.
 */
export function effectiveLocation(
	node: Node,
	ancestors: readonly (Node | null)[],
): EffectiveLocation | null {
	if (node.locationId !== null) {
		return {
			locationId: node.locationId,
			locationAncestorIds: node.locationAncestorIds,
		};
	}
	for (let index = ancestors.length - 1; index >= 0; index -= 1) {
		const ancestor = ancestors[index];
		if (ancestor !== null && ancestor.locationId !== null) {
			return {
				locationId: ancestor.locationId,
				locationAncestorIds: ancestor.locationAncestorIds,
			};
		}
	}
	return null;
}

/**
 * The nearest place an ancestor trail passes down (#290), the card's own field
 * never counting — what a card face shows when it carries no place of its own
 * (#296). A crumb the trail cannot resolve contributes nothing, the same
 * neutral answer `effectiveLocation` gives it.
 */
export function inheritedLocation(
	ancestors: readonly (Node | null)[],
): string | null {
	for (let index = ancestors.length - 1; index >= 0; index -= 1) {
		const ancestor = ancestors[index];
		if (ancestor !== null && ancestor.locationId !== null) {
			return ancestor.locationId;
		}
	}
	return null;
}

/**
 * Who may be given a step in this project: its participants, or everyone in the
 * home when it has none — the common case, and one with no friction at all.
 *
 * Not a stylistic restriction. A board hides a card whose participants exclude
 * you, so assigning somebody a step inside a project they are not a participant
 * of hands them work that is hidden from their board and reachable from nowhere.
 * Adding them to the project is what makes the task findable.
 */
export function assignableMembers<T extends { uid: string }>(
	root: Node | null,
	members: readonly T[],
): T[] {
	const participants = effectiveParticipants(root);
	if (participants.length === 0) return [...members];
	return members.filter((member) => participants.includes(member.uid));
}

/**
 * Assignees who are no longer in the assignable set — somebody dropped from the
 * project after being given a step, or a member who has left the home entirely.
 *
 * A real state, and deliberately **shown rather than hidden**: it is
 * information, and drawing it as an orphaned checked box outside its own list is
 * what would make it read as a bug.
 *
 * Takes the assignable set rather than `(node, root, members)` so that the two
 * halves of the derivation compose — the caller already has the set, because it
 * is what the checkboxes are drawn from.
 */
export function staleAssignees(
	node: Node,
	assignable: readonly { uid: string }[],
): string[] {
	return node.assigneeIds.filter(
		(uid) => !assignable.some((member) => member.uid === uid),
	);
}

/**
 * Whether a board hides this card by default.
 *
 * Hidden, never denied, and always one toggle away — a display preference, not a
 * permission. "I want to add my personal projects to the list, but it does not
 * make sense that my spouse sees them by default, and they should still be able
 * to see them" is the requirement, and a rule cannot express "hidden but
 * readable".
 *
 * Uniform at every depth, and it *bites* only where participants exist, which is
 * roots: a shared descendant carries `[]` and is never hidden, and a private
 * descendant carries the root's participants, which include me or I could not
 * have read it at all.
 */
export function hiddenByParticipants(node: Node, uid: string): boolean {
	return node.participantIds.length > 0 && !node.participantIds.includes(uid);
}

/** One document of a visibility flip, as the fields that write changes. */
export interface VisibilityWrite {
	id: string;
	visibility: Visibility;
	participantIds: string[];
}

/**
 * The documents a visibility flip has to write, **in depth order**, with the
 * ones already at the target dropped.
 *
 * Uniform visibility means every descendant physically carries the same
 * `visibility` value — board Q1 filters on it directly, so it cannot be derived
 * — and the *n* writes cannot be one batch: a rule's `get()` reads committed
 * state, so a child written to the new visibility while its parent still holds
 * the old one fails `inheritsFrom`. Top-down, one document at a time, in both
 * directions.
 *
 * Dropping the already-correct documents is what makes an interrupted flip
 * **resumable rather than repeated**: re-running it finishes the job.
 *
 * Going private, every document takes the root's participants plus the actor —
 * `allow update` requires `visibleToMe(request.resource.data)`, so writing
 * yourself out is refused, and the answer is to write yourself in rather than to
 * defend against a lockout that cannot happen. Going shared, the root *keeps* its
 * list, which becomes "whose project" again, and descendants drop to `[]`.
 *
 * `desired` is what the root's participants should *become*, and it defaults to
 * what they already are. It is a separate argument rather than a doctored `root`
 * because `root` is also what every skip is measured against: handing in a copy
 * carrying the new list would make the root look already-correct and drop it from
 * its own plan — which is exactly what changing who is in on an *already private*
 * project does, where the visibility is not moving and the participants are the
 * only thing that is.
 */
export function flipPlan(
	root: Node,
	descendants: readonly Node[],
	target: Visibility,
	uid: string,
	desired: readonly string[] = root.participantIds,
): VisibilityWrite[] {
	const participants =
		target === "private"
			? [uid, ...desired.filter((id) => id !== uid)]
			: [...desired];

	const ordered = [root, ...descendants.filter((node) => node.id !== root.id)]
		.slice()
		.sort(
			(a, b) =>
				a.ancestorIds.length - b.ancestorIds.length ||
				(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
		);

	const plan: VisibilityWrite[] = [];
	for (const node of ordered) {
		const wanted =
			node.id === root.id
				? participants
				: target === "private"
					? participants
					: [];

		if (node.visibility === target && sameIds(node.participantIds, wanted)) {
			continue;
		}
		plan.push({ id: node.id, visibility: target, participantIds: wanted });
	}
	return plan;
}

/** Set equality, which is what the rules and the read rule both go by. */
function sameIds(
	current: readonly string[],
	wanted: readonly string[],
): boolean {
	return (
		current.length === wanted.length &&
		wanted.every((id) => current.includes(id))
	);
}

/*
 * ---------------------------------------------------------------------------
 * Creating
 * ---------------------------------------------------------------------------
 */

/**
 * What a create writes, minus the fields only the server can fill:
 * `createdAt`, `updatedAt`, `createdBy` and `completedAt` are `data/nodes.ts`'s,
 * because they are `serverTimestamp()` sentinels and the uid of the caller.
 *
 * Every other field is written, with a value, on every create. Firestore does
 * not index an absent field, so `where('archived', '==', false)` silently skips
 * every document written before `archived` existed: adding a *queried* field
 * later is a backfill, not a schema change.
 */
export type NodeData = Omit<
	Node,
	"id" | "completedAt" | "createdAt" | "createdBy" | "updatedAt"
>;

export interface NewNodeInput {
	title: string;
	/** From `rankAtEnd()` or `rankBetween()`, against the target column. */
	rank: string;
	/** The board this is created on, or null for the root board. */
	parent?: Node | null;
	status?: Status;
	/** Honoured only at the root; a child always takes its parent's. */
	visibility?: Visibility;
	/**
	 * Added to whatever the parent's privacy already requires. On a **root** the
	 * rules refuse an empty list, so a caller creating one passes whose project
	 * it is — every member, for a shared project made on the root board.
	 * `createNode` falls back to the author rather than writing a list the rules
	 * would refuse.
	 */
	participantIds?: readonly string[];
	/** Who is doing it. Inherited from nothing — a step is not the project. */
	assigneeIds?: readonly string[];
	locationId?: string | null;
	locationAncestorIds?: readonly string[];
	dueDate?: string | null;
	priority?: Priority | null;
	effort?: Effort | null;
	notes?: string;
}

/**
 * A new node, with everything it inherits already resolved.
 *
 * The two subtree invariants are upheld by *construction* here: `visibility` is
 * taken from the parent whenever there is one — the caller's is honoured only
 * at the root — and a child of a private parent starts with that parent's
 * participants. A caller that got either wrong would be refused by the rules,
 * which is the right backstop but a poor first line.
 *
 * A location is *not* taken from the parent, not even when the caller is
 * silent (#290): inheritance is derived at read time by `effectiveLocation`,
 * so a card's own field stays empty until somebody files *it* somewhere —
 * and moving the parent's place moves every card under it. A caller that
 * names a place still files the new node itself, the way the REST API does.
 */
export function newNodeData(input: NewNodeInput): NodeData {
	const parent = input.parent ?? null;
	const inherited =
		parent?.visibility === "private" ? parent.participantIds : [];
	const participantIds = [...inherited];
	for (const uid of input.participantIds ?? []) {
		if (!participantIds.includes(uid)) participantIds.push(uid);
	}

	const ancestorIds = childAncestorIds(parent);

	const location = {
		locationId: input.locationId ?? null,
		locationAncestorIds: [...(input.locationAncestorIds ?? [])],
	};

	return {
		title: input.title.trim(),
		status: input.status ?? "backlog",
		rank: input.rank,
		parentId: parent?.id ?? null,
		ancestorIds,
		...location,
		participantIds,
		// Deliberately not inherited: a project two people share does not make
		// every step inside it a job they are both doing.
		assigneeIds: [...(input.assigneeIds ?? [])],
		visibility: parent?.visibility ?? input.visibility ?? "shared",
		columns: [...defaultColumns],
		// A new node has nothing under it yet. The caller cannot set these: they
		// belong to the structural writes in `data/nodes.ts`, which move them with
		// `increment()`.
		childCount: 0,
		doneCount: 0,
		dueDate: input.dueDate ?? null,
		priority: input.priority ?? null,
		blockedBy: [],
		// Written from the first document, and only ever changed by an update:
		// applying a label is an edit to an existing card, not a creation input.
		labelIds: [],
		notes: input.notes ?? "",
		checklist: [],
		effort: input.effort ?? null,
		attachments: [],
		attachmentCount: 0,
		attachmentDisplay: "count",
		heroAttachmentId: null,
		archived: false,
		// The client is the only caller, and the rules refuse any other value from
		// one. A node the API wrote is assembled in `functions/`, which is outside
		// the rules and writes `'api'` itself.
		createdVia: "app",
	};
}

/*
 * ---------------------------------------------------------------------------
 * Reading
 * ---------------------------------------------------------------------------
 */

function stringOr(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

function oneOfOrNull<T extends string>(
	value: unknown,
	allowed: readonly T[],
): T | null {
	return allowed.includes(value as T) ? (value as T) : null;
}

/**
 * A stored status, with the three #99 retired first.
 *
 * `oneOf` alone would send a `research` card to `backlog`, which is the one
 * coercion here that loses a fact — the card was in flight, and To do says it
 * never started.
 *
 * `Object.hasOwn`, not `in`: `in` walks the prototype chain, so a document
 * storing `"constructor"` or `"toString"` would hand the board a *function*
 * where a status belongs — past every guard the rest of this file exists to be.
 */
function storedStatus(value: unknown): Status {
	if (typeof value === "string" && Object.hasOwn(retiredStatuses, value)) {
		return retiredStatuses[value];
	}
	return oneOf(value, statuses, "backlog");
}

/**
 * A stored counter, clamped.
 *
 * The rules check `is int` and nothing more — bounding them there would fail a
 * *delete* on an offline race — so the clamp lives on the read side, where the
 * worst a wrong value can do is draw a chevron.
 */
function counter(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.trunc(value));
}

function checklistItems(value: unknown): ChecklistItem[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => ({
		id: stringOr(item?.id, ""),
		text: stringOr(item?.text, ""),
		done: item?.done === true,
	}));
}

/**
 * The stored column set, falling back to the default.
 *
 * `columns` arrived after the document did, so a node written by #74 does not
 * carry one — and a board with no columns renders nothing at all, which is the
 * one coercion here that would hide real cards. Unknown values are dropped
 * rather than rendered as a column nothing can ever be moved to, which is what
 * turns a set frozen before #99 into the four that survived it.
 */
function columnSet(value: unknown): Status[] {
	const stored = Array.isArray(value)
		? value.filter((item): item is Status => statuses.includes(item as Status))
		: [];
	return stored.length > 0 ? stored : [...defaultColumns];
}

function attachmentList(value: unknown): Attachment[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => ({
		id: stringOr(item?.id, ""),
		path: stringOr(item?.path, ""),
		name: stringOr(item?.name, ""),
		contentType: stringOr(item?.contentType, ""),
		size: counter(item?.size),
		uploadedAt: item?.uploadedAt ?? null,
		uploadedBy: stringOr(item?.uploadedBy, ""),
	}));
}

/**
 * A stored document, read defensively.
 *
 * Every field is written on create, so in practice nothing here is missing —
 * but a document from the REST API (#7), from a seeded fixture, or from a
 * version of the app that predates a field, still has to render rather than
 * crash a board. `visibility` is the one coercion that is *not* cosmetic: it
 * falls back to `'shared'`, which is what an unreadable-by-anyone document
 * would already have been denied for.
 */
export function toNode(snapshot: QueryDocumentSnapshot<DocumentData>): Node {
	const data = snapshot.data();
	const ancestorIds = strings(data.ancestorIds);

	return {
		id: snapshot.id,
		title: stringOr(data.title, ""),
		status: storedStatus(data.status),
		rank: stringOr(data.rank, ""),
		parentId: stringOrNull(data.parentId),
		ancestorIds,
		locationId: stringOrNull(data.locationId),
		locationAncestorIds: strings(data.locationAncestorIds),
		participantIds: strings(data.participantIds),
		// A document written before this field existed reads as `[]`, and needs no
		// backfill — the absent-field trap bites a field a query matches
		// *negatively*, and `array-contains` matches neither an absent field nor
		// an empty array. A card written before #61 has no assignees either way.
		assigneeIds: strings(data.assigneeIds),
		visibility: data.visibility === "private" ? "private" : "shared",
		columns: columnSet(data.columns),
		childCount: counter(data.childCount),
		doneCount: counter(data.doneCount),
		dueDate: stringOrNull(data.dueDate),
		priority: oneOfOrNull(data.priority, priorities),
		blockedBy: strings(data.blockedBy),
		// Absent on every node written before #100, and needing no backfill —
		// nothing queries it, and the card that carries a stale id still renders.
		labelIds: strings(data.labelIds),
		notes: stringOr(data.notes, ""),
		checklist: checklistItems(data.checklist),
		effort: oneOfOrNull(data.effort, efforts),
		attachments: attachmentList(data.attachments),
		attachmentCount: counter(data.attachmentCount),
		attachmentDisplay: oneOf(
			data.attachmentDisplay,
			attachmentDisplays,
			"count",
		),
		heroAttachmentId: stringOrNull(data.heroAttachmentId),
		archived: data.archived === true,
		// Absent on every node written before the REST API, and absent is exactly
		// what `'app'` means. No backfill: nothing queries this field.
		createdVia: data.createdVia === "api" ? "api" : "app",
		completedAt: data.completedAt ?? null,
		createdAt: data.createdAt ?? null,
		createdBy: stringOr(data.createdBy, ""),
		updatedAt: data.updatedAt ?? null,
	};
}
