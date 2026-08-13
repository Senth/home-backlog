/**
 * SHA-256, in plain JavaScript.
 *
 * An invite is addressed by the hash of an email address, so this function has
 * to agree — byte for byte — with `hashing.sha256()` in `firestore.rules` and
 * with `node:crypto` in `tests/rules/helpers.ts`. If any two of the three
 * disagree, an invitee cannot find the invitation that was sent to them, and
 * nothing in the UI can explain why.
 *
 * Written out rather than delegated because there is no one dependency that
 * spans this app: `crypto.subtle` is asynchronous and absent from React
 * Native's Hermes runtime, and `expo-crypto` would be a native module added for
 * one 20-byte string. A synchronous, platform-free function also means
 * `emailHash()` can be called during render — the homes screen hashes a typed
 * address on every keystroke to answer "is that already a member?".
 */

// biome-ignore format: the round constants read as a table, not as prose.
const K = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
	0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
	0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const initialHash = [
	0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
	0x1f83d9ab, 0x5be0cd19,
];

/** Bytes per SHA-256 block, and the offset the length field starts at. */
const blockBytes = 64;
const lengthOffset = 56;

function rotr(value: number, bits: number): number {
	return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/**
 * UTF-8 bytes of a string. Hand-rolled rather than `TextEncoder`, which React
 * Native has only had since Hermes 0.12 and which the static web export
 * evaluates in a Node context that predates it on some CI images.
 *
 * `for…of` iterates code points, not UTF-16 units, so an address with an
 * astral-plane character encodes as one 4-byte sequence rather than two
 * surrogate halves — which is what `hashing.sha256()` does server-side.
 */
function utf8Bytes(input: string): number[] {
	const bytes: number[] = [];

	for (const character of input) {
		const code = character.codePointAt(0) ?? 0;

		if (code < 0x80) {
			bytes.push(code);
		} else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code < 0x10000) {
			bytes.push(
				0xe0 | (code >> 12),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		} else {
			bytes.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 0x3f),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		}
	}

	return bytes;
}

/** The message, a single 1 bit, zeros, then the bit length as a big-endian u64. */
function padded(bytes: number[]): number[] {
	const result = [...bytes, 0x80];
	while (result.length % blockBytes !== lengthOffset) result.push(0);

	const bitLength = bytes.length * 8;
	const high = Math.floor(bitLength / 0x100000000);
	const low = bitLength >>> 0;

	for (const word of [high, low]) {
		result.push(
			(word >>> 24) & 0xff,
			(word >>> 16) & 0xff,
			(word >>> 8) & 0xff,
			word & 0xff,
		);
	}

	return result;
}

/** The SHA-256 of a string, as 64 lowercase hex characters. */
export function sha256Hex(input: string): string {
	const message = padded(utf8Bytes(input));
	const hash = [...initialHash];
	const w = new Array<number>(64);

	for (let block = 0; block < message.length; block += blockBytes) {
		for (let i = 0; i < 16; i++) {
			const at = block + i * 4;
			w[i] =
				((message[at] << 24) |
					(message[at + 1] << 16) |
					(message[at + 2] << 8) |
					message[at + 3]) >>>
				0;
		}
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
		}

		let [a, b, c, d, e, f, g, h] = hash;

		for (let i = 0; i < 64; i++) {
			const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const choice = (e & f) ^ (~e & g);
			const temp1 = (h + s1 + choice + K[i] + w[i]) >>> 0;
			const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const temp2 = (s0 + majority) >>> 0;

			h = g;
			g = f;
			f = e;
			e = (d + temp1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temp1 + temp2) >>> 0;
		}

		for (const [i, value] of [a, b, c, d, e, f, g, h].entries()) {
			hash[i] = (hash[i] + value) >>> 0;
		}
	}

	return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}
