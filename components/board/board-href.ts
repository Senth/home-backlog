import type { Href } from "expo-router";

/**
 * Every board is a real route, so browser back, the PWA back gesture, reload
 * and a shared link all work. `null` is the root board.
 */
export function boardHref(nodeId: string | null): Href {
	return nodeId === null
		? { pathname: "/projects" }
		: { pathname: "/projects/[nodeId]", params: { nodeId } };
}

/** The value `gone` carries. Any other value is not this message. */
export const goneFlag = "1";

/**
 * The same board, asked to say that the card you were on is not there any more.
 *
 * The message travels as a route param because the screen that has to *say* it
 * is not the screen that discovered it — a card can be deleted, with its whole
 * subtree, while somebody else is standing on it.
 */
export function goneHref(nodeId: string | null): Href {
	return nodeId === null
		? { pathname: "/projects", params: { gone: goneFlag } }
		: { pathname: "/projects/[nodeId]", params: { nodeId, gone: goneFlag } };
}
