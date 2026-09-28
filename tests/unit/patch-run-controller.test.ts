import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import type { PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import type { PatchWorkerCompletion } from "../../src/main/patch-runs/worker";

const runtime = vi.hoisted(() => ({
  execFile: vi.fn(), inspect: vi.fn(), inspectSource: vi.fn(), materialize: vi.fn(), launch: vi.fn(), removeContainers: vi.fn(),
}));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  return { ...actual, execFile: Object.assign(vi.fn(), { [promisify.custom]: runtime.execFile }) };
});
vi.mock("../../src/main/patch-runs/workspace", () => ({
  inspectPatchWorkspace: runtime.inspect, materializePatchWorkspace: runtime.materialize,
  inspectPatchSource: runtime.inspectSource, AUTOMATIC_CRITIC_MAX_FILES: 64, AUTOMATIC_CRITIC_MAX_BYTES: 98304,
}));
vi.mock("../../src/main/patch-runs/worker", () => ({
  launchPatchWorker: runtime.launch, removeRunContainers: runtime.removeContainers,
}));

import { PatchRunController } from "../../src/main/patch-runs/controller";

const revision = "a".repeat(40);
const image = `sha256:${"b".repeat(64)}`;
const source = { revision, files: 1, bytes: 20, sourceTreeSha256: "c".repeat(64) };
const initial = {
  workspaceRoot: "/public/test-repository", objective: "Fix addition", policy: "cloud" as const,
  executionMode: "live" as const, baseRevision: revision, maxCostMicrousd: 5_000_000,
};
const databases: SoarDatabase[] = [];
const controllers: PatchRunController[] = [];
const directories: string[] = [];
const releaseGates: (() => void)[] = [];
function deferred<T>(cleanupValue: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  releaseGates.push(() => resolve(cleanupValue));
  return { promise, resolve };
}
async function setup(prepare?: (store: PatchRunStore) => void) {
  const directory = await mkdtemp(path.join(tmpdir(), "soar-controller-test-")); directories.push(directory);
  const database = createSoarDatabase(); databases.push(database);
  const store = new PatchRunStore(database);
  prepare?.(store);
  const config: PatchRuntimeConfig = {
    mode: "live", enabled: true, python: "test-python", workerPath: "/test/worker.py", image: "test-image", storageRoot: path.join(directory, "runs"),
    episodeCapMicrousd: 5_000_000, campaignCapMicrousd: 70_000_000, stepLimit: 60,
    wallTimeSeconds: 1200, maxOutputTokens: 4096, maxInputBytes: 512000,
    cloud: { id: "cloud", protocol: "openai", endpoint: "https://fixture.example/v1/chat/completions", model: "fixture", apiKey: "fixture-key",
      allowInsecureHttp: false, inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
  };
  const controller = new PatchRunController(store, config); controllers.push(controller);
  return { directory, database, store, config, controller };
}

beforeEach(() => {
  for (const mock of Object.values(runtime)) mock.mockReset();
  runtime.execFile.mockResolvedValue({ stdout: image, stderr: "" });
  runtime.inspect.mockImplementation(async (root: string) => ({ root, revision }));
  runtime.inspectSource.mockResolvedValue(source);
  runtime.materialize.mockImplementation(async (_root: string, _revision: string, destination: string) => {
    await mkdir(destination); return source;
  });
  runtime.removeContainers.mockResolvedValue(undefined);
  runtime.launch.mockImplementation(({ store, snapshot }: { store: PatchRunStore; snapshot: { id: string } }) => ({
    done: Promise.resolve().then(() => { store.finish(snapshot.id, "failed", "Scripted test completion"); return { cleanupConfirmed: true }; }),
    cancel: vi.fn(),
  }));
});
afterEach(async () => {
  for (const release of releaseGates.splice(0)) release();
  await Promise.all(controllers.splice(0).map((controller) => controller.close()));
  for (const database of databases.splice(0)) if (database.open) database.close();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("coding controller lifecycle", () => {
  const automaticInput = { workspaceRoot: initial.workspaceRoot, objective: initial.objective,
    publicSourceAcknowledged: true as const, policy: "automatic" as const };
  function enableCritic(config: PatchRuntimeConfig): void {
    config.local = { ...config.cloud!, id: "local", apiKey: "", inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
    config.maxOutputTokens = 8192;
  }
  it.each([false, true])("launches the persisted concrete automatic route (oversized=%s) with its bounded profile", async oversized => {
    const { controller, config, store } = await setup(); enableCritic(config);
    const selectedSource = oversized ? { ...source, bytes: 98305 } : source;
    runtime.inspectSource.mockResolvedValue(selectedSource);
    runtime.materialize.mockImplementation(async (_root, _revision, destination) => { await mkdir(destination); return selectedSource; });
    const snapshot = await controller.create(automaticInput);
    expect(snapshot).toMatchObject({ policy: oversized ? "prepared_cloud" : "local_critic_repair",
      maxCostMicrousd: oversized ? 3000000 : 700000,
      routingSelection: { requestedPolicy: "automatic", sourceTreeSha256: source.sourceTreeSha256 } });
    config.cloud!.apiKey = "rotated-key";
    controller.start(snapshot.id); const terminal = await controller.waitForRun(snapshot.id);
    expect(runtime.launch).toHaveBeenCalledOnce();
    expect(runtime.launch.mock.calls[0]![0].config).toMatchObject({ episodeCapMicrousd: snapshot.maxCostMicrousd,
      stepLimit: oversized ? 40 : 13, wallTimeSeconds: 600 });
    expect(runtime.launch.mock.calls[0]![0].config.localCodingMaxCalls).toBeUndefined();
    expect(store.replay(snapshot.id)).toEqual(terminal);
    expect(terminal.routingSelection).toEqual(snapshot.routingSelection);
  });
  it.each(["tree", "revision", "materialized", "during_preparation", "worker_path", "profile", "campaign"])(
    "stops automatic %s drift with zero worker dispatch", async drift => {
      const { controller, config, store, database } = await setup(); enableCritic(config);
      if (drift === "campaign") config.campaignCapMicrousd = 5000000;
      const snapshot = await controller.create(automaticInput);
      if (drift === "tree") runtime.inspectSource.mockResolvedValue({ ...source, sourceTreeSha256: "d".repeat(64) });
      if (drift === "revision") runtime.inspect.mockResolvedValue({ root: initial.workspaceRoot, revision: "e".repeat(40) });
      if (drift === "materialized" || drift === "during_preparation") runtime.materialize.mockImplementation(async (_root, _revision, destination) => {
        await mkdir(destination);
        if (drift === "during_preparation") config.cloud!.model = "changed-after-readiness";
        return drift === "materialized" ? { ...source, sourceTreeSha256: "d".repeat(64) } : source;
      });
      if (drift === "worker_path") config.workerPath = "/changed/worker.py";
      if (drift === "profile") config.local!.model = "changed-model";
      if (drift === "campaign") {
        const old = store.create(initial); store.start(old.id);
        store.reserveRequest(old.id, { requestId: "held", amountMicrousd: 4900000, providerLabel: "fixture" });
      }
      if (["worker_path", "profile", "campaign"].includes(drift)) expect(() => controller.start(snapshot.id)).toThrow(/changed/);
      else { controller.start(snapshot.id); expect((await controller.waitForRun(snapshot.id)).status).toBe("failed"); }
      expect(runtime.launch).not.toHaveBeenCalled();
      expect(database.prepare("SELECT COUNT(*) AS count FROM patch_run_requests WHERE run_id = ?").get(snapshot.id)).toEqual({ count: 0 });
    });
  it("cancels automatic committed-source inspection before runtime preparation", async () => {
    const { controller, config } = await setup(); enableCritic(config);
    const snapshot = await controller.create(automaticInput);
    runtime.inspectSource.mockImplementation(async (_root, _revision, signal: AbortSignal) => {
      await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    controller.start(snapshot.id);
    await vi.waitFor(() => expect(runtime.inspectSource).toHaveBeenCalledTimes(2));
    controller.cancel(snapshot.id);
    expect((await controller.waitForRun(snapshot.id)).status).toBe("cancelled");
    expect(runtime.execFile).not.toHaveBeenCalled(); expect(runtime.launch).not.toHaveBeenCalled();
  });
  it("rejects known oversized automatic input before reading source or creating a row", async () => {
    const { controller, store } = await setup();
    await expect(controller.create({ ...automaticInput, objective: "界".repeat(5462) })).rejects.toThrow(/input limits/);
    expect(runtime.inspect).not.toHaveBeenCalled(); expect(store.list()).toEqual([]);
  });
  it("admits the explicit critique profile without changing availability of other policies", async () => {
    const { controller, config } = await setup();
    const input = { workspaceRoot: initial.workspaceRoot, objective: initial.objective, publicSourceAcknowledged: true as const,
      policy: "local_critic_repair" as const };
    expect((await controller.availability()).criticReady).toBe(false);
    await expect(controller.create(input)).rejects.toThrow(/Local critique/u);
    config.local = { ...config.cloud!, id: "local", apiKey: "", inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
    config.maxOutputTokens = 8192;
    expect((await controller.availability()).criticReady).toBe(true);
    expect((await controller.create(input)).providerLabel).toBe("local · fixture");
    config.mode = "scripted";
    expect((await controller.availability()).criticReady).toBe(false);
    await expect(controller.create(input)).rejects.toThrow(/Local critique/u);
  });

  it("runs local-only without a cloud key and rejects cloud-bearing policies in that configuration", async () => {
    const { controller, config } = await setup();
    config.cloud = undefined;
    config.local = { id: "local", protocol: "openai", endpoint: "http://127.0.0.1:9999/chat/completions", model: "Local fixture", apiKey: "",
      allowInsecureHttp: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxOutputTokens: 2048, maxInputBytes: 64000 };
    expect(await controller.availability()).toMatchObject({ ready: true, localReady: true, cloudReady: false, blockedReasons: [] });
    const input = { workspaceRoot: initial.workspaceRoot, objective: initial.objective, publicSourceAcknowledged: true as const };
    for (const policy of ["cloud", "local_first", "cloud_plan_local", "cloud_plan_local_review"] as const) await expect(controller.create({ ...input, policy })).rejects.toThrow(/cloud model/);
    const local = await controller.create({ ...input, policy: "local_only" });
    expect(local.providerLabel).toBe("local · Local fixture"); controller.start(local.id);
    const result = await controller.waitForRun(local.id);
    expect(runtime.launch).toHaveBeenCalledOnce();
    expect(result.events.find((event) => event.type === "runtime.admitted")?.summary).toContain("max output 8192; max input 256000 bytes");
  });
  it("shows the direct OpenAI destination in readiness and the persisted task label", async () => {
    const { controller, config } = await setup();
    config.cloud = { ...config.cloud!, id: "openai", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4.1-mini-2025-04-14" };
    const availability = await controller.availability();
    expect(availability.cloudLabel).toBe("OpenAI · gpt-4.1-mini-2025-04-14");
    const snapshot = await controller.create({ workspaceRoot: initial.workspaceRoot, objective: initial.objective,
      policy: "cloud", publicSourceAcknowledged: true });
    expect(snapshot.providerLabel).toBe(availability.cloudLabel);
    expect(JSON.stringify(availability)).not.toContain("OpenRouter");
    expect(JSON.stringify(availability)).not.toContain("fixture-key");
  });
  it.each([180_000_000, 179_125_000])("records the configured campaign ceiling %s without rewriting prior admissions", async (campaignCapMicrousd) => {
    const { store, controller, config } = await setup();
    const original = store.create(initial);
    controller.start(original.id);
    await controller.waitForRun(original.id);
    const originalEvents = store.get(original.id).events;
    expect(originalEvents.find((event) => event.type === "runtime.admitted")?.summary).toContain("campaign ceiling $70;");
    config.campaignCapMicrousd = campaignCapMicrousd;
    const next = store.create(initial);
    controller.start(next.id);
    const result = await controller.waitForRun(next.id);
    const summary = result.events.find((event) => event.type === "runtime.admitted")?.summary;
    expect(summary).toContain(`campaign ceiling $${campaignCapMicrousd / 1_000_000};`);
    expect(summary).not.toContain("campaign ceiling $70;");
    expect(store.get(original.id).events).toEqual(originalEvents);
    expect(store.replay(original.id).events).toEqual(originalEvents);
    expect(store.replay(next.id)).toEqual(result);
    expect(runtime.launch).toHaveBeenLastCalledWith(expect.objectContaining({
      config: expect.objectContaining({ campaignCapMicrousd, episodeCapMicrousd: 5_000_000 }),
    }));
  });

  it("cancels while readiness is pending without preparing or launching a worker", async () => {
    const gate = deferred<void>(undefined);
    runtime.execFile.mockImplementation(async () => { await gate.promise; return { stdout: image, stderr: "" }; });
    const { store, controller } = await setup();
    const { id } = store.create(initial);
    controller.start(id);
    expect(controller.cancel(id).status).toBe("running");
    gate.resolve();
    expect((await controller.waitForRun(id)).status).toBe("cancelled");
    expect(runtime.materialize).not.toHaveBeenCalled();
    expect(runtime.launch).not.toHaveBeenCalled();
  });

  it("aborts snapshot materialization and removes the partial copy before shutdown resolves", async () => {
    let preparationSignal: AbortSignal | undefined;
    runtime.materialize.mockImplementation(async (_root: string, _revision: string, destination: string, signal: AbortSignal) => {
      preparationSignal = signal;
      await mkdir(destination);
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const { store, controller, config, database } = await setup();
    const { id } = store.create(initial);
    controller.start(id);
    await vi.waitFor(() => expect(runtime.materialize).toHaveBeenCalledOnce());
    await controller.close();
    expect(preparationSignal?.aborted).toBe(true);
    expect(store.get(id).status).toBe("cancelled");
    expect(runtime.launch).not.toHaveBeenCalled();
    expect(await readdir(config.storageRoot)).toEqual([]);
    expect(database.open).toBe(true);
  });

  it("shares shutdown completion and waits for worker cleanup before callers may close SQLite", async () => {
    const completion = deferred<PatchWorkerCompletion>({ cleanupConfirmed: true });
    const cancel = vi.fn();
    runtime.launch.mockImplementation(({ store, snapshot }: { store: PatchRunStore; snapshot: { id: string } }) => ({
      cancel, done: completion.promise.then((result) => { store.finish(snapshot.id, "cancelled"); return result; }),
    }));
    const { store, controller, database } = await setup();
    const { id } = store.create(initial);
    controller.start(id);
    await vi.waitFor(() => expect(runtime.launch).toHaveBeenCalledOnce());
    const firstClose = controller.close();
    const secondClose = controller.close();
    expect(secondClose).toBe(firstClose);
    let finished = false;
    void secondClose.then(() => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(cancel).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    expect(store.get(id).status).toBe("running");
    completion.resolve({ cleanupConfirmed: true });
    await secondClose;
    expect(store.get(id).status).toBe("cancelled");
    database.close();
    await controller.close();
  });

  it("blocks subsequent dispatch after cleanup failure until independent cleanup succeeds", async () => {
    runtime.launch.mockImplementation(({ store, snapshot }: { store: PatchRunStore; snapshot: { id: string } }) => ({
      cancel: vi.fn(), done: Promise.resolve().then(() => {
        store.reserveRequest(snapshot.id, { requestId: "sent", amountMicrousd: 2_000_000, providerLabel: "Fixture" });
        store.startRequest(snapshot.id, "sent");
        store.finish(snapshot.id, "failed", "Container cleanup unavailable");
        return { cleanupConfirmed: false, error: "Container cleanup unavailable" };
      }),
    }));
    const { store, controller } = await setup();
    const { id } = store.create(initial);
    controller.start(id);
    expect(await controller.waitForRun(id)).toMatchObject({ status: "failed", reservedMicrousd: 2_000_000 });
    runtime.removeContainers.mockRejectedValue(new Error("Docker unavailable"));
    expect(await controller.availability()).toMatchObject({ ready: false });
    const next = store.create(initial);
    controller.start(next.id);
    expect((await controller.waitForRun(next.id)).status).toBe("blocked");
    expect(runtime.launch).toHaveBeenCalledOnce();
    runtime.removeContainers.mockResolvedValue(undefined);
    expect(await controller.availability()).toMatchObject({ ready: true });
    expect(store.get(id).reservedMicrousd).toBe(2_000_000);
  });

  it("recovers a started request conservatively and cleans its orphan before readiness", async () => {
    let recoveredId = "";
    const { store, controller, database } = await setup((existing) => {
      const { id } = existing.create(initial); recoveredId = id;
      existing.start(id);
      existing.reserveRequest(id, { requestId: "crash", amountMicrousd: 1_000_000, providerLabel: "Fixture" });
      existing.startRequest(id, "crash");
    });
    expect(store.get(recoveredId)).toMatchObject({ status: "interrupted", reservedMicrousd: 1_000_000 });
    expect(database.prepare("SELECT state FROM patch_run_requests").get()).toEqual({ state: "unknown" });
    runtime.removeContainers.mockRejectedValueOnce(new Error("Retry cleanup"));
    expect((await controller.availability()).ready).toBe(false);
    expect((await controller.availability()).ready).toBe(true);
    expect(runtime.removeContainers).toHaveBeenLastCalledWith(recoveredId);
    expect(() => controller.start(recoveredId)).toThrow(/terminal/);
  });

  it("does not lose a terminal orphan behind the display history limit", async () => {
    let orphan = "";
    const { store, controller } = await setup((existing) => {
      const snapshot = existing.create(initial); orphan = snapshot.id;
      existing.start(orphan); existing.finish(orphan, "cancelled");
      for (let count = 0; count < 501; count += 1) existing.create(initial);
    });
    expect(store.list()).toHaveLength(100);
    expect(store.listStartedRunIds()).toEqual([orphan]);
    expect((await controller.availability()).ready).toBe(true);
    expect(runtime.removeContainers).toHaveBeenCalledExactlyOnceWith(orphan);
  });

  it("does not write a new run when shutdown happens during repository inspection", async () => {
    const inspected = { root: initial.workspaceRoot, revision };
    const inspection = deferred(inspected);
    runtime.inspect.mockReturnValue(inspection.promise);
    const { store, controller } = await setup();
    const creating = controller.create({ workspaceRoot: initial.workspaceRoot, objective: initial.objective, policy: "cloud", publicSourceAcknowledged: true });
    const rejected = expect(creating).rejects.toThrow(/shutting down/);
    await controller.close();
    inspection.resolve(inspected);
    await rejected;
    expect(store.list()).toEqual([]);
  });

  it("requires a new run when its stored budget or local authority no longer fits this process", async () => {
    const { store, controller } = await setup();
    const oldBudget = store.create({ ...initial, maxCostMicrousd: 6_000_000 });
    expect(() => controller.start(oldBudget.id)).toThrow(/current episode spending limit/);
    const oldLocal = store.create({ ...initial, policy: "hybrid" });
    expect(() => controller.start(oldLocal.id)).toThrow(/local model/);
    expect(store.get(oldBudget.id).status).toBe("created");
    expect(store.get(oldLocal.id).status).toBe("created");
    expect(runtime.launch).not.toHaveBeenCalled();
  });

  it("fails closed if a worker exits without persisting a terminal record", async () => {
    runtime.launch.mockReturnValue({ cancel: vi.fn(), done: Promise.resolve({ cleanupConfirmed: true, error: "Persistence failed" }) });
    const { store, controller } = await setup();
    const { id } = store.create(initial);
    controller.start(id);
    expect(await controller.waitForRun(id)).toMatchObject({ status: "failed", error: expect.stringContaining("durable terminal state") });
  });
});
