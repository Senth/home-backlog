import { type ComponentProps, useRef } from "react";
import { View } from "react-native";
import { Menu } from "react-native-paper";

type AppMenuProps = ComponentProps<typeof Menu>;

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
	const openedRef = useRef(false);
	openedRef.current ||= visible;
	const opened = openedRef.current;

	if (!opened) {
		// A `{ x, y }` anchor is a position, not an element: there is nothing to
		// render for it before the first open.
		const { anchor } = props;
		if (anchor !== null && typeof anchor === "object" && "x" in anchor) {
			return null;
		}
		// Paper wraps the anchor in this same view, so keeping it here makes the
		// anchor's box identical before and after the first open.
		return <View collapsable={false}>{anchor}</View>;
	}

	return (
		<Menu visible={visible} {...props}>
			{children}
		</Menu>
	);
}
