import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { ThemeProvider } from "react-native-paper";
import { BoardCard } from "@/components/board/BoardCard";
import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";
import type { LabelWithId } from "@/models/label";
import type { Location } from "@/models/locations";
import { defaultColumns, type Node } from "@/models/node";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	// The keys are asserted rather than the sentences: both locale files are
	// checked for parity by `yarn invariants`, and a test that pinned the
	// English would fail on a rewording that is not a behavior change.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

// `BoardCard` reads the home's label definitions and the member profiles off
// `activeHome`. Tests that need labels install them here.
let mockHome: { labels: LabelWithId[] } | null = null;
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({ activeHome: mockHome }),
}));

// The real icon set loads its font map asynchronously, which warns about
// updates outside `act` and renders nothing until it lands. A test double
// that carries the glyph name is enough — the glyph itself is Paper's. The
// `__esModule` marker is what makes the default import bind to the double
// rather than to the module object, which dies as an invalid element type the
// moment something renders `PaperIcon` as a component.
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
		...overrides,
	};
}

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

function place(id: string, title: string): Location {
	return {
		id,
		title,
		parentId: null,
		ancestorIds: [],
		rank: id,
		icon: "crosshairs-gps",
		color: "stone",
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
	};
}

function renderCard(card: ReactElement) {
	return render(<ThemeProvider theme={lightTheme}>{card}</ThemeProvider>);
}

afterEach(() => {
	mockHome = null;
});

