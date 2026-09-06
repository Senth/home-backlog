import { act, renderHook } from "@testing-library/react-native";
import { useLabelAncestors } from "@/hooks/use-label-ancestors";
import type { Node } from "@/models/node";
import { newNodeData } from "@/models/node";

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "uid-me" } }),
}));

jest.mock("@/data/nodes", () => ({ getNode: jest.fn() }));

import { getNode } from "@/data/nodes";

beforeEach(() => {
	jest.clearAllMocks();
});

function aNode(id: string): Node {
	return {
		...newNodeData({ title: id, rank: "a0", participantIds: ["me"] }),
		id,
		completedAt: null,
		createdAt: null,
		createdBy: "me",
		updatedAt: null,
	};
}

describe("useLabelAncestors", () => {
	it("fetches only the ancestors the pool does not hold", async () => {
		jest
			.mocked(getNode)
			.mockImplementation(async (_home, id) =>
				id === "done-1" ? aNode("done-1") : null,
			);

		const { result } = renderHook(() =>
			useLabelAncestors(
				"home-1",
				["active", "done-1", "gone"],
				[aNode("active")],
			),
		);
		await act(async () => {});

		expect(result.current.get("active")).toMatchObject({ id: "active" });
		expect(result.current.get("done-1")).toMatchObject({ id: "done-1" });
		// A gone or unreadable ancestor answers null and contributes nothing.
		expect(result.current.get("gone")).toBeNull();
		expect(getNode).toHaveBeenCalledTimes(2);
		const [home, id] = jest.mocked(getNode).mock.calls[0];
		expect(home).toBe("home-1");
		expect(id).toBe("done-1");
	});

	it("answers a repeated read from the session cache", async () => {
		jest.mocked(getNode).mockImplementation(async (_home, id) => aNode(id));

		const first = renderHook(() =>
			useLabelAncestors("home-1", ["cached-1"], []),
		);
		await act(async () => {});
		expect(first.result.current.get("cached-1")).not.toBeNull();

		const second = renderHook(() =>
			useLabelAncestors("home-1", ["cached-1"], []),
		);
		await act(async () => {});
		expect(second.result.current.get("cached-1")).not.toBeNull();
		expect(getNode).toHaveBeenCalledTimes(1);
	});

	it("prefers the pool when a snapshot later delivers the ancestor", async () => {
		jest.mocked(getNode).mockImplementation(async (_home, id) => aNode(id));

		const { result, rerender } = renderHook(
			({ pool }: { pool: Node[] }) =>
				useLabelAncestors("home-1", ["live-1"], pool),
			{ initialProps: { pool: [] as Node[] } },
		);
		await act(async () => {});
		expect(result.current.get("live-1")).not.toBeNull();

		const fromPool = aNode("live-1");
		rerender({ pool: [fromPool] });
		await act(async () => {});
		expect(result.current.get("live-1")).toBe(fromPool);
		expect(getNode).toHaveBeenCalledTimes(1);
	});

	it("does not merge the previous home's reads across a home change", async () => {
		jest.mocked(getNode).mockImplementation(async (_home, id) => aNode(id));

		const { result, rerender } = renderHook(
			({ homeId }: { homeId: string }) =>
				useLabelAncestors(homeId, ["cross-1"], []),
			{ initialProps: { homeId: "home-1" } },
		);
		await act(async () => {});
		expect(result.current.get("cross-1")).not.toBeNull();

		rerender({ homeId: "home-2" });
		expect(result.current.get("cross-1")).toBeNull();

		await act(async () => {});
		expect(result.current.get("cross-1")).toMatchObject({ id: "cross-1" });
	});
});
