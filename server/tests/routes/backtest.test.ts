import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { createBacktestRouter } from '../../src/routes/backtest.js';

describe('Backtest Routes', () => {
  let server: http.Server;
  let port: number;
  let backtestController: { run: any };

  beforeEach(async () => {
    backtestController = {
      run: vi.fn((req: any, res: any) => res.json({ trades: [] })),
    };
    const app = express();
    app.use('/', createBacktestRouter(backtestController));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); });
    });
  });
  afterEach(() => server?.close());

  it('GET / calls backtestController.run', async () => {
    const res = await fetch(`http://localhost:${port}/?symbol=BTC/USDT&strategy=rsi&interval=5m`);
    expect(res.status).toBe(200);
    expect(backtestController.run).toHaveBeenCalled();
  });

  it('POST / returns 404 (method not allowed)', async () => {
    const res = await fetch(`http://localhost:${port}/`, { method: 'POST' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
