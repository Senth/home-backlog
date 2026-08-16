/**
 * The API key token format, which both sides of the wire have to agree on.
 *
 * A key is **the user**, not a home: a person is in several homes — the house,
 * the cabin, a parent's place — and per-home keys would mean one credential per
 * home, an agent reconfigured every time a home is added, and a key that
 * silently stops covering work when a project moves. So a key reaches every home
 * its owner is a member of, and gains a new one the moment they join it.
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
 * This module is deliberately **import-free**. It is the one file the Expo app
 * and the Cloud Functions package both compile, and the two have nothing else in
 * common: no `@/` alias survives into the function's emitted JavaScript, and
 * `node:crypto` does not exist in Hermes. Hashing and minting therefore live in
 * `functions/src/api-key.ts`, on the only side that does either.
 */

/** What a secret scanner looks for, and what `parseToken` insists on. */
export const tokenPrefix = "hb_";

/**
 * Bytes of randomness in a secret, base64url-encoded into the token.
 *
 * 256 bits of server-side randomness is why the stored hash is a plain SHA-256
 * rather than bcrypt: there is no dictionary to run against a value nobody
 * chose.
 */
export const secretBytes = 32;

/**
 * How much of the token is stored in the clear, so that a list of four keys is
 * distinguishable. The last characters, not the first — the leading part is the
 * uid and the key id, which are the same across every key one person owns.
 */
export const tailLength = 4;

/** Matched by the create dialog and by the callable, which both refuse longer. */
export const maxKeyNameLength = 60;

/** Why a typed key name cannot be saved, as the key that says so. */
export type KeyNameError =
	| "automations.nameRequired"
	| "automations.nameTooLong";

/**
 * A key is named *before* its secret is revealed, because a key named later is
 * a key never named — and an unnamed key is one nobody dares revoke.
 */
export function keyNameError(name: string): KeyNameError | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) return "automations.nameRequired";
	if (trimmed.length > maxKeyNameLength) return "automations.nameTooLong";
	return null;
}

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
 * The stored `tail` of a token — what the key list renders after the name as
 * `····3f9c`.
 *
 * Taken from the whole token rather than from the secret so that the app can
 * derive it from the one string it is ever handed, without knowing how the token
 * is put together.
 */
export function tailOf(token: string): string {
	return token.slice(-tailLength);
}
