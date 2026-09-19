import { downscaleImage } from "@/utils/downscale.web";

// A blob is opaque to the test; what matters is that the canvas was sized to
// the long edge, drew once, and handed back what toBlob produced.
type FakeBitmap = { width: number; height: number; close: () => void };

// Pixel counts named like everything else — the style-prop invariant reads
// `width: 3000` as a layout literal even inside a fake bitmap.
const wide = 4000;
const tall = 3000;
const smallWide = 300;
const smallTall = 200;

function installCanvas(options: {
	bitmap: FakeBitmap;
	blob: Blob | null;
	context: Record<string, unknown> | null;
}): { drawImage: jest.Mock; toBlob: jest.Mock } {
	const drawImage = jest.fn();
	const toBlob = jest.fn((resolve: (blob: Blob | null) => void) => {
		resolve(options.blob);
	});
	(globalThis as Record<string, unknown>).createImageBitmap = jest.fn(
		async () => options.bitmap,
	);
	globalThis.document = {
		createElement: jest.fn(() => ({
			getContext: jest.fn(() => options.context),
			toBlob,
		})),
	} as unknown as typeof document;
	return { drawImage, toBlob };
}

afterEach(() => {
	delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
	delete (globalThis as { document?: unknown }).document;
});

describe("downscaleImage (web)", () => {
	it("draws a landscape photo at 2048 on the long edge and returns the re-encode", async () => {
		const drawImage = jest.fn();
		const close = jest.fn();
		const blob = new Blob(["jpeg"], { type: "image/jpeg" });
		installCanvas({
			bitmap: { width: wide, height: tall, close },
			blob,
			context: { drawImage },
		});

		await expect(downscaleImage(new Blob([]))).resolves.toBe(blob);
		expect(drawImage).toHaveBeenCalledWith(
			expect.objectContaining({ width: wide }),
			0,
			0,
			2048,
			1536,
		);
		expect(close).toHaveBeenCalled();
	});

	it("keeps the long edge on a portrait photo, and never upscales", async () => {
		const drawImage = jest.fn();
		installCanvas({
			bitmap: { width: tall, height: wide, close: () => {} },
			blob: new Blob(["jpeg"]),
			context: { drawImage },
		});

		await downscaleImage(new Blob([]));
		expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1536, 2048);

		const small = jest.fn();
		installCanvas({
			bitmap: { width: smallWide, height: smallTall, close: () => {} },
			blob: new Blob(["jpeg"]),
			context: { drawImage: small },
		});
		await downscaleImage(new Blob([]), 2048);
		expect(small).toHaveBeenCalledWith(
			expect.anything(),
			0,
			0,
			smallWide,
			smallTall,
		);
	});

	it("says so when no canvas can be had, and when the re-encode fails", async () => {
		installCanvas({
			bitmap: { width: smallWide, height: smallWide, close: () => {} },
			blob: new Blob(["jpeg"]),
			context: null,
		});
		await expect(downscaleImage(new Blob([]))).rejects.toThrow("canvas");

		installCanvas({
			bitmap: { width: smallWide, height: smallWide, close: () => {} },
			blob: null,
			context: { drawImage: () => {} },
		});
		await expect(downscaleImage(new Blob([]))).rejects.toThrow("re-encode");
	});
});
