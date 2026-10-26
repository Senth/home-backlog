import { EventEmitter } from "node:events";
import type { ConsoleMessage, Page } from "@playwright/test";
import { recordConsole } from "@/e2e/support/app";

const badRequest =
	"Failed to load resource: the server responded with a status of 400 (Bad Request)";
const lookup =
	"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=test";

function message(text: string, url: string, type = "error") {
	return {
		text: () => text,
		type: () => type,
		location: () => ({ url, lineNumber: 0, columnNumber: 0 }),
	} as ConsoleMessage;
}

it.each([
	lookup,
	"http://localhost:7001/identitytoolkit.googleapis.com/v1/accounts:lookup?key=test",
])("allows only the expected lookup rejection at %s", (url) => {
	const page = new EventEmitter();
	const recording = recordConsole(page as unknown as Page);
	page.emit("console", message(badRequest, url));
	expect(recording.errors()).toEqual([]);
	expect(recording.warnings()).toEqual([]);
	expect(recording.all()).toEqual([`[error] ${badRequest}`]);
});

it.each([
	[badRequest, ""],
	[badRequest, "https://example.com/v1/accounts:lookup"],
	[
		badRequest,
		"https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp",
	],
	[badRequest, `${lookup.replace("?key=test", "")}/other`],
	[badRequest, "http://localhost:7001/other/v1/accounts:lookup"],
	[
		badRequest,
		"https://example.com/?url=https://identitytoolkit.googleapis.com/v1/accounts:lookup",
	],
	[
		badRequest.replace("400 (Bad Request)", "500 (Internal Server Error)"),
		lookup,
	],
	[`${badRequest} unexpected detail`, lookup],
	["Unexpected auth error", lookup],
])("keeps other errors visible: %s at %s", (text, url) => {
	const page = new EventEmitter();
	const recording = recordConsole(page as unknown as Page);
	page.emit("console", message(text, url));
	expect(recording.errors()).toEqual([text]);
});

it("does not exempt warnings or uncaught exceptions", () => {
	const page = new EventEmitter();
	const recording = recordConsole(page as unknown as Page);
	page.emit("console", message(badRequest, lookup, "warning"));
	page.emit("pageerror", new Error(badRequest));
	expect(recording.warnings()).toEqual([badRequest]);
	expect(recording.errors()).toEqual([`uncaught: ${badRequest}`]);
});
