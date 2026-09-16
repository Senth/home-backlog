import type { Request, Response, Router } from "express";
import type { DocumentReference } from "firebase-admin/firestore";
import { apiCardRow } from "./api-nodes.js";
import { type ApiCaller, caller, homeAccess, recordWrite } from "./auth.js";
import { parseCardBody } from "./body.js";
import {
	type Card,
	type CardFields,
	type CardRow,
	type CardScope,
	cardsMap,
	etagForCard,
	mergeCards,
	overviewLimit,
	readCard,
	rowsPerSection,
	validateCard,
} from "./card.js";
import { ApiError } from "./errors.js";
import {
	dashboardCardsCollection,
	dashboardCollection,
	dashboardConfigDoc,
	dashboardsCollection,
	db,
	homesCollection,
	usersCollection,
} from "./firestore.js";
import { handle, param } from "./handler.js";
import { rankAfter, rankSequence } from "./node.js";
import { checkEtag } from "./writes.js";

/**
 * The Overview card verbs (#255): the dashboard card config, read and written
 * as the editor sees it.
 *
 * Three surfaces, exactly `data/cards.ts`'s. A key is its owner, so the two
 * per-user surfaces are the caller's own documents — the global config under
 * `users/{uid}` and their home doc under `homes/{homeId}/dashboards` — and the
 * shared collection is the one surface any member writes, one document per
 * card so two members editing two shared cards never clobber each other. The
 * rules enforce none of this on this path, because the Admin SDK bypasses
 * them; it is enforced by construction: the only uid ever written into a
 * per-user path is the caller's own.
 *
 * The merge, the removal semantics and the scope move mirror the app field
 * for field. A per-user surface is a map field on one document, and Firestore
 * unions map fields key by key — so every map write replaces the field whole,
 * or a removed card survives the write exactly as it would in the app. A
 * scope move is one transaction, because a card left on two surfaces under
 * one id would render once and be editable from neither. And nothing here
 * ever seeds: the built-in cards are written by the app's first open, and a
 * seed the household removed stays removed.
 */

function globalConfigRef(uid: string): DocumentReference {
	return db
		.collection(usersCollection)
		.doc(uid)
		.collection(dashboardCollection)
		.doc(dashboardConfigDoc);
}

function homeDashboardRef(homeId: string, uid: string): DocumentReference {
	return db
		.collection(homesCollection)
		.doc(homeId)
		.collection(dashboardsCollection)
		.doc(uid);
}

function sharedCards(homeId: string) {
	return db
		.collection(homesCollection)
		.doc(homeId)
		.collection(dashboardCardsCollection);
}

function notFound(cardId: string, homeId: string): ApiError {
	return new ApiError(404, "card_not_found", `No card ${cardId} in ${homeId}.`);
}

