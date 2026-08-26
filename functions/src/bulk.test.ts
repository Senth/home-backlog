import {
	type BulkContext,
	maxBulkNodes,
	parseBulkBody,
	planBulk,
} from "./bulk.js";
import type { ApiError } from "./errors.js";
import type { ParentFacts } from "./validate.js";

const ME = "uidMarcus";
const MEMBERS = ["uidMarcus", "uidAnna"];
const now = new Date("2026-01-01T00:00:00Z");

function refusal(run: () => unknown): ApiError {
	try {
		run();
	} catch (error) {
		return error as ApiError;
	}
	throw new Error("Expected this payload to be refused.");
}

function parentFacts(overrides: Partial<ParentFacts> = {}): ParentFacts {
	return {
		id: "project",
		visibility: "shared",
		participantIds: [],
		columns: ["backlog", "execution", "done"],
		ancestorIds: [],
		...overrides,
	};
}

function plan(
	body: unknown,
	options: {
		parent?: ParentFacts | null;
		rootRank?: string;
		memberUids?: readonly string[];
	} = {},
) {
	const payload = parseBulkBody(body);
	const context: BulkContext = {
		payload,
		idFor: Object.fromEntries(
			payload.nodes.map((node) => [node.ref, `id-${node.ref}`]),
		),
		parent: options.parent ?? null,
		rootRank: options.rootRank ?? "a0",
		createdBy: ME,
		memberUids: options.memberUids ?? MEMBERS,
		now,
	};
	return planBulk(context);
}

function itemFor(result: ReturnType<typeof plan>, ref: string) {
	const item = result.items.find((candidate) => candidate.ref === ref);
	if (!item) throw new Error(`No item for ref ${ref}`);
	return item.data;
}

const tree = {
	nodes: [
		{ ref: "root", title: "Re-roof the shed" },
		{ ref: "buy", parentRef: "root", title: "Buy brackets" },
		{ ref: "book", parentRef: "root", title: "Book the skip" },
		{ ref: "prices", parentRef: "buy", title: "Compare prices" },
	],
};

describe("a planned subtree", () => {
	it("returns a ref-to-id map and the new root", () => {
		const result = plan(tree);

		expect(result.rootId).toBe("id-root");
		expect(result.ids).toEqual({
			root: "id-root",
			buy: "id-buy",
			book: "id-book",
			prices: "id-prices",
		});
		expect(result.items).toHaveLength(4);
	});

	it("writes parents before children, so a batch is applied in tree order", () => {
		expect(plan(tree).items.map((item) => item.ref)).toEqual([
			"root",
			"buy",
			"book",
			"prices",
		]);
	});

	it("derives every path from the refs", () => {
		const result = plan(tree);

		expect(itemFor(result, "root")).toMatchObject({
			parentId: null,
			ancestorIds: [],
		});
		expect(itemFor(result, "buy")).toMatchObject({
			parentId: "id-root",
			ancestorIds: ["id-root"],
		});
		expect(itemFor(result, "prices")).toMatchObject({
			parentId: "id-buy",
			ancestorIds: ["id-root", "id-buy"],
		});
	});

	it("attaches under an existing node when the request names one", () => {
		const result = plan(tree, {
			parent: parentFacts({ id: "existing", ancestorIds: ["grandparent"] }),
		});

		expect(itemFor(result, "root")).toMatchObject({
			parentId: "existing",
			ancestorIds: ["grandparent", "existing"],
		});
		expect(itemFor(result, "buy")).toMatchObject({
			ancestorIds: ["grandparent", "existing", "id-root"],
		});
	});

	/**
	 * Taken from the default at creation and then frozen. The default stopped
	 * depending on depth with #99, so a subtree the API writes reads the same at
	 * every level of it.
	 */
	it("freezes the same column set on every node it writes", () => {
		const result = plan(tree);

		for (const item of result.items) {
			expect(item.data.columns).toEqual([
				"backlog",
				"next_up",
				"execution",
				"done",
			]);
		}
	});

	it("marks every node as written by an agent", () => {
		for (const item of plan(tree).items) {
			expect(item.data.createdVia).toBe("api");
			expect(item.data.createdBy).toBe(ME);
		}
	});

	/**
	 * Computed by the endpoint, never taken from the body: the payload is the only
	 * thing that knows how many children each node has, and the request body
	 * cannot say — `childCount` is not on the allow-list.
	 */
	it("counts each node's children from the payload itself", () => {
		const result = plan({
			nodes: [
				{ ref: "root", title: "Root" },
				{ ref: "a", parentRef: "root", title: "A", status: "done" },
				{ ref: "b", parentRef: "root", title: "B" },
				{ ref: "c", parentRef: "a", title: "C" },
			],
		});

		expect(itemFor(result, "root")).toMatchObject({
			childCount: 2,
			doneCount: 1,
		});
		expect(itemFor(result, "a")).toMatchObject({ childCount: 1, doneCount: 0 });
		expect(itemFor(result, "b")).toMatchObject({ childCount: 0, doneCount: 0 });
	});

	it("keeps a node created straight into done in step with its date", () => {
		const result = plan({
			nodes: [
				{ ref: "root", title: "Root" },
				{ ref: "a", parentRef: "root", title: "A", status: "done" },
			],
		});

		expect(itemFor(result, "a").completedAt).toBe(now);
		expect(itemFor(result, "root").completedAt).toBeNull();
	});
});

