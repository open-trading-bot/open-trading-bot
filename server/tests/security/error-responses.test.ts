import { describe, it, expect, vi, afterEach } from 'vitest';
import express, { Router } from 'express';
import type http from 'http';
import { mountRoutes } from '../../src/server.js';
import { PublicError } from '../../src/utils/errors.js';
import { createDataController } from '../../src/controllers/data.js';
import { createBackofficeController } from '../../src/controllers/backoffice.js';
import { createBotService } from '../../src/services/bot.js';
import { createBacktestService } from '../../src/services/backtest.js';
import { ERROR_MSG } from '../../src/utils/constants.js';

const INTERNAL = 'SQLITE_ERROR: no such column: users.secret_column';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn();
  return res;
}

describe('error handler does not leak internal error text', () => {
  let server: http.Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });

  async function start(botRouter: Router): Promise<number> {
    const app = express();
    app.use(express.json());
    const empty = Router();
    mountRoutes(app, {
      authRouter: empty, botRouter, dataRouter: empty, backtestRouter: empty,
      backofficeRouter: empty, disclaimerRouter: empty,
    });
    return new Promise((resolve) => {
      server = app.listen(0, () => resolve((server!.address() as { port: number }).port));
    });
  }

  it('returns a generic 500 for an unexpected error', async () => {
    const r = Router();
    r.get('/boom', () => { throw new Error(INTERNAL); });
    const port = await start(r);
    const res = await fetch(`http://localhost:${port}/api/bot/boom`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Internal server error' });
  });

  it('returns a generic 500 for an async rejection', async () => {
    const r = Router();
    r.get('/boom', async () => { throw new TypeError("Cannot read properties of undefined (reading 'apiKey')"); });
    const port = await start(r);
    const res = await fetch(`http://localhost:${port}/api/bot/boom`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('apiKey');
  });

  it('returns the message and status of a PublicError', async () => {
    const r = Router();
    r.get('/boom', () => { throw new PublicError(ERROR_MSG.ZERO_BALANCE, 400); });
    const port = await start(r);
    const res = await fetch(`http://localhost:${port}/api/bot/boom`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: ERROR_MSG.ZERO_BALANCE });
  });

  it('returns a generic 400 for a malformed JSON body', async () => {
    const r = Router();
    r.post('/echo', (req, res) => { res.json(req.body); });
    const port = await start(r);
    const res = await fetch(`http://localhost:${port}/api/bot/echo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a": nope',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request' });
  });
});

describe('bot service errors stay visible to the user', () => {
  it('throws ZERO_BALANCE as a PublicError', async () => {
    const manager: any = {
      getExchange: () => ({ fetchBalance: async () => ({ total: 0, free: 0, totalEquity: 0 }) }),
    };
    const svc = createBotService(manager, {} as any);
    const err = await svc.start(1).catch((e) => e);
    expect(err).toBeInstanceOf(PublicError);
    expect(err.message).toBe(ERROR_MSG.ZERO_BALANCE);
    expect(err.status).toBe(400);
  });
});

describe('data controller does not leak exchange errors', () => {
  const exchangeError = 'bybit {"retCode":10003,"retMsg":"API key is invalid. apiKey=AbCdEf"}';

  it('closePosition returns a generic 500 for an exchange error', async () => {
    const botSvc: any = { closePosition: vi.fn().mockRejectedValue(new Error(exchangeError)) };
    const ctrl = createDataController({} as any, {} as any, 'secret', botSvc);
    const res = mockRes();
    await ctrl.closePosition({ params: { id: 'p1' }, user: { id: 1 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('apiKey');
  });

  it('closePosition still returns 404 when the position is not found', async () => {
    const botSvc: any = { closePosition: vi.fn().mockRejectedValue(new Error('Position p9 not found')) };
    const ctrl = createDataController({} as any, {} as any, 'secret', botSvc);
    const res = mockRes();
    await ctrl.closePosition({ params: { id: 'p9' }, user: { id: 1 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('updateConfig does not return the exchange message of a failed close', async () => {
    const dataSvc: any = {
      updateConfig: vi.fn().mockResolvedValue({ ok: false, error: 'close_failed', symbol: 'BTC/USDT', message: exchangeError }),
    };
    const db: any = { getUserById: () => null, getUserConfig: () => null };
    const ctrl = createDataController(dataSvc, db, 'secret', {} as any);
    const res = mockRes();
    await ctrl.updateConfig({ body: {}, user: { id: 1, role: 'admin' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error).toContain('BTC/USDT');
    expect(body.error).not.toContain('apiKey');
  });
});

describe('backoffice controller does not leak database errors', () => {
  it('createUser returns a generic 500 for an unexpected error', () => {
    const svc: any = { createUser: vi.fn(() => { throw new Error(INTERNAL); }) };
    const ctrl = createBackofficeController(svc, {} as any, {} as any);
    const res = mockRes();
    ctrl.createUser({ body: { username: 'a', password: 'b' }, user: { id: 1 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('createFeatureFlag returns 400 "Flag already exists" for a duplicate id', () => {
    const dup = Object.assign(new Error('UNIQUE constraint failed: feature_flags.id'), { code: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
    const flags: any = { createFlag: vi.fn(() => { throw dup; }) };
    const ctrl = createBackofficeController({} as any, flags, {} as any);
    const res = mockRes();
    ctrl.createFeatureFlag({ body: { id: 'f1', description: 'd' }, user: { id: 1 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Flag already exists' });
  });

  it('createFeatureFlag returns a generic 500 for a different error', () => {
    const flags: any = { createFlag: vi.fn(() => { throw new Error(INTERNAL); }) };
    const ctrl = createBackofficeController({} as any, flags, {} as any);
    const res = mockRes();
    ctrl.createFeatureFlag({ body: { id: 'f1', description: 'd' }, user: { id: 1 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('createInvitation returns a generic 500 for an unexpected error', async () => {
    const inv: any = { create: vi.fn().mockRejectedValue(new Error(INTERNAL)) };
    const ctrl = createBackofficeController({} as any, {} as any, inv);
    const res = mockRes();
    await ctrl.createInvitation({ body: { email: 'a@b.co' }, user: { id: 1 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('resendInvitation returns a generic 500 for an unexpected error', async () => {
    const inv: any = { resend: vi.fn().mockRejectedValue(new Error(INTERNAL)) };
    const ctrl = createBackofficeController({} as any, {} as any, inv);
    const res = mockRes();
    await ctrl.resendInvitation({ params: { id: 'x' }, user: { id: 1 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });
});

describe('backtest service', () => {
  it('rejects an unknown strategy with a PublicError before it fetches candles', async () => {
    const getExchange = vi.fn();
    const db: any = { getCandles: vi.fn().mockReturnValue([]) };
    const svc = createBacktestService(db, { getExchange } as any);
    const err = await svc.run(1, 'BTC/USDT', 'no_such_strategy', '1h').catch((e) => e);
    expect(err).toBeInstanceOf(PublicError);
    expect(err.message).toBe(ERROR_MSG.STRATEGY_NOT_FOUND);
    expect(getExchange).not.toHaveBeenCalled();
  });
});
