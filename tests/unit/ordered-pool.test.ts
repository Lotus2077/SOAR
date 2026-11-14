import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { ORDERED_POOL_MAX_LIMIT, orderedPoolLimit, runOrderedPool, type PoolOutcome } from "../../src/main/private-agent/ordered-pool";
import { MAX_LOCAL_STREAMS } from "../../src/main/private-agent/serving-card";

/** A call the test settles by hand: `resolve`/`reject` it, read the signal it was launched with. */
interface Deferred { index: number; signal: AbortSignal; done: boolean; resolve: (value: string) => void; reject: (error: unknown) => void }
function harness(count: number) {
  const calls: Deferred[] = [];
  let live = 0, peak = 0;
  const launch = (_item: number, index: number, signal: AbortSignal) => new Promise<string>((resolve, reject) => {
    live++; peak = Math.max(peak, live);
    const call: Deferred = { index, signal, done: false, resolve: value => { call.done = true; live--; resolve(value); }, reject: error => { call.done = true; live--; reject(error); } };
    calls.push(call);
  });
  return { items: Array.from({ length: count }, (_, i) => i), calls, launch, live: () => live, peak: () => peak, call: (index: number) => calls.find(call => call.index === index)! };
}
/** Lets every pending promise reaction run, so the pool reaches its next await. */
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const denied = (outcome: PoolOutcome<string>) => outcome.status === "fulfilled" && outcome.value.startsWith("denied");
/** The pipeline's rule (BL-20261114-1645 decision 2): a sibling stop is a `cancelled` reply applied with afterAbort, and nothing else. */
const siblingStop = (outcome: PoolOutcome<string>, afterAbort: boolean) => afterAbort && outcome.status === "fulfilled" && outcome.value === "denied cancelled";

