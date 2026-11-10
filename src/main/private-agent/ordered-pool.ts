/**
 * Backlog item 8 (finding D12 of docs/PROJECT_REVIEW_2026-11-05.md; §5.2 "Local fan-out"): independent zero-risk local calls
 * run K at a time while their results are applied strictly in item order, so a stage's counts, ids and files come out as the
 * serial loop would make them. This module is the pool only. It dispatches nothing itself and has no caller until item 8's
 * loops adopt it (8.2b), under the ledger's concurrent admission (8.1); with K = 1 it is exactly the serial loop.
 *
 * Rules:
 * - Items launch in item order. At most `limit` items are launched and not yet applied at any time, so a slot is refilled only
 *   after an apply: with K = 1 the order is launch, settle, apply, launch. Nothing launches once the stage's signal has aborted.
 * - `apply` sees every launched item exactly once, in item order: its value, or the error its launch threw or rejected with.
 *   It returns what follows: continue, stop launching, or stop launching and abort the in-flight siblings.
 * - `interrupt` sees each outcome as soon as it settles, before its turn to be applied, and may stop launching or abort the
 *   siblings at once (a denial), instead of waiting for the earlier items still in flight. Its outcome is still applied in turn.
 * - Each launch gets its own signal, aborted when the stage's signal aborts or when the pool aborts the siblings. An outcome is
 *   marked `afterAbort` when the pool's own sibling abort had reached its signal by the time it settled (the stage's own abort
 *   never marks it). A call that failed for its own reason at that same moment is marked too, so the caller confirms a sibling
 *   stop by what the call reports about its signal (the pipeline's `call()` answers `cancelled`).
 * - The pool returns or throws only after every launched item has settled: no call is ever left in flight behind it. A throw
 *   from `apply`, `interrupt` or `beforeLaunch` stops launching, aborts the siblings, drains them, and is then rethrown.
 */

export const ORDERED_POOL_MAX_LIMIT = 8;
export type PoolOutcome<R> = { status: "fulfilled"; value: R } | { status: "rejected"; error: unknown };
/** What follows: keep launching, stop launching (in-flight items finish), or stop and abort the in-flight items. */
export type PoolDecision = "continue" | "stop" | "abort";
export interface OrderedPoolOptions<T, R> {
  readonly items: readonly T[];
  /** K, an integer from 1 to ORDERED_POOL_MAX_LIMIT: the most items launched and not yet applied. */
  readonly limit: number;
  /** The stage's signal. The pool never aborts it; it aborts only its own launches. */
  readonly signal: AbortSignal;
  /** Checked in item order just before each launch, once a slot is free; false stops launching (the judge's pause and deadline checks). */
  readonly beforeLaunch?: (item: T, index: number) => boolean;
  readonly launch: (item: T, index: number, signal: AbortSignal) => Promise<R>;
  /** Called as each outcome settles, in completion order, before its apply. A void return continues. */
  readonly interrupt?: (outcome: PoolOutcome<R>, item: T, index: number) => PoolDecision | void;
  /** Called once per launched item, strictly in item order. A void return continues. */
  readonly apply: (outcome: PoolOutcome<R>, item: T, index: number, context: { afterAbort: boolean }) => PoolDecision | void;
}
export interface OrderedPoolResult {
  /** Items launched: a prefix of `items`. */
  launched: number;
  /** Items applied: equal to `launched` unless a callback threw. */
  applied: number;
  /** Whether some items were never launched. */
  stopped: boolean;
  /** Whether the pool's sibling abort reached at least one launched call before it settled. */
  aborted: boolean;
}

export async function runOrderedPool<T, R>(options: OrderedPoolOptions<T, R>): Promise<OrderedPoolResult> {
  const { items, limit } = options;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ORDERED_POOL_MAX_LIMIT) throw new Error("ordered_pool_limit_invalid");
  // One combined signal per pool, and one relay listener per in-flight launch on it: at most K listeners, whatever each call
  // adds to its own signal (the broker, token admission and backoff each add one), so K = 8 stays under Node's warning limit.
  const siblings = new AbortController(), siblingStop = new Error("ordered_pool_sibling_stop"), combined = AbortSignal.any([options.signal, siblings.signal]);
  const settled = new Map<number, { outcome: PoolOutcome<R>; afterAbort: boolean }>(), inFlight = new Map<number, Promise<void>>();
  let next = 0, applyNext = 0, stopped = false, reached = false, failure: { error: unknown } | undefined;
  const abort = () => { stopped = true; if (!siblings.signal.aborted) siblings.abort(siblingStop); };
  const fail = (error: unknown) => { if (!failure) failure = { error }; abort(); };
  const decide = (decision: PoolDecision | void) => { if (decision === "abort") abort(); else if (decision === "stop") stopped = true; };
  const start = (index: number) => {
    const item = items[index]!, child = new AbortController(), relay = () => child.abort(combined.reason);
    if (combined.aborted) child.abort(combined.reason); else combined.addEventListener("abort", relay, { once: true });
    let call: Promise<R>;
    try { call = Promise.resolve(options.launch(item, index, child.signal)); } catch (error) { call = Promise.reject(error); }
    // The label is read in the first reaction, as the call settles: only the pool's own abort, not the stage's, marks it.
    const label = () => child.signal.aborted && child.signal.reason === siblingStop;
    const done = call.then(value => ({ outcome: { status: "fulfilled" as const, value }, afterAbort: label() }),
      (error: unknown) => ({ outcome: { status: "rejected" as const, error }, afterAbort: label() })).then(({ outcome, afterAbort }) => {
      combined.removeEventListener("abort", relay);
      if (afterAbort) reached = true;
      settled.set(index, { outcome, afterAbort });
      inFlight.delete(index);
      if (!failure && options.interrupt) { try { decide(options.interrupt(outcome, item, index)); } catch (error) { fail(error); } }
    });
    inFlight.set(index, done);
  };
  const applyReady = () => {
    while (!failure && settled.has(applyNext)) {
      const { outcome, afterAbort } = settled.get(applyNext)!; settled.delete(applyNext);
      let decision: PoolDecision | void;
      try { decision = options.apply(outcome, items[applyNext]!, applyNext, { afterAbort }); } catch (error) { fail(error); return; }
      applyNext++;
      decide(decision);
    }
  };
  const fill = () => {
    while (!stopped && !failure && !options.signal.aborted && next < items.length && next - applyNext < limit) {
      let admitted: boolean;
      try { admitted = options.beforeLaunch ? options.beforeLaunch(items[next]!, next) : true; } catch (error) { fail(error); return; }
      if (!admitted) { stopped = true; return; }
      start(next++);
    }
  };
  fill();
  while (inFlight.size) {
    await Promise.race(inFlight.values());
    applyReady();
    fill();
  }
  // Every launch has settled. After a callback's throw nothing more is applied; otherwise every launch has been applied.
  if (failure) throw failure.error;
  return { launched: next, applied: applyNext, stopped: next < items.length, aborted: reached };
}
