import { parseLabelBody, parseLocationBody, parseNodeBody } from "./body.js";
import type { ApiError } from "./errors.js";

function refusal(body: unknown, mode: "create" | "update"): ApiError {
	try {
		parseNodeBody(body, mode);
	} catch (error) {
		return error as ApiError;
	}
	throw new Error("Expected the body to be refused.");
}

function locationRefusal(body: unknown, mode: "create" | "update"): ApiError {
	try {
		parseLocationBody(body, mode);
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
					locationId: "loc-1",
					visibility: "private",
					participantIds: ["uidMarcus"],
					labelIds: ["label-1"],
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
			locationId: "loc-1",
			visibility: "private",
			participantIds: ["uidMarcus"],
			labelIds: ["label-1"],
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
		"attachments",
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

	/**
	 * The card names its labels by id; the set itself is curated in the app.
	 * `labels` is the home document's definitions map, and a body that could
	 * write one on a node would plant a definition nowhere and render nothing.
	 */
	it("takes labelIds and refuses the definitions map", () => {
		expect(parseNodeBody({ labelIds: ["label-1"] }, "update")).toEqual({
			labelIds: ["label-1"],
		});
		expect(refusal({ labels: {} }, "create").code).toBe("unknown_field");
	});
});

/**
 * `locationId` is taken (#246) — the place's verbs list the valid ids, and the
 * server derives the stored path from the place. `locationAncestorIds` is that
 * path, and a caller-supplied one could disagree with the place it rides with:
 * an invented one makes "everything in the Basement" return the wrong set
 * permanently, with no screen showing a discrepancy.
 */
describe("location fields", () => {
	it("takes locationId on a create and an update, null included", () => {
		expect(parseNodeBody({ locationId: "loc-1" }, "create")).toEqual({
			locationId: "loc-1",
		});
		expect(parseNodeBody({ locationId: null }, "update")).toEqual({
			locationId: null,
		});
	});

	it("refuses locationAncestorIds rather than ignoring it", () => {
		const error = refusal({ locationAncestorIds: ["loc-1"] }, "create");

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

	it("takes participantIds on a create, where it sets the initial list", () => {
		expect(parseNodeBody({ participantIds: ["uidMarcus"] }, "create")).toEqual({
			participantIds: ["uidMarcus"],
		});
	});

	it("refuses participantIds on an update — it is not a change, ever", () => {
		expect(refusal({ participantIds: ["uidMarcus"] }, "update").code).toBe(
			"participants_immutable",
		);
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

/**
 * `archived` constrains every board query, so an archived node vanishes from
 * every screen — and nothing in the app writes or reads the field today: no
 * archive list, no unarchive control, nothing that shows an archived card at
 * all. A key that could set it could hide a household's work somewhere only
 * another API call could reach.
 */
describe("archiving", () => {
	it("is refused until there is a screen that can undo it", () => {
		expect(refusal({ archived: true }, "update").code).toBe("unknown_field");
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

/**
 * The places themselves have verbs now (#50). What a caller may still not say
 * is anything the server derives: `ancestorIds` comes from `parentId`, and a
 * caller-supplied path is exactly what cannot be verified from outside.
 */
describe("a location body", () => {
	it("takes every field a create writes", () => {
		expect(
			parseLocationBody(
				{ title: "Garden", parentId: "place-1", rank: "a0" },
				"create",
			),
		).toEqual({ title: "Garden", parentId: "place-1", rank: "a0" });
	});

	it("takes a null parentId, which creates a root place", () => {
		expect(
			parseLocationBody({ title: "Garden", parentId: null }, "create"),
		).toEqual({
			title: "Garden",
			parentId: null,
		});
	});

	it("takes an empty body, for a rename-less patch", () => {
		expect(parseLocationBody({}, "update")).toEqual({});
	});

	it("refuses rank on an update — sibling reorder is #182's", () => {
		const error = locationRefusal({ rank: "a0" }, "update");

		expect(error.code).toBe("unknown_field");
		expect(error.message).toContain("title");
	});

	it.each(["ancestorIds", "createdAt", "createdBy", "updatedAt", "id"])(
		"refuses %s on a create and an update",
		(field) => {
			expect(locationRefusal({ [field]: "anything" }, "create").code).toBe(
				"unknown_field",
			);
			expect(locationRefusal({ [field]: "anything" }, "update").code).toBe(
				"unknown_field",
			);
		},
	);

	it("refuses a parentId that is neither a string nor null", () => {
		expect(locationRefusal({ parentId: 7 }, "create").code).toBe(
			"invalid_type",
		);
	});

	it("refuses a title that is not a string", () => {
		expect(locationRefusal({ title: 42 }, "create").code).toBe("invalid_type");
	});

	it("refuses a body that is not an object", () => {
		expect(locationRefusal([], "create").code).toBe("invalid_body");
	});
});

/**
 * A label body, shaped like a location's: name it, dress it, and — on a create
 * only — place it. `title`, `icon` and `color` are required on a create (#256);
 * that requirement is the route's, and here only the allow-list and the types
 * are the test.
 */
function labelRefusal(body: unknown, mode: "create" | "update"): ApiError {
	try {
		parseLabelBody(body, mode);
	} catch (error) {
		return error as ApiError;
	}
	throw new Error("Expected the body to be refused.");
}

describe("a label body", () => {
	it("takes every field a create writes", () => {
		expect(
			parseLabelBody(
				{ title: "Plumbing", icon: "wrench", color: "teal", rank: "a0" },
				"create",
			),
		).toEqual({ title: "Plumbing", icon: "wrench", color: "teal", rank: "a0" });
	});

	it("takes rank on a create, where it places a new label", () => {
		expect(parseLabelBody({ rank: "a0" }, "create")).toEqual({ rank: "a0" });
	});

	it("refuses rank on an update — reorder is a person's drag handle", () => {
		const error = labelRefusal({ rank: "a0" }, "update");

		expect(error.code).toBe("unknown_field");
		expect(error.message).toContain("title");
	});

	it.each([
		"ancestorIds",
		"createdAt",
		"createdBy",
		"updatedAt",
		"id",
		"labels",
	])("refuses %s on a create and an update", (field) => {
		expect(labelRefusal({ [field]: "anything" }, "create").code).toBe(
			"unknown_field",
		);
		expect(labelRefusal({ [field]: "anything" }, "update").code).toBe(
			"unknown_field",
		);
	});

	it("refuses a title that is not a string", () => {
		expect(labelRefusal({ title: 42 }, "create").code).toBe("invalid_type");
	});

	it("refuses an icon that is not a string", () => {
		expect(labelRefusal({ icon: 7 }, "create").code).toBe("invalid_type");
	});

	it("refuses a color that is not a string", () => {
		expect(labelRefusal({ color: null }, "create").code).toBe("invalid_type");
	});

	it("refuses a body that is not an object", () => {
		expect(labelRefusal([], "create").code).toBe("invalid_body");
	});
});
