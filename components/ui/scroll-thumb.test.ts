import { scrollThumb } from "@/components/ui/scroll-thumb";
import { scrollbar } from "@/theme/tokens";

const cross = 300;

function vertical(content: number, visible: number, y: number) {
	return scrollThumb(
		{
			contentSize: { width: cross, height: content },
			layoutMeasurement: { width: cross, height: visible },
			contentOffset: { x: 0, y },
		},
		"vertical",
	);
}

describe("scrollThumb", () => {
	it("draws no thumb and fades nowhere when the content fits exactly", () => {
		expect(vertical(500, 500, 0)).toEqual({
			thumb: null,
			fade: { start: false, end: false },
		});
	});

	it("treats a 1px overflow as a fit", () => {
		expect(vertical(501, 500, 0)).toEqual({
			thumb: null,
			fade: { start: false, end: false },
		});
	});

	it("fades only the end at the top", () => {
		const { thumb, fade } = vertical(1000, 500, 0);
		expect(fade).toEqual({ start: false, end: true });
		expect(thumb).toEqual({ length: 250, offset: 0 });
	});

	it("fades only the start at the bottom", () => {
		const { thumb, fade } = vertical(1000, 500, 500);
		expect(fade).toEqual({ start: true, end: false });
		expect(thumb).toEqual({ length: 250, offset: 250 });
	});

	it("fades both edges mid-scroll", () => {
		const { thumb, fade } = vertical(1000, 500, 250);
		expect(fade).toEqual({ start: true, end: true });
		expect(thumb).toEqual({ length: 250, offset: 125 });
	});

	it("never draws the thumb shorter than minLength", () => {
		const { thumb } = vertical(100_000, 500, 0);
		expect(thumb?.length).toBe(scrollbar.minLength);
	});

	it("keeps the thumb inside the track on overscroll", () => {
		expect(vertical(1000, 500, -80).thumb?.offset).toBe(0);
		expect(vertical(1000, 500, 580).thumb?.offset).toBe(250);
	});

	it("reads width and x on the horizontal axis", () => {
		const content = 1200;
		const visible = 600;
		const { thumb, fade } = scrollThumb(
			{
				contentSize: { width: content, height: content * 4 },
				layoutMeasurement: { width: visible, height: cross },
				contentOffset: { x: visible, y: 0 },
			},
			"horizontal",
		);
		expect(thumb).toEqual({ length: 300, offset: 300 });
		expect(fade).toEqual({ start: true, end: false });
	});
});
