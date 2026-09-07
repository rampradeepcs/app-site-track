/**
 * Postgres refusals, said in HTTP.
 *
 * Row-level security is the authorisation layer here, and it speaks SQLSTATE.
 * Mapping those codes rather than inventing a parallel set of checks in
 * JavaScript is the whole point of the design: there is one rule, in one
 * place, and this translates its answer.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

interface PgError {
  code?: string;
  message?: string;
  detail?: string;
  constraint?: string;
  table?: string;
}

const BY_CODE: Record<string, { status: number; message: string }> = {
  // Refused by a policy or an explicit raise. Not "you are unauthenticated" —
  // the caller is known, and is not allowed to do this.
  "42501": { status: 403, message: "You do not have access to that." },
  "28000": { status: 401, message: "Sign in first." },
  "23505": { status: 409, message: "That already exists." },
  "23503": { status: 409, message: "That refers to something which does not exist." },
  "23502": { status: 400, message: "A required field is missing." },
  "23514": { status: 400, message: "That value is not allowed." },
  "22P02": { status: 400, message: "A value is the wrong type." },
  "22023": { status: 400, message: "A value is invalid." },
  "42703": { status: 400, message: "Unknown field." },
  "42P01": { status: 404, message: "No such resource." },
  "57014": { status: 504, message: "That query took too long." },
};

export function toHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  const pg = e as PgError;
  const known = pg?.code ? BY_CODE[pg.code] : undefined;
  if (known) {
    // The database's own message is the useful half — a CHECK constraint
    // named in English says more than "that value is not allowed".
    return new HttpError(known.status, known.message, pg.message ?? pg.detail);
  }
  return new HttpError(500, "Something went wrong.", pg?.message);
}
