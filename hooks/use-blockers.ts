import { useEffect, useState } from "react";
import { getNode } from "@/data/nodes";
import type { Node } from "@/models/node";

/**
 * One-shot `getNode` per blocker id, read again whenever the screen focuses.
 *
 * The breadcrumb precedent: deliberately *n* single reads, never
 * `documentId() 'in' <ids>` — one unreadable blocker must not erase every
 * row, and a `null` answer renders the gone row rather than nothing. Reading
 * on focus is what makes a reopened blocker re-block on return, and what lets
 * a just-picked one appear without any listener of its own.
 */
export function useBlockerReads(
	homeId: string | null,
	ids: readonly string[],
	focused: boolean,
): ReadonlyMap<string, Node | null> {
	const [blockers, setBlockers] = useState<Map<string, Node | null>>(new Map());

	// `key` stands in for `ids`: `toNode` rebuilds every array on each snapshot,
	// so a dependency on the array itself would re-read on every unrelated
	// change to the document. A change in *contents* is what re-reads, and the
	// effect derives its list from the key rather than closing over the array.
	const key = ids.join("\u0000");

	useEffect(() => {
		const list = key.length === 0 ? [] : key.split("\u0000");
		if (!focused || homeId === null || list.length === 0) {
			setBlockers(new Map());
			return;
		}

		let cancelled = false;
		Promise.all(
			list.map(async (id) => [id, await getNode(homeId, id)] as const),
		)
			.then((pairs) => {
				if (cancelled) return;
				setBlockers(new Map(pairs));
			})
			.catch((reason) => {
				console.error("Could not read the blockers:", reason);
			});

		return () => {
			cancelled = true;
		};
	}, [homeId, key, focused]);

	return blockers;
}
