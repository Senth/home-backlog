import { copyText } from "@/utils/copy-text.web";

const realNavigator = globalThis.navigator;

function install(options: { writeText?: jest.Mock; execCommand: boolean }): {
	field: { value: string; select: jest.Mock; remove: jest.Mock };
} {
	const field = { value: "", select: jest.fn(), remove: jest.fn() };
	(globalThis as Record<string, unknown>).navigator = options.writeText
		? { clipboard: { writeText: options.writeText } }
		: {};
	globalThis.document = {
		createElement: jest.fn(() => field),
		body: { append: jest.fn() },
		execCommand: jest.fn(() => options.execCommand),
	} as unknown as typeof document;
	return { field };
}

afterEach(() => {
	delete (globalThis as { document?: unknown }).document;
	(globalThis as Record<string, unknown>).navigator = realNavigator;
});

describe("copyText (web)", () => {
	it("is true when the async clipboard takes the write", async () => {
		const writeText = jest.fn(async () => undefined);
		install({ writeText, execCommand: false });
		await expect(copyText("rows")).resolves.toBe(true);
		expect(writeText).toHaveBeenCalledWith("rows");
		expect(document.execCommand).not.toHaveBeenCalled();
	});

	it("falls back to execCommand when the clipboard is denied", async () => {
		const writeText = jest.fn(async () => {
			throw new DOMException("denied", "NotAllowedError");
		});
		const { field } = install({ writeText, execCommand: true });
		await expect(copyText("rows")).resolves.toBe(true);
		expect(field.value).toBe("rows");
		expect(field.remove).toHaveBeenCalled();
	});

	it("is false when both the clipboard and execCommand refuse", async () => {
		const writeText = jest.fn(async () => {
			throw new DOMException("denied", "NotAllowedError");
		});
		const { field } = install({ writeText, execCommand: false });
		await expect(copyText("rows")).resolves.toBe(false);
		expect(field.remove).toHaveBeenCalled();
	});

	it("falls back when there is no async clipboard at all", async () => {
		install({ execCommand: false });
		await expect(copyText("rows")).resolves.toBe(false);
	});
});
