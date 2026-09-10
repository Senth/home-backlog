/**
 * Whether the shell on the wire is a different build than the one running,
 * and what may be done about it. Pure on purpose: the fetch and the reload
 * live in `hooks/use-service-worker.web.ts`, and this file is the unit-tested
 * half of the decision (#264).
 */

/** The build the exported HTML names, or null when there is no tag to read.
 *  The shell is `app/+html.tsx`'s own output, so the tag's shape is ours. */
export function buildFromHtml(html: string): string | null {
	const match = /<meta\s+name="build"\s+content="([^"]*)"\s*\/?>/.exec(html);
	return match?.[1] ?? null;
}

/** A build that could not be read is never stale — an unreadable shell must
 *  not be able to reload the page on its own; only a *different* build may. */
export function isStale(fetched: string | null, running: string): boolean {
	return fetched !== null && fetched !== running;
}

export type ReloadDecision = "reload" | "prompt" | "ignore";

/**
 * Reload inside the boot window while nothing can be lost; offer the banner
 * after it, so a deploy landing mid-edit never reloads under someone's hands;
 * and never act twice — the session flag is what keeps a flapping connection
 * from reloading in a loop.
 */
export function reloadDecision({
	msSinceBoot,
	bootWindowMs,
	alreadyReloaded,
}: {
	msSinceBoot: number;
	bootWindowMs: number;
	alreadyReloaded: boolean;
}): ReloadDecision {
	if (alreadyReloaded) return "ignore";
	return msSinceBoot <= bootWindowMs ? "reload" : "prompt";
}
