import type { Response } from 'express';
import logger from './logger.js';

/** Bytes collected before one res.write. */
export const EXPORT_FLUSH_BYTES = 64 * 1024;

type StreamTarget = Pick<Response, 'write' | 'end' | 'once' | 'removeListener' | 'destroy'> & {
  destroyed?: boolean;
  writableEnded?: boolean;
};

function clientGone(res: StreamTarget): boolean {
  return !!res.destroyed;
}

/** Resolves on 'drain'. Resolves false if the client closes first. */
function waitForDrain(res: StreamTarget): Promise<boolean> {
  return new Promise((resolve) => {
    const onDrain = () => { cleanup(); resolve(true); };
    const onClose = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      res.removeListener('drain', onDrain);
      res.removeListener('close', onClose);
    };
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
}

const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

/**
 * Writes the pieces to the response in chunks of about EXPORT_FLUSH_BYTES.
 * After each chunk it waits for 'drain' if the socket buffer is full, and it
 * gives the event loop a turn. It stops when the client disconnects.
 *
 * The source must not hold an open SQLite cursor between pieces:
 * better-sqlite3 rejects every other statement on the connection while a
 * cursor is open, and the tick loop writes to the same connection.
 */
export async function streamPieces(res: StreamTarget, pieces: Iterable<string>): Promise<void> {
  let buffer = '';
  try {
    for (const piece of pieces) {
      buffer += piece;
      if (buffer.length < EXPORT_FLUSH_BYTES) continue;
      if (!(await flush(res, buffer))) return;
      buffer = '';
    }
    if (clientGone(res)) return;
    res.end(buffer);
  } catch (err) {
    logger.error(`[export] stream failed: ${(err as Error)?.stack ?? err}`);
    res.destroy(err as Error);
  }
}

async function flush(res: StreamTarget, chunk: string): Promise<boolean> {
  if (clientGone(res)) return false;
  const ok = res.write(chunk);
  if (!ok && !(await waitForDrain(res))) return false;
  await yieldToEventLoop();
  return !clientGone(res);
}

/** JSON array text, byte for byte the same as JSON.stringify(rows). */
export function* jsonArrayPieces(rows: Iterable<unknown>): Generator<string> {
  yield '[';
  let first = true;
  for (const row of rows) {
    yield first ? JSON.stringify(row) : ',' + JSON.stringify(row);
    first = false;
  }
  yield ']';
}
