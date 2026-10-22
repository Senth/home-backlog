import { act, renderHook } from "@testing-library/react-native";
import { useCardSelection } from "@/hooks/use-card-selection";

let mockFocused = true;
jest.mock("@react-navigation/native", () => ({
	useIsFocused: () => mockFocused,
}));

const first = { id: "first", status: "backlog" } as const;
const second = { id: "second", status: "backlog" } as const;
const empty = { status: null, ids: [], anchor: null };

beforeEach(() => {
	mockFocused = true;
});

it("starts empty, stays selecting after the last card is deselected, and clears explicitly", async () => {
	const { result } = await renderHook(() =>
		useCardSelection("home root", true),
	);
	await act(() => result.current.start());
	expect(result.current.selecting).toBe(true);
	expect(result.current.state).toEqual(empty);
	await act(() => result.current.toggleCard(first));
	await act(() => result.current.toggleCard(first));
	expect(result.current.selecting).toBe(true);
	expect(result.current.state).toEqual(empty);
	await act(() => result.current.clear());
	expect(result.current.selecting).toBe(false);
	expect(result.current.moveAnchor).toBeNull();
});

it("prunes hidden and moved cards without resurrecting them when visible again", async () => {
	const { result } = await renderHook(() =>
		useCardSelection("home root", true),
	);
	await act(() => {
		result.current.toggleCard(first);
		result.current.toggleCard(second);
	});
	await act(() => result.current.pruneVisible([second]));
	expect(result.current.state.ids).toEqual(["second"]);
	await act(() =>
		result.current.pruneVisible([first, { ...second, status: "done" }]),
	);
	expect(result.current.state).toEqual(empty);
	await act(() => result.current.pruneVisible([first, second]));
	expect(result.current.state).toEqual(empty);
});

it.each(["board changes", "reach changes", "screen loses focus"])(
	"clears selection when %s",
	async (change) => {
		const hook = await renderHook(
			({ board, enabled }: { board: string; enabled: boolean }) =>
				useCardSelection(board, enabled),
			{ initialProps: { board: "home root", enabled: true } },
		);
		await act(() => hook.result.current.toggleCard(first));
		if (change === "screen loses focus") mockFocused = false;
		await hook.rerender({
			board: change === "board changes" ? "home project" : "home root",
			enabled: change !== "reach changes",
		});
		expect(hook.result.current.state).toEqual(empty);
		mockFocused = true;
		await hook.rerender({ board: "home root", enabled: true });
		expect(hook.result.current.state).toEqual(empty);
	},
);

it("uses the visible order for ranges and rejects another column", async () => {
	const { result } = await renderHook(() =>
		useCardSelection("home root", true),
	);
	await act(() => result.current.toggleCard(first));
	await act(() => result.current.selectRange(second, [first, second]));
	expect(result.current.state.ids).toEqual(["first", "second"]);
	await act(() =>
		result.current.toggleCard({ id: "elsewhere", status: "done" }),
	);
	expect(result.current.state.ids).toEqual(["first", "second"]);
});
