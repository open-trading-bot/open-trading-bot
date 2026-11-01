import type { Side } from '../../types/index.js';

interface RiskConfig {
  tradeAmount: number;
  stopLossPct: number;
  dailyLossLimit: number;
  maxOpenPositions: number;
  minConfidence: number;
}

interface RiskInput {
  symbol: string;
  side: Side;
  price: number;
  openPositions: number;
  dailyLoss: number;
  confidence: number;
  availableBalance: number;
}

interface RiskResult {
  approved: boolean;
  amount: number;
  quantity: number;
  stopLoss: number;
  reason?: string;
}

export interface RiskManager {
  evaluate(input: RiskInput): RiskResult;
  updateConfig(config: Partial<RiskConfig>): void;
  getConfig(): RiskConfig;
}

export function createRiskManager(config: RiskConfig): RiskManager {
  let current = { ...config };
  return {
    evaluate(input: RiskInput): RiskResult {
      const rejected = (reason: string): RiskResult => ({ approved: false, amount: 0, quantity: 0, stopLoss: 0, reason });
      if (input.openPositions >= current.maxOpenPositions) return rejected(`Rejected: max positions (${current.maxOpenPositions}) reached`);
      if (input.dailyLoss >= current.dailyLossLimit) return rejected(`Rejected: daily loss limit ($${current.dailyLossLimit}) exceeded`);
      if (input.confidence < current.minConfidence) return rejected(`Rejected: confidence ${(input.confidence * 100).toFixed(0)}% below minimum ${(current.minConfidence * 100).toFixed(0)}%`);
      if (input.side === 'buy' && current.tradeAmount > input.availableBalance) return rejected(`Rejected: trade amount ($${current.tradeAmount}) exceeds available balance ($${input.availableBalance.toFixed(2)})`);
      const quantity = current.tradeAmount / input.price;
      const stopLossMultiplier = current.stopLossPct / 100;
      const stopLoss = input.side === 'buy' ? input.price * (1 - stopLossMultiplier) : input.price * (1 + stopLossMultiplier);
      return { approved: true, amount: current.tradeAmount, quantity, stopLoss };
    },
    updateConfig(update: Partial<RiskConfig>) { current = { ...current, ...update }; },
    getConfig() { return { ...current }; },
  };
}
