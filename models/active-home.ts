/**
 * Which home the app opens into.
 *
 * The ladder, in order:
 *
 * ```
 * persisted home id, and I am still a member of it  → that home
 * exactly one home                                   → that home
 * no homes                                           → null, so /homes onboards
 * several homes, no valid persisted id               → null, so /homes asks
 * ```
 *
 * Falling back to "the first home" for the last case was rejected: with two
 * homes and no answer, picking one silently is how Ingrid records cabin work on
 * the house board. Returning null sends her one level up to a screen that names
 * both, which is a question rather than a guess.
 *
 * Being removed from the active home lands in the first case with a persisted id
 * that no longer matches, and drops back to /homes the same way.
 */
export function resolveActiveHomeId(
	homeIds: readonly string[],
	persistedId: string | null,
): string | null {
	if (persistedId !== null && homeIds.includes(persistedId)) return persistedId;
	if (homeIds.length === 1) return homeIds[0];
	return null;
}
