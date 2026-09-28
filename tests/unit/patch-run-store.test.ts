import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { PatchRunCreateInputSchema, PatchRunSnapshotSchema, type PatchRunRoutingSelection } from "../../src/shared/patch-run-contracts";

const databases: SoarDatabase[] = [];
const directories: string[] = [];
const initial = {
  workspaceRoot: "/public/test-repository",
  objective: "Fix the addition behavior",
  policy: "cloud" as const,
  executionMode: "live" as const,
  baseRevision: "a".repeat(40),
  maxCostMicrousd: 5_000_000,
};
const patchText = "diff --git a/calculator.py b/calculator.py\n--- a/calculator.py\n+++ b/calculator.py\n@@ -1 +1 @@\n-return a - b\n+return a + b\n";
const patch = {
  text: patchText,
  sha256: createHash("sha256").update(patchText).digest("hex"),
  files: ["calculator.py"], truncated: false,
};
function open(databasePath?: string) {
  const database = createSoarDatabase(databasePath);
  databases.push(database);
  return { database, store: new PatchRunStore(database) };
}
function reserve(store: PatchRunStore, id: string, requestId = "request-1", amountMicrousd = 2_000_000) {
  return store.reserveRequest(id, { requestId, amountMicrousd, providerLabel: "Cloud test provider" });
}
afterEach(() => {
  for (const database of databases.splice(0)) if (database.open) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("canonical coding-run store", () => {
  const selection: PatchRunRoutingSelection = {
    schemaVersion: 1, selector: "source_size_v1", requestedPolicy: "automatic", selectedPolicy: "local_critic_repair",
    reason: "baseline_within_critic_hard_limits", baseRevision: initial.baseRevision,
    sourceFiles: 6, sourceBytes: 1288, sourceTreeSha256: "b".repeat(64), configurationSha256: "c".repeat(64), maxCostMicrousd: 700_000,
  };

  it("accepts an automatic request but never accepts a renderer-supplied selection receipt", () => {
    const input = { workspaceRoot: initial.workspaceRoot, objective: initial.objective, policy: "automatic", publicSourceAcknowledged: true };
    expect(PatchRunCreateInputSchema.parse(input).policy).toBe("automatic");
    expect(() => PatchRunCreateInputSchema.parse({ ...input, routingSelection: selection })).toThrow();
    expect(() => PatchRunCreateInputSchema.parse({ ...input, sourceBytes: 1 })).toThrow();
  });

  it("preserves the host selection across lifecycle events, database reopen and replay", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "soar-routing-replay-")); directories.push(directory);
    const file = path.join(directory, "state.sqlite");
    const first = open(file);
    const created = first.store.create({ ...initial, policy: "local_critic_repair", maxCostMicrousd: 700_000, routingSelection: selection });
    first.store.start(created.id);
    first.store.finish(created.id, "cancelled");
    const terminal = first.store.get(created.id);
    expect(terminal.routingSelection).toEqual(selection);
    expect(first.store.replay(created.id)).toEqual(terminal);
    first.database.close();
    const second = open(file);
    expect(second.store.get(created.id)).toEqual(terminal);
    expect(second.store.replay(created.id).routingSelection).toEqual(selection);
  });

  it("rejects a selection that contradicts the persisted policy, source, budget or execution mode before writing", () => {
    const { store, database } = open();
    const valid = { ...initial, policy: "local_critic_repair" as const, maxCostMicrousd: 700_000, routingSelection: selection };
    for (const change of [{ policy: "prepared_cloud" }, { baseRevision: "c".repeat(40) },
      { maxCostMicrousd: 3_000_000 }, { executionMode: "scripted" }]) {
      expect(() => store.create({ ...valid, ...change } as typeof valid)).toThrow(/immutable automatic selection/);
    }
    expect(database.prepare("SELECT COUNT(*) AS count FROM patch_runs").get()).toEqual({ count: 0 });
    const snapshot = store.create(valid);
    expect(() => PatchRunSnapshotSchema.parse({ ...snapshot, policy: "prepared_cloud" })).toThrow();
    expect(() => PatchRunSnapshotSchema.parse({ ...snapshot, routingSelection: { ...selection, sourceBytes: 98_305 } })).toThrow();
    expect(store.create(initial).routingSelection).toBeUndefined();
  });

  it("retains the first cleanup receipt and never promotes an unconfirmed outcome on resume", () => {
    const { store } = open();
    const { id } = store.create(initial);
    store.start(id);
    expect(store.get(id).cleanupConfirmed).toBeUndefined();
    expect(store.recordCleanup(id, false).cleanupConfirmed).toBe(false);
    expect(() => store.recordCleanup(id, true)).toThrow(/immutable/);
    store.finish(id, "failed", "Cleanup unconfirmed");
    expect(store.recordCleanup(id, false).cleanupConfirmed).toBe(false);
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("keeps main-only workspace paths and legacy session state outside the renderer projection", () => {
    const { database, store } = open();
    const snapshot = store.create(initial);
    expect(store.getWorkspaceRoot(snapshot.id)).toBe(initial.workspaceRoot);
    expect(JSON.stringify(snapshot)).not.toContain(initial.workspaceRoot);
    expect(database.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM budget_ledger_entries").get()).toEqual({ count: 0 });
    expect(store.replay(snapshot.id)).toEqual(store.get(snapshot.id));
  });

  it("reserves before a single-use start and charges failed requests using actual reported cost", () => {
    const { store } = open();
    const { id } = store.create(initial);
    store.start(id);
    expect(reserve(store, id).reservedMicrousd).toBe(2_000_000);
    expect(reserve(store, id).events).toHaveLength(3);
    expect(() => reserve(store, id, "request-2")).toThrow(/in flight/);
    store.startRequest(id, "request-1");
    expect(() => store.startRequest(id, "request-1")).toThrow(/consumed/);
    const outcome = { requestId: "request-1", outcome: "failed" as const, actualCostMicrousd: 600_000,
      usage: { inputTokens: 1_000, outputTokens: 250, cacheReadTokens: 800, cacheWriteTokens: 200 } };
    const settled = store.finishRequest(id, outcome);
    expect(settled.spentMicrousd).toBe(600_000);
    expect(settled.reservedMicrousd).toBe(0);
    expect(store.finishRequest(id, outcome)).toEqual(settled);
    expect(() => store.finishRequest(id, { ...outcome, actualCostMicrousd: 0 })).toThrow(/Conflicting/);
    expect(store.replay(id)).toEqual(settled);
  });

  it("rolls back both the reservation and projection when canonical event persistence fails", () => {
    const { database, store } = open();
    const { id } = store.create(initial);
    store.start(id);
    database.exec(`CREATE TRIGGER fail_patch_reservation BEFORE INSERT ON patch_run_events
      WHEN NEW.type = 'request.reserved' BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;`);
    expect(() => reserve(store, id)).toThrow(/injected storage failure/);
    expect(store.get(id).reservedMicrousd).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM patch_run_requests").get()).toEqual({ count: 0 });
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("rolls back start state when its canonical event cannot be persisted", () => {
    const { database, store } = open();
    const { id } = store.create(initial);
    store.start(id);
    reserve(store, id);
    database.exec(`CREATE TRIGGER fail_patch_start BEFORE INSERT ON patch_run_events
      WHEN NEW.type = 'request.started' BEGIN SELECT RAISE(ABORT, 'start fault'); END;`);
    expect(() => store.startRequest(id, "request-1")).toThrow(/start fault/);
    expect(database.prepare("SELECT state FROM patch_run_requests").get()).toEqual({ state: "reserved" });
    database.exec("DROP TRIGGER fail_patch_start");
    expect(store.startRequest(id, "request-1").events.at(-1)?.type).toBe("request.started");
  });

  it("releases a confirmed-unsent request but never releases one whose dispatch started", () => {
    const { store } = open();
    const { id } = store.create(initial);
    store.start(id);
    reserve(store, id);
    expect(store.finishRequest(id, { requestId: "request-1", outcome: "not_sent" }).reservedMicrousd).toBe(0);
    reserve(store, id, "request-2");
    store.startRequest(id, "request-2");
    expect(() => store.finishRequest(id, { requestId: "request-2", outcome: "not_sent" })).toThrow(/started/);
    expect(store.get(id).reservedMicrousd).toBe(2_000_000);
  });

  it("retains ambiguous exposure across disk reopen and recovers without another start", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "soar-patch-store-"));
    directories.push(directory);
    const databasePath = path.join(directory, "runs.sqlite");
    const first = open(databasePath);
    const { id } = first.store.create(initial);
    first.store.start(id);
    reserve(first.store, id);
    first.store.startRequest(id, "request-1");
    first.database.close();
    const { store, database } = open(databasePath);
    const recovered = store.recoverInterrupted();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ id, status: "interrupted", spentMicrousd: 0, reservedMicrousd: 2_000_000 });
    expect(store.recoverInterrupted()).toEqual([]);
    expect(() => store.start(id)).toThrow(/terminal/);
    expect(database.prepare("SELECT state FROM patch_run_requests").get()).toEqual({ state: "unknown" });
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("atomically cancels and releases a reservation that never started", () => {
    const { store } = open();
    const { id } = store.create(initial);
    store.start(id);
    reserve(store, id);
    const cancelled = store.finish(id, "cancelled");
    expect(cancelled).toMatchObject({ status: "cancelled", reservedMicrousd: 0, spentMicrousd: 0 });
    expect(store.replay(id)).toEqual(cancelled);
  });

  it("enforces run and persisted campaign exposure across runs without losing real overruns", () => {
    const { store } = open();
    const one = store.create({ ...initial, maxCostMicrousd: 100_000_000 });
    store.start(one.id);
    reserve(store, one.id, "one", 60_000_000);
    store.startRequest(one.id, "one");
    store.finishRequest(one.id, { requestId: "one", outcome: "succeeded", actualCostMicrousd: 65_000_000 });
    store.finish(one.id, "failed");
    const two = store.create({ ...initial, maxCostMicrousd: 10_000_000 });
    store.start(two.id);
    expect(() => reserve(store, two.id, "two", 6_000_000)).toThrow(/campaign budget/);
    expect(reserve(store, two.id, "two", 5_000_000).reservedMicrousd).toBe(5_000_000);
    store.startRequest(two.id, "two");
    expect(store.finishRequest(two.id, { requestId: "two", outcome: "failed", actualCostMicrousd: 12_000_000 }).spentMicrousd).toBe(12_000_000);
    expect(() => reserve(store, two.id, "three", 1)).toThrow(/run budget/);
  });

  it("does not permit paid reservations under a scripted mechanics label", () => {
    const { store } = open();
    const { id } = store.create({ ...initial, executionMode: "scripted" });
    store.start(id);
    expect(() => reserve(store, id)).toThrow(/Scripted/);
    expect(reserve(store, id, "fixture", 0).reservedMicrousd).toBe(0);
  });

  it("captures patch/check facts and a reversible user decision without implying test correctness", () => {
    const { store } = open();
    const { id } = store.create(initial);
    store.start(id);
    expect(() => store.finish(id, "completed")).toThrow(/nonempty/);
    expect(() => store.recordPatch(id, { ...patch, sha256: "0".repeat(64) })).toThrow(/identity/);
    expect(() => store.recordPatch(id, { ...patch, files: ["../outside.py"] })).toThrow(/unsafe/);
    store.recordPatch(id, patch);
    store.recordChecks(id, { status: "failed", command: "python -m pytest", exitCode: 1, output: "1 failed" });
    const done = store.finish(id, "completed");
    expect(done.checks.status).toBe("failed");
    expect(store.decide(id, "reject").decision).toBe("reject");
    expect(store.decide(id, "keep").decision).toBe("keep");
    expect(store.replay(id)).toEqual(store.get(id));
    expect(() => store.recordChecks(id, { status: "passed", command: "pytest", exitCode: 0, output: "pass" })).toThrow(/not running/);
  });

  it("keeps phase costs, token receipts and unknown exposure distinct through replay and interruption", () => {
    const { store } = open();
    const { id } = store.create({ ...initial, policy: "hybrid" });
    store.start(id);
    store.reserveRequest(id, { requestId: "scout-one", amountMicrousd: 0, providerLabel: "Local model", phase: "scout" });
    store.startRequest(id, "scout-one");
    const scoutReceipt = { requestId: "scout-one", outcome: "succeeded" as const, actualCostMicrousd: 0,
      usage: { inputTokens: 300, outputTokens: 40, reasoningTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 0 } };
    store.finishRequest(id, scoutReceipt);
    store.finishRequest(id, scoutReceipt);
    store.setLocalSummary(id, "Observed parser.py lines 10-20", { elapsedMs: 2500, outcome: "completed" });
    store.reserveRequest(id, { requestId: "cloud-one", amountMicrousd: 500, providerLabel: "Cloud model", phase: "cloud" });
    store.startRequest(id, "cloud-one");
    store.finishRequest(id, { requestId: "cloud-one", outcome: "succeeded", actualCostMicrousd: 60,
      usage: { inputTokens: 20, outputTokens: 10 } });
    store.reserveRequest(id, { requestId: "cloud-two", amountMicrousd: 500, providerLabel: "Cloud model", phase: "cloud" });
    store.startRequest(id, "cloud-two");
    const [recovered] = store.recoverInterrupted();
    expect(recovered).toMatchObject({ status: "interrupted", spentMicrousd: 60, reservedMicrousd: 500,
      localInvestigation: { elapsedMs: 2500, outcome: "completed" }, localSummary: "Observed parser.py lines 10-20",
      phaseUsage: {
        scout: { requestCount: 1, usageReceipts: 1, unknownRequests: 0, spentMicrousd: 0, reservedMicrousd: 0, inputTokens: 300, outputTokens: 40, reasoningTokens: 10, cacheReadTokens: 20 },
        cloud: { requestCount: 2, usageReceipts: 1, unknownRequests: 1, spentMicrousd: 60, reservedMicrousd: 500, inputTokens: 20, outputTokens: 10 },
      } });
    expect(store.replay(id)).toEqual(recovered);
  });

  it("never completes with an unknown zero-fee local request", () => {
    const { store } = open();
    const { id } = store.create({ ...initial, policy: "hybrid" });
    store.start(id);
    store.reserveRequest(id, { requestId: "local-unknown", amountMicrousd: 0, providerLabel: "Local", phase: "scout" });
    store.startRequest(id, "local-unknown");
    store.finishRequest(id, { requestId: "local-unknown", outcome: "unknown" });
    store.recordPatch(id, patch);
    expect(() => store.finish(id, "completed")).toThrow(/unknown provider outcome/);
    expect(() => store.reserveRequest(id, { requestId: "cloud-after-unknown", amountMicrousd: 1, providerLabel: "Cloud", phase: "cloud" })).toThrow(/unresolved exposure/);
    store.finish(id, "failed");
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("persists partial source evidence without resetting the shared episode ceiling", () => {
    const { store } = open();
    const { id } = store.create({ ...initial, policy: "hybrid", maxCostMicrousd: 3_000_000 });
    store.start(id);
    const partial = { elapsedMs: 25000, outcome: "partial" as const };
    const summary = "Host action: read notes.py\nnotes.py:1:VALUE = 1\n";
    expect(() => store.setLocalSummary(id, "", partial)).toThrow(/requires source evidence/);
    expect(() => store.setLocalSummary(id, summary, { ...partial, fallbackReason: "scout_limit_or_format_failure" })).toThrow(/without a fallback reason/);
    store.reserveRequest(id, { requestId: "local", amountMicrousd: 0, providerLabel: "Local", phase: "scout" });
    store.startRequest(id, "local");
    store.finishRequest(id, { requestId: "local", outcome: "succeeded", actualCostMicrousd: 0, usage: { inputTokens: 100, outputTokens: 20 } });
    store.setLocalSummary(id, summary, partial);
    expect(store.get(id)).toMatchObject({ maxCostMicrousd: 3_000_000, localSummary: summary, localInvestigation: partial });
    expect(store.get(id).events.at(-1)?.summary).toBe("Local step limit reached; partial source observations prepared for cloud.");
    store.reserveRequest(id, { requestId: "cloud", amountMicrousd: 3_000_000, providerLabel: "Cloud", phase: "cloud" });
    store.startRequest(id, "cloud");
    store.finishRequest(id, { requestId: "cloud", outcome: "succeeded", actualCostMicrousd: 2_000_000, usage: { inputTokens: 100, outputTokens: 20 } });
    expect(() => store.reserveRequest(id, { requestId: "over-budget", amountMicrousd: 2_000_000, providerLabel: "Cloud", phase: "cloud" })).toThrow();
    expect(store.get(id)).toMatchObject({ maxCostMicrousd: 3_000_000, spentMicrousd: 2_000_000, reservedMicrousd: 0 });
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it("does not infer phase usage for legacy requests or claim evidence from a failed scout", () => {
    const { store } = open();
    const { id } = store.create({ ...initial, policy: "hybrid" });
    store.start(id);
    reserve(store, id);
    store.startRequest(id, "request-1");
    store.finishRequest(id, { requestId: "request-1", outcome: "succeeded", actualCostMicrousd: 10,
      usage: { inputTokens: 10, outputTokens: 0 } });
    expect(store.get(id).phaseUsage).toBeUndefined();
    expect(() => store.setLocalSummary(id, "Unfinished guesses", { elapsedMs: 1000, outcome: "fallback" })).toThrow(/cannot claim evidence/);
    store.setLocalSummary(id, "", { elapsedMs: 1000, outcome: "fallback", fallbackReason: "scout_action_denied" });
    expect(store.get(id)).toMatchObject({ localSummary: "", localInvestigation: { elapsedMs: 1000, outcome: "fallback", fallbackReason: "scout_action_denied" } });
    expect(store.replay(id)).toEqual(store.get(id));
  });

  it.each([undefined, "provider_output_empty", "provider_output_truncated"] as const)("replays optional provider output diagnostic %s without changing legacy receipts", (providerOutputError) => {
    const { database, store } = open();
    const { id } = store.create({ ...initial, policy: "hybrid" });
    store.start(id);
    const investigation = { elapsedMs: 1000, outcome: "fallback" as const, fallbackReason: "scout_limit_or_format_failure" as const,
      ...(providerOutputError === undefined ? {} : { providerOutputError }) };
    store.setLocalSummary(id, "", investigation);
    expect(store.get(id).localInvestigation).toEqual(investigation);
    expect(store.replay(id)).toEqual(store.get(id));
    if (providerOutputError === undefined) expect(store.get(id).localInvestigation).not.toHaveProperty("providerOutputError");
    const before = store.get(id);
    expect(() => store.setLocalSummary(id, "", { ...investigation, providerOutputError: "untrusted-response-text" as never })).toThrow();
    expect(store.get(id)).toEqual(before);
    const rows = database.prepare("SELECT payload_json FROM patch_run_events WHERE run_id = ?").all(id);
    expect(JSON.stringify(rows)).not.toContain("untrusted-response-text");
  });

  it("restores recovered work without treating it as a submission or a check result", () => {
    const { store } = open();
    const { id } = store.create(initial);
    store.start(id);
    store.recordPatch(id, { ...patch, kind: "recovered" });
    expect(() => store.finish(id, "completed")).toThrow(/Recovered unfinished work/);
    expect(() => store.recordChecks(id, { status: "passed", command: "pytest", exitCode: 0, output: "pass" })).toThrow(/no submitted check/);
    const done = store.finish(id, "cancelled");
    expect(done).toMatchObject({ patch: { ...patch, kind: "recovered" }, checks: { status: "not_run" } });
    expect(store.replay(id)).toEqual(done);
    expect(store.decide(id, "keep").decision).toBe("keep");
  });

  it.each([undefined, "submitted"] as const)("never replaces a %s submitted artifact with recovered verifier edits", (kind) => {
    const { store } = open();
    const { id } = store.create(initial);
    store.start(id);
    const submitted = { ...patch, ...(kind ? { kind } : {}) };
    store.recordPatch(id, submitted);
    store.recordChecks(id, { status: "failed", command: "pytest", exitCode: 1, output: "failed" });
    const before = store.get(id);
    const changed = "diff --git a/a.py b/a.py\n+unsubmitted test mutation\n";
    const after = store.recordPatch(id, { ...patch, kind: "recovered", text: changed, sha256: createHash("sha256").update(changed).digest("hex") });
    expect(after).toEqual(before);
    expect(store.replay(id)).toEqual(before);
  });

  it("keeps canonical events immutable, including SQLite replacement", () => {
    const { database, store } = open();
    const { id } = store.create(initial);
    expect(() => database.prepare("UPDATE patch_run_events SET summary = 'rewrite' WHERE run_id = ?").run(id)).toThrow(/append-only/);
    expect(() => database.prepare("DELETE FROM patch_run_events WHERE run_id = ?").run(id)).toThrow(/append-only/);
    expect(() => database.prepare("INSERT OR REPLACE INTO patch_run_events SELECT * FROM patch_run_events WHERE run_id = ?").run(id)).toThrow(/append-only/);
  });
});
