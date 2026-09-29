import { type Href, router } from "expo-router";

/**
 * Back alone is a no-op after a reload, bookmark, or shared link with no history.
 * Check first so the arrow falls back instead of logging an unhandled GO_BACK.
 */
export function goBack(
	fallback: Href,
	via: "replace" | "dismissTo" = "replace",
) {
	return router.canGoBack() ? router.back() : router[via](fallback);
}
