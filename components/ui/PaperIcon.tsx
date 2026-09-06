import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ComponentProps } from "react";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

/**
 * Props react-native-paper hands its icon renderer.
 *
 * Written out rather than imported from
 * `react-native-paper/lib/typescript/components/MaterialCommunityIcon`, which is
 * an internal path with no stability promise.
 */
type PaperIconProps = {
	name: string;
	color?: string;
	size: number;
	direction?: "rtl" | "ltr";
	testID?: string;
};

/**
 * Every Paper icon, hidden from the accessibility tree.
 *
 * Paper renders its icons as glyphs in an icon font, which React Native Web
 * gives `role="img"` and no accessible name — so a screen reader announces
 * "image" on every chevron, check and plus in the app, and axe reports
 * `role-img-alt` on every screen.
 *
 * They are decorative in every case, because the *control* is what carries the
 * name: `IconButton` takes an `accessibilityLabel`, and where an icon is the
 * only content it sits inside a labelled `accessible` wrapper — see the "current
 * home" check in `app/(app)/homes/index.tsx`. Hiding the glyph leaves that label
 * as the single thing announced, which is what it was always supposed to be.
 *
 * Installed once, on `PaperProvider`'s `settings.icon` in `app/_layout.tsx`,
 * rather than per icon. There is no prop on Paper's components that reaches the
 * glyph, and 40-odd call sites would each have to remember.
 */
export function PaperIcon({
	name,
	color,
	size,
	direction,
	testID,
}: PaperIconProps) {
	// Paper calls `settings.icon` as a plain function, not as a component — see
	// `Icon.js`, which does `icon({ name, color, size, ... })` inside a context
	// consumer. This project builds with the React Compiler (`app.json`,
	// `experiments.reactCompiler`), which injects a `useMemoCache` hook into
	// every capitalised function it takes for a component. That hook then runs
	// outside a render and React throws "Invalid hook call", blanking the app.
	// Opting this one function out is the fix; renaming it to something
	// lowercase would work by accident and break the day someone tidied it.
	"use no memo";

	return (
		<MaterialCommunityIcons
			name={name as IconName}
			color={color}
			size={size}
			testID={testID}
			aria-hidden
			// Paper's own renderer mirrors icons in right-to-left layouts. Neither
			// en-US nor sv-SE is RTL, but dropping the behavior here would make
			// this a downgrade rather than a fix.
			style={direction === "rtl" ? { transform: [{ scaleX: -1 }] } : undefined}
		/>
	);
}
