import { renderHook } from "@testing-library/react-native";
import { useWaitingMark } from "@/components/board/waiting-mark";
import { defaultColumns, type Node, type Status } from "@/models/node";

jest.mock("react-i18next", () => ({
	// The keys are asserted rather than the sentences: both locale files are
	// checked for parity by `yarn invariants`, and a test that pinned the
	// English would fail on a rewording that is not a behavior change.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
	}),
}));

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

function blocker(id: string, status: Status): Node {
	return node({ id, title: `Blocker ${id}`, status });
}

describe("useWaitingMark", () => {
	it("does not mark a card with no blockers", () => {
		const { result } = renderHook(() => useWaitingMark(node(), new Map()));
		expect(result.current.isWaiting).toBe(false);
	});

	it("waits on a blocker nobody has answered for — missing waits", () => {
		const card = node({ blockedBy: ["blocker-1"] });
		const { result } = renderHook(() => useWaitingMark(card, new Map()));
		expect(result.current.isWaiting).toBe(true);
	});

	it("stops waiting when the blocker is done, without being removed", () => {
		const card = node({ blockedBy: ["blocker-1"] });
		const { result } = renderHook(() =>
			useWaitingMark(
				card,
				new Map([["blocker-1", blocker("blocker-1", "done")]]),
			),
		);
		expect(result.current.isWaiting).toBe(false);
	});

	it("never marks a card in Done, whatever its list holds", () => {
		const card = node({ status: "done", blockedBy: ["blocker-1"] });
		const { result } = renderHook(() =>
			useWaitingMark(
				card,
				new Map([["blocker-1", blocker("blocker-1", "backlog")]]),
			),
		);
		expect(result.current.isWaiting).toBe(false);
	});

	it("says plain Waiting for one blocker and carries the count past one", () => {
		const card = node({ blockedBy: ["blocker-1", "blocker-2"] });
		const { result } = renderHook(() =>
			useWaitingMark(
				card,
				new Map([["blocker-1", blocker("blocker-1", "done")]]),
			),
		);
		expect(result.current.label).toBe("board.blocked");
	});

	it("carries the count and the plural a11y label for two waiting blockers", () => {
		const card = node({ blockedBy: ["blocker-1", "blocker-2"] });
		const { result } = renderHook(() => useWaitingMark(card, new Map()));
		expect(result.current.label).toBe("board.blocked · 2");
		expect(result.current.a11yLabel).toBe('board.waitingLabel:{"count":2}');
	});
});
