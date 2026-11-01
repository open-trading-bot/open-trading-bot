// client/src/stores/bot.ts
import { create } from 'zustand';

const BALANCES_HIDDEN_KEY = 'balancesHidden';
function readBalancesHidden(): boolean {
  try {
    return localStorage.getItem(BALANCES_HIDDEN_KEY) === 'true';
  } catch {
    return false;
  }
}
function writeBalancesHidden(hidden: boolean): void {
  try {
    localStorage.setItem(BALANCES_HIDDEN_KEY, hidden ? 'true' : 'false');
  } catch { /* ignore quota / disabled storage */ }
}

interface Position {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  quantity: number;
  amount: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  strategy: string;
  marketType: string;
  stopLoss: number | null;
  openedAt: number;
  mode?: string;
  testnet?: boolean;
  exchange?: string;
}

interface Trade {
  id: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  amount: number;
  strategy: string;
  mode: string;
  marketType: string;
  orderId: string;
  pnl: number | null;
  timestamp: number;
  testnet?: boolean;
  exchange?: string;
}

interface StrategyConfig {
  id: string;
  name: string;
  enabled: boolean;
  params: Record<string, unknown>;
  interval: string;
  marketType: string;
}

export interface Signal {
  strategy: string;
  symbol: string;
  action: string;
  confidence: number;
  price: number;
  marketType: string;
  timestamp: number;
}

interface BotStore {
  status: 'running' | 'paused' | 'stopped';
  mode: 'live' | 'paper';
  testnet: boolean;
  totalBalance: number;
  availableBalance: number;
  totalEquity: number;
  // True once a /api/portfolio/balance fetch has resolved at least once.
  // Distinguishes "haven't loaded yet" from "user legitimately has zero cash"
  // so the UI can show an actual $0 instead of a loading dash.
  portfolioLoaded: boolean;
  dailyPnl: number;
  dailyPnlPct: number;
  totalPnl: number;
  positions: Position[];
  trades: Trade[];
  strategies: StrategyConfig[];
  signals: Signal[];
  lastTickAt: number | null;
  tickInterval: number;
  ready: boolean;
  // keyReadOnly: null = not yet checked, true = stored live key is read-only,
  // false = stored live key can trade. Used to gate bot controls so users
  // can't try to start a bot that has no chance of placing trades.
  keyReadOnly: boolean | null;
  balancesHidden: boolean;
  toggleBalancesHidden: () => void;
  addSignal: (signal: Signal) => void;
  setLastTickAt: (lastTickAt: number | null) => void;
  setTickInterval: (tickInterval: number) => void;
  setReady: (ready: boolean) => void;
  setStatus: (status: BotStore['status']) => void;
  setMode: (mode: BotStore['mode']) => void;
  setTestnet: (testnet: boolean) => void;
  setPortfolio: (data: Partial<BotStore>) => void;
  setPositions: (positions: Position[]) => void;
  updatePosition: (position: Position) => void;
  setTrades: (trades: Trade[]) => void;
  addTrade: (trade: Trade) => void;
  setStrategies: (strategies: StrategyConfig[]) => void;
  setKeyReadOnly: (readOnly: boolean | null) => void;
  backtestResult: any | null;
  backtestParams: { symbol: string; strategy: string; interval: string } | null;
  setBacktestResult: (result: any, params: { symbol: string; strategy: string; interval: string }) => void;
  clearBacktestResult: () => void;
}

export const useBotStore = create<BotStore>((set) => ({
  lastTickAt: null,
  tickInterval: 60,
  ready: false,
  status: 'stopped',
  mode: 'paper',
  testnet: true,
  totalBalance: 0,
  availableBalance: 0,
  totalEquity: 0,
  portfolioLoaded: false,
  dailyPnl: 0,
  dailyPnlPct: 0,
  totalPnl: 0,
  positions: [],
  trades: [],
  strategies: [],
  signals: [],
  keyReadOnly: null,
  balancesHidden: readBalancesHidden(),
  toggleBalancesHidden: () => set((state) => {
    const next = !state.balancesHidden;
    writeBalancesHidden(next);
    return { balancesHidden: next };
  }),

  addSignal: (signal) => set((state) => {
    return { signals: [signal, ...state.signals].slice(0, 100) };
  }),
  setKeyReadOnly: (keyReadOnly) => set({ keyReadOnly }),
  setLastTickAt: (lastTickAt) => set({ lastTickAt }),
  setTickInterval: (tickInterval) => set({ tickInterval }),
  setReady: (ready) => set({ ready }),
  setStatus: (status) => set({ status }),
  setMode: (mode) => set({ mode }),
  setTestnet: (testnet) => set({ testnet }),
  setPortfolio: (data) => set((state) => {
    const next = { ...state, ...data };
    const dailyPnlPct = next.totalBalance > 0 ? (next.dailyPnl / next.totalBalance) * 100 : 0;
    const touchesBalance = 'totalBalance' in data || 'availableBalance' in data || 'totalEquity' in data;
    return { ...data, dailyPnlPct, ...(touchesBalance ? { portfolioLoaded: true } : {}) };
  }),
  setPositions: (positions) => set({ positions }),
  updatePosition: (position) =>
    set((state) => ({
      positions: state.positions.map((p) => (p.id === position.id ? position : p)),
    })),
  setTrades: (trades) => set({ trades }),
  addTrade: (trade) => set((state) => ({ trades: [trade, ...state.trades] })),
  setStrategies: (strategies) => set({ strategies }),
  backtestResult: null,
  backtestParams: null,
  setBacktestResult: (result, params) => set({ backtestResult: result, backtestParams: params }),
  clearBacktestResult: () => set({ backtestResult: null, backtestParams: null }),
}));
