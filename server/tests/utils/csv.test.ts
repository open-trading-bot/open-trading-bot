import { describe, it, expect } from 'vitest';
import { csvCell, csvDateStamp, csvHeader, csvRow, csvAttachmentFilename } from '../../src/utils/csv.js';

describe('csvCell', () => {
  it('renders plain strings bare', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell('BTC/USDT')).toBe('BTC/USDT');
  });

  it('renders numbers bare', () => {
    expect(csvCell(42)).toBe('42');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(-5.25)).toBe('-5.25');
  });

  it('renders booleans as lowercase true/false', () => {
    expect(csvCell(true)).toBe('true');
    expect(csvCell(false)).toBe('false');
  });

  it('renders null and undefined as empty cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes cells containing commas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('ma, crossover')).toBe('"ma, crossover"');
  });

  it('quotes cells containing embedded quotes and doubles them up', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('"')).toBe('""""');
  });

  it('quotes cells containing newlines and carriage returns', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('quotes cells with mixed special chars and escapes them together', () => {
    expect(csvCell('a, "b", c')).toBe('"a, ""b"", c"');
  });

  it('leaves empty strings bare', () => {
    expect(csvCell('')).toBe('');
  });
});

describe('csvRow', () => {
  it('renders an object as a comma-separated row following the column order', () => {
    const row = csvRow({ a: 1, b: 'x', c: true }, ['a', 'b', 'c']);
    expect(row).toBe('1,x,true');
  });

  it('escapes cells inline', () => {
    const row = csvRow({ a: 'has,comma', b: 'has"quote' }, ['a', 'b']);
    expect(row).toBe('"has,comma","has""quote"');
  });

  it('produces empty cells for missing fields', () => {
    const row = csvRow({ a: 1 } as Record<string, unknown>, ['a', 'b', 'c']);
    expect(row).toBe('1,,');
  });
});

describe('csvHeader', () => {
  it('joins column names with commas', () => {
    expect(csvHeader(['id', 'symbol', 'pnl'])).toBe('id,symbol,pnl');
  });
});

describe('csvDateStamp', () => {
  it('returns YYYY-MM-DD in UTC', () => {
    const stamp = csvDateStamp();
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const now = new Date();
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    expect(stamp).toBe(expected);
  });
});

describe('csvAttachmentFilename', () => {
  it('combines prefix and date stamp with .csv extension', () => {
    const name = csvAttachmentFilename('trades');
    expect(name).toMatch(/^trades-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
