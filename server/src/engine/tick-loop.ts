import type { Orchestrator } from './core/orchestrator.js';
import type { BotConfig } from '../types/index.js';
import logger from '../utils/logger.js';

// We deliberately don't force-release a stuck in-flight flag: a hung await
// inside executeTick cannot be cancelled in JS, so starting a parallel tick
// would race two processAsset chains and risk duplicate orders. Instead, log
// loudly so the situation is visible. A genuinely-hung tick will resolve
// when the underlying promise eventually settles (e.g. ccxt's nominal 10s
// timeout), or require operator restart.
const STUCK_LOG_MULTIPLIER = 3;

export function createTickLoop(orchestrator: Orchestrator) {
  let tickLoop: ReturnType<typeof setInterval> | null = null;
  let tickInFlight = false;
  let tickStartedAt: number | null = null;
  let tickCounter = 0;
  let stuckLogged = false;
  const originalStart = orchestrator.start.bind(orchestrator);
  const originalStop = orchestrator.stop.bind(orchestrator);

  function intervalMs(): number {
    return orchestrator.getConfig().tickInterval * 1000;
  }

  async function runGuardedTick() {
    if (tickInFlight) {
      const stuckFor = tickStartedAt ? Date.now() - tickStartedAt : 0;
      if (stuckFor > intervalMs() * STUCK_LOG_MULTIPLIER && !stuckLogged) {
        logger.error(`[tick-watchdog] Tick stuck for ${Math.round(stuckFor / 1000)}s — bot is not making progress; will not start a parallel tick (would risk duplicate orders). Manual restart may be required if the underlying await never settles.`);
        stuckLogged = true;
      } else {
        logger.warn(`[server] Previous tick still running (${Math.round(stuckFor / 1000)}s), skipping this interval`);
      }
      return;
    }
    tickInFlight = true;
    tickStartedAt = Date.now();
    stuckLogged = false;
    const ticketId = ++tickCounter;
    try {
      await orchestrator.tick();
    } catch (err) {
      logger.error(`[tick-loop] tick #${ticketId} threw: ${(err as Error)?.stack ?? err}`);
    } finally {
      tickInFlight = false;
      tickStartedAt = null;
    }
  }

  function startLoop() {
    if (tickLoop) { clearInterval(tickLoop); tickLoop = null; }
    const interval = intervalMs();
    logger.info(`[server] Tick loop started (${orchestrator.getConfig().tickInterval}s interval)`);
    tickLoop = setInterval(() => { runGuardedTick(); }, interval);
    runGuardedTick();
  }

  return {
    ...orchestrator,
    start() { originalStart(); if (!tickLoop) { startLoop(); } },
    stop() { originalStop(); if (tickLoop) { logger.info('[server] Tick loop stopped'); clearInterval(tickLoop); tickLoop = null; } },
    updateConfig(update: Partial<BotConfig>) {
      orchestrator.updateConfig(update);
      if (update.tickInterval && tickLoop) {
        logger.info(`[server] Tick interval changed to ${update.tickInterval}s, restarting loop`);
        startLoop();
      }
    },
  };
}
