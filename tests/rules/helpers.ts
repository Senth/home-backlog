import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	initializeTestEnvironment,
	type RulesTestContext,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

export const HOME_ID = "home-1";

export const OWNER = { uid: "uid-owner", email: "owner@example.com" };
export const MEMBER = { uid: "uid-member", email: "member@example.com" };
export const INVITEE = { uid: "uid-invitee", email: "Invitee@Example.com" };
export const OUTSIDER = { uid: "uid-outsider", email: "nobody@example.com" };
/**
 * An uppercase non-ASCII address, which is the one case where the two sides of
 * the hash could silently disagree: `firestore.rules` folds case with CEL's
 * `lower()` and the client with JavaScript's `toLowerCase()`. If those differ on
 * Ä, a Swedish invitee never finds an invitation that was really sent, and
 * nothing on screen can explain why.
 */
export const NORDIC = { uid: "uid-nordic", email: "MÄRTA@exempel.se" };

export interface TestUser {
	uid: string;
	email: string;
}

/**
 * Mirrors the `emailHash()` function in firestore.rules: SHA-256 of the
 * lowercased email, lowercase hex. If these two ever disagree, an invitee
 * cannot find their own invite.
 *
 * The fold is **ASCII only**, because CEL's `lower()` is — `toLowerCase()` here
 * would quietly pass every ASCII test while disagreeing with the rule on Ä, and
 * the one case that matters is the one it would not cover.
 */
export function emailHash(email: string): string {
	const lowered = email.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
	return createHash("sha256").update(lowered).digest("hex");
}

export function ownerAndMember(): Record<string, string> {
	return { [OWNER.uid]: "owner", [MEMBER.uid]: "member" };
}

/** Everyone the tests can sign in as, so a uid can be resolved to an address. */
const USERS: TestUser[] = [OWNER, MEMBER, INVITEE, OUTSIDER];

function userByUid(uid: string): TestUser | undefined {
	return USERS.find((user) => user.uid === uid);
}

export function profilesFor(
	members: Record<string, string>,
): Record<string, { displayName: string; photoURL: string | null }> {
	return Object.fromEntries(
		Object.keys(members).map((uid) => [
			uid,
			{ displayName: userByUid(uid)?.email ?? uid, photoURL: null },
		]),
	);
}

export function hashesFor(
	members: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.keys(members).flatMap((uid) => {
			const user = userByUid(uid);
			return user ? [[uid, emailHash(user.email)]] : [];
		}),
	);
}

/**
 * A home document in the shape the app writes it. Membership is the only part a
 * test usually cares about, so the sibling maps are derived from it — a seed
 * whose `memberEmailHashes` disagreed with its `members` would fail rules that
 * have nothing to do with the case under test.
 */
export function homeDoc(
	members: Record<string, string> = ownerAndMember(),
): Record<string, unknown> {
	return {
		name: "Home",
		members,
		memberProfiles: profilesFor(members),
		memberEmailHashes: hashesFor(members),
		createdBy: OWNER.uid,
	};
}

/**
 * An invite document, keyed elsewhere by the same hash it carries as a field.
 *
 * `createdAt` is not decoration: the owner's pending list orders by it, and a
 * Firestore query on a field drops every document that lacks it — so a seed
 * without one would pass these tests while being invisible to the query the app
 * actually runs.
 */
export function inviteDoc(
	email: string,
	role = "member",
): Record<string, unknown> {
	return {
		emailHash: emailHash(email),
		email,
		role,
		homeName: "Home",
		invitedByName: "Owner",
		createdAt: new Date("2026-01-01T00:00:00Z"),
	};
}

/**
 * A node document in the shape the app writes it: **every** field, with a
 * value. That is the contract `validNode()` enforces — a field that is absent
 * can never be queried, because Firestore does not index one — so a helper that
 * wrote only the interesting fields would make every test fail for the same
 * uninteresting reason.
 *
 * The timestamps are real dates rather than `serverTimestamp()` so that a seed
 * and a client write are comparable, and so `immutable()` has a value to hold
 * an update against.
 *
 * An override of `undefined` **removes** the field rather than writing one. Two
 * fields here are present-only in the rules — `assigneeIds` and `createdVia` —
 * and "a node written before this field existed" is a case each of them has to
 * be tested against; `{ createdVia: undefined }` spread over an object would
 * otherwise be a key holding `undefined`, which the SDK refuses outright.
 */
