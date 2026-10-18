import {
	boardHref,
	detailsCardId,
	detailsHref,
} from "@/components/board/board-href";

describe("details URLs", () => {
	it("keeps phone details and board drill-down free of card params", () => {
		expect(detailsHref("card-1")).toEqual({
			pathname: "/projects/[nodeId]/details",
			params: { nodeId: "card-1" },
		});
		expect(boardHref(null)).toEqual({ pathname: "/projects" });
		expect(boardHref("project-1")).toEqual({
			pathname: "/projects/[nodeId]",
			params: { nodeId: "project-1" },
		});
	});

	it("opens a card beside its root or nested parent board", () => {
		expect(boardHref(null, "card-1")).toEqual({
			pathname: "/projects",
			params: { card: "card-1" },
		});
		expect(boardHref("project-1", "card-1")).toEqual({
			pathname: "/projects/[nodeId]",
			params: { nodeId: "project-1", card: "card-1" },
		});
	});

	it("accepts one document id, never an empty, repeated or path-shaped query", () => {
		expect(detailsCardId("card-1")).toBe("card-1");
		for (const value of [undefined, "", ["one", "two"], "one/two", ".", ".."])
			expect(detailsCardId(value)).toBeNull();
	});
});
