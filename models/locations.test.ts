import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import {
	inSubtree,
	type Location,
	newLocationData,
	toLocation,
} from "@/models/locations";

function location(overrides: Partial<Location> = {}): Location {
	return {
		id: "garden",
		title: "Garden",
		parentId: null,
		ancestorIds: [],
		rank: "a0",
		createdAt: null,
		createdBy: "uid-owner",
		updatedAt: null,
		...overrides,
	};
}

function snapshot(id: string, data: DocumentData) {
	return {
		id,
		data: () => data,
	} as unknown as QueryDocumentSnapshot<DocumentData>;
}

describe("newLocationData", () => {
	it("trims the title", () => {
		expect(newLocationData({ title: "  Garden  ", rank: "a0" }).title).toBe(
			"Garden",
		);
	});

	it("derives a root's empty path", () => {
		expect(newLocationData({ title: "Garden", rank: "a0" })).toEqual({
			title: "Garden",
			rank: "a0",
			parentId: null,
			ancestorIds: [],
		});
	});

	it("derives a child's path from its parent, ending in the parent's id", () => {
		const data = newLocationData({
			title: "Trädgården",
			rank: "a1",
			parent: location({ id: "garden", ancestorIds: ["ute"] }),
		});

		expect(data.parentId).toBe("garden");
		expect(data.ancestorIds).toEqual(["ute", "garden"]);
	});
});

describe("inSubtree", () => {
	it("is the location itself", () => {
		expect(inSubtree(location({ id: "garden" }), "garden")).toBe(true);
	});

	it("is everything under it, at any depth", () => {
		const child = location({ id: "bed", ancestorIds: ["garden"] });
		const grandchild = location({
			id: "apples",
			ancestorIds: ["garden", "bed"],
		});

		expect(inSubtree(child, "garden")).toBe(true);
		expect(inSubtree(grandchild, "garden")).toBe(true);
	});

	it("is not an unrelated location", () => {
		expect(inSubtree(location({ id: "basement" }), "garden")).toBe(false);
	});
});

describe("toLocation", () => {
	it("reads a stored document", () => {
		const read = toLocation(
			snapshot("garden", {
				title: "Garden",
				parentId: "ute",
				ancestorIds: ["ute"],
				rank: "a1",
				createdAt: "stamp",
				createdBy: "uid-owner",
				updatedAt: "stamp",
			}),
		);

		expect(read).toEqual({
			id: "garden",
			title: "Garden",
			parentId: "ute",
			ancestorIds: ["ute"],
			rank: "a1",
			createdAt: "stamp",
			createdBy: "uid-owner",
			updatedAt: "stamp",
		});
	});

	it("coerces a document with missing or wrong-typed fields", () => {
		const read = toLocation(
			snapshot("garden", {
				title: 42,
				parentId: 7,
				ancestorIds: ["ute", null, 3],
				rank: null,
				createdBy: undefined,
			}),
		);

		expect(read).toEqual({
			id: "garden",
			title: "",
			parentId: null,
			ancestorIds: ["ute"],
			rank: "",
			createdAt: null,
			createdBy: "",
			updatedAt: null,
		});
	});
});
