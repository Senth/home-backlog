import type { Response } from "express";

/**
 * One error shape for the whole API.
 *
 * Every failure is `{ error: { code, message } }`, with `code` a stable
 * machine-readable slug and `message` English prose. The messages are read by
 * agents and by developers and are deliberately **not translated** — nothing in
 * here is ever rendered in the app, and a Swedish `status_not_in_columns` would
 * be a string an agent author has to guess at.
 *
 * `details` carries the per-index errors a bulk create returns. A bulk request
 * is validated whole before anything is written, so the caller gets every
 * failure at once and can fix and resend rather than discovering them one round
 * trip at a time.
 */
export interface ApiErrorDetail {
	/** Position in the request's `nodes` array, for a bulk payload. */
	index?: number;
	/** The offending field, where one field is to blame. */
	field?: string;
	code: string;
	message: string;
}

export interface ApiErrorBody {
	error: {
		code: string;
		message: string;
		details?: ApiErrorDetail[];
	};
}

/**
 * A failure a handler can throw from anywhere and have rendered once.
 *
 * Thrown rather than returned so that a check buried three calls deep — "this
 * node is in another home", "that parent does not exist" — does not have to
 * thread a result type back out through every caller.
 */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?: ApiErrorDetail[],
	) {
		super(message);
		this.name = "ApiError";
	}
}

export function errorBody(error: ApiError): ApiErrorBody {
	return {
		error: {
			code: error.code,
			message: error.message,
			...(error.details ? { details: error.details } : {}),
		},
	};
}

export function sendError(response: Response, error: ApiError): void {
	response.status(error.status).json(errorBody(error));
}
