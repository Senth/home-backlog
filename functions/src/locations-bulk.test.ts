import type { ApiError } from "./errors.js";
import {
	type BulkLocationsContext,
	maxBulkLocations,
	parseBulkLocationsBody,
	planBulkLocations,
} from "./locations-bulk.js";

const ME = "uidMarcus";
const now = new Date("2026-01-01T00:00:00Z");

function refusal(run: () => unknown): ApiError {
	try {
		run();
	} catch (error) {
		return error as ApiError;
	}
	throw new Error("Expected this payload to be refused.");
}

function plan(
	body: unknown,
	options: {
		parent?: { id: string; ancestorIds: string[] } | null;
		rootRank?: string;
	} = {},
) {
	const payload = parseBulkLocationsBody(body);
	const context: BulkLocationsContext = {
		payload,
		idFor: Object.fromEntries(
			payload.locations.map((location) => [location.ref, `id-${location.ref}`]),
		),
		parent: options.parent ?? null,
		rootRank: options.rootRank ?? "a0",
		createdBy: ME,
		now,
	};
	return planBulkLocations(context);
}

function itemFor(result: ReturnType<typeof plan>, ref: string) {
	const item = result.items.find((candidate) => candidate.ref === ref);
	if (!item) throw new Error(`No item for ref ${ref}`);
	return item.data;
}

const tree = {
	locations: [
		{ ref: "garden", title: "Garden" },
		{ ref: "shed", parentRef: "garden", title: "The shed" },
		{ ref: "cellar", parentRef: "garden", title: "The cellar" },
		{ ref: "bench", parentRef: "shed", title: "The workbench" },
	],
};

describe("a planned place tree", () => {
	it("returns a ref-to-id map and the new root", () => {
		const result = plan(tree);

		expect(result.rootId).toBe("id-garden");
		expect(result.ids).toEqual({
			garden: "id-garden",
			shed: "id-shed",
			cellar: "id-cellar",
			bench: "id-bench",
		});
		expect(result.items).toHaveLength(4);
	});

	it("writes parents before children, so a batch is applied in tree order", () => {
		expect(plan(tree).items.map((item) => item.ref)).toEqual([
			"garden",
			"shed",
			"cellar",
			"bench",
		]);
	});

	it("derives every path from the refs", () => {
		const result = plan(tree);

		expect(itemFor(result, "garden")).toMatchObject({
			parentId: null,
			ancestorIds: [],
		});
		expect(itemFor(result, "shed")).toMatchObject({
			parentId: "id-garden",
			ancestorIds: ["id-garden"],
		});
		expect(itemFor(result, "bench")).toMatchObject({
			parentId: "id-shed",
			ancestorIds: ["id-garden", "id-shed"],
		});
	});

	it("attaches under an existing place when the request names one", () => {
		const result = plan(tree, {
			parent: { id: "existing", ancestorIds: ["grandparent"] },
		});

		expect(itemFor(result, "garden")).toMatchObject({
			parentId: "existing",
			ancestorIds: ["grandparent", "existing"],
		});
		expect(itemFor(result, "bench")).toMatchObject({
			ancestorIds: ["grandparent", "existing", "id-garden", "id-shed"],
		});
	});

	it("marks every place as written by an agent", () => {
		for (const item of plan(tree).items) {
			expect(item.data.createdBy).toBe(ME);
		}
	});
});

describe("ranks", () => {
	it("follows the caller's order under a parent", () => {
		const result = plan(tree);

		const ranks = ["shed", "cellar"].map(
			(ref) => itemFor(result, ref).rank as string,
		);
		expect([...ranks].sort()).toEqual(ranks);
	});

	it("gives the root the rank the handler computed for its siblings", () => {
		expect(itemFor(plan(tree, { rootRank: "a7" }), "garden").rank).toBe("a7");
	});
});

