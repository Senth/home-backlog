import {
	fieldPickerItems,
	filterWord,
	pickerConditionFromIds,
	pickerValueFor,
} from "@/components/board/BoardFilterRow";
import { fieldSpecs, type Translate } from "@/components/overview/CardEditForm";
import type { Member } from "@/models/home";
import type { LabelWithId } from "@/models/label";
import type { Location } from "@/models/locations";
import { doneWithinDays } from "@/models/overview";
import { lightTheme } from "@/theme";

jest.mock("@/contexts/AuthContext", () => ({
	// CardEditForm's module pulls firebase/auth; these tests read only specs.
	useAuth: () => ({ user: { uid: "uid-me" } }),
}));

const t = ((key: string, values?: Record<string, unknown>) =>
	values === undefined
		? key
		: `${key}:${JSON.stringify(values)}`) as unknown as Translate;

const me: Member = {
	uid: "uid-me",
	role: "owner",
	displayName: "Marcus",
	photoURL: null,
};

const locations: Location[] = [
	{
		id: "loc1",
		title: "Källaren",
		parentId: null,
		ancestorIds: [],
		rank: "a0",
		icon: "crosshairs-gps",
		color: "stone",
		createdAt: null,
		createdBy: "uid-me",
		updatedAt: null,
	},
];

const labels: LabelWithId[] = [
	{ id: "lb1", title: "Målning", icon: "brush", color: "red", rank: "a0" },
];

const locationIds = new Set(locations.map((l) => l.id));
const members = [me];

describe("pickerConditionFromIds", () => {
	const priority = fieldSpecs(members, locations, labels, t, "open").find(
		(spec) => spec.field === "priority",
	) as Parameters<typeof pickerConditionFromIds>[0];
	const label = fieldSpecs(members, locations, labels, t, "open").find(
		(spec) => spec.field === "labelIds",
	) as Parameters<typeof pickerConditionFromIds>[0];

	it("an any-of writes the picked ids, and nothing picked says nothing", () => {
		expect(pickerConditionFromIds(priority, ["high"], locationIds)).toEqual({
			field: "priority",
			anyOf: ["high"],
		});
		expect(pickerConditionFromIds(priority, [], locationIds)).toBeNull();
		// #306: the labels group rides the same any-of mapping as the rest.
		expect(pickerConditionFromIds(label, ["lb1"], locationIds)).toEqual({
			field: "labelIds",
			anyOf: ["lb1"],
		});
		expect(pickerConditionFromIds(label, [], locationIds)).toBeNull();
	});

	it("an is-field takes the answer the last tap chose", () => {
		const notes = fieldSpecs(members, locations, labels, t, "open").find(
			(spec) => spec.field === "notes",
		) as Parameters<typeof pickerConditionFromIds>[0];

		// A boolean spec's ids travel as strings and store as booleans.
		expect(pickerConditionFromIds(notes, ["true"], locationIds)).toEqual({
			field: "notes",
			is: true,
		});
		// Replacing the set answer writes the new one, not a muddle of both.
		expect(
			pickerConditionFromIds(notes, ["true", "false"], locationIds),
		).toEqual({ field: "notes", is: false });
		expect(pickerConditionFromIds(notes, [], locationIds)).toBeNull();
	});

	it("the location field carries both forms, each replacing the other", () => {
		const location = fieldSpecs(members, locations, labels, t, "open").find(
			(spec) => spec.field === "locationId",
		) as Parameters<typeof pickerConditionFromIds>[0];

		expect(pickerConditionFromIds(location, ["loc1"], locationIds)).toEqual({
			field: "locationId",
			anyOf: ["loc1"],
		});
		expect(pickerConditionFromIds(location, ["any"], locationIds)).toEqual({
			field: "locationId",
			is: "any",
		});
		// A flag checked while places are picked replaces them.
		expect(
			pickerConditionFromIds(location, ["loc1", "none"], locationIds),
		).toEqual({ field: "locationId", is: "none" });
	});
});

describe("pickerValueFor", () => {
	it("reads the current condition back as the picker's selection", () => {
		expect(pickerValueFor(null)).toEqual([]);
		expect(pickerValueFor({ field: "priority", anyOf: ["high"] })).toEqual([
			"high",
		]);
		expect(pickerValueFor({ field: "notes", is: true })).toEqual(["true"]);
	});
});

describe("fieldPickerItems", () => {
	it("carries an avatar on the people rows, and the places after any/none", () => {
		const specs = fieldSpecs(members, locations, labels, t, "open");

		// #247: the picker's priority rows read urgent-first, from the spec.
		const priority = fieldPickerItems(
			specs.find((spec) => spec.field === "priority") as Parameters<
				typeof fieldPickerItems
			>[0],
			{ uid: "uid-me", members },
		);
		expect(priority.map((item) => item.id)).toEqual([
			"urgent",
			"high",
			"normal",
			"low",
			"none",
		]);

		const assignees = fieldPickerItems(
			specs.find((spec) => spec.field === "assigneeIds") as Parameters<
				typeof fieldPickerItems
			>[0],
			{ uid: "uid-me", members },
		);
		const meRow = assignees.find((item) => item.id === "me");
		expect(meRow?.left).toBeDefined();

		const location = fieldPickerItems(
			specs.find((spec) => spec.field === "locationId") as Parameters<
				typeof fieldPickerItems
			>[0],
			{ uid: "uid-me", members },
		);
		expect(location.map((item) => item.id)).toEqual(["any", "none", "loc1"]);

		// #306: the labels rows read the home's definitions, glyphs and all.
		const label = fieldPickerItems(
			specs.find((spec) => spec.field === "labelIds") as Parameters<
				typeof fieldPickerItems
			>[0],
			{ uid: "uid-me", members, labels },
		);
		expect(label.map((item) => item.id)).toEqual(["lb1"]);
		expect(label[0].title).toBe("Målning");
		expect(label[0].left).toBeDefined();
	});
});

describe("filterWord", () => {
	it("reads a done window as its sentence, and a widened due window as its own", () => {
		const specs = fieldSpecs(members, locations, labels, t, "open");
		const ctx = {
			uid: "uid-me",
			members,
			labels: [],
			locationTitles: new Map(locations.map((l) => [l.id, l.title])),
			surface: lightTheme.colors.surface,
		};

		expect(
			filterWord({ field: "completedAt", is: "within" }, specs, ctx, t),
		).toBe(`overview.cards.completedAtLine:{"count":${doneWithinDays}}`);
		expect(
			filterWord({ field: "dueDate", is: "comingUp", n: 3 }, specs, ctx, t),
		).toBe('overview.cards.due.comingUpWithin:{"count":3}');
		expect(
			filterWord({ field: "locationId", anyOf: ["loc1"] }, specs, ctx, t),
		).toBe("Källaren");
		// #306: a label condition reads as the definitions' titles.
		expect(
			filterWord({ field: "labelIds", anyOf: ["lb1", "gone"] }, specs, ctx, t),
		).toBe("Målning, gone");
	});
});
