import type { ImageSourcePropType } from "react-native";

/**
 * The PWA icon from `public/`, at its fixed path rather than through
 * `require()`.
 *
 * `require()` gives a content-hashed URL that only exists after a build, which
 * a hand-rolled service worker with no precache manifest cannot know about — so
 * the mark would be a network request, and the two screens whose entire job is
 * to say *this is not broken* would render a hole on a first offline visit.
 * This path is stable, so `sw.js` precaches it on install.
 *
 * Same art either way: both come from `scripts/gen-icons.py`.
 */
export const brandMarkSource: ImageSourcePropType = {
	uri: "/icons/icon-192.png",
};
