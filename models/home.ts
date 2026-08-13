import type { Timestamp } from "firebase/firestore";
import { sha256Hex } from "@/models/sha256";

/**
 * A home, its people, and the invitations that let someone become one of them.
 *
 * Every other collection in the app hangs off a home, and `firestore.rules`
 * resolves membership through the `members` map on this document — so the shape
 * here is not a convenience, it is the shape the rules read.
 */

/** What a member may do. `owner` is labelled *Admin* in the UI, never in data. */
export type Role = "owner" | "member";

export const roles: readonly Role[] = ["owner", "member"];

/**
 * Names, photos and email hashes live in sibling maps rather than inside
 * `members`. Six rule expressions read `members` as uid → role string; widening
 * its values to objects would rewrite every one of them, and every test, for
 * nothing these maps do not already give.
 */
export interface MemberProfile {
	displayName: string;
	photoURL: string | null;
}

export interface Home {
	id: string;
	name: string;
	members: Record<string, Role>;
	memberProfiles: Record<string, MemberProfile>;
	/**
	 * uid → `sha256(lowercased email)`. Addresses of *members* are never stored
	 * in readable form: the hash answers "is this address already in the home?"
	 * and "is this me?" without exposing anyone to the rest of the household.
	 */
	memberEmailHashes: Record<string, string>;
	createdAt: Timestamp | null;
	createdBy: string;
}

/** One row of the members list — the three maps joined back together. */
export interface Member {
	uid: string;
	role: Role;
	displayName: string;
	photoURL: string | null;
}

/**
 * `homes/{homeId}/invites/{sha256(lowercased email)}`.
 *
 * `homeName` and `invitedByName` are denormalized because the invitee can read
 * neither the home document nor its `memberProfiles` — they are not a member
 * yet, and the whole point of the invite is that they get to decide whether to
 * become one.
 */
export interface Invite {
	/** From `snapshot.ref.parent.parent.id`; the invitee never learns it otherwise. */
	homeId: string;
	/** Equal to the document id. Stored as a field so it can be *queried* — see below. */
	emailHash: string;
	/** Plaintext, readable only by this home's owners, so a typo is visible and fixable. */
	email: string;
	role: Role;
	homeName: string;
	invitedByName: string;
	createdAt: Timestamp | null;
}

/**
 * The invite's document id, and the value of its `emailHash` field.
 *
 * Both, because `documentId()` in a collection-group query compares the *full
 * document path* rather than the last segment, so the hash in the key is not
 * queryable. The invitee — who does not know `homeId` and cannot read the home
 * — finds their invitation only by querying the field.
 */
export function emailHash(email: string): string {
	return sha256Hex(email.trim().toLowerCase());
}

/** Longest name a home may have, matched by `validHome()` in `firestore.rules`. */
export const maxHomeNameLength = 60;

/** Why a typed home name is not acceptable, as an i18n key, or null if it is. */
export type HomeNameError = "homes.nameRequired" | "homes.nameTooLong";

export function homeNameError(name: string): HomeNameError | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) return "homes.nameRequired";
	if (trimmed.length > maxHomeNameLength) return "homes.nameTooLong";
	return null;
}

/**
 * Deliberately permissive: "something@something.something, no spaces". The
 * authority on whether an address exists is whether its owner ever signs in
 * with it, and a stricter pattern only ever refuses somebody's real address.
 */
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: string): boolean {
	return emailPattern.test(value.trim());
}

/**
 * The three maps joined into rows, owners first and then alphabetically, so a
 * member's position does not move when somebody edits their own display name
 * into a different case.
 *
 * A member with no profile entry still gets a row: they exist in `members`,
 * which is what the rules go by, and a home that hides someone who can read it
 * is worse than one showing a row with no name.
 */
export function membersOf(home: Home): Member[] {
	return Object.entries(home.members)
		.map(([uid, role]) => ({
			uid,
			role,
			displayName: home.memberProfiles?.[uid]?.displayName ?? "",
			photoURL: home.memberProfiles?.[uid]?.photoURL ?? null,
		}))
		.sort((a, b) => {
			if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
			return (
				a.displayName.localeCompare(b.displayName) || a.uid.localeCompare(b.uid)
			);
		});
}

/** How many owners the home would have left — the last-owner rule, client-side. */
export function ownerCount(members: Record<string, Role>): number {
	return Object.values(members).filter((role) => role === "owner").length;
}

/** Whether `uid` is the only owner, and so may neither be demoted nor removed. */
export function isLastOwner(home: Home, uid: string): boolean {
	return home.members[uid] === "owner" && ownerCount(home.members) === 1;
}
