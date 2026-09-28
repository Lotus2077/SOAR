import { afterEach, describe, expect, it } from "vitest";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { digest } from "../../src/main/patch-runs/comparison";
import { createRoutingHistoricalAdmission, verifyRoutingHistoricalAdmission, RoutingHistoricalReceiptSchema } from "../../src/main/patch-runs/routing-historical-admission";

const databases: SoarDatabase[] = [];
const hash = "a".repeat(64), screenId = "new-development";
const observation = { observedAt: "2026-09-10T00:00:00.000Z", ownedContainerCount: 0 as const };
const options = { screenId, receiptSha256: hash };
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = createSoarDatabase(":memory:"); databases.push(db);
  const store = new PatchRunStore(db, { now: () => observation.observedAt });
  const create = (policy: "cloud" | "local_only" = "cloud") => store.create({ workspaceRoot: "/synthetic/private-workspace",
    objective: "Synthetic historical accounting", policy, executionMode: "live", baseRevision: "b".repeat(40),
    maxCostMicrousd: 3_000_000, visibleTestCommand: "" }).id;
  const source = create(); store.start(source); store.recordCleanup(source, true); store.finish(source, "failed");
  const known = create(); store.start(known); store.setPhase(known, "cloud_solver");
  const request = (id: string, requestId: string, outcome: "succeeded" | "unknown") => {
    store.reserveRequest(id, { requestId, amountMicrousd: 100, providerLabel: "cloud synthetic", phase: "cloud", campaignLimitMicrousd: 150_000_000 });
    store.startRequest(id, requestId);
    store.finishRequest(id, { requestId, outcome, ...(outcome === "succeeded" ? { actualCostMicrousd: 20 } : {}) });
  };
  request(known, "known-request", "succeeded"); store.recordCleanup(known, true); store.finish(known, "failed");
  const unknown = create(); store.start(unknown); request(unknown, "unknown-request", "unknown"); store.recordCleanup(unknown, true); store.finish(unknown, "failed");
  const critic = (extraEvent = false, policy: "cloud" | "local_only" = "cloud") => {
    const id = create(policy); store.start(id); store.setPhase(id, "cloud_solver");
    store.recordEvent(id, { type: "diagnostic.accounting_only", summary: `Standalone critic; never a completed patch run. Source run ${source}; bundle SHA-256 ${hash}; plan SHA-256 ${hash}.` });
    request(id, `critic-${id}`, "succeeded");
    if (extraEvent) store.recordEvent(id, { type: "runtime.started", summary: "Synthetic runtime evidence" });
    store.finish(id, "failed", "diagnostic_only_no_patch_run_completion"); return id;
  };
  const capture = () => createRoutingHistoricalAdmission(db, { screenId, cleanupObservation: observation });
  const oldScreen = (kind: "comparison" | "routing", suffix = "old") => {
    const id = `${kind}-${suffix}`;
    db.prepare(`INSERT INTO patch_${kind}_screens VALUES(?,?,?,?,?,?,?)`).run(id, hash, hash, "{}", 150_000_000, 3_000_000, observation.observedAt);
    db.prepare(`INSERT INTO patch_${kind}_blocks(screen_id,task_id,ordinal,arm_order,reservation_microusd) VALUES(?,?,?,?,?)`)
      .run(id, "task", 0, JSON.stringify(kind === "routing" ? ["C", "P"] : ["C", "D", "H"]), 9_000_000);
    db.prepare(`INSERT INTO patch_${kind}_assignments(screen_id,task_id,arm) VALUES(?,?,?)`).run(id, "task", "C");
    return id;
  };
  return { db, store, create, source, known, unknown, critic, capture, oldScreen };
}

