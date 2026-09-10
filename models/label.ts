import type { DocumentData } from "firebase/firestore";
import { rankBetween } from "@/models/node";

/**
 * A household's label definitions (#100) — the set a project passes down to
 * everything inside it.
 *
 * They live in a `labels` map on the home document, so `HomeContext` carries
 * them to every screen for free: no listener, no rules block of their own. A
 * card names them by id in `labelIds`, and a label whose definition has been
 * deleted resolves to nothing and renders nothing — the same defensive read
 * `toNode` performs for every other reference field.
 */

export interface Label {
	title: string;
	/** An `@expo/vector-icons` MaterialCommunityIcons glyph name. */
	icon: string;
	/**
	 * The color exactly as picked — one of `theme`'s twelve `labelHues` or a
	 * custom hex. Never rendered raw: `models/label-color.ts` clamps it at
	 * draw time, so a change to `boardCard` or to the floor re-derives every
	 * custom color instead of silently invalidating what was stored.
	 */
	color: string;
	/** Fractional index, ordered within the home's set — the same scheme as a node's. */
	rank: string;
}

/** What a card may carry at most — what the picker refuses and the gutter is built around. */
export const maxLabelsPerNode = 6;

/**
 * How many labels a home may define. The 300 lives in three places that must
 * agree: here, `validLabels()` in `firestore.rules`, and the functions mirror.
 */
export const maxLabelsPerHome = 300;

/**
 * Longest title a label may have. The rules cannot iterate the map's values to
 * hold this — `validLabels()` caps the container — so this and `labelError()`
 * are where the bound lives.
 */
export const maxLabelTitleLength = 60;

/** Why a typed label title cannot be saved, as the key that says so. */
export type LabelTitleError =
	| "labels.titleRequired"
	| "labels.titleTaken"
	| "labels.titleTooLong";

/**
 * The one validation a label title has, checked here rather than in the dialog
 * so the rules are not the first thing that says no. Two definitions cannot
 * share a name: `existing` is the home's current set and `selfId` the label
 * being renamed, so a rename never collides with itself.
 */
export function labelError(
	title: string,
	existing: readonly LabelWithId[],
	selfId?: string | null,
): LabelTitleError | null {
	const trimmed = title.trim();
	if (trimmed.length === 0) return "labels.titleRequired";
	if (trimmed.length > maxLabelTitleLength) return "labels.titleTooLong";
	const name = trimmed.toLowerCase();
	const taken = existing.some(
		(label) => label.id !== selfId && label.title.trim().toLowerCase() === name,
	);
	return taken ? "labels.titleTaken" : null;
}

export interface NewLabelInput {
	title: string;
	icon: string;
	color: string;
	/** From `rankAtEnd()` / `rankBetween()` against the home's current set. */
	rank: string;
}

export function newLabel(input: NewLabelInput): Label {
	return {
		title: input.title.trim(),
		icon: input.icon,
		color: input.color,
		rank: input.rank,
	};
}

/** One row of the labels map — the definition joined back with its key. */
export interface LabelWithId extends Label {
	/** The key the definition sits under in the home's `labels` map. */
	id: string;
}

/**
 * The labels one card answers to: its own unioned with everything its
 * ancestors pass down (#100), named by the home's definitions.
 *
 * `ownIds` are the card's `labelIds`; `ancestorIds` are the ids carried by its
 * trail, flattened by the caller. The result follows the home's label order —
 * `toLabels` hands it in already sorted — so a card's dots read in the same
 * order on every card, own and inherited alike. An id whose definition was
 * deleted resolves to nothing here, the same defensive drop `toLabels` makes
 * for a malformed one; the node keeps the id and stays updatable. The cap is
 * what the gutter is built around.
 */
export function effectiveLabels(
	ownIds: readonly string[],
	ancestorIds: readonly string[],
	labels: readonly LabelWithId[],
): LabelWithId[] {
	const applied = new Set([...ownIds, ...ancestorIds]);
	return labels
		.filter((label) => applied.has(label.id))
		.slice(0, maxLabelsPerNode);
}

/**
 * The rank a label lands on when it moves one step up or down the home's list
 * (#100). Only the moved label is written: its swap partner keeps its rank,
 * and the mover lands between the pair that surrounds it afterwards — the
 * label two places away on the side it came from, and the one it passed.
 * The edges answer `null`, and the caller leaves the handle alone there.
 */
export function movedRank(
	labels: readonly LabelWithId[],
	index: number,
	delta: -1 | 1,
): string | null {
	const target = index + delta;
	if (target < 0 || target >= labels.length) return null;
	return delta === -1
		? rankBetween(
				labels[index - 2]?.rank ?? null,
				labels[index - 1]?.rank ?? null,
			)
		: rankBetween(
				labels[index + 1]?.rank ?? null,
				labels[index + 2]?.rank ?? null,
			);
}

/**
 * The home's labels, read defensively.
 *
 * Every field is written by this app, but the map is a free-form object in
 * Firestore and the rules cannot iterate its values — so a malformed entry is
 * dropped here rather than crashing every screen that draws a card. The result
 * is in the home's order: rank, then key, which is the tie-break a board uses.
 */
export function toLabels(data: DocumentData | null | undefined): LabelWithId[] {
	const stored = data?.labels;
	if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
		return [];
	}

	const labels: LabelWithId[] = [];
	for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
		const entry = value as Partial<Record<keyof Label, unknown>> | null;
		if (
			typeof entry?.title !== "string" ||
			typeof entry.icon !== "string" ||
			typeof entry.color !== "string" ||
			typeof entry.rank !== "string"
		) {
			continue;
		}
		labels.push({
			id,
			title: entry.title,
			icon: entry.icon,
			color: entry.color,
			rank: entry.rank,
		});
	}

	return labels.sort(
		(a, b) =>
			(a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) ||
			a.id.localeCompare(b.id),
	);
}
