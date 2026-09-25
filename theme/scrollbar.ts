import { darkTheme, lightTheme } from "@/theme";
import { radius, scrollbar } from "@/theme/tokens";

/**
 * The scrollbar for every scroller the app does not render itself — a
 * multiline text input, a Paper internal — as a stylesheet, because those
 * never pass through `SlimScrollView` (#377). Same look: `scrollbar.thumb`
 * thick, no track, no arrows, transparent at rest and `outlineVariant` while
 * the pointer is over the scroller or focus is inside it. Only the thumb's
 * color changes, so nothing moves when it appears.
 *
 * `::-webkit-scrollbar` covers Chromium and Safari. Firefox has no such
 * selector, and its `thin` bottoms out around 8px. A `SlimScrollView` hides
 * its native bar with React Native Web's own class, which outranks these.
 * Touch keeps the platform's overlay indicator.
 *
 * Injected by `app/+html.tsx`, which is web-only.
 */
export const scrollbarCss = `
@media (hover: hover) and (pointer: fine) {
	::-webkit-scrollbar {
		width: ${scrollbar.thumb}px;
		height: ${scrollbar.thumb}px;
	}
	::-webkit-scrollbar-track,
	::-webkit-scrollbar-corner {
		background: transparent;
	}
	::-webkit-scrollbar-button {
		display: none;
	}
	::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: ${radius.full}px;
	}
	:hover::-webkit-scrollbar-thumb,
	:focus-within::-webkit-scrollbar-thumb {
		background: ${lightTheme.colors.outlineVariant};
	}

	@supports not selector(::-webkit-scrollbar) {
		* {
			scrollbar-width: thin;
			scrollbar-color: transparent transparent;
		}
		:hover,
		:focus-within {
			scrollbar-color: ${lightTheme.colors.outlineVariant} transparent;
		}
	}
}

@media (hover: hover) and (pointer: fine) and (prefers-color-scheme: dark) {
	:hover::-webkit-scrollbar-thumb,
	:focus-within::-webkit-scrollbar-thumb {
		background: ${darkTheme.colors.outlineVariant};
	}

	@supports not selector(::-webkit-scrollbar) {
		:hover,
		:focus-within {
			scrollbar-color: ${darkTheme.colors.outlineVariant} transparent;
		}
	}
}
`;
