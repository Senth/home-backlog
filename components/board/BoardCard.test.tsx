import { render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { ThemeProvider } from "react-native-paper";
import { BoardCard } from "@/components/board/BoardCard";
import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";
import { defaultColumns, type Node } from "@/models/node";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	// The keys are asserted rather than the sentences: both locale files are
	// checked for parity by `yarn invariants`, and a test that pinned the
	// English would fail on a rewording that is not a behaviour change.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({ activeHome: null }),
}));

// The real icon set loads its font map asynchronously, which warns about
// updates outside `act` and renders nothing until it lands. A test double
// that carries the glyph name is enough — the glyph itself is Paper's.
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	return {
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

function renderCard(card: ReactElement) {
	return render(<ThemeProvider theme={lightTheme}>{card}</ThemeProvider>);
}

// Paper composes the variant's own styles with the ones passed in, so the
// colour lives somewhere inside a tree of arrays.
function flattenedTitleStyles() {
	return [screen.getByText("Fix the gutter").props.style].flat(Infinity) as {
		color?: string;
	}[];
}

describe("BoardCard", () => {
	it("renders no path and no check without the props", () => {
		renderCard(<BoardCard node={node()} onOpen={() => {}} />);

		expect(screen.getByText("Fix the gutter")).toBeOnTheScreen();
		expect(screen.queryByText("board.crumbHidden")).toBeNull();
		expect(screen.UNSAFE_queryAllByProps({ name: "check" })).toHaveLength(0);
		expect(flattenedTitleStyles()).not.toContainEqual({
			color: lightTheme.colors.onCardMuted,
		});
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
		expect(flattenedTitleStyles()).toContainEqual({
			color: lightTheme.colors.onCardMuted,
		});
	});

	it("marks no other status with the check or the muted title", () => {
		renderCard(
			<BoardCard node={node({ status: "execution" })} onOpen={() => {}} />,
		);

		expect(screen.UNSAFE_queryAllByProps({ name: "check" })).toHaveLength(0);
		expect(flattenedTitleStyles()).not.toContainEqual({
			color: lightTheme.colors.onCardMuted,
		});
	});

	it("carries the path label in both locales", () => {
		expect(enUS.board.pathA11y.length).toBeGreaterThan(0);
		expect(svSE.board.pathA11y.length).toBeGreaterThan(0);
	});
});
