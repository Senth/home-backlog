import { downscaleImage } from "@/utils/downscale";

// The native half refuses rather than passing a multi-megabyte original
// through: a quota paid in bytes the downscaler would have saved.
describe("downscaleImage (native)", () => {
	it("refuses on a platform with no canvas", async () => {
		await expect(downscaleImage(new Blob([]), 2048)).rejects.toThrow(
			"not implemented on this platform",
		);
	});
});