/** One surface's cards as the map field the two per-user docs store. */
function cardsIn(map: unknown): Card[] {
	if (map === null || typeof map !== "object" || Array.isArray(map)) return [];
	return Object.entries(map as Record<string, unknown>)
		.map(([id, value]) => readCard(id, value as Record<string, unknown>))
		.filter((card): card is Card => card !== null);
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/** The three surfaces as the caller owns them — plus what they hid. */
interface Surfaces {
	global: Card[];
	home: Card[];
	shared: Card[];
	hiddenSharedIds: string[];
}

async function readSurfaces(homeId: string, uid: string): Promise<Surfaces> {
	const [globalDoc, homeDoc, sharedDocs] = await Promise.all([
		globalConfigRef(uid).get(),
		homeDashboardRef(homeId, uid).get(),
		sharedCards(homeId).get(),
	]);
	return {
		global: cardsIn(globalDoc.get("cards")),
		home: cardsIn(homeDoc.get("cards")),
		shared: sharedDocs.docs
			.map((document) => readCard(document.id, document.data()))
			.filter((card): card is Card => card !== null),
		hiddenSharedIds: strings(homeDoc.get("hiddenSharedIds")),
	};
}

function rowsOf(surfaces: Surfaces): CardRow[] {
	return mergeCards(
		surfaces.global,
		surfaces.home,
		surfaces.shared,
		surfaces.hiddenSharedIds,
	);
}

/** Turn validation issues into the one 400 that names all of them at once. */
function refuseInvalidCard(fields: CardFields): void {
	const issues = validateCard(fields);
	if (issues.length === 0) return;

	throw new ApiError(
		400,
		issues[0].code,
		issues[0].message,
		issues.map((issue) => ({
			field: issue.field,
			code: issue.code,
			message: issue.message,
		})),
	);
}

/** The map document one non-shared scope stores its cards on. */
function mapRef(
	scope: "global" | "home",
	homeId: string,
	uid: string,
): DocumentReference {
	return scope === "global"
		? globalConfigRef(uid)
		: homeDashboardRef(homeId, uid);
}

/**
 * A fresh auto-id for a card, minted on the surface it will live on — the
 * same shape `newCardId` mints in the app, so a card keeps its id when it
 * later moves scope.
 */
function mintId(scope: CardScope, homeId: string, uid: string): string {
	if (scope === "shared") return sharedCards(homeId).doc().id;
	if (scope === "home") {
		return db
			.collection(homesCollection)
			.doc(homeId)
			.collection(dashboardsCollection)
			.doc().id;
	}
	return db
		.collection(usersCollection)
		.doc(uid)
		.collection(dashboardCollection)
		.doc().id;
}

async function listCards(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	await homeAccess(me, homeId);

	const surfaces = await readSurfaces(homeId, me.uid);

	response.json({
		cards: rowsOf(surfaces).map((row) => apiCardRow(row)),
	});
}

async function createCard(request: Request, response: Response): Promise<void> {
	const me: ApiCaller = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const body = parseCardBody(request.body, "create");
	// `scope` is required here and only here: a create has to name the surface
	// it lands on, and an omitted one would quietly decide for the caller.
	if (body.scope === undefined) {
		throw new ApiError(
			400,
			"invalid_scope",
			"scope is required on a create: one of global, home, shared.",
		);
	}
	const scope = body.scope;

	const surfaces = await readSurfaces(homeId, me.uid);
	const card: Card = {
		id: mintId(scope, homeId, me.uid),
		kind: "filter",
		seedId: null,
		title: (body.title ?? "").trim(),
		conditions: (body.conditions ?? []) as Card["conditions"],
		sort: (body.sort ?? null) as Card["sort"],
		shown: body.shown ?? rowsPerSection,
		max: body.max ?? overviewLimit,
		empty: (body.empty ?? {
			mode: "say",
			key: "overview.cards.empty.generic",
		}) as Card["empty"],
		// Appended at the end of the merged list, exactly as the app's composer
		// appends — wherever the card lands.
		rank: rankAfter(rowsOf(surfaces).map((row) => row.card.rank)),
	};

	refuseInvalidCard(card as unknown as CardFields);

	await db.runTransaction(async (tx) => {
		if (scope === "shared") {
			tx.set(sharedCards(homeId).doc(card.id), card);
			return;
		}
		// Re-read inside the transaction, so two writers appending to one map
		// cannot lose one of the two cards between read and write.
		const stored = cardsIn(
			(await tx.get(mapRef(scope, homeId, me.uid))).get("cards"),
		);
		tx.set(
			mapRef(scope, homeId, me.uid),
			{ cards: cardsMap([...stored, card]) },
			{ mergeFields: ["cards"] },
		);
	});
	await recordWrite(me, home);

	response.status(201).json(apiCardRow({ card, scope, hidden: false }));
}

async function patchCard(request: Request, response: Response): Promise<void> {
	const me: ApiCaller = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const cardId = param(request, "cardId");
	const body = parseCardBody(request.body, "update");

	const surfaces = await readSurfaces(homeId, me.uid);
	const current = rowsOf(surfaces).find((row) => row.card.id === cardId);
	if (current === undefined) throw notFound(cardId, homeId);
	checkEtag(request, etagForCard(current.card));

	const toScope = body.scope ?? current.scope;
	// A hide rides on the hider's own doc and only means something on the
	// shared surface — the editor's menu offers it nowhere else.
	if (body.hidden !== undefined && toScope !== "shared") {
		throw new ApiError(
			400,
			"hidden_not_shared",
			"Only a shared card can be hidden, and this one would not end on the shared surface.",
		);
	}

	const edited =
		body.scope !== undefined ||
		body.title !== undefined ||
		body.conditions !== undefined ||
		body.sort !== undefined ||
		body.shown !== undefined ||
		body.max !== undefined ||
		body.empty !== undefined;

	const next: Card = {
		...current.card,
		...(body.title !== undefined ? { title: body.title.trim() } : {}),
		...(body.conditions !== undefined
			? { conditions: body.conditions as Card["conditions"] }
			: {}),
		...(body.sort !== undefined ? { sort: body.sort as Card["sort"] } : {}),
		...(body.shown !== undefined ? { shown: body.shown } : {}),
		...(body.max !== undefined ? { max: body.max } : {}),
		...(body.empty !== undefined ? { empty: body.empty as Card["empty"] } : {}),
	};

	refuseInvalidCard(next as unknown as CardFields);

	await db.runTransaction(async (tx) => {
		// The home doc may need both its fields in one request — a move onto it
		// and a hide — so its writes accumulate and land as one `set`.
		const dashboardFields: Record<string, unknown> = {};

		/**
		 * The map side of a surface write: the surface's cards, re-read inside
		 * the transaction, with `with` applied. The field is replaced whole —
		 * the one shape a remove or an overwrite can be written in.
		 */
		const putMap = async (
			scope: "global" | "home",
			rewrite: (cards: Card[]) => Card[],
		): Promise<void> => {
			const stored = rewrite(
				cardsIn((await tx.get(mapRef(scope, homeId, me.uid))).get("cards")),
			);
			const fields = { cards: cardsMap(stored) };
			if (scope === "home") {
				Object.assign(dashboardFields, fields);
				return;
			}
			tx.set(mapRef(scope, homeId, me.uid), fields, {
				mergeFields: ["cards"],
			});
		};

		if (toScope !== current.scope) {
			// The app's `moveScopeCard`: the card arrives whole on the `to`
			// surface and is gone from the `from` surface in the same atomic
			// write, so it can never sit on two surfaces under one id.
			if (toScope === "shared") {
				tx.set(sharedCards(homeId).doc(cardId), next);
			} else {
				await putMap(toScope, (cards) => [
					...cards.filter((card) => card.id !== cardId),
					next,
				]);
			}
			if (current.scope === "shared") {
				tx.delete(sharedCards(homeId).doc(cardId));
			} else {
				await putMap(current.scope, (cards) =>
					cards.filter((card) => card.id !== cardId),
				);
			}
		} else if (edited) {
			if (current.scope === "shared") {
				tx.set(sharedCards(homeId).doc(cardId), next);
			} else {
				await putMap(current.scope, (cards) =>
					cards.map((card) => (card.id === cardId ? next : card)),
				);
			}
		}

		if (body.hidden !== undefined) {
			const stored = strings(
				(await tx.get(homeDashboardRef(homeId, me.uid))).get("hiddenSharedIds"),
			);
			dashboardFields.hiddenSharedIds = body.hidden
				? stored.includes(cardId)
					? stored
					: [...stored, cardId]
				: stored.filter((id) => id !== cardId);
		}

		if (Object.keys(dashboardFields).length > 0) {
			tx.set(homeDashboardRef(homeId, me.uid), dashboardFields, {
				mergeFields: Object.keys(dashboardFields),
			});
		}
	});
	await recordWrite(me, home);

	const hidden =
		toScope === "shared"
			? (body.hidden ?? surfaces.hiddenSharedIds.includes(cardId))
			: false;
	response.status(200).json(apiCardRow({ card: next, scope: toScope, hidden }));
}

async function deleteCard(request: Request, response: Response): Promise<void> {
	const me: ApiCaller = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const cardId = param(request, "cardId");

	const surfaces = await readSurfaces(homeId, me.uid);
	const current = rowsOf(surfaces).find((row) => row.card.id === cardId);
	if (current === undefined) throw notFound(cardId, homeId);
	checkEtag(request, etagForCard(current.card));

	if (current.scope === "shared") {
		// One document per shared card, so a remove is one delete.
		await sharedCards(homeId).doc(cardId).delete();
	} else {
		// A map field cannot lose one key on its own: the surface's cards are
		// rewritten without the id, replaced whole — the same write the app's
		// `deleteScopeCard` makes.
		const scope = current.scope;
		await db.runTransaction(async (tx) => {
			const stored = cardsIn(
				(await tx.get(mapRef(scope, homeId, me.uid))).get("cards"),
			).filter((card) => card.id !== cardId);
			tx.set(
				mapRef(scope, homeId, me.uid),
				{ cards: cardsMap(stored) },
				{ mergeFields: ["cards"] },
			);
		});
	}
	await recordWrite(me, home);

	response.json({ id: cardId, deleted: 1 });
}

async function reorderCards(
	request: Request,
	response: Response,
): Promise<void> {
	const me: ApiCaller = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const raw = request.body;
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new ApiError(
			400,
			"invalid_body",
			"The request body must be a JSON object.",
		);
	}
	const order = (raw as Record<string, unknown>).order;
	if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) {
		throw new ApiError(
			400,
			"invalid_order",
			"order must be a list of card ids, in the order the overview should hold them.",
		);
	}
	const ids = order as string[];

	// Everything is read **inside** the transaction, so the order is checked
	// against, and written onto, the same state it will replace.
	const moved = await db.runTransaction(async (tx) => {
		const globalDoc = await tx.get(globalConfigRef(me.uid));
		const homeDoc = await tx.get(homeDashboardRef(homeId, me.uid));
		const sharedDocs = await tx.get(sharedCards(homeId));
		const surfaces: Surfaces = {
			global: cardsIn(globalDoc.get("cards")),
			home: cardsIn(homeDoc.get("cards")),
			shared: sharedDocs.docs
				.map((document) => readCard(document.id, document.data()))
				.filter((card): card is Card => card !== null),
			hiddenSharedIds: strings(homeDoc.get("hiddenSharedIds")),
		};

		const merged = rowsOf(surfaces);
		const known = new Set(merged.map((row) => row.card.id));
		const unknown = ids.filter((id) => !known.has(id));
		if (unknown.length > 0) {
			throw new ApiError(
				400,
				"unknown_card",
				`No card ${unknown.join(", ")} in ${homeId}. Read GET /v1/homes/${homeId}/cards for the ids.`,
			);
		}
		if (ids.length !== merged.length) {
			throw new ApiError(
				400,
				"invalid_order",
				`order must name every card exactly once — this overview holds ${merged.length}, the request named ${ids.length}.`,
			);
		}
		if (new Set(ids).size !== ids.length) {
			throw new ApiError(400, "invalid_order", "order names a card twice.");
		}

		// Fresh fractional ranks for the whole list — order in, rank computed,
		// the way a node's rank is computed from its column. A card whose rank
		// the sequence did not move is not written at all.
		const ranks = rankSequence(null, null, ids.length);
		const nextRank = new Map(ids.map((id, index) => [id, ranks[index]]));

		let changed = 0;
		for (const scope of ["global", "home"] as const) {
			const stored = cardsIn(
				(await tx.get(mapRef(scope, homeId, me.uid))).get("cards"),
			);
			const rewritten = stored.map((card) => {
				const rank = nextRank.get(card.id);
				return rank === undefined || rank === card.rank
					? card
					: { ...card, rank };
			});
			if (rewritten.every((card, index) => card === stored[index])) continue;
			tx.set(
				mapRef(scope, homeId, me.uid),
				{ cards: cardsMap(rewritten) },
				{ mergeFields: ["cards"] },
			);
			changed += rewritten.filter(
				(card, index) => card !== stored[index],
			).length;
		}

		for (const document of sharedDocs.docs) {
			const rank = nextRank.get(document.id);
			if (rank === undefined || rank === document.get("rank")) continue;
			tx.update(document.ref, { rank });
			changed += 1;
		}

		return changed;
	});
	if (moved > 0) await recordWrite(me, home);

	response.json({ reordered: moved });
}

export function registerCardRoutes(v1: Router): void {
	v1.get("/homes/:homeId/cards", handle(listCards));
	v1.post("/homes/:homeId/cards", handle(createCard));
	// `:reorder` rather than `/reorder`, so the path can never collide with a card id.
	v1.post("/homes/:homeId/cards\\:reorder", handle(reorderCards));
	v1.patch("/homes/:homeId/cards/:cardId", handle(patchCard));
	v1.delete("/homes/:homeId/cards/:cardId", handle(deleteCard));
}
