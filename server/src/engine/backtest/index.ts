import type { Candle, MarketType, StrategyParams } from '../../types/index.js';
import { getStrategy } from '../strategies/index.js';

interface BacktestInput {
  strategyId: string; candles: Candle[]; symbol: string; marketType: MarketType; tradeAmount: number; params: StrategyParams;
}
export interface BacktestTrade {
  entryPrice: number; exitPrice: number; side: 'buy' | 'sell'; pnl: number; pnlPct: number; entryTime: number; exitTime: number;
}
export interface BacktestResult {
  trades: BacktestTrade[]; totalReturn: number; winRate: number; maxDrawdown: number; sharpeRatio: number; equity: { timestamp: number; value: number }[];
}

function closeTrade(position: { side: 'buy' | 'sell'; entryPrice: number; quantity: number; entryTime: number }, exitPrice: number, exitTime: number, tradeAmount: number): BacktestTrade {
  const pnl = position.side === 'buy'
    ? (exitPrice - position.entryPrice) * position.quantity
    : (position.entryPrice - exitPrice) * position.quantity;
  return {
    entryPrice: position.entryPrice, exitPrice, side: position.side,
    pnl, pnlPct: (pnl / tradeAmount) * 100,
    entryTime: position.entryTime, exitTime,
  };
}

function calculateStats(trades: BacktestTrade[]): { totalReturn: number; winRate: number; sharpeRatio: number } {
  const wins = trades.filter((t) => t.pnl > 0).length;
  const totalReturn = trades.reduce((sum, t) => sum + t.pnl, 0);
  const returns = trades.map((t) => t.pnlPct);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  return {
    totalReturn,
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    sharpeRatio: stdDev > 0 ? avgReturn / stdDev : 0,
  };
}

/**
 * Candles that each strategy call sees. The live bot fetches 100 candles per
 * tick, so the backtest uses the same window. A full-history slice per candle
 * made the backtest O(n^2): 30 days of 1m candles blocked the event loop for
 * minutes.
 */
export const STRATEGY_WINDOW = 100;

export function runBacktest(input: BacktestInput): BacktestResult {
  const strategy = getStrategy(input.strategyId);
  if (!strategy) throw new Error(`Strategy ${input.strategyId} not found`);
  const trades: BacktestTrade[] = [];
  const equity: { timestamp: number; value: number }[] = [];
  let balance = input.tradeAmount * 10;
  let position: { side: 'buy' | 'sell'; entryPrice: number; quantity: number; entryTime: number } | null = null;
  let peak = balance;
  let maxDrawdown = 0;

  for (let i = 20; i < input.candles.length; i++) {
    const slice = input.candles.slice(Math.max(0, i + 1 - STRATEGY_WINDOW), i + 1);
    const signal = strategy.analyze(slice, input.params, input.symbol, input.marketType);

    if (position && signal.action !== 'hold' && signal.action !== position.side) {
      const trade = closeTrade(position, input.candles[i].close, input.candles[i].timestamp, input.tradeAmount);
      trades.push(trade);
      balance += trade.pnl;
      position = null;
    }

    if (!position && signal.action !== 'hold') {
      const price = input.candles[i].close;
      position = { side: signal.action as 'buy' | 'sell', entryPrice: price, quantity: input.tradeAmount / price, entryTime: input.candles[i].timestamp };
    }

    equity.push({ timestamp: input.candles[i].timestamp, value: balance });
    if (balance > peak) peak = balance;
    const drawdown = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const stats = calculateStats(trades);
  return { trades, equity, maxDrawdown, ...stats };
}
