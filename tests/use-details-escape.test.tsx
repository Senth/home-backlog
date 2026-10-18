/** @jest-environment jsdom */
import { act, render } from "@testing-library/react-native";
import { useDetailsEscape } from "@/hooks/use-details-escape.web";

function Pane({
	active = true,
	onClose,
}: {
	active?: boolean;
	onClose: () => void;
}) {
	useDetailsEscape(active, onClose);
	return null;
}

function pressEscape(defaultPrevented = false) {
	const event = new KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	if (defaultPrevented) event.preventDefault();
	act(() => {
		document.dispatchEvent(event);
	});
}

it("closes the focused pane and removes its listener when inactive or unmounted", () => {
	const close = jest.fn();
	const view = render(<Pane onClose={close} />);
	pressEscape();
	expect(close).toHaveBeenCalledTimes(1);
	view.rerender(<Pane active={false} onClose={close} />);
	pressEscape();
	view.unmount();
	pressEscape();
	expect(close).toHaveBeenCalledTimes(1);
});

it("leaves Escape to an open editor or visible menu", () => {
	const close = jest.fn();
	const view = render(<Pane onClose={close} />);
	pressEscape(true);
	expect(close).not.toHaveBeenCalled();
	const item = document.createElement("div");
	item.setAttribute("role", "menuitem");
	item.getClientRects = () => [{}] as unknown as DOMRectList;
	document.body.append(item);
	pressEscape();
	expect(close).not.toHaveBeenCalled();
	item.style.pointerEvents = "none";
	pressEscape();
	expect(close).toHaveBeenCalledTimes(1);
	item.remove();
	pressEscape();
	expect(close).toHaveBeenCalledTimes(2);
	view.unmount();
});
