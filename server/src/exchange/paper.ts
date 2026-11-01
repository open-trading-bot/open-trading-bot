import type { Candle, Ticker, Side, MarketType, OrderType } from '../types/index.js';
import type { ExchangeAdapter, OrderResult } from './types.js';
import { ERROR_MSG } from '../utils/constants.js';

export interface PaperAdapterOptions {
  onCashChange?: (cash: number) => void;
  getPositionsValue?: () => number;
}

export function createPaperAdapter(
  realAdapter: ExchangeAdapter,
  initialBalance: number,
  options: PaperAdapterOptions = {},
): ExchangeAdapter {
  let cash = initialBalance;
  let orderCounter = 0;
  const { onCashChange, getPositionsValue } = options;

  function setCash(next: number) {
    cash = next;
    if (onCashChange) onCashChange(cash);
  }

  return {
    name: `paper(${realAdapter.name})`,

    fetchSymbols(): Promise<string[]> {
      return realAdapter.fetchSymbols();
    },

    fetchTicker(symbol: string): Promise<Ticker> {
      return realAdapter.fetchTicker(symbol);
    },

    fetchCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
      return realAdapter.fetchCandles(symbol, interval, limit);
    },

    async placeOrder(params: {
      symbol: string; side: Side; amount: number; price?: number; type: OrderType; marketType: MarketType;
    }): Promise<OrderResult> {
      if (params.side === 'buy' && params.amount > cash) {
        throw new Error(`${ERROR_MSG.INSUFFICIENT_PAPER_CASH}: $${cash.toFixed(2)} available, $${params.amount.toFixed(2)} requested`);
      }
      const ticker = await realAdapter.fetchTicker(params.symbol);
      const price = params.price ?? ticker.last;
      const quantity = params.amount / price;
      setCash(params.side === 'buy' ? cash - params.amount : cash + params.amount);
      orderCounter++;
      return { orderId: `paper-${orderCounter}`, symbol: params.symbol, side: params.side, price, quantity, status: 'filled' };
    },

    async cancelOrder(): Promise<void> {},

    async fetchBalance(): Promise<{ total: number; free: number; totalEquity: number }> {
      const positionsValue = getPositionsValue ? getPositionsValue() : 0;
      return { total: cash, free: cash, totalEquity: cash + positionsValue };
    },

    async closePosition(symbol: string, side: Side, quantity: number, marketType: MarketType): Promise<OrderResult> {
      const ticker = await realAdapter.fetchTicker(symbol);
      const closeSide = side === 'buy' ? 'sell' : 'buy';
      const notional = quantity * ticker.last;
      setCash(closeSide === 'buy' ? cash - notional : cash + notional);
      orderCounter++;
      return { orderId: `paper-${orderCounter}`, symbol, side: closeSide, price: ticker.last, quantity, status: 'filled' };
    },
  };
}
