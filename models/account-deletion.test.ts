import {
	type AccountDeletionPlan,
	accountDeletionView,
} from "@/models/account-deletion";

const now = 1_000_000;
const plan: AccountDeletionPlan = {
	homes: [
		{
			homeId: "sole",
			name: "Stugan",
			outcome: "delete",
			otherMembers: [],
			privateCardsDeleted: 0,
		},
		{
			homeId: "shared",
			name: "Huset",
			outcome: "leave",
			otherMembers: ["Anna Maria Berg"],
			privateCardsDeleted: 2,
		},
	],
	apiKeys: [{ name: "research agent" }],
};

it("waits for a plan without enabling deletion", () => {
	expect(accountDeletionView(null, now, now)).toMatchObject({
		rows: [],
		disabled: true,
	});
});

it("keeps each home's fate, names and private count", () => {
	const view = accountDeletionView(plan, now - 60_000, now);
	expect(view).toMatchObject({
		disabled: false,
		stale: false,
		label: "account.deleteAccount",
		hint: "account.delete.freshHint",
	});
	expect(
		view.rows.map((row) => [row.icon, row.copy, row.privateCardsDeleted]),
	).toEqual([
		["home-outline", "account.delete.delete", 0],
		["exit-to-app", "account.delete.leave", 2],
	]);
	expect(view.rows[1].otherMembers).toEqual(["Anna Maria Berg"]);
});

it.each([null, Number.NaN, now - 300_001])(
	"requires a new sign-in for auth time %s",
	(time) => {
		expect(accountDeletionView(plan, time, now)).toMatchObject({
			stale: true,
			disabled: false,
			label: "account.delete.signInAgain",
			hint: "account.delete.staleHint",
		});
	},
);

it("accepts exactly five minutes, matching the server", () => {
	expect(accountDeletionView(plan, now - 300_000, now).stale).toBe(false);
});

it("puts disappearing homes before homes that stay", () => {
	expect(
		accountDeletionView(
			{ ...plan, homes: [...plan.homes].reverse() },
			now,
			now,
		).rows.map((home) => home.homeId),
	).toEqual(["sole", "shared"]);
});

it("blocked homes outrank stale sign-in and disable deletion", () => {
	const blocked: AccountDeletionPlan = {
		...plan,
		homes: plan.homes.map((home) =>
			home.homeId === "shared" ? { ...home, outcome: "blocked" } : home,
		),
	};
	expect(accountDeletionView(blocked, null, now)).toMatchObject({
		disabled: true,
		label: "account.deleteAccount",
		hint: "account.delete.blockedHint",
		blockedHomes: ["Huset"],
	});
	expect(accountDeletionView(blocked, now, now).rows[1].icon).toBe(
		"information-outline",
	);
});
