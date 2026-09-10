// Express 4 does not catch rejected promises from handlers, so every async
// route is wrapped in `ah` and errors land in one place (app.js error handler).

export class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (code = 'bad_request', extra) => new HttpError(400, code, extra);
export const unauthorized = (code = 'unauthorized') => new HttpError(401, code);
export const forbidden = (code = 'forbidden') => new HttpError(403, code);
/**
 * A row that does not exist and a row you do not own return the same thing, so
 * the API never reveals which ids are real.
 */
export const notFound = (code = 'not_found') => new HttpError(404, code);
export const conflict = (code = 'conflict', extra) => new HttpError(409, code, extra);

/** async handler wrapper */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
