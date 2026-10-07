import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { PatchRunAvailability, PatchRunCreateInput, PatchRunSnapshot } from "../../shared/patch-run-contracts";
import { isNativePatchPolicy, patchPolicyNeedsCloud, patchPolicyNeedsLocal, type PatchRunPolicy } from "../../shared/patch-run-contracts";
import { PatchRunStore } from "./store";
import type { PatchRuntimeConfig } from "./config";
import { localCodingLimits, providerLimits, patchPolicyLimits } from "./config";
import { inspectPatchSource, inspectPatchWorkspace, materializePatchWorkspace } from "./workspace";
import { selectAutomaticRouting, validateAutomaticSelection, validateAutomaticTaskInput } from "./automatic-routing";
import { launchPatchWorker, removeRunContainers, type PatchWorkerHandle } from "./worker";

const run = promisify(execFile);
interface ActivePatchRun {
  cancelled: boolean;
  preparation: AbortController;
  handle?: PatchWorkerHandle;
  done?: Promise<void>;
}

export class PatchRunController {
  private active = new Map<string, ActivePatchRun>();
  private cleanupPending = new Set<string>();
  private closed = false;
  private closePromise?: Promise<void>;
  constructor(readonly store: PatchRunStore, readonly config: PatchRuntimeConfig, private publish: (snapshot: PatchRunSnapshot) => void = () => {},
    options: { recoveryRunIds?: readonly string[] } = {}) {
    for (const snapshot of store.recoverInterrupted(options.recoveryRunIds)) this.cleanupPending.add(snapshot.id);
    for (const id of store.listStartedRunIds(options.recoveryRunIds)) this.cleanupPending.add(id);
  }

  private cloudLabel(): string {
    const provider = this.config.cloud;
    if (!provider) return "Cloud model not configured";
    const name = provider.id === "openai" ? "OpenAI" : provider.id === "openrouter" ? "OpenRouter" : provider.id;
    return `${name} · ${provider.model}`;
  }

  private assertPolicyProviders(policy: PatchRunPolicy, config = this.config): void {
    if (policy === "local_critic_repair") { patchPolicyLimits(config, policy); return; }
    if (config.mode === "scripted" && isNativePatchPolicy(policy)) return;
    if (patchPolicyNeedsLocal(policy) && (config.mode !== "live" || !config.local)) {
      throw new Error("Configure a local model before using this local execution policy.");
    }
    if (patchPolicyNeedsCloud(policy) && config.mode === "live" && !config.cloud) {
      throw new Error("Configure a cloud model and session key before using this policy.");
    }
  }

  private campaignHeadroom(): number {
    return Math.max(0, this.config.campaignCapMicrousd - this.store.campaignExposureMicrousd());
  }

  private runConfig(snapshot: PatchRunSnapshot): PatchRuntimeConfig {
    const saved = snapshot.routingSelection;
    return saved ? validateAutomaticSelection(this.config, saved, { revision: saved.baseRevision,
      files: saved.sourceFiles, bytes: saved.sourceBytes, sourceTreeSha256: saved.sourceTreeSha256 }, this.campaignHeadroom()) : this.config;
  }