/**
 * Array order is the only ordering a payload expresses, and one `rankSequence`
 * per column rather than a fold: generating them pairwise grows a character per
 * item.
 */
describe("ranks", () => {
	it("follows the caller's order within a column", () => {
		const result = plan({
			nodes: [
				{ ref: "root", title: "Root" },
				{ ref: "first", parentRef: "root", title: "First" },
				{ ref: "second", parentRef: "root", title: "Second" },
				{ ref: "third", parentRef: "root", title: "Third" },
			],
		});

		const ranks = ["first", "second", "third"].map(
			(ref) => itemFor(result, ref).rank as string,
		);

		expect([...ranks].sort()).toEqual(ranks);
	});

	it("ranks each column separately", () => {
		const result = plan({
			nodes: [
				{ ref: "root", title: "Root" },
				{ ref: "todo", parentRef: "root", title: "To do" },
				{ ref: "done", parentRef: "root", title: "Done", status: "done" },
			],
		});

		// A rank orders a node within its `(parentId, status)` column, so two cards
		// in different columns starting at the same key is correct, not a clash.
		expect(itemFor(result, "todo").rank).toBe(itemFor(result, "done").rank);
	});

	it("gives the root the rank the handler computed for its column", () => {
		expect(itemFor(plan(tree, { rootRank: "a7" }), "root").rank).toBe("a7");
	});
});

