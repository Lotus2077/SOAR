import { expect, vi } from "vitest";
import type { DispatchReceipt } from "../../src/main/private-agent/store";

/**
 * The broker's retry invariant (E1-R): a `superseded` row is always followed by its successor, a later row of the same packet under the
 * same policy revision. Later rows, not the next one, so the check also holds once item 8 interleaves sibling rows.
 */
export function everySupersededRowHasASuccessor(rows: readonly DispatchReceipt[]): void {
  rows.forEach((row, index) => {
    if (row.status !== "superseded") return;
    const successor = rows.slice(index + 1).find(next => next.packetSha256 === row.packetSha256 && next.purpose === row.purpose && next.contextId === row.contextId &&
      next.destinationId === row.destinationId && next.policyRevision === row.policyRevision);
    expect(successor, `superseded row ${index} has no successor`).toBeDefined();
  });
}

/**
 * Watches the timers the code under test starts and returns every timeout requested. When a timer of exactly `ms` starts, `then` runs once,
 * in the next microtask: the broker is then inside that wait, with its abort listener attached, and nothing else has happened. A test can
 * so cancel or change a job during a retry wait deterministically, never by guessing a delay. The spy is removed by `cleanups`.
 * Precondition: `ms` differs from every timer the code starts before that wait (the destination's transport timeout, the Anthropic
 * error-body timer of 2,000 ms), or `then` runs at the wrong moment.
 */
export function watchWaits(cleanups: (() => void | Promise<void>)[], ms?: number, then?: () => void): number[] {
  const real = globalThis.setTimeout, waits: number[] = [];
  let pending = then;
  const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: (...args: unknown[]) => void, timeout?: number, ...rest: unknown[]) => {
    waits.push(timeout ?? 0);
    const timer = real(handler, timeout, ...rest);
    if (pending && timeout === ms) { const run = pending; pending = undefined; queueMicrotask(run); }
    return timer;
  }) as unknown as typeof setTimeout);
  cleanups.push(() => spy.mockRestore());
  return waits;
}