  async availability(): Promise<PatchRunAvailability> {
    const blockedReasons: string[] = [];
    const probes = await Promise.allSettled([
      run("docker", ["image", "inspect", "--format", "{{.Id}}", this.config.image], { timeout: 8000, maxBuffer: 8192 }),
      run(this.config.python, [this.config.workerPath, "--check-runtime"], { timeout: 8000, maxBuffer: 8192,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1" } }),
    ]);
    if (this.closed) blockedReasons.push("Coding pilot is shutting down.");
    const dockerReady = probes[0].status === "fulfilled" && /^sha256:[a-f0-9]{64}\s*$/u.test(probes[0].value.stdout);
    if (!dockerReady) blockedReasons.push("Start Docker or OrbStack and run pnpm setup:patch-pilot to prepare the coding container.");
    if (probes[1].status !== "fulfilled") blockedReasons.push("The pinned Python worker is unavailable. Run pnpm setup:patch-pilot.");
    if (!this.config.enabled) blockedReasons.push("Launch SOAR with SOAR_PATCH_MODE=live and a configured coding provider.");
    const cloudReady = this.config.mode === "scripted" || this.config.cloud !== undefined;
    const localReady = this.config.mode === "live" && Boolean(this.config.local);
    let criticReady = false;
    try { patchPolicyLimits(this.config, "local_critic_repair"); criticReady = true; } catch { /* Optional policy needs its own profile. */ }
    if (!cloudReady && !localReady) blockedReasons.push("Configure a local model, or a session SOAR_PATCH_API_KEY and cloud model prices.");
    if (dockerReady) {
      for (const id of this.cleanupPending) {
        try { await removeRunContainers(id); this.cleanupPending.delete(id); }
        catch { /* Preserve recovery obligation until the engine confirms cleanup. */ }
      }
    }
    if (this.cleanupPending.size) blockedReasons.push("Interrupted task containers still need cleanup. Keep the container engine running and refresh readiness.");
    return { ready: blockedReasons.length === 0, executionMode: this.config.mode, cloudReady,
      localReady, criticReady, dockerReady, blockedReasons,
      maxEpisodeCostMicrousd: this.config.episodeCapMicrousd,
      ...(this.config.cloud ? { cloudLabel: this.cloudLabel() } : {}),
      ...(this.config.local ? { localLabel: this.config.local.model } : {}),
    };
  }

  async create(input: PatchRunCreateInput): Promise<PatchRunSnapshot> {
    if (this.closed) throw new Error("Coding pilot is shutting down.");
    if (!input.publicSourceAcknowledged) throw new Error("Admit this committed public snapshot before starting.");
    if (input.policy === "automatic") validateAutomaticTaskInput(input.objective, input.visibleTestCommand ?? "python -m unittest discover -s tests -v");
    const workspace = await inspectPatchWorkspace(input.workspaceRoot);
    if (this.closed) throw new Error("Coding pilot is shutting down.");
    const requested = input.episodeBudgetUsd === undefined ? this.config.episodeCapMicrousd : Math.floor(input.episodeBudgetUsd * 1_000_000);
    if (requested > this.config.episodeCapMicrousd || requested <= 0) throw new Error("This episode exceeds the pilot spending limit.");
    const automatic = input.policy === "automatic" ? selectAutomaticRouting(this.config,
      await inspectPatchSource(workspace.root, workspace.revision), requested, this.campaignHeadroom()) : undefined;
    if (this.closed) throw new Error("Coding pilot is shutting down.");
    const policy = automatic?.selection.selectedPolicy ?? input.policy;
    if (policy === "automatic") throw new Error("Automatic routing did not select a concrete policy.");
    this.assertPolicyProviders(policy, automatic?.config);
    const snapshot = this.store.create({ workspaceRoot: workspace.root, objective: input.objective, policy,
      executionMode: this.config.mode, baseRevision: workspace.revision, maxCostMicrousd: automatic?.selection.maxCostMicrousd ?? requested,
      ...(automatic ? { routingSelection: automatic.selection } : {}),
      visibleTestCommand: input.visibleTestCommand ?? "python -m unittest discover -s tests -v",
      providerLabel: this.config.mode === "scripted" ? "Scripted fixture (no model)"
        : policy === "local_only" || policy === "local_first" || policy === "local_critic_repair" ? `local · ${this.config.local!.model}` : this.cloudLabel(),
    });
    return this.store.recordEvent(snapshot.id, { type: "source.admitted", summary: `User admitted committed public snapshot ${workspace.revision}; current working-tree edits are excluded.` });
  }

  start(id: string): PatchRunSnapshot {
    if (this.closed) throw new Error("Coding pilot is shutting down.");
    if (this.active.size) throw new Error("Finish or cancel the active coding run first.");
    const snapshot = this.store.get(id);
    if (snapshot.executionMode !== this.config.mode) throw new Error("Create a new run after changing the execution mode.");
    if (snapshot.maxCostMicrousd > this.config.episodeCapMicrousd) throw new Error("Create a new run within the current episode spending limit.");
    this.assertPolicyProviders(snapshot.policy, this.runConfig(snapshot));
    const started = this.store.start(id);
    const state: ActivePatchRun = { cancelled: false, preparation: new AbortController() };
    this.active.set(id, state);
    this.publish(started);
    state.done = this.execute(id, state);
    return started;
  }

  private async execute(id: string, state: ActivePatchRun): Promise<void> {
    let disposable: string | undefined;
    try {
      const snapshot = this.store.get(id);
      let config = this.runConfig(snapshot);
      if (snapshot.routingSelection) {
        const inspected = await inspectPatchWorkspace(this.store.getWorkspaceRoot(id), state.preparation.signal);
        if (inspected.revision !== snapshot.baseRevision) throw new Error("Automatic routing source revision changed. Create a new run.");
        const source = await inspectPatchSource(inspected.root, inspected.revision, state.preparation.signal);
        config = validateAutomaticSelection(this.config, snapshot.routingSelection, source, this.campaignHeadroom());
      }
      if (state.cancelled || this.closed) return;
      const availability = await this.availability();
      if (state.cancelled || this.closed) return;
      if (!availability.ready) { this.publish(this.store.finish(id, "blocked", availability.blockedReasons.join(" "))); return; }
      this.assertPolicyProviders(snapshot.policy, config);
      const { stdout } = await run("docker", ["image", "inspect", "--format", "{{.Id}}", this.config.image], { timeout: 8000, maxBuffer: 8192, signal: state.preparation.signal });
      const image = stdout.trim();
      if (!/^sha256:[a-f0-9]{64}$/u.test(image)) throw new Error("Container image identity is invalid.");
      this.publish(this.store.setPhase(id, "preparing"));
      await mkdir(this.config.storageRoot, { recursive: true, mode: 0o700 });
      disposable = await mkdtemp(path.join(this.config.storageRoot, "source-"));
      const workspace = path.join(disposable, "repository");
      const source = await materializePatchWorkspace(this.store.getWorkspaceRoot(id), snapshot.baseRevision, workspace, state.preparation.signal);
      if (state.cancelled || this.closed) return;
      if (snapshot.routingSelection) {
        const inspected = await inspectPatchWorkspace(this.store.getWorkspaceRoot(id), state.preparation.signal);
        if (inspected.revision !== snapshot.baseRevision) throw new Error("Automatic routing source revision changed. Create a new run.");
        config = validateAutomaticSelection(this.config, snapshot.routingSelection, source, this.campaignHeadroom());
      }
      if (state.cancelled || this.closed) return;
      const provider = snapshot.policy === "local_only" || snapshot.policy === "local_first" || snapshot.policy === "local_critic_repair" ? config.local : config.cloud;
      const limits = provider === config.local && provider ? localCodingLimits(config)
        : provider ? providerLimits(config, provider) : config;
      this.publish(this.store.recordEvent(id, { type: "runtime.admitted", summary:
        `mini-swe-agent 2.4.6; image ${image}; source ${source.files} files/${source.bytes} bytes; mode ${this.config.mode}; provider ${provider?.id ?? "scripted"}; model ${provider?.model ?? "scripted"}; input/output USD per million ${provider?.inputUsdPerMillion ?? 0}/${provider?.outputUsdPerMillion ?? 0}; campaign ceiling $${this.config.campaignCapMicrousd / 1_000_000}; max output ${limits.maxOutputTokens}; max input ${limits.maxInputBytes} bytes; session-only credential.` }));
      for (const admitted of [patchPolicyNeedsCloud(snapshot.policy) ? config.cloud : undefined,
        patchPolicyNeedsLocal(snapshot.policy) ? config.local : undefined]) {
        if (admitted) this.store.recordEvent(id, { type: "destination.admitted", summary: `Destination SHA-256 ${createHash("sha256").update(admitted.endpoint).digest("hex")}; redirects and automatic retries disabled.` });
      }
      state.handle = launchPatchWorker({ config, store: this.store, snapshot: this.store.get(id), workspace, image, publish: this.publish });
      const result = await state.handle.done;
      if (!result.cleanupConfirmed) this.cleanupPending.add(id);
      if (this.store.get(id).status === "running") {
        this.publish(this.store.finish(id, "failed", "Coding worker exited without a durable terminal state."));
      }
    } catch (error) {
      if (this.store.get(id).status === "running") this.publish(this.store.finish(id, state.cancelled ? "cancelled" : "failed",
        error instanceof Error && !/https?:|\/Users\//u.test(error.message) ? error.message.slice(0, 2000) : "The coding runtime could not prepare or execute this snapshot."));
    } finally {
      if (state.cancelled && !state.handle && this.store.get(id).status === "running") this.publish(this.store.finish(id, "cancelled"));
      if (disposable) await rm(disposable, { recursive: true, force: true }).catch(() => {});
      this.active.delete(id);
    }
  }

  cancel(id: string): PatchRunSnapshot {
    const state = this.active.get(id);
    if (state) {
      if (!state.cancelled) {
        state.cancelled = true; state.preparation.abort(); state.handle?.cancel();
        if (this.store.get(id).status === "running") this.publish(this.store.recordEvent(id, { type: "run.cancel_requested", summary: "Cancellation requested; stopping model admission and removing task containers." }));
      }
      return this.store.get(id);
    }
    const snapshot = this.store.get(id);
    if (snapshot.status === "created" || snapshot.status === "running") {
      const cancelled = this.store.finish(id, "cancelled"); this.publish(cancelled); return cancelled;
    }
    return snapshot;
  }

  async waitForRun(id: string): Promise<PatchRunSnapshot> {
    await this.active.get(id)?.done;
    return this.store.get(id);
  }

  /** Called before closing SQLite. No asynchronous worker callback may touch a closed database. */
  /** True while a coding run is active: its cancellation and container cleanup outlast the idle quit bound. */
  busy(): boolean { return this.active.size > 0; }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = Promise.resolve().then(async () => {
      for (const id of this.active.keys()) this.cancel(id);
      await Promise.all([...this.active.values()].map((state) => state.done));
    });
    return this.closePromise;
  }
}