describe("explicit historical routing admission", () => {
  it("pins every old ledger/table row and retains unknown reservations and open block holds without mutation", () => {
    const f = fixture(), critic = f.critic(), legacy = f.oldScreen("comparison"), routing = f.oldScreen("routing");
    for (const [kind, id] of [["comparison", legacy], ["routing", routing]]) {
      f.db.prepare(`UPDATE patch_${kind}_blocks SET state='reserved' WHERE screen_id=?`).run(id);
      f.db.prepare(`INSERT INTO patch_${kind}_evaluation_claims VALUES(?,?,?,?)`).run(id, "task", "C", observation.observedAt);
    }
    const receipt = f.capture(), before = f.db.prepare("SELECT total_changes() n").get();
    expect(receipt.priorCampaignExposureMicrousd).toBe(18_000_140);
    expect(receipt.priorRunCount).toBe(4);
    expect(Object.values(receipt.tables).every(rows => rows.length > 0)).toBe(true);
    expect(receipt.runs.find(row => row.runId === critic)?.cleanup).toBe("accounting_only_critic");
    expect(receipt.runs.find(row => row.runId === f.unknown)).toMatchObject({ reservedMicrousd: 100, unknownRequestCount: 1 });
    expect(verifyRoutingHistoricalAdmission(f.db, receipt, options)).toEqual({ receiptSha256: hash, priorCampaignExposureMicrousd: 18_000_140, priorRunCount: 4 });
    expect(f.db.prepare("SELECT total_changes() n").get()).toEqual(before);
    expect(f.store.get(critic).cleanupConfirmed).toBeUndefined();
    expect(JSON.stringify(receipt)).not.toContain("private-workspace");
    expect(JSON.stringify(receipt)).not.toContain("Synthetic historical accounting");
  });

  it.each(["runtime", "wrong_policy", "ordinary_absent", "false_cleanup"])("rejects unsupported cleanup exception: %s", kind => {
    const f = fixture();
    if (kind === "runtime") f.critic(true);
    else if (kind === "wrong_policy") f.critic(false, "local_only");
    else {
      const id = f.create(); f.store.start(id);
      if (kind === "false_cleanup") f.store.recordCleanup(id, false);
      f.store.finish(id, "failed", "diagnostic_only_no_patch_run_completion");
    }
    expect(() => f.capture()).toThrow(/cleanup/u);
  });

  it("rejects active history and mismatched snapshot/replay or request accounting", () => {
    const f = fixture(), receipt = f.capture(), active = f.create();
    expect(() => f.capture()).toThrow(/nonterminal/u);
    f.store.start(active); f.store.recordCleanup(active, true); f.store.finish(active, "failed");
    expect(() => verifyRoutingHistoricalAdmission(f.db, receipt, options)).toThrow(/New unrelated/u);
    f.db.prepare("UPDATE patch_run_requests SET reservation_microusd=0 WHERE request_id='unknown-request'").run();
    expect(() => f.capture()).toThrow(/accounting/u);
  });

  const mutations: Array<[string, (f: ReturnType<typeof fixture>, ids: string[]) => void]> = [
    ["patch_runs", f => { f.db.prepare("UPDATE patch_runs SET workspace_root='/different' WHERE id=?").run(f.source); }],
    ["patch_run_requests", f => { f.db.prepare("UPDATE patch_run_requests SET actual_microusd=21 WHERE request_id='known-request'").run(); }],
    ["patch_run_events", f => { f.db.prepare("INSERT INTO patch_run_events VALUES(?,?,?,?,?,?)").run(f.source, 5, "extra.event", "extra", "{}", observation.observedAt); }],
    ...(["comparison", "routing"] as const).flatMap(kind => [
      [`patch_${kind}_screens`, (f: ReturnType<typeof fixture>) => { f.oldScreen(kind, "additional"); }],
      [`patch_${kind}_blocks`, (f: ReturnType<typeof fixture>, ids: string[]) => { f.db.prepare(`UPDATE patch_${kind}_blocks SET state='reserved' WHERE screen_id=?`).run(ids[kind === "comparison" ? 0 : 1]); }],
      [`patch_${kind}_assignments`, (f: ReturnType<typeof fixture>, ids: string[]) => { f.db.prepare(`UPDATE patch_${kind}_assignments SET dispatch_claimed=1 WHERE screen_id=?`).run(ids[kind === "comparison" ? 0 : 1]); }],
      [`patch_${kind}_evaluation_claims`, (f: ReturnType<typeof fixture>, ids: string[]) => { f.db.prepare(`INSERT INTO patch_${kind}_evaluation_claims VALUES(?,?,?,?)`).run(ids[kind === "comparison" ? 0 : 1], "task", "C", observation.observedAt); }],
    ] as Array<[string, (f: ReturnType<typeof fixture>, ids: string[]) => void]>),
  ];
  it.each(mutations)("rejects old %s row drift, including increases/decreases in holds", (_table, mutate) => {
    const f = fixture(), ids = [f.oldScreen("comparison"), f.oldScreen("routing")], receipt = f.capture();
    mutate(f, ids);
    expect(() => verifyRoutingHistoricalAdmission(f.db, receipt, options)).toThrow(/Historical patch_/u);
  });

  it("rejects omitted/duplicate history, wrong screen, baseline changes and a nonzero container attestation", () => {
    const f = fixture(), receipt = f.capture();
    for (const changed of [
      { ...receipt, runs: receipt.runs.slice(1) }, { ...receipt, runs: [...receipt.runs, receipt.runs[0]] },
      { ...receipt, tables: { ...receipt.tables, patch_run_events: receipt.tables.patch_run_events.slice(1) } },
      { ...receipt, screenId: "other" }, { ...receipt, priorCampaignExposureMicrousd: 0 },
    ]) expect(() => verifyRoutingHistoricalAdmission(f.db, changed, options)).toThrow();
    expect(() => RoutingHistoricalReceiptSchema.parse({ ...receipt, cleanupObservation: { ...observation, ownedContainerCount: 1 } })).toThrow();
    expect(() => RoutingHistoricalReceiptSchema.parse({ ...receipt, secret: "forbidden" })).toThrow();
    expect(receipt.runs.find(row => row.runId === f.unknown)?.snapshotSha256).toBe(digest((f.db.prepare("SELECT snapshot_json FROM patch_runs WHERE id=?").get(f.unknown) as { snapshot_json: string }).snapshot_json));
  });

  it("cannot create a baseline after the target screen already exists", () => {
    const f = fixture();
    f.db.prepare("INSERT INTO patch_routing_screens VALUES(?,?,?,?,?,?,?)").run(screenId, hash, hash, "{}", 150_000_000, 3_000_000, observation.observedAt);
    expect(() => f.capture()).toThrow(/precede/u);
  });
});
