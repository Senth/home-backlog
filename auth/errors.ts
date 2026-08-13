/**
 * Firebase auth errors, reduced to the two things a user can act on.
 *
 * Everything else — a blocked handler, a mismatched redirect URI, a revoked
 * token — is a configuration problem the user cannot fix, so it gets one honest
 * "try again" message rather than a code they would have to search for. The
 * original error still reaches the console.
 */

/** i18n keys this module may return. */
export type AuthErrorKey = "error.offline" | "error.googleSignIn";

function errorCode(error: unknown): string {
	if (typeof error !== "object" || error === null) return "";
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : "";
}

/**
 * The i18n key for an error thrown by the Auth SDK. Losing the connection
 * mid-redirect is the one case worth naming: it is the user's to fix, and it is
 * the likely one in a garage or a basement.
 */
export function mapAuthError(error: unknown): AuthErrorKey {
	return errorCode(error) === "auth/network-request-failed"
		? "error.offline"
		: "error.googleSignIn";
}
