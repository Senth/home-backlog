import { asObject } from "./body.js";
import { ApiError, type ApiErrorDetail } from "./errors.js";
import { maxBatchWrites } from "./firestore.js";
import { childAncestorIds, rankSequence } from "./node.js";
import {
	defaultLocationColor,
	defaultLocationIcon,
	type LocationContext,
	validateLocation,
} from "./validate.js";

/**
 * A whole place tree, planned before a single document is written — the node
 * bulk create (`bulk.ts`), mirrored for locations.
 *
 * Everything `bulk.ts` decided holds here, for the same reasons: validate all,
 * then commit atomically; the server assigns ids and the payload uses local
 * refs; one call is one new root, which is what makes a run undoable. What a
 * location does not have, this planner does not need: no visibility split (a
 * place is household furniture, uniform for every member), no counters, no
 * per-column ranks — a location's rank orders it among its siblings, and the
 * caller's list order *is* that order, so `rank` is not a field a payload
 * carries.
 */

/**
 * The most places one call may carry.
 *
 * A Firestore batch commits 500 writes, and the replay record is spoken for.
 * Locations carry no counters, so unlike the node bulk there is nothing else
 * riding in the batch.
 */
export const maxBulkLocations = maxBatchWrites - 1;

export interface BulkLocation {
	/** Caller-chosen, unique, and meaningful only inside this request. */
	ref: string;
	/** Another place's `ref`. Absent on exactly one place: the new root. */
	parentRef: string | null;
	title?: string;
	/** What the place is recognisable by (#205); defaulted when omitted. */
	icon?: string;
	color?: string;
	/** Where this place sat in the request, so an error can point at it. */
	index: number;
}

export interface BulkLocationsPayload {
	/** An existing place to attach the new root under, or null for a root place. */
	parentId: string | null;
	locations: BulkLocation[];
}

export interface BulkLocationsPlanItem {
	ref: string;
	id: string;
	data: Record<string, unknown>;
}

export interface BulkLocationsPlan {
	rootId: string;
	/** `ref` → id, which is what the response returns and the replay stores. */
	ids: Record<string, string>;
	items: BulkLocationsPlanItem[];
}

export interface BulkLocationsContext {
	payload: BulkLocationsPayload;
	/** One generated document id per ref, made by the handler. */
	idFor: Record<string, string>;
	/** The existing place the root attaches under, already resolved, or null. */
	parent: { id: string; ancestorIds: string[] } | null;
	/** The rank the new root takes among its existing siblings. */
	rootRank: string;
	createdBy: string;
	/** A server timestamp sentinel, or a real date in a test. */
	now: unknown;
}

function fail(details: ApiErrorDetail[]): never {
	throw new ApiError(
		400,
		details[0].code,
		details.length === 1
			? details[0].message
			: `${details.length} places in this payload are not valid. Nothing was written.`,
		details,
	);
}

/**
 * Read a bulk payload, with each place's own fields checked by the same
 * allow-list a single create uses.
 *
 * `ref` and `parentRef` are permitted alongside `title`; `parentId` on a place
 * is not — inside a payload, structure is expressed in refs — and neither is
 * `rank`, which the list order replaces.
 */
export function parseBulkLocationsBody(body: unknown): BulkLocationsPayload {
	const raw = asObject(body);

	const parentId =
		raw.parentId === undefined || raw.parentId === null
			? null
			: typeof raw.parentId === "string"
				? raw.parentId
				: fail([
						{
							field: "parentId",
							code: "invalid_type",
							message: "parentId must be a location id or null.",
						},
					]);

	if (!Array.isArray(raw.locations)) {
		fail([
			{
				field: "locations",
				code: "invalid_type",
				message: "locations must be a list of places to create.",
			},
		]);
	}
	if (raw.locations.length === 0) {
		fail([
			{
				field: "locations",
				code: "empty_payload",
				message: "A bulk create needs at least one place.",
			},
		]);
	}
	if (raw.locations.length > maxBulkLocations) {
		fail([
			{
				field: "locations",
				code: "too_many_locations",
				message: `A bulk create writes at most ${maxBulkLocations} places, because it commits as one atomic batch. Send the rest as a second run under the same root.`,
			},
		]);
	}

	const details: ApiErrorDetail[] = [];
	const locations: BulkLocation[] = [];

	for (const [index, entry] of raw.locations.entries()) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			details.push({
				index,
				field: "locations",
				code: "invalid_type",
				message: "Every entry must be an object.",
			});
			continue;
		}
		const object = entry as Record<string, unknown>;

		if ("parentId" in object) {
			details.push({
				index,
				field: "parentId",
				code: "parent_id_in_bulk",
				message:
					"Inside a payload, name the parent with parentRef. The request's own parentId attaches the whole tree under an existing place.",
			});
			continue;
		}
		if ("rank" in object) {
			details.push({
				index,
				field: "rank",
				code: "unknown_field",
				message:
					"Inside a payload, siblings land in the order you list them; rank is not a field here.",
			});
			continue;
		}

		const unknown = Object.keys(object).filter(
			(field) =>
				field !== "ref" &&
				field !== "parentRef" &&
				field !== "title" &&
				field !== "icon" &&
				field !== "color",
		);
		if (unknown.length > 0) {
			for (const field of unknown) {
				details.push({
					index,
					field,
					code: "unknown_field",
					message: `${field} is not a field a bulk entry writes. Allowed: ref, parentRef, title, icon, color.`,
				});
			}
			continue;
		}

		const ref = object.ref;
		if (typeof ref !== "string" || ref.length === 0) {
			details.push({
				index,
				field: "ref",
				code: "ref_required",
				message: "Every place needs a ref, so the others can point at it.",
			});
			continue;
		}
		const parentRef = object.parentRef ?? null;
		if (parentRef !== null && typeof parentRef !== "string") {
			details.push({
				index,
				field: "parentRef",
				code: "invalid_type",
				message: "parentRef must be another place's ref, or absent.",
			});
			continue;
		}
		const title = object.title;
		if (title !== undefined && typeof title !== "string") {
			details.push({
				index,
				field: "title",
				code: "invalid_type",
				message: "title must be a string.",
			});
			continue;
		}
		const icon = object.icon;
		if (icon !== undefined && typeof icon !== "string") {
			details.push({
				index,
				field: "icon",
				code: "invalid_type",
				message: "icon must be a string.",
			});
			continue;
		}
		const color = object.color;
		if (color !== undefined && typeof color !== "string") {
			details.push({
				index,
				field: "color",
				code: "invalid_type",
				message: "color must be a string.",
			});
			continue;
		}

		locations.push({
			ref,
			parentRef,
			...(title !== undefined ? { title } : {}),
			...(icon !== undefined ? { icon } : {}),
			...(color !== undefined ? { color } : {}),
			index,
		});
	}

	if (details.length > 0) fail(details);
	return { parentId, locations };
}

