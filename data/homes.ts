import type { User } from "firebase/auth";
import {
	addDoc,
	collection,
	collectionGroup,
	type DocumentData,
	deleteDoc,
	deleteField,
	doc,
	FieldPath,
	getDocs,
	type Query,
	type QueryDocumentSnapshot,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
	where,
} from "firebase/firestore";
import { displayLabel } from "@/auth/display-name";
import { db } from "@/config/firebase";
import {
	emailHash,
	type Home,
	type Invite,
	type MemberProfile,
	normalizeEmail,
	type Role,
} from "@/models/home";

/**
 * Every Firestore read and write that touches a home.
 *
 * Thin on purpose: the decisions live in `models/home.ts` (what is valid) and in
 * `firestore.rules` (what is permitted). What is here is the shape of the two
 * queries, which is not a detail — each one is chosen so that *every document it
 * can match* is one the caller is allowed to read. Firestore rejects a whole
 * query if any matching document could be denied, so a query that is merely
 * rule-safe still fails.
 */

const homesCollection = "homes";
const invitesCollection = "invites";

function homeRef(homeId: string) {
	return doc(db, homesCollection, homeId);
}

function inviteRef(homeId: string, hash: string) {
	return doc(db, homesCollection, homeId, invitesCollection, hash);
}

export function toHome(snapshot: QueryDocumentSnapshot<DocumentData>): Home {
	const data = snapshot.data();

	return {
		id: snapshot.id,
		name: typeof data.name === "string" ? data.name : "",
		members: (data.members ?? {}) as Record<string, Role>,
		// Absent on a home written before these maps existed, and absent for a
		// member who has not opened the app since. Neither is a broken home.
		memberProfiles: (data.memberProfiles ?? {}) as Record<
			string,
			MemberProfile
		>,
		memberEmailHashes: (data.memberEmailHashes ?? {}) as Record<string, string>,
		createdAt: data.createdAt ?? null,
		createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
	};
}

export function toInvite(
	snapshot: QueryDocumentSnapshot<DocumentData>,
): Invite {
	const data = snapshot.data();

	return {
		// The only place the invitee can learn which home this is: they cannot
		// read the home document, and the query never told them its id.
		homeId: snapshot.ref.parent.parent?.id ?? "",
		emailHash: typeof data.emailHash === "string" ? data.emailHash : "",
		email: typeof data.email === "string" ? data.email : "",
		role: data.role === "owner" ? "owner" : "member",
		homeName: typeof data.homeName === "string" ? data.homeName : "",
		invitedByName:
			typeof data.invitedByName === "string" ? data.invitedByName : "",
		createdAt: data.createdAt ?? null,
	};
}

/**
 * The homes I belong to.
 *
 * Provably query-safe: a home I am not in has no `members.<uid>` subfield, so it
 * cannot match, and every document that *can* match satisfies
 * `allow get, list: if memberOfThis()`. Map subfields are indexed automatically,
 * so this needs no composite index, and the listener is as wide as the number of
 * homes one person belongs to — one to three.
 */
export function homesQuery(uid: string): Query<DocumentData> {
	return query(
		collection(db, homesCollection),
		where(new FieldPath("members", uid), "in", ["owner", "member"]),
	);
}

/**
 * My pending invitations, wherever they were sent from.
 *
 * A collection group, because the invitee cannot read the home document and does
 * not know its id, so the invite is unreachable by path — and `documentId()`
 * compares the full document path rather than the last segment, so the hash in
 * the key is not queryable either. Hence `emailHash` as a field.
 *
 * Provably query-safe: every matching document carries my own hash by
 * definition, which is exactly what the collection-group read rule tests.
 *
 * It needs the `emailHash` entry in `firestore.indexes.json`. Firestore's
 * automatic single-field indexes are COLLECTION-scoped, and a collection-group
 * filter needs a COLLECTION_GROUP-scoped one declared. The emulator indexes
 * everything on the fly, so it can never surface the omission — it would appear
 * only in production, as an invitee who can never find an invitation that was
 * really sent. A field override *replaces* automatic indexing for the field, so
 * the two default COLLECTION-scoped indexes are restated there rather than lost.
 */
export function pendingInvitesQuery(email: string): Query<DocumentData> {
	return query(
		collectionGroup(db, invitesCollection),
		where("emailHash", "==", emailHash(email)),
	);
}

/** Pending invitations for one home. Owners only — see `firestore.rules`. */
export function homeInvitesQuery(homeId: string): Query<DocumentData> {
	return query(collection(db, homesCollection, homeId, invitesCollection));
}

/** What a member records about themselves. Nobody else may write it. */
export function profileOf(user: User): MemberProfile {
	return { displayName: displayLabel(user), photoURL: user.photoURL ?? null };
}

