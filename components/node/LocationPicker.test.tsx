import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { LocationPicker } from "@/components/node/LocationPicker";
import type { NodeChanges } from "@/data/nodes";
import type { Location } from "@/models/locations";
import { defaultColumns, type Node } from "@/models/node";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	// The keys are asserted rather than the sentences — the parity of the locale
	// files is `yarn invariants`' job, and pinning English here would fail on a
	// rewording that is not a behavior change.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

// The real icon set loads its font map asynchronously — the same double the
// card face's test uses, with the glyph name as the testID.
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ({ name }: { name: string }) => <View testID={name} />,
	};
});

function location(
	id: string,
	title: string,
	ancestorIds: string[] = [],
): Location {
	return {
		id,
		title,
		parentId: ancestorIds.at(-1) ?? null,
		ancestorIds,
		rank: id,
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
	};
}

function node(locationId: string | null): Node {
	return {
		id: "node-1",
		title: "Fix the gutter",
		status: "backlog",
		rank: "a0",
		parentId: null,
		ancestorIds: [],
		locationId,
		locationAncestorIds: [],
		participantIds: [],
		assigneeIds: [],
		visibility: "shared",
		columns: [...defaultColumns],
		childCount: 0,
		doneCount: 0,
		dueDate: null,
		priority: null,
		blockedBy: [],
		labelIds: [],
		notes: "",
		checklist: [],
		effort: null,
		attachments: [],
		attachmentCount: 0,
		attachmentDisplay: "count",
		heroAttachmentId: null,
		archived: false,
		createdVia: "app",
		completedAt: null,
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
	};
}

const tree = [
	location("house", "House"),
	location("basement", "Basement", ["house"]),
	location("hallway", "Hallway", ["house", "basement"]),
];

function renderPicker(
	card: Node,
	onSave: (changes: NodeChanges) => void,
	effectiveLocationId: string | null = null,
) {
	return render(
		<Provider theme={lightTheme}>
			<LocationPicker
				locations={tree}
				node={card}
				effectiveLocationId={effectiveLocationId}
				onDismiss={() => {}}
				onSave={onSave}
				testID="location-picker"
			/>
		</Provider>,
	);
}

describe("LocationPicker", () => {
	it("lists the home's locations and marks the one the card is filed in", () => {
		renderPicker(node("hallway"), () => {}, "hallway");

		expect(
			screen.getByRole("checkbox", { name: "Hallway" }).props
				.accessibilityState,
		).toMatchObject({ checked: true });
		expect(
			screen.getByRole("checkbox", { name: "Basement" }).props
				.accessibilityState,
		).toMatchObject({ checked: false });
	});

	it("shows the full path as a trail under a filed row", () => {
		renderPicker(node(null), () => {});

		// Hallway's trail names the places above it, root first — every ancestor
		// title appears again beyond its own row, once per trail it sits in.
		expect(screen.getAllByText("House").length).toBeGreaterThan(1);
		expect(screen.getAllByText("Basement").length).toBeGreaterThan(1);
	});

	it("names a crumb the tree cannot answer as hidden", () => {
		render(
			<Provider theme={lightTheme}>
				<LocationPicker
					locations={[location("orphan", "Orphan", ["gone"])]}
					node={node(null)}
					effectiveLocationId={null}
					onDismiss={() => {}}
					onSave={() => {}}
					testID="location-picker"
				/>
			</Provider>,
		);

		expect(screen.getByText("board.crumbHidden")).toBeOnTheScreen();
	});

	it("writes the place and its stored path in one save", () => {
		const save = jest.fn();
		renderPicker(node(null), save);

		fireEvent.press(screen.getByLabelText("Hallway"));

		expect(save).toHaveBeenCalledWith({
			locationId: "hallway",
			locationAncestorIds: ["house", "basement"],
		});
	});

	it("unfiles the card when its own filed row is tapped again", () => {
		const save = jest.fn();
		renderPicker(node("hallway"), save, "hallway");

		fireEvent.press(screen.getByLabelText("Hallway"));

		expect(save).toHaveBeenCalledWith({
			locationId: null,
			locationAncestorIds: [],
		});
	});

	it("ticks the place the trail passes down and says it is inherited (#290)", () => {
		renderPicker(node(null), () => {}, "hallway");

		expect(
			screen.getByRole("checkbox", { name: "Hallway" }).props
				.accessibilityState,
		).toMatchObject({ checked: true });
		expect(screen.getByText("detail.locationInherited")).toBeOnTheScreen();
	});

	it("writes nothing when the inherited row is tapped", () => {
		const save = jest.fn();
		renderPicker(node(null), save, "hallway");

		fireEvent.press(screen.getByLabelText("Hallway"));

		expect(save).not.toHaveBeenCalled();
	});

	it("still files the card somewhere else while a place is inherited", () => {
		const save = jest.fn();
		renderPicker(node(null), save, "hallway");

		fireEvent.press(screen.getByLabelText("Basement"));

		expect(save).toHaveBeenCalledWith({
			locationId: "basement",
			locationAncestorIds: ["house"],
		});
	});

	it("says the home has no locations yet rather than an empty dialog", () => {
		render(
			<Provider theme={lightTheme}>
				<LocationPicker
					locations={[]}
					node={node(null)}
					effectiveLocationId={null}
					onDismiss={() => {}}
					onSave={() => {}}
					testID="location-picker"
				/>
			</Provider>,
		);

		expect(screen.getByText("detail.locationNone")).toBeOnTheScreen();
	});

	it("finds Trädgård from trad, folding diacritics as well as case", () => {
		render(
			<Provider theme={lightTheme}>
				<LocationPicker
					locations={[location("garden", "Trädgård"), ...tree]}
					node={node(null)}
					effectiveLocationId={null}
					onDismiss={() => {}}
					onSave={() => {}}
					testID="location-picker"
				/>
			</Provider>,
		);

		fireEvent.changeText(screen.getByTestId("location-picker-search"), "trad");

		expect(
			screen.getByRole("checkbox", { name: "Trädgård" }),
		).toBeOnTheScreen();
		expect(screen.queryByRole("checkbox", { name: "House" })).toBeNull();
	});
});
