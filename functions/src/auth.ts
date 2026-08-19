import type { NextFunction, Request, Response } from "express";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { hashesMatch, parseToken, secretHash } from "./api-key.js";
import { ApiError } from "./errors.js";
import {
	apiClientsCollection,
	apiKeysCollection,
	db,
	homesCollection,
	usersCollection,
} from "./firestore.js";
import { isMember } from "./validate.js";

/**
 * Turning a bearer token into a person, and a person into access to a home.
 *
 * Verification is **one document read**: the token carries the uid and the key
 * id, so it is a direct `get()` on `users/{uid}/apiKeys/{keyId}` — no query, no
 * index, no collection-group lookup on the hot path — and the secret is compared
 * against the stored hash in constant time.
 *
 * There is no grant to check after that. A key is its owner, so it reaches every
 * home that person is a member of and gains a new one the moment they join it.
 * The only authorization question left is membership, which is the same question
 * `isMember()` in `firestore.rules` asks.
 */

/** Who is calling, once the token has been verified. */
export interface ApiCaller {
	uid: string;
	keyId: string;
	/** The key's name, denormalized into every `apiClients` row it writes. */
	keyName: string;
	keyRef: DocumentReference;
}

/** A home the caller is a member of, with the facts a handler needs. */
export interface HomeAccess {
	homeId: string;
	/** The caller's display name in this home, or their uid if they have none. */
	callerName: string;
}

/**
 * How stale `lastUsedAt` is allowed to get.
 *
 * Written at most once a minute, per key and per home. It is a *relative* time
 * on two screens — "3 h ago" — so a minute of staleness is invisible, and the
 * alternative is a document write on every single request, which would make an
 * agent's read loop cost more in writes than in reads.
 */
const lastUsedThrottleMs = 60_000;

function bearerToken(request: Request): string {
	const header = request.get("authorization") ?? "";
	const [scheme, ...rest] = header.split(" ");
	if (scheme.toLowerCase() !== "bearer" || rest.length === 0) return "";
	return rest.join(" ").trim();
}

function unauthorized(): ApiError {
	// Deliberately one message for every failure — no prefix, wrong shape, no
	// such key, wrong secret. Telling a caller *which* check failed tells them
	// whether a uid or a key id exists, one probe at a time.
	return new ApiError(
		401,
		"invalid_token",
		"Send a valid API key as `Authorization: Bearer hb_...`.",
	);
}

function isStale(lastUsedAt: unknown, now: number): boolean {
	if (lastUsedAt == null) return true;
	const at = lastUsedAt as Timestamp;
	if (typeof at.toMillis !== "function") return true;
	return now - at.toMillis() > lastUsedThrottleMs;
}

/**
 * Verify a token, or throw the one 401 every failure shares.
 *
 * The `lastUsedAt` touch is deliberately **not awaited**. It is bookkeeping for
 * a screen, and making every API request wait on a second Firestore write to
 * update a relative timestamp would be paying latency for nothing. A failure is
 * logged and the request proceeds.
 */
export async function authenticate(request: Request): Promise<ApiCaller> {
	const token = parseToken(bearerToken(request));
	if (token === null) throw unauthorized();

	const keyRef = db
		.collection(usersCollection)
		.doc(token.uid)
		.collection(apiKeysCollection)
		.doc(token.keyId);
	const snapshot = await keyRef.get();
	if (!snapshot.exists) throw unauthorized();

	const stored = snapshot.get("secretHash");
	if (typeof stored !== "string") throw unauthorized();
	if (!hashesMatch(secretHash(token.secret), stored)) throw unauthorized();

	const now = Date.now();
	if (isStale(snapshot.get("lastUsedAt"), now)) {
		keyRef
			.update({ lastUsedAt: FieldValue.serverTimestamp() })
			.catch((reason) => {
				console.error("Could not record when a key was last used:", reason);
			});
	}

	const name = snapshot.get("name");
	return {
		uid: token.uid,
		keyId: token.keyId,
		keyName: typeof name === "string" ? name : "",
		keyRef,
	};
}

