import { randomUUID } from 'crypto';
import type { ExchangeAdapter } from '../../exchange/types.js';
import type { Db } from '../../db/index.js';
import type { WsBroadcaster } from '../../websocket/index.js';
import type { BotConfig, BotStatus, CloseReason, Position, Signal, Trade } from '../../types/index.js';
import { getStrategy } from '@open-trading-bot/strategies';
import { createRiskManager, type RiskManager } from '../risk/index.js';
import logger from '../../utils/logger.js';
import { closedCandlesOnly } from '../../utils/candles.js';
import { WS_EVENTS, ERROR_MSG } from '../../utils/constants.js';

export interface Orchestrator {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
  killSwitch(reason: 'user' | 'admin'): Promise<void>;
  closePositionManually(positionId: string, reason?: CloseReason): Promise<void>;
  getStatus(): BotStatus;
  getLastTickAt(): number | null;
  /** False while a tick runs. A stopped bot can still finish a tick. */
  isIdle(): boolean;
  getConfig(): BotConfig;
  updateConfig(update: Partial<BotConfig>): void;
}

function riskConfigFromBotConfig(c: BotConfig) {
  return {
    tradeAmount: c.tradeAmount,
    stopLossPct: c.stopLossPct,
    dailyLossLimit: c.dailyLossLimit,
    maxOpenPositions: c.maxOpenPositions,
    minConfidence: c.minConfidence,
  };
}

const STOP_LOSS_RETRY_COOLDOWN_MS = 60_000;

