import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { secretBytes } from "../../models/api-key";

/**
 * Minting and checking a key's secret — the half of the token that only the
 * server ever handles.
 *
 * The format itself is in `models/api-key.ts`, which the app compiles too. This
 * file is the part that cannot be shared: `node:crypto` does not exist in
 * Hermes, and nothing in the app has any business hashing a secret.
 */

/**
 * A new secret: 32 bytes of randomness, base64url so that it never contains the
 * `.` the token splits on.
 *
 * `randomBytes` rather than `Math.random`, obviously, but also rather than a
 * uuid — a uuid is 122 bits with six of them fixed, and there is no reason to
 * spend a smaller number when the token is copied once and pasted into an env
 * file.
 */
export function newSecret(): string {
	return randomBytes(secretBytes).toString("base64url");
}

/**
 * What is stored. The secret itself never is — a database dump must not be a
 * set of working credentials.
 *
 * Plain SHA-256, and bcrypt is deliberately not used: bcrypt's work factor buys
 * time against a *dictionary*, and there is no dictionary for 256 bits of
 * server-side randomness. What it would buy instead is tens of milliseconds on
 * every single API request.
 */
export function secretHash(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on strings returns as soon as two characters differ, which leaks how
 * much of a guess was right — one byte at a time, which is a tractable attack
 * against an online service. The length check in front is not a leak: both
 * sides are always 64 hex characters, so a difference in length is a malformed
 * value rather than a near miss.
 */
export function hashesMatch(one: string, other: string): boolean {
	if (one.length !== other.length) return false;
	return timingSafeEqual(Buffer.from(one, "utf8"), Buffer.from(other, "utf8"));
}
