import { type ComponentProps, type ReactNode, useState } from "react";
import { Menu } from "react-native-paper";

/**
 * Paper allows a `{ x, y }` anchor, which has nothing to render before the first
 * open. Every menu here anchors to an element, so the wrapper requires one.
 */
type AppMenuProps = Omit<ComponentProps<typeof Menu>, "anchor"> & {
	anchor: ReactNode;
};

/**
 * Paper's `Menu`, without the scroll jump a closed one causes on mount.
 *
 * `Menu` initialises `prevVisible` to `null`, so the first render of a **closed**
 * menu takes the `null !== false` branch and runs the hide path, whose animation
 * callback focuses the first focusable node inside the anchor. On the web that
 * scrolls every scrollable ancestor to that trigger, so a list of rows arrives
 * scrolled to its last row.
 *
 * Rendering the anchor plainly until the first open skips that path entirely.
 * Mounting straight into `visible` is safe: Paper initialises `rendered` from
 * `visible`, so its second effect still runs `show()` and animates in. Once
 * mounted the `Menu` stays mounted, so closing keeps returning focus to the
 * trigger.
 */
export function AppMenu({ visible, children, ...props }: AppMenuProps) {
	const [opened, setOpened] = useState(visible);

	if (visible && !opened) {
		setOpened(true);
	}

	if (!opened) {
		return <>{props.anchor}</>;
	}

	return (
		<Menu visible={visible} {...props}>
			{children}
		</Menu>
	);
}
