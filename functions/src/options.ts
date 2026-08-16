/**
 * The region every function in this package is pinned to, **explicitly, one by
 * one**.
 *
 * `setGlobalOptions` was the obvious way to say this once and is a trap here:
 * this package is ESM, and an ES module's imports are evaluated before its own
 * body runs — so `export { createApiKey } from "./create-api-key.js"` in
 * `index.ts` defines that function *before* any `setGlobalOptions` call in the
 * same file, and it silently deploys to `us-central1`. It fails as a working
 * deployment in the wrong place rather than as an error.
 *
 * `europe-west1` is not a preference. Firestore and Storage are both there and
 * cannot be moved without recreating the project, so a function anywhere else
 * pays a cross-region round trip on every document read — on a path whose whole
 * point is a bulk subtree write. Hosting's `/api/**` rewrite names the same
 * region, and the two have to agree.
 */
export const region = "europe-west1";
