import type { Request, Response, Router } from "express";
import type { Transaction } from "firebase-admin/firestore";
import { type ApiCaller, caller, homeAccess, recordWrite } from "./auth.js";
import { parseCardBody, parseCardReorderBody } from "./body.js";
import {
	type ApiCard,
	type ApiCardCondition,
	type ApiCardRow,
	apiCard,
	blockRanks,
	type CardScope,
	editorRows,
	etagForCard,
	genericEmptyKey,
	overviewLimit,
	rowsPerSection,
	validateCard,
} from "./card.js";
import { ApiError } from "./errors.js";
import {
	dashboardCardsCollection,
	dashboardsCollection,
	db,
	homesCollection,
	usersCollection,
} from "./firestore.js";
import { handle, param } from "./handler.js";
import { rankAfter } from "./node.js";
import type { ValidationIssue } from "./validate.js";
import { checkEtag } from "./writes.js";

/**
 * The overview-card verbs (#255): read, arrange and remove the config behind
 * the Overview tab's sections.
 *
 * The node verbs, carried over to card config, with the three things the
 * config's shape forces. Every per-user surface is the **caller's own
 * document** — `users/{uid}/dashboard/config` and
 * `homes/{homeId}/dashboards/{uid}` — so a key arranging cards touches only
 * its owner's screens, and another member's `hiddenSharedIds` is out of
 * reach by construction. The two per-user scopes store a **map** that is
 * replaced, not merged, so every write to one reads it first and writes it
 * whole — the same rule `data/cards.ts` gives the app, because a removal
 * written as a merge would leave the removed card exactly where it was. And
 * a scope move is **one transaction** — remove here, arrive there, or
 * neither — because under the editor's later-scope-wins merge a card left on
 * two surfaces is an invisible orphan.
 *
 * These write with the Admin SDK, so `firestore.rules` enforces nothing
 * here; every assembled card goes through `validateCard` before it is
 * committed. `If-Match` guards each card's own fields; the transaction is
 * what keeps a sibling card in the same map from being lost between two
 * writers.
 */

function globalRef(uid: string) {
	return db
		.collection(usersCollection)
		.doc(uid)
		.collection("dashboard")
		.doc("config");
}

function homeDashRef(homeId: string, uid: string) {
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
	return new ApiError(
		404,
		"card_not_found",
		`No overview card ${cardId} in ${homeId}.`,
	);
}

function notSeeded(): ApiError {
	return new ApiError(
		409,
		"global_cards_not_seeded",
		"This member's global card config does not exist yet — the Overview tab seeds it on the app's first read. Open Overview in the app once, then retry; the API will not seed it, because seeding is never diffed against the seed list.",
	);
}

function refuseInvalidCard(card: ApiCard): void {
	const issues = validateCard(card);
	if (issues.length === 0) return;

	throw new ApiError(
		400,
		issues[0].code,
		issues[0].message,
		issues.map((issue: ValidationIssue) => ({
			field: issue.field,
			code: issue.code,
			message: issue.message,
		})),
	);
}

/** One surface's cards, read defensively, in `(rank, id)` order. */
function cardsOf(map: unknown): ApiCard[] {
	const entries = Object.entries(
		(map ?? {}) as Record<string, Record<string, unknown>>,
	);
	return entries
		.map(([id, data]) => apiCard(id, data))
		.sort((a, b) =>
			a.rank !== b.rank
				? a.rank < b.rank
					? -1
					: 1
				: a.id < b.id
					? -1
					: a.id > b.id
						? 1
						: 0,
		);
}

