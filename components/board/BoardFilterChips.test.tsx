import {
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react-native";
import { ScrollView } from "react-native";
import { BoardFilterChips } from "@/components/board/BoardFilterChips";
import {
	fieldSpecs,
	type Translate,
} from "@/components/overview/CardEditSheet";
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

// The mock t, wearing the hook's own type so `fieldSpecs` accepts it.
const t = ((key: string, values?: Record<string, unknown>) =>
	values === undefined
		? key
		: `${key}:${JSON.stringify(values)}`) as unknown as Translate;

function renderChips(
	next: BoardFilter,
	onChange = jest.fn(),
	onOpen = jest.fn(),
) {
	return render(
		// Light theme: the pills read against the page, which is where they sit.
		<BoardFilterChips
			filter={next}
			onChange={onChange}
			onOpen={onOpen}
			specs={fieldSpecs([me], locations, t, "open")}
			ctx={{
				uid: "uid-me",
				members: [me],
				labels,
				locationTitles: new Map(locations.map((l) => [l.id, l.title])),
				surface: lightTheme.colors.background,
			}}
		/>,
	);
}

/** Drives the two measurements the overflow question is decided by. */
const measure = (box: number, content: number) => {
	const scroller = screen.UNSAFE_getByType(ScrollView);
	fireEvent(scroller, "layout", {
		nativeEvent: { layout: { width: box } },
	});
	fireEvent(scroller, "contentSizeChange", content, 60);
};

describe("BoardFilterChips", () => {
	it("one pill per set condition, each with its own spoken remove phrase", () => {
		renderChips(
			filter({
				conditions: [
					{ field: "assigneeIds", anyOf: ["me"] },
					{ field: "labelIds", anyOf: ["l1", "l2"] },
					{ field: "priority", anyOf: ["urgent"] },
					{ field: "locationId", anyOf: ["loc1"] },
				],
			}),
		);

		expect(
			screen.getByLabelText(
				'board.filter.removeFilter:{"what":"detail.assignees"}',
			),
		).toBeOnTheScreen();
		expect(
			screen.getByLabelText(
				'board.filter.removeFilter:{"what":"board.filter.labels"}',
			),
		).toBeOnTheScreen();
		expect(
			screen.getByLabelText(
				'board.filter.removeFilter:{"what":"detail.priority"}',
			),
		).toBeOnTheScreen();
		// A location has no glyph, so it stays a word — the leaf's own title.
		expect(screen.getByText("Källaren")).toBeOnTheScreen();
		expect(screen.queryByTestId("board-filter-count")).not.toBeOnTheScreen();
	});

	it("several labels are one pill whose clear takes all of them off", () => {
		const onChange = jest.fn();
		renderChips(
			filter({ conditions: [{ field: "labelIds", anyOf: ["l1", "l2"] }] }),
			onChange,
		);

		fireEvent.press(
			within(
				screen.getByLabelText(
					'board.filter.removeFilter:{"what":"board.filter.labels"}',
				),
			).getByLabelText("Close"),
		);

		expect(onChange).toHaveBeenCalledWith(null);
	});

	it("the reach pill is last, and its clear drops back to this board", () => {
		const onChange = jest.fn();
		renderChips(
			filter({
				reach: "subtree",
				conditions: [{ field: "priority", anyOf: ["urgent"] }],
			}),
			onChange,
		);

		expect(screen.getByText("board.filter.everythingBelow")).toBeOnTheScreen();
		fireEvent.press(
			within(
				screen.getByLabelText(
					`board.filter.removeFilter:${JSON.stringify({ what: "board.filter.reach" })}`,
				),
			).getByLabelText("Close"),
		);

		expect(onChange).toHaveBeenCalledWith(
			filter({ conditions: [{ field: "priority", anyOf: ["urgent"] }] }),
		);
	});

	it("the count chip is absent with three conditions and present with five, by measurement", () => {
		const three = filter({
			conditions: [
				{ field: "assigneeIds", anyOf: ["me"] },
				{ field: "priority", anyOf: ["urgent"] },
				{ field: "notes", is: true },
			],
		});
		const five = filter({
			conditions: [
				{ field: "assigneeIds", anyOf: ["me"] },
				{ field: "labelIds", anyOf: ["l1", "l2"] },
				{ field: "priority", anyOf: ["urgent"] },
				{ field: "locationId", anyOf: ["loc1"] },
				{ field: "notes", is: true },
			],
		});

		renderChips(three);
		// The pills fit the row: no count, whatever the numbers say.
		measure(1000, 900);
		expect(screen.queryByTestId("board-filter-count")).not.toBeOnTheScreen();

		screen.rerender(
			<BoardFilterChips
				filter={five}
				onChange={jest.fn()}
				onOpen={jest.fn()}
				specs={fieldSpecs([me], locations, t, "open")}
				ctx={{
					uid: "uid-me",
					members: [me],
					labels,
					locationTitles: new Map(locations.map((l) => [l.id, l.title])),
					surface: lightTheme.colors.background,
				}}
			/>,
		);
		// The same row, now wider than its box: the count answers what the
		// overflow took away.
		measure(1000, 1400);
		expect(screen.getByTestId("board-filter-count")).toBeOnTheScreen();
		expect(
			screen.getByLabelText('board.filter.countA11y:{"count":5}'),
		).toBeOnTheScreen();
	});

	it("a pill's clear removes only that condition", () => {
		const onChange = jest.fn();
		renderChips(
			filter({
				conditions: [
					{ field: "assigneeIds", anyOf: ["me"] },
					{ field: "priority", anyOf: ["urgent"] },
				],
			}),
			onChange,
		);

		fireEvent.press(
			within(
				screen.getByLabelText(
					'board.filter.removeFilter:{"what":"detail.priority"}',
				),
			).getByLabelText("Close"),
		);

		expect(onChange).toHaveBeenCalledWith(
			filter({ conditions: [{ field: "assigneeIds", anyOf: ["me"] }] }),
		);
	});
});
