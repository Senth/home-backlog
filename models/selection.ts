import type { Status } from "@/models/node";

export interface SelectionState {
	status: Status | null;
	ids: string[];
	anchor: string | null;
}

export function toggle(
	state: SelectionState,
	card: { id: string; status: Status },
): SelectionState | null {
	if (state.status !== null && state.status !== card.status) return null;
	const ids = state.ids.includes(card.id)
		? state.ids.filter((id) => id !== card.id)
		: [...state.ids, card.id];
	return {
		status: ids.length === 0 ? null : card.status,
		ids,
		anchor: ids.at(-1) ?? null,
	};
}

export function range(
	state: SelectionState,
	card: { id: string; status: Status },
	visibleColumn: readonly { id: string }[],
): SelectionState | null {
	if (state.status !== null && state.status !== card.status) return null;
	const from = visibleColumn.findIndex(
		(candidate) => candidate.id === state.anchor,
	);
	const to = visibleColumn.findIndex((candidate) => candidate.id === card.id);
	if (from === -1 || to === -1) {
		return {
			status: card.status,
			ids: [...new Set([...state.ids, card.id])],
			anchor: card.id,
		};
	}
	const ids = visibleColumn
		.slice(Math.min(from, to), Math.max(from, to) + 1)
		.map((candidate) => candidate.id);
	return {
		...state,
		status: card.status,
		ids: [...new Set([...state.ids, ...ids])],
	};
}

export function prune(
	state: SelectionState,
	visibleIds: ReadonlySet<string>,
): SelectionState {
	const ids = state.ids.filter((id) => visibleIds.has(id));
	return {
		status: ids.length === 0 ? null : state.status,
		ids,
		anchor:
			state.anchor !== null && ids.includes(state.anchor)
				? state.anchor
				: (ids.at(-1) ?? null),
	};
}

export function ordered<T extends { id: string }>(
	state: SelectionState,
	column: readonly T[],
): T[] {
	const ids = new Set(state.ids);
	return column.filter((card) => ids.has(card.id));
}
