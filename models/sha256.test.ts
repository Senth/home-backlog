import { createHash } from "node:crypto";
import { sha256Hex } from "@/models/sha256";

/**
 * The published NIST vectors, plus the two cases the implementation is most
 * likely to get wrong: a message that lands exactly on a block boundary, and
 * one long enough to need a second block.
 */
describe("sha256Hex", () => {
	it.each([
		["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
		["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
		[
			"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
			"248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
		],
	])("hashes %p", (input, expected) => {
		expect(sha256Hex(input)).toBe(expected);
	});

	it.each([
		["one block exactly", "a".repeat(55)],
		["the first padding overflow", "a".repeat(56)],
		["two blocks", "a".repeat(200)],
		["an address", "marcus@example.com"],
		// Padding is driven by the *byte* length, not the character count, so a
		// multi-byte address is the case a naive implementation pads short.
		["a non-ASCII address", "märta.östberg@exempel.se"],
		["an astral-plane character", "🏠@example.com"],
	])("agrees with node:crypto on %s", (_label, input) => {
		expect(sha256Hex(input)).toBe(
			createHash("sha256").update(input).digest("hex"),
		);
	});
});
