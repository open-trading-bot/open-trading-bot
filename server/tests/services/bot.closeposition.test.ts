import { describe, it, expect, vi } from 'vitest';
import { createBotService } from '../../src/services/bot.js';
import { BOT_ACTIONS, ACTION_SOURCES } from '../../src/utils/constants.js';
import type { BotManager } from '../../src/engine/bot-manager.js';
import type { Db } from '../../src/db/index.js';

function mockDb(): Db {
  return { insertActionLog: vi.fn() } as any;
}

function mockBotManager(overrides: Partial<BotManager> = {}): BotManager {
  return {
    closePosition: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

describe('BotService — closePosition', () => {
  it('happy path: calls botManager.closePosition and logs action, returns { ok: true }', async () => {
    const db = mockDb();
    const manager = mockBotManager();
    const service = createBotService(manager, db);

    const result = await service.closePosition(42, 'pos-9');

    expect(manager.closePosition).toHaveBeenCalledWith(42, 'pos-9');
    expect(db.insertActionLog).toHaveBeenCalledWith(42, BOT_ACTIONS.CLOSE_POSITION, 42, ACTION_SOURCES.SELF);
    expect(result).toEqual({ ok: true });
  });

  it('failure path: does NOT call insertActionLog when botManager.closePosition rejects', async () => {
    const db = mockDb();
    const manager = mockBotManager({
      closePosition: vi.fn().mockRejectedValue(new Error('Position pos-9 not found')),
    });
    const service = createBotService(manager, db);

    await expect(service.closePosition(42, 'pos-9')).rejects.toThrow('pos-9 not found');
    expect(db.insertActionLog).not.toHaveBeenCalled();
  });
});
