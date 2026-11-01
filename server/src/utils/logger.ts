import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// Retention is capped by file count, not by age. A file rotates daily or at
// its size limit, whichever comes first, so an age limit alone does not cap
// disk use. Worst case on disk: MAX_FILES x size per log.
export const LOG_RETENTION = {
  MAX_FILES: 20,
  COMBINED_MAX_SIZE_MB: 50,
  ERROR_MAX_SIZE_MB: 20,
} as const;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`),
  ),
  transports: [
    new winston.transports.Console(),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      level: 'error',
      datePattern: 'YYYY-MM-DD',
      maxFiles: LOG_RETENTION.MAX_FILES,
      maxSize: `${LOG_RETENTION.ERROR_MAX_SIZE_MB}m`,
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: LOG_RETENTION.MAX_FILES,
      maxSize: `${LOG_RETENTION.COMBINED_MAX_SIZE_MB}m`,
    }),
  ],
});

export default logger;
