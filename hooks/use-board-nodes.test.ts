import { renderHook } from "@testing-library/react-native";
import {
	participatingBoardQuery,
	participatingDoneQuery,
	participatingPoolQuery,
	sharedBoardQuery,
	sharedDoneQuery,
	sharedPoolQuery,
} from "@/data/nodes";
import { subtreeNodes, useBoardNodes } from "@/hooks/use-board-nodes";
import type { Node } from "@/models/node";
import { defaultColumns } from "@/models/node";

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "uid-me" } }),
}));

jest.mock("@/contexts/DashboardCardsContext", () => ({
	// `useOverviewPair` rides in from `use-overview`, whose module pulls the
	// card config in; the board's done window is floored, never config-driven.
	useDashboardCardsConfig: () => ({ cards: [] }),
}));

jest.mock("@/data/nodes", () => ({
	sharedBoardQuery: jest.fn(),
	participatingBoardQuery: jest.fn(),
	sharedPoolQuery: jest.fn(),
	participatingPoolQuery: jest.fn(),
	sharedDoneQuery: jest.fn(),
	participatingDoneQuery: jest.fn(),
}));

jest.mock("@/hooks/use-paired-listener", () => ({
	usePairedListener: jest.fn(() => ({
		nodes: [],
		loading: false,
		failed: false,
		retry: () => {},
	})),
}));

import { usePairedListener } from "@/hooks/use-paired-listener";

/**
 * One render's worth of `usePairedListener` calls: board, pool, done — the
 * same last-render slice `use-overview.test.ts` reads.
 */
function pairs() {
	return jest
		.mocked(usePairedListener)
		.mock.calls.slice(-3)
		.map(([key, build]) => ({ key, build }));
}

const node = (id: string, ancestorIds: string[]): Node => ({
	id,
	title: id,
	status: "backlog",
	rank: "a0",
	parentId: ancestorIds.at(-1) ?? null,
	ancestorIds,
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
	createdBy: "uid-me",
	updatedAt: null,
});

describe("useBoardNodes", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("this-board reach builds the board pair and nothing else", () => {
		renderHook(() => useBoardNodes("home-1", "board-1", "board"));

		for (const { build } of pairs()) {
			void build();
		}

		expect(jest.mocked(sharedBoardQuery)).toHaveBeenCalledWith(
			"home-1",
			"board-1",
		);
		expect(jest.mocked(participatingBoardQuery)).toHaveBeenCalledWith(
			"home-1",
			"board-1",
			"uid-me",
		);
		expect(jest.mocked(sharedPoolQuery)).not.toHaveBeenCalled();
		expect(jest.mocked(sharedDoneQuery)).not.toHaveBeenCalled();
	});

	it("subtree reach builds the pool pair and the done pair, and not the board pair", () => {
		renderHook(() => useBoardNodes("home-1", "board-1", "subtree"));

		for (const { build } of pairs()) {
			void build();
		}

		expect(jest.mocked(sharedPoolQuery)).toHaveBeenCalledWith(
			"home-1",
			undefined,
		);
		expect(jest.mocked(participatingPoolQuery)).toHaveBeenCalledWith(
			"home-1",
			"uid-me",
			undefined,
		);
		// The done arm is the windowed pair, floored at the default window —
		// the board has no card config to widen it with.
		expect(jest.mocked(sharedDoneQuery)).toHaveBeenCalledWith("home-1", 30);
		expect(jest.mocked(participatingDoneQuery)).toHaveBeenCalledWith(
			"home-1",
			"uid-me",
			30,
		);
		expect(jest.mocked(sharedBoardQuery)).not.toHaveBeenCalled();
		expect(jest.mocked(participatingBoardQuery)).not.toHaveBeenCalled();
	});

	it("re-keys every pair when the reach changes, so no stale rows survive", () => {
		const view = renderHook(
			({ reach }: { reach: "board" | "subtree" }) =>
				useBoardNodes("home-1", "board-1", reach),
			{ initialProps: { reach: "board" as "board" | "subtree" } },
		);
		const before = pairs();

		view.rerender({ reach: "subtree" });
		const after = pairs();

		expect(after).toHaveLength(before.length);
		for (let index = 0; index < after.length; index += 1) {
			expect(after[index].key).not.toBe(before[index].key);
			expect(after[index].build).not.toBe(before[index].build);
		}
	});
});

describe("subtreeNodes", () => {
	const board = "board-1";
	const here = node("here", [board]);
	const deep = node("deep", ["root-1", "under-board", board]);
	const elsewhere = node("elsewhere", ["other-root"]);

	it("keeps the cards below the board, at any depth", () => {
		const picked = subtreeNodes([here, deep, elsewhere], board);
		// Equal ranks tie-break on id, the board's own order.
		expect(picked.map((card) => card.id)).toEqual(["deep", "here"]);
	});

	it("the root board applies no ancestor test — everything below it is the home", () => {
		const picked = subtreeNodes([here, deep, elsewhere], null);
		expect(picked).toHaveLength(3);
	});

	it("sorts the unordered pool into the board's own (rank, id) order", () => {
		const late = { ...node("late", [board]), rank: "z9" };
		const picked = subtreeNodes([late, here], board);
		expect(picked.map((card) => card.id)).toEqual(["here", "late"]);
	});
});
