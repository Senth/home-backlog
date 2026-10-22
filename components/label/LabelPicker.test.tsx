import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentProps } from "react";
import { HelperText, Provider } from "react-native-paper";
import { LabelPicker } from "@/components/label/LabelPicker";
import { applyLabel, removeLabel } from "@/data/nodes";
import type { LabelWithId } from "@/models/label";
import { defaultColumns, type Node } from "@/models/node";
import type { RecordedComponent } from "@/tests/support/record-props";
import { lightTheme } from "@/theme";

jest.mock("react-native-paper", () => {
	const { recordProps } = require("@/tests/support/record-props");
	const actual = jest.requireActual("react-native-paper");
	return { ...actual, HelperText: recordProps(actual.HelperText) };
});

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

// `LabelPicker` takes the home's label definitions as a prop (#237): it
// renders inside a portal, above which the home context does not reach.
let mockHome: { labels: LabelWithId[] } | null = null;
jest.mock("@/data/nodes", () => ({
	applyLabel: jest.fn(() => Promise.resolve()),
	removeLabel: jest.fn(() => Promise.resolve()),
}));

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

async function renderPicker(card: Node) {
	return await render(
		<Provider theme={lightTheme}>
			<LabelPicker
				homeId="home-1"
				labels={mockHome?.labels ?? []}
				node={card}
				onDismiss={() => {}}
				testID="label-picker"
			/>
		</Provider>,
	);
}

function capSentence() {
	return screen.getByTestId("label-picker-cap", {
		includeHiddenElements: true,
	});
}

const mockHelperText = HelperText as unknown as RecordedComponent<
	ComponentProps<typeof HelperText>
>;

function capHelper() {
	return mockHelperText
		.getProps()
		.find((helper) => helper.testID === "label-picker-cap");
}

describe("LabelPicker", () => {
	it("lists the home's labels by name and marks the applied ones", async () => {
		mockHome = { labels: [label("l1"), label("l2")] };
		await renderPicker(node(["l1"]));

		expect(
			screen.getByRole("checkbox", { name: "Label l1" }).props
				.accessibilityState,
		).toMatchObject({ checked: true });
		expect(
			screen.getByRole("checkbox", { name: "Label l2" }).props
				.accessibilityState,
		).toMatchObject({ checked: false });
	});

	it("applies a label that is not on the card", async () => {
		mockHome = { labels: [label("l1"), label("l2")] };
		await renderPicker(node(["l1"]));

		await fireEvent.press(screen.getByLabelText("Label l2"));

		// The write is the transform, not a whole array from this snapshot —
		// two pickers at once cannot drop each other's label.
		expect(applyLabel).toHaveBeenCalledWith("home-1", "node-1", "l2");
	});

	it("removes a label that is", async () => {
		mockHome = { labels: [label("l1"), label("l2")] };
		await renderPicker(node(["l1", "l2"]));

		await fireEvent.press(screen.getByLabelText("Label l1"));

		expect(removeLabel).toHaveBeenCalledWith("home-1", "node-1", "l1");
	});

	it("says the home has no labels yet rather than an empty dialog", async () => {
		mockHome = { labels: [] };
		await renderPicker(node([]));

		expect(screen.getByText("labels.empty")).toBeOnTheScreen();
	});

	it("finds Trädgård from trad, folding diacritics as well as case", async () => {
		mockHome = {
			labels: [
				label("l1", { title: "Trädgård" }),
				label("l2", { title: "Garden" }),
			],
		};
		await renderPicker(node([]));

		await fireEvent.changeText(
			screen.getByTestId("label-picker-search"),
			"trad",
		);

		expect(
			screen.getByRole("checkbox", { name: "Trädgård" }),
		).toBeOnTheScreen();
		expect(screen.queryByRole("checkbox", { name: "Garden" })).toBeNull();
	});

	it("refuses a seventh label and says so", async () => {
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
		await renderPicker(node(["l1", "l2", "l3", "l4", "l5", "l6"]));

		// A full card can still make room, so only the unapplied one is closed.
		expect(
			screen.getByRole("checkbox", { name: "Label l7" }).props
				.accessibilityState,
		).toMatchObject({ checked: false, disabled: true });
		expect(
			screen.getByRole("checkbox", { name: "Label l1" }).props
				.accessibilityState,
		).toMatchObject({ checked: true });
		expect(screen.getByText(/labels\.capReached/)).toBeOnTheScreen();
		expect(capHelper()?.visible).toBe(true);
	});

	it("offers every row and keeps the cap sentence quiet below the cap", async () => {
		mockHome = { labels: [label("l1"), label("l2")] };
		await renderPicker(node(["l1"]));

		expect(
			screen.getByRole("checkbox", { name: "Label l2" }).props
				.accessibilityState,
		).toMatchObject({ checked: false });
		expect(screen.queryByText(/labels\.capReached/)).toBeNull();
	});

	it("keeps the reserved cap slot out of the accessibility tree", async () => {
		// Paper hides a hidden helper at opacity 0 but leaves it announced;
		// while the slot holds nothing it is hidden from assistive tech too.
		mockHome = { labels: [label("l1")] };
		await renderPicker(node(["l1"]));

		expect(capSentence()).toBeOnTheScreen();
		expect(screen.queryByText(/labels\.capReached/)).toBeNull();
		expect(capHelper()?.visible).toBe(false);
		expect(capSentence().props.accessibilityElementsHidden).toBe(true);
		expect(capSentence().props.importantForAccessibility).toBe(
			"no-hide-descendants",
		);
	});

	it("hands the cap sentence back to the accessibility tree at the cap", async () => {
		mockHome = {
			labels: [
				label("l1"),
				label("l2"),
				label("l3"),
				label("l4"),
				label("l5"),
				label("l6"),
			],
		};
		await renderPicker(node(["l1", "l2", "l3", "l4", "l5", "l6"]));

		expect(capSentence()).toBeOnTheScreen();
		expect(screen.getByText(/labels\.capReached/)).toBeOnTheScreen();
		expect(capHelper()?.visible).toBe(true);
		expect(capSentence().props.accessibilityElementsHidden).toBe(false);
		expect(capSentence().props.importantForAccessibility).toBe("auto");
	});
});
