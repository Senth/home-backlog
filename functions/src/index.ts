import { onRequest } from "firebase-functions/v2/https";
import { app } from "./app.js";
import { region } from "./options.js";

/**
 * The project's first and only Cloud Functions deployment.
 *
 * Every function names its own region — see `options.ts` for why a global option
 * cannot do it in an ES module.
 */

/** The REST API. Everything under `/api/v1` on the app's own origin. */
export const api = onRequest({ region }, app);

export { createApiKey } from "./create-api-key.js";
export { onApiKeyDeleted } from "./on-api-key-deleted.js";
export { onLocationWritten } from "./on-location-written.js";
export { onObjectDeleted, onObjectFinalized } from "./on-object-written.js";
