import { Appbar } from "react-native-paper";
import type { ThemeProp } from "react-native-paper/lib/typescript/types";
import { touchTargetStyle } from "@/theme/tokens";

interface BackActionProps {
	/** Where the arrow goes, named. A screen reader announces only this. */
	accessibilityLabel: string;
	onPress: () => void;
	/**
	 * Injected by `Appbar` itself, not passed by the screens — it clones every
	 * child it recognizes with the bar's own color and theme. Forwarded rather
	 * than swallowed, or the arrow would miss the white it is given in the dark.
	 */
	color?: string;
	theme?: ThemeProp;
}

/**
 * The app bar's back arrow, built from `Appbar.Action` rather than
 * `Appbar.BackAction`.
 *
 * `Appbar.BackAction` renders its arrow through `AppbarBackIcon`, which imports
 * Paper's own `MaterialCommunityIcon` module directly instead of going through
 * `Icon` — so it is the one glyph in the app that never reaches
 * `settings.icon`, and `PaperIcon` never gets to hide it. React Native Web then
 * exposes it as `role="img"` with no accessible name, which is a WCAG 1.1.1
 * failure and what axe reports as `role-img-alt`.
 *
 * It failed as a flake before it failed as a build: the glyph only enters the
 * DOM once the icon font has loaded, so a sweep that ran early saw a clean tree
 * and one that ran a moment later did not. That is why one screen's sweep could
 * go red while another's stayed green on the very same arrow.
 *
 * `Appbar.Action` takes its icon as a *string*, and `Icon` sends every string
 * source through `settings.icon`. Everything else here exists to make the swap
 * invisible: Paper's own `BackAction` is an `AppbarAction` with `isLeading`,
 * which is what picks `onSurface` over `onSurfaceVariant`, and `Appbar` sorts
 * its children by `displayName` — `Appbar.BackAction` is rendered in a pass of
 * its own, before everything else, and is the reason `Appbar.Content` gets no
 * extra left margin. Claiming that name is what keeps the arrow in the slot it
 * has always been in.
 *
 * `scripts/check-invariants.sh` keeps `<Appbar.BackAction>` from coming back.
 */
export function BackAction({
	accessibilityLabel,
	onPress,
	color,
	theme,
}: BackActionProps) {
	return (
		<Appbar.Action
			icon="arrow-left"
			isLeading
			color={color}
			theme={theme}
			style={touchTargetStyle}
			accessibilityLabel={accessibilityLabel}
			onPress={onPress}
		/>
	);
}

// Paper's `Appbar` decides where a child goes by its `displayName`, and gives
// the back action a render pass of its own ahead of the title and the trailing
// actions. Without this the arrow would fall in with the trailing actions and
// take the title's left margin with it.
BackAction.displayName = "Appbar.BackAction";
