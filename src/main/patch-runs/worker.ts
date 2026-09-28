import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import type { PatchRuntimeConfig, PatchProviderConfig, LocalCodingCheckSchedule } from "./config";
import { isOpenAiSol, providerLimits, localCodingLimits, localCodingThinking, patchPolicyLimits } from "./config";
import { PatchRunStore, validateCriticCheckpointBudget } from "./store";
import { prepareCriticContext, verifyCriticCandidate } from "./critic-context";
import { parseCompactCriticResponse } from "./compact-critic";
import { isNativePatchPolicy, patchPolicyNeedsCloud, patchPolicyNeedsLocal, patchPolicyNeedsPlan, PatchRunRequestPhaseSchema, PatchRunLocalInvestigationSchema,
  PatchRunCheckpointSchema, PatchRunHandoffSchema, PatchRunPlanSchema, PatchRunPlannerCheckSchema, PatchRunPlannerCheckResultSchema,
  type PatchRunCriticDraft, type PatchRunCriticReceipt, type PatchRunRequestPhase, type PatchRunPhase, type PatchRunPolicy, type PatchRunSnapshot, type PatchRunCheckpoint,
  type PatchRunPlanChecks, type PatchRunPlannerCheck, type PatchRunPlannerCheckResult } from "../../shared/patch-run-contracts";
import { canonicalRequest, validateNativeCodingBody } from "./native-contract";
export { canonicalRequest } from "./native-contract";

const runFile = promisify(execFile);
const MAX_LINE = 4 * 1024 * 1024;
const eventSchema = z.object({ type: z.string(), protocolVersion: z.literal(1), runId: z.string(), sequence: z.number().int().positive() }).passthrough();
const usageSchema = z.object({ inputTokens: z.number().int().nonnegative().safe(), outputTokens: z.number().int().nonnegative().safe(), cacheReadTokens: z.number().int().nonnegative().safe(), cacheWriteTokens: z.number().int().nonnegative().safe(), reasoningTokens: z.number().int().nonnegative().safe().optional(), reported: z.literal(true), providerCostUsd: z.number().finite().nonnegative().optional() });

/** Independently parse the bounded wrapper output before redaction or persistence. */
function plannerCheckResult(output: string, exitCode: number, artifact: PatchRunPlanChecks): PatchRunPlannerCheckResult | null {
  try {
    const prefix = "SOAR_MODEL_GENERATED_CHECKS_V1=";
    if (Buffer.byteLength(output) > 16384 || !output.startsWith(prefix) || output.indexOf(prefix, prefix.length) !== -1 ||
        output.includes("\0") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(output)) throw new Error();
    const raw = output.slice(prefix.length);
    const result = PatchRunPlannerCheckResultSchema.parse(JSON.parse(raw));
    // The result schema has only scalar members. Tokenize strings atomically so
    // escaped quotes/colons in diagnostics cannot hide duplicate object keys.
    const tokens = raw.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|[^\s{}\[\],:]+/gsu)!;
    const keys = new Set<string>();
    for (let index = 1; index < tokens.length - 1; index += 4) {
      const key = JSON.parse(tokens[index]!) as string;
      if (keys.has(key)) throw new Error();
      keys.add(key);
    }
    if (result.sourceSha256 !== artifact.sha256 || result.expectedTests !== artifact.expectedTests ||
        result.passed > result.testsRun || result.testsRun > result.discoveredTests ||
        (result.completed && !(result.discoveredTests === result.testsRun && result.testsRun === artifact.expectedTests))) throw new Error();
    const successful = result.completed && result.discoveredTests === artifact.expectedTests && result.testsRun === artifact.expectedTests &&
      result.passed === artifact.expectedTests && [result.failures, result.errors, result.skipped, result.expectedFailures, result.unexpectedSuccesses].every(count => count === 0);
    const status = successful ? "passed" : result.completed ? "failed" : "invalid";
    if (result.status !== status || exitCode !== { passed: 0, failed: 1, invalid: 2 }[status]) throw new Error();
    return result;
  } catch { return null; }
}

function providerFailureSummary(reason: unknown): string {
  // Only fixed diagnostics cross into durable/UI state. Provider error bodies
  // and exception messages can echo credentials, prompts or private endpoints.
  const http = typeof reason === "string" && /^provider_http_(400|401|402|403|404|408|409|413|415|422|429|500|502|503|504)$/u.exec(reason);
  if (http) return `Provider returned HTTP ${http[1]}.`;
  const summaries: Record<string, string> = {
    provider_http_error: "Provider returned an HTTP error.",
    provider_tls_verification_failed: "Provider TLS certificate verification failed.",
    provider_tls_error: "Provider TLS connection failed.",
    provider_timeout: "Provider connection timed out.",
    provider_connection_error: "Provider connection failed.",
    provider_response_invalid: "Provider response was malformed.",
    provider_response_too_large: "Provider response exceeded the size limit.",
    provider_redirect_denied: "Provider redirect was blocked.",
    cancelled_or_timeout: "Provider request was cancelled or timed out.",
    invalid_usage: "Provider response had no valid usage receipt.",
  };
  return typeof reason === "string" && Object.hasOwn(summaries, reason)
    ? summaries[reason]! : "Provider transport or response failed.";
}

export function admitPreparedRequest(event: Record<string, unknown>, config: PatchRuntimeConfig,
  authority: { policy: PatchRunPolicy; phase: PatchRunPhase; cloudRecoveryCount?: number; checkpoint?: PatchRunCheckpoint; criticDraft?: PatchRunCriticDraft }): { provider: PatchProviderConfig; digest: string; requestId: string; reservation: number; phase: PatchRunRequestPhase } {
  const phase = PatchRunRequestPhaseSchema.parse(event.phase);
  if ((phase === "scout" && (authority.policy !== "hybrid" || authority.phase !== "local_investigation")) ||
      (phase === "local" && (!isNativePatchPolicy(authority.policy) || authority.phase !== "local_solver")) ||
      (phase === "planner" && (!patchPolicyNeedsPlan(authority.policy) || authority.phase !== "cloud_planner")) ||
      (phase === "critic" && (authority.policy !== "local_critic_repair" || authority.phase !== "cloud_critic" || !authority.criticDraft ||
        authority.checkpoint?.reason !== "critic_request_started")) ||
      (phase === "cloud" && (authority.phase !== "cloud_solver" || authority.policy === "local_only" || authority.policy === "local_critic_repair" ||
        (isNativePatchPolicy(authority.policy) && authority.cloudRecoveryCount !== 1)))) throw new Error("Request phase is not admitted by the current run policy.");
  const provider = phase === "scout" || phase === "local" ? config.local : config.cloud;
  if (config.mode !== "live" || !provider) throw new Error("Provider is not admitted for this run.");
  const endpoint = new URL(provider.endpoint);
  if (endpoint.username || endpoint.password || endpoint.hash ||
      (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && provider.allowInsecureHttp))) {
    throw new Error("Provider transport is not admitted.");
  }
  z.number().finite().nonnegative().parse(provider.inputUsdPerMillion);
  z.number().finite().nonnegative().parse(provider.outputUsdPerMillion);
  if ((phase === "cloud" || phase === "planner" || phase === "critic") && (provider.inputUsdPerMillion <= 0 || provider.outputUsdPerMillion <= 0)) throw new Error("Cloud pricing is unavailable.");
  const prepared = z.object({ method: z.literal("POST"), url: z.string(), body: z.record(z.string(), z.unknown()), bodySha256: z.string() }).strict().parse(event.preparedRequest);
  const requestId = z.string().regex(/^[a-f0-9]{32}$/u).parse(event.requestId);
  const body = prepared.body;
  const thinking = phase === "local" ? localCodingThinking(config, authority.policy) : undefined;
  const sol = isOpenAiSol(provider);
  const limits = phase === "local" ? localCodingLimits(config) : providerLimits(config, provider);
  z.number().int().min(128).max(16384).parse(limits.maxOutputTokens);
  z.number().int().positive().max(2000000).parse(limits.maxInputBytes);
  if (sol && (provider.endpoint !== "https://api.openai.com/v1/chat/completions" || provider.allowInsecureHttp ||
      provider.inputUsdPerMillion !== 4 || provider.outputUsdPerMillion !== 20 || limits.maxOutputTokens !== 8192 ||
      limits.maxInputBytes > 256000 || provider.routing !== undefined)) throw new Error("Sol calibration configuration changed.");
  const outputField = sol ? "max_completion_tokens" : "max_tokens";
  if (prepared.url !== provider.endpoint || event.model !== provider.model || body.model !== provider.model || body[outputField] !== limits.maxOutputTokens || body.stream !== false) throw new Error("Prepared request differs from the admitted provider configuration.");
  const declared = z.object({ id: z.string(), protocol: z.literal("openai"), endpoint: z.string() }).strict().parse(event.provider);
  if (declared.id !== provider.id || declared.protocol !== provider.protocol || declared.endpoint !== provider.endpoint) throw new Error("Provider identity mismatch.");
  const allowed = phase === "local" ? ["model", "messages", "max_tokens", "stream", "tools", "tool_choice", "parallel_tool_calls",
    thinking === "medium" ? "reasoning_effort" : "chat_template_kwargs"]
    : sol ? ["model", "messages", "max_completion_tokens", "stream", "reasoning_effort", "service_tier", "prompt_cache_options"]
    : ["model", "messages", "max_tokens", "stream", "provider"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new Error("Unexpected provider request field.");
  if (sol && (body.reasoning_effort !== "medium" || body.service_tier !== "default" ||
      canonicalRequest(body.prompt_cache_options) !== canonicalRequest({ mode: "explicit" }))) throw new Error("Sol reasoning, service or cache authority changed.");
  if (canonicalRequest(body.provider ?? null) !== canonicalRequest(provider.routing ?? null)) throw new Error("Provider price/routing authority changed.");
  if (phase === "local") {
    const checkpoint = PatchRunCheckpointSchema.parse(authority.checkpoint);
    const { evidenceId, ...evidence } = checkpoint;
    if (checkpoint.policy !== authority.policy || checkpoint.state !== "local" || checkpoint.reason !== "local_request_started" ||
        checkpoint.eventId !== requestId || checkpoint.evidence.requestId !== requestId ||
        createHash("sha256").update(canonicalRequest(evidence)).digest("hex") !== evidenceId) {
      throw new Error("Native tool mask does not match its request checkpoint.");
    }
    validateNativeCheckpointBudget(checkpoint, patchPolicyLimits(config, authority.policy));
    validateNativeCodingBody(body, config.workerPath, checkpoint.allowedActions, thinking);
  }
  else z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() }).strict()).min(1).parse(body.messages);
  const encoded = canonicalRequest(body);
  const bytes = Buffer.byteLength(encoded);
  if (bytes > limits.maxInputBytes || event.estimatedInputTokens !== bytes || event.maxOutputTokens !== limits.maxOutputTokens) throw new Error("Prepared request exceeds its input/output envelope.");
  if ([config.cloud?.apiKey, config.local?.apiKey].some((key) => key && encoded.includes(key))) throw new Error("Credential found in model input.");
  const digest = createHash("sha256").update(encoded).digest("hex");
  if (prepared.bodySha256 !== digest || event.bodySha256 !== digest) throw new Error("Prepared request digest mismatch.");
  if (phase === "critic" && (authority.criticDraft?.requestId !== requestId || authority.criticDraft.bodySha256 !== digest ||
      authority.checkpoint?.eventId !== requestId || authority.checkpoint.evidence.bodySha256 !== digest)) {
    throw new Error("Critic request differs from the exact host-built public context.");
  }
  // One UTF-8 byte per token is deliberately conservative; cache savings are never pre-spent.
  const reservation = z.number().int().nonnegative().safe().parse(Math.ceil(bytes * provider.inputUsdPerMillion + limits.maxOutputTokens * provider.outputUsdPerMillion));
  return { provider, digest, requestId, reservation, phase };
}

