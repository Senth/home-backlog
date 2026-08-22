import type { ApiError } from "./errors.js";
import { refuseEmptyRootParticipants } from "./writes.js";

function refusal(
	visibility: "shared" | "private",
	isRoot: boolean,
	participantIds: readonly string[],
): ApiError | null {
	try {
		refuseEmptyRootParticipants(visibility, isRoot, participantIds);
	} catch (error) {
		return error as ApiError;
	}
	return null;
}

/**
 * The rules' `rootHasParticipants()`, mirrored: the Admin SDK bypasses
 * `firestore.rules` entirely, so this is the only thing standing between an
 * agent-written or agent-promoted root and one nobody can see (#102).
 */
describe("a shared root cannot be created or promoted with nobody on it", () => {
	it("refuses a shared root with an empty list", () => {
		expect(refusal("shared", true, [])?.code).toBe("participants_required");
	});

	it("allows a shared root with at least one participant", () => {
		expect(refusal("shared", true, ["uidMarcus"])).toBeNull();
	});

	it("allows a shared descendant with an empty list — it always carries []", () => {
		expect(refusal("shared", false, [])).toBeNull();
	});

	it("allows a private root with an empty list — private always carries its creator", () => {
		expect(refusal("private", true, [])).toBeNull();
	});
});
