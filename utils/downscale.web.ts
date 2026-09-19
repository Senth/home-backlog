import { maxImageEdge } from "@/models/attachment";

/**
 * The web half of an upload: one canvas resize, used twice per image — the
 * stored 2048px object and its 512px thumbnail. Drawing through a canvas also
 * re-encodes to JPEG, which is what turns an iPhone's HEIC into something
 * every member's browser can show, and puts the long edge where the brief
 * wants it so a phone photo stops costing megabytes.
 *
 * Exported through `@/utils/downscale` (the platform split), never imported
 * directly by app code.
 */

/** JPEG at this quality: visually whole, a fraction of the original bytes. */
const jpegQuality = 0.85;

function canvasOf(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

/**
 * `file` decoded, drawn onto a canvas sized to `maxEdge` on the long edge
 * (never upscaled), and re-encoded as JPEG. The aspect ratio is kept exactly;
 * edges round to whole pixels.
 */
export async function downscaleImage(
	file: Blob,
	maxEdge: number = maxImageEdge,
): Promise<Blob> {
	const source = await createImageBitmap(file);
	const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
	const width = Math.round(source.width * scale);
	const height = Math.round(source.height * scale);

	const canvas = canvasOf(width, height);
	const context = canvas.getContext("2d");
	if (context === null) {
		source.close();
		throw new Error("Could not get a canvas to draw on.");
	}
	context.drawImage(source, 0, 0, width, height);
	source.close();

	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob(resolve, "image/jpeg", jpegQuality);
	});
	if (blob === null) throw new Error("Could not re-encode the image.");
	return blob;
}
