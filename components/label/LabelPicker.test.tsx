import { fireEvent, render, screen } from "@testing-library/react-native";
import { HelperText, Provider } from "react-native-paper";
import { LabelPicker } from "@/components/label/LabelPicker";
import { applyLabel, removeLabel } from "@/data/nodes";
import type { LabelWithId } from "@/models/label";
import { defaultColumns, type Node } from "@/models/node";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	// The keys are asserted rather than the sentences — the parity of the locale
	// files is `yarn invariants`' job, and pinning English here would fail on a
	// rewording that is not a behaviour change.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

// `LabelPicker` reads the home's label definitions off `activeHome`. Tests
// that need labels install them here.
let mockHome: { labels: LabelWithId[] } | null = null;
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({ activeHome: mockHome }),
}));

jest.mock("@/data/nodes", () => ({
	applyLabel: jest.fn(() => Promise.resolve()),
	removeLabel: jest.fn(() => Promise.resolve()),
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

function label(id: string, overrides: Partial<LabelWithId> = {}): LabelWithId {
	return {
		id,
		title: `Label ${id}`,
		icon: "tag",
		color: "teal",
		rank: id,
		...overrides,
	};
}

function node(labelIds: string[]): Node {
	return {
		id: "node-1",
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
		columns: [...defaultColumns],
		childCount: 0,
		doneCount: 0,
		dueDate: null,
		priority: null,
		blockedBy: [],
		labelIds,
		notes: "",
		checklist: [],
		effort: null,
		photos: [],
		archived: false,
		createdVia: "app",
		completedAt: null,
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
	};
}

function renderPicker(card: Node) {
	return render(
		<Provider theme={lightTheme}>
			<LabelPicker
				homeId="home-1"
				node={card}
				onDismiss={() => {}}
				testID="label-picker"
			/>
		</Provider>,
	);
}

/** The cap sentence, whose slot `HelperText` keeps even while hidden. */
function capSentence() {
	return screen
		.UNSAFE_getAllByType(HelperText)
		.find((helper) => helper.props.type === "info");
}

afterEach(() => {
	mockHome = null;
	jest.clearAllMocks();
});

describe("LabelPicker", () => {
	it("lists the home's labels by name and marks the applied ones", () => {
		mockHome = { labels: [label("l1"), label("l2")] };
		renderPicker(node(["l1"]));

		expect(
			screen.getByRole("checkbox", { name: "Label l1" }).props
				.accessibilityState,
		).toMatchObject({ checked: true });
		expect(
			screen.getByRole("checkbox", { name: "Label l2" }).props
				.accessibilityState,
		).toMatchObject({ checked: false });
	});

	it("applies a label that is not on the card", () => {
		mockHome = { labels: [label("l1"), label("l2")] };
		renderPicker(node(["l1"]));

		fireEvent.press(screen.getByLabelText("Label l2"));

		expect(applyLabel).toHaveBeenCalledWith("home-1", "node-1", ["l1"], "l2");
	});

	it("removes a label that is", () => {
		mockHome = { labels: [label("l1"), label("l2")] };
		renderPicker(node(["l1", "l2"]));

		fireEvent.press(screen.getByLabelText("Label l1"));

		expect(removeLabel).toHaveBeenCalledWith(
			"home-1",
			"node-1",
			["l1", "l2"],
			"l1",
		);
	});

	it("says the home has no labels yet rather than an empty dialog", () => {
		mockHome = { labels: [] };
		renderPicker(node([]));

		expect(screen.getByText("labels.empty")).toBeOnTheScreen();
	});

	it("refuses a seventh label and says so", () => {
		mockHome = {
			labels: [
				label("l1"),
				label("l2"),
				label("l3"),
				label("l4"),
				label("l5"),
				label("l6"),
				label("l7"),
			],
		};
		renderPicker(node(["l1", "l2", "l3", "l4", "l5", "l6"]));

		// A full card can still make room, so only the unapplied one is closed.
		expect(
			screen.getByRole("checkbox", { name: "Label l7" }).props
				.accessibilityState,
		).toMatchObject({ checked: false, disabled: true });
		expect(
			screen.getByRole("checkbox", { name: "Label l1" }).props
				.accessibilityState,
		).toMatchObject({ checked: true });
		expect(capSentence().props.visible).toBe(true);
	});

	it("offers every row and keeps the cap sentence quiet below the cap", () => {
		mockHome = { labels: [label("l1"), label("l2")] };
		renderPicker(node(["l1"]));

		expect(
			screen.getByRole("checkbox", { name: "Label l2" }).props
				.accessibilityState,
		).toMatchObject({ checked: false });
		expect(capSentence().props.visible).toBe(false);
	});
});
