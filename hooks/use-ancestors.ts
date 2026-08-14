import { useEffect, useMemo, useState } from "react";
import { getNode } from "@/data/nodes";
import type { Node } from "@/models/node";

/**
 * One crumb. `node` is null when the ancestor could not be read — which is not
 * an error and not a gap, but a neutral crumb.
 */
export interface Crumb {
	id: string;
	node: Node | null;
}

/**
 * The trail above a board: one `getDoc` per id in `ancestorIds`, issued in
 * parallel and each handled on its own.
 *
 * An unreadable ancestor is real rather than theoretical. Participant
 * inheritance runs **downward** — a private child holds all of its parent's
 * participants, not the reverse — so being added to a private subtask does not
 * grant a read on the private project above it. That costs one failed read and
 * renders as a neutral crumb; the rest of the trail is unaffected.
 *
 * *Rejected:* `where(documentId(), 'in', ancestorIds)`. One read instead of *n*,
 * and **query-unsafe**: a single unreadable ancestor rejects the whole query and
 * every crumb disappears at once. Rule-safe but query-unsafe is the exact
 * failure `CLAUDE.md` forbids.
 *
 * *Rejected:* carrying the trail in router params. Free while navigating in-app,
 * empty on reload and on a shared link — and a board reached by URL is the case
 * breadcrumbs exist for.
 */
export function useAncestors(
	homeId: string | null,
	ancestorIds: readonly string[],
): { crumbs: Crumb[]; loading: boolean } {
	const [crumbs, setCrumbs] = useState<Crumb[]>([]);
	const [loading, setLoading] = useState(false);

	// `ancestorIds` is a fresh array on every render — the caller reads it off a
	// node — so the effect keys on the path itself. Without this the empty-trail
	// case alone would re-run forever: a new `[]` in, a new `[]` out, a render,
	// and round again.
	const path = ancestorIds.join(" ");
	const trail = `${homeId ?? ""} ${path}`;
	const ids = useMemo(() => path.split(" ").filter(Boolean), [path]);

	// Same render-time clear as `useNodes`: drilling from one board to another
	// would otherwise paint the previous trail as though it were this one's.
	const [rendered, setRendered] = useState(trail);
	if (rendered !== trail) {
		setRendered(trail);
		setCrumbs([]);
	}

	useEffect(() => {
		if (homeId === null || ids.length === 0) {
			setCrumbs([]);
			setLoading(false);
			return;
		}

		let live = true;
		setLoading(true);

		// Never rejects: `getNode` answers null for every failure, so one
		// unreadable ancestor cannot take the rest of the trail with it.
		Promise.all(
			ids.map(async (id) => ({ id, node: await memoized(homeId, id) })),
		).then((resolved) => {
			if (!live) return;
			setCrumbs(resolved);
			setLoading(false);
		});

		return () => {
			live = false;
		};
	}, [homeId, ids]);

	return { crumbs, loading };
}

/**
 * A session memo, keyed by home and id.
 *
 * Drilling down five levels and back up re-reads the same five crumbs on every
 * screen otherwise. Only a node that was actually read is remembered: a failure
 * can be a cold cache or a dropped connection, and remembering *that* would
 * leave a crumb reading "Hidden" for the rest of the session after the
 * connection came back.
 *
 * The cost is a rename by another member not reaching a crumb already resolved;
 * the board's own title comes from a listener, so it is only the trail *above*
 * the current board that can go stale, and only until the next reload.
 */
const cache = new Map<string, Node>();

async function memoized(homeId: string, nodeId: string): Promise<Node | null> {
	const key = `${homeId}/${nodeId}`;
	const remembered = cache.get(key);
	if (remembered) return remembered;

	const node = await getNode(homeId, nodeId);
	if (node) cache.set(key, node);
	return node;
}
