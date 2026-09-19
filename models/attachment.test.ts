import {
	attachmentErrorKey,
	attachmentPath,
	attachmentRefusal,
	badgeAttachmentId,
	cardFace,
	formatBytes,
	isImageType,
	maxAttachmentBytes,
	thumbnailPathFor,
} from "@/models/attachment";
import type { Attachment, Node } from "@/models/node";
import { newNodeData } from "@/models/node";

// A byte count lives in a data field, but the style-prop invariant greps the
// literal — so the sizes these tests speak in get names, like everywhere else.
const oneKb = 1024;
const nineteenMb = 19 * oneKb * oneKb;

describe("attachmentRefusal", () => {
	it("accepts every type the rules allow, under the ceiling", () => {
		expect(attachmentRefusal("image/jpeg", nineteenMb)).toBeNull();
		expect(attachmentRefusal("image/png", nineteenMb)).toBeNull();
		expect(attachmentRefusal("image/webp", nineteenMb)).toBeNull();
		expect(attachmentRefusal("image/heic", nineteenMb)).toBeNull();
		expect(attachmentRefusal("application/pdf", nineteenMb)).toBeNull();
		expect(attachmentRefusal("text/plain", nineteenMb)).toBeNull();
	});

	it("refuses an unknown type before it reads the size", () => {
		expect(attachmentRefusal("application/x-msdownload", oneKb)).toBe(
			"attachment-type",
		);
		expect(attachmentRefusal("", oneKb)).toBe("attachment-type");
	});

	it("refuses at the ceiling the rules draw — a 20MB object is denied there", () => {
		expect(attachmentRefusal("application/pdf", maxAttachmentBytes)).toBe(
			"attachment-too-large",
		);
		expect(
			attachmentRefusal("application/pdf", maxAttachmentBytes + oneKb),
		).toBe("attachment-too-large");
	});
});

describe("isImageType", () => {
	it("marks the previewable subtype", () => {
		expect(isImageType("image/jpeg")).toBe(true);
		expect(isImageType("application/pdf")).toBe(false);
		expect(isImageType("")).toBe(false);
	});
});

describe("attachmentErrorKey", () => {
	it("maps each refusal to its sentence and anything else to the plain one", () => {
		expect(attachmentErrorKey({ code: "attachment-too-large" })).toBe(
			"detail.attachmentsTooLarge",
		);
		expect(attachmentErrorKey({ code: "attachment-type" })).toBe(
			"detail.attachmentsWrongType",
		);
		expect(attachmentErrorKey(new Error("storage/retry-limit-exceeded"))).toBe(
			"detail.attachmentsFailed",
		);
		expect(attachmentErrorKey(null)).toBe("detail.attachmentsFailed");
	});
});

describe("formatBytes", () => {
	it("climbs the units in long form and lets the locale write the number", () => {
		expect(formatBytes(123, "en-US")).toBe("123 bytes");
		expect(formatBytes(2048, "en-US")).toBe("2 kilobytes");
		expect(formatBytes(1536, "sv-SE")).toBe("1,5 kilobyte");
		expect(formatBytes(4 * oneKb * oneKb, "sv-SE")).toBe("4 megabyte");
		expect(formatBytes(12 * oneKb * oneKb, "en-US")).toBe("12 megabytes");
		expect(formatBytes(homeAttachmentCeiling, "en-US")).toBe("1 gigabyte");
		expect(
			formatBytes(oneKb * oneKb * oneKb + 512 * oneKb * oneKb, "sv-SE"),
		).toBe("1,5 gigabyte");
	});
});

describe("paths", () => {
	it("builds the exact shape storage.rules allows, and the thumb beside it", () => {
		const path = attachmentPath("home", "node", "att-1");
		expect(path).toBe("homes/home/nodes/node/att-1");
		expect(thumbnailPathFor(path)).toBe(
			"homes/home/nodes/node/att-1_thumb.jpg",
		);
	});
});