function stringsOf(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/** The three surfaces as one read, the shape every write has to reason about. */
interface Surfaces {
	globalExists: boolean;
	global: ApiCard[];
	home: ApiCard[];
	hiddenSharedIds: string[];
	shared: ApiCard[];
}

async function readSurfaces(
	tx: Transaction,
	homeId: string,
	uid: string,
): Promise<Surfaces> {
	const [globalSnap, homeSnap, sharedSnap] = await Promise.all([
		tx.get(globalRef(uid)),
		tx.get(homeDashRef(homeId, uid)),
		tx.get(sharedCards(homeId)),
	]);
	const globalData = globalSnap.data() ?? {};
	return {
		globalExists: globalSnap.exists,
		global: cardsOf(globalData.cards),
		home: cardsOf(homeSnap.data()?.cards),
		hiddenSharedIds: stringsOf(homeSnap.data()?.hiddenSharedIds),
		shared: sharedSnap.docs.map((doc) => apiCard(doc.id, doc.data())),
	};
}

/**
 * The card an id resolves to, by the merge's own rule: a later scope wins,
 * so shared beats home beats global. Absent from all three is a 404 that
 * says nothing about which surfaces were checked.
 */
function resolveCard(
	surfaces: Surfaces,
	cardId: string,
): { scope: CardScope; card: ApiCard } | null {
	const shared = surfaces.shared.find((card) => card.id === cardId);
	if (shared) return { scope: "shared", card: shared };
	const home = surfaces.home.find((card) => card.id === cardId);
	if (home) return { scope: "home", card: home };
	const global = surfaces.global.find((card) => card.id === cardId);
	if (global) return { scope: "global", card: global };
	return null;
}

function scopeCards(surfaces: Surfaces, scope: CardScope): ApiCard[] {
	return scope === "global"
		? surfaces.global
		: scope === "home"
			? surfaces.home
			: surfaces.shared;
}

/**
 * One scope's cards, written whole. A shared card is its own document, set
 * one each; a per-user scope is its map field replaced — never merged, so a
 * card the list no longer holds is gone.
 */
function writeScope(
	tx: Transaction,
	scope: CardScope,
	homeId: string,
	uid: string,
	cards: readonly ApiCard[],
): void {
	if (scope === "shared") {
		for (const card of cards) {
			tx.set(sharedCards(homeId).doc(card.id), card);
		}
		return;
	}
	const map = Object.fromEntries(cards.map((card) => [card.id, card]));
	tx.set(
		scope === "global" ? globalRef(uid) : homeDashRef(homeId, uid),
		{ cards: map },
		{ mergeFields: ["cards"] },
	);
}

/** One card off its scope: a shared card's document deleted, a map without it. */
function removeFromScope(
	tx: Transaction,
	scope: CardScope,
	homeId: string,
	uid: string,
	cardId: string,
	cards: readonly ApiCard[],
): void {
	if (scope === "shared") {
		tx.delete(sharedCards(homeId).doc(cardId));
		return;
	}
	writeScope(
		tx,
		scope,
		homeId,
		uid,
		cards.filter((card) => card.id !== cardId),
	);
}

function rowOf(card: ApiCard, scope: CardScope, hidden: boolean): ApiCardRow {
	return { ...card, scope, hidden, etag: etagForCard(card) };
}

/** The body's fields, applied over the card as it is stored. */
function withChanges(
	current: ApiCard,
	body: ReturnType<typeof parseCardBody>,
): ApiCard {
	return {
		...current,
		...(body.title !== undefined
			? { title: body.title === null ? null : body.title.trim() }
			: {}),
		...(body.conditions !== undefined
			? { conditions: body.conditions as ApiCardCondition[] }
			: {}),
		...(body.sort !== undefined ? { sort: body.sort as ApiCard["sort"] } : {}),
		...(body.shown !== undefined ? { shown: body.shown } : {}),
		...(body.max !== undefined ? { max: body.max } : {}),
	};
}

async function listCards(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	await homeAccess(me, homeId);

	const [globalSnap, homeSnap, sharedSnap] = await Promise.all([
		globalRef(me.uid).get(),
		homeDashRef(homeId, me.uid).get(),
		sharedCards(homeId).get(),
	]);

	const rows = editorRows(
		cardsOf(globalSnap.data()?.cards),
		cardsOf(homeSnap.data()?.cards),
		sharedSnap.docs.map((doc) => apiCard(doc.id, doc.data())),
		stringsOf(homeSnap.data()?.hiddenSharedIds),
	);

	response.json({ cards: rows });
}

async function createCard(request: Request, response: Response): Promise<void> {
	const me: ApiCaller = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const body = parseCardBody(request.body, "create");
	const scope = body.scope as CardScope;
	const title = (body.title as string).trim();

	const created = await db.runTransaction(async (tx) => {
		const surfaces = await readSurfaces(tx, homeId, me.uid);
		if (scope === "global" && !surfaces.globalExists) throw notSeeded();

		// The end of the whole screen, the placement the app's own editor
		// gives a composed card — a card filed by an agent lands where a
		// person will see it, not inside another scope's block.
		const merged = editorRows(
			surfaces.global,
			surfaces.home,
			surfaces.shared,
			surfaces.hiddenSharedIds,
		);
		const id =
			scope === "shared"
				? sharedCards(homeId).doc().id
				: scope === "home"
					? homeDashRef(homeId, me.uid).parent.doc().id
					: globalRef(me.uid).parent.doc().id;

		const card: ApiCard = {
			id,
			kind: "filter",
			seedId: null,
			title,
			conditions: (body.conditions ?? []) as ApiCardCondition[],
			sort: (body.sort ?? null) as ApiCard["sort"],
			shown: body.shown ?? rowsPerSection,
			max: body.max ?? overviewLimit,
			empty: { mode: "say", key: genericEmptyKey },
			rank: rankAfter(merged.map((row) => row.rank)),
		};

		refuseInvalidCard(card);

		writeScope(tx, scope, homeId, me.uid, [
			...scopeCards(surfaces, scope),
			card,
		]);
		return card;
	});

	await recordWrite(me, home);

	const row = rowOf(created, scope, false);
	response.setHeader("ETag", row.etag);
	response.status(201).json(row);
}

async function patchCard(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const cardId = param(request, "cardId");
	const body = parseCardBody(request.body, "update");

	const patched = await db.runTransaction(async (tx) => {
		const surfaces = await readSurfaces(tx, homeId, me.uid);
		const current = resolveCard(surfaces, cardId);
		if (current === null) throw notFound(cardId, homeId);

		checkEtag(request, etagForCard(current.card));

		const to = body.scope ?? current.scope;
		if (to === "global" && !surfaces.globalExists) throw notSeeded();
		const card = withChanges(current.card, body);
		refuseInvalidCard(card);

		if (to !== current.scope) {
			// One transaction, or neither write: the card is gone from the old
			// surface exactly when it arrives on the new one.
			removeFromScope(
				tx,
				current.scope,
				homeId,
				me.uid,
				cardId,
				scopeCards(surfaces, current.scope),
			);
			writeScope(tx, to, homeId, me.uid, [...scopeCards(surfaces, to), card]);
		} else {
			writeScope(tx, current.scope, homeId, me.uid, [
				...scopeCards(surfaces, current.scope).map((entry) =>
					entry.id === cardId ? card : entry,
				),
			]);
		}
		return { card, scope: to };
	});

	await recordWrite(me, home);

	const row = rowOf(patched.card, patched.scope, false);
	response.setHeader("ETag", row.etag);
	response.json(row);
}

async function deleteCard(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const cardId = param(request, "cardId");

	await db.runTransaction(async (tx) => {
		const surfaces = await readSurfaces(tx, homeId, me.uid);
		const current = resolveCard(surfaces, cardId);
		if (current === null) throw notFound(cardId, homeId);

		checkEtag(request, etagForCard(current.card));

		removeFromScope(
			tx,
			current.scope,
			homeId,
			me.uid,
			cardId,
			scopeCards(surfaces, current.scope),
		);
	});

	await recordWrite(me, home);

	response.json({ id: cardId, deleted: 1 });
}

async function reorderCards(
	request: Request,
	response: Response,
): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const body = parseCardReorderBody(request.body);

	const result = await db.runTransaction(async (tx) => {
		const surfaces = await readSurfaces(tx, homeId, me.uid);
		const current = scopeCards(surfaces, body.scope);

		const have = new Set(current.map((card) => card.id));
		const wanted = new Set(body.ids);
		const same =
			wanted.size === body.ids.length &&
			have.size === wanted.size &&
			body.ids.every((id) => have.has(id));
		if (!same) {
			throw new ApiError(
				400,
				"card_set_mismatch",
				`ids must be exactly the ${body.scope} scope's ${have.size} card${have.size === 1 ? "" : "s"} in a new order; the request named ${wanted.size}. Read the cards first, then send them all.`,
			);
		}

		if (current.length === 0) return { scope: body.scope, ids: [] as string[] };

		// The scope keeps its place on the screen: the fresh ranks run between
		// the merged cards that sit on either side of the scope's block.
		const merged = editorRows(
			surfaces.global,
			surfaces.home,
			surfaces.shared,
			surfaces.hiddenSharedIds,
		);
		let first = -1;
		let last = -1;
		merged.forEach((row, index) => {
			if (row.scope !== body.scope) return;
			if (first === -1) first = index;
			last = index;
		});
		const before = first > 0 ? merged[first - 1].rank : null;
		const after = last < merged.length - 1 ? merged[last + 1].rank : null;
		const ranks = blockRanks(before, after, current.length);

		const ordered = body.ids.map(
			(id) => current.find((card) => card.id === id) as ApiCard,
		);
		writeScope(
			tx,
			body.scope,
			homeId,
			me.uid,
			ordered.map((card, index) => ({ ...card, rank: ranks[index] })),
		);

		return { scope: body.scope, ids: body.ids };
	});

	await recordWrite(me, home);

	response.json(result);
}

