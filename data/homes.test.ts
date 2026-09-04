import type { User } from "firebase/auth";
import type { Invite } from "@/models/home";

jest.mock("@/config/firebase", () => ({ db: {} }));

jest.mock("@/data/nodes", () => ({ addToSharedRoots: jest.fn() }));

jest.mock("firebase/firestore", () => ({
	doc: jest.fn(() => ({})),
	updateDoc: jest.fn(),
	deleteDoc: jest.fn(() => Promise.resolve()),
}));

import { deleteDoc, updateDoc } from "firebase/firestore";
import { acceptInvite } from "@/data/homes";
import { addToSharedRoots } from "@/data/nodes";

beforeEach(() => {
	jest.clearAllMocks();
});

const me = {
	uid: "uid-new",
	email: "anna@example.com",
	displayName: "Anna Maria Berg",
	photoURL: null,
} as unknown as User;

function anInvite(addToAllProjects: boolean): Invite {
	return {
		homeId: "home-1",
		emailHash: "hash",
		email: "anna@example.com",
		role: "member",
		addToAllProjects,
		homeName: "Huset",
		invitedByName: "Marcus",
		createdAt: null,
	};
}

describe("acceptInvite", () => {
	it("writes the membership first, and clears the consumed invitation after", async () => {
		await acceptInvite(me, anInvite(false));

		expect(updateDoc).toHaveBeenCalledWith(
			{},
			{
				"members.uid-new": "member",
				"memberProfiles.uid-new": {
					displayName: "Anna Maria Berg",
					photoURL: null,
				},
				"memberEmailHashes.uid-new": expect.any(String),
			},
		);
		expect(deleteDoc).toHaveBeenCalled();
	});

	it("puts the new member on every shared root when the invite is ticked", async () => {
		await acceptInvite(me, anInvite(true));

		expect(addToSharedRoots).toHaveBeenCalledWith("home-1", "uid-new");
	});

	it("touches no project when the invite is unticked", async () => {
		await acceptInvite(me, anInvite(false));

		expect(addToSharedRoots).not.toHaveBeenCalled();
	});
});
