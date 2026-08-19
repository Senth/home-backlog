import type { NextFunction, Request, Response } from "express";

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
