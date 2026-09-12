import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { BlockerSearchDialog } from "@/components/node/BlockerSearchDialog";
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

// The component imports the Firestore module itself for the one-shot search
// pair, which jest's node_modules cannot parse — the same stub the dashboard
// hook's test uses.
jest.mock("firebase/firestore", () => ({
	getDocsFromServer: jest.fn(),
}));

// The picker reads these only once a query settles; the on-board rows under
// test come from the `siblings` prop and touch none of it.
jest.mock("@/data/nodes", () => ({
	getDocsFromServer: jest.fn(),
	sharedPickerQuery: jest.fn(),
	participatingPickerQuery: jest.fn(),
}));

jest.mock("@/hooks/use-ancestors", () => ({
	cachedNode: jest.fn(),
}));

// The real icon set loads its font map asynchronously — the same double the
// label picker's test uses, with the glyph name as the testID.
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ({ name }: { name: string }) => <View testID={name} />,
	};
});

function node(overrides: Partial<Node> = {}): Node {
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
		labelIds: [],
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
		...overrides,
	};
}

function renderPicker(
	card: Node,
	siblings: Node[],
	onPick: (id: string) => void = () => {},
) {
	return render(
		<Provider theme={lightTheme}>
			<BlockerSearchDialog
				homeId="home-1"
				uid="uid-1"
				node={card}
				siblings={siblings}
				blockers={new Map()}
				onDismiss={() => {}}
				onPick={onPick}
				onUnpick={() => {}}
				testID="blocker-picker"
			/>
		</Provider>,
	);
}

describe("BlockerSearchDialog", () => {
	it("marks a candidate that is itself waiting on this card", () => {
		renderPicker(node(), [
			node({ id: "sib-1", title: "Paint the fence", blockedBy: ["node-1"] }),
			node({ id: "sib-2", title: "Oil the hinges" }),
		]);

		expect(screen.getAllByText("detail.blockerCycle")).toHaveLength(1);
		expect(
			screen.getByRole("checkbox", { name: "Paint the fence" }),
		).toBeOnTheScreen();
	});

	it("still picks the cyclical candidate — the chip warns, it does not block", () => {
		const onPick = jest.fn();
		renderPicker(
			node(),
			[
				node({
					id: "sib-1",
					title: "Dig the post holes",
					blockedBy: ["node-1"],
				}),
			],
			onPick,
		);

		fireEvent.press(
			screen.getByRole("checkbox", { name: "Dig the post holes" }),
		);

		expect(onPick).toHaveBeenCalledWith("sib-1");
	});

	it("leaves a candidate with no cycle back unmarked", () => {
		renderPicker(node(), [node({ id: "sib-1", title: "Oil the hinges" })]);

		expect(screen.queryByText("detail.blockerCycle")).toBeNull();
	});
});