/** Preserve the worst admissible critic cost before spending draft calls. */
export function criticMaximumReservation(config: PatchRuntimeConfig): number {
  const provider = config.cloud;
  if (!provider) throw new Error("Critic pricing is unavailable.");
  const limits = providerLimits(config, provider);
  if (limits.maxOutputTokens !== 8192) throw new Error("Critic output envelope changed.");
  const bytes = Math.min(128000, z.number().int().positive().safe().parse(limits.maxInputBytes));
  const inputPrice = z.number().finite().positive().parse(provider.inputUsdPerMillion);
  const outputPrice = z.number().finite().positive().parse(provider.outputUsdPerMillion);
  return z.number().int().nonnegative().safe().parse(Math.ceil(bytes * inputPrice + 8192 * outputPrice));
}

/** The sole restarted repair conversation must carry the exact host-parsed feedback. */
export function validateCriticRepairBody(body: unknown, snapshot: PatchRunSnapshot): void {
  const checkpoint = snapshot.checkpoint, receipt = snapshot.critic;
  if (snapshot.policy !== "local_critic_repair" || !receipt || receipt.result.verdict !== "repair_required" ||
      snapshot.criticCurrent !== false || checkpoint?.reason !== "local_request_started" || checkpoint.evidence.localPhase !== "repair" ||
      checkpoint.evidence.phaseLocalCalls !== 1 || checkpoint.evidence.criticReceiptSha256 !== receipt.receiptSha256 ||
      checkpoint.localCalls !== snapshot.criticDraft!.draftLocalCalls + 1) throw new Error("Repair conversation lacks its once-only critic grant.");
  const messages = z.object({ messages: z.tuple([z.object({ role: z.literal("system"), content: z.string() }).strict(),
    z.object({ role: z.literal("user"), content: z.string() }).strict()]) }).passthrough().parse(body).messages;
  if (!messages[1].content.startsWith(snapshot.objective + "\n\nHost file inventory:\n") ||
      !messages[1].content.includes("\n\nThe host runs this exact visible command via run_visible_checks:\n" + snapshot.checks.command + "\n") ||
      !messages[1].content.endsWith("\nHost-parsed critique:\n" + JSON.stringify(receipt.result))) {
    throw new Error("Repair conversation omitted or changed the exact host-parsed critic feedback.");
  }
}

export interface PatchWorkerCompletion { cleanupConfirmed: boolean; error?: string }
export interface PatchWorkerHandle { done: Promise<PatchWorkerCompletion>; cancel(): void }

/** Main-owned budget identity and check/finish action authority; defaults remain 24. */
export function validateNativeCheckpointBudget(checkpoint: PatchRunCheckpoint,
  limits: { localStepLimit?: number; finishingReserve?: number; stepLimit?: number; draftLocalStepLimit?: number; repairLocalStepLimit?: number;
    localCoding?: { checkSchedule?: LocalCodingCheckSchedule } }): void {
  const cap = limits.localStepLimit, reserve = limits.finishingReserve;
  const schedule = z.enum(["final_only", "repair_window", "host_repair_window"]).parse(
    limits.localCoding?.checkSchedule === undefined ? "final_only" : limits.localCoding.checkSchedule);
  const recordedSchedule = z.enum(["final_only", "repair_window", "host_repair_window"]).parse(
    checkpoint.evidence.checkSchedule === undefined ? "final_only" : checkpoint.evidence.checkSchedule);
  if (recordedSchedule !== schedule || (schedule !== "final_only" &&
      ((schedule === "repair_window" && checkpoint.policy !== "local_only") || cap === undefined || cap < 5 ||
        (limits.stepLimit !== undefined && limits.stepLimit < cap)))) {
    throw new Error("Native checkpoint check schedule differs from its admitted policy or call budget.");
  }
  if (checkpoint.policy === "local_critic_repair") {
    if (cap !== 12 || limits.draftLocalStepLimit !== 8 || limits.repairLocalStepLimit !== 4 || limits.stepLimit !== 13 ||
        schedule !== "final_only" || reserve !== 2) throw new Error("Critic policy budget configuration changed.");
    validateCriticCheckpointBudget(checkpoint);
    if (checkpoint.sequence === 1 && (checkpoint.evidence.maxLocalCalls !== cap || checkpoint.evidence.finishReserve !== reserve)) {
      throw new Error("Critic initial budget identity differs from its episode allowance.");
    }
  } else if (cap === undefined || reserve !== 2 || checkpoint.localCalls < 0 || checkpoint.localCalls > cap ||
      checkpoint.remainingLocalCalls < 0 || checkpoint.remainingLocalCalls > cap || checkpoint.localCalls + checkpoint.remainingLocalCalls !== cap ||
      (checkpoint.sequence === 1 && (checkpoint.evidence.maxLocalCalls !== cap || checkpoint.evidence.finishReserve !== reserve))) {
    throw new Error("Native checkpoint budget differs from its admitted call limit.");
  }
  if (cap === undefined) throw new Error("Native call allowance is missing.");
  const hostUsed = schedule === "host_repair_window" ? z.boolean().parse(checkpoint.evidence.hostCheckUsed) : false;
  if ((checkpoint.reason === "host_check_started" && (schedule !== "host_repair_window" || !hostUsed ||
      checkpoint.state !== "local" || checkpoint.decision !== "continue" || checkpoint.localCalls !== Math.min(4, cap - 4) ||
      checkpoint.checkSourceSha256 === checkpoint.sourceSha256 || checkpoint.failedChecks !== 0)) ||
      (schedule === "host_repair_window" && checkpoint.sequence === 1 && (hostUsed || checkpoint.localCalls !== 0))) {
    throw new Error("Native host check is outside its admitted initial window.");
  }
  if (schedule === "host_repair_window" && checkpoint.reason === "local_request_started" && !hostUsed &&
      checkpoint.localCalls - 1 === Math.min(4, cap - 4) && checkpoint.failedChecks === 0 &&
      checkpoint.checkSourceSha256 !== checkpoint.sourceSha256) {
    throw new Error("Native request skipped its due host check.");
  }
  const allowed: string[] = [];
  if (checkpoint.state === "local" && checkpoint.reason !== "host_check_started") {
    // A started request was counted already, but owns the allowance from just
    // before dispatch. Observed checkpoints describe the following request.
    const remaining = checkpoint.remainingLocalCalls + (checkpoint.reason === "local_request_started" ? 1 : 0);
    if (remaining > 0) {
      const earlyCheck = schedule === "repair_window" && remaining === 4 &&
        checkpoint.checkSourceSha256 !== checkpoint.sourceSha256 && checkpoint.failedChecks === 0;
      if (remaining > reserve && !earlyCheck) allowed.push("run_command");
      if (remaining >= reserve) allowed.push("run_visible_checks");
      if (checkpoint.checkSourceSha256 === checkpoint.sourceSha256) allowed.push("submit_task");
      allowed.push("request_help");
    }
  }
  if (canonicalRequest(checkpoint.allowedActions) !== canonicalRequest(allowed)) {
    throw new Error("Native checkpoint actions consume the reserved finishing calls.");
  }
}