/**
 * A home the caller may act in, or a 404.
 *
 * A non-member gets the same answer as a home that does not exist, on purpose:
 * distinguishing them would turn a guessed id into a test for whether a
 * household exists.
 *
 * This does **not** record anything. `recordWrite()` below does, and only the
 * write verbs call it: the manage screen answers "what has written here", and a
 * key that only ever reads has written nothing. A row for it would say an
 * automation touched a household's work when it only looked at it.
 */
export async function homeAccess(
	caller: ApiCaller,
	homeId: string,
): Promise<HomeAccess> {
	const snapshot = await db.collection(homesCollection).doc(homeId).get();
	const notFound = new ApiError(
		404,
		"home_not_found",
		`No home ${homeId}, or you are not a member of it.`,
	);
	if (!snapshot.exists) throw notFound;
	if (!isMember(snapshot.get("members"), caller.uid)) throw notFound;

	const profile = snapshot.get(`memberProfiles.${caller.uid}`) as
		| { displayName?: unknown }
		| undefined;
	const callerName =
		typeof profile?.displayName === "string" && profile.displayName.length > 0
			? profile.displayName
			: caller.uid;

	return { homeId, callerName };
}

/**
 * Record that this key has written into this home.
 *
 * Called by the write verbs only. Derived from writes rather than from grants,
 * because there are no grants — a key reaches every home its owner is a member
 * of, so "who could write here" is just "every member", and what a household
 * actually wants to know is what *has* written here.
 *
 * **Awaited**, unlike the `lastUsedAt` touch above. That one starts before the
 * handler does its work and has the whole request to finish in; this one runs
 * after the commit, with the response on the next line — and a Cloud Run
 * instance is CPU-throttled the moment a response returns, so a promise left
 * running there may simply never complete. The household would then read "No
 * automation has written here" about a home an agent writes into every night.
 *
 * Throttled the same way `lastUsedAt` is, so a busy agent does not write this
 * document once per request, and a failure is logged rather than thrown: the
 * work the caller asked for is already committed, and losing the row is not
 * worth turning a 201 into a 500.
 */
export async function recordWrite(
	caller: ApiCaller,
	home: HomeAccess,
): Promise<void> {
	await touchApiClient(caller, home.homeId, home.callerName);
}

async function touchApiClient(
	caller: ApiCaller,
	homeId: string,
	callerName: string,
): Promise<void> {
	const ref = db
		.collection(homesCollection)
		.doc(homeId)
		.collection(apiClientsCollection)
		.doc(caller.keyId);

	try {
		const existing = await ref.get();
		if (existing.exists && !isStale(existing.get("lastUsedAt"), Date.now())) {
			return;
		}
		await ref.set(
			{
				// Duplicated from the document id so the delete trigger can find every
				// home's row in one collection-group query.
				keyId: caller.keyId,
				ownerUid: caller.uid,
				// Denormalized: the manage screen already has `memberProfiles`, but a
				// key's owner may have left the home since it last wrote here, and a
				// row that says "somebody" is worse than no row.
				ownerName: callerName,
				name: caller.keyName,
				lastUsedAt: FieldValue.serverTimestamp(),
			},
			{ merge: true },
		);
	} catch (reason) {
		console.error("Could not record an automation's access to a home:", reason);
	}
}

/**
 * Express middleware: every route past this one has a verified caller.
 *
 * Stored on `response.locals` rather than bolted onto the request, so that
 * `caller()` below can assert it rather than every handler re-checking a
 * possibly-undefined field.
 */
export function requireKey(
	request: Request,
	response: Response,
	next: NextFunction,
): void {
	authenticate(request)
		.then((verified) => {
			response.locals.caller = verified;
			next();
		})
		.catch(next);
}

export function caller(response: Response): ApiCaller {
	const verified = response.locals.caller as ApiCaller | undefined;
	if (!verified) {
		// Only reachable by mounting a route above `requireKey`, which is a wiring
		// bug rather than a request the caller can make.
		throw new ApiError(500, "internal", "Something went wrong on our side.");
	}
	return verified;
}
