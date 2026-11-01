import { describe, it, expect } from 'vitest';
import { createRiskManager } from '../../../src/engine/risk/index.js';
import { getRiskPreset } from '../../../src/types/index.js';

describe('getRiskPreset never returns 0 for tradeAmount or dailyLossLimit', () => {
  for (const level of ['conservative', 'moderate', 'aggressive', 'very-aggressive', 'extreme'] as const) {
    it(`level=${level} clamps to >= 1 at balance=0`, () => {
      const preset = getRiskPreset(level, 0);
      expect(preset.dailyLossLimit).toBeGreaterThanOrEqual(1);
      expect(preset.tradeAmount).toBeGreaterThanOrEqual(1);
    });

    it(`level=${level} clamps to >= 1 at balance=1`, () => {
      const preset = getRiskPreset(level, 1);
      expect(preset.dailyLossLimit).toBeGreaterThanOrEqual(1);
      expect(preset.tradeAmount).toBeGreaterThanOrEqual(1);
    });
  }

  it('still computes percentage values correctly for healthy balances', () => {
    const preset = getRiskPreset('very-aggressive', 1000);
    expect(preset.tradeAmount).toBe(50);
    expect(preset.dailyLossLimit).toBe(250);
  });

  it('matches the prod incident math for paperBalance=222.71', () => {
    const preset = getRiskPreset('very-aggressive', 222.71521026741135);
    expect(preset.tradeAmount).toBe(11);
    expect(preset.dailyLossLimit).toBe(56);
  });

  it('a clamped preset does not rejected-loop the risk manager on the first tick', () => {
    const preset = getRiskPreset('very-aggressive', 0);
    const rm = createRiskManager({
      tradeAmount: preset.tradeAmount,
      stopLossPct: preset.stopLossPct,
      dailyLossLimit: preset.dailyLossLimit,
      maxOpenPositions: preset.maxOpenPositions,
      minConfidence: preset.minConfidence,
    });
    const result = rm.evaluate({
      symbol: 'SOL/USDT', side: 'buy', price: 150,
      openPositions: 0, dailyLoss: 0,
      confidence: 0.8, availableBalance: 222.71,
    });
    expect(result.approved).toBe(true);
  });
});
