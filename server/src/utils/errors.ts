/**
 * An error whose message is safe to show to the client. The API error handler
 * returns the message and status of a PublicError. For all other errors it
 * returns a generic message, so internal details (SQL, exchange responses,
 * stack text) stay in the server log.
 */
export class PublicError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'PublicError';
  }
}

/** True for a better-sqlite3 UNIQUE or PRIMARY KEY constraint error. */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE';
}
