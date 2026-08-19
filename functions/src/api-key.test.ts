import { createHash } from "node:crypto";
import {
	formatToken,
	hashesMatch,
	newSecret,
	parseToken,
	secretBytes,
	secretHash,
	tailOf,
	tokenPrefix,
} from "./api-key.js";

const uid = "AbC123uid0000000000000000000";
const keyId = "Xy9ZkeyId12345678901";
const secret = "Zm9vYmFy-_0123456789abcdefghijklmnopqrstuvwx";

describe("the token format", () => {
	it("round-trips", () => {
		const token = formatToken({ uid, keyId, secret });

		expect(token.startsWith(tokenPrefix)).toBe(true);
		expect(parseToken(token)).toEqual({ uid, keyId, secret });
	});

	// Carrying the uid is what makes verification one document read rather than a
	// collection-group query on a hot path.
	it("carries the uid and the key id", () => {
		const parsed = parseToken(formatToken({ uid, keyId, secret }));

		expect(parsed?.uid).toBe(uid);
		expect(parsed?.keyId).toBe(keyId);
	});

	// The separator is a dot precisely because base64url never produces one, so a
	// secret full of `-` and `_` still splits into exactly three parts.
	it("splits a secret containing every base64url character", () => {
		const awkward = "-_--__ABCabc019-_";

		expect(
			parseToken(formatToken({ uid, keyId, secret: awkward }))?.secret,
		).toBe(awkward);
	});

	it("refuses a token without the prefix", () => {
		expect(parseToken(`${uid}.${keyId}.${secret}`)).toBeNull();
	});

	it("refuses the wrong number of parts", () => {
		expect(parseToken(`${tokenPrefix}${uid}.${keyId}`)).toBeNull();
		expect(
			parseToken(`${tokenPrefix}${uid}.${keyId}.${secret}.extra`),
		).toBeNull();
	});

	it("refuses an empty part", () => {
		expect(parseToken(`${tokenPrefix}.${keyId}.${secret}`)).toBeNull();
		expect(parseToken(`${tokenPrefix}${uid}..${secret}`)).toBeNull();
		expect(parseToken(`${tokenPrefix}${uid}.${keyId}.`)).toBeNull();
	});

	// The uid and the key id are interpolated into a document path. A token that
	// smuggled a slash or a `..` past this would point verification at a document
	// of the caller's choosing, which is the one parsing bug here that is not
	// merely a failed request.
	it("refuses anything that is not a document-path-safe id", () => {
		expect(
			parseToken(`${tokenPrefix}../../admin.${keyId}.${secret}`),
		).toBeNull();
		expect(parseToken(`${tokenPrefix}${uid}.a/b.${secret}`)).toBeNull();
		expect(parseToken(`${tokenPrefix}${uid}.key-id.${secret}`)).toBeNull();
	});

	it("refuses a secret with a character outside base64url", () => {
		expect(parseToken(`${tokenPrefix}${uid}.${keyId}.abc+def`)).toBeNull();
		expect(parseToken(`${tokenPrefix}${uid}.${keyId}.abc=`)).toBeNull();
	});

	it("refuses an empty string", () => {
		expect(parseToken("")).toBeNull();
	});
});

describe("the tail", () => {
	it("is the last four characters of the whole token", () => {
		expect(tailOf(formatToken({ uid, keyId, secret }))).toBe(secret.slice(-4));
	});

	// Two keys of the same owner share their uid, so a *leading* fragment would
	// render four identical rows.
	it("distinguishes two keys of the same owner", () => {
		const one = formatToken({
			uid,
			keyId: "aaaaaaaaaaaaaaaaaaaa",
			secret: "secretone",
		});
		const two = formatToken({
			uid,
			keyId: "bbbbbbbbbbbbbbbbbbbb",
			secret: "secrettwo",
		});

		expect(tailOf(one)).not.toBe(tailOf(two));
	});
});

describe("a minted secret", () => {
	it("is 32 bytes of randomness", () => {
		// base64url of 32 bytes is 43 characters with the padding dropped.
		expect(newSecret()).toHaveLength(Math.ceil((secretBytes * 8) / 6));
	});

	it("is different every time", () => {
		const secrets = new Set(Array.from({ length: 50 }, () => newSecret()));

		expect(secrets.size).toBe(50);
	});

	// base64 proper would produce `+`, `/` and `=`; the first two are outside the
	// token's alphabet, so a token carrying one would not parse at all.
	it("stays inside base64url, so the token still splits on its dots", () => {
		for (let attempt = 0; attempt < 200; attempt++) {
			const minted = newSecret();

			expect(minted).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(parseToken(formatToken({ uid, keyId, secret: minted }))).toEqual({
				uid,
				keyId,
				secret: minted,
			});
		}
	});
});

describe("the stored hash", () => {
	it("is the SHA-256 of the secret, as 64 hex characters", () => {
		expect(secretHash("a-secret")).toBe(
			createHash("sha256").update("a-secret").digest("hex"),
		);
		expect(secretHash("a-secret")).toHaveLength(64);
	});

	it("never contains the secret", () => {
		expect(secretHash("a-secret")).not.toContain("a-secret");
	});
});

describe("comparing hashes", () => {
	it("accepts the same digest", () => {
		expect(hashesMatch(secretHash("one"), secretHash("one"))).toBe(true);
	});

	it("refuses a different one", () => {
		expect(hashesMatch(secretHash("one"), secretHash("two"))).toBe(false);
	});

	// `timingSafeEqual` throws on a length mismatch rather than returning false,
	// so the guard in front of it is what keeps a truncated stored value from
	// turning every request into a 500.
	it("refuses a differently sized value without throwing", () => {
		expect(hashesMatch(secretHash("one"), "abc")).toBe(false);
		expect(hashesMatch("", secretHash("one"))).toBe(false);
	});

	it("refuses a digest that differs only in its last character", () => {
		const digest = secretHash("one");
		const nearly = `${digest.slice(0, -1)}${digest.endsWith("a") ? "b" : "a"}`;

		expect(hashesMatch(digest, nearly)).toBe(false);
	});
});
