// One-off migration: the stored card `kind` stops being the legacy
// discriminator and becomes the filter mode — `"filter"` → `"open"`,
// `"completed"` → `"done"`. It rewrites every card on the three surfaces
// `data/cards.ts` names:
//
// - `users/{uid}/dashboard/config` — the `cards` map field,
// - `homes/{homeId}/dashboards/{uid}` — the `cards` map field,
// - `homes/{homeId}/dashboardCards/{cardId}` — one document per shared card.
//
// A dry-run (no flag) reads and reports only. `--apply` writes each changed
// card back: a map document whole, a shared card's `kind` field alone —
// the same whole-field replace the app's own writes use. Kinds that are
// already `"open"` or `"done"` are untouched; anything else is reported as
// skipped and left for a human.
//
// Point it at the emulator with `FIRESTORE_EMULATOR_HOST=host:port`, or at
// production with `GOOGLE_APPLICATION_CREDENTIALS`. Remove this script
// before the PR once it has been applied.
import { createRequire } from "node:module";

const require = createRequire(
	new URL("../../functions/package.json", import.meta.url),
);
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const apply = process.argv.includes("--apply");
const projectId = process.env.GCLOUD_PROJECT ?? "home-backlog";

initializeApp({ projectId });
const db = getFirestore();

const KIND_MAP = { filter: "open", completed: "done" };
/** One card's next kind, or `null` when the migration must not touch it. */
const nextKind = (kind) =>
	typeof kind === "string" && kind in KIND_MAP ? KIND_MAP[kind] : null;

/**
 * The card documents, listed surface by surface over collection groups —
 * the app never writes a `users/{uid}` or `homes/{homeId}` parent document,
 * so a top-down walk would miss every card. Each group is filtered back to
 * the exact paths `data/cards.ts` names, in case another feature ever grows
 * a collection of the same id.
 */
async function* surfaces() {
	for (const doc of (await db.collectionGroup("config").get()).docs) {
		const path = doc.ref.path.split("/");
		if (path.length === 4 && path[0] === "users" && path[2] === "dashboard") {
			yield {
				name: doc.ref.path,
				ref: doc.ref,
				cards: doc.get("cards") ?? null,
				map: true,
			};
		}
	}
	for (const doc of (await db.collectionGroup("dashboards").get()).docs) {
		const path = doc.ref.path.split("/");
		if (path.length === 4 && path[0] === "homes" && path[2] === "dashboards") {
			yield {
				name: doc.ref.path,
				ref: doc.ref,
				cards: doc.get("cards") ?? null,
				map: true,
			};
		}
	}
	for (const doc of (await db.collectionGroup("dashboardCards").get()).docs) {
		const path = doc.ref.path.split("/");
		if (
			path.length === 4 &&
			path[0] === "homes" &&
			path[2] === "dashboardCards"
		) {
			yield {
				name: doc.ref.path,
				ref: doc.ref,
				card: { id: doc.id, kind: doc.get("kind") },
				map: false,
			};
		}
	}
}

let changed = 0;
let skipped = 0;
let untouched = 0;

for await (const surface of surfaces()) {
	if (surface.map && surface.cards === null) continue;
	const entries = surface.map
		? Object.entries(surface.cards)
		: [[surface.card.id, surface.card]];

	const rewrite = {};
	const notes = [];
	for (const [id, card] of entries) {
		const kind = card?.kind;
		const next = nextKind(kind);
		if (next !== null) {
			rewrite[id] = { ...card, kind: next };
			notes.push(`${id}: ${kind} → ${next}`);
		} else if (kind === "open" || kind === "done") {
			untouched += 1;
		} else {
			skipped += 1;
			notes.push(`${id}: skipped (kind ${JSON.stringify(kind) ?? "missing"})`);
		}
	}

	if (notes.length > 0) console.log(`${surface.name}:`);
	for (const note of notes) console.log(`  ${note}`);

	if (Object.keys(rewrite).length === 0) continue;
	changed += Object.keys(rewrite).length;
	if (apply) {
		if (surface.map) {
			const cards = { ...surface.cards, ...rewrite };
			await surface.ref.update({ cards });
		} else {
			const [card] = Object.values(rewrite);
			await surface.ref.update({ kind: card.kind });
		}
	}
}

console.log(
	apply
		? `applied: ${changed} cards rewritten, ${untouched} already in mode form, ${skipped} skipped`
		: `dry-run: ${changed} cards would change, ${untouched} already in mode form, ${skipped} skipped`,
);
if (!apply) console.log("run again with --apply to write");
