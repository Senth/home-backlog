import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { cachedNode } from "@/hooks/use-ancestors";
import type { Node } from "@/models/node";

/**
 * The ancestors of Overview's cards that the pool pair does not already hold,
 * resolved by id (#100).
 *
 * Overview draws cards from anywhere in the home, so their trails reach nodes
 * no listener is holding — a *done* project above a still-open card is the
 * case that exists at all. The pool pair covers the active ancestors; this
 * hook `getDoc`s only the rest, one cached read per id, and answers a map of
 * id → node for every id it was asked about. An ancestor the pool *does*
 * hold comes straight from it, never fetched, so a label edit lands on the
 * next snapshot rather than going stale in a session memo.
 *
 * `null` is the answer for an id that is neither in the pool nor readable —
 * gone, refused, or the network could not say. It contributes no labels, the
 * same neutral answer a crumb renders.
 */
export function useLabelAncestors(
	homeId: string | null,
	ancestorIds: readonly string[],
	pool: readonly Node[],
): ReadonlyMap<string, Node | null> {
	const { user } = useAuth();
	const uid = user?.uid ?? null;

	// `ancestorIds` is a fresh array on every render, so the id set is keyed
	// on the joined path — the same trick `use-ancestors` uses to keep the
	// effect from re-running on every unrelated render.
	const path = [...new Set(ancestorIds)].join(" ");
	const ids = useMemo(() => path.split(" ").filter(Boolean), [path]);

	const poolById = useMemo(
		() => new Map(pool.map((node) => [node.id, node])),
		[pool],
	);
	const missingKey = ids.filter((id) => !poolById.has(id)).join("\u0000");

	const [resolved, setResolved] = useState<Map<string, Node | null>>(new Map());

	// A home or account change would otherwise let the first render of the new
	// scope merge the previous one's reads — the same render-time clear
	// `use-ancestors` makes before its effect can answer.
	const [rendered, setRendered] = useState(`${uid ?? ""} ${homeId ?? ""}`);
	const scope = `${uid ?? ""} ${homeId ?? ""}`;
	if (rendered !== scope) {
		setRendered(scope);
		setResolved(new Map());
	}

	useEffect(() => {
		const missing = missingKey.length === 0 ? [] : missingKey.split("\u0000");
		if (homeId === null || uid === null || missing.length === 0) {
			setResolved(new Map());
			return;
		}

		let live = true;
		// Never rejects: `getNode` answers null for every failure.
		Promise.all(
			missing.map(
				async (id) => [id, await cachedNode(uid, homeId, id)] as const,
			),
		).then((pairs) => {
			if (live) setResolved(new Map(pairs));
		});

		return () => {
			live = false;
		};
	}, [homeId, uid, missingKey]);

	return useMemo(() => {
		const map = new Map<string, Node | null>();
		for (const id of ids) {
			map.set(id, poolById.get(id) ?? resolved.get(id) ?? null);
		}
		return map;
	}, [ids, poolById, resolved]);
}
