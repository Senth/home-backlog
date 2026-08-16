import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The API key token: its format, and the crypto around its secret.
 *
 * The token is **`hb_<uid>.<keyId>.<secret>`**:
 *
 * - `hb_` is what secret scanners key on, which is the whole reason for a
 *   prefix.
 * - The separator is a dot because base64url's alphabet includes `_` and `-` but
 *   never `.`, and a Firebase uid is alphanumeric — so the three parts split
 *   unambiguously however the secret happens to come out.
 * - Carrying the uid is what makes verification a **direct `get()`** on
 *   `users/{uid}/apiKeys/{keyId}`: one document read, no query, no index and no
 *   collection-group lookup on a hot path. A uid is not a secret — it is already
 *   visible to every member of a shared home through `participantIds` and
 *   `memberProfiles` — and knowing one grants nothing without the secret.
 *
 * All of it lives on this side of the wire, and none of it is shared with the
 * app, because the app never touches a token: the Automations screen is handed
 * the finished string once by `createApiKey`, shows it, and forgets it. Sharing a
 * format nobody on the other side parses would buy a second implementation to
 * keep in step for nothing. `models/api-key.ts` holds the one rule a screen does
 * enforce, which is that a key is named first.
 */

/** What a secret scanner looks for, and what `parseToken` insists on. */
export const tokenPrefix = "hb_";

/**
 * Bytes of randomness in a secret, base64url-encoded into the token.
 *
 * 256 bits of server-side randomness is why the stored hash is a plain SHA-256
 * rather than bcrypt: there is no dictionary to run against a value nobody
 * chose, and a work factor would instead cost tens of milliseconds on every
 * single request.
 */
export const secretBytes = 32;

/**
 * How much of the token is stored in the clear, so that a list of four keys is
 * distinguishable. The last characters, not the first — the leading part is the
 * uid and the key id, and the uid is the same across every key one person owns.
 */
export const tailLength = 4;

/**
 * The bound the callable enforces. `models/api-key.ts` states the same number
 * for the create dialog, in the language of an i18n key, because what a screen
 * needs from a rejected name is a translated sentence and what a callable needs
 * is a refusal. The dialog is a courtesy; this is the rule.
 */
export const maxKeyNameLength = 60;

export interface ApiKeyToken {
	uid: string;
	keyId: string;
	secret: string;
}

export function formatToken(token: ApiKeyToken): string {
	return `${tokenPrefix}${token.uid}.${token.keyId}.${token.secret}`;
}

/**
 * A Firebase uid and a Firestore auto-id are both alphanumeric; a base64url
 * secret adds `-` and `_`.
 *
 * These are not cosmetic. The uid and the key id are interpolated straight into
 * a document path, so anything that admitted a `/` or a `..` would let a caller
 * point verification at a document of their choosing. Rejecting the token
 * outright is cheaper and safer than sanitising it afterwards.
 */
const idPattern = /^[A-Za-z0-9]+$/;
const secretPattern = /^[A-Za-z0-9_-]+$/;

/**
 * The three parts of a bearer token, or `null` if it is not one of ours.
 *
 * `null` covers every malformed shape — no prefix, wrong number of parts, an
 * empty part, a character that has no business in a document path. The caller
 * answers all of them the same way, with a 401 that says nothing about which
 * check failed.
 */
export function parseToken(token: string): ApiKeyToken | null {
	if (!token.startsWith(tokenPrefix)) return null;

	const parts = token.slice(tokenPrefix.length).split(".");
	if (parts.length !== 3) return null;

	const [uid, keyId, secret] = parts;
	if (!idPattern.test(uid)) return null;
	if (!idPattern.test(keyId)) return null;
	if (!secretPattern.test(secret)) return null;

	return { uid, keyId, secret };
}

/**
 * The stored `tail` — what the key list renders after the name as `····3f9c`.
 *
 * Taken from the whole token rather than from the secret, so that it is derived
 * from the one string the caller is ever handed.
 */
export function tailOf(token: string): string {
	return token.slice(-tailLength);
}

/**
 * A new secret: 32 bytes of randomness, base64url so that it never contains the
 * `.` the token splits on.
 */
export function newSecret(): string {
	return randomBytes(secretBytes).toString("base64url");
}

/**
 * What is stored. The secret itself never is — a database dump must not be a set
 * of working credentials.
 */
export function secretHash(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on strings returns as soon as two characters differ, which leaks how
 * much of a guess was right — one byte at a time, which is a tractable attack
 * against an online service. The length check in front is not a leak: both sides
 * are always 64 hex characters, so a difference in length is a malformed value
 * rather than a near miss.
 */
export function hashesMatch(one: string, other: string): boolean {
	if (one.length !== other.length) return false;
	return timingSafeEqual(Buffer.from(one, "utf8"), Buffer.from(other, "utf8"));
}
