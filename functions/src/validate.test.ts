import type { ApiError } from "./errors.js";
import {
	isMember,
	type NodeContext,
	type ParentFacts,
	refuseEmptyRootParticipants,
	refuseUnusableParticipants,
	validateNode,
} from "./validate.js";

/**
 * The mirrored invariants, tested against the same case list as
 * `tests/rules/firestore.test.ts`.
 *
 * That correspondence is the whole mitigation for having two implementations of
 * one truth: the rules guard every client write, this guards every API write,
 * and if the two ever disagree it will be because a case was added to one list
 * and not the other. Adding a rules case means adding one here.
 *
 * These are the only thing standing between a handler bug and a silent orphan —
 * a node whose parent does not exist, unreachable from every board and every
 * breadcrumb, with nothing on any screen to say it is there.
 */

/** A node document in the shape a handler assembles it: every field, with a value. */
function nodeDoc(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		title: "Fix the gutter",
		status: "backlog",
		rank: "a0",
		parentId: null,
		ancestorIds: [],
		locationId: null,
		locationAncestorIds: [],
		participantIds: [],
		assigneeIds: [],
		visibility: "shared",
		columns: ["backlog", "next_up", "execution", "done"],
		childCount: 0,
		doneCount: 0,
		dueDate: null,
		priority: null,
		blockedBy: [],
		notes: "",
		checklist: [],
		effort: null,
		photos: [],
		archived: false,
		completedAt: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		createdBy: "uid-owner",
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function parentFacts(overrides: Partial<ParentFacts> = {}): ParentFacts {
	return {
		id: "project",
		visibility: "shared",
		participantIds: [],
		columns: ["backlog", "next_up", "execution", "done"],
		ancestorIds: [],
		...overrides,
	};
}

const atRoot: NodeContext = { nodeId: "node-1", parent: null };

function codes(
	data: Record<string, unknown>,
	context: NodeContext = atRoot,
): string[] {
	return validateNode(data, context).map((issue) => issue.code);
}

describe("the field set", () => {
	it("accepts a node with every field written", () => {
		expect(validateNode(nodeDoc(), atRoot)).toEqual([]);
	});

	it.each([
		"title",
		"status",
		"rank",
		"columns",
		"childCount",
		"doneCount",
		"archived",
		"createdAt",
		"createdBy",
	])("refuses a node with no %s", (field) => {
		const data = nodeDoc();
		delete data[field];

		expect(validateNode(data, atRoot).length).toBeGreaterThan(0);
	});

	it.each([
		["empty", ""],
		["not a string", 42],
	])("refuses a title that is %s", (_label, title) => {
		expect(codes(nodeDoc({ title }))).toContain("title_required");
	});

	it("refuses a title over 200 characters", () => {
		expect(codes(nodeDoc({ title: "x".repeat(201) }))).toContain(
			"title_too_long",
		);
	});

	it("accepts a title of exactly 200 characters", () => {
		expect(validateNode(nodeDoc({ title: "x".repeat(200) }), atRoot)).toEqual(
			[],
		);
	});

	it.each([
		["status", "in_progress", "invalid_status"],
		["priority", "critical", "invalid_priority"],
		["effort", "a fortnight", "invalid_effort"],
		["visibility", "secret", "invalid_visibility"],
	])("refuses a %s outside its enum", (field, value, code) => {
		expect(codes(nodeDoc({ [field]: value }))).toContain(code);
	});

	/**
	 * `blocked` was in this enum and is not any more. A card is in exactly one
	 * status, so parking it in Blocked destroys the stage it was in — being
	 * blocked is a condition `blockedBy[]` carries, not a stage of work.
	 */
	it("refuses the status that used to exist", () => {
		expect(codes(nodeDoc({ status: "blocked" }))).toContain("invalid_status");
	});

	it.each(["2026-9-1", "01/09/2026", "not a date", "2026-09-30T00:00:00Z"])(
		"refuses a dueDate of %s",
		(dueDate) => {
			expect(codes(nodeDoc({ dueDate }))).toContain("invalid_due_date");
		},
	);

	it("accepts a dueDate that is a calendar day", () => {
		expect(validateNode(nodeDoc({ dueDate: "2026-09-30" }), atRoot)).toEqual(
			[],
		);
	});

	it("refuses notes over 10 000 characters", () => {
		expect(codes(nodeDoc({ notes: "x".repeat(10001) }))).toContain(
			"notes_too_long",
		);
		expect(validateNode(nodeDoc({ notes: "x".repeat(10000) }), atRoot)).toEqual(
			[],
		);
	});

	it("refuses a checklist over 200 items", () => {
		const checklist = Array.from({ length: 201 }, (_value, index) => ({
			id: `c${index}`,
			text: "Buy brackets",
			done: false,
		}));

		expect(codes(nodeDoc({ checklist }))).toContain("too_many_checklist_items");
	});

	it("refuses more than 50 photos", () => {
		const photos = Array.from({ length: 51 }, (_value, index) => ({
			id: `p${index}`,
			path: `p${index}.jpg`,
		}));

		expect(codes(nodeDoc({ photos }))).toContain("too_many_photos");
	});

	it("keeps status and completedAt in agreement, both ways", () => {
		expect(codes(nodeDoc({ status: "done", completedAt: null }))).toContain(
			"completed_at_mismatch",
		);
		expect(
			codes(
				nodeDoc({
					status: "execution",
					completedAt: new Date("2026-01-01T00:00:00Z"),
				}),
			),
		).toContain("completed_at_mismatch");
		expect(
			validateNode(
				nodeDoc({
					status: "done",
					completedAt: new Date("2026-01-01T00:00:00Z"),
				}),
				atRoot,
			),
		).toEqual([]);
	});

	it.each([
		["participantIds", "invalid_participants"],
		["assigneeIds", "invalid_assignees"],
		["blockedBy", "invalid_blocked_by"],
		["ancestorIds", "invalid_ancestors"],
	])("refuses a %s that is not a list of strings", (field, code) => {
		expect(codes(nodeDoc({ [field]: "uid-owner" }))).toContain(code);
		expect(codes(nodeDoc({ [field]: [1, 2] }))).toContain(code);
	});

	describe("the column set", () => {
		it("refuses a board with no columns at all", () => {
			expect(codes(nodeDoc({ columns: [] }))).toContain("invalid_columns");
		});

		it("refuses a column nothing could ever be moved to", () => {
			expect(codes(nodeDoc({ columns: ["backlog", "blocked"] }))).toContain(
				"invalid_columns",
			);
		});

		it("refuses columns that are not a list", () => {
			expect(codes(nodeDoc({ columns: "backlog" }))).toContain(
				"invalid_columns",
			);
		});

		it("accepts a board down to a single column", () => {
			expect(validateNode(nodeDoc({ columns: ["backlog"] }), atRoot)).toEqual(
				[],
			);
		});
	});

	/**
	 * Checked for their *type* and nothing else. A lower bound looks correct and
	 * is a trap — `increment()` commutes, so an offline race can drive the value
	 * below zero on its way to the right answer, and a bound would reject the
	 * whole batch. The batch it would reject is a delete.
	 */
	describe("the counters", () => {
		it.each([
			["childCount", 1.5],
			["childCount", "2"],
			["doneCount", null],
			["doneCount", true],
		])("refuses a %s that is not an integer", (field, value) => {
			expect(codes(nodeDoc({ [field]: value }))).toContain("invalid_counter");
		});

		it("accepts a negative count", () => {
			expect(validateNode(nodeDoc({ doneCount: -1 }), atRoot)).toEqual([]);
		});
	});
});

describe("structure", () => {
	const underProject = {
		nodeId: "step",
		parent: parentFacts({ columns: ["backlog", "execution", "done"] }),
	};

	it("accepts a child whose last ancestor is its parent", () => {
		expect(
			validateNode(
				nodeDoc({ parentId: "project", ancestorIds: ["project"] }),
				underProject,
			),
		).toEqual([]);
	});

	it("refuses a root node that carries ancestors", () => {
		expect(
			codes(nodeDoc({ parentId: null, ancestorIds: ["project"] })),
		).toContain("invalid_ancestors");
	});

	it("refuses a child whose last ancestor is not its parent", () => {
		expect(
			codes(
				nodeDoc({ parentId: "project", ancestorIds: ["project", "other"] }),
				underProject,
			),
		).toContain("invalid_ancestors");
	});

	it("refuses a child with a parent and no ancestors at all", () => {
		expect(
			codes(nodeDoc({ parentId: "project", ancestorIds: [] }), underProject),
		).toContain("invalid_ancestors");
	});

	/**
	 * The failure this whole file exists to prevent, in its purest form: a cycle
	 * is unreachable from every board and every breadcrumb, and nothing in the
	 * app could ever find it again.
	 */
	it("refuses a node that is its own ancestor", () => {
		expect(
			codes(
				nodeDoc({ parentId: "project", ancestorIds: ["step", "project"] }),
				underProject,
			),
		).toContain("cycle");
	});

	it("refuses a parentId that is not the parent the handler resolved", () => {
		expect(
			codes(
				nodeDoc({ parentId: "elsewhere", ancestorIds: ["elsewhere"] }),
				underProject,
			),
		).toContain("invalid_parent");
	});
});

describe("inheritance", () => {
	it("refuses a private child under a shared parent", () => {
		expect(
			codes(
				nodeDoc({
					parentId: "project",
					ancestorIds: ["project"],
					visibility: "private",
					participantIds: ["uid-owner"],
				}),
				{ nodeId: "step", parent: parentFacts({ visibility: "shared" }) },
			),
		).toContain("visibility_mismatch");
	});

	it("refuses a shared child under a private parent", () => {
		expect(
			codes(nodeDoc({ parentId: "project", ancestorIds: ["project"] }), {
				nodeId: "step",
				parent: parentFacts({
					visibility: "private",
					participantIds: ["uid-owner"],
				}),
			}),
		).toContain("visibility_mismatch");
	});

	/**
	 * What makes "I am a participant of every descendant of a private node I can
	 * read" true, and so makes the private subtree query complete. A descendant
	 * missing one of its parent's participants is invisible to that person, whose
	 * delete then leaves it behind.
	 */
	it("refuses a private child that drops one of its parent's participants", () => {
		const issues = validateNode(
			nodeDoc({
				parentId: "project",
				ancestorIds: ["project"],
				visibility: "private",
				participantIds: ["uid-owner"],
			}),
			{
				nodeId: "step",
				parent: parentFacts({
					visibility: "private",
					participantIds: ["uid-owner", "uid-member"],
				}),
			},
		);

		expect(issues.map((issue) => issue.code)).toContain(
			"participants_not_inherited",
		);
		expect(issues[0].message).toContain("uid-member");
	});

	it("accepts a private child that adds a participant of its own", () => {
		expect(
			validateNode(
				nodeDoc({
					parentId: "project",
					ancestorIds: ["project"],
					visibility: "private",
					participantIds: ["uid-owner", "uid-member", "uid-extra"],
				}),
				{
					nodeId: "step",
					parent: parentFacts({
						visibility: "private",
						participantIds: ["uid-owner", "uid-member"],
					}),
				},
			),
		).toEqual([]);
	});

	it("asks nothing of a shared node's participants", () => {
		expect(
			validateNode(nodeDoc({ parentId: "project", ancestorIds: ["project"] }), {
				nodeId: "step",
				parent: parentFacts({ participantIds: ["uid-owner"] }),
			}),
		).toEqual([]);
	});
});

/**
 * Stricter than `firestore.rules`, which permits any of the four because #63
 * will edit column sets. An agent has no eyes on the board it is writing to, and
 * a card in a column the board does not draw has a one-way exit: the move sheet
 * only offers frozen destinations.
 */
describe("status within the parent's columns", () => {
	const simple = {
		nodeId: "step",
		parent: parentFacts({ columns: ["backlog", "execution", "done"] }),
	};

	it("accepts a status the board shows", () => {
		expect(
			validateNode(
				nodeDoc({
					parentId: "project",
					ancestorIds: ["project"],
					status: "execution",
				}),
				simple,
			),
		).toEqual([]);
	});

	it("refuses a status the board does not show", () => {
		const issues = validateNode(
			nodeDoc({
				parentId: "project",
				ancestorIds: ["project"],
				status: "next_up",
			}),
			simple,
		);

		expect(issues.map((issue) => issue.code)).toContain(
			"status_not_in_columns",
		);
		expect(issues[0].message).toContain("backlog, execution, done");
	});

	it("measures a root node against the root board's set", () => {
		expect(validateNode(nodeDoc({ status: "next_up" }), atRoot)).toEqual([]);
	});
});

describe("membership", () => {
	it("accepts an owner and a member", () => {
		expect(isMember({ "uid-owner": "owner" }, "uid-owner")).toBe(true);
		expect(isMember({ "uid-member": "member" }, "uid-member")).toBe(true);
	});

	it("refuses somebody who is not in the map", () => {
		expect(isMember({ "uid-owner": "owner" }, "uid-outsider")).toBe(false);
	});

	it("refuses a role that is not one of the two", () => {
		expect(isMember({ "uid-guest": "guest" }, "uid-guest")).toBe(false);
	});

	it("refuses a home with no members map at all", () => {
		expect(isMember(undefined, "uid-owner")).toBe(false);
		expect(isMember(null, "uid-owner")).toBe(false);
		expect(isMember("uid-owner", "uid-owner")).toBe(false);
	});
});

function refusal(
	visibility: "shared" | "private",
	isRoot: boolean,
	participantIds: readonly string[],
): ApiError | null {
	try {
		refuseEmptyRootParticipants(visibility, isRoot, participantIds);
	} catch (error) {
		return error as ApiError;
	}
	return null;
}

/**
 * The rules' `rootHasParticipants()`, mirrored: the Admin SDK bypasses
 * `firestore.rules` entirely, so this is the only thing standing between an
 * agent-written or agent-promoted root and one nobody can see (#102).
 */
describe("a shared root cannot be created or promoted with nobody on it", () => {
	it("refuses a shared root with an empty list", () => {
		expect(refusal("shared", true, [])?.code).toBe("participants_required");
	});

	it("allows a shared root with at least one participant", () => {
		expect(refusal("shared", true, ["uidMarcus"])).toBeNull();
	});

	it("allows a shared descendant with an empty list — it always carries []", () => {
		expect(refusal("shared", false, [])).toBeNull();
	});

	it("allows a private root with an empty list — private always carries its creator", () => {
		expect(refusal("private", true, [])).toBeNull();
	});
});

function unusable(
	participantIds: readonly string[] | undefined,
	isRoot: boolean,
	visibility: "shared" | "private",
	memberUids: readonly string[] = ["uidMarcus", "uidAnna"],
): ApiError | null {
	try {
		refuseUnusableParticipants(participantIds, isRoot, visibility, memberUids);
	} catch (error) {
		return error as ApiError;
	}
	return null;
}

/**
 * A body that disagrees is refused rather than silently overridden — the same
 * contract `visibility_mismatch` already has one field over.
 */
describe("participantIds is honoured on a shared root and nowhere else", () => {
	it("allows a named list on a shared root", () => {
		expect(unusable(["uidAnna"], true, "shared")).toBeNull();
	});

	it("allows the field to be omitted anywhere", () => {
		expect(unusable(undefined, false, "shared")).toBeNull();
		expect(unusable(undefined, true, "private")).toBeNull();
	});

	it("refuses a list on a child, which takes its parent's", () => {
		expect(unusable(["uidAnna"], false, "shared")?.code).toBe(
			"participants_immutable",
		);
	});

	it("refuses a list on a private root, which takes its creator", () => {
		expect(unusable(["uidAnna"], true, "private")?.code).toBe(
			"participants_immutable",
		);
	});

	it("refuses a uid that is not a member of this home", () => {
		// Otherwise `hiddenByParticipants` hides the new root from every board —
		// the outcome `participants_required` exists to prevent, by another value.
		expect(unusable(["uidAnna", "uidStranger"], true, "shared")?.code).toBe(
			"participants_invalid",
		);
	});

	it("names the strangers, not the whole list", () => {
		expect(unusable(["uidAnna", "uidStranger"], true, "shared")?.message).toBe(
			"Not a member of this home: uidStranger.",
		);
	});

	it("leaves an empty list on a shared root to refuseEmptyRootParticipants", () => {
		expect(unusable([], true, "shared")).toBeNull();
		expect(refusal("shared", true, [])?.code).toBe("participants_required");
	});
});
