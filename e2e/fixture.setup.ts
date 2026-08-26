import { test as setup } from "@playwright/test";
import { deleteNodesByTitlePrefix } from "@/e2e/support/firestore";

/**
 * Sweeps the fixture back to the committed seed before the suite starts.
 *
 * Two specs write cards of their own — `offline.spec.ts` creates one to prove a
 * queued write reaches the server, and `craft.spec.ts` fills a column with
 * twelve to make one deep enough to scroll — and both delete what they made.
 * Cleanup that runs after the thing it is cleaning up is cleanup that can be
 * skipped: a crashed worker, a killed run, a `finally` that never ran, and a
 * card is left on the board.
 *
 * That card is not a harmless extra. The counts on the column strip are
 * asserted against the seed's own numbers, and the lifted-card claim counts the
 * cards in a pane, so one stray root card fails specs in a *different project*
 * for a reason nothing in their output points at. Sweeping first costs one REST
 * call and makes every run start from the same board.
 *
 * The prefix is the contract: anything a spec creates is titled `E2E …`, and
 * nothing in `.emulator-seed` is.
 */

/** What every spec-created node's title begins with. */
const FIXTURE_PREFIX = "E2E ";

setup("clear cards left behind by an earlier run", async () => {
	await deleteNodesByTitlePrefix(FIXTURE_PREFIX);
});
