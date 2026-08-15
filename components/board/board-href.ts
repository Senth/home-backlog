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

/**
 * A node's details — its notes, due date, priority and effort, and its steps.
 *
 * A real route beside the board rather than a modal over it, so reload, the back
 * gesture and a shared link all land on the same screen. The root board has no
 * node and so has no details.
 */
export function detailsHref(nodeId: string): Href {
	return { pathname: "/projects/[nodeId]/details", params: { nodeId } };
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
