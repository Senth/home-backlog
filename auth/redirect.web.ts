import { getRedirectResult } from "firebase/auth";
import { auth } from "@/config/firebase";

/**
 * Settles the pending `signInWithRedirect`, if the page was loaded as the
 * return leg of one.
 *
 * Awaiting this is what keeps the login screen from flashing on the way back
 * from Google: `onAuthStateChanged` can report "no user" before the redirect
 * credential has been exchanged, so the app is only allowed to decide where to
 * route once *both* have settled.
 *
 * Resolves to nothing on an ordinary page load, and on a cancel at Google's own
 * screen — there is no result and no error, and the user simply sees login
 * again. It rejects only on a real failure, which the caller maps through
 * `mapAuthError()`.
 */
export async function consumeRedirectResult(): Promise<void> {
	await getRedirectResult(auth);
}
