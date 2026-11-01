// In-memory blocklist of revoked user IDs with expiry
// When a user is disconnected, their ID is added here
// Auth middleware checks this before accepting JWT tokens

import logger from './logger.js';

const blocklist = new Map<number, number>(); // userId → blockedAt timestamp

export function blockUser(userId: number): void {
  blocklist.set(userId, Date.now());
  logger.info(`[auth] User ${userId} blocked — sessions revoked`);
}

export function unblockUser(userId: number): void {
  if (blocklist.has(userId)) {
    blocklist.delete(userId);
    logger.info(`[auth] User ${userId} unblocked`);
  }
}

export function isBlocked(userId: number): boolean {
  return blocklist.has(userId);
}

export function getBlockedUsers(): Map<number, number> {
  return blocklist;
}