export async function createHome(user: User, name: string): Promise<string> {
	const created = await addDoc(collection(db, homesCollection), {
		name: name.trim(),
		members: { [user.uid]: "owner" },
		memberProfiles: { [user.uid]: profileOf(user) },
		memberEmailHashes: { [user.uid]: emailHash(user.email ?? "") },
		createdAt: serverTimestamp(),
		createdBy: user.uid,
	});

	return created.id;
}

export function renameHome(homeId: string, name: string): Promise<void> {
	return updateDoc(homeRef(homeId), { name: name.trim() });
}

/** Keeps my own name and photo current, in a home I am already in. */
export function saveMyProfile(homeId: string, user: User): Promise<void> {
	return updateDoc(homeRef(homeId), {
		[`memberProfiles.${user.uid}`]: profileOf(user),
		[`memberEmailHashes.${user.uid}`]: emailHash(user.email ?? ""),
	});
}

export function setMemberRole(
	homeId: string,
	uid: string,
	role: Role,
): Promise<void> {
	return updateDoc(homeRef(homeId), { [`members.${uid}`]: role });
}

/** Removing somebody takes their profile and hash with them. */
export function removeMember(homeId: string, uid: string): Promise<void> {
	return updateDoc(homeRef(homeId), {
		[`members.${uid}`]: deleteField(),
		[`memberProfiles.${uid}`]: deleteField(),
		[`memberEmailHashes.${uid}`]: deleteField(),
	});
}

/**
 * Deleting a home takes its pending invitations with it, in that order.
 *
 * They have to go first, and they have to go at all. Every invite rule resolves
 * ownership through a `get()` on the home document, so once the home is gone
 * nobody can delete them — while the collection-group read never touches the
 * home at all, so an invitee would go on seeing "Marcus invited you to Huset"
 * for a household that no longer exists, and Join would fail on a document that
 * is not there. The only person who could still clear it would be the invitee,
 * by declining an invitation to nowhere.
 *
 * This is the same client-side cascade the spec keeps bounded by offering
 * delete to a sole member only. The nodes, locations and recurring rules are
 * still left stranded; that needs a Cloud Function (#1, #39).
 */
export async function deleteHome(homeId: string): Promise<void> {
	const invites = await getDocs(homeInvitesQuery(homeId));
	await Promise.all(invites.docs.map((invite) => deleteDoc(invite.ref)));

	await deleteDoc(homeRef(homeId));
}

export function sendInvite(
	home: Home,
	inviter: User,
	email: string,
	role: Role,
): Promise<void> {
	// Folded once, here, so the stored plaintext, the document id and the field
	// all describe the same address — and the one the provider will report.
	const address = normalizeEmail(email);

	return setDoc(inviteRef(home.id, emailHash(address)), {
		// The field has to equal the document id — the rules check it, so the
		// collection-group query cannot be pointed at somebody else's hash.
		emailHash: emailHash(address),
		email: address,
		role,
		// Denormalized: the invitee can read neither the home nor its members.
		homeName: home.name,
		invitedByName: displayLabel(inviter),
		createdAt: serverTimestamp(),
	});
}

export function revokeInvite(homeId: string, hash: string): Promise<void> {
	return deleteDoc(inviteRef(homeId, hash));
}

/**
 * Joining, in the only order that is safe.
 *
 * The membership write uses dotted field paths, so nothing that is not readable
 * has to be read first — the invitee cannot read the home document they are
 * about to add themselves to.
 *
 * It cannot be optimistic. `acceptsInvite()` is evaluated on the server, so a
 * queued write would show membership locally and then revert. The invite is
 * deleted only after the membership write has resolved; the reverse order would
 * consume the invitation and then fail to use it, with no way back in.
 *
 * Clearing the consumed invitation is deliberately *not* awaited into the
 * result. Membership landing is what joining means — if only the tidy-up fails,
 * telling somebody "could not join, the invitation may have been withdrawn"
 * while they are already a member of the home is the one wrong answer available.
 * A leftover invite is harmless: accepting it again is a no-op write of the
 * membership they already have.
 */
export async function acceptInvite(user: User, invite: Invite): Promise<void> {
	await updateDoc(homeRef(invite.homeId), {
		[`members.${user.uid}`]: invite.role,
		[`memberProfiles.${user.uid}`]: profileOf(user),
		[`memberEmailHashes.${user.uid}`]: emailHash(user.email ?? ""),
	});

	deleteDoc(inviteRef(invite.homeId, invite.emailHash)).catch((reason) => {
		console.warn("Could not clear the consumed invitation:", reason);
	});
}

export function declineInvite(invite: Invite): Promise<void> {
	return deleteDoc(inviteRef(invite.homeId, invite.emailHash));
}