export function createOrchestrator(
  exchange: ExchangeAdapter, db: Db, broadcaster: WsBroadcaster, initialConfig: BotConfig, userId: number = 0,
): Orchestrator {
  let status: BotStatus = 'stopped';
  let lastTickAt: number | null = null;
  let config = { ...initialConfig };
  const riskManager: RiskManager = createRiskManager(riskConfigFromBotConfig(config));
  // In-flight set prevents the same position from being closed twice when
  // ticks overlap (e.g. long tick crossing the next interval). Retry map
  // throttles retries after closePosition failures so a transient network
  // blip doesn't spin every tick forever.
  const closingPositions = new Set<string>();
  const stopLossLastAttempt = new Map<string, number>();
  let inFlightTick: Promise<void> | null = null;
  // Per-tick counters for the single info summary line, and the signals of
  // the tick. The signals go to the client in one message at the end of the
  // tick, not one message per asset and strategy.
  let tickStats = { assets: 0, orders: 0, errors: 0 };
  let tickSignals: Signal[] = [];

  async function waitForIdle(): Promise<void> {
    if (!inFlightTick) return;
    try { await inFlightTick; } catch { /* the tick logs its own errors */ }
  }

  function getDailyLoss(): number {
    const trades = config.mode === 'live'
      ? db.getDailyTrades(userId, {
          mode: 'live',
          exchange: exchange.name,
          testnet: isTestnet(),
        })
      : db.getDailyTrades(userId, { mode: config.mode });
    return trades.reduce((sum, t) => sum + (t.pnl !== null && t.pnl < 0 ? Math.abs(t.pnl) : 0), 0);
  }

  async function updatePositionPnl(): Promise<void> {
    const positions = db.getOpenPositions(userId);
    for (const pos of positions) {
      try {
        const ticker = await exchange.fetchTicker(pos.symbol);
        const currentPrice = ticker.last;
        const pnl = (currentPrice - pos.entryPrice) * pos.quantity;
        const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        db.upsertPosition({ ...pos, currentPrice, pnl, pnlPct });
        broadcaster.broadcast({ type: WS_EVENTS.POSITION_UPDATE, data: { ...pos, currentPrice, pnl, pnlPct } });

        if (pos.stopLoss !== null && pos.side === 'buy' && currentPrice <= pos.stopLoss) {
          await triggerStopLoss({ ...pos, currentPrice, pnl, pnlPct });
        }
      } catch (err) {
        logger.error(`[position] Failed to update ${pos.symbol}: ${err}`);
      }
    }
  }

  async function triggerStopLoss(pos: Position): Promise<void> {
    if (closingPositions.has(pos.id)) return;
    const lastAttempt = stopLossLastAttempt.get(pos.id) ?? 0;
    if (Date.now() - lastAttempt < STOP_LOSS_RETRY_COOLDOWN_MS) return;
    closingPositions.add(pos.id);
    stopLossLastAttempt.set(pos.id, Date.now());
    logger.info(`[stop-loss] ${pos.symbol} price ${pos.currentPrice} hit SL ${pos.stopLoss} — closing position ${pos.id}`);
    try {
      const orderResult = await exchange.closePosition(pos.symbol, pos.side, pos.quantity, pos.marketType);
      const exitPrice = orderResult.price || pos.currentPrice;
      const realizedPnl = (exitPrice - pos.entryPrice) * pos.quantity;
      const trade: Trade = {
        id: randomUUID(), symbol: pos.symbol, side: 'sell',
        price: exitPrice, quantity: orderResult.quantity || pos.quantity, amount: pos.amount,
        strategy: pos.strategy, mode: config.mode, marketType: pos.marketType,
        orderId: orderResult.orderId, pnl: realizedPnl, timestamp: Date.now(), userId,
        testnet: recordTestnet(), exchange: recordExchange(),
        closeReason: 'bot',
      };
      // Record the trade BEFORE removing the position. If insertTrade throws
      // (constraint, disk), the position row stays and the exchange close can
      // be reconciled manually — we never lose the audit trail entirely.
      db.insertTrade(trade);
      db.removePosition(userId, pos.id);
      stopLossLastAttempt.delete(pos.id);
      broadcaster.broadcast({ type: WS_EVENTS.TRADE_EXECUTED, data: trade });
      broadcaster.broadcast({
        type: WS_EVENTS.ALERT,
        data: { message: `Stop-loss hit: ${pos.symbol} closed @ ${exitPrice.toFixed(2)} — PnL $${realizedPnl.toFixed(2)}`, severity: 'warning' },
      });
    } catch (err) {
      logger.error(`[stop-loss] Failed to close ${pos.symbol}: ${err}`);
      broadcaster.broadcast({
        type: WS_EVENTS.ALERT,
        data: { message: `Stop-loss close failed for ${pos.symbol}: ${(err as Error).message}`, severity: 'critical' },
      });
    } finally {
      closingPositions.delete(pos.id);
    }
  }

  async function collectSignals(symbol: string, marketType: string, strategies: typeof config.strategies): Promise<Signal[]> {
    // Fetch candles once per unique interval for this symbol, not once per
    // strategy. Multiple strategies sharing an interval would otherwise
    // duplicate the exchange API call every tick.
    const intervalsNeeded = new Set<string>();
    for (const s of strategies) {
      if (getStrategy(s.id)) intervalsNeeded.add(s.interval);
    }
    const candlesByInterval = new Map<string, Awaited<ReturnType<typeof exchange.fetchCandles>>>();
    for (const interval of intervalsNeeded) {
      logger.debug(`[tick] Fetching candles for ${symbol} (${interval})`);
      const candles = await exchange.fetchCandles(symbol, interval);
      logger.debug(`[tick] Got ${candles.length} candles for ${symbol} (${interval})`);
      db.insertCandles(symbol, interval, candles);
      candlesByInterval.set(interval, closedCandlesOnly(candles, interval));
    }

    const signals: Signal[] = [];
    for (const stratConfig of strategies) {
      const strategy = getStrategy(stratConfig.id);
      if (!strategy) { logger.debug(`[tick] Strategy ${stratConfig.id} not found, skipping`); continue; }
      const candles = candlesByInterval.get(stratConfig.interval)!;
      const signal = strategy.analyze(candles, stratConfig.params, symbol, marketType as any);
      logger.debug(`[tick] ${stratConfig.name} → ${symbol}: ${signal.action} (confidence: ${signal.confidence})`);
      signals.push(signal);
      tickSignals.push(signal);
    }
    return signals;
  }

  function pickBestSignal(signals: Signal[]): Signal | null {
    const actionSignals = signals.filter((s) => s.action !== 'hold');
    if (actionSignals.length === 0) return null;
    return actionSignals.sort((a, b) => b.confidence - a.confidence)[0];
  }

  // A sell signal exits the open long with its full quantity. Sizing the
  // exit from tradeAmount instead would leave coins untracked when the price
  // rose, or oversell (and open an untracked short on futures) when it fell.
  async function closeLongOnSignal(pos: Position, signal: Signal): Promise<void> {
    if (closingPositions.has(pos.id)) {
      logger.debug(`[tick] ${pos.symbol}: position ${pos.id} is already closing — skipping sell signal`);
      return;
    }
    closingPositions.add(pos.id);
    try {
      const orderResult = await exchange.closePosition(pos.symbol, pos.side, pos.quantity, pos.marketType);
      if (orderResult.status !== 'filled' && orderResult.status !== 'partial') return;
      const exitPrice = orderResult.price || pos.currentPrice;
      const pnl = (exitPrice - pos.entryPrice) * pos.quantity;
      recordTrade(pos.symbol, signal, { ...orderResult, price: exitPrice, quantity: orderResult.quantity || pos.quantity }, pos.amount, pnl, 'bot');
      db.removePosition(userId, pos.id);
      logger.info(`[position] Closed: ${pos.symbol} entry=${pos.entryPrice} exit=${exitPrice} pnl=$${pnl.toFixed(2)}`);
    } finally {
      closingPositions.delete(pos.id);
    }
  }

  function isTestnet(): boolean {
    const user = db.getUserById(userId);
    return user?.exchangeTestnet ?? false;
  }

  // Exchange name and testnet only apply to live-mode records — paper trades
  // are simulated locally by the paper adapter and never touch a real exchange,
  // so stamping them with "bybit" / "testnet" badges would be misleading.
  function isLive(): boolean { return config.mode === 'live'; }
  function recordExchange(): string { return isLive() ? exchange.name : ''; }
  function recordTestnet(): boolean { return isLive() && isTestnet(); }

  function recordTrade(
    symbol: string,
    signal: Signal,
    orderResult: { orderId: string; price: number; quantity: number },
    amount: number,
    pnl: number,
    closeReason: CloseReason | null = null,
  ): void {
    const trade: Trade = {
      id: randomUUID(), symbol, side: signal.action as 'buy' | 'sell',
      price: orderResult.price, quantity: orderResult.quantity, amount,
      strategy: signal.strategy, mode: config.mode, marketType: signal.marketType,
      orderId: orderResult.orderId, pnl, timestamp: Date.now(), userId,
      testnet: recordTestnet(), exchange: recordExchange(),
      closeReason,
    };
    db.insertTrade(trade);
    tickStats.orders++;
    broadcaster.broadcast({ type: WS_EVENTS.TRADE_EXECUTED, data: trade });
    logger.info(`[trade] Executed: ${trade.side} ${trade.quantity} ${symbol} @ ${trade.price} pnl=$${pnl.toFixed(2)}`);
  }

  function openBuyPosition(symbol: string, signal: Signal, orderResult: { price: number; quantity: number }, amount: number, stopLoss: number | null): void {
    db.upsertPosition({
      id: randomUUID(), symbol, side: 'buy', entryPrice: orderResult.price,
      quantity: orderResult.quantity, amount, currentPrice: orderResult.price,
      pnl: 0, pnlPct: 0, strategy: signal.strategy, mode: config.mode,
      marketType: signal.marketType, stopLoss, openedAt: Date.now(), userId,
      testnet: recordTestnet(), exchange: recordExchange(),
    });
    logger.info(`[position] Opened: ${symbol} @ ${orderResult.price}, SL: ${stopLoss}`);
  }

  async function fetchBalanceForTick(): Promise<{ free: number; totalEquity: number } | null> {
    try {
      const bal = await exchange.fetchBalance();
      return { free: bal.free, totalEquity: bal.totalEquity };
    } catch (err) {
      logger.error(`[tick] Failed to fetch balance: ${err}`);
      return null;
    }
  }

  function applyFilledBuy(
    asset: { symbol: string },
    signal: Signal,
    orderResult: { orderId: string; price: number; quantity: number },
    riskResult: { amount: number; stopLoss: number },
  ): void {
    recordTrade(asset.symbol, signal, orderResult, riskResult.amount, 0, null);
    openBuyPosition(asset.symbol, signal, orderResult, riskResult.amount, riskResult.stopLoss);
  }

  async function processAsset(
    asset: typeof config.assets[number],
    enabledStrategies: typeof config.strategies,
    availableBalance: number,
  ): Promise<void> {
    const signals = await collectSignals(asset.symbol, asset.marketType, enabledStrategies);
    // The bot can be stopped or killed while this tick waits on the exchange.
    if (status !== 'running') return;
    const bestSignal = pickBestSignal(signals);
    if (!bestSignal) {
      logger.debug(`[tick] ${asset.symbol}: all strategies say hold`);
      return;
    }

    logger.debug(`[tick] ${asset.symbol}: best signal is ${bestSignal.action} from ${bestSignal.strategy} (confidence: ${bestSignal.confidence})`);
    const openPositions = db.getOpenPositions(userId);

    // A `sell` signal is only meaningful if there is an open long to close.
    // Submitting a bare sell would (a) in paper mode mint free cash via the
    // adapter's sell-credit shortcut, and (b) in live futures open a real
    // short position the bot never tracks. The bot is long-only by design.
    const openLong = openPositions.find((p) => p.symbol === asset.symbol && p.side === 'buy');
    if (bestSignal.action === 'sell' && !openLong) {
      logger.debug(`[tick] ${asset.symbol}: sell signal with no matching long — skipping (bot is long-only)`);
      return;
    }
    // One long per symbol. A signal can stay true for many ticks (for example
    // RSI below 30 for 20 minutes); without this check every tick buys again.
    if (bestSignal.action === 'buy' && openLong) {
      logger.debug(`[tick] ${asset.symbol}: buy signal but a long is already open — skipping`);
      return;
    }

    const riskResult = riskManager.evaluate({
      symbol: asset.symbol, side: bestSignal.action as 'buy' | 'sell',
      price: bestSignal.price, openPositions: openPositions.length, dailyLoss: getDailyLoss(),
      confidence: bestSignal.confidence, availableBalance,
    });
    if (!riskResult.approved) {
      logger.debug(`[tick] ${asset.symbol}: risk manager rejected — ${riskResult.reason}`);
      return;
    }

    if (status !== 'running') return;

    if (bestSignal.action === 'sell') {
      await closeLongOnSignal(openLong!, bestSignal);
      return;
    }

    logger.debug(`[tick] ${asset.symbol}: placing buy order, amount: ${riskResult.amount}`);
    const orderResult = await exchange.placeOrder({
      symbol: asset.symbol, side: 'buy',
      amount: riskResult.amount, type: config.orderType, marketType: asset.marketType,
    });
    logger.debug(`[tick] ${asset.symbol}: order ${orderResult.status} — price: ${orderResult.price}, qty: ${orderResult.quantity}`);

    // Record a fill even if the bot stopped while the order was in flight:
    // the order exists on the exchange, so the position must be tracked.
    if (orderResult.status === 'filled' || orderResult.status === 'partial') {
      applyFilledBuy(asset, bestSignal, orderResult, riskResult);
    }
  }

  async function executeTick(): Promise<void> {
    const enabledAssets = config.assets.filter((a) => a.enabled);
    const enabledStrategies = config.strategies.filter((s) => s.enabled);
    logger.debug(`[tick] Processing ${enabledAssets.length} assets with ${enabledStrategies.length} strategies`);

    await updatePositionPnl();

    let lastBalance: { free: number; totalEquity: number } | null = null;
    for (const asset of enabledAssets) {
      if (status !== 'running') break;
      tickStats.assets++;
      try {
        const balance = await fetchBalanceForTick();
        if (balance !== null) lastBalance = balance;
        await processAsset(asset, enabledStrategies, balance?.free ?? 0);
      } catch (err) {
        tickStats.errors++;
        logger.error(`[tick] ${asset.symbol}: error processing asset — ${err}`);
        broadcaster.broadcast({
          type: WS_EVENTS.ALERT,
          data: { message: `Failed to process ${asset.symbol}: ${(err as Error).message}`, severity: 'warning' },
        });
      }
    }

    if (lastBalance !== null) {
      try {
        db.upsertDailyEquitySnapshot(userId, lastBalance.totalEquity);
      } catch (err) {
        logger.error(`[tick] Failed to snapshot equity: ${err}`);
      }
    }
  }

  return {
    start() {
      if (status === 'running') { logger.info('[orchestrator] Already running, ignoring start'); return; }
      status = 'running';
      logger.info(`[orchestrator] Started in ${config.mode} mode`);
      logger.info(`[orchestrator] Assets: ${config.assets.filter(a => a.enabled).map(a => a.symbol).join(', ')}`);
      logger.info(`[orchestrator] Strategies: ${config.strategies.filter(s => s.enabled).map(s => s.name).join(', ')}`);
      riskManager.updateConfig(riskConfigFromBotConfig(config));
      broadcaster.broadcast({ type: WS_EVENTS.BOT_STATUS, data: { status: 'running', mode: config.mode } });
    },
    stop() {
      if (status === 'stopped') { logger.info('[orchestrator] Already stopped, ignoring stop'); return; }
      status = 'stopped';
      logger.info('[orchestrator] Stopped');
      broadcaster.broadcast({ type: WS_EVENTS.BOT_STATUS, data: { status: 'stopped', mode: config.mode } });
    },
    async tick() {
      if (status !== 'running') return;
      const startedAt = Date.now();
      tickStats = { assets: 0, orders: 0, errors: 0 };
      tickSignals = [];
      const run = executeTick();
      inFlightTick = run;
      try {
        await run;
      } finally {
        if (inFlightTick === run) inFlightTick = null;
      }
      lastTickAt = Date.now();
      if (tickSignals.length > 0) {
        broadcaster.broadcast({ type: WS_EVENTS.SIGNALS_BATCH, data: tickSignals });
      }
      broadcaster.broadcast({ type: WS_EVENTS.TICK_COMPLETE, data: { lastTickAt } } as any);
      logger.info(
        `[tick] user=${userId} assets=${tickStats.assets} signals=${tickSignals.length} `
        + `orders=${tickStats.orders} errors=${tickStats.errors} duration=${lastTickAt - startedAt}ms`,
      );
    },
    isIdle() {
      return inFlightTick === null;
    },
    async killSwitch(reason: 'user' | 'admin') {
      this.stop();
      // Wait for a running tick to finish. Otherwise an order that the tick
      // already sent can fill after the positions below are closed, and leave
      // an open position on a killed bot.
      await waitForIdle();
      const positions = db.getOpenPositions(userId);
      await Promise.all(positions.map(async (pos) => {
        try {
          const orderResult = await exchange.closePosition(pos.symbol, pos.side, pos.quantity, pos.marketType);
          const exitPrice = orderResult.price || pos.currentPrice;
          const realizedPnl = (exitPrice - pos.entryPrice) * pos.quantity;
          const trade: Trade = {
            id: randomUUID(), symbol: pos.symbol, side: 'sell',
            price: exitPrice, quantity: orderResult.quantity || pos.quantity, amount: pos.amount,
            strategy: pos.strategy, mode: config.mode, marketType: pos.marketType,
            orderId: orderResult.orderId, pnl: realizedPnl, timestamp: Date.now(), userId,
            testnet: recordTestnet(), exchange: recordExchange(),
            closeReason: reason,
          };
          // Insert the trade row BEFORE removing the position so a DB failure
          // on insertTrade doesn't leave the position wiped with no audit trail.
          db.insertTrade(trade);
          db.removePosition(userId, pos.id);
          broadcaster.broadcast({ type: WS_EVENTS.TRADE_EXECUTED, data: trade });
        } catch (err) {
          logger.error(`[killSwitch] Failed to close ${pos.symbol}: ${err}`);
          // Kill switch's contract is "get me out now" — even on exchange
          // failure we preserve the audit trail by writing an estimate trade
          // row. The exit price is pos.currentPrice (the best estimate we
          // have when the real fill is unknown). Task 7 pins this with a test.
          const exitPrice = pos.currentPrice;
          const realizedPnl = (exitPrice - pos.entryPrice) * pos.quantity;
          const trade: Trade = {
            id: randomUUID(), symbol: pos.symbol, side: 'sell',
            price: exitPrice, quantity: pos.quantity, amount: pos.amount,
            strategy: pos.strategy, mode: config.mode, marketType: pos.marketType,
            orderId: '', pnl: realizedPnl, timestamp: Date.now(), userId,
            testnet: recordTestnet(), exchange: recordExchange(),
            closeReason: reason,
          };
          try { db.insertTrade(trade); } catch (ierr) {
            logger.error(`[killSwitch] audit insert failed for ${pos.symbol}: ${ierr}`);
          }
          db.removePosition(userId, pos.id);
          broadcaster.broadcast({ type: WS_EVENTS.TRADE_EXECUTED, data: trade });
        }
      }));
      broadcaster.broadcast({ type: WS_EVENTS.ALERT, data: { message: ERROR_MSG.KILL_SWITCH_ACTIVATED, severity: 'critical' } });
    },
    async closePositionManually(positionId: string, reason: CloseReason = 'user') {
      const positions = db.getOpenPositions(userId);
      const pos = positions.find((p) => p.id === positionId);
      if (!pos) throw new Error(`Position ${positionId} not found`);
      if (closingPositions.has(pos.id)) throw new Error(`Already closing position ${pos.id}`);
      closingPositions.add(pos.id);
      try {
        let orderResult: Awaited<ReturnType<typeof exchange.closePosition>>;
        try {
          orderResult = await exchange.closePosition(pos.symbol, pos.side, pos.quantity, pos.marketType);
        } catch (err) {
          logger.error(`[closePositionManually] Failed to close ${pos.symbol}: ${err}`);
          broadcaster.broadcast({
            type: WS_EVENTS.ALERT,
            data: { message: `Failed to close ${pos.symbol}: ${(err as Error).message}`, severity: 'critical' },
          });
          throw err;
        }
        const exitPrice = orderResult.price || pos.currentPrice;
        const realizedPnl = (exitPrice - pos.entryPrice) * pos.quantity;
        const trade: Trade = {
          id: randomUUID(), symbol: pos.symbol, side: 'sell',
          price: exitPrice, quantity: orderResult.quantity || pos.quantity, amount: pos.amount,
          strategy: pos.strategy, mode: config.mode, marketType: pos.marketType,
          orderId: orderResult.orderId, pnl: realizedPnl, timestamp: Date.now(), userId,
          testnet: recordTestnet(), exchange: recordExchange(),
          closeReason: reason,
        };
        // Insert the trade row BEFORE removing the position so a DB failure
        // here never produces a silent wipe (same invariant as tick-loop closes).
        db.insertTrade(trade);
        db.removePosition(userId, pos.id);
        broadcaster.broadcast({ type: WS_EVENTS.TRADE_EXECUTED, data: trade });
      } finally {
        closingPositions.delete(pos.id);
      }
    },
    getStatus() { return status; },
    getLastTickAt() { return lastTickAt; },
    getConfig() { return { ...config }; },
    updateConfig(update: Partial<BotConfig>) {
      config = { ...config, ...update };
      const riskFieldsChanged = update.tradeAmount !== undefined
        || update.stopLossPct !== undefined
        || update.dailyLossLimit !== undefined
        || update.maxOpenPositions !== undefined
        || update.minConfidence !== undefined;
      if (riskFieldsChanged) riskManager.updateConfig(riskConfigFromBotConfig(config));
    },
  };
}
