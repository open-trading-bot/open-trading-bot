// Aligned plain-text table export. Alignment needs the width of each column
// before the first row is written, so the export makes two passes:
// textTableWidths reads the rows once for the widths, then textTablePieces
// reads them again and renders each line.

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v);
}

const WIDTH_PASS_YIELD_ROWS = 2000;

function widenFor(widths: number[], row: object, columns: readonly string[]): void {
  const rec = row as Record<string, unknown>;
  for (let i = 0; i < columns.length; i++) {
    const len = cell(rec[columns[i]]).length;
    if (len > widths[i]) widths[i] = len;
  }
}

export function textTableWidths(rows: Iterable<object>, columns: readonly string[]): number[] {
  const widths = columns.map((c) => c.length);
  for (const r of rows) widenFor(widths, r, columns);
  return widths;
}

/** Same as textTableWidths, but gives the event loop a turn every 2000 rows. */
export async function textTableWidthsAsync(rows: Iterable<object>, columns: readonly string[]): Promise<number[]> {
  const widths = columns.map((c) => c.length);
  let n = 0;
  for (const r of rows) {
    widenFor(widths, r, columns);
    if (++n % WIDTH_PASS_YIELD_ROWS === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return widths;
}

/**
 * Lines of the table: a header row, a dash row, then one row per record,
 * each column padded to its width and separated by two spaces. A cell wider than its column (a row added between the two passes) is
 * written without padding, not cut.
 */
export function* textTablePieces(rows: Iterable<object>, columns: readonly string[], widths: readonly number[]): Generator<string> {
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
  const renderRow = (row: string[]) => row.map((v, i) => pad(v, widths[i])).join('  ');
  yield renderRow(columns.map((c) => c.toUpperCase())) + '\n';
  yield widths.map((w) => '-'.repeat(w)).join('  ') + '\n';
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    yield renderRow(columns.map((c) => cell(rec[c]))) + '\n';
  }
}

export function textAttachmentFilename(prefix: string): string {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${stamp}.txt`;
}
