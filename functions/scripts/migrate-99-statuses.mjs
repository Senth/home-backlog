/**
 * One-off migration for #99, which removed `research`, `planning` and `review`
 * from the status vocabulary.
 *
 * **It has to run before the narrower `firestore.rules` are deployed.** The
 * rules validate `request.resource.data` — the full post-update document — so
 * the moment `allStatuses()` loses a value, every node still holding one has
 * *every* update to it denied, including the `childCount` bump that adding a
 * step to the project above it performs. There is no admin tooling in this repo
 * to unstick that, so the order is: migrate, then push.
 *
 * Two rewrites, both idempotent:
 *
 * - `status` — a retired stage becomes `execution`. All three describe a card
 *   somebody is holding right now; `backlog` would say it had never started.
 * - `columns` — every set becomes the four that survived. Nothing has a custom
 *   set yet (#63 is the feature that makes one), so every stored value is
 *   either the old seven or the old deep-board three, and both should end up
 *   as the current default. Leaving the three-column sets alone would keep
 *   deep boards without a Next up column, which is the inconsistency #99 is
 *   about.
 *
 * `updatedAt` is deliberately **not** touched: this is a schema move, not
 * somebody editing the gutter job, and "changed 3 minutes ago" on forty cards
 * would be a lie.
 *
 * Run with Application Default Credentials:
 *
 *   node functions/scripts/migrate-99-statuses.mjs --project home-backlog [--apply]
 *
 * Without `--apply` it only reports what it would write. It lives under
 * `functions/` because that is the package depending on `firebase-admin`;
 * `firebase.json` keeps it out of the deployed upload.
 *
 * **Run it a second time once the deploy has landed.** Between the first run and
 * the new build reaching every browser, the old one is still live and still able
 * to write a retired status or a seven-entry `columns` — and that node is then
 * un-updatable with nothing to tell anyone to look. The script is idempotent and
 * skips every settled node, so the second run costs one collection-group read.
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const RETIRED = new Set(["research", "planning", "review"]);
const COLUMNS = ["backlog", "next_up", "execution", "done"];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectId = args[args.indexOf("--project") + 1];

if (!projectId || projectId.startsWith("--")) {
	console.error(
		"Usage: node functions/scripts/migrate-99-statuses.mjs --project <id> [--apply]",
	);
	process.exit(2);
}

initializeApp({ projectId });
const db = getFirestore();

/** Every node in every home, without assuming how many homes there are. */
const nodes = await db.collectionGroup("nodes").get();

let statusChanges = 0;
let columnChanges = 0;
const failures = [];
const writer = db.bulkWriter();

/** gRPC RESOURCE_EXHAUSTED, ABORTED, UNAVAILABLE — the three worth another go. */
const retryable = new Set([8, 10, 14]);
const maxAttempts = 10;

// `close()` never rejects, and a discarded `update()` promise either kills the
// process with a bare unhandled rejection or vanishes while the summary below
// still counts the document as rewritten. A migration whose report can lie is
// the wrong tool for a state nothing else in this repo can unstick, so a write
// that exhausts its retries — or hits a document deleted since the read above —
// is collected and named at the end.
//
// Registering a handler *replaces* the SDK's, so this one has to redo the retry
// it would otherwise have done. `BulkWriter` ramps its throughput on the
// 500/50/5 curve and a collection-group-wide migration is exactly the shape that
// makes it push until the backend pushes back, so treating the first
// RESOURCE_EXHAUSTED as a hard failure would report a throttle bounce as a lost
// document. Retry and collect are one branch, because the handler fires once per
// *attempt* — collecting on every one would name the same document ten times.
writer.onWriteError((error) => {
	if (error.failedAttempts < maxAttempts && retryable.has(error.code))
		return true;
	failures.push(`${error.documentRef.path}: ${error.message}`);
	return false;
});

for (const node of nodes.docs) {
	const data = node.data();
	const update = {};

	if (RETIRED.has(data.status)) {
		update.status = "execution";
		statusChanges += 1;
	}

	const columns = Array.isArray(data.columns) ? data.columns : [];
	const settled =
		columns.length === COLUMNS.length &&
		columns.every((value, index) => value === COLUMNS[index]);
	if (!settled) {
		update.columns = [...COLUMNS];
		columnChanges += 1;
	}

	if (Object.keys(update).length === 0) continue;

	console.log(
		`${apply ? "write" : "would write"} ${node.ref.path}`,
		JSON.stringify(update),
	);
	if (apply) writer.update(node.ref, update);
}

if (apply) await writer.close();

console.log(
	`\n${nodes.size} nodes · ${statusChanges} status ${statusChanges === 1 ? "rewrite" : "rewrites"} · ${columnChanges} column ${columnChanges === 1 ? "rewrite" : "rewrites"}${apply ? "" : " (dry run — pass --apply to write)"}`,
);

if (failures.length > 0) {
	console.error(`\n${failures.length} write(s) failed:`);
	for (const failure of failures) console.error(`  ${failure}`);
	console.error("\nRe-run — the script is idempotent and skips settled nodes.");
	process.exit(1);
}
