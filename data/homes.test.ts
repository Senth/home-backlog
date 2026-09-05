import type { User } from "firebase/auth";
import type { Invite } from "@/models/home";

jest.mock("@/config/firebase", () => ({ db: {} }));

jest.mock("@/data/nodes", () => ({ addToSharedRoots: jest.fn() }));

jest.mock("firebase/firestore", () => ({
	collection: jest.fn(() => ({})),
	deleteField: jest.fn(() => "delete-field"),
	doc: jest.fn((...args: unknown[]) => ({
		id:
			typeof args[args.length - 1] === "string"
				? args[args.length - 1]
				: "new-label",
	})),
	updateDoc: jest.fn(),
	deleteDoc: jest.fn(() => Promise.resolve()),
}));

import { deleteDoc, updateDoc } from "firebase/firestore";
import {
	acceptInvite,
	createLabel,
	deleteLabel,
	recolourLabel,
	reiconLabel,
	renameLabel,
	reorderLabel,
} from "@/data/homes";
import { addToSharedRoots } from "@/data/nodes";
import { toHex } from "@/models/label-color";

const amber = toHex([0xfd, 0xe6, 0x8a]);

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
			{ id: "home-1" },
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

describe("the label writes", () => {
	it("creates a definition under a generated id and hands the id back", async () => {
		const id = await createLabel("home-1", {
			title: "  Electrical  ",
			icon: "bolt",
			color: amber,
			rank: "a0",
		});

		expect(id).toBe("new-label");
		expect(updateDoc).toHaveBeenCalledWith(
			{ id: "home-1" },
			{
				"labels.new-label": {
					title: "Electrical",
					icon: "bolt",
					color: amber,
					rank: "a0",
				},
			},
		);
	});

	it("edits one field of one definition per write", async () => {
		await renameLabel("home-1", "bolt", "  Plumbing  ");
		expect(updateDoc).toHaveBeenLastCalledWith(
			{ id: "home-1" },
			{
				"labels.bolt.title": "Plumbing",
			},
		);
		await recolourLabel("home-1", "bolt", amber);
		expect(updateDoc).toHaveBeenLastCalledWith(
			{ id: "home-1" },
			{
				"labels.bolt.color": amber,
			},
		);
		await reiconLabel("home-1", "bolt", "water");
		expect(updateDoc).toHaveBeenLastCalledWith(
			{ id: "home-1" },
			{
				"labels.bolt.icon": "water",
			},
		);
		await reorderLabel("home-1", "bolt", "a5");
		expect(updateDoc).toHaveBeenLastCalledWith(
			{ id: "home-1" },
			{
				"labels.bolt.rank": "a5",
			},
		);
		expect(updateDoc).toHaveBeenCalledTimes(4);
	});

	it("deletes only the definition, leaving every card's id in place", async () => {
		await deleteLabel("home-1", "bolt");

		expect(updateDoc).toHaveBeenCalledWith(
			{ id: "home-1" },
			{ "labels.bolt": "delete-field" },
		);
	});
});
