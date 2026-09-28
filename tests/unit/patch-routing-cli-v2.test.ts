import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import { canonicalRequest } from "../../src/main/patch-runs/native-contract";
import { digest } from "../../src/main/patch-runs/comparison";
import { loadPatchRuntimeConfig, patchPolicyLimits, type PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import { ROUTING_COMPARISON_CODE_PATHS, ROUTING_DEVELOPMENT_CODE_PATHS, ROUTING_POLICIES, RoutingManifestSchema,
  RoutingConfigurationSchema, RoutingComparisonStore, routingRuntimeConfigForArm, routingComparisonConfiguration,
  runRoutingComparisonScreen, type RoutingManifest, type RoutingArm, type RoutingTaskContract } from "../../src/main/patch-runs/routing-comparison";
import { createRoutingHistoricalAdmission, assertNoOwnedRoutingContainers } from "../../src/main/patch-runs/routing-historical-admission";
import type { RoutingHistoricalAdmission } from "../../src/main/patch-runs/routing-comparison";

const state = vi.hoisted(() => ({ controllers: [] as any[], behavior: undefined as undefined | ((options: any) => Promise<void>),
  builder: undefined as any, codeHash: "e".repeat(64), closeFailure: false }));
vi.mock("../../src/main/patch-runs/config", async original => ({ ...await original<object>(), loadPatchRuntimeConfig: vi.fn() }));
vi.mock("../../src/main/patch-runs/routing-historical-admission", async original => ({ ...await original<object>(), assertNoOwnedRoutingContainers: vi.fn(async () => {}) }));
vi.mock("../../src/main/patch-runs/controller", () => ({ PatchRunController: class {
  availability = vi.fn(async () => ({ ready: true, localReady: true, cloudReady: true }));
  close = vi.fn(async () => { if (state.closeFailure && state.controllers[0] === this) throw new Error("fixture close failure"); });
  create = vi.fn(); start = vi.fn(); waitForRun = vi.fn(); cancel = vi.fn();
  constructor(readonly store: PatchRunStore, readonly config: PatchRuntimeConfig, _publish: unknown, readonly options: unknown) { state.controllers.push(this); }
} }));
vi.mock("../../src/main/patch-runs/routing-comparison", async original => ({ ...await original<object>(),
  // Source validation and episode execution are independently covered by the
  // shared runner tests. Here they are mocked to prove CLI orchestration only.
  routingComparisonConfiguration: vi.fn(async (...args: unknown[]) => state.builder(...args)),
  runRoutingComparisonScreen: vi.fn(async options => { await state.behavior?.(options); }),
}));
vi.mock("../../src/main/patch-runs/routing-comparison-report", () => ({
  routingComparisonReport: vi.fn((database, screenId) => {
    const row = database.prepare("SELECT frozen_json FROM patch_routing_screens WHERE id=?").get(screenId);
    const frozen = JSON.parse(row.frozen_json);
    return { screenId, schemaVersion: frozen.configuration.schemaVersion === 2 ? "routing-comparison-report-v2" : "routing-comparison-report-v1",
      complete: false, assigned: frozen.tasks.length * (frozen.configuration.schemaVersion === 2 ? 2 : 4), completedBlocks: 0,
      ...(frozen.configuration.schemaVersion === 2 ? { advancement: { status: "pending_review", eligible: false, reasons: [],
        additionalMaterialRegression: null, apiCostPerAcceptableSavingFraction: null, medianLatencyRatio: null } } : {}) };
  }),
  routingComparisonMarkdown: vi.fn(report => `Assigned ${report.assigned}\n`),
  joinRoutingIndependentReview: vi.fn((report, receipt) => ({ ...report, reviewReceipt: receipt })),
}));
import { joinRoutingIndependentReview, routingComparisonReport } from "../../src/main/patch-runs/routing-comparison-report";
import { main, routingArguments, routingTaskContracts } from "../../scripts/routing-comparison";

const directories: string[] = [];
const image = `sha256:${"a".repeat(64)}`;
const baseConfig = (): PatchRuntimeConfig => ({ mode: "live", enabled: true, python: "/fixture/python", workerPath: "/fixture/worker.py",
  image, storageRoot: "/fixture/runs", episodeCapMicrousd: 3_000_000, campaignCapMicrousd: 150_000_000,
  stepLimit: 40, wallTimeSeconds: 600, maxOutputTokens: 8192, maxInputBytes: 256000,
  cloud: { id: "openai", protocol: "openai", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-5.6-sol", apiKey: "fixture-cloud-key",
    allowInsecureHttp: false, inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
  local: { id: "local", protocol: "openai", endpoint: "http://local.invalid/chat/completions", model: "local-fixture", apiKey: "fixture-local-key",
    allowInsecureHttp: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
});

function configuration(base: PatchRuntimeConfig, _root: string, manifest: RoutingManifest, contracts: RoutingTaskContract[], additional: string[], historicalAdmission?: RoutingHistoricalAdmission) {
  const arms: RoutingArm[] = manifest.schemaVersion === 2 ? ["C", "P"] : ["C", "L", "E", "P"];
  const describe = (provider: NonNullable<PatchRuntimeConfig["cloud"]>) => ({ id: provider.id, protocol: provider.protocol,
    model: provider.model, destinationSha256: digest(provider.endpoint), inputUsdPerMillion: provider.inputUsdPerMillion,
    outputUsdPerMillion: provider.outputUsdPerMillion, allowInsecureHttp: provider.allowInsecureHttp, maxOutputTokens: 8192, maxInputBytes: 256000 });
  return RoutingConfigurationSchema.parse({ schemaVersion: manifest.schemaVersion,
    kind: manifest.schemaVersion === 2 ? manifest.kind : "routing-comparison-v1", ...(manifest.schemaVersion === 2 ? { studyKind: "development" } : {}),
    mode: "live", manifestSha256: digest(canonicalRequest(manifest)), image, cloud: describe(base.cloud!), local: describe(base.local!),
    policyByArm: Object.fromEntries(arms.map(arm => [arm, ROUTING_POLICIES[arm]])), episodeMicrousd: 3_000_000,
    campaignMicrousd: 150_000_000, blockMicrousd: 9_000_000,
    limitsByArm: Object.fromEntries(arms.map(arm => [arm, patchPolicyLimits(routingRuntimeConfigForArm(base, arm, manifest), ROUTING_POLICIES[arm])])),
    cloudControls: { reasoningEffort: "medium", serviceTier: "default", promptCacheMode: "explicit_no_breakpoints" },
    localControls: { enableThinking: false, protocol: "native_coding", parallelToolCalls: false }, concurrency: 1,
    taskContracts: contracts, taskContractsSha256: digest(canonicalRequest(contracts)),
    codeHashes: { ...Object.fromEntries([...(manifest.schemaVersion === 2 ? ROUTING_DEVELOPMENT_CODE_PATHS : ROUTING_COMPARISON_CODE_PATHS), ...additional]
      .map(file => [file, "e".repeat(64)])), "src/main/patch-runs/worker.ts": state.codeHash },
    localEconomics: { devicePurchaseUsd: 3500, perTokenApiFeeUsd: 0, ownership: "user_owned", electricityAndUtilization: "unavailable" },
    ...(historicalAdmission ? { historicalAdmission } : {}),
  });
}

async function fixture(version: 1 | 2 = 2) {
  const directory = await mkdtemp(path.join(tmpdir(), "soar-routing-cli-")); directories.push(directory);
  const revision = "b".repeat(40), oracle = "c".repeat(64), reference = "d".repeat(64);
  const tasks = Array.from({ length: version === 2 ? 6 : 12 }, (_, index) => ({ taskId: `task-${index}`,
    source: { url: `https://github.com/public/fixture${index % 3}`, revision, root: path.join(directory, `source${index}`), files: 1, bytes: 10 },
    objective: `Fix public behavior ${index}.`, visibleCommand: "python public.py",
    oracle: { path: path.join(directory, "oracle.py"), sha256: oracle }, referencePatch: { path: path.join(directory, "reference.patch"), sha256: reference },
    baselineReceipt: { exitCode: 1, sourceRevision: revision, oracleSha256: oracle, patchSha256: null, image, cleanupConfirmed: true,
      harnessVerified: true, sourceTreeSha256: "f".repeat(64), testCount: 2, passed: 1, failures: 1, errors: 0, skipped: 0, failureKind: "candidate" },
    referenceReceipt: { exitCode: 0, sourceRevision: revision, oracleSha256: oracle, patchSha256: reference, image, cleanupConfirmed: true,
      harnessVerified: true, sourceTreeSha256: "f".repeat(64), testCount: 2, passed: 2, failures: 0, errors: 0, skipped: 0 },
  }));
  const manifest = RoutingManifestSchema.parse({ schemaVersion: version, screenId: `cli-v${version}`, seed: "cli-fixture", image,
    evaluatorSha256: "e".repeat(64), ...(version === 2 ? { kind: "routing-public-checks-development-v2", studyKind: "development" } : {}), tasks });
  const details = { schemaVersion: 1, screenId: manifest.screenId, tasks: manifest.tasks.map(task => ({ taskId: task.taskId, source: task.source,
    oracleSha256: task.oracle.sha256, referencePatchSha256: task.referencePatch.sha256, visibleCommandSha256: digest(task.visibleCommand),
    allowedFiles: ["source.py"], expectedTests: 2, sourceTreeSha256: "f".repeat(64) })) };
  const manifestFile = path.join(directory, "manifest.json"), detailsFile = path.join(directory, "details.json"), database = path.join(directory, "stage.sqlite"), output = path.join(directory, "output");
  await writeFile(manifestFile, JSON.stringify(manifest)); await writeFile(detailsFile, JSON.stringify(details));
  const args = (command = "run") => [command, "--manifest", manifestFile, "--details", detailsFile, "--database", database, "--output", output];
  const freeze = (history?: RoutingHistoricalAdmission) => {
    const db = createSoarDatabase(database), screen = new RoutingComparisonStore(db), store = new PatchRunStore(db);
    screen.freeze(manifest, configuration(baseConfig(), "", manifest, routingTaskContracts(details, manifest),
      ["scripts/routing-comparison.ts", "src/main/patch-runs/routing-comparison-report.ts",
        ...(version === 2 ? ["src/main/patch-runs/routing-comparison-review.ts", "src/main/patch-runs/routing-historical-admission.ts"] : [])], history));
    return { db, screen, store };
  };
  return { directory, manifest, details, manifestFile, detailsFile, database, output, args, freeze };
}

beforeEach(() => {
  state.controllers = []; state.behavior = undefined; state.builder = configuration; state.codeHash = "e".repeat(64); state.closeFailure = false;
  vi.clearAllMocks(); vi.mocked(loadPatchRuntimeConfig).mockImplementation(() => baseConfig());
  vi.mocked(assertNoOwnedRoutingContainers).mockResolvedValue(undefined);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("versioned routing CLI orchestration", () => {
  it("admits six exact V2 detail identities without weakening the twelve-task V1 format", async () => {
    const v2 = await fixture(), v1 = await fixture(1);
    expect(routingTaskContracts(v2.details, v2.manifest)).toHaveLength(6);
    expect(routingTaskContracts(v1.details, v1.manifest)).toHaveLength(12);
    for (const details of [{ ...v2.details, tasks: v2.details.tasks.slice(1) },
      { ...v2.details, tasks: [...v2.details.tasks.slice(1), v2.details.tasks[1]!] },
      { ...v2.details, tasks: v2.details.tasks.map((task, index) => index ? task : { ...task, oracleSha256: "0".repeat(64) }) }]) {
      expect(() => routingTaskContracts(details, v2.manifest)).toThrow();
    }
    expect(() => routingTaskContracts(v2.details, v1.manifest)).toThrow();
  });

  it.each([1, 2] as const)("preserves V%s controller profiles and freezes the exact version's code inventory", async version => {
    const f = await fixture(version);
    state.behavior = async options => {
      const arms = version === 2 ? ["C", "P"] : ["C", "L", "E", "P"];
      for (const arm of arms) await options.beforeEpisode({ taskId: f.manifest.tasks[0]!.taskId, arm });
      if (version === 2) {
        expect(options.controller).toBeUndefined();
        expect(options.controllerForArm("C").config).toEqual(baseConfig());
        expect(options.controllerForArm("P").config).toEqual({ ...baseConfig(), plannerMode: "plan_and_checks", localCodingCheckSchedule: "host_repair_window" });
        expect(() => options.controllerForArm("L")).toThrow(/outside/);
      } else { expect(options.controllerForArm).toBeUndefined(); expect(options.controller.config).toEqual(baseConfig()); }
    };
    await main(f.args());
    expect(state.controllers).toHaveLength(version === 2 ? 2 : 1);
    for (const controller of state.controllers) {
      expect(controller.options).toEqual({ recoveryRunIds: [] }); expect(controller.close).toHaveBeenCalledOnce();
      expect(controller.create).not.toHaveBeenCalled();
    }
    expect(vi.mocked(routingComparisonConfiguration)).toHaveBeenCalledTimes(version === 2 ? 4 : 5);
    const paths = vi.mocked(routingComparisonConfiguration).mock.calls[0]![4]!;
    expect(paths.includes("src/main/patch-runs/routing-comparison-review.ts")).toBe(version === 2);
    const frozen = JSON.parse(await readFile(path.join(f.output, "frozen.json"), "utf8"));
    expect(Object.keys(frozen.configuration.policyByArm)).toEqual(version === 2 ? ["C", "P"] : ["C", "L", "E", "P"]);
    expect(JSON.stringify(frozen)).not.toContain("fixture-cloud-key");
  });

  it.each(["manifest", "details", "code", "private_profile", "global_experiment"])("revalidates before every V2 episode and stops %s drift", async kind => {
    const f = await fixture();
    state.behavior = async options => {
      await options.beforeEpisode({ taskId: f.manifest.tasks[0]!.taskId, arm: "C" });
      if (kind === "manifest") await writeFile(f.manifestFile, JSON.stringify({ ...f.manifest,
        tasks: f.manifest.tasks.map((task, index) => index ? task : { ...task, objective: "Changed public objective." }) }));
      if (kind === "details") await writeFile(f.detailsFile, JSON.stringify({ ...f.details,
        tasks: f.details.tasks.map((task, index) => index ? task : { ...task, allowedFiles: ["other.py"] }) }));
      if (kind === "code") state.codeHash = "f".repeat(64);
      if (kind === "private_profile") vi.mocked(loadPatchRuntimeConfig).mockImplementation(() => ({ ...baseConfig(), cloud: { ...baseConfig().cloud!, apiKey: "changed-session-key" } }));
      if (kind === "global_experiment") vi.mocked(loadPatchRuntimeConfig).mockImplementation(() => ({ ...baseConfig(), plannerMode: "plan_and_checks", localCodingCheckSchedule: "host_repair_window" }));
      await options.beforeEpisode({ taskId: f.manifest.tasks[1]!.taskId, arm: "P" });
    };
    await expect(main(f.args())).rejects.toThrow(/changed|default-compatible/);
    for (const controller of state.controllers) expect(controller.close).toHaveBeenCalledOnce();
    expect(state.controllers[0].config.plannerMode).toBeUndefined();
    expect(JSON.stringify(JSON.parse(await readFile(path.join(f.output, "frozen.json"), "utf8")))).not.toContain("changed-session-key");
  });

  it.each(["created", "running", "unknown_zero_fee", "cleanup_unconfirmed"])("preserves unrelated-run admission block for %s", async kind => {
    const f = await fixture(), db = createSoarDatabase(f.database), store = new PatchRunStore(db);
    const run = store.create({ workspaceRoot: "/fixture/unrelated", objective: "Earlier work", policy: "local_only", executionMode: "live",
      baseRevision: "b".repeat(40), visibleTestCommand: "python public.py", maxCostMicrousd: 3_000_000 });
    if (kind !== "created") store.start(run.id);
    if (kind === "unknown_zero_fee") {
      store.reserveRequest(run.id, { requestId: "a".repeat(32), amountMicrousd: 0, providerLabel: "local · fixture", phase: "local", campaignLimitMicrousd: 150_000_000 });
      store.startRequest(run.id, "a".repeat(32)); store.finishRequest(run.id, { requestId: "a".repeat(32), outcome: "unknown" });
    }
    if (kind === "unknown_zero_fee" || kind === "cleanup_unconfirmed") { store.recordCleanup(run.id, kind === "unknown_zero_fee"); store.finish(run.id, "failed"); }
    db.close(); await expect(main(f.args())).rejects.toThrow(/Unrelated active, unresolved or cleanup-unconfirmed/);
    expect(state.controllers).toHaveLength(0); expect(runRoutingComparisonScreen).not.toHaveBeenCalled();
  });

  it("partitions existing C/P recovery IDs without recovering an unrelated terminal run", async () => {
    const f = await fixture(), { db, screen, store } = f.freeze();
    const block = screen.blocks(f.manifest.screenId)[0]!, task = f.manifest.tasks.find(task => task.taskId === block.task_id)!;
    screen.reserveBlock(f.manifest.screenId, task.taskId); const ids: string[] = [];
    for (const arm of ["C", "P"] as const) {
      screen.claimDispatch(f.manifest.screenId, task.taskId, arm);
      const run = store.create({ workspaceRoot: task.source.root, objective: task.objective, policy: ROUTING_POLICIES[arm], executionMode: "live",
        baseRevision: task.source.revision, visibleTestCommand: task.visibleCommand, maxCostMicrousd: 3_000_000 });
      screen.link(f.manifest.screenId, task.taskId, arm, run.id); store.start(run.id); store.recordCleanup(run.id, true); store.finish(run.id, "failed"); ids.push(run.id);
    }
    db.close(); await main(f.args());
    expect(state.controllers.map(controller => controller.options.recoveryRunIds)).toEqual(ids.map(id => [id]));
  });

  it("closes both initialized controllers even when one close fails", async () => {
    const f = await fixture(); state.closeFailure = true;
    await expect(main(f.args())).rejects.toThrow(/fixture close failure/);
    expect(state.controllers).toHaveLength(2); for (const controller of state.controllers) expect(controller.close).toHaveBeenCalledOnce();
    await expect(readFile(`${f.database}.routing-comparison.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("loads review evidence only for explicit report-only invocation", async () => {
    const f = await fixture(); const frozen = f.freeze(); frozen.db.close();
    const reviewPath = path.join(f.directory, "review.json"), receipt = { kind: "routing-independent-review-v2", screenId: f.manifest.screenId };
    await writeFile(reviewPath, JSON.stringify(receipt));
    const args = ["report", "--database", f.database, "--output", f.output, "--screen", f.manifest.screenId];
    expect(routingArguments(args)).not.toHaveProperty("review");
    await main(args); expect(joinRoutingIndependentReview).not.toHaveBeenCalled();
    await main([...args, "--review", reviewPath]); expect(joinRoutingIndependentReview).toHaveBeenCalledWith(expect.objectContaining({ assigned: 12 }), receipt);
    expect(loadPatchRuntimeConfig).not.toHaveBeenCalled(); expect(state.controllers).toHaveLength(0); expect(runRoutingComparisonScreen).not.toHaveBeenCalled();
    expect(() => routingArguments([...f.args(), "--review", reviewPath])).toThrow(/do not belong/);
    expect(() => routingArguments([...args, "--review", reviewPath, "--review", reviewPath])).toThrow(/Invalid/);
  });
});

async function historicalFixture(version: 1 | 2 = 2) {
  const f = await fixture(version), db = createSoarDatabase(f.database), store = new PatchRunStore(db);
  const prior = store.create({ workspaceRoot: "/fixture/history", objective: "Old request with frozen unknown exposure", policy: "cloud", executionMode: "live",
    baseRevision: "b".repeat(40), visibleTestCommand: "", maxCostMicrousd: 3_000_000 });
  store.start(prior.id); store.reserveRequest(prior.id, { requestId: "historical-unknown", amountMicrousd: 100, providerLabel: "cloud synthetic", phase: "cloud" });
  store.startRequest(prior.id, "historical-unknown"); store.finishRequest(prior.id, { requestId: "historical-unknown", outcome: "unknown" });
  store.recordCleanup(prior.id, true); store.finish(prior.id, "failed");
  const receipt = createRoutingHistoricalAdmission(db, { screenId: f.manifest.screenId,
    cleanupObservation: { observedAt: "2026-09-10T00:00:00.000Z", ownedContainerCount: 0 } });
  db.close();
  const receiptFile = path.join(f.directory, "historical.json"), bytes = JSON.stringify(receipt, null, 2) + "\n";
  await writeFile(receiptFile, bytes);
  const projection = { receiptSha256: digest(bytes), priorCampaignExposureMicrousd: 100, priorRunCount: 1 };
  return { ...f, receipt, receiptFile, projection, priorId: prior.id, historyArgs: (command = "run") => [...f.args(command), "--historical-admission", receiptFile] };
}

describe("explicit historical CLI gate", () => {
  it("freezes exact receipt bytes, reuses the old database without recovery, and probes fresh cleanup before each episode and after both closes", async () => {
    const f = await historicalFixture();
    state.behavior = async options => {
      await options.beforeEpisode({ taskId: f.manifest.tasks[0]!.taskId, arm: "C" });
      await options.beforeEpisode({ taskId: f.manifest.tasks[0]!.taskId, arm: "P" });
    };
    await main(f.historyArgs());
    expect(state.controllers.map(controller => controller.options.recoveryRunIds)).toEqual([[], []]);
    expect(assertNoOwnedRoutingContainers).toHaveBeenCalledTimes(4);
    const lastProbe = vi.mocked(assertNoOwnedRoutingContainers).mock.invocationCallOrder.at(-1)!;
    expect(state.controllers.every(controller => controller.close.mock.invocationCallOrder[0] < lastProbe)).toBe(true);
    const frozen = JSON.parse(await readFile(path.join(f.output, "frozen.json"), "utf8"));
    expect(frozen.configuration.historicalAdmission).toEqual(f.projection);
    const db = createSoarDatabase(f.database, { readonly: true }), store = new PatchRunStore(db);
    expect(store.get(f.priorId).reservedMicrousd).toBe(100); expect(store.hasUnresolvedRequests(f.priorId)).toBe(true);
    expect(digest((db.prepare("SELECT snapshot_json FROM patch_runs WHERE id=?").get(f.priorId) as { snapshot_json: string }).snapshot_json)).toBe(f.receipt.runs[0]!.snapshotSha256);
    db.close();
    expect(JSON.parse(await readFile(path.join(f.output, "admission-closure.json"), "utf8"))).toMatchObject({ passed: true, historicalReceiptSha256: f.projection.receiptSha256 });
  });

  it("permits current-screen settled terminal additions while preserving old exposure and reserved blocks", async () => {
    const f = await historicalFixture();
    state.behavior = async options => {
      const block = options.screen.blocks(f.manifest.screenId)[0], task = f.manifest.tasks.find(row => row.taskId === block.task_id)!;
      options.screen.reserveBlock(f.manifest.screenId, task.taskId);
      await options.beforeEpisode({ taskId: task.taskId, arm: "C" });
      options.screen.claimDispatch(f.manifest.screenId, task.taskId, "C");
      const run = options.runs.create({ workspaceRoot: task.source.root, objective: task.objective, policy: "prepared_cloud", executionMode: "live",
        baseRevision: task.source.revision, visibleTestCommand: task.visibleCommand, maxCostMicrousd: 3_000_000 });
      options.screen.link(f.manifest.screenId, task.taskId, "C", run.id); options.runs.start(run.id);
      options.runs.reserveRequest(run.id, { requestId: "new-known", amountMicrousd: 100, providerLabel: "cloud synthetic", phase: "cloud", campaignLimitMicrousd: 150_000_000 });
      options.runs.startRequest(run.id, "new-known"); options.runs.finishRequest(run.id, { requestId: "new-known", outcome: "succeeded", actualCostMicrousd: 20 });
      options.runs.recordCleanup(run.id, true); options.runs.finish(run.id, "failed");
      await options.beforeEpisode({ taskId: task.taskId, arm: "P" });
    };
    await main(f.historyArgs());
    expect(JSON.parse(await readFile(path.join(f.output, "admission-closure.json"), "utf8"))).toMatchObject({ passed: true });
  });

  it.each(["bytes", "historical_row", "new_unrelated", "new_unknown", "code", "profile"])("retains results but fails final closure on last-episode %s drift", async kind => {
    const f = await historicalFixture();
    state.behavior = async options => {
      await options.beforeEpisode({ taskId: f.manifest.tasks[0]!.taskId, arm: "C" });
      if (kind === "bytes") await writeFile(f.receiptFile, (await readFile(f.receiptFile, "utf8")) + "\n");
      if (kind === "code") state.codeHash = "f".repeat(64);
      if (kind === "profile") vi.mocked(loadPatchRuntimeConfig).mockImplementation(() => ({ ...baseConfig(), python: "/changed/python" }));
      if (kind === "historical_row") options.screen.database.prepare("UPDATE patch_runs SET workspace_root='/changed' WHERE id=?").run(f.priorId);
      if (kind === "new_unrelated" || kind === "new_unknown") {
        const block = options.screen.blocks(f.manifest.screenId)[0], task = f.manifest.tasks.find(row => row.taskId === block.task_id)!;
        if (kind === "new_unknown") { options.screen.reserveBlock(f.manifest.screenId, task.taskId); options.screen.claimDispatch(f.manifest.screenId, task.taskId, "C"); }
        const run = options.runs.create({ workspaceRoot: task.source.root, objective: task.objective, policy: "prepared_cloud", executionMode: "live",
          baseRevision: task.source.revision, visibleTestCommand: task.visibleCommand, maxCostMicrousd: 3_000_000 });
        if (kind === "new_unknown") options.screen.link(f.manifest.screenId, task.taskId, "C", run.id);
        options.runs.start(run.id);
        if (kind === "new_unknown") {
          options.runs.reserveRequest(run.id, { requestId: "new-unknown", amountMicrousd: 0, providerLabel: "cloud synthetic", phase: "cloud", campaignLimitMicrousd: 150_000_000 });
          options.runs.startRequest(run.id, "new-unknown"); options.runs.finishRequest(run.id, { requestId: "new-unknown", outcome: "unknown" });
        }
        options.runs.recordCleanup(run.id, true); options.runs.finish(run.id, "failed");
      }
    };
    await expect(main(f.historyArgs())).rejects.toThrow(/changed|New unrelated/u);
    for (const controller of state.controllers) expect(controller.close).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(path.join(f.output, "admission-closure.json"), "utf8"))).toMatchObject({ passed: false, reason: "final_admission_revalidation_failed" });
    expect(JSON.parse(await readFile(path.join(f.output, "report.json"), "utf8"))).toMatchObject({ complete: false, admissionClosure: { passed: false } });
  });

  it("rejects a nonempty cleanup probe before constructing controllers, and permits offline freeze without Docker", async () => {
    const f = await historicalFixture();
    await main(f.historyArgs("freeze")); expect(assertNoOwnedRoutingContainers).not.toHaveBeenCalled();
    vi.mocked(assertNoOwnedRoutingContainers).mockRejectedValue(new Error("Owned runtime containers remain"));
    await expect(main(f.historyArgs())).rejects.toThrow(/containers/u);
    expect(state.controllers).toHaveLength(0); expect(runRoutingComparisonScreen).not.toHaveBeenCalled();
  });

  it("prohibits historical admission for V1 and report-only invocations", async () => {
    const f = await historicalFixture(1);
    await expect(main(f.historyArgs("freeze"))).rejects.toThrow(/V2/u);
    expect(state.controllers).toHaveLength(0); expect(assertNoOwnedRoutingContainers).not.toHaveBeenCalled();
    expect(() => routingArguments(["report", "--database", f.database, "--output", f.output, "--screen", f.manifest.screenId,
      "--historical-admission", f.receiptFile])).toThrow(/do not belong/u);
  });

  it.each(["failed", "missing", "later_ledger_drift"])("keeps a %s closure blocked during later report-only independent review", async kind => {
    const f = await historicalFixture();
    if (kind === "failed") {
      state.behavior = async () => { state.codeHash = "f".repeat(64); };
      await expect(main(f.historyArgs())).rejects.toThrow(/changed/u);
    } else if (kind === "missing") await main(f.historyArgs("freeze"));
    else {
      await main(f.historyArgs());
      const db = createSoarDatabase(f.database);
      db.prepare("UPDATE patch_runs SET workspace_root='/later-drift' WHERE id=?").run(f.priorId); db.close();
    }
    const previous = vi.mocked(routingComparisonReport).getMockImplementation()!;
    vi.mocked(routingComparisonReport).mockImplementationOnce((...args) => ({ ...previous(...args), complete: true }));
    const reviewFile = path.join(f.directory, "review.json"); await writeFile(reviewFile, "{}");
    await main(["report", "--database", f.database, "--output", f.output, "--screen", f.manifest.screenId, "--review", reviewFile]);
    expect(vi.mocked(joinRoutingIndependentReview).mock.calls.at(-1)![0].complete).toBe(false);
    const report = JSON.parse(await readFile(path.join(f.output, "report.json"), "utf8"));
    expect(report).toMatchObject({ complete: false, advancement: { status: "blocked", eligible: false } });
    expect(report.advancement.reasons).toContain(kind === "failed" ? "final_admission_revalidation_failed" : "admission_closure_missing_or_mismatched");
    expect(report.admissionClosureProblem).not.toBeNull();
  });
});
