/**
 * The contract version, sent as `X-Api-Version` on every response.
 *
 * An agent fetches `GET /v1/skill.md` from the deployment it is talking to
 * rather than trusting a copy vendored months ago, and this header is what lets
 * it notice drift without fetching anything at all. It moves when the *contract*
 * moves — a new verb, a new field, a changed status code — not when a handler is
 * refactored.
 */
export const apiVersion = "1.1.0";
