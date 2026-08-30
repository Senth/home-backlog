import { apiHome, apiLocation, apiNode, visibleTo } from "./api-nodes.js";

const me = "uid-member";
const someoneElse = "uid-owner";

function stamp(iso: string) {
	return { toDate: () => new Date(iso) };
}

/**
 * The first thing to test, and the reason this module is pure.
 *
 * The app cannot express `visibility == 'shared' || participantIds
 * array-contains me` as one query, so a board runs two and merges them — every
 * document either query can match is one the rules already allow. The function
 * has no such help: the Admin SDK returns everything, so this predicate is the
 * only thing between another member's private project and the API.
 */
describe("who may see a node", () => {
	it("shows a shared node to anyone in the home", () => {
		expect(visibleTo({ visibility: "shared", participantIds: [] }, me)).toBe(
			true,
		);
	});

	it("shows a private node to its participants", () => {
		expect(visibleTo({ visibility: "private", participantIds: [me] }, me)).toBe(
			true,
		);
	});

	it("hides another member's private project", () => {
		expect(
			visibleTo({ visibility: "private", participantIds: [someoneElse] }, me),
		).toBe(false);
	});

	it("hides a private node with no participants at all", () => {
		expect(visibleTo({ visibility: "private", participantIds: [] }, me)).toBe(
			false,
		);
	});

	// The safe direction to be wrong in, and the one the rules are wrong in too:
	// reading an absent field there is an evaluation error, which denies.
	it("treats a document with no visibility as private", () => {
		expect(visibleTo({}, me)).toBe(false);
		expect(visibleTo({ visibility: null, participantIds: [] }, me)).toBe(false);
		expect(visibleTo({ visibility: "Shared", participantIds: [] }, me)).toBe(
			false,
		);
	});

	it("still lets a participant through a corrupt visibility", () => {
		expect(visibleTo({ visibility: 42, participantIds: [me] }, me)).toBe(true);
	});

	it("refuses a participantIds that is not a list", () => {
		expect(visibleTo({ visibility: "private", participantIds: me }, me)).toBe(
			false,
		);
	});
});

describe("a node on the wire", () => {
	const stored = {
		title: "Fix the gutter",
		status: "execution",
		rank: "a0",
		parentId: "project",
		ancestorIds: ["project"],
		locationId: null,
		locationAncestorIds: [],
		participantIds: [me],
		assigneeIds: [someoneElse],
		visibility: "private",
		columns: ["backlog", "execution", "done"],
		childCount: 2,
		doneCount: 1,
		dueDate: "2026-09-30",
		priority: "high",
		effort: "evening",
		blockedBy: [],
		notes: "Brackets are in the shed.",
		checklist: [{ id: "c1", text: "Buy brackets", done: false }],
		photos: [],
		archived: false,
		createdVia: "api",
		completedAt: null,
		createdAt: stamp("2026-01-01T00:00:00.000Z"),
		createdBy: someoneElse,
		updatedAt: stamp("2026-02-01T12:00:00.000Z"),
	};

	it("carries the id and every field", () => {
		expect(apiNode("node-1", stored)).toEqual({
			id: "node-1",
			...stored,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-02-01T12:00:00.000Z",
		});
	});

	// An agent has no Firestore SDK, and `{"_seconds":...}` is not a date
	// anything can parse.
	it("renders timestamps as ISO 8601", () => {
		const node = apiNode("done-1", {
			...stored,
			status: "done",
			completedAt: stamp("2026-03-04T05:06:07.000Z"),
		});

		expect(node.completedAt).toBe("2026-03-04T05:06:07.000Z");
	});

	it("survives a document with nothing in it", () => {
		const node = apiNode("empty", {});

		expect(node.id).toBe("empty");
		expect(node.title).toBe("");
		expect(node.status).toBe("backlog");
		expect(node.visibility).toBe("shared");
		// Absent means the app wrote it, which is true of every node from before
		// this feature. Nothing queries the field, so nothing was backfilled.
		expect(node.createdVia).toBe("app");
		expect(node.ancestorIds).toEqual([]);
		expect(node.createdAt).toBeNull();
	});

	it("reads an unknown createdVia as the app", () => {
		expect(apiNode("odd", { createdVia: "cli" }).createdVia).toBe("app");
	});

	it("clamps a counter that has drifted below zero", () => {
		expect(
			apiNode("drifted", { doneCount: -1, childCount: 2.7 }),
		).toMatchObject({ doneCount: 0, childCount: 2 });
	});

	it("drops a column that is not a status", () => {
		expect(
			apiNode("odd", { columns: ["backlog", "blocked", "done"] }).columns,
		).toEqual(["backlog", "done"]);
	});

	it("drops a priority or effort outside its enum", () => {
		const node = apiNode("odd", {
			priority: "critical",
			effort: "a fortnight",
		});

		expect(node.priority).toBeNull();
		expect(node.effort).toBeNull();
	});
});

describe("a location on the wire", () => {
	const stored = {
		title: "The garden",
		parentId: "place-root",
		ancestorIds: ["place-root"],
		rank: "a0",
		createdAt: stamp("2026-01-01T00:00:00.000Z"),
		createdBy: someoneElse,
		updatedAt: stamp("2026-02-01T12:00:00.000Z"),
	};

	it("carries the id and every field", () => {
		expect(apiLocation("loc-1", stored)).toEqual({
			id: "loc-1",
			...stored,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-02-01T12:00:00.000Z",
		});
	});

	it("renders a root place's parentId as null", () => {
		expect(
			apiLocation("loc-1", { ...stored, parentId: null, ancestorIds: [] })
				.parentId,
		).toBeNull();
	});

	it("survives a document with nothing in it", () => {
		const location = apiLocation("empty", {});

		expect(location.title).toBe("");
		expect(location.parentId).toBeNull();
		expect(location.ancestorIds).toEqual([]);
		expect(location.rank).toBe("");
		expect(location.createdAt).toBeNull();
	});
});

describe("a home on the wire", () => {
	const stored = {
		name: "Villa Ekhagen",
		members: { [me]: "member", [someoneElse]: "owner" },
		memberProfiles: {
			[me]: { displayName: "Marcus", photoURL: null },
			[someoneElse]: { displayName: "Ingrid", photoURL: null },
		},
	};

	it("names the caller's own role", () => {
		expect(apiHome("home-1", stored, me).role).toBe("member");
		expect(apiHome("home-1", stored, someoneElse).role).toBe("owner");
	});

	// Not decoration: `assigneeIds` takes uids, so an agent that could not
	// resolve a name to a uid could never assign anybody anything.
	it("lists every member with their uid and display name", () => {
		expect(apiHome("home-1", stored, me).members).toEqual([
			{ uid: me, role: "member", displayName: "Marcus" },
			{ uid: someoneElse, role: "owner", displayName: "Ingrid" },
		]);
	});

	it("survives a home written before the profile maps existed", () => {
		const home = apiHome(
			"home-1",
			{ name: "Cabin", members: { [me]: "owner" } },
			me,
		);

		expect(home.members).toEqual([{ uid: me, role: "owner", displayName: "" }]);
	});
});
