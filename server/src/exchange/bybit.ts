import * as ccxt from 'ccxt';
import type { Candle, Ticker, Side, MarketType, OrderType } from '../types/index.js';
import type { ExchangeAdapter, OrderResult, ApiPermissions } from './types.js';
import {
  DEFAULTS,
  QUOTE_CURRENCY,
  QUOTE_SUFFIX,
  BYBIT_CATEGORY,
  CCXT_ORDER_STATUS,
} from '../utils/constants.js';
import { getOrComputeSymbols, symbolsCacheKey } from './symbols-cache.js';

interface BybitConfig {
  apiKey: string;
  secret: string;
  testnet: boolean;
}

export function createBybitAdapter(config: BybitConfig): ExchangeAdapter {
  const exchange = new ccxt.pro.bybit({
    ...(config.apiKey && config.secret ? { apiKey: config.apiKey, secret: config.secret } : {}),
  });
  if (config.testnet) exchange.setSandboxMode(true);

  return {
    name: 'bybit',

    async fetchSymbols(): Promise<string[]> {
      return getOrComputeSymbols(symbolsCacheKey('bybit', config.testnet), async () => {
        await exchange.loadMarkets();
        return Object.keys(exchange.markets).filter((s) => s.endsWith(QUOTE_SUFFIX)).sort();
      });
    },

    async fetchTicker(symbol: string): Promise<Ticker> {
      const t = await exchange.fetchTicker(symbol);
      return {
        symbol: t.symbol!,
        last: t.last!,
        bid: t.bid!,
        ask: t.ask!,
        volume24h: t.baseVolume ?? 0,
        timestamp: t.timestamp!,
      };
    },

    async fetchCandles(symbol: string, interval: string, limit = 100): Promise<Candle[]> {
      const ohlcv = await exchange.fetchOHLCV(symbol, interval, undefined, limit);
      return ohlcv.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: timestamp as number,
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: volume as number,
      }));
    },

    async placeOrder(params: {
      symbol: string;
      side: Side;
      amount: number;
      price?: number;
      type: OrderType;
      marketType: MarketType;
    }): Promise<OrderResult> {
      let conversionPrice = params.price;
      if (conversionPrice == null) {
        const t = await exchange.fetchTicker(params.symbol);
        conversionPrice = t.last!;
      }
      const rawQuantity = params.amount / conversionPrice;
      await exchange.loadMarkets();
      const quantity = Number(exchange.amountToPrecision(params.symbol, rawQuantity));
      const createResponse = await exchange.createOrder(
        params.symbol,
        params.type,
        params.side,
        quantity,
        params.price,
        params.marketType === 'futures' ? { category: BYBIT_CATEGORY.LINEAR } : undefined,
      );

      let order = createResponse;
      if (!createResponse.status && createResponse.id) {
        const fetchParams = {
          acknowledged: true,
          category: params.marketType === 'futures' ? BYBIT_CATEGORY.LINEAR : BYBIT_CATEGORY.SPOT,
        };
        order = await exchange.fetchOrder(createResponse.id, params.symbol, fetchParams);
      }

      return {
        orderId: order.id,
        symbol: order.symbol!,
        side: order.side as Side,
        price: order.average || order.price || 0,
        quantity: order.filled ?? 0,
        status: mapStatus(order.status!),
      };
    },

    async cancelOrder(orderId: string, symbol: string): Promise<void> {
      await exchange.cancelOrder(orderId, symbol);
    },

    async fetchBalance(): Promise<{ total: number; free: number; totalEquity: number }> {
      const balance = await exchange.fetchBalance();
      const usdt = Number((balance.total as any)?.[QUOTE_CURRENCY] ?? 0);
      const free = Number((balance.free as any)?.[QUOTE_CURRENCY] ?? 0);
      const list = (balance as any)?.info?.result?.list;
      const rawEquity = Array.isArray(list) && list.length > 0 ? list[0]?.totalEquity : undefined;
      const totalEquity = rawEquity != null && rawEquity !== '' ? Number(rawEquity) : usdt;
      return { total: usdt, free, totalEquity };
    },

    async fetchPermissions(): Promise<ApiPermissions> {
      const res = await (exchange as any).privateGetV5UserQueryApi();
      const result = res?.result ?? {};
      const readOnlyFlag = Number(result.readOnly ?? 0);
      const readOnly = readOnlyFlag === 1;
      const perms = result.permissions ?? {};
      const categories = Object.values(perms) as string[][];
      const canTrade = !readOnly && categories.some((arr) =>
        Array.isArray(arr) && arr.some((p) => typeof p === 'string' && /trade/i.test(p)),
      );
      return { readOnly, canTrade };
    },

    async closePosition(symbol: string, side: Side, quantity: number, marketType: MarketType): Promise<OrderResult> {
      const closeSide: Side = side === 'buy' ? 'sell' : 'buy';
      const order = await exchange.createOrder(
        symbol,
        DEFAULTS.ORDER_TYPE as OrderType,
        closeSide,
        quantity,
        undefined,
        marketType === 'futures' ? { category: BYBIT_CATEGORY.LINEAR, reduceOnly: true } : undefined,
      );
      return {
        orderId: order.id,
        symbol: order.symbol!,
        side: order.side as Side,
        price: order.average || order.price || 0,
        quantity: order.filled ?? 0,
        status: mapStatus(order.status!),
      };
    },
  };
}

function mapStatus(status: string): OrderResult['status'] {
  switch (status) {
    case CCXT_ORDER_STATUS.CLOSED: return 'filled';
    case CCXT_ORDER_STATUS.OPEN: return 'open';
    case CCXT_ORDER_STATUS.PARTIALLY_FILLED: return 'partial';
    default: return 'failed';
  }
}
