import { act, renderHook } from "@testing-library/react-native";
import type { View } from "react-native";
import {
	rowKey,
	screenKey,
	useLocationDrag,
} from "@/components/location/use-location-drag";
import { moveLocation, reorderLocation } from "@/data/locations";
import type { OutboxIntent } from "@/data/outbox-store";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { Location } from "@/models/locations";
import { projectLocations } from "@/models/outbox";

/**
 * `models/location-drag.ts` decides *where* a dropped place lands and is
 * tested on its own. What is here is the half that has no pure answer: a
 * gesture measured asynchronously, a drop that must not write a cycle, and
 * the reduced-motion landing.
 */

jest.mock("@/data/locations", () => ({
	moveLocation: jest.fn(() => Promise.resolve()),
	reorderLocation: jest.fn(() => Promise.resolve()),
}));

const mockSubmit = jest.fn();
let mockIntents: OutboxIntent[] = [];
jest.mock("@/contexts/OutboxContext", () => ({
	useOutbox: () => ({ submit: mockSubmit, intents: mockIntents }),
}));
jest.mock("@/data/outbox-store", () => ({
	intentMetadata: (homeId: string, subject: Location) => ({
		id: "intent-1",
		homeId,
		queuedAt: 1,
		title: subject.title,
		sourceParentId: subject.parentId,
		sourceAncestorIds: subject.ancestorIds,
	}),
}));

jest.mock("@/hooks/use-reduced-motion", () => ({
	useReducedMotion: jest.fn(),
}));

const moved = moveLocation as jest.MockedFunction<typeof moveLocation>;
const reducedMotion = useReducedMotion as jest.MockedFunction<
	typeof useReducedMotion
>;

const homeId = "home-1";

function location(
	id: string,
	ancestorIds: string[] = [],
	rank = "V0",
): Location {
	return {
		id,
		title: id,
		parentId: ancestorIds.at(-1) ?? null,
		ancestorIds,
		rank,
		icon: "crosshairs-gps",
		color: "stone",
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
	};
}

/** A view that answers `measureInWindow` on a later turn, as the real one does. */
function box(top: number, height: number, left = 0, width = 400): View {
	return {
		measureInWindow: (callback: (...frame: number[]) => void) => {
			setTimeout(() => callback(left, top, width, height), 0);
		},
	} as unknown as View;
}

// House → Garden → Shed, a second root, and a place with nothing under it.
// One hundred tall each, in the order the tree draws them.
const tree: Location[] = [
	location("house"),
	location("garden", ["house"]),
	location("shed", ["house", "garden"]),
	location("cellar", ["house"], "V2"),
	location("attic", [], "V1"),
];

function tree_() {
	return tree.map((each) => ({ ...each }));
}

function screen() {
	const onPutBack = jest.fn();
	const onError = jest.fn();
	const onQueued = jest.fn();
	const locations = tree_();

	const view = renderHook(
		(props: { locations: Location[] }) =>
			useLocationDrag({
				homeId,
				locations: props.locations,
				onPutBack,
				onError,
				onQueued,
			}),
		{ initialProps: { locations } },
	);

	view.result.current.register(screenKey)(box(0, 500));
	locations.forEach((each, index) => {
		view.result.current.register(rowKey(each.id))(box(index * 100, 100));
	});

	const measured = async () => {
		await act(async () => {
			jest.runAllTimers();
		});
	};

	const gesture = (place: Location) => ({
		grab: (point: { x: number; y: number }) => {
			act(() => view.result.current.handlers(place).onGrab(point));
		},
		move: (point: { x: number; y: number }) => {
			act(() => view.result.current.handlers(place).onMove(point));
		},
		drop: (point: { x: number; y: number }) => {
			act(() => view.result.current.handlers(place).onDrop(point));
		},
		cancel: () => {
			act(() => view.result.current.handlers(place).onCancel());
		},
	});

	return { view, onPutBack, onError, onQueued, measured, gesture };
}

beforeEach(() => {
	mockIntents = [];
	jest.useFakeTimers();
	reducedMotion.mockReturnValue(false);
	mockSubmit.mockImplementation(
		async (_intent: OutboxIntent, runOnline: () => Promise<void>) => {
			await runOnline();
			return "saved";
		},
	);
});

afterEach(() => {
	jest.useRealTimers();
});

