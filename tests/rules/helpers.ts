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

export async function createTestEnv(): Promise<RulesTestEnvironment> {
	return initializeTestEnvironment({
		// Must match the `--project` in the `test:rules` script. firebase.json runs
		// the emulators in `singleProjectMode`, and the Storage rules reach into
		// Firestore with `firestore.get()` — that lookup resolves against the
		// emulator's own project, so a different id here would find no home doc
		// and deny every upload. The `demo-` prefix keeps the SDK from ever
		// reaching a real project.
		projectId: "demo-home-backlog-rules",
		firestore: {
			rules: readFileSync("firestore.rules", "utf8"),
			host: "127.0.0.1",
			port: 8062,
		},
		storage: {
			rules: readFileSync("storage.rules", "utf8"),
			host: "127.0.0.1",
			port: 8063,
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
