import { inSubtree, type Location } from "@/models/locations";
import { childAncestorIds, movedAncestorIds } from "@/models/node";

type IntentSubject = {
	id: string;
	homeId: string;
	queuedAt: number;
	title: string;
	sourceParentId: string | null;
	sourceAncestorIds: string[];
};

export type Intent = IntentSubject &
	(
		| {
				kind: "moveLocation";
				locationId: string;
				parentId: string | null;
				rank: string;
		  }
		| { kind: "deleteLocation"; locationId: string }
		| {
				kind: "reparentNode";
				nodeId: string;
				parentId: string | null;
				rank: string;
		  }
		| { kind: "deleteNode"; nodeId: string }
		| {
				kind: "flipVisibility";
				nodeId: string;
				target: "shared" | "private";
				participantIds?: string[];
		  }
	);

function subjectId(intent: Intent): string {
	return "locationId" in intent ? intent.locationId : intent.nodeId;
}

export function enqueue(queue: readonly Intent[], intent: Intent): Intent[] {
	const sameTree = (earlier: Intent) =>
		earlier.homeId === intent.homeId &&
		"locationId" in earlier === "locationId" in intent;
	if (intent.kind === "deleteLocation" || intent.kind === "deleteNode") {
		return [
			...queue.filter(
				(earlier) =>
					!sameTree(earlier) ||
					(subjectId(earlier) !== subjectId(intent) &&
						!earlier.sourceAncestorIds.includes(subjectId(intent))),
			),
			intent,
		];
	}
	const index = queue.findIndex(
		(earlier) =>
			sameTree(earlier) &&
			earlier.kind === intent.kind &&
			subjectId(earlier) === subjectId(intent),
	);
	return index === -1
		? [...queue, intent]
		: queue.map((earlier, i) => (i === index ? intent : earlier));
}

export function removeIntent(queue: readonly Intent[], id: string): Intent[] {
	return queue.filter((intent) => intent.id !== id);
}

export function projectLocations(
	locations: readonly Location[],
	intents: readonly Intent[],
	homeId: string,
): { locations: Location[]; waitingIds: Set<string> } {
	let projected = [...locations];
	const waitingIds = new Set<string>();
	for (const intent of intents) {
		if (intent.homeId !== homeId || !("locationId" in intent)) continue;
		if (intent.kind === "deleteLocation") {
			projected = projected.filter(
				(location) => !inSubtree(location, intent.locationId),
			);
			continue;
		}
		const subject = projected.find(
			(location) => location.id === intent.locationId,
		);
		if (!subject) continue;
		waitingIds.add(subject.id);
		const parent =
			projected.find((location) => location.id === intent.parentId) ?? null;
		if (intent.parentId !== null && (!parent || inSubtree(parent, subject.id)))
			continue;
		const ancestorIds = childAncestorIds(parent);
		projected = projected.map((location) =>
			location.id === subject.id
				? {
						...location,
						parentId: intent.parentId,
						ancestorIds,
						rank: intent.rank,
					}
				: inSubtree(location, subject.id)
					? {
							...location,
							ancestorIds: movedAncestorIds(
								location.ancestorIds,
								subject.id,
								ancestorIds,
							),
						}
					: location,
		);
	}
	return {
		locations: projected,
		waitingIds: new Set(
			[...waitingIds].filter((id) =>
				projected.some((location) => location.id === id),
			),
		),
	};
}

export function hiddenNodeIds(
	intents: readonly Intent[],
	homeId: string,
): Set<string> {
	return new Set(
		intents
			.filter(
				(intent) =>
					intent.homeId === homeId &&
					(intent.kind === "deleteNode" ||
						(intent.kind === "reparentNode" &&
							intent.parentId !== intent.sourceParentId)),
			)
			.map(subjectId),
	);
}

export function waitingCountFor(
	nodeId: string,
	intents: readonly Intent[],
	homeId: string,
): number {
	return intents.filter(
		(intent) =>
			intent.homeId === homeId &&
			((intent.kind === "reparentNode" && intent.parentId === nodeId) ||
				(intent.kind === "deleteNode" && intent.sourceParentId === nodeId) ||
				(intent.kind === "flipVisibility" && intent.nodeId === nodeId)),
	).length;
}

export function pendingFlip(
	nodeId: string,
	intents: readonly Intent[],
): "shared" | "private" | null {
	for (let index = intents.length - 1; index >= 0; index--) {
		const intent = intents[index];
		if (intent.kind === "flipVisibility" && intent.nodeId === nodeId)
			return intent.target;
	}
	return null;
}

export type ErrorKey =
	| "error.moveOwnSubtree"
	| "error.moveVisibility"
	| "error.subtreeTooLarge"
	| "error.saveFailed";

export function classifyReplayError(
	reason: unknown,
): "retry" | "drop" | { refused: ErrorKey } {
	const code = (reason as { code?: string } | null)?.code;
	if (
		code === "unavailable" ||
		(reason instanceof TypeError &&
			["Failed to fetch", "Network request failed", "Load failed"].includes(
				reason.message,
			))
	)
		return "retry";
	if (code === "subject-not-found" || code === "already-at-target")
		return "drop";
	if (code === "move-own-subtree") return { refused: "error.moveOwnSubtree" };
	if (code === "move-visibility") return { refused: "error.moveVisibility" };
	if (code === "subtree-too-large") return { refused: "error.subtreeTooLarge" };
	return { refused: "error.saveFailed" };
}
