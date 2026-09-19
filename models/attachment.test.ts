import {
	attachmentErrorKey,
	attachmentPath,
	attachmentRefusal,
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
	it("climbs the units and lets the locale write the number", () => {
		expect(formatBytes(123, "en-US")).toBe("123 byte");
		expect(formatBytes(2048, "en-US")).toBe("2 kB");
		expect(formatBytes(1536, "sv-SE")).toBe("1,5 kB");
		expect(formatBytes(4 * oneKb * oneKb, "sv-SE")).toBe("4 MB");
		expect(formatBytes(12 * oneKb * oneKb, "en-US")).toBe("12 MB");
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
