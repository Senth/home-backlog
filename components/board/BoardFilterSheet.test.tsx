import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { BoardFilterSheet } from "@/components/board/BoardFilterSheet";
import type { BoardFilter } from "@/models/board-filter";
import type { Member } from "@/models/home";
import type { LabelWithId } from "@/models/label";
import type { Location } from "@/models/locations";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	// Keys asserted, not sentences — `CheckListPicker.test.tsx` for the reasoning.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

jest.mock("@/contexts/AuthContext", () => ({
	// firebase/auth does not parse under jest; the sheet only reads the uid.
	useAuth: () => ({ user: { uid: "uid-me" } }),
}));

const me: Member = {
	uid: "uid-me",
	role: "owner",
	displayName: "Marcus",
	photoURL: null,
};

const labels: LabelWithId[] = [
	{ id: "l1", title: "Trädgård", icon: "flower", color: "green", rank: "a0" },
	{ id: "l2", title: "Badrum", icon: "shower", color: "blue", rank: "a1" },
];

const locations: Location[] = [
	{
		id: "loc1",
		title: "Källaren",
		parentId: null,
		ancestorIds: [],
		rank: "a0",
		createdAt: null,
		createdBy: "uid-me",
		updatedAt: null,
	},
];

const filter = (partial: Partial<BoardFilter>): BoardFilter => ({
	mode: "open",
	reach: "board",
	conditions: [],
	...partial,
});

function renderSheet(props: {
	filter?: BoardFilter | null;
	onChange?: (next: BoardFilter | null) => void;
	showEveryone?: boolean;
	onShowEveryone?: (value: boolean) => void;
}) {
	return render(
		<Provider theme={lightTheme}>
			<BoardFilterSheet
				visible
				onDismiss={jest.fn()}
				filter={props.filter ?? null}
				onChange={props.onChange ?? jest.fn()}
				members={[me]}
				labels={labels}
				locations={locations}
				showEveryone={props.showEveryone ?? false}
				onShowEveryone={props.onShowEveryone ?? jest.fn()}
			/>
		</Provider>,
	);
}

describe("BoardFilterSheet", () => {
	it("renders the nine fields, an unset one reading Not set", () => {
		renderSheet({});

		for (const field of [
			"assigneeIds",
			"labelIds",
			"locationId",
			"priority",
			"effort",
			"dueDate",
			"isRoot",
			"blockedBy",
			"notes",
		]) {
			expect(screen.getByTestId(`board-filter-row-${field}`)).toBeOnTheScreen();
		}
		expect(screen.getAllByText("overview.cards.field.notSet")).toHaveLength(9);
	});

	it("a set row reads its value: words where it has none, its icon where it has one", () => {
		renderSheet({
			filter: filter({
				conditions: [
					{ field: "priority", anyOf: ["urgent"] },
					{ field: "locationId", anyOf: ["loc1"] },
					{ field: "notes", is: true },
				],
			}),
		});

		// The priority's value is the ramp dot, so it says no word at all.
		expect(screen.queryByText("priority.urgent")).toBeNull();
		expect(screen.getByText("Källaren")).toBeOnTheScreen();
		expect(
			screen.getByText("overview.cards.field.withNotes"),
		).toBeOnTheScreen();
		// Six of the nine rows are still unset.
		expect(screen.getAllByText("overview.cards.field.notSet")).toHaveLength(6);
	});

	it("a row's ✕ clears that field without opening anything", () => {
		const onChange = jest.fn();
		renderSheet({
			filter: filter({
				conditions: [
					{ field: "priority", anyOf: ["urgent"] },
					{ field: "notes", is: true },
				],
			}),
			onChange,
		});

		fireEvent.press(
			screen.getByLabelText(
				'board.filter.removeFilter:{"what":"detail.priority"}',
			),
		);

		expect(onChange).toHaveBeenCalledWith(
			filter({ conditions: [{ field: "notes", is: true }] }),
		);
	});

	it("the reach control writes the stored filter, with its sentence following", () => {
		const onChange = jest.fn();
		renderSheet({ onChange });

		expect(
			screen.getByText("board.filter.thisBoardDescription"),
		).toBeOnTheScreen();
		fireEvent.press(screen.getByText("board.filter.everythingBelow"));

		expect(onChange).toHaveBeenCalledWith(filter({ reach: "subtree" }));
	});

	it("the moved switch writes the participant preference, not a condition", () => {
		const onShowEveryone = jest.fn();
		renderSheet({ onShowEveryone });

		expect(screen.getByText("board.showEveryone")).toBeOnTheScreen();
		fireEvent(screen.getByRole("switch"), "valueChange", true);
		expect(onShowEveryone).toHaveBeenCalledWith(true);
	});

	it("Etikett opens the label picker, whose note names the inherited labels", () => {
		const onChange = jest.fn();
		renderSheet({ onChange });

		fireEvent.press(screen.getByTestId("board-filter-row-labelIds"));

		expect(screen.getByText("board.filter.labelsInherited")).toBeOnTheScreen();
		fireEvent.press(screen.getByRole("checkbox", { name: "Trädgård" }));

		expect(onChange).toHaveBeenCalledWith(
			filter({ conditions: [{ field: "labelIds", anyOf: ["l1"] }] }),
		);
	});

	it("Vem opens the people picker, and a pick writes the condition", () => {
		const onChange = jest.fn();
		renderSheet({ onChange });

		fireEvent.press(screen.getByTestId("board-filter-row-assigneeIds"));

		fireEvent.press(
			screen.getByRole("checkbox", { name: "overview.cards.field.me" }),
		);

		expect(onChange).toHaveBeenCalledWith(
			filter({ conditions: [{ field: "assigneeIds", anyOf: ["me"] }] }),
		);
	});

	it("an is-field picker replaces and clears, one answer at a time", () => {
		const onChange = jest.fn();
		renderSheet({
			filter: filter({ conditions: [{ field: "notes", is: true }] }),
			onChange,
		});

		fireEvent.press(screen.getByTestId("board-filter-row-notes"));

		// Picking the other answer replaces the set one.
		fireEvent.press(
			screen.getByRole("checkbox", { name: "overview.cards.field.noNotes" }),
		);
		expect(onChange).toHaveBeenCalledWith(
			filter({ conditions: [{ field: "notes", is: false }] }),
		);

		// Picking the set answer again clears the field.
		fireEvent.press(
			screen.getByRole("checkbox", { name: "overview.cards.field.withNotes" }),
		);
		expect(onChange).toHaveBeenCalledWith(null);
	});

	it("Clear all empties the filter; Done only dismisses", () => {
		const onChange = jest.fn();
		const onDismiss = jest.fn();
		render(
			<Provider theme={lightTheme}>
				<BoardFilterSheet
					visible
					onDismiss={onDismiss}
					filter={filter({
						conditions: [{ field: "priority", anyOf: ["urgent"] }],
					})}
					onChange={onChange}
					members={[me]}
					labels={labels}
					locations={locations}
					showEveryone={false}
					onShowEveryone={jest.fn()}
				/>
			</Provider>,
		);

		fireEvent.press(screen.getByText("board.filter.clearAll"));
		expect(onChange).toHaveBeenCalledWith(null);

		fireEvent.press(screen.getByText("common.done"));
		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledTimes(1);
	});
});
