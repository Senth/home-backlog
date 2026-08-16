import { createHash } from "node:crypto";
import { parseToken, secretBytes, tokenPrefix } from "../../models/api-key";
import { hashesMatch, newSecret, secretHash } from "./api-key";

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
	// token's alphabet and the third would survive `parseToken` but is noise in a
	// value that gets pasted into an env file.
	it("stays inside base64url, so the token still splits on its dots", () => {
		for (let attempt = 0; attempt < 200; attempt++) {
			const secret = newSecret();

			expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(parseToken(`${tokenPrefix}uid1.keyId1.${secret}`)?.secret).toBe(
				secret,
			);
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