describe("privacy", () => {
	it("makes a private root's creator its only participant", () => {
		const result = plan({
			nodes: [
				{ ref: "root", title: "Surprise", visibility: "private" },
				{ ref: "step", parentRef: "root", title: "Step" },
			],
		});

		expect(itemFor(result, "root")).toMatchObject({
			visibility: "private",
			participantIds: [ME],
		});
	});

	/**
	 * What makes "I am a participant of every descendant of a private node I can
	 * read" true, and so makes the private subtree query complete. A descendant
	 * missing one of its parent's participants is invisible to that person, whose
	 * delete then leaves it behind.
	 */
	it("carries a private parent's participants all the way down", () => {
		const result = plan(tree, {
			parent: parentFacts({
				visibility: "private",
				participantIds: [ME, "uidIngrid"],
				columns: ["backlog", "execution", "done"],
			}),
		});

		for (const item of result.items) {
			expect(item.data.visibility).toBe("private");
			expect(item.data.participantIds).toEqual([ME, "uidIngrid"]);
		}
	});

	it("gives a shared root every member, and leaves the subtree under it empty", () => {
		// `[]` on a root is refused by the rules since #102, and a bulk-written
		// one would be frozen against every later update. Descendants keep `[]`:
		// the hide filter is uniform at every depth.
		const result = plan(tree);
		expect(itemFor(result, "root").participantIds).toEqual(MEMBERS);
		for (const item of result.items.filter(
			(candidate) => candidate.ref !== "root",
		)) {
			expect(item.data.participantIds).toEqual([]);
		}
	});

	it("leaves every participant list empty when the subtree attaches under a shared parent", () => {
		// Then the payload's root is a child, not a root, and takes `[]` like any
		// other shared descendant.
		for (const item of plan(tree, { parent: parentFacts({}) }).items) {
			expect(item.data.participantIds).toEqual([]);
		}
	});

	it("takes the uids the root names, when it names some", () => {
		expect(
			itemFor(
				plan({
					nodes: [{ ref: "root", title: "Root", participantIds: ["uidAnna"] }],
				}),
				"root",
			).participantIds,
		).toEqual(["uidAnna"]);
	});

	it("refuses a root naming somebody who is not a member", () => {
		const error = refusal(() =>
			plan({
				nodes: [
					{ ref: "root", title: "Root", participantIds: ["uidStranger"] },
				],
			}),
		);
		expect(error?.details?.[0].code).toBe("participants_invalid");
	});

	it("refuses a payload root naming participants when it attaches under a private parent", () => {
		// Then it is a child, and a child takes its parent's list whatever it says.
		const error = refusal(() =>
			plan(
				{
					nodes: [{ ref: "root", title: "Root", participantIds: ["uidAnna"] }],
				},
				{ parent: parentFacts({ visibility: "private" }) },
			),
		);
		expect(error?.details?.[0].code).toBe("participants_immutable");
		expect(error?.details?.[0].index).toBe(0);
	});

	it("refuses an empty list on a payload root, at that root's index", () => {
		// `asStringList` accepts `[]`, so this parses and has to be caught here —
		// and it is refused the way every other bulk refusal is, with an index.
		const error = refusal(() =>
			plan({ nodes: [{ ref: "root", title: "Root", participantIds: [] }] }),
		);
		expect(error?.details?.[0].code).toBe("participants_required");
		expect(error?.details?.[0].index).toBe(0);
	});

	it("refuses a node below the root naming participants of its own", () => {
		const error = refusal(() =>
			plan({
				nodes: [
					{ ref: "root", title: "Root" },
					{
						ref: "step",
						parentRef: "root",
						title: "Step",
						participantIds: ["uidAnna"],
					},
				],
			}),
		);
		expect(error?.details?.[0].code).toBe("participants_immutable");
	});

	it("refuses a node below the root declaring its own visibility", () => {
		const error = refusal(() =>
			plan({
				nodes: [
					{ ref: "root", title: "Root" },
					{
						ref: "step",
						parentRef: "root",
						title: "Step",
						visibility: "private",
					},
				],
			}),
		);

		expect(error.code).toBe("visibility_mismatch");
		expect(error.details?.[0].index).toBe(1);
	});
});

/**
 * One call is one new root. That is what makes an agent run undoable: one run,
 * one root, one delete, one confirmation dialog. A forest payload would leave
 * somebody deleting each root by hand, online-only, one confirmation each.
 */
describe("one root", () => {
	it("refuses a forest", () => {
		const error = refusal(() =>
			plan({
				nodes: [
					{ ref: "one", title: "One" },
					{ ref: "two", title: "Two" },
				],
			}),
		);

		expect(error.code).toBe("not_one_root");
		expect(error.details?.map((detail) => detail.index)).toEqual([0, 1]);
	});

	it("refuses a payload whose refs form a cycle with no root at all", () => {
		expect(
			refusal(() =>
				plan({
					nodes: [
						{ ref: "a", parentRef: "b", title: "A" },
						{ ref: "b", parentRef: "a", title: "B" },
					],
				}),
			).code,
		).toBe("no_root");
	});

	// A cycle hanging off a valid root would otherwise commit as documents
	// unreachable from every board and every breadcrumb.
	it("refuses nodes that are unreachable from the root", () => {
		const error = refusal(() =>
			plan({
				nodes: [
					{ ref: "root", title: "Root" },
					{ ref: "a", parentRef: "b", title: "A" },
					{ ref: "b", parentRef: "a", title: "B" },
				],
			}),
		);

		expect(error.code).toBe("cycle");
		expect(error.details?.map((detail) => detail.index)).toEqual([1, 2]);
	});
});