export function nodeDoc(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	const document: Record<string, unknown> = {
		title: "Fix the gutter",
		status: "backlog",
		rank: "a0",
		parentId: null,
		ancestorIds: [],
		locationId: null,
		locationAncestorIds: [],
		// A root names the people whose project it is, since #102: the rules
		// refuse an empty list on one, so the default here is a root somebody is
		// on. A test about a *descendant* overrides it with `[]`, which is what a
		// shared step carries.
		participantIds: [OWNER.uid],
		assigneeIds: [],
		visibility: "shared",
		columns: ["backlog", "next_up", "execution", "done"],
		childCount: 0,
		doneCount: 0,
		dueDate: null,
		priority: null,
		blockedBy: [],
		notes: "",
		checklist: [],
		effort: null,
		photos: [],
		archived: false,
		// Written by the client on every create since #7. A node from before it
		// has none, which is what `createdVia: undefined` in an override covers.
		createdVia: "app",
		completedAt: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		createdBy: OWNER.uid,
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};

	for (const [field, value] of Object.entries(document)) {
		if (value === undefined) delete document[field];
	}

	return document;
}

export async function createTestEnv(): Promise<RulesTestEnvironment> {
	// The ports come from the allocation `yarn test:rules` sets, so two
	// worktrees can run the suite at once. Never literals — and deliberately
	// *not* the web bundle's `EXPO_PUBLIC_*` names: babel-preset-expo rewrites
	// every `process.env.EXPO_PUBLIC_*` read into an import of expo's ESM-only
	// `expo/virtual/env`, which this Jest project does not transform.
	const firestorePort = Number(process.env.EMULATOR_FIRESTORE_PORT);
	const storagePort = Number(process.env.EMULATOR_STORAGE_PORT);
	if (!firestorePort || !storagePort) {
		throw new Error(
			"emulator ports are not set — run the rules suite with yarn test:rules",
		);
	}
	return initializeTestEnvironment({
		// Must match the `--project` in `scripts/test-rules.mjs`. The generated
		// config runs the emulators in `singleProjectMode`, and the Storage
		// rules reach into Firestore with `firestore.get()` — that lookup
		// resolves against the emulator's own project, so a different id here
		// would find no home doc and deny every upload. The `demo-` prefix
		// keeps the SDK from ever reaching a real project.
		projectId: "demo-home-backlog-rules",
		firestore: {
			rules: readFileSync("firestore.rules", "utf8"),
			host: "127.0.0.1",
			port: firestorePort,
		},
		storage: {
			rules: readFileSync("storage.rules", "utf8"),
			host: "127.0.0.1",
			port: storagePort,
		},
	});
}

/*
 * `RulesTestContext` declares the *compat* Firestore and Storage types, but the
 * instances it hands back work with the modular API as well — the modular
 * functions unwrap a compat object's delegate. These three helpers do that cast
 * once, so no test has to.
 */

function db(context: RulesTestContext): Firestore {
	return context.firestore() as unknown as Firestore;
}

function bucket(context: RulesTestContext): FirebaseStorage {
	return context.storage() as unknown as FirebaseStorage;
}

/** Firestore as a signed-in user carrying a verified email. */
export function dbAs(
	env: RulesTestEnvironment,
	user: TestUser,
	{ emailVerified = true }: { emailVerified?: boolean } = {},
): Firestore {
	return db(
		env.authenticatedContext(user.uid, {
			email: user.email,
			email_verified: emailVerified,
		}),
	);
}

/** Storage as a signed-in user. */
export function storageAs(
	env: RulesTestEnvironment,
	user: TestUser,
): FirebaseStorage {
	return bucket(
		env.authenticatedContext(user.uid, {
			email: user.email,
			email_verified: true,
		}),
	);
}

export function dbAnon(env: RulesTestEnvironment): Firestore {
	return db(env.unauthenticatedContext());
}

export function storageAnon(env: RulesTestEnvironment): FirebaseStorage {
	return bucket(env.unauthenticatedContext());
}

/** Writes fixtures with rules turned off, so setup cannot be blocked by them. */
export async function seed(
	env: RulesTestEnvironment,
	write: (firestore: Firestore) => Promise<void>,
): Promise<void> {
	await env.withSecurityRulesDisabled(async (context) => {
		await write(db(context));
	});
}
