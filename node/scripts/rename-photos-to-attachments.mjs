#!/usr/bin/env node

/**
 * One-off migration for #298: `photos` becomes `attachments` on every node,
 * and each node gains `attachmentCount`, `attachmentDisplay` and
 * `heroAttachmentId`.
 *
 * Targets the Firestore emulator started by `scripts/dev-stack.sh up` — it
 * reads the ports that stack recorded in `.tmp/dev-stack/stack.json` — and
 * runs dry by default:
 *
 *   node node/scripts/rename-photos-to-attachments.mjs            # dry run
 *   node node/scripts/rename-photos-to-attachments.mjs --apply    # write
 *
 * Run it dry, then --apply, then dry again and expect zero changes. Refresh
 * the seed afterwards with `yarn emulators:export`.
 *
 * The Admin SDK bypasses the rules, so the lenient `validNode()` posture for
 * pre-rename documents is about deploy order, not about this script.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(
	new URL("../../functions/package.json", import.meta.url),
);
const admin = require("firebase-admin");

const apply = process.argv.includes("--apply");

const stack = JSON.parse(
	readFileSync(
		new URL("../../.tmp/dev-stack/stack.json", import.meta.url),
		"utf8",
	),
);
const host = `127.0.0.1:${stack.ports.firestore}`;
process.env.FIRESTORE_EMULATOR_HOST = host;

const app = admin.initializeApp({ projectId: "home-backlog" });
const db = admin.firestore(app);
db.settings({ host, ssl: false });

let scanned = 0;
let changed = 0;
let deletedPhotosKeys = 0;

const nodes = await db.collectionGroup("nodes").get();

for (const doc of nodes.docs) {
	scanned += 1;
	const data = doc.data();
	const update = {};

	if ("photos" in data) {
		update.photos = admin.firestore.FieldValue.delete();
		deletedPhotosKeys += 1;
		if (!("attachments" in data)) update.attachments = data.photos ?? [];
	}
	if (!("attachments" in update) && !("attachments" in data)) {
		update.attachments = [];
	}
	if (!("attachmentCount" in data)) update.attachmentCount = 0;
	if (!("attachmentDisplay" in data)) update.attachmentDisplay = "count";
	if (!("heroAttachmentId" in data)) update.heroAttachmentId = null;

	if (Object.keys(update).length === 0) continue;
	changed += 1;

	if (apply) {
		await doc.ref.update(update);
	} else {
		const id = doc.ref.path;
		const keys = Object.keys(update).join(", ");
		console.log(`would update ${id}: ${keys}`);
	}
}

console.log(
	`scanned ${scanned} nodes; ${changed} need updating (${deletedPhotosKeys} carry a photos key). ` +
		(apply ? "Written." : "Dry run — nothing written."),
);

await app.delete();