describe("the ordered pool (backlog item 8)", () => {
  it("keeps at most K launched and not yet applied, and applies strictly in item order when calls finish in reverse", async () => {
    const h = harness(7), applied: number[] = [];
    let unapplied = 0, unappliedPeak = 0;
    const run = runOrderedPool({ items: h.items, limit: 3, signal: new AbortController().signal,
      launch: (item, index, signal) => { unapplied++; unappliedPeak = Math.max(unappliedPeak, unapplied); return h.launch(item, index, signal); },
      apply: (outcome, _item, index) => { unapplied--; applied.push(index); expect(outcome).toEqual({ status: "fulfilled", value: `reply ${index}` }); } });
    // Finish every launched call newest first; the pool still applies 0, 1, 2, ... and refills only after each apply.
    for (let round = 0; round < 7; round++) {
      await tick();
      for (const call of h.calls.filter(call => !call.done).sort((a, b) => b.index - a.index)) { call.resolve(`reply ${call.index}`); await tick(); }
    }
    expect(await run).toEqual({ launched: 7, applied: 7, stopped: false, aborted: false });
    expect(applied).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(h.peak()).toBeLessThanOrEqual(3);
    expect(unappliedPeak).toBeLessThanOrEqual(3);
  });

  it("reproduces the serial loop at K = 1: launch, settle, apply, then the next launch", async () => {
    const events: string[] = [];
    const result = await runOrderedPool({ items: ["a", "b", "c"], limit: 1, signal: new AbortController().signal,
      launch: async (item, index) => { events.push(`launch ${index}`); await tick(); events.push(`settle ${index}`); return item.toUpperCase(); },
      apply: (outcome, _item, index) => { events.push(`apply ${index} ${(outcome as { value: string }).value}`); } });
    expect(events).toEqual(["launch 0", "settle 0", "apply 0 A", "launch 1", "settle 1", "apply 1 B", "launch 2", "settle 2", "apply 2 C"]);
    expect(result).toEqual({ launched: 3, applied: 3, stopped: false, aborted: false });
  });

  it("on a denial stops launching, aborts and drains the siblings, applies every outcome in order, and marks the sibling stops", async () => {
    const h = harness(8), seen: { index: number; outcome: PoolOutcome<string>; afterAbort: boolean }[] = [];
    const run = runOrderedPool({ items: h.items, limit: 4, signal: new AbortController().signal, launch: h.launch,
      interrupt: outcome => denied(outcome) ? "abort" : undefined,
      apply: (outcome, _item, index, context) => { seen.push({ index, outcome, afterAbort: context.afterAbort }); } });
    await tick();
    expect(h.calls.map(call => call.index)).toEqual([0, 1, 2, 3]);
    // 3 settles first, then 2 is denied while 0 and 1 are still in flight: the pool aborts them at once, before 2's turn.
    h.call(3).resolve("reply 3"); await tick();
    h.call(2).resolve("denied budget_denied"); await tick();
    expect(h.call(0).signal.aborted && h.call(1).signal.aborted).toBe(true);
    expect(h.call(3).signal.aborted).toBe(false);
    // The aborted siblings answer as the pipeline's call() would after its signal aborted.
    h.call(1).resolve("denied cancelled"); await tick();
    h.call(0).resolve("reply 0"); await tick();
    expect(await run).toEqual({ launched: 4, applied: 4, stopped: true, aborted: true });
    expect(seen.map(row => [row.index, row.afterAbort])).toEqual([[0, true], [1, true], [2, false], [3, false]]);
    // The stage's denial is the lowest-index denial that is not a sibling stop: 2, never the aborted sibling 1.
    expect(seen.find(row => denied(row.outcome) && !siblingStop(row.outcome, row.afterAbort))?.index).toBe(2);
    // Item 0 settled after the abort but did settle: the caller still applies it, so the stage counts every settled row.
    expect(seen[0]!.outcome).toEqual({ status: "fulfilled", value: "reply 0" });
  });

  it("marks neither of two denials that settle in one synchronous block, so the lower index is the stage's denial", async () => {
    const h = harness(4), seen: [number, boolean][] = [];
    const run = runOrderedPool({ items: h.items, limit: 4, signal: new AbortController().signal, launch: h.launch,
      interrupt: outcome => denied(outcome) ? "abort" : undefined, apply: (outcome, _item, index, context) => { if (denied(outcome)) seen.push([index, context.afterAbort]); } });
    await tick();
    h.call(2).resolve("denied rate_limited"); h.call(1).resolve("denied budget_denied"); await tick();
    h.call(0).resolve("denied cancelled"); h.call(3).resolve("denied cancelled");
    await run;
    expect(seen).toEqual([[0, true], [1, false], [2, false], [3, true]]);
  });

  it("marks a call that failed for its own reason but settled after the abort, so only a cancelled reply with afterAbort is a sibling stop (#71's review F3)", async () => {
    const h = harness(3), seen: [number, string, boolean][] = [];
    const run = runOrderedPool({ items: h.items, limit: 3, signal: new AbortController().signal, launch: h.launch,
      interrupt: outcome => denied(outcome) && !siblingStop(outcome, false) ? "abort" : undefined,
      apply: (outcome, _item, index, context) => { seen.push([index, (outcome as { value: string }).value, context.afterAbort]); } });
    await tick();
    h.call(2).resolve("denied budget_denied"); await tick();
    // Item 0's call failed for its own reason before the abort, but settles after the abort reached its signal.
    h.call(0).resolve("denied request_failed"); h.call(1).resolve("denied cancelled");
    expect(await run).toEqual({ launched: 3, applied: 3, stopped: false, aborted: true });
    expect(seen).toEqual([[0, "denied request_failed", true], [1, "denied cancelled", true], [2, "denied budget_denied", false]]);
    // Marked, yet genuine: the lowest-index denial that is not a sibling stop is item 0's, not item 2's.
    expect(seen.find(([index, value, afterAbort]) => value.startsWith("denied") && !siblingStop({ status: "fulfilled", value }, afterAbort))?.[0]).toBe(0);
  });

  it("never marks the stage's own abort as a sibling stop, even when the first cancelled outcome triggers an abort", async () => {
    const h = harness(3), stage = new AbortController(), flags: boolean[] = [];
    const run = runOrderedPool({ items: h.items, limit: 3, signal: stage.signal, launch: h.launch, interrupt: outcome => denied(outcome) ? "abort" : undefined,
      apply: (_o, _i, _x, context) => { flags.push(context.afterAbort); } });
    await tick();
    stage.abort();
    expect(h.calls.every(call => call.signal.aborted)).toBe(true);
    h.call(1).resolve("denied cancelled"); await tick();
    h.call(0).resolve("denied cancelled"); h.call(2).resolve("denied cancelled");
    expect(await run).toEqual({ launched: 3, applied: 3, stopped: false, aborted: false });
    expect(flags).toEqual([false, false, false]);
    // A stage already aborted launches nothing at all.
    expect(await runOrderedPool({ items: [1, 2], limit: 2, signal: stage.signal, launch: async () => 1, apply: () => {} })).toEqual({ launched: 0, applied: 0, stopped: true, aborted: false });
  });

  it("drains every in-flight call before rethrowing a throw from apply, interrupt or beforeLaunch", async () => {
    for (const where of ["apply", "interrupt", "beforeLaunch"] as const) {
      const h = harness(4), applied: number[] = [];
      const run = runOrderedPool({ items: h.items, limit: 3, signal: new AbortController().signal, launch: h.launch,
        beforeLaunch: (_item, index) => { if (where === "beforeLaunch" && index === 3) throw new Error(`${where}_bug`); return true; },
        interrupt: (_outcome, _item, index) => { if (where === "interrupt" && index === 0) throw new Error(`${where}_bug`); },
        apply: (_outcome, _item, index) => { if (where === "apply" && index === 0) throw new Error(`${where}_bug`); applied.push(index); } });
      let state = "pending"; const observed = run.then(() => "resolved", (error: Error) => error.message).then(value => { state = value; return value; });
      await tick();
      h.call(0).resolve("reply 0"); await tick();
      if (where === "beforeLaunch") expect(h.calls).toHaveLength(3);
      else expect(h.call(1).signal.aborted && h.call(2).signal.aborted).toBe(true);
      // Still pending: the pool waits for the calls in flight although a callback already threw.
      await tick(); expect(state).toBe("pending");
      for (const call of h.calls.filter(call => !call.done)) call.resolve("late");
      expect(await observed).toBe(`${where}_bug`);
      expect(h.calls.every(call => call.done)).toBe(true);
      // #71's review F4: nothing is applied after a callback throws, though items 1 and 2 settle later. Item 0 was applied
      // before beforeLaunch threw at item 3; an apply or interrupt throw at item 0 leaves nothing applied.
      expect(applied).toEqual(where === "beforeLaunch" ? [0] : []);
    }
  });

  it("serves the judge: a settled failure stops launching at once, the siblings finish and their results are applied", async () => {
    const h = harness(6), applied: [number, string][] = [], admissions: [number, number][] = [];
    const run = runOrderedPool({ items: h.items, limit: 3, signal: new AbortController().signal, launch: h.launch,
      beforeLaunch: index => { admissions.push([index, h.live()]); return true; },
      interrupt: outcome => outcome.status === "rejected" ? "stop" : undefined,
      apply: (outcome, _item, index) => { applied.push([index, outcome.status]); } });
    await tick();
    // 2 fails while 0 and 1 are still in flight: no abort, and 3 never launches, although 0's apply frees a slot next.
    h.call(2).reject(new Error("judge_request_failed")); await tick();
    h.call(0).resolve("verdict 0"); await tick();
    h.call(1).resolve("verdict 1"); await tick();
    expect(await run).toEqual({ launched: 3, applied: 3, stopped: true, aborted: false });
    expect(applied).toEqual([[0, "fulfilled"], [1, "fulfilled"], [2, "rejected"]]);
    // beforeLaunch ran only when a slot was free: never with three calls in flight.
    expect(admissions.every(([, live]) => live < 3)).toBe(true);
  });

  it("checks a pause before each launch, only when a slot is free", async () => {
    const h = harness(5), admissions: [number, number][] = [];
    let paused = false;
    const run = runOrderedPool({ items: h.items, limit: 2, signal: new AbortController().signal, launch: h.launch,
      beforeLaunch: index => { admissions.push([index, h.live()]); return !paused; }, apply: () => "continue" });
    await tick();
    h.call(0).resolve("v0"); await tick();
    paused = true;
    h.call(1).resolve("v1"); await tick();
    h.call(2).resolve("v2"); await tick();
    expect(await run).toEqual({ launched: 3, applied: 3, stopped: true, aborted: false });
    expect(admissions.map(([index]) => index)).toEqual([0, 1, 2, 3]);
    expect(admissions.every(([, live]) => live < 2)).toBe(true);
  });

  it("applies a launch that throws synchronously as a rejected outcome, in its turn", async () => {
    const order: string[] = [];
    await runOrderedPool<number, string>({ items: [0, 1, 2], limit: 3, signal: new AbortController().signal,
      launch: (_item, index) => { if (index === 1) throw new Error("sync_failure"); return new Promise<string>(resolve => setTimeout(() => resolve(`v${index}`), 10 - index)); },
      apply: (outcome, _item, index) => { order.push(`${index}:${outcome.status}`); } });
    expect(order).toEqual(["0:fulfilled", "1:rejected", "2:fulfilled"]);
  });

  it("refuses a K outside 1 to 8 and returns at once with no items; its bound is the serving card's, and an absent or invalid K is 1", async () => {
    for (const limit of [0, 9, 1.5, Number.NaN]) await expect(runOrderedPool({ items: [1], limit, signal: new AbortController().signal, launch: async () => 1, apply: () => {} })).rejects.toThrow("ordered_pool_limit_invalid");
    // #71's review F5: one bound for K, now that 8.2b consumes the card's localStreams.
    expect(ORDERED_POOL_MAX_LIMIT).toBe(MAX_LOCAL_STREAMS);
    expect(ORDERED_POOL_MAX_LIMIT).toBe(8);
    expect([undefined, 0, 9, 1.5, Number.NaN, -1, 1, 4, 8].map(orderedPoolLimit)).toEqual([1, 1, 1, 1, 1, 1, 1, 4, 8]);
    expect(await runOrderedPool({ items: [], limit: 3, signal: new AbortController().signal, launch: async () => 1, apply: () => {} })).toEqual({ launched: 0, applied: 0, stopped: false, aborted: false });
  });

  it("adds no listener to the stage's signal, and gives each launch its own signal holding only what its call adds, at K = 8 (#71's review F1)", async () => {
    // Counted directly: no warning limit applies on Node 22.22.2, whose AbortSignals have no maximum (BL-20261110-0619).
    const stage = new AbortController(), h = harness(16), own = 3;
    const run = runOrderedPool({ items: h.items, limit: 8, signal: stage.signal,
      launch: (item, index, signal) => { for (let i = 0; i < own; i++) signal.addEventListener("abort", () => {}); return h.launch(item, index, signal); }, apply: () => {} });
    for (let i = 0; i < 16; i++) {
      await tick();
      expect(h.live()).toBe(Math.min(8, 16 - i));
      expect(getEventListeners(stage.signal, "abort")).toHaveLength(0);
      for (const call of h.calls) expect(getEventListeners(call.signal, "abort")).toHaveLength(own);
      h.call(i).resolve(`v${i}`);
    }
    expect(await run).toEqual({ launched: 16, applied: 16, stopped: false, aborted: false });
    expect(getEventListeners(stage.signal, "abort")).toHaveLength(0);
    expect(new Set(h.calls.map(call => call.signal)).size).toBe(16);
    expect(h.calls.some(call => call.signal === stage.signal)).toBe(false);
  });
});