function anEntry(over: Partial<Attachment> = {}): Attachment {
	return {
		id: "att-1",
		path: "homes/home/nodes/node/att-1",
		name: "badrum.jpg",
		contentType: "image/jpeg",
		size: oneKb,
		uploadedAt: null,
		uploadedBy: "me",
		...over,
	};
}

function aNode(
	attachments: Attachment[],
	display: Node["attachmentDisplay"] = "count",
	heroAttachmentId: string | null = null,
): Node {
	return {
		...newNodeData({ title: "Kort", rank: "a0", participantIds: ["me"] }),
		id: "card",
		completedAt: null,
		createdAt: null,
		createdBy: "me",
		updatedAt: null,
		attachments,
		attachmentDisplay: display,
		heroAttachmentId,
	};
}

describe("cardFace", () => {
	it("a card with nothing attached draws the count, and nothing else", () => {
		const face = cardFace(aNode([]));
		expect(face.mode).toBe("count");
		expect(face.images).toEqual([]);
		expect(face.hero).toBeNull();
		expect(face.total).toBe(0);
	});

	it("the count is the default face: images are there, the fact carries them", () => {
		const images = [anEntry(), anEntry({ id: "att-2", path: "p/att-2" })];
		const face = cardFace(aNode(images));
		expect(face.mode).toBe("count");
		expect(face.images).toHaveLength(2);
		expect(face.total).toBe(2);
	});

	it("hero draws the chosen image", () => {
		const images = [
			anEntry(),
			anEntry({ id: "att-2", path: "p/att-2", name: "vald.jpg" }),
		];
		const face = cardFace(aNode(images, "hero", "att-2"));
		expect(face.mode).toBe("hero");
		expect(face.hero?.name).toBe("vald.jpg");
	});

	it("hero with the hero deleted falls back to the first remaining, without a write", () => {
		const images = [
			anEntry({ name: "forst.jpg" }),
			anEntry({ id: "att-2", path: "p/att-2" }),
		];
		const face = cardFace(aNode(images, "hero", "gone"));
		expect(face.mode).toBe("hero");
		expect(face.hero?.name).toBe("forst.jpg");
	});

	it("hero with no image left degrades to the count", () => {
		const documents = [
			anEntry({ contentType: "application/pdf", name: "kalkyl.pdf" }),
		];
		const face = cardFace(aNode(documents, "hero", "att-1"));
		expect(face.mode).toBe("count");
		expect(face.hero).toBeNull();
	});

	it("thumbnails draws the images in stored order", () => {
		const images = [anEntry(), anEntry({ id: "att-2", path: "p/att-2" })];
		const face = cardFace(aNode(images, "thumbnails"));
		expect(face.mode).toBe("thumbnails");
		expect(face.images).toHaveLength(2);
	});

	it("thumbnails with every image gone but a PDF left degrades to the count", () => {
		const documents = [
			anEntry({ contentType: "application/pdf", name: "kalkyl.pdf" }),
		];
		const face = cardFace(aNode(documents, "thumbnails"));
		expect(face.mode).toBe("count");
	});
});

describe("badgeAttachmentId", () => {
	// The board bug: with a tile whose thumbnail cannot resolve — a raced
	// delete, or an upload that kept its undecodable original — the badge hung
	// on the third *slot* and floated in an empty cell while the gallery
	// visibly held fewer pictures than the face claimed.
	it("sits on the last tile the face can actually draw", () => {
		const tiles = [
			anEntry(),
			anEntry({ id: "att-2", path: "p/att-2" }),
			anEntry({ id: "att-3", path: "p/att-3" }),
		];
		const urls = {
			"att-1": "https://x/1",
			"att-2": "https://x/2",
			"att-3": "https://x/3",
		};
		expect(badgeAttachmentId(tiles, urls, 2)).toBe("att-3");
	});

	it("steps back over a tile whose thumbnail cannot resolve", () => {
		const tiles = [
			anEntry(),
			anEntry({ id: "att-2", path: "p/att-2" }),
			anEntry({ id: "att-3", path: "p/att-3" }),
		];
		const urls = { "att-1": "https://x/1", "att-2": "https://x/2" };
		expect(badgeAttachmentId(tiles, urls, 2)).toBe("att-2");
	});

	it("is silent while no tile has resolved", () => {
		const tiles = [anEntry(), anEntry({ id: "att-2", path: "p/att-2" })];
		expect(badgeAttachmentId(tiles, {}, 1)).toBeNull();
	});

	it("speaks only when the row leaves images unshown", () => {
		const tiles = [anEntry()];
		expect(badgeAttachmentId(tiles, { "att-1": "https://x/1" }, 0)).toBeNull();
	});
});

