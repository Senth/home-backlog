import { desktopLayout, detailsContentLayout } from "@/models/desktop-layout";

describe("detailsContentLayout", () => {
	it.each([
		{ panelWidth: 195, split: false, contentWidth: 195, cardWidth: 163 },
		{ panelWidth: 390, split: false, contentWidth: 390, cardWidth: 358 },
		{ panelWidth: 400, split: false, contentWidth: 400, cardWidth: 368 },
		{ panelWidth: 719, split: false, contentWidth: 400, cardWidth: 368 },
		{ panelWidth: 720, split: true, contentWidth: 720, cardWidth: 344 },
		{ panelWidth: 800, split: true, contentWidth: 800, cardWidth: 424 },
	])(
		"allocates details at $panelWidth pixels",
		({ panelWidth, ...expected }) => {
			expect(detailsContentLayout(panelWidth)).toEqual({
				...expected,
				fieldsWidth: 320,
			});
		},
	);
});

describe("desktopLayout model", () => {
	it.each([
		{
			windowWidth: 390,
			nav: "tabs",
			details: "page",
			panelWidth: 0,
			columnWidth: 300,
			split: false,
		},
		{
			windowWidth: 720,
			nav: "rail",
			details: "overlay",
			panelWidth: 400,
			columnWidth: 300,
			split: false,
		},
		{
			windowWidth: 1024,
			nav: "rail",
			details: "overlay",
			panelWidth: 400,
			columnWidth: 300,
			split: false,
		},
		{
			windowWidth: 1440,
			nav: "rail",
			details: "overlay",
			panelWidth: 400,
			columnWidth: 320,
			split: false,
		},
		{
			windowWidth: 1759,
			nav: "rail",
			details: "overlay",
			panelWidth: 400,
			columnWidth: 399.75,
			split: false,
		},
		{
			windowWidth: 1760,
			nav: "rail",
			details: "beside",
			panelWidth: 400,
			columnWidth: 300,
			split: false,
		},
		{
			windowWidth: 1920,
			nav: "rail",
			details: "beside",
			panelWidth: 400,
			columnWidth: 340,
			split: false,
		},
		{
			windowWidth: 2480,
			nav: "rail",
			details: "beside",
			panelWidth: 720,
			columnWidth: 400,
			split: true,
		},
		{
			windowWidth: 2560,
			nav: "rail",
			details: "beside",
			panelWidth: 800,
			columnWidth: 400,
			split: true,
		},
	])("lays out a four-column board at $windowWidth pixels", (expected) => {
		const layout = desktopLayout({
			windowWidth: expected.windowWidth,
			columnCount: 4,
			screen: "board",
		});

		expect(layout.nav).toBe(expected.nav);
		expect(layout.details).toBe(expected.details);
		expect(layout.panelWidth).toBe(expected.panelWidth);
		expect(layout.columnWidth).toBeCloseTo(expected.columnWidth);
		expect(layout.split).toBe(expected.split);
	});

	it("uses expanded flow columns on page and overlay layouts", () => {
		expect(
			desktopLayout({ windowWidth: 700, columnCount: 1, screen: "flow" })
				.columnWidth,
		).toBe(668);
		expect(
			desktopLayout({ windowWidth: 1100, columnCount: 2, screen: "flow" })
				.columnWidth,
		).toBe(486);
	});

	it.each([
		{ columnCount: 3, besideMin: 1444 },
		{ columnCount: 5, besideMin: 2076 },
	])("uses $columnCount columns in besideMin", ({ columnCount, besideMin }) => {
		expect(
			desktopLayout({
				windowWidth: besideMin - 1,
				columnCount,
				screen: "board",
			}).details,
		).toBe("overlay");
		expect(
			desktopLayout({ windowWidth: besideMin, columnCount, screen: "board" }),
		).toMatchObject({
			details: "beside",
			panelWidth: 400,
			columnWidth: 300,
		});
	});
});
