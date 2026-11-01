import { describe, it, expect } from 'vitest';
import DailyRotateFile from 'winston-daily-rotate-file';
import logger, { LOG_RETENTION } from '../../src/utils/logger.js';

describe('logger file retention', () => {
  const files = logger.transports.filter((t) => t instanceof DailyRotateFile) as unknown as { options: { maxFiles: unknown } }[];

  it('has rotating file transports', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('caps every file transport by file count, not by age', () => {
    for (const t of files) {
      expect(typeof t.options.maxFiles).toBe('number');
      expect(t.options.maxFiles).toBeLessThanOrEqual(LOG_RETENTION.MAX_FILES);
    }
  });

  it('keeps the combined log at or below 1 GB on disk', () => {
    expect(LOG_RETENTION.MAX_FILES * LOG_RETENTION.COMBINED_MAX_SIZE_MB).toBeLessThanOrEqual(1024);
  });
});
