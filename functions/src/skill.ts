import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Request, Response, Router } from "express";
import { ApiError, sendError } from "./errors.js";
import { apiVersion } from "./version.js";

/**
 * The contract, served by the deployment that implements it.
 *
 * An agent fetches this rather than trusting a copy vendored months ago, and
 * `X-Api-Version` on every response lets it notice drift without fetching
 * anything at all.
 *
 * Unauthenticated, like `/health` and for the same reason: somebody wiring an
 * agent up needs to be able to read the contract *before* the key works, and
 * there is nothing in here that is not already public — it describes the API,
 * not any household's data.
 */

/**
 * `SKILL.md` sits beside the compiled `lib/`, at the root of the uploaded
 * package. `import.meta.url` is what makes that path independent of the working
 * directory a Cloud Function happens to run in.
 */
const skillPath = fileURLToPath(new URL("../SKILL.md", import.meta.url));

let cached: string | null = null;

/**
 * The frontmatter line the deployment stamps on the way out.
 *
 * Anchored to the start of a line and replaced once, so it hits the
 * frontmatter's `api-version` and nothing that resembles it further down.
 */
const versionLine = /^api-version:.*$/m;

/**
 * Read once per instance, on first request rather than at module load.
 *
 * At load, a missing or unreadable file would throw during startup and take the
 * **whole API** down — every verb, not just this one. Lazily, the failure is a
 * 500 on the one route that needs it.
 *
 * The `api-version` in the frontmatter is rewritten from `version.ts` rather
 * than trusted from the file. An agent decides whether its own copy is stale by
 * comparing that value against `X-Api-Version`, so the served copy stating a
 * version the deployment is not running would be worse than stating none: it
 * would tell a stale reader it was current. Checked in, the two are kept in step
 * by `yarn invariants`; served, they cannot drift at all.
 */
function skillMarkdown(): string {
	if (cached === null)
		cached = readFileSync(skillPath, "utf8").replace(
			versionLine,
			`api-version: ${apiVersion}`,
		);
	return cached;
}

export function registerSkillRoute(v1: Router): void {
	v1.get("/skill.md", (_request: Request, response: Response) => {
		try {
			response.type("text/markdown; charset=utf-8").send(skillMarkdown());
		} catch (reason) {
			console.error("Could not read SKILL.md:", reason);
			sendError(
				response,
				new ApiError(
					500,
					"internal",
					"The contract could not be read. This is a deployment fault, not your request.",
				),
			);
		}
	});
}
