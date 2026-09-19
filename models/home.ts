import type { Timestamp } from "firebase/firestore";
import type { LabelWithId } from "@/models/label";
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
	/**
	 * The household's label definitions (#100), in the home's own order. They
	 * ride the homes listener `HomeContext` already holds, so every screen that
	 * draws a card reads them for free — the reason the definitions live on the
	 * home document at all.
	 */
	labels: LabelWithId[];
	/**
	 * The home's attachment bytes and who put them there (#298), written only
	 * by the Storage-triggered counter — `firestore.rules` refuses them to
	 * every client. Absent on a home written before any attachment existed;
	 * read defensively, like everything else here.
	 */
	attachmentBytes: number;
	attachmentBytesByUid: Record<string, number>;
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
	/**
	 * Whether accepting also puts the new member on every shared project.
	 *
	 * It lives on the invite rather than being applied by the inviter because
	 * invites are keyed by email hash and the invitee has **no uid until they
	 * accept** — there is nothing to write into a participant list at invite
	 * time. Absent on every invitation written before #102, which reads as off.
	 */
	addToAllProjects: boolean;
	homeName: string;
	invitedByName: string;
	createdAt: Timestamp | null;
}

/**
 * Lowercase, **ASCII only** — exactly what CEL's `lower()` does.
 *
 * Not a simplification: `firestore.rules` folds case with `lower()`, which
 * leaves every non-ASCII letter alone, and `String.prototype.toLowerCase()` does
 * not. Using the JavaScript one would make `emailHash()` disagree with the rules
 * for any address containing an uppercase Ä, Ö or Å — and the rules compare
 * *their* hash of your token email against the one you wrote, so the disagreement
 * would refuse you your own `memberEmailHashes` entry. A Swedish user whose
 * Google address carried one could not create a home, could not accept an
 * invitation, and would see nothing but a failure with no cause.
 *
 * `tests/rules/firestore.test.ts` proves the two agree, with a non-ASCII address.
 */
function lowerAscii(value: string): string {
	return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
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
	return sha256Hex(lowerAscii(email.trim()));
}

/**
 * A typed address, folded to the form an identity provider reports.
 *
 * This is the *other* half of the case problem. `emailHash()` may only fold what
 * the rules fold, but an owner typing "Märta@Exempel.se" still has to reach an
 * invitee whose Google address is `märta@exempel.se`. So what a human types is
 * fully lowercased once, here, before it is ever hashed or stored — and the
 * hashing itself stays an exact mirror of the rule.
 */
export function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
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

/** Why a typed address cannot be invited, with what the message needs to say it. */
export type InviteProblem =
	| { key: "invite.invalidEmail" }
	| { key: "invite.selfError" }
	| { key: "invite.alreadyMember"; name: string }
	| { key: "invite.alreadyInvited" };

/**
 * Whether an address can be invited to this home, answered without ever
 * learning anyone's address.
 *
 * The home carries `memberEmailHashes`, not addresses, so the check is done by
 * hashing what was typed and looking for it — enough to answer "already a
 * member?" and "that's you?" without exposing a single member's address to
 * whoever is holding the phone.
 *
 * Order matters: your own address is also a member's, and saying "you are
 * already in this home" instead of "that is your own address" answers a question
 * nobody asked.
 */
export function inviteProblem(
	address: string,
	home: Home,
	myUid: string,
	invitedHashes: readonly string[],
): InviteProblem | null {
	const typed = normalizeEmail(address);
	if (!isEmailAddress(typed)) return { key: "invite.invalidEmail" };

	const hash = emailHash(typed);
	if (home.memberEmailHashes[myUid] === hash)
		return { key: "invite.selfError" };

	const member = Object.entries(home.memberEmailHashes).find(
		([, value]) => value === hash,
	);
	if (member) {
		return {
			key: "invite.alreadyMember",
			// A member who has not opened the app since joining has no profile yet.
			// The address is a fine second choice: they typed it themselves.
			name: home.memberProfiles[member[0]]?.displayName || typed,
		};
	}

	if (invitedHashes.includes(hash)) return { key: "invite.alreadyInvited" };

	return null;
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