function providerDisplayLabel(provider: PatchProviderConfig): string {
  const name = provider.id === "openai" ? "OpenAI" : provider.id === "openrouter" ? "OpenRouter" : provider.id;
  return `${name} · ${provider.model}`;
}

export async function removeRunContainers(id: string): Promise<void> {
  if (!/^[a-f0-9-]{36}$/u.test(id)) throw new Error("Invalid run identity.");
  const { stdout } = await runFile("docker", ["ps", "-aq", "--filter", "label=soar.patch-worker=1", "--filter", `label=soar.run-id=${id}`], { timeout: 10_000, maxBuffer: 8192 });
  for (const container of stdout.trim().split(/\s+/u).filter(Boolean)) {
    if (!/^[a-f0-9]{12,64}$/u.test(container)) throw new Error("Invalid container identity.");
    await runFile("docker", ["rm", "--force", container], { timeout: 15_000, maxBuffer: 8192 });
  }
  const remaining = await runFile("docker", ["ps", "-aq", "--filter", "label=soar.patch-worker=1", "--filter", `label=soar.run-id=${id}`], { timeout: 10_000, maxBuffer: 8192 });
  if (remaining.stdout.trim()) throw new Error("Task container cleanup could not be confirmed.");
}

export function launchPatchWorker(options: {
  config: PatchRuntimeConfig; store: PatchRunStore; snapshot: PatchRunSnapshot; workspace: string; image: string;
  publish(snapshot: PatchRunSnapshot): void;
}): PatchWorkerHandle {
  const { config, store, snapshot, publish } = options;
  const id = snapshot.id;
  const limits = patchPolicyLimits(config, snapshot.policy);
  const plannerChecksEnabled = limits.plannerMode === "plan_and_checks";
  const checkReserveSeconds = limits.visibleCheckTimeoutSeconds * (plannerChecksEnabled ? 2 : 1);
  const workerStartedAt = performance.now();
  const remainingMs = () => limits.wallTimeSeconds * 1000 - (performance.now() - workerStartedAt);
  const child = spawn(config.python, ["-u", config.workerPath], {
    cwd: options.workspace,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONFIG: process.env.DOCKER_CONFIG, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const secrets = [config.cloud?.apiKey, config.local?.apiKey, config.cloud?.endpoint, config.local?.endpoint, options.workspace, store.getWorkspaceRoot(id)].filter((v): v is string => Boolean(v));
  const redact = (value: unknown, limit = 48 * 1024): string => {
    let text = typeof value === "string" ? value : "";
    for (const secret of secrets) text = text.split(secret).join("[redacted]");
    return text.replace(/sk-[a-zA-Z0-9_-]{12,}/gu, "[redacted]").replace(/\x1b\[[0-9;]*[a-zA-Z]/gu, "").slice(0, limit);
  };
  let stopped = false;
  let terminal: { status: "completed" | "checks_failed" | "cancelled" | "failed"; error?: string } | undefined;
  let sequence = 0;
  let buffer = "";
  let stderrBytes = 0;
  let command = "";
  let failure: Error | undefined;
  let queue = Promise.resolve();
  const pending = new Map<string, { provider: PatchProviderConfig; reservation: number; phase: PatchRunRequestPhase }>();
  const contextAbort = new AbortController();
  let criticContext: Awaited<ReturnType<typeof prepareCriticContext>> | undefined;
  let previousLocalMessages: unknown[] | undefined;
  let repairConversationGranted = false;
  const hostSchedule = limits.localCoding?.checkSchedule === "host_repair_window";
  const strictActions = hostSchedule || snapshot.policy === "local_critic_repair";
  let hostCheck: { checkpoint: PatchRunCheckpoint; receipt?: { before: string; after: string; code: number; passed: boolean } } | undefined;
  let localAction: { checkpointEvidenceId: string; kind: "command" | "check"; completed: boolean } | undefined;
  let plannerCheckWindow: { checkpoint: PatchRunCheckpoint; visible: { before: string; after: string; code: number; passed: boolean };
    visibleCompleted: boolean; visibleTimedOut: boolean; generated?: PatchRunPlannerCheck } | undefined;
  let finalVisibleCheck: { before: string; after: string } | undefined;
  let finalPlannerCheck: PatchRunPlannerCheck | undefined;
  const simulatedCounts: Record<PatchRunRequestPhase, number> = { scout: 0, local: 0, planner: 0, cloud: 0, critic: 0 };
  const settledLocalCalls = (current: PatchRunSnapshot, count: number): boolean => !pending.size && !store.hasUnresolvedRequests(id) &&
    (config.mode === "scripted" ? simulatedCounts.local === count :
      current.phaseUsage?.local?.requestCount === count && current.phaseUsage.local.usageReceipts === count && current.phaseUsage.local.unknownRequests === 0);
  const requireSettledLocalAction = (current: PatchRunSnapshot): PatchRunCheckpoint => {
    const checkpoint = current.checkpoint;
    if (hostCheck || localAction || current.phase !== "local_solver" || !checkpoint || checkpoint.state !== "local" ||
        checkpoint.reason !== "local_request_started" || checkpoint.eventId !== checkpoint.evidence.requestId ||
        !settledLocalCalls(current, checkpoint.localCalls)) throw new Error("Native action lacks a settled model request or overlaps a host check.");
    return checkpoint;
  };
  const send = (message: unknown): void => { if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`); };
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (stopped) return;
    stopped = true;
    contextAbort.abort();
    send({ type: "cancel" });
    child.kill("SIGTERM");
    // The worker has a bounded artifact-only recovery period after admission
    // stops, followed by cleanup. Independent container removal still runs.
    forceKill = setTimeout(() => child.kill("SIGKILL"), 45_000);
    forceKill.unref();
  };
  const fail = (error: unknown): void => {
    failure ??= error instanceof Error ? error : new Error("Coding worker protocol failed.");
    cancel();
  };
  const running = (): boolean => !stopped && store.get(id).status === "running";
  const record = (type: string, summary: string): void => { publish(store.recordEvent(id, { type, summary: redact(summary, 1000) })); };
  const receive = async (raw: unknown): Promise<void> => {
    const event = eventSchema.parse(raw);
    if (event.sequence !== sequence + 1) throw new Error("Worker event order is invalid.");
    sequence = event.sequence;
    if (event.type === "ready") {
      if (sequence !== 1 || event.runId !== "" || stopped) throw new Error("Unexpected worker readiness.");
      send({ type: "start", runId: id, mode: config.mode, policy: snapshot.policy, workspace: options.workspace,
        baseRevision: snapshot.baseRevision, containerImage: options.image, objective: snapshot.objective,
        visibleTestCommand: snapshot.checks.command,
        providers: config.mode === "live" ? {
          ...(patchPolicyNeedsCloud(snapshot.policy) && config.cloud ? { cloud: config.cloud } : {}),
          ...(patchPolicyNeedsLocal(snapshot.policy) && config.local ? { local: config.local } : {}),
        } : {},
        limits,
        ...(config.scriptedActions ? { scriptedActions: config.scriptedActions } : {}),
      });
      return;
    }
    if (event.runId !== id) throw new Error("Worker run identity mismatch.");
    if (terminal !== undefined) throw new Error("Worker sent an event after its terminal receipt.");
    if (event.type === "terminal") {
      const status = z.enum(["completed", "checks_failed", "cancelled", "failed"]).parse(event.status);
      if (plannerChecksEnabled && status === "completed" && !finalPlannerCheck?.passed) {
        throw new Error("Completed run lacks its passing final planner-check receipt.");
      }
      terminal = { status, ...(status === "failed" ? { error: `Worker stopped: ${redact(event.errorCode, 200) || "runtime failure"}` } : {}) };
      // A receipt alone is not completion: wait for process exit and confirmed cleanup.
      return;
    }
    const inertWhileStopping = stopped && store.get(id).status === "running" &&
      (["patch.ready", "patch.recovered", "command.finished", "recovery.failed"].includes(event.type) ||
        (event.type === "preparation.finished" && event.kind === "scout") ||
        (event.type === "routing.checkpoint" && typeof event.checkpoint === "object" && event.checkpoint !== null &&
          "decision" in event.checkpoint && event.checkpoint.decision === "stop"));
    if (!running() && !inertWhileStopping) return;
    switch (event.type) {
      case "request.prepare": {
        const current = store.get(id);
        if (strictActions && (hostCheck || localAction)) throw new Error("Provider request overlaps an unfinished native action or host check.");
        const request = admitPreparedRequest(event, config, current);
        if (remainingMs() < (limits.requestTimeoutSeconds + checkReserveSeconds) * 1000) throw new Error("Provider request cannot fit the remaining episode deadline and final check reserve.");
        if ((snapshot.policy === "cloud_plan_local_review" || (snapshot.policy === "local_critic_repair" &&
            current.checkpoint?.evidence.localPhase === "draft")) && request.phase === "local" &&
            remainingMs() <= 2 * (limits.requestTimeoutSeconds + checkReserveSeconds) * 1000) {
          throw new Error("Local request cannot consume the required cloud review and check reserve.");
        }
        if (isNativePatchPolicy(snapshot.policy)) {
          const totalCalls = Object.values(current.phaseUsage ?? {}).reduce((sum, usage) => sum + usage.requestCount, 0);
          if (totalCalls >= limits.stepLimit || (request.phase === "local" && (current.phaseUsage?.local?.requestCount ?? 0) >= limits.localStepLimit!) ||
              (snapshot.policy === "cloud_plan_local_review" && request.phase === "local" && totalCalls >= limits.stepLimit - 1) ||
              (request.phase === "planner" && (current.phaseUsage?.planner?.requestCount ?? 0) >= 1) ||
              (request.phase === "critic" && (current.phaseUsage?.critic?.requestCount ?? 0) >= 1)) throw new Error("Provider request exceeds its admitted phase or episode call limit.");
          if ((request.phase === "planner" && current.checkpoint?.state !== "planner") ||
              (request.phase === "cloud" && current.checkpoint?.state !== "cloud") ||
              (request.phase === "critic" && current.checkpoint?.state !== "critic")) throw new Error("Provider request is outside its checkpoint state.");
          if (request.phase === "critic" && (!criticContext || request.digest !== criticContext.bodySha256 ||
              canonicalRequest((event.preparedRequest as { body: unknown }).body) !== canonicalRequest(criticContext.body))) {
            throw new Error("Critic request changed its complete host-built body.");
          }
          if (request.phase === "local") {
            if (current.checkpoint?.state !== "local" || current.checkpoint.reason !== "local_request_started" ||
                current.checkpoint.eventId !== request.requestId || current.checkpoint.evidence.requestId !== request.requestId ||
                current.checkpoint.localCalls !== (current.phaseUsage?.local?.requestCount ?? 0) + 1) {
              throw new Error("Local request does not match its source-bound request checkpoint.");
            }
            validateNativeCheckpointBudget(current.checkpoint, limits);
            if (snapshot.policy === "local_critic_repair" && current.checkpoint.evidence.localPhase === "repair" &&
                current.checkpoint.evidence.phaseLocalCalls === 1) {
              if (!repairConversationGranted || previousLocalMessages) throw new Error("Repair conversation restart was not granted exactly once.");
              validateCriticRepairBody((event.preparedRequest as { body: unknown }).body, current);
            }
            const messages = (event.preparedRequest as { body: { messages: unknown[] } }).body.messages;
            if (previousLocalMessages && (messages.length < previousLocalMessages.length + 2 ||
                canonicalRequest(messages.slice(0, previousLocalMessages.length)) !== canonicalRequest(previousLocalMessages))) {
              throw new Error("Native continuation rewrote or omitted its admitted history.");
            }
            previousLocalMessages = structuredClone(messages);
          }
        }
        publish(store.reserveRequest(id, { requestId: request.requestId, amountMicrousd: request.reservation, providerLabel: redact(providerDisplayLabel(request.provider), 256),
          model: request.provider.model, phase: request.phase, inputSha256: request.digest, campaignLimitMicrousd: config.campaignCapMicrousd },
          snapshot.policy === "local_critic_repair" && request.phase === "local" && current.checkpoint?.evidence.localPhase === "draft"
            ? criticMaximumReservation(config) : undefined));
        // Mark potentially sent before ACK. A crash between these operations stays conservatively reserved.
        publish(store.startRequest(id, request.requestId));
        pending.set(request.requestId, request);
        send({ type: "request.admitted", requestId: request.requestId, bodySha256: request.digest });
        break;
      }
      case "request.finished": {
        const requestId = z.string().parse(event.requestId);
        const request = pending.get(requestId);
        if (!request) throw new Error("Unadmitted provider receipt.");
        const usage = usageSchema.parse(event.usage);
        const conservative = Math.ceil((usage.inputTokens + usage.cacheWriteTokens) * request.provider.inputUsdPerMillion + usage.outputTokens * request.provider.outputUsdPerMillion);
        const cost = usage.providerCostUsd === undefined ? conservative : Math.ceil(usage.providerCostUsd * 1_000_000);
        const { reported: _reported, providerCostUsd: _cost, ...storedUsage } = usage;
        publish(store.finishRequest(id, { requestId, outcome: "succeeded", actualCostMicrousd: cost, usage: storedUsage }));
        pending.delete(requestId);
        if (typeof event.reportedModel === "string" && (/^[a-zA-Z0-9._:-]{1,256}$/u.test(event.reportedModel) ||
            (event.reportedModel === request.provider.model && /^[a-zA-Z0-9][a-zA-Z0-9 ._:-]{0,255}$/u.test(event.reportedModel)))) {
          record("provider.model", `Provider reported model: ${redact(event.reportedModel, 256)}`);
        }
        if (usage.providerCostUsd === undefined && request.provider.id !== "local") record("cost.estimated", "Usage accounted at the admitted price ceiling; provider billing receipt was unavailable.");
        if (cost > request.reservation) throw new Error("Provider usage exceeded its admitted envelope; run stopped.");
        if (usage.outputTokens > (request.phase === "local" ? localCodingLimits(config) : providerLimits(config, request.provider)).maxOutputTokens) {
          throw new Error("Provider usage exceeded its admitted output allowance; run stopped.");
        }
        if (request.phase === "local" && (usage.reasoningTokens ?? 0) > usage.outputTokens) {
          throw new Error("Native reasoning usage exceeded total output; run stopped.");
        }
        if (isOpenAiSol(request.provider) && (usage.cacheReadTokens !== 0 || usage.cacheWriteTokens !== 0 ||
            (usage.reasoningTokens ?? 0) > usage.outputTokens)) {
          throw new Error("Sol usage differs from its admitted output or cache controls; run stopped.");
        }
        break;
      }
      case "request.unsettled": {
        const requestId = z.string().parse(event.requestId);
        if (!pending.has(requestId)) throw new Error("Unadmitted unsettled request.");
        publish(store.finishRequest(id, { requestId, outcome: "unknown" }));
        pending.delete(requestId);
        const diagnostic = providerFailureSummary(event.reason);
        record("provider.failed", diagnostic);
        throw new Error(`${diagnostic} Provider outcome is unknown. Its maximum exposure remains reserved; this run cannot continue.`);
      }
      case "critic.context.prepare": {
        const current = store.get(id), checkpoint = current.checkpoint;
        const identity = z.object({ requestId: z.string().regex(/^[a-f0-9]{32}$/u), checkpointEvidenceId: z.string().regex(/^[a-f0-9]{64}$/u),
          baseRevision: z.string().min(1).max(128), patch: z.string().min(1).max(1048576), patchSha256: z.string().regex(/^[a-f0-9]{64}$/u),
          sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u), checkSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u) }).parse(event);
        if (snapshot.policy !== "local_critic_repair" || current.phase !== "local_solver" || current.criticDraft || criticContext ||
            checkpoint?.reason !== "critic_required" || checkpoint.state !== "critic" || checkpoint.evidenceId !== identity.checkpointEvidenceId ||
            identity.baseRevision !== snapshot.baseRevision || identity.sourceSha256 !== checkpoint.sourceSha256 ||
            identity.checkSourceSha256 !== checkpoint.checkSourceSha256 || !settledLocalCalls(current, checkpoint.localCalls) ||
            identity.patchSha256 !== createHash("sha256").update(identity.patch).digest("hex") ||
            secrets.some(secret => identity.patch.includes(secret))) throw new Error("Critic context is outside its checked provisional draft authority.");
        criticContext = await prepareCriticContext({ workspace: options.workspace, taskId: id, objective: snapshot.objective,
          visibleCommand: snapshot.checks.command, baseRevision: snapshot.baseRevision, patch: identity.patch,
          expectedSourceSha256: identity.sourceSha256, config, signal: contextAbort.signal });
        if (!running() || store.get(id).checkpoint?.evidenceId !== identity.checkpointEvidenceId ||
            remainingMs() < (limits.requestTimeoutSeconds + checkReserveSeconds) * 1000) throw new Error("Critic context lost its active source or episode time authority.");
        const { patch: _patch, ...binding } = identity;
        const { baselineSourceSha256, sourceSha256, patchSha256, objectiveSha256, visibleCommandSha256, bundleSha256, bodySha256 } = criticContext;
        const draft: PatchRunCriticDraft = { schemaVersion: 1, ...binding, baselineSourceSha256, sourceSha256, patchSha256,
          objectiveSha256, visibleCommandSha256, bundleSha256, bodySha256, draftLocalCalls: checkpoint.localCalls };
        publish(store.recordCriticDraft(id, draft));
        send({ type: "critic.context.ready", ...binding, bundleSha256, bodySha256, body: criticContext.body });
        break;
      }
      case "critic.response": {
        const current = store.get(id), draft = current.criticDraft;
        if (snapshot.policy !== "local_critic_repair" || !draft || !criticContext || current.critic || current.phase !== "cloud_critic" ||
            pending.size || store.hasUnresolvedRequests(id) || current.phaseUsage?.critic?.requestCount !== 1 ||
            current.phaseUsage.critic.usageReceipts !== 1 || current.phaseUsage.critic.unknownRequests !== 0 ||
            current.phaseUsage.critic.reservedMicrousd !== 0 || current.checkpoint?.reason !== "critic_request_started" ||
            ["requestId", "sourceSha256", "patchSha256", "bundleSha256", "bodySha256"].some(key => event[key] !== draft[key as keyof PatchRunCriticDraft])) {
          throw new Error("Critic response lacks its exact settled request and source authority.");
        }
        // Never persist or expose invalid raw provider content. Its fee is already durable.
        let result: PatchRunCriticReceipt["result"];
        const responseSha256 = createHash("sha256").update(canonicalRequest(event.response)).digest("hex");
        try {
          if (event.responseSha256 !== responseSha256 || Buffer.byteLength(canonicalRequest(event.response)) > 131072 ||
              secrets.some(secret => canonicalRequest(event.response).includes(secret))) throw new Error();
          result = parseCompactCriticResponse(event.response, criticContext.bundle);
        } catch { throw new Error("Compact critic response was invalid after usage settlement; no repair was authorized."); }
        const value = { schemaVersion: 1 as const, requestId: draft.requestId, sourceSha256: draft.sourceSha256, patchSha256: draft.patchSha256,
          bundleSha256: draft.bundleSha256, bodySha256: draft.bodySha256, responseSha256, result };
        const receiptSha256 = createHash("sha256").update(canonicalRequest(value)).digest("hex");
        publish(store.recordCriticReceipt(id, { ...value, receiptSha256 }));
        send({ type: "critic.verdict", ...value, receiptSha256 });
        break;
      }
      case "phase.started": {
        const phase = PatchRunRequestPhaseSchema.parse(event.phase);
        const current = store.get(id);
        if (plannerChecksEnabled && phase === "local" && (!current.cloudPlan?.checks ||
            current.checkpoint?.reason !== "cloud_plan_completed" ||
            current.checkpoint.evidence.plannerChecksSha256 !== current.cloudPlan.checks.sha256)) {
          throw new Error("Local execution lacks its bound planner checks.");
        }
        if (pending.size > 0 || store.hasUnresolvedRequests(id) || current.phase === "checking" || current.phase === "cloud_solver" ||
            (phase === "cloud" && current.localInvestigation?.outcome === "stopped") ||
            (phase === "scout" && (snapshot.policy !== "hybrid" || current.phase !== "preparing"))) {
          throw new Error("Worker phase transition is not admitted.");
        }
        const provider = phase === "scout" || phase === "local" ? config.local : config.cloud;
        if (config.mode === "live" && (!provider || event.model !== provider.model)) throw new Error("Phase provider does not match its authority.");
        if (config.mode === "scripted" && ((!isNativePatchPolicy(snapshot.policy) && phase !== "cloud") || event.simulated !== true)) throw new Error("Invalid scripted phase.");
        const label = provider ? redact(providerDisplayLabel(provider), 256) : "Scripted fixture (no model)";
        if (isNativePatchPolicy(snapshot.policy)) {
          if (phase === "cloud") {
            if (remainingMs() < (limits.requestTimeoutSeconds + checkReserveSeconds) * 1000) throw new Error("Cloud recovery cannot fit its request and check reserve.");
            publish(store.beginCloudRecovery(id, label));
          }
          else if (phase === "critic" && snapshot.policy === "local_critic_repair" && current.phase === "local_solver" &&
              current.checkpoint?.reason === "critic_request_started" && criticContext && current.criticDraft) publish(store.setPhase(id, "cloud_critic", label));
          else if (phase === "planner" && patchPolicyNeedsPlan(snapshot.policy) && current.phase === "preparing") publish(store.setPhase(id, "cloud_planner", label));
          else if (phase === "local" && ((current.phase === "preparing" && !patchPolicyNeedsPlan(snapshot.policy)) ||
              (current.phase === "cloud_planner" && patchPolicyNeedsPlan(snapshot.policy) && current.cloudPlan) ||
              (snapshot.policy === "local_critic_repair" && current.phase === "cloud_critic" && current.critic?.result.verdict === "repair_required" &&
                current.checkpoint?.reason === "critic_repair_required"))) {
            if (snapshot.policy === "local_critic_repair" && current.phase === "cloud_critic") {
              if (repairConversationGranted || pending.size || hostCheck || localAction ||
                  current.checkpoint?.evidence.criticReceiptSha256 !== current.critic?.receiptSha256) throw new Error("Repair conversation grant is unavailable.");
              repairConversationGranted = true; previousLocalMessages = undefined;
            }
            publish(store.setPhase(id, "local_solver", label));
          }
          else throw new Error("Native worker phase transition is not admitted.");
        } else {
          if (phase !== "scout" && phase !== "cloud") throw new Error("Native phase is not part of this policy.");
          publish(store.setPhase(id, phase === "scout" ? "local_investigation" : "cloud_solver", label));
        }
        break;
      }
      case "command.started": {
        const current = store.get(id);
        if (snapshot.policy === "local_critic_repair" && current.phase !== "local_solver") throw new Error("Critic phase cannot execute native commands.");
        if (current.phase === "local_solver" && !current.checkpoint?.allowedActions.includes("run_command")) {
          throw new Error("Native command would consume reserved finishing calls.");
        }
        if (strictActions && current.phase === "local_solver") {
          const checkpoint = requireSettledLocalAction(current);
          localAction = { checkpointEvidenceId: checkpoint.evidenceId, kind: "command", completed: false };
        }
        if (current.phase === "local_solver" || (snapshot.policy === "cloud_plan_local_review" && current.phase === "cloud_solver")) {
          publish(store.invalidateCheckpointCheck(id));
        }
        command = redact(event.command, 4096); record("tool.started", command); break;
      }
      case "native.action_denied": {
        const denial = z.object({ type: z.literal("native.action_denied"), protocolVersion: z.literal(1),
          runId: z.literal(id), sequence: z.number().int().positive(),
          requestId: z.string().regex(/^[a-f0-9]{32}$/u), checkpointEvidenceId: z.string().regex(/^[a-f0-9]{64}$/u),
          localCall: z.number().int().min(1).max(24),
          action: z.enum(["run_command", "run_visible_checks", "submit_task", "request_help"]) }).strict().parse(event);
        const current = store.get(id), checkpoint = current.checkpoint;
        if (current.phase !== "local_solver" || !checkpoint || checkpoint.state !== "local" ||
            checkpoint.reason !== "local_request_started" || checkpoint.eventId !== denial.requestId ||
            checkpoint.evidence.requestId !== denial.requestId || checkpoint.evidenceId !== denial.checkpointEvidenceId ||
            checkpoint.localCalls !== denial.localCall || checkpoint.allowedActions.includes(denial.action) ||
            pending.size || store.hasUnresolvedRequests(id) ||
            (config.mode === "live" ? current.phaseUsage?.local?.requestCount : simulatedCounts.local) !== denial.localCall) {
          throw new Error("Native action denial does not match its settled request checkpoint.");
        }
        validateNativeCheckpointBudget(checkpoint, limits);
        record("native.action_denied", `Denied ${denial.action}; request ${denial.requestId}; checkpoint ${denial.checkpointEvidenceId}; local call ${denial.localCall}.`);
        throw new Error("Native action was outside its admitted checkpoint allowance.");
      }
      case "command.finished": {
        if (snapshot.policy === "local_critic_repair" && store.get(id).phase !== "local_solver") throw new Error("Critic phase cannot report native commands.");
        if (strictActions && store.get(id).phase === "local_solver" &&
            (hostCheck || localAction?.kind !== "command" || localAction.completed ||
              localAction.checkpointEvidenceId !== store.get(id).checkpoint?.evidenceId)) {
          throw new Error("Native command receipt lacks its active settled request.");
        }
        publish(store.recordTool(id, { command, exitCode: z.number().int().parse(event.returncode), output: redact(event.output) }));
        if (strictActions && localAction) localAction.completed = true;
        break;
      }
      case "command.recovered": {
        const count = z.number().int().min(1).max(2).parse(event.count);
        record("command.recovered", `Timed-out command stopped. Source edits restored in a fresh isolated workspace (recovery ${count} of 2).`);
        break;
      }
      case "verification.started": {
        const current = store.get(id);
        if (snapshot.policy === "local_critic_repair" && (current.phase === "checking" || finalVisibleCheck ||
            current.checkpoint?.decision !== "submit")) throw new Error("Critic policy final verification is not available.");
        if (snapshot.policy === "cloud_plan_local_review" && (current.phase !== "cloud_solver" || current.cloudRecoveryCount !== 1)) {
          throw new Error("Final verification requires the admitted cloud review phase.");
        }
        publish(store.setPhase(id, "checking")); break;
      }
      case "verification.finished": {
        const code = z.number().int().parse(event.returncode);
        if (isNativePatchPolicy(snapshot.policy)) {
          const before = z.string().regex(/^[a-f0-9]{64}$/u).parse(event.sourceSha256);
          const after = z.string().regex(/^[a-f0-9]{64}$/u).parse(event.sourceAfterSha256);
          const passed = z.boolean().parse(event.passed);
          if ((plannerChecksEnabled || snapshot.policy === "local_critic_repair") && (store.get(id).phase !== "checking" || finalVisibleCheck)) {
            throw new Error("Final visible check is outside its one verification invocation.");
          }
          if (passed !== (code === 0 && before === after)) throw new Error("Final check receipt differs from its exit or source identity.");
          publish(store.recordChecks(id, { status: passed ? "passed" : "failed", command: snapshot.checks.command,
            exitCode: code, output: redact(event.output), sourceSha256: before, sourceAfterSha256: after }));
          if (plannerChecksEnabled || snapshot.policy === "local_critic_repair") finalVisibleCheck = { before, after };
        } else publish(store.recordChecks(id, { status: code === 0 ? "passed" : "failed", command: snapshot.checks.command, exitCode: code, output: redact(event.output) }));
        break;
      }
      case "patch.ready":
      case "patch.recovered": {
        if (event.type === "patch.ready" && snapshot.policy === "cloud_plan_local_review" && config.mode === "scripted" && simulatedCounts.cloud < 1) {
          throw new Error("Scripted reviewed submission requires a simulated cloud review action.");
        }
        if (event.type === "patch.ready" && snapshot.policy === "local_critic_repair" && store.get(id).checkpoint?.decision !== "submit") {
          throw new Error("Critic policy patch has not reached its admitted submission checkpoint.");
        }
        if (event.type === "patch.ready" && isNativePatchPolicy(snapshot.policy) && store.get(id).phase === "local_solver" &&
            store.get(id).checkpoint?.decision !== "submit") throw new Error("Native patch was not submitted through its checked checkpoint.");
        const patch = z.string().max(1_048_576).parse(event.patch);
        if (event.baseRevision !== snapshot.baseRevision || createHash("sha256").update(patch).digest("hex") !== event.sha256) throw new Error("Patch artifact identity mismatch.");
        if (secrets.some((secret) => patch.includes(secret))) throw new Error("Patch contains a private value and cannot be exported.");
        if (event.type === "patch.ready" && snapshot.policy === "local_critic_repair") {
          const current = store.get(id);
          const finalContext = await verifyCriticCandidate({ workspace: options.workspace, objective: snapshot.objective,
            baseRevision: snapshot.baseRevision, patch, expectedSourceSha256: current.checkpoint!.sourceSha256, signal: contextAbort.signal });
          if (!running() || finalContext.baselineSourceSha256 !== current.criticDraft?.baselineSourceSha256 ||
              finalContext.sourceSha256 !== current.checkpoint!.sourceSha256 ||
              finalContext.patchSha256 !== event.sha256) throw new Error("Final critic-policy source reconstruction was cancelled or changed.");
        }
        const files = [...new Set([...patch.matchAll(/^\+\+\+ b\/(.+)$/gmu)].map((match) => match[1]))];
        publish(store.recordPatch(id, { kind: event.type === "patch.recovered" ? "recovered" : "submitted",
          text: patch, sha256: String(event.sha256), files, truncated: false }));
        break;
      }
      case "recovery.failed": record("recovery.failed", "Latest unfinished edits could not be recovered. Any previously captured patch is unchanged."); break;
      case "checkpoint.checked": {
        const current = store.get(id);
        if (current.phase === "local_solver" && !hostCheck && !current.checkpoint?.allowedActions.includes("run_visible_checks")) {
          throw new Error("Native check would consume the reserved submission call.");
        }
        const before = z.string().regex(/^[a-f0-9]{64}$/u).parse(event.sourceSha256);
        const after = z.string().regex(/^[a-f0-9]{64}$/u).parse(event.sourceAfterSha256);
        const code = z.number().int().parse(event.returncode), passed = z.boolean().parse(event.passed);
        const visibleCompleted = plannerChecksEnabled ? z.boolean().parse(event.completed) : true;
        const visibleTimedOut = plannerChecksEnabled ? z.boolean().parse(event.timedOut) : false;
        if (plannerChecksEnabled && (plannerCheckWindow || visibleCompleted === visibleTimedOut ||
            (!visibleCompleted && passed))) throw new Error("Visible check completion flags or invocation are inconsistent.");
        if (strictActions) {
          if (hostCheck) {
            if (hostCheck.receipt || current.phase !== "local_solver" ||
                current.checkpoint?.evidenceId !== hostCheck.checkpoint.evidenceId ||
                !settledLocalCalls(current, hostCheck.checkpoint.localCalls) || before !== hostCheck.checkpoint.sourceSha256) {
              throw new Error("Host check receipt differs from its active source and settled boundary.");
            }
          } else if (requireSettledLocalAction(current).sourceSha256 !== before) {
            throw new Error("Native check receipt differs from its request source.");
          }
        }
        publish(store.recordCheckpointCheck(id, { command: z.string().max(4096).parse(event.command),
          exitCode: code, output: redact(event.output),
          elapsedMs: z.number().int().nonnegative().safe().parse(event.elapsedMs),
          sourceSha256: before, sourceAfterSha256: after, passed, fresh: before === after }));
        if (hostCheck) hostCheck.receipt = { before, after, code, passed };
        else if (strictActions) localAction = { checkpointEvidenceId: current.checkpoint!.evidenceId, kind: "check", completed: true };
        if (plannerChecksEnabled) plannerCheckWindow = { checkpoint: current.checkpoint!, visible: { before, after, code, passed },
          visibleCompleted, visibleTimedOut };
        break;
      }
      case "planner.checks.checked": {
        const current = store.get(id), artifact = current.cloudPlan?.checks;
        if (!plannerChecksEnabled || !artifact) throw new Error("Generated checks are outside the admitted planner profile.");
        const { type: _type, protocolVersion: _version, runId: _run, sequence: _sequence, ...payload } = event;
        const check = PatchRunPlannerCheckSchema.parse(payload);
        const parsed = check.timedOut || check.outputTruncated ? null : plannerCheckResult(check.output, check.exitCode, artifact);
        if (canonicalRequest(check.result) !== canonicalRequest(parsed)) throw new Error("Generated-check result differs from its raw process output.");
        if (check.stage === "checkpoint") {
          if (!plannerCheckWindow || plannerCheckWindow.generated || !plannerCheckWindow.visibleCompleted || plannerCheckWindow.visibleTimedOut ||
              current.checkpoint?.evidenceId !== plannerCheckWindow.checkpoint.evidenceId ||
              !(hostCheck || localAction?.kind === "check") || !settledLocalCalls(current, plannerCheckWindow.checkpoint.localCalls) ||
              check.sourceSha256 !== plannerCheckWindow.visible.before) throw new Error("Generated-check receipt lacks its active visible-check invocation.");
        } else if (!finalVisibleCheck || finalPlannerCheck || current.phase !== "checking" ||
            check.sourceSha256 !== finalVisibleCheck.before) {
          throw new Error("Final generated-check receipt lacks its exact visible source and invocation.");
        }
        const boundedRedaction = (value: string, maxBytes: number): string => {
          let result = redact(value, maxBytes);
          while (Buffer.byteLength(result) > maxBytes) result = result.slice(0, -1);
          return result;
        };
        publish(store.recordPlannerCheck(id, { ...check, output: boundedRedaction(check.output, 16384),
          result: check.result ? { ...check.result, detail: boundedRedaction(check.result.detail, 2048) } : null }));
        if (check.stage === "checkpoint") plannerCheckWindow!.generated = check;
        else finalPlannerCheck = check;
        break;
      }
      case "routing.checkpoint": {
        const checkpoint = PatchRunCheckpointSchema.parse(event.checkpoint);
        validateNativeCheckpointBudget(checkpoint, limits);
        const artifact = store.get(id).cloudPlan?.checks;
        if ((plannerChecksEnabled && ((artifact && checkpoint.evidence.plannerChecksSha256 !== artifact.sha256) ||
            (!artifact && (checkpoint.reason === "cloud_plan_completed" || checkpoint.evidence.plannerChecksSha256 !== undefined)))) ||
            (!plannerChecksEnabled && checkpoint.evidence.plannerChecksSha256 !== undefined)) {
          throw new Error("Checkpoint differs from its admitted planner artifact binding.");
        }
        if (plannerCheckWindow) {
          const { checkpoint: origin, visible, visibleCompleted, visibleTimedOut, generated } = plannerCheckWindow;
          const interrupted = checkpoint.decision === "stop" && checkpoint.state === "stopped" &&
            ["cancelled", "execution_failure", "protocol_failure", "accounting_failure", "episode_deadline", "unknown_outcome"].includes(checkpoint.reason);
          if (interrupted) {
            if (checkpoint.localCalls !== origin.localCalls || checkpoint.sourceSha256 !== origin.sourceSha256 ||
                checkpoint.checkSourceSha256 !== null || checkpoint.failedChecks !== origin.failedChecks) {
              throw new Error("Interrupted check changed its unobserved source or call authority.");
            }
          } else {
          const visibleTimeout = !visibleCompleted && visibleTimedOut;
          if ((!generated && !visibleTimeout) || (generated && visibleTimeout)) {
            throw new Error("Check completion lacks exactly its required generated-check invocation.");
          }
          const invalid = !visibleTimeout && !generated?.result?.completed;
          const timedOut = visibleTimeout || generated?.timedOut === true;
          const passed = visible.passed && generated?.passed === true;
          const failedChecks = origin.failedChecks + (invalid || timedOut || passed ? 0 : 1);
          let reason: PatchRunCheckpoint["reason"] = timedOut ? "check_timeout" : invalid ? "planner_check_invalid" :
            passed ? "visible_check_passed" : visible.before !== visible.after ? "visible_check_tree_changed" :
              !visible.passed ? "visible_check_failed" : "planner_check_failed";
          let decision: PatchRunCheckpoint["decision"] = timedOut || invalid ? "stop" : "continue";
          let nextState: PatchRunCheckpoint["state"] = timedOut || invalid ? "stopped" : "local";
          if (!invalid && !timedOut) {
            if (failedChecks >= 2) reason = "visible_checks_failed";
            else if (checkpoint.remainingLocalCalls === 0) reason = "local_call_limit";
            else if (checkpoint.remainingLocalCalls < 2 && !passed) reason = "finish_reserve_exhausted";
            else if (checkpoint.remainingLocalCalls <= 2 && !passed) reason = "finish_required";
            if (["visible_checks_failed", "local_call_limit", "finish_reserve_exhausted"].includes(reason)) {
              decision = "checkpoint"; nextState = "checkpoint";
            }
          }
          if (checkpoint.reason !== reason || checkpoint.decision !== decision || checkpoint.state !== nextState ||
              checkpoint.localCalls !== origin.localCalls || checkpoint.sourceSha256 !== visible.after ||
              checkpoint.checkSourceSha256 !== (passed && !invalid && !timedOut ? visible.after : null) ||
              checkpoint.failedChecks !== Math.min(2, failedChecks) || checkpoint.evidence.returncode !== visible.code ||
              checkpoint.evidence.completed !== visibleCompleted || checkpoint.evidence.timedOut !== visibleTimedOut ||
              checkpoint.evidence.checkSourceBeforeSha256 !== visible.before || checkpoint.evidence.checkSourceAfterSha256 !== visible.after ||
              (generated && (checkpoint.evidence.plannerCheckPassed !== generated.passed ||
                checkpoint.evidence.plannerCheckCompleted !== (generated.result?.completed ?? false) ||
                checkpoint.evidence.plannerCheckTimedOut !== generated.timedOut ||
                checkpoint.evidence.plannerCheckSourceBeforeSha256 !== generated.sourceSha256 ||
                checkpoint.evidence.plannerCheckSourceAfterSha256 !== generated.sourceAfterSha256)) ||
              (!generated && Object.keys(checkpoint.evidence).some(key => key.startsWith("plannerCheck") && key !== "plannerChecksSha256"))) {
            throw new Error("Combined check checkpoint differs from its exact visible and generated receipts.");
          }
          }
        }
        if (strictActions) {
          const current = store.get(id), previous = current.checkpoint;
          const startingHost = checkpoint.reason === "host_check_started";
          if (snapshot.policy === "local_critic_repair" && checkpoint.reason === "finish_required" && previous &&
              checkpoint.sourceSha256 !== previous.sourceSha256 && (!localAction?.completed ||
                localAction.checkpointEvidenceId !== previous.evidenceId || previous.reason !== "local_request_started")) {
            throw new Error("Finishing boundary source change lacks its completed action receipt.");
          }
          if (checkpoint.decision === "stop" && checkpoint.state !== "stopped") {
            throw new Error("Native stop checkpoint must close its execution state.");
          }
          if (hostSchedule && previous && checkpoint.evidence.hostCheckUsed !== (startingHost ? true : previous.evidence.hostCheckUsed)) {
            throw new Error("Native host check usage changed outside its start checkpoint.");
          }
          if (startingHost) {
            if (hostCheck || localAction || !previous || previous.state !== "local" ||
                previous.reason === "local_request_started" || previous.evidence.hostCheckUsed !== false ||
                current.phase !== "local_solver" || !settledLocalCalls(current, checkpoint.localCalls) ||
                checkpoint.localCalls !== previous.localCalls || checkpoint.sourceSha256 !== previous.sourceSha256 ||
                checkpoint.checkSourceSha256 !== previous.checkSourceSha256 || checkpoint.failedChecks !== previous.failedChecks ||
                checkpoint.evidence.visibleCommandSha256 !== createHash("sha256").update(snapshot.checks.command).digest("hex")) {
              throw new Error("Host check lacks its exact observed and settled initial boundary.");
            }
          } else if (hostCheck && !plannerCheckWindow) {
            const receipt = hostCheck.receipt;
            if (checkpoint.localCalls !== hostCheck.checkpoint.localCalls || (checkpoint.decision !== "stop" &&
                (!receipt || checkpoint.reason !== (receipt.before !== receipt.after ? "visible_check_tree_changed" :
                  receipt.passed ? "visible_check_passed" : "visible_check_failed") ||
                  checkpoint.sourceSha256 !== receipt.after || checkpoint.checkSourceSha256 !== (receipt.passed ? receipt.after : null) ||
                  checkpoint.failedChecks !== hostCheck.checkpoint.failedChecks + (receipt.passed ? 0 : 1) ||
                  checkpoint.evidence.returncode !== receipt.code || checkpoint.evidence.completed !== true ||
                  checkpoint.evidence.timedOut !== false || checkpoint.evidence.checkSourceBeforeSha256 !== receipt.before ||
                  checkpoint.evidence.checkSourceAfterSha256 !== receipt.after))) {
              throw new Error("Host check completion lacks its exact process and source receipt.");
            }
          } else if (previous && current.phase === "local_solver" && checkpoint.decision !== "stop") {
            if (checkpoint.reason === "local_request_started") {
              if (localAction || previous.state !== "local" || previous.decision !== "continue" ||
                  previous.reason === "local_request_started" || checkpoint.localCalls !== previous.localCalls + 1 ||
                  checkpoint.sourceSha256 !== previous.sourceSha256 || checkpoint.checkSourceSha256 !== previous.checkSourceSha256 ||
                  checkpoint.failedChecks !== previous.failedChecks ||
                  (previous.localCalls > 0 && !settledLocalCalls(current, previous.localCalls))) {
                throw new Error("Native request checkpoint lacks its completed prior action.");
              }
            } else {
              if (checkpoint.localCalls !== previous.localCalls || (localAction &&
                  (!localAction.completed || localAction.checkpointEvidenceId !== previous.evidenceId)) ||
                  (previous.reason === "local_request_started" && (!settledLocalCalls(current, previous.localCalls) ||
                    (!localAction && !["explicit_help", "fresh_visible_check", "review_required", "critic_required"].includes(checkpoint.reason)))) ||
                  (checkpoint.reason === "command_observed" && localAction?.kind !== "command") ||
                  (["visible_check_passed", "visible_check_failed", "visible_check_tree_changed", "visible_checks_failed", "planner_check_failed"].includes(checkpoint.reason) && localAction?.kind !== "check" && !hostCheck)) {
                throw new Error("Native observation lacks its completed action receipt.");
              }
            }
          }
        }
        const encoded = canonicalRequest(checkpoint);
        if (secrets.some((secret) => encoded.includes(secret))) throw new Error("Checkpoint contains a private value.");
        publish(store.recordCheckpoint(id, checkpoint));
        if (strictActions) {
          if (checkpoint.reason === "host_check_started") hostCheck = { checkpoint };
          else { hostCheck = undefined; localAction = undefined; }
        }
        plannerCheckWindow = undefined;
        break;
      }
      case "plan.ready": {
        if ((event.checks !== undefined) !== plannerChecksEnabled) throw new Error("Planner artifact presence differs from its admitted mode.");
        const plan = PatchRunPlanSchema.parse({ summary: event.summary, sha256: event.sha256,
          ...(event.checks === undefined ? {} : { checks: event.checks }) });
        if (plannerChecksEnabled && (Buffer.byteLength(plan.summary) > 4000 || !plan.summary.trim() || plan.summary.includes("\0") ||
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(plan.summary))) {
          throw new Error("Planner summary exceeds its admitted UTF-8 envelope.");
        }
        if (secrets.some((secret) => canonicalRequest(plan).includes(secret))) throw new Error("Cloud plan contains a private value.");
        if (config.mode === "scripted" && simulatedCounts.planner !== 1) throw new Error("Scripted plan requires exactly one simulated planner action.");
        publish(store.recordPlan(id, plan));
        break;
      }
      case "handoff.ready": {
        const handoff = PatchRunHandoffSchema.parse({ patchSha256: event.patchSha256, sourceSha256: event.sourceSha256,
          bytes: event.bytes, summary: redact(event.summary, 16384),
          ...(event.checkSourceSha256 == null ? {} : { checkSourceSha256: event.checkSourceSha256 }) });
        publish(store.recordHandoff(id, handoff));
        break;
      }
      case "preparation.finished": {
        if (event.kind === "scout" && (event.summary !== undefined || event.elapsedMs !== undefined || event.outcome !== undefined)) {
          if (snapshot.policy !== "hybrid" || store.get(id).phase !== "local_investigation") throw new Error("Local evidence receipt is outside its admitted phase.");
          const summary = redact(z.string().max(4096).parse(event.summary), 4096);
          const investigation = PatchRunLocalInvestigationSchema.parse({ elapsedMs: event.elapsedMs, outcome: event.outcome,
            ...(event.fallbackReason === undefined ? {} : { fallbackReason: event.fallbackReason }),
            ...(event.providerOutputError === undefined ? {} : { providerOutputError: event.providerOutputError }) });
          publish(store.setLocalSummary(id, summary, investigation));
        } else record("preparation.finished", `Preparation complete (${event.kind === "scout" ? "read-only local observations" : "host file inventory"}).`);
        break;
      }
      case "container.created": record("sandbox.created", "Isolated task container started; network disabled."); break;
      case "container.removed": if (event.confirmed !== true) throw new Error("Task container cleanup failed."); break;
      case "model.finished": {
        if (config.mode !== "scripted" || event.simulated !== true) throw new Error("Unexpected simulated model event.");
        if (isNativePatchPolicy(snapshot.policy)) {
          const current = store.get(id);
          const phase = current.phase === "local_solver" ? "local" : current.phase === "cloud_planner" ? "planner" : current.phase === "cloud_solver" ? "cloud" : undefined;
          if (!phase || Object.values(simulatedCounts).reduce((a, b) => a + b, 0) >= limits.stepLimit ||
              (snapshot.policy === "cloud_plan_local_review" && phase === "local" &&
                Object.values(simulatedCounts).reduce((a, b) => a + b, 0) >= limits.stepLimit - 1) ||
              (phase === "local" && simulatedCounts.local >= limits.localStepLimit!) || (phase === "planner" && simulatedCounts.planner >= 1)) throw new Error("Scripted action exceeds its phase allowance.");
          simulatedCounts[phase] += 1;
        }
        record("model.scripted", "Predetermined fixture action; no inference or billed tokens.");
        break;
      }
      default: break;
    }
  };
  child.stdin.on("error", () => fail(new Error("Worker input channel closed.")));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_LINE) { fail(new Error("Worker output exceeded the protocol limit.")); return; }
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      queue = queue.then(() => receive(JSON.parse(line))).catch(fail);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > MAX_LINE) fail(new Error("Worker diagnostic output exceeded its limit.")); });
  child.on("error", () => fail(new Error("Coding worker could not start. Run the pilot setup command.")));
  const deadline = setTimeout(() => fail(new Error("Coding run exceeded its total time limit.")), (limits.wallTimeSeconds + 60) * 1000);
  deadline.unref();
  const done = new Promise<PatchWorkerCompletion>((resolve) => child.once("close", (exitCode, exitSignal) => {
    void (async () => {
      let cleanupConfirmed = false;
      try {
        await queue;
        clearTimeout(deadline); if (forceKill) clearTimeout(forceKill);
        if (buffer.trim()) failure ??= new Error("Worker exited with an incomplete protocol frame.");
        try { await removeRunContainers(id); cleanupConfirmed = true; }
        catch { failure ??= new Error("Container cleanup could not be confirmed. Restore Docker and refresh readiness to retry cleanup."); }
        if (!stopped && (exitCode !== 0 || exitSignal !== null) && terminal?.status !== "failed") {
          failure ??= new Error("Coding worker did not exit successfully.");
        }
        const current = store.get(id);
        if (current.status === "running") {
          publish(store.recordCleanup(id, cleanupConfirmed));
          if (failure) publish(store.finish(id, "failed", redact(failure.message, 2_000)));
          else if (stopped || terminal?.status === "cancelled") publish(store.finish(id, "cancelled"));
          else if (terminal?.status === "completed" || terminal?.status === "checks_failed") {
            const expected = terminal.status === "completed" ? "passed" : "failed";
            if (current.checks.status !== expected) throw new Error("Worker completion did not match the host check receipt.");
            publish(store.finish(id, "completed"));
          } else publish(store.finish(id, "failed", terminal?.error ?? "Coding worker exited without a terminal receipt."));
        }
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error("Coding worker finalization failed.");
        try {
          if (store.get(id).status === "running") publish(store.finish(id, "failed", redact(failure.message, 2_000)));
        } catch { /* Completion still resolves; caller must surface persistence/cleanup failure. */ }
      } finally {
        clearTimeout(deadline); if (forceKill) clearTimeout(forceKill);
        resolve({ cleanupConfirmed, ...(failure ? { error: redact(failure.message, 2_000) } : {}) });
      }
    })();
  }));
  return { done, cancel };
}
