// === Enums ===

export type BotMode = 'live' | 'paper';
export type BotStatus = 'running' | 'paused' | 'stopped';
export type Side = 'buy' | 'sell';
export type SignalAction = 'buy' | 'sell' | 'hold';
export type MarketType = 'spot' | 'futures';
export type OrderType = 'limit' | 'market';

// === Market Data ===

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  volume24h: number;
  timestamp: number;
}

// === Trading ===

export interface Signal {
  action: SignalAction;
  symbol: string;
  strategy: string;
  confidence: number; // 0-1
  price: number;
  timestamp: number;
  marketType: MarketType;
}

export type CloseReason =
  | 'bot'
  | 'user'
  | 'admin'
  | 'liquidation'
  | 'bot_stop'
  | 'system'
  | 'asset-disabled'
  | 'unknown';

export interface Trade {
  id: string;
  symbol: string;
  side: Side;
  price: number;
  quantity: number;
  amount: number;
  strategy: string;
  mode: BotMode;
  marketType: MarketType;
  orderId: string;
  pnl: number | null;
  timestamp: number;
  userId: number;
  testnet: boolean;
  exchange: string;
  closeReason?: CloseReason | null;
}

export interface Position {
  id: string;
  symbol: string;
  side: Side;
  entryPrice: number;
  quantity: number;
  amount: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  strategy: string;
  mode: BotMode;
  marketType: MarketType;
  stopLoss: number | null;
  openedAt: number;
  userId: number;
  testnet: boolean;
  exchange: string;
}

// === Strategy ===

export interface StrategyParams {
  [key: string]: number | string | boolean;
}

export interface StrategyConfig {
  id: string;
  name: string;
  enabled: boolean;
  params: StrategyParams;
  interval: string; // '1m', '5m', '15m', '1h', etc.
  marketType: MarketType;
}

export interface StrategyResult {
  strategyId: string;
  strategyName: string;
  signals: Signal[];
}

// === Portfolio ===

export interface Portfolio {
  totalBalance: number;
  availableBalance: number;
  positions: Position[];
  dailyPnl: number;
  dailyPnlPct: number;
  totalPnl: number;
}

// === Risk Levels ===

export type RiskLevel = 'conservative' | 'moderate' | 'aggressive' | 'very-aggressive' | 'extreme' | 'custom';

export interface RiskLevelPreset {
  tradeAmount: number;
  stopLossPct: number;
  dailyLossLimit: number;
  maxOpenPositions: number;
  minConfidence: number;
}

export const RISK_LEVEL_PCTS: Record<Exclude<RiskLevel, 'custom'>, { tradeAmountPct: number; stopLossPct: number; dailyLossLimitPct: number; maxOpenPositions: number; minConfidence: number }> = {
  conservative:      { tradeAmountPct: 0.5,  stopLossPct: 1,  dailyLossLimitPct: 2,   maxOpenPositions: 3,  minConfidence: 0.7 },
  moderate:          { tradeAmountPct: 1,    stopLossPct: 2,  dailyLossLimitPct: 5,   maxOpenPositions: 5,  minConfidence: 0.5 },
  aggressive:        { tradeAmountPct: 2.5,  stopLossPct: 3,  dailyLossLimitPct: 10,  maxOpenPositions: 10, minConfidence: 0.3 },
  'very-aggressive': { tradeAmountPct: 5,    stopLossPct: 5,  dailyLossLimitPct: 25,  maxOpenPositions: 15, minConfidence: 0.2 },
  extreme:           { tradeAmountPct: 10,   stopLossPct: 8,  dailyLossLimitPct: 50,  maxOpenPositions: 25, minConfidence: 0.1 },
};

export function getRiskPreset(level: Exclude<RiskLevel, 'custom'>, balance: number): RiskLevelPreset {
  const p = RISK_LEVEL_PCTS[level];
  return {
    tradeAmount: Math.max(1, Math.round(balance * p.tradeAmountPct / 100)),
    stopLossPct: p.stopLossPct,
    dailyLossLimit: Math.max(1, Math.round(balance * p.dailyLossLimitPct / 100)),
    maxOpenPositions: p.maxOpenPositions,
    minConfidence: p.minConfidence,
  };
}

// === Config ===

export interface BotConfig {
  mode: BotMode;
  riskLevel: RiskLevel;
  tradeAmount: number;
  stopLossPct: number;
  dailyLossLimit: number;
  maxOpenPositions: number;
  minConfidence: number;
  tickInterval: number; // seconds between ticks
  assets: AssetConfig[];
  strategies: StrategyConfig[];
  orderType: OrderType;
}

export interface AssetConfig {
  symbol: string;
  enabled: boolean;
  marketType: MarketType;
}

// === WebSocket Events ===

export type WsEvent =
  | { type: 'price:update'; data: Ticker }
  | { type: 'trade:executed'; data: Trade }
  | { type: 'signal:generated'; data: Signal }
  | { type: 'signals:batch'; data: Signal[] }
  | { type: 'position:update'; data: Position }
  | { type: 'bot:status'; data: { status: BotStatus; mode: BotMode } }
  | { type: 'alert'; data: { message: string; severity: 'info' | 'warning' | 'critical' } };
