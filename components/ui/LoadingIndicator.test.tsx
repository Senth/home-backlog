import { act, render, screen } from "@testing-library/react-native";
import { LoadingIndicator } from "@/components/ui/LoadingIndicator";

jest.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

describe("LoadingIndicator", () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it("shows nothing at 249ms and the labelled spinner at 250ms", async () => {
		await render(<LoadingIndicator />);
		expect(screen.queryByLabelText("common.loading")).toBeNull();

		await act(() => jest.advanceTimersByTime(249));
		expect(screen.queryByLabelText("common.loading")).toBeNull();

		await act(() => jest.advanceTimersByTime(1));
		expect(screen.getByLabelText("common.loading")).toBeTruthy();
	});

	it("cancels the wait when unmounted before 250ms", async () => {
		const clearTimer = jest.spyOn(global, "clearTimeout");
		await render(<LoadingIndicator />);
		await act(() => jest.advanceTimersByTime(249));
		await screen.unmount();
		expect(clearTimer).toHaveBeenCalled();
		clearTimer.mockRestore();
		await act(() => jest.advanceTimersByTime(1));

		await render(<LoadingIndicator />);
		expect(screen.queryByLabelText("common.loading")).toBeNull();
	});
});
