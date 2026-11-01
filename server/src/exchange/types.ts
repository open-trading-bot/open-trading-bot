import type { Candle, Ticker, Side, MarketType, OrderType } from '../types/index.js';

export interface OrderResult {
  orderId: string;
  symbol: string;
  side: Side;
  price: number;
  quantity: number;
  status: 'filled' | 'partial' | 'open' | 'failed';
}

export interface ApiPermissions {
  // Overall read-only flag: true means the key cannot place orders at all.
  readOnly: boolean;
  // Specific flag: true means the key has permissions to place trades.
  canTrade: boolean;
}

export interface ExchangeAdapter {
  name: string;
  fetchSymbols(): Promise<string[]>;
  fetchTicker(symbol: string): Promise<Ticker>;
  fetchCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]>;
  placeOrder(params: {
    symbol: string;
    side: Side;
    amount: number;
    price?: number;
    type: OrderType;
    marketType: MarketType;
  }): Promise<OrderResult>;
  cancelOrder(orderId: string, symbol: string): Promise<void>;
  fetchBalance(): Promise<{ total: number; free: number; totalEquity: number }>;
  closePosition(symbol: string, side: Side, quantity: number, marketType: MarketType): Promise<OrderResult>;
  fetchPermissions?(): Promise<ApiPermissions>;
}
