/**
 * Image resizing on a platform with no canvas — a refusal, not a silent
 * passthrough. Uploading a 4MB original where the web path would have stored a
 * 400KB JPEG would be a quota the household pays for nothing, so native gets
 * no upload path until it gets this (the web-first PWA never runs it; see
 * `AttachmentsSection`).
 */
export async function downscaleImage(
	_file: Blob,
	_maxEdge: number,
): Promise<Blob> {
	throw new Error("Image downscaling is not implemented on this platform yet.");
}
