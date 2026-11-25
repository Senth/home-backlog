import { renderHook } from "@testing-library/react-native";
import { useFinishParam } from "@/hooks/use-finish-param";

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
		({ ready }: { ready: boolean }) => useFinishParam(ready, onFinish),
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
	expect(onFinish).toHaveBeenCalledWith("project");
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
	await renderHook(() => useFinishParam(true, onFinish));

	expect(mockSetParams).toHaveBeenCalledWith({ finish: undefined });
	expect(onFinish).not.toHaveBeenCalled();
});
