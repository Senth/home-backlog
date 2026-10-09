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

it("prunes hidden and moved cards without resurrecting them when visible again", () => {
	const { result } = renderHook(() => useCardSelection("home root", true));
	act(() => {
		result.current.toggleCard(first);
		result.current.toggleCard(second);
	});
	act(() => result.current.pruneVisible([second]));
	expect(result.current.state.ids).toEqual(["second"]);
	act(() =>
		result.current.pruneVisible([first, { ...second, status: "done" }]),
	);
	expect(result.current.state).toEqual(empty);
	act(() => result.current.pruneVisible([first, second]));
	expect(result.current.state).toEqual(empty);
});

it.each(["board changes", "reach changes", "screen loses focus"])(
	"clears selection when %s",
	(change) => {
		const hook = renderHook(
			({ board, enabled }: { board: string; enabled: boolean }) =>
				useCardSelection(board, enabled),
			{ initialProps: { board: "home root", enabled: true } },
		);
		act(() => hook.result.current.toggleCard(first));
		if (change === "screen loses focus") mockFocused = false;
		hook.rerender({
			board: change === "board changes" ? "home project" : "home root",
			enabled: change !== "reach changes",
		});
		expect(hook.result.current.state).toEqual(empty);
		mockFocused = true;
		hook.rerender({ board: "home root", enabled: true });
		expect(hook.result.current.state).toEqual(empty);
	},
);

it("uses the visible order for ranges and rejects another column", () => {
	const { result } = renderHook(() => useCardSelection("home root", true));
	act(() => result.current.toggleCard(first));
	act(() => result.current.selectRange(second, [first, second]));
	expect(result.current.state.ids).toEqual(["first", "second"]);
	act(() => result.current.toggleCard({ id: "elsewhere", status: "done" }));
	expect(result.current.state.ids).toEqual(["first", "second"]);
});
