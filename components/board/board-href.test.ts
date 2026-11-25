import {
	boardHref,
	detailsCardId,
	detailsHref,
	finishHref,
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

describe("finish URLs", () => {
	it("returns to the parent board with the project to finish", () => {
		expect(finishHref(null, "project-1")).toEqual({
			pathname: "/projects",
			params: { finish: "project-1" },
		});
		expect(finishHref("parent-1", "project-1")).toEqual({
			pathname: "/projects/[nodeId]",
			params: { nodeId: "parent-1", finish: "project-1" },
		});
	});
});
