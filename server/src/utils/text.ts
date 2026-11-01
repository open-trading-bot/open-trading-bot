// Aligned plain-text table export. Unlike CSV, alignment needs full width
// knowledge before writing any row, so we build the whole table in memory.
// For the dataset sizes this app handles (user's own trades/positions), this
// is fine; if volumes grow, switch to a two-pass streaming approach.

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v);
}

export function buildTextTable(rows: readonly object[], columns: readonly string[]): string {
  const headers = columns.map((c) => c.toUpperCase());
  const body: string[][] = rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return columns.map((c) => cell(rec[c]));
  });

  const widths = columns.map((_, i) =>
    Math.max(headers[i].length, ...body.map((r) => r[i].length)),
  );

  const pad = (s: string, w: number) => s + ' '.repeat(w - s.length);
  const renderRow = (row: string[]) => row.map((v, i) => pad(v, widths[i])).join('  ');

  const lines: string[] = [];
  lines.push(renderRow(headers));
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of body) lines.push(renderRow(r));
  return lines.join('\n') + '\n';
}

export function textAttachmentFilename(prefix: string): string {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${stamp}.txt`;
}
