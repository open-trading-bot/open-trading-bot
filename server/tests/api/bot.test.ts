import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { createBotService } from '../../src/services/bot.js';
import { createBotController } from '../../src/controllers/bot.js';
import { createBotRouter } from '../../src/routes/bot.js';
import type { BotManager } from '../../src/engine/bot-manager.js';

function mockDb(): any {
  return { insertActionLog: vi.fn(), getUsers: vi.fn().mockReturnValue([{ id: 1, exchangeTestnet: true }]), getUserById: vi.fn().mockReturnValue({ id: 1, exchangeTestnet: true }) };
}

function mockBotManager(): BotManager {
  return {
    startBot: vi.fn(),
    stopBot: vi.fn(),
    killBot: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue('stopped'),
    getConfig: vi.fn().mockReturnValue({ mode: 'paper' }),
    updateConfig: vi.fn(),
    tick: vi.fn(),
    isRunning: vi.fn().mockReturnValue(false),
    getExchange: vi.fn().mockReturnValue({ fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 10000, totalEquity: 10000 }) }),
    stopAll: vi.fn(),
    ensureBot: vi.fn(),
    resetBot: vi.fn(),
  };
}

describe('Bot Routes', () => {
  let server: http.Server;
  let port: number;
  let manager: BotManager;

  beforeEach(async () => {
    manager = mockBotManager();
    const service = createBotService(manager, mockDb());
    const controller = createBotController(service);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 1, username: 'admin', role: 'admin' }; next(); });
    app.use('/api/bot', createBotRouter(controller));
    app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status || 400).json({ error: err.message }); });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); });
    });
  });
  afterEach(() => server?.close());

  it('GET /api/bot/status returns bot status', async () => {
    const res = await fetch(`http://localhost:${port}/api/bot/status`);
    const body = await res.json();
    expect(body.status).toBe('stopped');
    expect(body.testnet).toBe(true);
  });
  it('POST /api/bot/start starts the bot', async () => {
    const res = await fetch(`http://localhost:${port}/api/bot/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(manager.startBot).toHaveBeenCalledWith(1);
  });
  it('POST /api/bot/start rejects with zero total equity', async () => {
    (manager.getExchange as any).mockReturnValue({ fetchBalance: vi.fn().mockResolvedValue({ total: 0, free: 0, totalEquity: 0 }) });
    const res = await fetch(`http://localhost:${port}/api/bot/start`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('zero balance');
  });
  it('POST /api/bot/start rejects with dust total equity', async () => {
    (manager.getExchange as any).mockReturnValue({ fetchBalance: vi.fn().mockResolvedValue({ total: 0.00000018, free: 0.00000018, totalEquity: 0.00000018 }) });
    const res = await fetch(`http://localhost:${port}/api/bot/start`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('zero balance');
  });
  it('POST /api/bot/start allows restart when cash is negative but equity is positive', async () => {
    // Regression for stuck-user recovery: a paper user with negative cash but
    // positions worth real value should still be able to start the bot so it
    // can manage those positions. The per-tick risk check still blocks new
    // buys until cash recovers.
    (manager.getExchange as any).mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: -50, free: -50, totalEquity: 450 }),
    });
    const res = await fetch(`http://localhost:${port}/api/bot/start`, { method: 'POST' });
    expect(res.status).toBe(200);
  });
  it('POST /api/bot/stop stops the bot', async () => {
    const res = await fetch(`http://localhost:${port}/api/bot/stop`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(manager.stopBot).toHaveBeenCalledWith(1);
  });
  it('POST /api/bot/kill activates kill switch', async () => {
    const res = await fetch(`http://localhost:${port}/api/bot/kill`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(manager.killBot).toHaveBeenCalledWith(1, 'user');
  });
});
