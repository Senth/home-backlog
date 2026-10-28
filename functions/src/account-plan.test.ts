import { planAccountDeletion } from "./account-plan.js";

const uid = "leaving";
const home = {
	homeId: "home-1",
	name: "Huset",
	members: { [uid]: "owner" },
	memberProfiles: {
		other: { displayName: "Anna" },
	},
	nodes: [],
};

describe("planAccountDeletion", () => {
	it.each([
		[{ [uid]: "owner" }, "delete", []],
		[{ [uid]: "owner", other: "member" }, "blocked", ["Anna"]],
		[{ [uid]: "owner", other: "owner" }, "leave", ["Anna"]],
		[{ [uid]: "member", other: "owner" }, "leave", ["Anna"]],
		[
			{ [uid]: "member", other: "owner", third: "owner" },
			"leave",
			["Anna", "third"],
		],
	] as const)("plans membership %j", (members, outcome, otherMembers) => {
		expect(
			planAccountDeletion({
				uid,
				homes: [{ ...home, members }],
				apiKeys: [],
			}).homes,
		).toEqual([
			{
				homeId: home.homeId,
				name: home.name,
				outcome,
				otherMembers,
				privateCardsDeleted: 0,
			},
		]);
	});

	it("counts only private cards whose sole participant is the caller", () => {
		const snapshot = {
			uid,
			homes: [
				{
					...home,
					members: { [uid]: "member", other: "owner" },
					nodes: [
						{ visibility: "private", participantIds: [uid] },
						{ visibility: "private", participantIds: [uid] },
						{ visibility: "private", participantIds: [uid, "other"] },
						{ visibility: "private", participantIds: ["other"] },
						{ visibility: "shared", participantIds: [uid] },
						{ visibility: "private", participantIds: [] },
					],
				},
			],
			apiKeys: [{ name: "Garden helper" }],
		};
		const before = structuredClone(snapshot);

		expect(planAccountDeletion(snapshot)).toEqual({
			homes: [
				{
					homeId: home.homeId,
					name: home.name,
					outcome: "leave",
					otherMembers: ["Anna"],
					privateCardsDeleted: 2,
				},
			],
			apiKeys: [{ name: "Garden helper" }],
		});
		expect(snapshot).toEqual(before);
	});

	it("plans mixed homes independently", () => {
		const plan = planAccountDeletion({
			uid,
			homes: [
				home,
				{
					...home,
					homeId: "shared",
					members: { [uid]: "member", other: "owner" },
				},
				{
					...home,
					homeId: "blocked",
					members: { [uid]: "owner", other: "member" },
				},
			],
			apiKeys: [{ name: "One" }, { name: "Two" }],
		});

		expect(plan.homes.map(({ outcome }) => outcome)).toEqual([
			"delete",
			"leave",
			"blocked",
		]);
		expect(plan.apiKeys).toEqual([{ name: "One" }, { name: "Two" }]);
	});

	it("handles zero homes with and without API keys", () => {
		for (const apiKeys of [[], [{ name: "Helper" }]]) {
			expect(planAccountDeletion({ uid, homes: [], apiKeys })).toEqual({
				homes: [],
				apiKeys,
			});
		}
	});
});