/**
 * The shared cards this member hid. Only a shared card can be hidden — a
 * global or home card is the caller's own, and removing it is `DELETE`. The
 * flag is written to the **caller's** dashboard document and nothing else:
 * another member's Overview is unreachable from here.
 */
async function hideCard(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const cardId = param(request, "cardId");

	await db.runTransaction(async (tx) => {
		const sharedSnap = await tx.get(sharedCards(homeId));
		if (!sharedSnap.docs.some((doc) => doc.id === cardId)) {
			throw new ApiError(
				404,
				"card_not_found",
				`No shared card ${cardId} in ${homeId} — only shared cards can be hidden.`,
			);
		}

		const ref = homeDashRef(homeId, me.uid);
		const snap = await tx.get(ref);
		const hidden = stringsOf(snap.data()?.hiddenSharedIds);
		if (!hidden.includes(cardId)) {
			tx.set(
				ref,
				{ hiddenSharedIds: [...hidden, cardId] },
				{ mergeFields: ["hiddenSharedIds"] },
			);
		}
	});

	await recordWrite(me, home);

	response.json({ id: cardId, hidden: true });
}

async function unhideCard(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const cardId = param(request, "cardId");

	await db.runTransaction(async (tx) => {
		const sharedSnap = await tx.get(sharedCards(homeId));
		if (!sharedSnap.docs.some((doc) => doc.id === cardId)) {
			throw new ApiError(
				404,
				"card_not_found",
				`No shared card ${cardId} in ${homeId} — only shared cards can be hidden.`,
			);
		}

		const ref = homeDashRef(homeId, me.uid);
		const snap = await tx.get(ref);
		const hidden = stringsOf(snap.data()?.hiddenSharedIds);
		if (hidden.includes(cardId)) {
			tx.set(
				ref,
				{ hiddenSharedIds: hidden.filter((id) => id !== cardId) },
				{ mergeFields: ["hiddenSharedIds"] },
			);
		}
	});

	await recordWrite(me, home);

	response.json({ id: cardId, hidden: false });
}

export function registerCardRoutes(v1: Router): void {
	v1.get("/homes/:homeId/overview-cards", handle(listCards));
	v1.post("/homes/:homeId/overview-cards", handle(createCard));
	// `:reorder` rather than `/reorder`, so the path can never collide with a card id.
	v1.post("/homes/:homeId/overview-cards\\:reorder", handle(reorderCards));
	v1.patch("/homes/:homeId/overview-cards/:cardId", handle(patchCard));
	v1.delete("/homes/:homeId/overview-cards/:cardId", handle(deleteCard));
	v1.put("/homes/:homeId/overview-cards/:cardId/hidden", handle(hideCard));
	v1.delete("/homes/:homeId/overview-cards/:cardId/hidden", handle(unhideCard));
}
