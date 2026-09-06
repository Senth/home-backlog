import { themeColor } from "@/theme";
import { focusRing } from "@/theme/tokens";

/**
 * The keyboard focus ring, as a stylesheet rather than a style prop.
 *
 * It has to be CSS. React Native Web compiles `outline*` style props to plain
 * atomic classes with no selector attached, so an `outline` in a style prop is
 * painted *always* — which does not indicate focus, it decorates. There is no
 * React Native equivalent of `:focus-visible`, and `Pressable`'s `focused`
 * state is true for a mouse click too, so it would leave a ring behind after
 * every tap.
 *
 * One rule for the whole app, so every control gets the same ring: Chrome's
 * default is a 1 px near-black outline, which all but disappears against a
 * dark app bar. Colors come from `themeColor` — the same two values the
 * `theme-color` metas use — so they cannot drift from `primary`.
 *
 * Injected by `app/+html.tsx`, which is web-only. Native has no Tab key.
 */
export const focusVisibleCss = `
:focus-visible {
	outline: ${focusRing.width}px solid ${themeColor.light};
	outline-offset: ${focusRing.offset}px;
}

@media (prefers-color-scheme: dark) {
	:focus-visible {
		outline-color: ${themeColor.dark};
	}
}
`;
