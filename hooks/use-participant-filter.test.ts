import { act, renderHook } from "@testing-library/react-native";
import { useParticipantFilter } from "@/hooks/use-participant-filter";
import type { Node } from "@/models/node";

/**
 * The predicate itself is tested in `models/node.test.ts`. What is here is the
 * arithmetic the app bar goes by: a `hiddenCount` that dropped to zero once the
 * toggle was on would make the toggle vanish under the hand that had just
 * turned it on.
 */

const uid = "uid-a";

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "uid-a" } }),
}));

function node(id: string, participantIds: string[]): Node {
	return { id, participantIds } as unknown as Node;
}

const mine = node("mine", [uid]);
const nobodys = node("nobodys", []);
const theirs = node("theirs", ["uid-b"]);

describe("useParticipantFilter", () => {
	it("hides somebody else's project and counts it", () => {
		const { result } = renderHook(() =>
			useParticipantFilter([nobodys, mine, theirs]),
		);

		expect(result.current.nodes).toEqual([nobodys, mine]);
		expect(result.current.hiddenCount).toBe(1);
		expect(result.current.showEveryone).toBe(false);
	});

	it("hides nothing on a board where no card names anyone", () => {
		const { result } = renderHook(() => useParticipantFilter([nobodys]));

		expect(result.current.nodes).toEqual([nobodys]);
		expect(result.current.hiddenCount).toBe(0);
	});

	it("shows everything once the toggle is on, and keeps saying how many", () => {
		// `hiddenCount` is what the app bar renders the toggle from. Recomputing
		// it over the *filtered* list would take it to zero the moment the toggle
		// went on, and the control would disappear under the hand that used it.
		const { result } = renderHook(() =>
			useParticipantFilter([nobodys, theirs]),
		);

		act(() => result.current.setShowEveryone(true));

		expect(result.current.nodes).toEqual([nobodys, theirs]);
		expect(result.current.hiddenCount).toBe(1);
	});
});
