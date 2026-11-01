import { describe, it, expect, vi } from 'vitest';
import { createBacktestController } from '../../src/controllers/backtest.js';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn();
  return res;
}

describe('BacktestController', () => {
  it('returns 400 when symbol is missing', async () => {
    const svc = { run: vi.fn() };
    const ctrl = createBacktestController(svc);
    const res = mockRes();
    await ctrl.run({ query: { strategy: 'rsi', interval: '5m' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(svc.run).not.toHaveBeenCalled();
  });

  it('returns 400 when strategy is missing', async () => {
    const svc = { run: vi.fn() };
    const ctrl = createBacktestController(svc);
    const res = mockRes();
    await ctrl.run({ query: { symbol: 'BTC/USDT', interval: '5m' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when interval is missing', async () => {
    const svc = { run: vi.fn() };
    const ctrl = createBacktestController(svc);
    const res = mockRes();
    await ctrl.run({ query: { symbol: 'BTC/USDT', strategy: 'rsi' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('calls service and returns result with required params', async () => {
    const mockResult = { trades: [], pnl: 0 };
    const svc = { run: vi.fn().mockResolvedValue(mockResult) };
    const ctrl = createBacktestController(svc);
    const res = mockRes();
    await ctrl.run({ query: { symbol: 'BTC/USDT', strategy: 'rsi', interval: '5m' }, user: { id: 1 } } as any, res);
    expect(svc.run).toHaveBeenCalledWith(1, 'BTC/USDT', 'rsi', '5m', undefined, undefined, 'spot');
    expect(res.json).toHaveBeenCalledWith(mockResult);
  });

  it('passes from/to/marketType when provided', async () => {
    const svc = { run: vi.fn().mockResolvedValue({}) };
    const ctrl = createBacktestController(svc);
    const res = mockRes();
    await ctrl.run({ query: { symbol: 'BTC/USDT', strategy: 'rsi', interval: '1h', from: '1000', to: '2000', marketType: 'futures' }, user: { id: 1 } } as any, res);
    expect(svc.run).toHaveBeenCalledWith(1, 'BTC/USDT', 'rsi', '1h', 1000, 2000, 'futures');
  });
});

describe('Backtest controller rate limit (P2)', () => {
  it('returns 429 after 10 backtests per user in one minute', async () => {
    const { createBacktestController } = await import('../../src/controllers/backtest.js');
    const service = { run: vi.fn().mockResolvedValue({}) };
    const ctrl = createBacktestController(service as any);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res: any = { statusCode: 200 };
      res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
      res.json = vi.fn();
      await ctrl.run({ query: { symbol: 'BTC/USDT', strategy: 'rsi', interval: '1h' }, user: { id: 7 } } as any, res);
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
    expect(service.run).toHaveBeenCalledTimes(10);
  });
});
