import { renderHook } from "@testing-library/react-native";
import { requestProjectFinish, useFinishParam } from "@/hooks/use-finish-param";
import { useNodes } from "@/hooks/use-nodes";

let mockFinish: string | string[] | undefined;
let mockFocused = true;
const mockSetParams = jest.fn();

jest.mock("expo-router", () => ({
	useLocalSearchParams: () => ({ finish: mockFinish }),
	useRouter: () => ({ setParams: mockSetParams }),
}));
jest.mock("expo-router/react-navigation", () => ({
	useIsFocused: () => mockFocused,
}));
jest.mock("@/contexts/OutboxContext", () => ({
	useOutbox: () => ({ intents: [] }),
}));
jest.mock("@/hooks/use-nodes", () => ({ useNodes: jest.fn() }));

beforeEach(() => {
	jest.mocked(useNodes).mockReturnValue({
		nodes: [],
		loading: false,
		failed: false,
		retry: jest.fn(),
	});
});

it("clears each bare URL once on the loaded, focused board without handing it off", async () => {
	mockFinish = "project";
	mockFocused = false;
	const onFinish = jest.fn();
	const view = await renderHook(
		({ ready }: { ready: boolean }) =>
			useFinishParam("home", null, ready, onFinish),
		{
			initialProps: { ready: false },
		},
	);

	mockFocused = true;
	await view.rerender({ ready: false });
	expect(onFinish).not.toHaveBeenCalled();
	expect(mockSetParams).not.toHaveBeenCalled();

	mockFocused = false;
	await view.rerender({ ready: true });
	expect(onFinish).not.toHaveBeenCalled();
	expect(mockSetParams).not.toHaveBeenCalled();

	mockFocused = true;
	await view.rerender({ ready: true });
	expect(onFinish).not.toHaveBeenCalled();
	expect(mockSetParams).toHaveBeenCalledWith({ finish: undefined });

	await view.rerender({ ready: false });
	await view.rerender({ ready: true });
	expect(onFinish).not.toHaveBeenCalled();
	expect(mockSetParams).toHaveBeenCalledTimes(1);

	mockFinish = undefined;
	await view.rerender({ ready: true });
	expect(onFinish).not.toHaveBeenCalled();
	expect(mockSetParams).toHaveBeenCalledTimes(1);

	mockFinish = "project";
	await view.rerender({ ready: true });
	expect(onFinish).not.toHaveBeenCalled();
	expect(mockSetParams).toHaveBeenCalledTimes(2);
});

it("clears a malformed finish param without handing it off", async () => {
	mockFinish = ["first", "second"];
	const onFinish = jest.fn();
	await renderHook(() => useFinishParam("home", null, true, onFinish));

	expect(mockSetParams).toHaveBeenCalledWith({ finish: undefined });
	expect(onFinish).not.toHaveBeenCalled();
});

it("only the tapped project's loaded parent can consume travel without a URL param", async () => {
	mockFinish = undefined;
	const onFinish = jest.fn();
	requestProjectFinish("home", "parent", "project");
	const view = await renderHook(
		({
			home,
			parent,
			ready,
		}: {
			home: string;
			parent: string;
			ready: boolean;
		}) => useFinishParam(home, parent, ready, onFinish),
		{ initialProps: { home: "other", parent: "parent", ready: true } },
	);
	await view.rerender({ home: "home", parent: "sibling", ready: true });
	await view.rerender({ home: "home", parent: "parent", ready: false });
	expect(onFinish).not.toHaveBeenCalled();
	await view.rerender({ home: "home", parent: "parent", ready: true });
	expect(onFinish).toHaveBeenCalledWith("project", []);
	await view.rerender({ home: "home", parent: "parent", ready: false });
	await view.rerender({ home: "home", parent: "parent", ready: true });
	expect(onFinish).toHaveBeenCalledTimes(1);
	expect(mockSetParams).not.toHaveBeenCalled();
});