describe("useLocationDrag", () => {
	it("rank-only sibling drop uses native reorder without outbox intent", async () => {
		mockSubmit.mockResolvedValue("queued");
		const { measured, gesture, onQueued } = screen();
		const attic = gesture(tree[4]);
		attic.grab({ x: 200, y: 450 });
		await measured();
		attic.move({ x: 200, y: 8 });
		attic.drop({ x: 200, y: 8 });
		await act(async () => {});
		expect(reorderLocation).toHaveBeenCalledWith(
			homeId,
			"attic",
			expect.any(String),
		);
		expect(moved).not.toHaveBeenCalled();
		expect(mockSubmit).not.toHaveBeenCalled();
		expect(onQueued).not.toHaveBeenCalled();
	});
	it("rank-only drop on projected move queues updated rank for same destination", async () => {
		mockIntents = [
			{
				id: "pending",
				homeId,
				queuedAt: 1,
				title: "cellar",
				sourceParentId: "house",
				sourceAncestorIds: ["house"],
				kind: "moveLocation",
				locationId: "cellar",
				parentId: "garden",
				rank: "V1",
			},
		];
		mockSubmit.mockResolvedValue("queued");
		const projected = projectLocations(tree, mockIntents, homeId).locations;
		const { view, measured, gesture, onQueued } = screen();
		view.rerender({ locations: projected });
		const cellar = gesture(projected[3]);
		cellar.grab({ x: 200, y: 350 });
		await measured();
		cellar.move({ x: 200, y: 208 });
		cellar.drop({ x: 200, y: 208 });
		await act(async () => {});
		expect(mockSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "moveLocation",
				locationId: "cellar",
				parentId: "garden",
				sourceParentId: "garden",
				rank: expect.any(String),
			}),
			expect.any(Function),
		);
		expect(mockSubmit.mock.calls[0][0].rank).not.toBe("V1");
		expect(reorderLocation).not.toHaveBeenCalled();
		expect(onQueued).toHaveBeenCalled();
	});
	it("offline drop submits and lands in projected tree without flying back", async () => {
		mockSubmit.mockResolvedValue("queued");
		const { view, measured, gesture, onQueued, onPutBack, onError } = screen();
		const cellar = gesture(tree[3]);
		cellar.grab({ x: 200, y: 350 });
		await measured();
		cellar.move({ x: 200, y: 150 });
		cellar.drop({ x: 200, y: 150 });
		await act(async () => {});
		const intent = mockSubmit.mock.calls[0][0];
		expect(intent).toEqual(
			expect.objectContaining({
				kind: "moveLocation",
				locationId: "cellar",
				parentId: "garden",
				targetTitle: "garden",
				sourceParentId: "house",
				sourceAncestorIds: ["house"],
			}),
		);
		expect(moved).not.toHaveBeenCalled();
		expect(view.result.current.dragged).toBeNull();
		expect(onQueued).toHaveBeenCalledWith(intent);
		expect(onPutBack).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
		const projected = projectLocations(tree, [intent], homeId).locations;
		view.rerender({ locations: projected });
		const movedCellar = projected.find((each) => each.id === "cellar");
		if (!movedCellar) throw new Error("Projected cellar missing");
		expect(movedCellar.parentId).toBe("garden");
		const again = gesture(movedCellar);
		again.grab({ x: 200, y: 350 });
		await measured();
		again.move({ x: 200, y: 450 });
		again.drop({ x: 200, y: 450 });
		await act(async () => {});
		expect(mockSubmit.mock.calls[1][0]).toEqual(
			expect.objectContaining({
				parentId: "attic",
				sourceParentId: "garden",
				sourceAncestorIds: ["house", "garden"],
			}),
		);
	});
	it("writes the re-parent a drop lands on", async () => {
		const { measured, gesture } = screen();
		const cellar = gesture(tree[3]);

		cellar.grab({ x: 200, y: 350 });
		await measured();
		// The middle of the garden row: into the garden, appended.
		cellar.move({ x: 200, y: 150 });
		cellar.drop({ x: 200, y: 150 });

		expect(moved).toHaveBeenCalledWith(
			homeId,
			expect.objectContaining({ id: "cellar" }),
			expect.objectContaining({ id: "garden" }),
			expect.any(String),
		);
	});

	it("writes the reorder a drop lands on, among the row's siblings", async () => {
		const { measured, gesture } = screen();
		const shed = gesture(tree[2]);

		shed.grab({ x: 200, y: 250 });
		await measured();
		// The bottom edge of the house row: after house, at the top level —
		// the row's own siblings, not its children.
		shed.move({ x: 200, y: 92 });
		shed.drop({ x: 200, y: 92 });

		expect(moved).toHaveBeenCalledWith(
			homeId,
			expect.objectContaining({ id: "shed" }),
			null,
			"V0V",
		);
	});

	it("refuses a cycle: dropping a place into its own subtree writes nothing", async () => {
		const { measured, gesture, onPutBack, onError } = screen();
		const garden = gesture(tree[1]);

		garden.grab({ x: 200, y: 150 });
		await measured();
		// The middle of shed, which is garden's own child.
		garden.move({ x: 200, y: 250 });
		garden.drop({ x: 200, y: 250 });

		expect(moved).not.toHaveBeenCalled();
		expect(onPutBack).toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});

	it("puts a place back, and says so, when it is dropped outside every row", async () => {
		const { measured, gesture, onPutBack } = screen();
		const attic = gesture(tree[4]);

		attic.grab({ x: 200, y: 450 });
		await measured();
		// Below the last row entirely.
		attic.move({ x: 200, y: 550 });
		attic.drop({ x: 200, y: 550 });

		expect(moved).not.toHaveBeenCalled();
		expect(onPutBack).toHaveBeenCalled();
	});

	it("says nothing and writes nothing for a place put back where it was", async () => {
		const { measured, gesture, onPutBack } = screen();
		const shed = gesture(tree[2]);

		shed.grab({ x: 200, y: 250 });
		await measured();
		// The top edge of shed's own row — refused, so put back, and the drop
		// lands where it started: no write, no sentence.
		shed.move({ x: 200, y: 208 });
		shed.drop({ x: 200, y: 208 });

		expect(moved).not.toHaveBeenCalled();
		expect(onPutBack).not.toHaveBeenCalled();
	});

	it("lands the place at once instead of settling it when motion is reduced", async () => {
		reducedMotion.mockReturnValue(true);
		const { view, measured, gesture } = screen();
		const attic = gesture(tree[4]);

		attic.grab({ x: 200, y: 450 });
		await measured();
		attic.move({ x: 200, y: 250 });
		attic.drop({ x: 200, y: 250 });

		expect(moved).toHaveBeenCalled();
		expect(view.result.current.dragged).toBeNull();
	});

	it("lifts nothing when the press is over before the measuring is", async () => {
		const { view, gesture } = screen();
		const attic = gesture(tree[4]);

		attic.grab({ x: 200, y: 450 });
		attic.drop({ x: 200, y: 450 });
		await act(async () => {
			jest.runAllTimers();
		});

		expect(view.result.current.dragged).toBeNull();
		expect(moved).not.toHaveBeenCalled();
	});
});
