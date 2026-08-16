import express, {
	type NextFunction,
	type Request,
	type Response,
	Router,
} from "express";
import { requireKey } from "./auth.js";
import { ApiError, sendError } from "./errors.js";
import { apiVersion } from "./version.js";

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
 * spec's *Out of scope*), so this and the 500-node bulk cap are the only
 * payload limits — a runaway script is one person's own against their own free
 * tier, and per-key counters would be a Firestore write on every request.
 */
const maxBodyBytes = "1mb";

export const v1 = Router();

/**
 * The one unauthenticated route, and it is above `requireKey` for that reason.
 * A caller with a token that does not work needs somewhere to check that the
 * deployment is up and which contract version it is serving.
 */
v1.get("/health", (_request: Request, response: Response) => {
	response.json({ status: "ok", version: apiVersion });
});

// Everything below this line needs a valid API key.
v1.use(requireKey);

export const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: maxBodyBytes }));

app.use((_request: Request, response: Response, next: NextFunction) => {
	response.setHeader("X-Api-Version", apiVersion);
	next();
});

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
 * Express hands a body that is not JSON, or one over the size limit, to this
 * same channel — so a malformed payload answers in the API's own envelope
 * rather than in Express's HTML error page. Anything that is not an `ApiError`
 * is a bug in a handler: it is logged whole and answered with a bare 500, which
 * says nothing about the stack it came from.
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
