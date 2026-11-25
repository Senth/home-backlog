import { renderHook } from "@testing-library/react-native";
import { requestProjectFinish, useFinishParam } from "@/hooks/use-finish-param";

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

it("waits for a loaded, focused board and hands off each arrival once", async () => {
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
	expect(onFinish).toHaveBeenCalledWith("project", false);
	expect(mockSetParams).toHaveBeenCalledWith({ finish: undefined });

	await view.rerender({ ready: false });
	await view.rerender({ ready: true });
	expect(onFinish).toHaveBeenCalledTimes(1);
	expect(mockSetParams).toHaveBeenCalledTimes(1);

	mockFinish = undefined;
	await view.rerender({ ready: true });
	expect(onFinish).toHaveBeenCalledTimes(1);
	expect(mockSetParams).toHaveBeenCalledTimes(1);

	mockFinish = "project";
	await view.rerender({ ready: true });
	expect(onFinish).toHaveBeenCalledTimes(2);
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
	expect(onFinish).toHaveBeenCalledWith("project", true);
	await view.rerender({ home: "home", parent: "parent", ready: false });
	await view.rerender({ home: "home", parent: "parent", ready: true });
	expect(onFinish).toHaveBeenCalledTimes(1);
	expect(mockSetParams).not.toHaveBeenCalled();
});
