import { describe, expect, it } from "@jest/globals";
import { pickRung } from "@/models/column-bar";

const enUS = { labelled: 388, icons: 192 };
const svSE = { labelled: 369, icons: 185 };

describe("pickRung", () => {
	it("picks labelled when it fits, even by a pixel", () => {
		expect(pickRung({ labelled: 300, icons: 100 }, 300)).toBe("labelled");
	});

	it("picks icons when labelled overflows and icons fits", () => {
		expect(pickRung({ labelled: 301, icons: 100 }, 300)).toBe("icons");
	});

	it("falls to stacked when neither fits", () => {
		expect(pickRung({ labelled: 301, icons: 301 }, 300)).toBe("stacked");
	});

	it("is stacked before layout, when nothing is available", () => {
		expect(pickRung({ labelled: 0, icons: 0 }, 0)).toBe("stacked");
	});

	it("puts en-US default columns on icons at 384", () => {
		expect(pickRung(enUS, 384)).toBe("icons");
	});

	it("puts sv-SE default columns on labelled at 384", () => {
		expect(pickRung(svSE, 384)).toBe("labelled");
	});

	it("stacks either locale at 179", () => {
		expect(pickRung(enUS, 179)).toBe("stacked");
		expect(pickRung(svSE, 179)).toBe("stacked");
	});
});