/**
 * Turn a payload into the exact documents to write, or refuse it whole.
 *
 * Pure: no I/O, so the write is a separate step that either commits everything
 * or nothing. Breadth-first from the one root, exactly as `planBulk` walks —
 * anything it does not reach is in a cycle among itself, and would otherwise
 * commit as places unreachable from the tree screen.
 */
export function planBulkLocations(
	context: BulkLocationsContext,
): BulkLocationsPlan {
	const { payload, idFor, parent, rootRank, createdBy, now } = context;
	const { locations } = payload;

	const details: ApiErrorDetail[] = [];
	const byRef = new Map<string, BulkLocation>();

	for (const location of locations) {
		if (byRef.has(location.ref)) {
			details.push({
				index: location.index,
				field: "ref",
				code: "duplicate_ref",
				message: `Two places share the ref "${location.ref}".`,
			});
			continue;
		}
		byRef.set(location.ref, location);
	}
	if (details.length > 0) fail(details);

	for (const location of locations) {
		if (location.parentRef !== null && !byRef.has(location.parentRef)) {
			details.push({
				index: location.index,
				field: "parentRef",
				code: "unknown_parent_ref",
				message: `No place in this payload has the ref "${location.parentRef}". To attach under an existing place, use the request's parentId.`,
			});
		}
	}
	if (details.length > 0) fail(details);

	const roots = locations.filter((location) => location.parentRef === null);
	if (roots.length !== 1) {
		// One call is one new root, which is what makes a run undoable: one run,
		// one root, one delete, one confirmation dialog.
		fail(
			roots.length === 0
				? [
						{
							field: "locations",
							code: "no_root",
							message:
								"Exactly one place must have no parentRef. This payload has none, which means its refs form a cycle.",
						},
					]
				: roots.map((location) => ({
						index: location.index,
						field: "parentRef",
						code: "not_one_root",
						message: `One call creates one subtree, so exactly one place may have no parentRef. This payload has ${roots.length}.`,
					})),
		);
	}

	const root = roots[0];
	const childrenOf = new Map<string, BulkLocation[]>();
	for (const location of locations) {
		if (location.parentRef === null) continue;
		const siblings = childrenOf.get(location.parentRef) ?? [];
		siblings.push(location);
		childrenOf.set(location.parentRef, siblings);
	}

	const items: BulkLocationsPlanItem[] = [];
	const factsOf = new Map<string, { id: string; ancestorIds: string[] }>();
	const queue: {
		location: BulkLocation;
		facts: { id: string; ancestorIds: string[] } | null;
		rank: string;
	}[] = [{ location: root, facts: parent, rank: rootRank }];

	while (queue.length > 0) {
		const { location, facts, rank } = queue.shift() as (typeof queue)[number];
		const id = idFor[location.ref];

		const data: Record<string, unknown> = {
			title: (location.title ?? "").trim(),
			parentId: facts?.id ?? null,
			// Derived from parentId, never taken from the body — the same rule the
			// single create runs, for the same reason: a caller-supplied path is
			// exactly what cannot be verified from outside.
			ancestorIds: childAncestorIds(facts),
			rank,
			icon: location.icon ?? defaultLocationIcon,
			color: location.color ?? defaultLocationColor,
			createdAt: now,
			createdBy,
			updatedAt: now,
		};
		const locationContext: LocationContext = {
			locationId: id,
			parent: facts,
		};
		for (const issue of validateLocation(data, locationContext)) {
			details.push({ ...issue, index: location.index });
		}

		items.push({ ref: location.ref, id, data });

		const own = { id, ancestorIds: data.ancestorIds as string[] };
		factsOf.set(location.ref, own);

		// Ranks come from one `rankSequence` per parent, in the order the caller
		// listed them. The root is the only place whose rank must weave into
		// existing siblings — the handler hands that one in.
		const children = childrenOf.get(location.ref) ?? [];
		const ranks = rankSequence(null, null, children.length);
		for (const [position, child] of children.entries()) {
			queue.push({ location: child, facts: own, rank: ranks[position] });
		}
	}

	if (items.length !== locations.length) {
		const stranded = locations.filter((location) => !factsOf.has(location.ref));
		details.push(
			...stranded.map((location) => ({
				index: location.index,
				field: "parentRef",
				code: "cycle",
				message: `"${location.ref}" is not reachable from the payload's root, so its refs form a cycle.`,
			})),
		);
	}

	if (details.length > 0) fail(details);

	return {
		rootId: idFor[root.ref],
		ids: Object.fromEntries(items.map((item) => [item.ref, item.id])),
		items,
	};
}
