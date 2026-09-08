/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react-native";
import { useModalFocus } from "@/hooks/use-modal-focus.web";

function Modal({
	testID,
	onDismiss,
}: {
	testID: string;
	onDismiss: () => void;
}) {
	useModalFocus(true, testID, onDismiss);
	return null;
}

describe("useModalFocus", () => {
	beforeAll(() => {
		// The opening pull-in rides `requestAnimationFrame`, which this jsdom
		// environment does not ship; the Escape rule under test never needs a
		// frame to actually run.
		globalThis.requestAnimationFrame = () => 0;
		globalThis.cancelAnimationFrame = () => {};
	});

	it("one Escape dismisses only the topmost of two mounted modals", () => {
		const dismissOuter = jest.fn();
		const dismissInner = jest.fn();

		const view = render(
			<>
				<Modal testID="outer" onDismiss={dismissOuter} />
				<Modal testID="inner" onDismiss={dismissInner} />
			</>,
		);

		act(() => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(dismissInner).toHaveBeenCalledTimes(1);
		expect(dismissOuter).not.toHaveBeenCalled();

		// With the inner one gone, the outer answers the next key.
		act(() => {
			view.rerender(<Modal testID="outer" onDismiss={dismissOuter} />);
		});
		act(() => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(dismissInner).toHaveBeenCalledTimes(1);
		expect(dismissOuter).toHaveBeenCalledTimes(1);

		view.unmount();
	});
});
