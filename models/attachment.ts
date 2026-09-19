/**
 * The pure parts of an attachment (#298): what the client refuses before it
 * touches the network, the paths the objects live at, what a row reads, and
 * what a card's face draws. Everything here mirrors `storage.rules` — the
 * rules are the law; this file exists so the refusal is a sentence on the
 * screen instead of a red console line from the SDK.
 */
import type { Attachment, AttachmentDisplay, Node } from "@/models/node";

/** Per object, mirrored from `storage.rules`' `request.resource.size` bound. */
export const maxAttachmentBytes = 20 * 1024 * 1024;

/** A stored image is downscaled to this long edge, and re-encoded as JPEG. */
export const maxImageEdge = 2048;

/** The second object every image gets: a 512px thumbnail. */
export const thumbnailEdge = 512;

/** What a household attaches, matched by `storage.rules`' `allowedType()`. */
export const allowedContentTypes = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/heic",
	"application/pdf",
	"text/plain",
] as const;

/** The `accept` the file picker is opened with — the same list, spelled for it. */
export const attachmentAccept = allowedContentTypes.join(",");

/** Why `uploadAttachment` refused a file, before anything was sent. */
export type AttachmentRefusal = "attachment-type" | "attachment-too-large";

/**
 * The client-side refusal, checked before any network call. The rules refuse a
 * 20MB object (`size < 20 * 1024 * 1024`), so exactly 20MB is refused here too.
 */
export function attachmentRefusal(
	contentType: string,
	size: number,
): AttachmentRefusal | null {
	if (
		!allowedContentTypes.includes(
			contentType as (typeof allowedContentTypes)[number],
		)
	)
		return "attachment-type";
	if (size >= maxAttachmentBytes) return "attachment-too-large";
	return null;
}

/** An image is the subtype that gets a preview and a thumbnail. */
export function isImageType(contentType: string): boolean {
	return contentType.startsWith("image/");
}

/** The i18n key for an upload failure; anything else is a plain failure. */
export type AttachmentErrorKey =
	| "detail.attachmentsTooLarge"
	| "detail.attachmentsWrongType"
	| "detail.attachmentsFailed";

export function attachmentErrorKey(reason: unknown): AttachmentErrorKey {
	const code = (reason as { code?: string } | null)?.code;
	if (code === "attachment-too-large") return "detail.attachmentsTooLarge";
	if (code === "attachment-type") return "detail.attachmentsWrongType";
	return "detail.attachmentsFailed";
}

/**
 * A size as the row reads it, through `Intl` so the units and the decimal
 * comma are the locale's own. One decimal below ten of a unit, none above.
 */
export function formatBytes(bytes: number, locale: string): string {
	const step = bytes < 1024 ? 1 : bytes < 1024 * 1024 ? 1024 : 1024 * 1024;
	const unit =
		bytes < 1024 ? "byte" : bytes < 1024 * 1024 ? "kilobyte" : "megabyte";
	const value = bytes / step;
	return new Intl.NumberFormat(locale, {
		style: "unit",
		unit,
		maximumFractionDigits: value < 10 ? 1 : 0,
	}).format(value);
}

/** Where an attachment object lives — the exact shape `storage.rules` allows. */
export function attachmentPath(
	homeId: string,
	nodeId: string,
	attachmentId: string,
): string {
	return `homes/${homeId}/nodes/${nodeId}/${attachmentId}`;
}

/** The thumbnail of an object at `path`, named by `storage.rules`' shape. */
export function thumbnailPathFor(objectPath: string): string {
	return `${objectPath}_thumb.jpg`;
}

/** What a card's face draws, after degradation. See `cardFace`. */
export interface CardFace {
	/**
	 * The mode the face draws — the stored preference, except that a card
	 * holding no image draws the count whatever it says.
	 */
	mode: AttachmentDisplay;
	/** The card's images, in stored order; empty when the face is the count. */
	images: Attachment[];
	/** Hero mode's image: the chosen one, else the first remaining. */
	hero: Attachment | null;
	/** Every attachment, the images and the documents together. */
	total: number;
}

/**
 * The three faces a card can draw (#298), resolved at render time.
 *
 * **Degrade on render, never rewrite on read** — the same way a deleted label
 * definition leaves its id in place. Hero mode with the hero deleted renders
 * the first remaining image; thumbnails with every image gone but a PDF left
 * renders the count. Nothing here writes, and a later upload brings the
 * stored preference back to life on its own.
 */
export function cardFace(node: Node): CardFace {
	const images = node.attachments.filter((entry) =>
		isImageType(entry.contentType),
	);
	const mode: AttachmentDisplay =
		images.length === 0 ? "count" : node.attachmentDisplay;
	const hero =
		images.find((entry) => entry.id === node.heroAttachmentId) ??
		images[0] ??
		null;
	return { mode, images, hero, total: node.attachments.length };
}
