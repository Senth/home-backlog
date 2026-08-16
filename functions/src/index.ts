import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { app } from "./app";

/**
 * The project's first and only Cloud Functions deployment.
 *
 * `europe-west1` is not a preference: Firestore and Storage are both there and
 * cannot be moved without recreating the project, so a function anywhere else
 * pays a cross-region round trip on every document read — on a path whose whole
 * point is a bulk subtree write. Hosting's `/api/**` rewrite names the same
 * region, and the two have to agree.
 */
setGlobalOptions({ region: "europe-west1" });

/** The REST API. Everything under `/api/v1` on the app's own origin. */
export const api = onRequest(app);

export { createApiKey } from "./create-api-key";
export { onApiKeyDeleted } from "./on-api-key-deleted";
