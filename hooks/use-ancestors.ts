import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
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
	const { user } = useAuth();
	const uid = user?.uid ?? null;

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
		if (homeId === null || uid === null || ids.length === 0) {
			setCrumbs([]);
			setLoading(false);
			return;
		}

		let live = true;
		setLoading(true);

		// Never rejects: `getNode` answers null for every failure, so one
		// unreadable ancestor cannot take the rest of the trail with it.
		Promise.all(
			ids.map(async (id) => ({ id, node: await memoized(uid, homeId, id) })),
		).then((resolved) => {
			if (!live) return;
			setCrumbs(resolved);
			setLoading(false);
		});

		return () => {
			live = false;
		};
	}, [homeId, uid, ids]);

	return { crumbs, loading };
}

/**
 * A session memo, keyed by **who**, then home and id.
 *
 * Drilling down five levels and back up re-reads the same five crumbs on every
 * screen otherwise. Only a node that was actually read is remembered: a failure
 * can be a cold cache or a dropped connection, and remembering *that* would
 * leave a crumb reading "Hidden" for the rest of the session after the
 * connection came back.
 *
 * The uid is in the key, and the whole map is dropped when it changes. Signing
 * out does not reload the page, so on a shared device the next member would
 * otherwise be handed a title the *previous* one was allowed to read — and it
 * would render as a tappable crumb rather than the neutral "Hidden" crumb this
 * whole design exists for. Leaving a home and coming back is the same failure on
 * a shorter path.
 *
 * The cost is a rename by another member not reaching a crumb already resolved;
 * the board's own title comes from a listener, so it is only the trail *above*
 * the current board that can go stale, and only until the next reload.
 */
const cache = new Map<string, Node>();
let cachedFor: string | null = null;

async function memoized(
	uid: string,
	homeId: string,
	nodeId: string,
): Promise<Node | null> {
	if (cachedFor !== uid) {
		cache.clear();
		cachedFor = uid;
	}

	const key = `${uid}/${homeId}/${nodeId}`;
	const remembered = cache.get(key);
	if (remembered) return remembered;

	const node = await getNode(homeId, nodeId);
	if (node) cache.set(key, node);
	return node;
}
