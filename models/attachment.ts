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

export const photoAccept = allowedContentTypes.filter(isImageType).join(",");

/** The i18n key for an upload failure; anything else is a plain failure. */
export type AttachmentErrorKey =
	| "detail.attachmentsTooLarge"
	| "detail.attachmentsWrongType"
	| "detail.attachmentsQuota"
	| "detail.attachmentsRefused"
	| "detail.attachmentsFailed";

export function attachmentErrorKey(reason: unknown): AttachmentErrorKey {
	const code = (reason as { code?: string } | null)?.code;
	if (code === "attachment-too-large") return "detail.attachmentsTooLarge";
	if (code === "attachment-type") return "detail.attachmentsWrongType";
	if (code === "attachment-quota") return "detail.attachmentsQuota";
	if (code === "storage/unauthorized" || code === "storage/unauthenticated")
		return "detail.attachmentsRefused";
	return "detail.attachmentsFailed";
}

export function namedRefusals(
	names: readonly string[],
	results: readonly PromiseSettledResult<unknown>[],
): { name: string; key: AttachmentErrorKey; index: number }[] {
	return results.flatMap((result, index) =>
		result.status === "rejected" && names[index] !== undefined
			? [{ name: names[index], key: attachmentErrorKey(result.reason), index }]
			: [],
	);
}

export type DropPhase = "idle" | "armed" | "over";
export type DropState = { phase: DropPhase; depth: number };
export type DropEvent = {
	type:
		| "window-enter"
		| "window-leave"
		| "section-enter"
		| "section-leave"
		| "drop"
		| "dragend";
	isFiles: boolean;
};

export function nextDropPhase(state: DropState, event: DropEvent): DropState {
	if (event.type === "drop" || event.type === "dragend")
		return { phase: "idle", depth: 0 };
	if (!event.isFiles) return state;
	if (event.type === "window-enter")
		return {
			phase: state.phase === "over" ? "over" : "armed",
			depth: state.depth + 1,
		};
	if (event.type === "window-leave") {
		const depth = Math.max(0, state.depth - 1);
		return { phase: depth === 0 ? "idle" : state.phase, depth };
	}
	if (event.type === "section-enter") return { ...state, phase: "over" };
	return { ...state, phase: state.depth > 0 ? "armed" : "idle" };
}

/**
 * A size as the row reads it, through `Intl` so the units and the decimal
 * comma are the locale's own. One decimal below ten of a unit, none above.
 * Climbs to gigabytes, because the ceiling itself is one and "1,024 MB" is a
 * number that makes a reader do arithmetic the screen should have done.
 */
export function formatBytes(bytes: number, locale: string): string {
	const step =
		bytes < 1024
			? 1
			: bytes < 1024 * 1024
				? 1024
				: bytes < 1024 * 1024 * 1024
					? 1024 * 1024
					: 1024 * 1024 * 1024;
	const unit =
		bytes < 1024
			? "byte"
			: bytes < 1024 * 1024
				? "kilobyte"
				: bytes < 1024 * 1024 * 1024
					? "megabyte"
					: "gigabyte";
	const value = bytes / step;
	return new Intl.NumberFormat(locale, {
		style: "unit",
		unit,
		// Long form, so en-US reads "208 bytes" where the default would leave the
		// ungrammatical "208 byte" beside a short-form "28 kB" — sv-SE spells
		// every tier "byte", "kilobyte", … either way.
		unitDisplay: "long",
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

/** Per home, mirrored from `storage.rules`' `underQuota()`. */
export const homeAttachmentCeiling = 1024 * 1024 * 1024;

/** Silent below this share; the line appears on Manage home and the inventory. */
export const quotaWarningShare = 0.9;

/** The counter's share of the ceiling — the number the inventory leads with. */
export function quotaShare(attachmentBytes: number): number {
	return attachmentBytes / homeAttachmentCeiling;
}

/** The warning line's trigger: at nine tenths of the ceiling, never below. */
export function quotaWarning(attachmentBytes: number): boolean {
	return quotaShare(attachmentBytes) >= quotaWarningShare;
}

/** Why the home refused an upload: the ceiling is reached. */
export type AttachmentQuotaCode = "attachment-quota";

/** One attachment in the inventory, with the card it lives on. */
export interface InventoryRow {
	attachment: Attachment;
	nodeId: string;
	nodeTitle: string;
}

/** How the inventory orders itself; largest first, because that is the win. */
export type InventoryOrder = "largest" | "newest";

/**
 * Every attachment the reader can see, one row each, in the chosen order.
 * Largest first by default — the screen exists to reclaim space, so the first
 * row is the biggest win. An attachment whose upload time never arrived (a
 * listener still catching up) sorts last as the newest.
 */
export function inventoryRows(
	nodes: readonly Node[],
	order: InventoryOrder,
): InventoryRow[] {
	const rows = nodes.flatMap((node) =>
		node.attachments.map((attachment) => ({
			attachment,
			nodeId: node.id,
			nodeTitle: node.title,
		})),
	);
	const timeOf = (row: InventoryRow) =>
		row.attachment.uploadedAt?.toMillis() ?? 0;
	return rows.sort((a, b) =>
		order === "largest"
			? b.attachment.size - a.attachment.size || timeOf(b) - timeOf(a)
			: timeOf(b) - timeOf(a),
	);
}

/** What the visible rows hold — the originals only, which is what this reader
 *  can delete. Every thumbnail is an object without a row, so its bytes are
 *  the visible side's blind spot, not an unseen card's. */
export function visibleBytes(rows: readonly InventoryRow[]): number {
	return rows.reduce((sum, row) => sum + row.attachment.size, 0);
}

/**
 * The part of the home's true total that the list does not hold: the bytes of
 * private cards this reader is not on, plus every thumbnail — the counter
 * counts them, the rows list only originals, and a thumbnail's size is not
 * known client-side, so the line names both rather than claiming unseen
 * cards. The counter lags the Storage triggers by about a second, so the
 * visible side can briefly overtake it; a negative gap would be a number
 * claiming bytes exist that the list disproves, so it clamps to none.
 */
export function unseenBytes(
	attachmentBytes: number,
	rows: readonly InventoryRow[],
): number {
	return Math.max(0, attachmentBytes - visibleBytes(rows));
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
 * The tile the `+N` badge belongs on: the **last image the face can actually
 * draw**, or `null` while none of the row has resolved or when the row is
 * whole. Anchoring the badge to the last *slot* instead hung it on a tile
 * whose thumbnail cannot resolve — a raced delete, or an upload that kept its
 * undecodable original and so has no thumbnail at all — which is how a "+N"
 * came to float in an empty cell while the gallery visibly held fewer
 * pictures than the badge spoke for.
 */
export function badgeAttachmentId(
	tiles: readonly Attachment[],
	urls: Readonly<Record<string, string>>,
	more: number,
): string | null {
	if (more <= 0) return null;
	for (let at = tiles.length - 1; at >= 0; at--) {
		const tile = tiles[at];
		if (tile !== undefined && urls[tile.id] !== undefined) return tile.id;
	}
	return null;
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
