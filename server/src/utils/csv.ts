export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function csvDateStamp(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function csvRow(obj: object, columns: readonly string[]): string {
  const rec = obj as Record<string, unknown>;
  return columns.map((c) => csvCell(rec[c])).join(',');
}

export function csvHeader(columns: readonly string[]): string {
  return columns.join(',');
}

export function csvAttachmentFilename(prefix: string): string {
  return `${prefix}-${csvDateStamp()}.csv`;
}
