import express, {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { requireKey } from "./auth.js";
import { registerBulkRoute } from "./bulk-route.js";
import { registerCardRoutes } from "./cards.js";
import { ApiError, sendError } from "./errors.js";
import { registerLabelRoutes } from "./labels.js";
import { registerLocationRoutes } from "./locations.js";
import { registerRoutes } from "./routes.js";
import { registerSkillRoute } from "./skill.js";
import { apiVersion } from "./version.js";
import { registerWriteRoutes } from "./writes.js";

/**
 * The REST surface, as one Express app behind one Cloud Function.
 *
 * One function rather than one per verb: they share key verification, the
 * membership load and the error envelope, and a cold start paid once is a cold
 * start paid once. Hosting rewrites `/api/**` here, so the path the handler sees
 * is the *original* one — `/api/v1/health`, prefix and all — while a direct call
 * to the function URL or to the emulator arrives as `/v1/health`. The router is
 * therefore mounted under both, and nothing downstream has to care which door it
 * came through.
 */

/**
 * The request body ceiling. There is deliberately no rate limiting (see the
 * spec's *Out of scope*), so this and the 498-node bulk cap are the only
 * payload limits — a runaway script is one person's own against their own free
 * tier, and per-key counters would be a Firestore write on every request.
 */
const maxBodyBytes = 1024 * 1024;

export const v1 = Router();

/**
 * The one unauthenticated route, and it is above `requireKey` for that reason.
 * A caller with a token that does not work needs somewhere to check that the
 * deployment is up and which contract version it is serving.
 */
v1.get("/health", (_request: Request, response: Response) => {
	response.json({ status: "ok", version: apiVersion });
});

// The contract itself, also unauthenticated: somebody wiring an agent up has to
// be able to read it before the key works.
registerSkillRoute(v1);

// Everything below this line needs a valid API key.
v1.use(requireKey);
registerRoutes(v1);
registerWriteRoutes(v1);
registerLocationRoutes(v1);
registerLabelRoutes(v1);
registerCardRoutes(v1);
registerBulkRoute(v1);

export const app = express();

app.disable("x-powered-by");

// Above the body parser, deliberately: a failure inside `express.json()` jumps
// straight to the error handler, and a header set after it would never be set.
//
// One case is outside this app's reach and is documented rather than papered
// over. `onRequest` wraps the app in the Functions framework's *own* express
// app, which parses the body first — so a payload that is not valid JSON is
// rejected out there, with the framework's plain HTML 400 and no
// `X-Api-Version`. Nothing mounted in here runs for it. `SKILL.md` says so.
app.use((_request: Request, response: Response, next: NextFunction) => {
	response.setHeader("X-Api-Version", apiVersion);
	next();
});

/**
 * The body ceiling, enforced **here** rather than by `express.json()`.
 *
 * `onRequest` wraps this app in the Functions framework's own express app, which
 * parses the body first and sets `_body` — so the `limit` passed to
 * `express.json()` below is never consulted and enforces nothing at all. The
 * framework has already buffered the payload by the time anything here runs, and
 * `rawBody` is what it buffered: an authority the caller cannot misreport, where
 * `Content-Length` is a header a client writes.
 */
app.use((request: Request, response: Response, next: NextFunction) => {
	const buffered = (request as { rawBody?: { length?: number } }).rawBody;
	const declared = Number(request.get("content-length") ?? Number.NaN);
	const size = buffered?.length ?? (Number.isNaN(declared) ? 0 : declared);

	if (size > maxBodyBytes) {
		sendError(
			response,
			new ApiError(
				413,
				"body_too_large",
				`The request body is ${size} bytes; the limit is ${maxBodyBytes}.`,
			),
		);
		return;
	}
	next();
});

// Kept even though the framework has usually parsed the body already: it is a
// no-op when it has, and the correct thing when it has not.
app.use(express.json({ limit: maxBodyBytes }));

app.use("/api/v1", v1);
app.use("/v1", v1);

app.use((request: Request, response: Response) => {
	sendError(
		response,
		new ApiError(
			404,
			"not_found",
			`No such endpoint: ${request.method} ${request.path}`,
		),
	);
});

/**
 * The one place a failure becomes a response.
 *
 * Anything that is not an `ApiError` is a bug in a handler: it is logged whole
 * and answered with a bare 500, which says nothing about the stack it came
 * from. The `400` branch catches a body `express.json()` itself rejects, which
 * in this runtime is nothing — the framework parses first, and plain malformed
 * JSON never reaches this app at all. It stays because the day the framework
 * stops pre-parsing, an unhandled parse error is an HTML page in an API.
 */
app.use(
	(
		error: unknown,
		_request: Request,
		response: Response,
		_next: NextFunction,
	) => {
		if (error instanceof ApiError) {
			sendError(response, error);
			return;
		}

		const status = (error as { status?: number } | null)?.status;
		if (status === 400) {
			sendError(
				response,
				new ApiError(
					400,
					"invalid_json",
					"The request body is not valid JSON.",
				),
			);
			return;
		}
		if (status === 413) {
			sendError(
				response,
				new ApiError(
					413,
					"body_too_large",
					`The request body is larger than ${maxBodyBytes}.`,
				),
			);
			return;
		}

		console.error("Unhandled API failure:", error);
		sendError(
			response,
			new ApiError(500, "internal", "Something went wrong on our side."),
		);
	},
);
