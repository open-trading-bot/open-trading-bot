import { describe, it, expect } from 'vitest';
import { createRiskManager } from '../../../src/engine/risk/index.js';

const ok = {
  symbol: 'BTC/USDT' as const,
  price: 50000,
  confidence: 0.8,
  availableBalance: 10000,
};

describe('Risk Manager', () => {
  it('approves trade when within limits', () => {
    const rm = createRiskManager({ tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 10, minConfidence: 0.5 });
    const result = rm.evaluate({ ...ok, side: 'buy', openPositions: 3, dailyLoss: 100 });
    expect(result.approved).toBe(true);
    expect(result.amount).toBe(100);
    expect(result.stopLoss).toBeCloseTo(49000);
  });

  it('rejects when max positions reached', () => {
    const rm = createRiskManager({ tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 5, minConfidence: 0.5 });
    const result = rm.evaluate({ ...ok, side: 'buy', openPositions: 5, dailyLoss: 0 });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('max positions');
  });

  it('rejects when daily loss limit exceeded', () => {
    const rm = createRiskManager({ tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 10, minConfidence: 0.5 });
    const result = rm.evaluate({ ...ok, side: 'buy', openPositions: 1, dailyLoss: 500 });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('daily loss');
  });

  it('calculates stop loss for sell side (above entry)', () => {
    const rm = createRiskManager({ tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 10, minConfidence: 0.5 });
    const result = rm.evaluate({ ...ok, side: 'sell', openPositions: 0, dailyLoss: 0 });
    expect(result.approved).toBe(true);
    expect(result.stopLoss).toBeCloseTo(51000);
  });

  it('rejects when confidence is below minimum', () => {
    const rm = createRiskManager({ tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 10, minConfidence: 0.7 });
    const result = rm.evaluate({ ...ok, side: 'buy', openPositions: 0, dailyLoss: 0, confidence: 0.4 });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('confidence');
  });

  it('approves when confidence meets minimum', () => {
    const rm = createRiskManager({ tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 10, minConfidence: 0.5 });
    const result = rm.evaluate({ ...ok, side: 'buy', openPositions: 0, dailyLoss: 0, confidence: 0.5 });
    expect(result.approved).toBe(true);
  });

  it('rejects buy when tradeAmount exceeds availableBalance', () => {
    const rm = createRiskManager({ tradeAmount: 1000, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 10, minConfidence: 0.5 });
    const result = rm.evaluate({ ...ok, side: 'buy', openPositions: 0, dailyLoss: 0, availableBalance: 100 });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('available balance');
  });

  it('approves buy when tradeAmount exactly matches availableBalance', () => {
    const rm = createRiskManager({ tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 10, minConfidence: 0.5 });
    const result = rm.evaluate({ ...ok, side: 'buy', openPositions: 0, dailyLoss: 0, availableBalance: 100 });
    expect(result.approved).toBe(true);
  });

  it('does not reject sells on insufficient balance (sells release USDT)', () => {
    const rm = createRiskManager({ tradeAmount: 1000, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 10, minConfidence: 0.5 });
    const result = rm.evaluate({ ...ok, side: 'sell', openPositions: 1, dailyLoss: 0, availableBalance: 0 });
    expect(result.approved).toBe(true);
  });
});
