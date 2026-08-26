/**
 * One-off migration for #102, which stopped `participantIds: []` on a root
 * meaning "everybody in the home".
 *
 * **It has to run before the narrower `firestore.rules` are deployed.** The
 * rules validate `request.resource.data` — the full post-update document — so
 * once `rootHasParticipants()` is live, a root still holding `[]` has *every*
 * update to it denied, including the `childCount` bump that adding a step to it
 * performs. There is no admin tooling in this repo to unstick that, so the order
 * is: migrate, then push.
 *
 * One rewrite: a **shared root** with nobody on it takes every current member of
 * its home. That is what the empty list meant, so the day this runs nothing on
 * anybody's board changes — `hiddenByParticipants()` returns false for a member
 * either way. What changes is the day *after*: somebody joining the household no
 * longer joins every project that predates them, and the checkboxes on the
 * details screen say something true.
 *
 * Untouched, deliberately:
 *
 * - **descendants**, shared or private. Participants are a question about a
 *   project, so a step keeps `[]` and the rule does not bite it.
 * - **private roots**, which already carry their participants: the read grant
 *   refuses one whose list leaves its own author out, so an empty one cannot
 *   exist.
 * - **`updatedAt`**, because this is a schema move rather than somebody editing
 *   the gutter job, and "changed 3 minutes ago" on every project would be a lie.
 *
 * Archived roots are migrated too. The rule bites every update, so skipping them
 * would leave a project that could never be un-archived.
 *
 * Run with Application Default Credentials:
 *
 *   node functions/scripts/migrate-102-participants.mjs --project home-backlog [--apply]
 *
 * Without `--apply` it only reports what it would write. It lives under
 * `functions/` because that is the package depending on `firebase-admin`;
 * `firebase.json` keeps it out of the deployed upload.
 *
 * **Run it a second time once the deploy has landed.** Between the first run and
 * the new build reaching every browser, the old one is still live and still able
 * to create a root with an empty list — and that project is then un-updatable
 * with nothing to tell anyone to look. The script is idempotent and skips every
 * settled root, so the second run costs one collection-group read.
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectId = args[args.indexOf("--project") + 1];

if (!projectId || projectId.startsWith("--")) {
	console.error(
		"Usage: node functions/scripts/migrate-102-participants.mjs --project <id> [--apply]",
	);
	process.exit(2);
}

initializeApp({ projectId });
const db = getFirestore();

/** uid -> role, per home. Every home there is; a household has a handful. */
const homes = await db.collection("homes").get();
const membersOf = new Map(
	homes.docs.map((home) => [home.id, Object.keys(home.data().members ?? {})]),
);

/**
 * Every node in every home, filtered here rather than in the query: two equality
 * clauses across a collection group would need a composite index for one pass
 * over a collection this small, and `migrate-99-statuses.mjs` reads the same way.
 */
const nodes = await db.collectionGroup("nodes").get();

let rewrites = 0;
const failures = [];
const writer = db.bulkWriter();

/** gRPC RESOURCE_EXHAUSTED, ABORTED, UNAVAILABLE — the three worth another go. */
const retryable = new Set([8, 10, 14]);
const maxAttempts = 10;

// The same handler as the sibling script, and for the same reason: registering
// one *replaces* the SDK's, so it has to redo the retry it would otherwise have
// done, and a write that exhausts its attempts is collected and named at the end
// rather than vanishing while the summary still counts the document as
// rewritten. A migration whose report can lie is the wrong tool for a state
// nothing else in this repo can unstick.
writer.onWriteError((error) => {
	if (error.failedAttempts < maxAttempts && retryable.has(error.code))
		return true;
	failures.push(`${error.documentRef.path}: ${error.message}`);
	return false;
});

for (const node of nodes.docs) {
	const data = node.data();
	const participants = Array.isArray(data.participantIds)
		? data.participantIds
		: [];
	if (data.parentId !== null || data.visibility !== "shared") continue;
	if (participants.length > 0) continue;

	// `homes/{homeId}/nodes/{nodeId}` — the home is the grandparent of the doc.
	const homeId = node.ref.parent.parent?.id;
	const members = membersOf.get(homeId) ?? [];
	if (members.length === 0) {
		failures.push(`${node.ref.path}: home ${homeId} has no members to write`);
		continue;
	}

	rewrites += 1;
	console.log(
		`${apply ? "write" : "would write"} ${node.ref.path}`,
		JSON.stringify({ participantIds: members }),
	);
	if (apply) writer.update(node.ref, { participantIds: members });
}

if (apply) await writer.close();

console.log(
	`\n${nodes.size} nodes · ${rewrites} shared ${rewrites === 1 ? "root" : "roots"} given their home's members${apply ? "" : " (dry run — pass --apply to write)"}`,
);

if (failures.length > 0) {
	console.error(`\n${failures.length} root(s) not migrated:`);
	for (const failure of failures) console.error(`  ${failure}`);
	console.error("\nRe-run — the script is idempotent and skips settled roots.");
	process.exit(1);
}