import {
	homeAttachmentCeiling,
	inventoryRows,
	quotaWarning,
	unseenBytes,
	visibleBytes,
} from "@/models/attachment";

// Row sizes named, like every byte count in these fixtures.
const bytesTiny = 100;
const bytesSmall = 200;
const bytesMedium = 300;
const bytesLarge = 900;

/** A stand-in timestamp — the sort reads `toMillis()`, nothing else. */
function at(millis: number): Attachment["uploadedAt"] {
	return { toMillis: () => millis } as unknown as Attachment["uploadedAt"];
}

describe("the quota and the inventory", () => {
	const giga = homeAttachmentCeiling;

	it("warns only from nine tenths of the ceiling", () => {
		expect(quotaWarning(0)).toBe(false);
		expect(quotaWarning(Math.floor(giga * 0.9) - oneKb)).toBe(false);
		expect(quotaWarning(Math.ceil(giga * 0.9))).toBe(true);
		expect(quotaWarning(giga - oneKb)).toBe(true);
	});

	it("the gap is what the counter holds that the list cannot show", () => {
		const nodes = [
			aNode([
				anEntry({ size: bytesMedium }),
				anEntry({ id: "b", path: "p/b", size: bytesSmall }),
			]),
		];
		const rows = inventoryRows(nodes, "largest");
		expect(visibleBytes(rows)).toBe(500);
		expect(unseenBytes(800, rows)).toBe(300);
	});

	it("thumbnails keep a gap open on a home whose cards are all visible", () => {
		const nodes = [aNode([anEntry({ size: bytesMedium })])];
		const rows = inventoryRows(nodes, "largest");
		// The counter counts the thumbnail objects and the rows list only the
		// originals, so 300 here is 100 of thumbnails on a card the reader
		// sees — the line stays, naming the gap rather than an unseen card.
		expect(unseenBytes(400, rows)).toBe(100);
	});

	it("a counter that briefly lags claims no negative bytes", () => {
		const nodes = [
			aNode([
				anEntry({ size: bytesMedium }),
				anEntry({ id: "b", path: "p/b", size: bytesSmall }),
			]),
		];
		const rows = inventoryRows(nodes, "largest");
		expect(unseenBytes(400, rows)).toBe(0);
	});

	it("largest first, and the toggle turns to newest", () => {
		const nodes = [
			aNode([
				anEntry({ size: bytesTiny, uploadedAt: at(1000) }),
				anEntry({
					id: "b",
					path: "p/b",
					size: bytesLarge,
					uploadedAt: at(2000),
				}),
				anEntry({
					id: "c",
					path: "p/c",
					size: bytesMedium,
					uploadedAt: at(3000),
				}),
			]),
		];
		expect(
			inventoryRows(nodes, "largest").map((row) => row.attachment.size),
		).toEqual([900, 300, 100]);
		expect(
			inventoryRows(nodes, "newest").map((row) => row.attachment.size),
		).toEqual([300, 900, 100]);
	});

	it("an entry without a time sorts last, behind everything dated", () => {
		const nodes = [
			aNode([
				anEntry({ size: bytesTiny, uploadedAt: null }),
				anEntry({
					id: "b",
					path: "p/b",
					size: bytesTiny,
					uploadedAt: at(1000),
				}),
			]),
		];
		const rows = inventoryRows(nodes, "newest");
		expect(rows[0]?.attachment.id).toBe("b");
		expect(rows[1]?.attachment.id).toBe("att-1");
	});
});