describe("one root", () => {
	it("refuses a forest", () => {
		const error = refusal(() =>
			plan({
				locations: [
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
					locations: [
						{ ref: "a", parentRef: "b", title: "A" },
						{ ref: "b", parentRef: "a", title: "B" },
					],
				}),
			).code,
		).toBe("no_root");
	});

	it("refuses places that are unreachable from the root", () => {
		const error = refusal(() =>
			plan({
				locations: [
					{ ref: "garden", title: "Garden" },
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
	it("refuses two places sharing one", () => {
		const error = refusal(() =>
			plan({
				locations: [
					{ ref: "garden", title: "Garden" },
					{ ref: "same", parentRef: "garden", title: "A" },
					{ ref: "same", parentRef: "garden", title: "B" },
				],
			}),
		);

		expect(error.code).toBe("duplicate_ref");
		expect(error.details?.[0].index).toBe(2);
	});

	it("refuses a place with no ref", () => {
		expect(refusal(() => plan({ locations: [{ title: "Garden" }] })).code).toBe(
			"ref_required",
		);
	});

	it("refuses a parentRef that names nothing in the payload", () => {
		const error = refusal(() =>
			plan({
				locations: [
					{ ref: "garden", title: "Garden" },
					{ ref: "shed", parentRef: "elsewhere", title: "The shed" },
				],
			}),
		);

		expect(error.code).toBe("unknown_parent_ref");
		expect(error.message).toContain("parentId");
	});

	it("refuses parentId on a place inside the payload", () => {
		expect(
			refusal(() =>
				plan({
					locations: [
						{ ref: "garden", title: "Garden" },
						{ ref: "shed", parentId: "real-id", title: "The shed" },
					],
				}),
			).code,
		).toBe("parent_id_in_bulk");
	});
});

/**
 * List order is the only ordering a payload expresses, so `rank` is not a field
 * a bulk entry carries — a place sent with one is refused rather than silently
 * re-ordered.
 */
describe("rank inside a payload", () => {
	it("is refused, at its index", () => {
		const error = refusal(() =>
			plan({
				locations: [
					{ ref: "garden", title: "Garden" },
					{ ref: "shed", parentRef: "garden", title: "The shed", rank: "a0" },
				],
			}),
		);

		expect(error.details?.[0]).toMatchObject({
			index: 1,
			field: "rank",
			code: "unknown_field",
		});
	});
});

describe("per-index errors", () => {
	it("reports every bad place in one answer", () => {
		const error = refusal(() =>
			plan({
				locations: [
					{ ref: "garden", title: "Garden" },
					{ ref: "a", parentRef: "garden", title: "" },
					{ ref: "b", parentRef: "garden", title: "x".repeat(201) },
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

	it("refuses a title that is not a string, at its index", () => {
		const error = refusal(() =>
			plan({ locations: [{ ref: "garden", title: 7 }] }),
		);

		expect(error.details?.[0]).toMatchObject({
			index: 0,
			field: "title",
			code: "invalid_type",
		});
	});

	it("refuses an unknown field, at its index", () => {
		const error = refusal(() =>
			plan({
				locations: [
					{ ref: "garden", title: "Garden" },
					{ ref: "shed", parentRef: "garden", title: "The shed", icon: "home" },
				],
			}),
		);

		expect(error.details?.[0]).toMatchObject({
			index: 1,
			field: "icon",
			code: "unknown_field",
		});
	});
});

describe("the payload's size", () => {
	it("refuses an empty one", () => {
		expect(refusal(() => plan({ locations: [] })).code).toBe("empty_payload");
	});

	it("refuses a list that is not a list", () => {
		expect(refusal(() => plan({ locations: "one" })).code).toBe("invalid_type");
	});

	it("refuses more places than one atomic batch can hold", () => {
		const locations = [
			{ ref: "garden", title: "Garden" },
			...Array.from({ length: maxBulkLocations }, (_value, index) => ({
				ref: `p${index}`,
				parentRef: "garden",
				title: `Place ${index}`,
			})),
		];

		expect(refusal(() => plan({ locations })).code).toBe("too_many_locations");
	});

	it("accepts a payload right at the limit", () => {
		const locations = [
			{ ref: "garden", title: "Garden" },
			...Array.from({ length: maxBulkLocations - 1 }, (_value, index) => ({
				ref: `p${index}`,
				parentRef: "garden",
				title: `Place ${index}`,
			})),
		];

		expect(plan({ locations }).items).toHaveLength(maxBulkLocations);
	});
});
