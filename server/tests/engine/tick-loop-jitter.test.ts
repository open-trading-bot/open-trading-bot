import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTickLoop } from '../../src/engine/tick-loop.js';

function fakeOrchestrator() {
  let status = 'stopped';
  return {
    start: vi.fn(() => { status = 'running'; }),
    stop: vi.fn(() => { status = 'stopped'; }),
    tick: vi.fn().mockResolvedValue(undefined),
    killSwitch: vi.fn(), closePositionManually: vi.fn(),
    getStatus: () => status, getLastTickAt: () => null,
    getConfig: () => ({ tickInterval: 60 }) as any,
    updateConfig: vi.fn(),
  };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Tick loop jitter (P1)', () => {
  it('ticks at once, then on a random offset inside the first interval', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const orch = fakeOrchestrator();
    const loop = createTickLoop(orch as any);
    loop.start();
    expect(orch.tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(orch.tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(orch.tick).toHaveBeenCalledTimes(3);
    loop.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(orch.tick).toHaveBeenCalledTimes(3);
  });

  it('stop before the offset timer fires cancels it', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const orch = fakeOrchestrator();
    const loop = createTickLoop(orch as any);
    loop.start();
    loop.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(orch.tick).toHaveBeenCalledTimes(1);
  });
});