describe("refs", () => {
	it("refuses two nodes sharing one", () => {
		const error = refusal(() =>
			plan({
				nodes: [
					{ ref: "root", title: "Root" },
					{ ref: "same", parentRef: "root", title: "A" },
					{ ref: "same", parentRef: "root", title: "B" },
				],
			}),
		);

		expect(error.code).toBe("duplicate_ref");
		expect(error.details?.[0].index).toBe(2);
	});

	it("refuses a node with no ref", () => {
		expect(refusal(() => plan({ nodes: [{ title: "Root" }] })).code).toBe(
			"ref_required",
		);
	});

	it("refuses a parentRef that names nothing in the payload", () => {
		const error = refusal(() =>
			plan({
				nodes: [
					{ ref: "root", title: "Root" },
					{ ref: "step", parentRef: "elsewhere", title: "Step" },
				],
			}),
		);

		expect(error.code).toBe("unknown_parent_ref");
		expect(error.message).toContain("parentId");
	});

	// Structure inside a payload is refs. A node naming a real id as its parent
	// would be a second root wearing a disguise.
	it("refuses parentId on a node inside the payload", () => {
		expect(
			refusal(() =>
				plan({
					nodes: [
						{ ref: "root", title: "Root" },
						{ ref: "step", parentId: "real-id", title: "Step" },
					],
				}),
			).code,
		).toBe("parent_id_in_bulk");
	});
});

/**
 * Validated in full before anything is written, so the caller gets every failure
 * at once and can fix and resend. Partial success was rejected: every one of
 * these is decidable before the write, and what it would buy instead is the
 * orphan.
 */
describe("per-index errors", () => {
	it("reports every bad node in one answer", () => {
		const error = refusal(() =>
			plan({
				nodes: [
					{ ref: "root", title: "Root" },
					{ ref: "a", parentRef: "root", title: "" },
					{ ref: "b", parentRef: "root", title: "x".repeat(201) },
				],
			}),
		);

		expect(error.status).toBe(400);
		expect(error.details).toHaveLength(2);
		expect(error.details?.map((detail) => detail.index)).toEqual([1, 2]);
		expect(error.details?.map((detail) => detail.code)).toEqual([
			"title_required",
			"title_too_long",
		]);
	});

	it("points a node's own field refusal at its position", () => {
		const error = refusal(() =>
			plan({
				nodes: [
					{ ref: "root", title: "Root" },
					{ ref: "a", parentRef: "root", title: "A", locationId: "loc-1" },
				],
			}),
		);

		expect(error.details?.[0]).toMatchObject({
			index: 1,
			code: "locations_unavailable",
		});
	});

	// Stricter than the rules on purpose: an agent has no eyes on the board it is
	// writing to, and a card in a column the board does not draw has a one-way
	// exit.
	it("refuses a status the board it lands on does not show", () => {
		// The existing parent's set was frozen before #99 and has no Next up, so
		// `next_up` is refused directly under it. Every node the payload creates
		// gets the current default, where `next_up` is fine again.
		const error = refusal(() =>
			plan(
				{
					nodes: [
						{ ref: "root", title: "Root", status: "next_up" },
						{ ref: "a", parentRef: "root", title: "A", status: "next_up" },
					],
				},
				{ parent: parentFacts({ columns: ["backlog", "execution", "done"] }) },
			),
		);

		expect(error.code).toBe("status_not_in_columns");
		expect(error.details).toHaveLength(1);
		expect(error.details?.[0].index).toBe(0);
	});
});

describe("the payload's size", () => {
	it("refuses an empty one", () => {
		expect(refusal(() => plan({ nodes: [] })).code).toBe("empty_payload");
	});

	it("refuses a list that is not a list", () => {
		expect(refusal(() => plan({ nodes: "one" })).code).toBe("invalid_type");
	});

	/**
	 * A Firestore batch commits 500 writes, and two are spoken for: the attach
	 * parent's counters and the replay record. A payload that will not fit is
	 * refused rather than half-written.
	 */
	it("refuses more nodes than one atomic batch can hold", () => {
		const nodes = [
			{ ref: "root", title: "Root" },
			...Array.from({ length: maxBulkNodes }, (_value, index) => ({
				ref: `n${index}`,
				parentRef: "root",
				title: `Step ${index}`,
			})),
		];

		expect(refusal(() => plan({ nodes })).code).toBe("too_many_nodes");
	});

	it("accepts a payload right at the limit", () => {
		const nodes = [
			{ ref: "root", title: "Root" },
			...Array.from({ length: maxBulkNodes - 1 }, (_value, index) => ({
				ref: `n${index}`,
				parentRef: "root",
				title: `Step ${index}`,
			})),
		];

		expect(plan({ nodes }).items).toHaveLength(maxBulkNodes);
	});
});
