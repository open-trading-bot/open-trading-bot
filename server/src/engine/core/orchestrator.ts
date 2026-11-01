import { randomUUID } from 'crypto';
import type { ExchangeAdapter } from '../../exchange/types.js';
import type { Db } from '../../db/index.js';
import type { WsBroadcaster } from '../../websocket/index.js';
import type { BotConfig, BotStatus, CloseReason, Position, Signal, Trade } from '../../types/index.js';
import { getStrategy } from '../strategies/index.js';
import { createRiskManager, type RiskManager } from '../risk/index.js';
import logger from '../../utils/logger.js';
import { WS_EVENTS, ERROR_MSG } from '../../utils/constants.js';

export interface Orchestrator {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
  killSwitch(reason: 'user' | 'admin'): Promise<void>;
  closePositionManually(positionId: string, reason?: CloseReason): Promise<void>;
  getStatus(): BotStatus;
  getLastTickAt(): number | null;
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
      logger.info(`[tick] Fetching candles for ${symbol} (${interval})`);
      const candles = await exchange.fetchCandles(symbol, interval);
      logger.info(`[tick] Got ${candles.length} candles for ${symbol} (${interval})`);
      db.insertCandles(symbol, interval, candles);
      candlesByInterval.set(interval, candles);
    }

    const signals: Signal[] = [];
    for (const stratConfig of strategies) {
      const strategy = getStrategy(stratConfig.id);
      if (!strategy) { logger.info(`[tick] Strategy ${stratConfig.id} not found, skipping`); continue; }
      const candles = candlesByInterval.get(stratConfig.interval)!;
      const signal = strategy.analyze(candles, stratConfig.params, symbol, marketType as any);
      logger.info(`[tick] ${stratConfig.name} → ${symbol}: ${signal.action} (confidence: ${signal.confidence})`);
      signals.push(signal);
      broadcaster.broadcast({ type: WS_EVENTS.SIGNAL_GENERATED, data: signal });
    }
    return signals;
  }

  function pickBestSignal(signals: Signal[]): Signal | null {
    const actionSignals = signals.filter((s) => s.action !== 'hold');
    if (actionSignals.length === 0) return null;
    return actionSignals.sort((a, b) => b.confidence - a.confidence)[0];
  }

  function closeSellPosition(symbol: string, exitPrice: number, openPositions: Position[]): number | null {
    const match = openPositions.find((p) => p.symbol === symbol && p.side === 'buy');
    if (!match) return null;
    const pnl = (exitPrice - match.entryPrice) * match.quantity;
    db.removePosition(userId, match.id);
    logger.info(`[position] Closed: ${symbol} entry=${match.entryPrice} exit=${exitPrice} pnl=$${pnl.toFixed(2)}`);
    return pnl;
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

  function applyFilledOrder(
    asset: { symbol: string; marketType: string },
    signal: Signal,
    orderResult: { orderId: string; price: number; quantity: number },
    riskResult: { amount: number; stopLoss: number },
    openPositions: Position[],
  ): void {
    const pnl = signal.action === 'sell'
      ? closeSellPosition(asset.symbol, orderResult.price, openPositions)
      : null;
    // Only stamp a close reason when a sell signal actually closed an existing
    // long. A bare sell with no matching position is not a close (it's a
    // no-op trade row) and should leave closeReason null.
    const closeReason: CloseReason | null = signal.action === 'sell' && pnl !== null ? 'bot' : null;
    recordTrade(asset.symbol, signal, orderResult, riskResult.amount, pnl ?? 0, closeReason);
    if (signal.action === 'buy') {
      openBuyPosition(asset.symbol, signal, orderResult, riskResult.amount, riskResult.stopLoss);
    }
  }

  async function processAsset(
    asset: typeof config.assets[number],
    enabledStrategies: typeof config.strategies,
    availableBalance: number,
  ): Promise<void> {
    const signals = await collectSignals(asset.symbol, asset.marketType, enabledStrategies);
    const bestSignal = pickBestSignal(signals);
    if (!bestSignal) {
      logger.info(`[tick] ${asset.symbol}: all strategies say hold`);
      return;
    }

    logger.info(`[tick] ${asset.symbol}: best signal is ${bestSignal.action} from ${bestSignal.strategy} (confidence: ${bestSignal.confidence})`);
    const openPositions = db.getOpenPositions(userId);

    // A `sell` signal is only meaningful if there is an open long to close.
    // Submitting a bare sell would (a) in paper mode mint free cash via the
    // adapter's sell-credit shortcut, and (b) in live futures open a real
    // short position the bot never tracks. The bot is long-only by design.
    if (bestSignal.action === 'sell') {
      const hasMatchingLong = openPositions.some(
        (p) => p.symbol === asset.symbol && p.side === 'buy',
      );
      if (!hasMatchingLong) {
        logger.info(`[tick] ${asset.symbol}: sell signal with no matching long — skipping (bot is long-only)`);
        return;
      }
    }

    const riskResult = riskManager.evaluate({
      symbol: asset.symbol, side: bestSignal.action as 'buy' | 'sell',
      price: bestSignal.price, openPositions: openPositions.length, dailyLoss: getDailyLoss(),
      confidence: bestSignal.confidence, availableBalance,
    });
    if (!riskResult.approved) {
      logger.info(`[tick] ${asset.symbol}: risk manager rejected — ${riskResult.reason}`);
      return;
    }

    logger.info(`[tick] ${asset.symbol}: placing ${bestSignal.action} order, amount: ${riskResult.amount}`);
    const orderResult = await exchange.placeOrder({
      symbol: asset.symbol, side: bestSignal.action as 'buy' | 'sell',
      amount: riskResult.amount, type: config.orderType, marketType: asset.marketType,
    });
    logger.info(`[tick] ${asset.symbol}: order ${orderResult.status} — price: ${orderResult.price}, qty: ${orderResult.quantity}`);

    if (orderResult.status === 'filled' || orderResult.status === 'partial') {
      applyFilledOrder(asset, bestSignal, orderResult, riskResult, openPositions);
    }
  }

  async function executeTick(): Promise<void> {
    const enabledAssets = config.assets.filter((a) => a.enabled);
    const enabledStrategies = config.strategies.filter((s) => s.enabled);
    logger.info(`[tick] Processing ${enabledAssets.length} assets with ${enabledStrategies.length} strategies`);

    await updatePositionPnl();

    let lastBalance: { free: number; totalEquity: number } | null = null;
    for (const asset of enabledAssets) {
      try {
        const balance = await fetchBalanceForTick();
        if (balance !== null) lastBalance = balance;
        await processAsset(asset, enabledStrategies, balance?.free ?? 0);
      } catch (err) {
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
      logger.info(`[tick] Running tick at ${new Date().toISOString()}`);
      await executeTick();
      lastTickAt = Date.now();
      broadcaster.broadcast({ type: WS_EVENTS.TICK_COMPLETE, data: { lastTickAt } } as any);
      logger.info('[tick] Tick complete');
    },
    async killSwitch(reason: 'user' | 'admin') {
      this.stop();
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
