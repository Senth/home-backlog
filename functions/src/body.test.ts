import { parseNodeBody } from "./body.js";
import type { ApiError } from "./errors.js";

function refusal(body: unknown, mode: "create" | "update"): ApiError {
	try {
		parseNodeBody(body, mode);
	} catch (error) {
		return error as ApiError;
	}
	throw new Error("Expected the body to be refused.");
}

describe("what a caller may send", () => {
	it("takes every field a create writes", () => {
		expect(
			parseNodeBody(
				{
					title: "Fix the gutter",
					status: "next_up",
					notes: "Brackets are in the shed.",
					dueDate: "2026-09-30",
					priority: "high",
					effort: "evening",
					assigneeIds: ["uidMarcus"],
					blockedBy: ["node-9"],
					checklist: [{ id: "c1", text: "Buy brackets", done: false }],
					parentId: "project",
					visibility: "private",
				},
				"create",
			),
		).toEqual({
			title: "Fix the gutter",
			status: "next_up",
			notes: "Brackets are in the shed.",
			dueDate: "2026-09-30",
			priority: "high",
			effort: "evening",
			assigneeIds: ["uidMarcus"],
			blockedBy: ["node-9"],
			checklist: [{ id: "c1", text: "Buy brackets", done: false }],
			parentId: "project",
			visibility: "private",
		});
	});

	it("takes an empty body", () => {
		expect(parseNodeBody({}, "update")).toEqual({});
	});

	it("keeps an explicit null apart from an absent field", () => {
		expect(parseNodeBody({ dueDate: null }, "update")).toEqual({
			dueDate: null,
		});
		expect(parseNodeBody({}, "update")).toEqual({});
	});

	it("refuses a body that is not an object", () => {
		expect(refusal([], "create").code).toBe("invalid_body");
		expect(refusal("title", "create").code).toBe("invalid_body");
		expect(refusal(null, "create").code).toBe("invalid_body");
	});
});

/**
 * An allow-list, not a deny-list. Most of a node document is the server's —
 * `ancestorIds` is derived from `parentId`, `columns` is frozen by depth,
 * `rank` comes from the target column's neighbours, the counters move with
 * `increment()` — and a caller that could set any of them could write a document
 * that is internally inconsistent while passing every field check.
 */
describe("what the server owns", () => {
	it.each([
		"ancestorIds",
		"columns",
		"rank",
		"childCount",
		"doneCount",
		"completedAt",
		"createdAt",
		"createdBy",
		"updatedAt",
		"createdVia",
		"id",
		"photos",
	])("refuses %s", (field) => {
		expect(refusal({ [field]: "anything" }, "create").code).toBe(
			"unknown_field",
		);
		expect(refusal({ [field]: "anything" }, "update").code).toBe(
			"unknown_field",
		);
	});

	// Quietly dropping it was rejected: the agent then believes it wrote
	// something it did not write.
	it("names the field and the ones that would have worked", () => {
		const error = refusal({ rank: "a0" }, "update");

		expect(error.message).toContain("rank");
		expect(error.message).toContain("title");
		expect(error.details?.[0].field).toBe("rank");
	});
});

/**
 * Nothing can hand an agent a valid location id — the collection has no verbs
 * and no screens — and `locationAncestorIds` is a denormalized path that is
 * unverifiable from outside. An invented one makes "everything in the Basement"
 * return the wrong set permanently, with no screen showing a discrepancy.
 */
describe("location fields", () => {
	it.each([
		"locationId",
		"locationAncestorIds",
	])("refuses %s rather than ignoring it", (field) => {
		const error = refusal({ [field]: "loc-1" }, "create");

		expect(error.code).toBe("locations_unavailable");
		expect(error.status).toBe(400);
	});
});

/**
 * The same restriction stated twice: a bearer token in an env file must not be
 * able to change who can see a household's work. On a private node
 * `participantIds` *is* the access list.
 */
describe("visibility and participants", () => {
	it("refuses visibility on an update", () => {
		expect(refusal({ visibility: "private" }, "update").code).toBe(
			"visibility_immutable",
		);
	});

	it("allows visibility on a create, where it makes a private root", () => {
		expect(parseNodeBody({ visibility: "private" }, "create")).toEqual({
			visibility: "private",
		});
	});

	it("refuses participantIds either way, with a different reason each time", () => {
		expect(
			refusal({ participantIds: ["uidMarcus"] }, "create").message,
		).toContain("key's owner");
		expect(
			refusal({ participantIds: ["uidMarcus"] }, "update").message,
		).toContain("access list");
	});

	/**
	 * Deliberately unrestricted. No rule reads `assigneeIds`, so assigning
	 * somebody is not a permission change — which is exactly what lets a key
	 * assign without being able to revoke.
	 */
	it("takes assigneeIds without complaint", () => {
		expect(parseNodeBody({ assigneeIds: ["uidIngrid"] }, "update")).toEqual({
			assigneeIds: ["uidIngrid"],
		});
	});
});

describe("archiving", () => {
	it("is an ordinary edit, both ways", () => {
		expect(parseNodeBody({ archived: true }, "update").archived).toBe(true);
		expect(parseNodeBody({ archived: false }, "update").archived).toBe(false);
	});

	// A new node is never archived, so there is nothing to say on a create.
	it("is not something a create says", () => {
		expect(refusal({ archived: true }, "create").code).toBe("unknown_field");
	});
});

describe("the values that drive a read before the write", () => {
	it("refuses a status outside the enum", () => {
		expect(refusal({ status: "in_progress" }, "update").code).toBe(
			"invalid_status",
		);
	});

	it("refuses the status that used to exist", () => {
		expect(refusal({ status: "blocked" }, "update").code).toBe(
			"invalid_status",
		);
	});

	it("refuses a priority or effort outside its enum", () => {
		expect(refusal({ priority: "critical" }, "update").code).toBe(
			"invalid_priority",
		);
		expect(refusal({ effort: "a fortnight" }, "update").code).toBe(
			"invalid_effort",
		);
	});

	it("takes a null priority or effort, which means unset", () => {
		expect(parseNodeBody({ priority: null, effort: null }, "update")).toEqual({
			priority: null,
			effort: null,
		});
	});

	it("refuses a parentId that is neither a string nor null", () => {
		expect(refusal({ parentId: 7 }, "update").code).toBe("invalid_type");
	});

	it("takes a null parentId, which moves a node to the root board", () => {
		expect(parseNodeBody({ parentId: null }, "update")).toEqual({
			parentId: null,
		});
	});

	it("refuses a list field that is not a list of strings", () => {
		expect(refusal({ assigneeIds: "uidMarcus" }, "update").code).toBe(
			"invalid_type",
		);
		expect(refusal({ blockedBy: [1] }, "update").code).toBe("invalid_type");
	});
});
