/**
 * What the app knows about an API key, which is deliberately almost nothing.
 *
 * A key is **the user**, not a home: a person is in several homes — the house,
 * the cabin, a parent's place — and per-home keys would mean one credential per
 * home, an agent reconfigured every time a home is added, and a key that
 * silently stops covering work when a project moves. So a key reaches every home
 * its owner is a member of, and gains a new one the moment they join it.
 *
 * The token is `hb_<uid>.<keyId>.<secret>`, and **nothing in the app parses,
 * formats or hashes it.** The Automations screen is handed the finished string
 * once by the `createApiKey` callable, shows it, and forgets it; the stored
 * `tail` it renders afterwards is computed server-side. The format therefore
 * lives entirely in `functions/src/api-key.ts`, next to the only code that
 * verifies it — one implementation rather than two agreeing ones.
 *
 * What is left here is the one rule a *screen* enforces: a key is named before
 * its secret is revealed.
 */

/** Matched by the create dialog and by the callable, which both refuse longer. */
export const maxKeyNameLength = 60;

/** Why a typed key name cannot be saved, as the key that says so. */
export type KeyNameError =
	| "automations.nameRequired"
	| "automations.nameTooLong";

/**
 * Checked here rather than in the dialog, so that the callable and the form say
 * no to the same things — a key named later is a key never named, and an unnamed
 * key is one nobody dares revoke.
 */
export function keyNameError(name: string): KeyNameError | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) return "automations.nameRequired";
	if (trimmed.length > maxKeyNameLength) return "automations.nameTooLong";
	return null;
}