describe("BoardCard", () => {
	it("renders no path and no check without the props", () => {
		renderCard(<BoardCard node={node()} onOpen={() => {}} />);

		expect(screen.getByText("Fix the gutter")).toBeOnTheScreen();
		expect(screen.queryByText("board.crumbHidden")).toBeNull();
		expect(screen.UNSAFE_queryAllByProps({ name: "check" })).toHaveLength(0);
	});

	it("renders nothing at all for an empty path", () => {
		renderCard(<BoardCard node={node()} onOpen={() => {}} path={[]} />);

		expect(screen.queryByText("board.crumbHidden")).toBeNull();
		expect(
			screen.UNSAFE_queryAllByProps({ name: "chevron-right" }),
		).toHaveLength(0);
	});

	it("renders a two-crumb path root first, joined by chevrons", () => {
		renderCard(
			<BoardCard
				node={node()}
				onOpen={() => {}}
				path={["Projects", "Bathroom"]}
			/>,
		);

		expect(
			screen.getByLabelText('board.pathA11y:{"path":"Projects, Bathroom"}'),
		).toBeOnTheScreen();
		expect(screen.getByText(/Projects/)).toBeOnTheScreen();
		expect(screen.getByText(/Bathroom/)).toBeOnTheScreen();
		expect(screen.UNSAFE_getAllByProps({ name: "chevron-right" })).toHaveLength(
			1,
		);
	});

	it("renders a hidden crumb in its own position, not a gap", () => {
		renderCard(
			<BoardCard node={node()} onOpen={() => {}} path={[null, "Bathroom"]} />,
		);

		expect(screen.getByText(/board.crumbHidden/)).toBeOnTheScreen();
		expect(
			screen.getByLabelText(
				'board.pathA11y:{"path":"board.crumbHidden, Bathroom"}',
			),
		).toBeOnTheScreen();
	});

	it("keeps a long path on one line, eliding at the end", () => {
		renderCard(
			<BoardCard
				node={node()}
				onOpen={() => {}}
				path={["Husprojekt", "Renovering", "Badrummet"]}
			/>,
		);

		const eyebrow = screen.getByLabelText(
			'board.pathA11y:{"path":"Husprojekt, Renovering, Badrummet"}',
		);
		expect(eyebrow.props.numberOfLines).toBe(1);
	});

	it("marks a done card with a check and a muted title", () => {
		renderCard(<BoardCard node={node({ status: "done" })} onOpen={() => {}} />);

		expect(screen.UNSAFE_getAllByProps({ name: "check" })).toHaveLength(1);
	});

	it("marks no other status with the check or the muted title", () => {
		renderCard(
			<BoardCard node={node({ status: "execution" })} onOpen={() => {}} />,
		);

		expect(screen.UNSAFE_queryAllByProps({ name: "check" })).toHaveLength(0);
	});

	it("draws the gutter even when the card has neither a priority nor a label", () => {
		renderCard(<BoardCard node={node()} onOpen={() => {}} />);

		expect(screen.getByTestId("card-gutter")).toBeOnTheScreen();
	});

	it("names the priority on the gutter's dot, not as a word", () => {
		renderCard(
			<BoardCard node={node({ priority: "high" })} onOpen={() => {}} />,
		);

		expect(screen.getByLabelText("priority.high")).toBeOnTheScreen();
		expect(screen.queryByText("priority.high")).toBeNull();
	});

	it("renders the trail's labels exactly like the card's own, deduplicated, capped at six", () => {
		mockHome = {
			labels: [
				label("l1", { title: "Home Assistant" }),
				label("l2"),
				label("l3"),
				label("l4"),
				label("l5"),
				label("l6"),
				label("l7"),
			],
		};
		renderCard(
			<BoardCard
				node={node({ labelIds: ["l1", "l2", "l3", "l4", "l5", "l6", "l8"] })}
				onOpen={() => {}}
				ancestorLabelIds={["l1"]}
			/>,
		);

		// Own `l1` and inherited `l1` are one dot — `getByLabelText` would throw
		// on two — so the six applied-and-defined ids draw six dots: `l7` is
		// defined but not applied, `l8` applied but its definition is gone.
		expect(screen.getByLabelText("Home Assistant")).toBeOnTheScreen();
		expect(
			screen.getAllByLabelText(/^(Label l\d|Home Assistant)$/),
		).toHaveLength(6);
	});

	it("renders nothing in the gutter when no label applies", () => {
		mockHome = { labels: [label("l1")] };
		renderCard(<BoardCard node={node()} onOpen={() => {}} />);

		expect(screen.queryByLabelText("Label l1")).toBeNull();
	});

	it("carries the location's leaf name and the effort word in the footer", () => {
		renderCard(
			<BoardCard
				node={node({ locationId: "loc-1", effort: "evening" })}
				onOpen={() => {}}
				locations={new Map([["loc-1", place("loc-1", "Workshop")]])}
			/>,
		);

		expect(screen.getByText("Workshop")).toBeOnTheScreen();
		expect(screen.getByText("effort.evening")).toBeOnTheScreen();
	});

	it("says nothing about a location the map cannot answer", () => {
		renderCard(
			<BoardCard
				node={node({ locationId: "loc-gone" })}
				onOpen={() => {}}
				locations={new Map([["loc-1", place("loc-1", "Workshop")]])}
			/>,
		);

		expect(screen.queryByText("Workshop")).toBeNull();
	});

	it("shows the trail's place on a card that carries none of its own (#296)", () => {
		renderCard(
			<BoardCard
				node={node()}
				onOpen={() => {}}
				ancestorLocationId="loc-1"
				locations={new Map([["loc-1", place("loc-1", "Workshop")]])}
			/>,
		);

		expect(screen.getByText("Workshop")).toBeOnTheScreen();
	});

	it("keeps the card's own place over the trail's (#296)", () => {
		renderCard(
			<BoardCard
				node={node({ locationId: "loc-2" })}
				onOpen={() => {}}
				ancestorLocationId="loc-1"
				locations={
					new Map([
						["loc-1", place("loc-1", "Workshop")],
						["loc-2", place("loc-2", "Attic")],
					])
				}
			/>,
		);

		expect(screen.getByText("Attic")).toBeOnTheScreen();
		expect(screen.queryByText("Workshop")).toBeNull();
	});

	it("keeps overdue as words in the footer", () => {
		renderCard(
			<BoardCard node={node({ dueDate: "2001-02-03" })} onOpen={() => {}} />,
		);

		expect(screen.getByText(/board\.dueLate/)).toBeOnTheScreen();
	});

	it("keeps the waiting mark in the footer, not on its own row", () => {
		const blocker = node({ id: "b1", status: "backlog" });
		renderCard(
			<BoardCard
				node={node({ blockedBy: ["b1"] })}
				onOpen={() => {}}
				blockers={new Map([["b1", blocker]])}
			/>,
		);

		expect(screen.getByText("board.blocked")).toBeOnTheScreen();
	});

	it("carries the path label in both locales", () => {
		expect(enUS.board.pathA11y.length).toBeGreaterThan(0);
		expect(svSE.board.pathA11y.length).toBeGreaterThan(0);
	});

	it("renders no pressable at all without onOpen and a menu", () => {
		renderCard(<BoardCard node={node()} />);

		expect(
			screen.UNSAFE_queryAllByProps({ onPress: expect.any(Function) }),
		).toHaveLength(0);
	});

	it("renders the linked trail as links that wrap, and the tap names the crumb's own node", () => {
		const onOpenCrumb = jest.fn();
		renderCard(
			<BoardCard
				node={node()}
				linkedTrail={{
					crumbs: [
						{ id: "p1", node: node({ id: "p1", title: "House" }) },
						{ id: "gone", node: null },
						{ id: "p2", node: node({ id: "p2", title: "Bathroom" }) },
					],
					onOpenCrumb,
				}}
			/>,
		);

		// The linked trail replaces the elided line — one trail, not both.
		expect(screen.queryByLabelText(/board\.pathA11y/)).toBeNull();
		expect(screen.getByRole("link", { name: "House" })).toBeOnTheScreen();
		expect(screen.getByRole("link", { name: "Bathroom" })).toBeOnTheScreen();

		// A crumb the map cannot answer stays the neutral crumb, not a link.
		expect(screen.getByText("board.crumbHidden")).toBeOnTheScreen();
		expect(
			screen.queryByRole("link", { name: "board.crumbHidden" }),
		).toBeNull();

		fireEvent.press(screen.getByRole("link", { name: "Bathroom" }));
		expect(onOpenCrumb).toHaveBeenCalledWith("p2");
	});
});
