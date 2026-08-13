/**
 * Native has no redirect leg — `expo-auth-session` hands the ID token straight
 * back to `signInWithGoogle()`, and `firebase/auth`'s React Native entry point
 * does not export `getRedirectResult` at all. Resolving immediately keeps
 * `AuthContext` free of a platform branch.
 *
 * See `redirect.web.ts` for the real implementation.
 */
export async function consumeRedirectResult(): Promise<void> {}
