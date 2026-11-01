import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTickLoop } from '../src/engine/tick-loop.js';
import type { Orchestrator } from '../src/engine/core/orchestrator.js';
import logger from '../src/utils/logger.js';

function mockOrchestrator(tickInterval = 10): Orchestrator {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    tick: vi.fn().mockResolvedValue(undefined),
    killSwitch: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue('stopped'),
    getLastTickAt: vi.fn().mockReturnValue(null),
    getConfig: vi.fn().mockReturnValue({ tickInterval, mode: 'paper' }),
    updateConfig: vi.fn(),
  };
}

describe('createTickLoop', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('start() calls orchestrator.start and begins ticking', () => {
    const orch = mockOrchestrator(10);
    const loop = createTickLoop(orch);
    loop.start();
    expect(orch.start).toHaveBeenCalled();
    // tick() is called immediately on start
    expect(orch.tick).toHaveBeenCalledTimes(1);
  });

  it('ticks at the configured interval', async () => {
    const orch = mockOrchestrator(10);
    const loop = createTickLoop(orch);
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(orch.tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(orch.tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(orch.tick).toHaveBeenCalledTimes(3);
  });

  it('stop() calls orchestrator.stop and stops ticking', () => {
    const orch = mockOrchestrator(10);
    const loop = createTickLoop(orch);
    loop.start();
    loop.stop();
    expect(orch.stop).toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    // Only the initial tick from start, none after stop
    expect(orch.tick).toHaveBeenCalledTimes(1);
  });

  it('updateConfig restarts loop when tickInterval changes', async () => {
    const orch = mockOrchestrator(10);
    const loop = createTickLoop(orch);
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(orch.tick).toHaveBeenCalledTimes(1);

    // Update tickInterval — getConfig should return new value
    (orch.getConfig as any).mockReturnValue({ tickInterval: 5, mode: 'paper' });
    loop.updateConfig({ tickInterval: 5 });
    expect(orch.updateConfig).toHaveBeenCalledWith({ tickInterval: 5 });
    // startLoop calls tick() immediately again
    await vi.advanceTimersByTimeAsync(0);
    expect(orch.tick).toHaveBeenCalledTimes(2);
  });

  it('updateConfig does not restart loop when tickInterval not changed', () => {
    const orch = mockOrchestrator(10);
    const loop = createTickLoop(orch);
    loop.start();
    const initialTicks = (orch.tick as any).mock.calls.length;
    loop.updateConfig({ mode: 'live' } as any);
    expect(orch.updateConfig).toHaveBeenCalledWith({ mode: 'live' });
    // No extra tick from restart
    expect(orch.tick).toHaveBeenCalledTimes(initialTicks);
  });

  it('start() is idempotent — does not double-start', async () => {
    const orch = mockOrchestrator(10);
    const loop = createTickLoop(orch);
    loop.start();
    loop.start();
    await vi.advanceTimersByTimeAsync(10_000);
    // First start -> startLoop -> immediate tick + 1 interval tick
    // Second start -> tickLoop already set, skips startLoop
    expect(orch.tick).toHaveBeenCalledTimes(2);
  });

  it('skips an interval tick when the previous tick is still running', async () => {
    let resolveTick: () => void = () => {};
    const orch = mockOrchestrator(10);
    orch.tick = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolveTick = r; }),
    );
    const loop = createTickLoop(orch);
    loop.start();
    // Immediate tick fires and stays pending.
    expect(orch.tick).toHaveBeenCalledTimes(1);
    // Interval fires while the first tick is still in flight — should skip.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(orch.tick).toHaveBeenCalledTimes(1);
    // Resolve the first tick. The next interval can now run.
    resolveTick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(orch.tick).toHaveBeenCalledTimes(2);
  });

  it('stop() is safe when not started', () => {
    const orch = mockOrchestrator(10);
    const loop = createTickLoop(orch);
    expect(() => loop.stop()).not.toThrow();
    expect(orch.stop).toHaveBeenCalled();
  });

  it('spreads other orchestrator methods through', () => {
    const orch = mockOrchestrator(10);
    const loop = createTickLoop(orch);
    expect(loop.getStatus()).toBe('stopped');
    expect(loop.getLastTickAt()).toBeNull();
    expect(loop.getConfig()).toEqual({ tickInterval: 10, mode: 'paper' });
  });

  it('a thrown tick does not escape as an unhandled rejection', async () => {
    const orch = mockOrchestrator(10);
    orch.tick = vi.fn().mockRejectedValue(new Error('boom'));
    const loop = createTickLoop(orch);

    let unhandled = false;
    const onRejection = () => { unhandled = true; };
    process.on('unhandledRejection', onRejection);

    loop.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    await Promise.resolve();

    process.off('unhandledRejection', onRejection);
    expect(unhandled).toBe(false);
    expect(orch.tick).toHaveBeenCalledTimes(3);
  });

  it('a hung tick does NOT cause a parallel call — keeps skipping until the original resolves', async () => {
    const orch = mockOrchestrator(10);
    let firstResolve: () => void = () => {};
    orch.tick = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((r) => { firstResolve = r; }))
      .mockResolvedValue(undefined);

    const loop = createTickLoop(orch);
    loop.start();
    expect(orch.tick).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(orch.tick).toHaveBeenCalledTimes(1);

    firstResolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(orch.tick).toHaveBeenCalledTimes(2);
  });

  it('logs an error once when a tick is stuck past 3× interval (without force-releasing)', async () => {
    const orch = mockOrchestrator(10);
    let firstResolve: () => void = () => {};
    orch.tick = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((r) => { firstResolve = r; }))
      .mockResolvedValue(undefined);

    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    const loop = createTickLoop(orch);
    loop.start();

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
    }

    const stuckLogs = errSpy.mock.calls.flat().filter((m) => typeof m === 'string' && m.includes('[tick-watchdog]'));
    expect(stuckLogs.length).toBe(1);
    expect(stuckLogs[0]).toMatch(/will not start a parallel tick/);

    errSpy.mockRestore();
    firstResolve();
  });
});
