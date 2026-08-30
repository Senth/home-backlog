import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errors.js";

/**
 * An async route, wrapped so that a rejection reaches the error middleware.
 *
 * Express 4 does not await a handler, so an `async` route that throws leaves the
 * request hanging until it times out — with no response, no log and nothing in
 * the envelope. Every handler in this package is async, so every one of them
 * goes through this.
 */
export function handle(
	route: (request: Request, response: Response) => Promise<void>,
) {
	return (request: Request, response: Response, next: NextFunction): void => {
		route(request, response).catch(next);
	};
}

/** A path parameter, or a 400 rather than a request against `undefined`. */
export function param(request: Request, name: string): string {
	const value = request.params[name];
	if (typeof value !== "string" || value.length === 0) {
		throw new ApiError(400, "invalid_path", `Missing ${name} in the path.`);
	}
	return value;
}
