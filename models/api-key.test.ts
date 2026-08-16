import {
	formatToken,
	keyNameError,
	maxKeyNameLength,
	parseToken,
	tailOf,
	tokenPrefix,
} from "@/models/api-key";

const uid = "AbC123uid0000000000000000000";
const keyId = "Xy9ZkeyId12345678901";
const secret = "Zm9vYmFy-_0123456789abcdefghijklmnopqrstuvwx";

describe("the token format", () => {
	it("round-trips", () => {
		const token = formatToken({ uid, keyId, secret });

		expect(token.startsWith(tokenPrefix)).toBe(true);
		expect(parseToken(token)).toEqual({ uid, keyId, secret });
	});

	it("carries the uid, so verification is one document read", () => {
		const parsed = parseToken(formatToken({ uid, keyId, secret }));

		expect(parsed?.uid).toBe(uid);
		expect(parsed?.keyId).toBe(keyId);
	});

	// The separator is a dot precisely because base64url never produces one, so
	// a secret full of `-` and `_` still splits into exactly three parts.
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

describe("the key name", () => {
	it("is required", () => {
		expect(keyNameError("")).toBe("automations.nameRequired");
		expect(keyNameError("   ")).toBe("automations.nameRequired");
	});

	it("accepts exactly the maximum length", () => {
		expect(keyNameError("n".repeat(maxKeyNameLength))).toBeNull();
	});

	it("refuses one character more", () => {
		expect(keyNameError("n".repeat(maxKeyNameLength + 1))).toBe(
			"automations.nameTooLong",
		);
	});

	it("measures the trimmed name", () => {
		expect(keyNameError(`  ${"n".repeat(maxKeyNameLength)}  `)).toBeNull();
	});
});
