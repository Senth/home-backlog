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

async function pressEscape(defaultPrevented = false) {
	const event = new KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	if (defaultPrevented) event.preventDefault();
	await act(() => {
		document.dispatchEvent(event);
	});
}

it("closes the focused pane and removes its listener when inactive or unmounted", async () => {
	const close = jest.fn();
	const view = await render(<Pane onClose={close} />);
	await pressEscape();
	expect(close).toHaveBeenCalledTimes(1);
	await view.rerender(<Pane active={false} onClose={close} />);
	await pressEscape();
	await view.unmount();
	await pressEscape();
	expect(close).toHaveBeenCalledTimes(1);
});

it("leaves Escape to an open editor or visible menu", async () => {
	const close = jest.fn();
	const view = await render(<Pane onClose={close} />);
	await pressEscape(true);
	expect(close).not.toHaveBeenCalled();
	const item = document.createElement("div");
	item.setAttribute("role", "menuitem");
	item.getClientRects = () => [{}] as unknown as DOMRectList;
	document.body.append(item);
	await pressEscape();
	expect(close).not.toHaveBeenCalled();
	item.style.pointerEvents = "none";
	await pressEscape();
	expect(close).toHaveBeenCalledTimes(1);
	item.remove();
	await pressEscape();
	expect(close).toHaveBeenCalledTimes(2);
	await view.unmount();
});
