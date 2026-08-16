import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { hiddenByParticipants, type Node } from "@/models/node";

/**
 * A board without everyone else's personal projects on it.
 *
 * "I want us to have a shared house, but I want to add my personal projects to
 * the list — it does not make sense that my spouse sees them by default, and
 * they should still be able to see them." Hidden by default, never denied,
 * always one toggle away.
 *
 * It costs **no query, no index and no listener**: the two board listeners
 * already merge client-side, so this is a predicate over a list the screen
 * already holds. Enforcing it in the rules was rejected — it is a display
 * preference, not a permission, and a rule cannot express "hidden but
 * readable".
 *
 * `hiddenCount` is what the app bar goes by, so the toggle appears where it has
 * something to do rather than on every board in a household of one.
 *
 * The state is board-level and **not persisted**: a board always opens in the
 * hiding state, the same way it always opens on its first column.
 */
export function useParticipantFilter(nodes: Node[]): {
	nodes: Node[];
	hiddenCount: number;
	showEveryone: boolean;
	setShowEveryone: (value: boolean) => void;
} {
	const { user } = useAuth();
	const [showEveryone, setShowEveryone] = useState(false);

	const uid = user?.uid ?? null;
	if (uid === null) {
		return { nodes, hiddenCount: 0, showEveryone, setShowEveryone };
	}

	const shown = nodes.filter((node) => !hiddenByParticipants(node, uid));

	return {
		nodes: showEveryone ? nodes : shown,
		hiddenCount: nodes.length - shown.length,
		showEveryone,
		setShowEveryone,
	};
}
