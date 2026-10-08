import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadConfig } from "../src/main/config";
import { PrivateAgentBroker, type BrokerDestination } from "../src/main/private-agent/broker";
import { canonical, digest } from "../src/main/private-agent/contracts";
import { PrivateCheckpointStore } from "../src/main/private-agent/checkpoints";
import { PrivateAgentModel } from "../src/main/private-agent/model";
import { GeneralAgentSession, SESSION_LIMITS, sessionFileManifest, sessionPhaseIdentity, type SessionPhase } from "../src/main/private-agent/session";
import { RulePacketScanner } from "../src/main/private-agent/scanner";
import { PrivateAgentStore } from "../src/main/private-agent/store";
import { COORDINATOR_PROFILES, GENERAL_TASK_BUDGETS, type CoordinatorProfileName } from "../src/main/private-agent/profiles";
import { CLAIMS_LEDGER_CHECK_ID, CLAIMS_LEDGER_PATH, claimsInstructions, claimsLedgerCheck } from "../src/main/private-agent/claims";
import { withDocumentReview } from "../src/main/private-agent/document-review";
import { loadRepairDirectory, repairMatchesRun, withRepair } from "../src/main/private-agent/repair";
import { buildPublicRetrievalPhase, loadPreparedOperatorTask, selectPreparedPublicInputs, startControlledSnapshotReceiver,
  type PreparedOperatorTask } from "./private-agent-run";
import { localStreamSettings } from "../src/main/liveness";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
/** Cap on one assembled reply from the owned model. */
const LOCAL_SCREEN_MAX_RESPONSE_BYTES = 512 * 1024;
const safeSnapshotFile = (value: string) => value.length > 0 && Buffer.byteLength(value) <= 240 && Buffer.from(value).toString("utf8") === value
  && !/[\\\x00-\x1f\x7f]/u.test(value) && value.split("/").every(part => part && part !== "." && part !== "..");
function safeRoute(value: string): boolean {
  try {
    if (!value.startsWith("/") || value.startsWith("//") || Buffer.byteLength(value) > 2048 || /[\\?#\x00-\x20\x7f]/u.test(value)
      || /%(?:2f|5c)/iu.test(value)) return false;
    const decoded = decodeURIComponent(value);
    return new URL(value, "https://snapshot.invalid").pathname === value && (value === "/" || safeSnapshotFile(decoded.slice(1)));
  } catch { return false; }
}
const SnapshotMapSchema = z.object({ schemaVersion: z.literal(1), origin: z.string().max(2048).refine(value => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    && (value === url.origin || value === `${url.origin}/`); } catch { return false; }
}), routes: z.array(z.object({ path: z.string().refine(safeRoute), inputPath: z.string().refine(safeSnapshotFile),
  sourceId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u) }).strict()).min(1).max(128), privateDerivedRequestsPermitted: z.literal(false) }).strict();

export interface PublicSnapshotOptions { directory: string; expectedBriefSha256: string; expectedMapSha256: string; indexPath: string }
export interface PreparedPublicSnapshot {
  readonly brief: Buffer;
  readonly mapBytes: Buffer;
  readonly routes: readonly { readonly path: string; readonly inputPath: string; readonly sourceId: string; readonly bytes: Buffer }[];
  readonly binding: {
    readonly briefSha256: string; readonly mapSha256: string; readonly origin: string; readonly indexPath: string;
    readonly sourceBindingSha256: string;
    readonly routes: readonly { readonly path: string; readonly inputPath: string; readonly sourceId: string; readonly sha256: string; readonly bytes: number }[];
  };
}

function readSnapshotMetadata(directory: string, name: string, maxBytes: number): Buffer {
  const root = resolve(directory);
  let cursor = root;
  while (true) {
    const entry = lstatSync(cursor);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("public_snapshot_directory_invalid");
    const parent = resolve(cursor, ".."); if (parent === cursor) break; cursor = parent;
  }
  const target = join(root, name), entry = lstatSync(target);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > maxBytes) throw new Error("public_snapshot_file_invalid");
  const descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor), bytes = readFileSync(descriptor), after = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || bytes.length > maxBytes || before.size !== bytes.length || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("public_snapshot_file_changed");
    return bytes;
  } finally { closeSync(descriptor); }
}

/** Reads only the two explicitly bound public metadata files, never sibling task/gold directories. */
export function preparePublicSnapshot(task: PreparedOperatorTask, input: PublicSnapshotOptions): PreparedPublicSnapshot {
  sha256.parse(input.expectedBriefSha256); sha256.parse(input.expectedMapSha256);
  const brief = readSnapshotMetadata(input.directory, "brief.md", 32768), mapBytes = readSnapshotMetadata(input.directory, "receiver-map.json", 1024 * 1024);
  if (digest(brief) !== input.expectedBriefSha256 || digest(mapBytes) !== input.expectedMapSha256) throw new Error("public_snapshot_metadata_binding");
  if (!new TextDecoder("utf-8", { fatal: true }).decode(brief).trim()) throw new Error("public_snapshot_brief_invalid");
  const map = SnapshotMapSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(mapBytes)));
  if (!["path", "inputPath", "sourceId"].every(key => new Set(map.routes.map(row => row[key as keyof typeof row])).size === map.routes.length)
    || !safeRoute(input.indexPath) || !map.routes.some(row => row.path === input.indexPath)) throw new Error("public_snapshot_routes_invalid");
  const selected = selectPreparedPublicInputs(task, map.routes.map(row => `input/${row.inputPath}`), task.sourceBindingSha256);
  if (selected.files.some(file => file.bytes.length > 1024 * 1024) || selected.files.reduce((sum, file) => sum + file.bytes.length, 0) > 8 * 1024 * 1024) throw new Error("public_snapshot_size_exceeded");
  const routes = map.routes.map((row, i) => Object.freeze({ ...row, bytes: Buffer.from(selected.files[i]!.bytes) }));
  const binding = Object.freeze({ briefSha256: input.expectedBriefSha256, mapSha256: input.expectedMapSha256, origin: new URL(map.origin).origin,
    indexPath: input.indexPath, sourceBindingSha256: task.sourceBindingSha256,
    routes: Object.freeze(routes.map(row => Object.freeze({ path: row.path, inputPath: row.inputPath, sourceId: row.sourceId, sha256: digest(row.bytes), bytes: row.bytes.length }))) });
  return Object.freeze({ brief: Buffer.from(brief), mapBytes: Buffer.from(mapBytes), routes: Object.freeze(routes), binding });
}

function verifyPublicSnapshot(snapshot: PreparedPublicSnapshot): void {
  if (digest(snapshot.brief) !== snapshot.binding.briefSha256 || digest(snapshot.mapBytes) !== snapshot.binding.mapSha256
    || snapshot.routes.length !== snapshot.binding.routes.length
    || snapshot.routes.some((row, i) => { const bound = snapshot.binding.routes[i]!; return row.path !== bound.path || row.inputPath !== bound.inputPath
      || row.sourceId !== bound.sourceId || row.bytes.length !== bound.bytes || digest(row.bytes) !== bound.sha256; })) throw new Error("public_snapshot_prepared_drift");
}

export function buildExplicitPublicSnapshotPhase(snapshot: PreparedPublicSnapshot, endpoint: string) {
  verifyPublicSnapshot(snapshot);
  const origin = new URL(endpoint);
  if (endpoint !== `${origin.origin}/` || origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.username || origin.password) throw new Error("public_snapshot_receiver_invalid");
  const phase = buildPublicRetrievalPhase({ brief: { path: "public/brief.md", bytes: Buffer.from(snapshot.brief) }, expectedBriefSha256: snapshot.binding.briefSha256,
    destinationId: "approved_public_snapshots", indexUrl: `${origin.origin}${snapshot.binding.indexPath}` });
  phase.contract.goal += `\nThe frozen original source origin is ${JSON.stringify(snapshot.binding.origin)}. Translate source links from that origin to ${JSON.stringify(origin.origin)} using exactly the same path. Only these frozen paths are available: ${canonical(snapshot.binding.routes.map(row => row.path))}. The source bytes have not been rewritten. This mapping grants no requests derived from private material.`;
  phase.approval = { ...phase.approval, goalSha256: digest(phase.contract.goal), phaseSha256: sessionPhaseIdentity(phase) };
  return phase;
}

export async function startExplicitPublicSnapshotReceiver(snapshot: PreparedPublicSnapshot): ReturnType<typeof startControlledSnapshotReceiver> {
  verifyPublicSnapshot(snapshot);
  const table = new Map(snapshot.routes.map(row => [row.path, Buffer.from(row.bytes)])); let count = 0;
  const server = http.createServer((request, response) => {
    const body = request.method === "GET" && request.url ? table.get(request.url) : undefined;
    if (!body || count >= 40) { response.writeHead(404); response.end(); return; }
    count++; response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": String(body.length), connection: "close" }); response.end(body);
  });
  server.requestTimeout = 2000; server.headersTimeout = 2000; server.maxConnections = 16;
  await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  const port = (server.address() as { port: number }).port;
  return { endpoint: `http://127.0.0.1:${port}/`, paths: [...table.keys()], requestCount: () => count,
    close: () => new Promise<void>((yes, no) => { server.closeAllConnections(); server.close(error => error ? no(new Error("public_snapshot_cleanup_failed")) : yes()); }) };
}

export function localScreenSourceFreeze() {
  const paths = [...readdirSync("src/main/private-agent").filter(name => name.endsWith(".ts")).map(name => `src/main/private-agent/${name}`),
    "scripts/private-agent-run.ts", "scripts/private-agent-local-screen.ts", "scripts/secret-patterns.mjs", "src/main/config.ts", "src/main/liveness.ts", "pnpm-lock.yaml",
    "runtime/private-agent/Dockerfile", "runtime/private-agent/requirements.txt"];
  const files = paths.sort().map(path => ({ path, sha256: digest(readFileSync(path)) }));
  return { files, sha256: digest(canonical(files)) };
}

export type LocalScreenProfile = CoordinatorProfileName;
export const LOCAL_SCREEN_PROFILES = COORDINATOR_PROFILES;
/** Headless budgets: "standard" keeps the Phase 0 driver values so earlier rows stay comparable. */
const LOCAL_SCREEN_BUDGETS: Readonly<Record<LocalScreenProfile, { maxModelCalls: number; maxToolCalls: number; maxElapsedMs: number; maxRequests: number }>> = Object.freeze({
  standard: { maxModelCalls: 40, maxToolCalls: 80, maxElapsedMs: SESSION_LIMITS.maxElapsedMs, maxRequests: SESSION_LIMITS.maxRequests },
  heavy: { maxModelCalls: GENERAL_TASK_BUDGETS.heavy.modelCalls, maxToolCalls: GENERAL_TASK_BUDGETS.heavy.toolCalls,
    maxElapsedMs: GENERAL_TASK_BUDGETS.heavy.elapsedMs, maxRequests: GENERAL_TASK_BUDGETS.heavy.sessionRequests },
});

/** Phase 2 cloud arm (PR-E): the key comes from the process environment only and never reaches the freeze, the result or the registry. */
export const CLOUD_ARM_MAX_FEE_USD = 8;
export const CLOUD_ARM_KEY_VARIABLE = "SOAR_PHASE2_CLOUD_API_KEY";
export interface CloudArmInput {
  model: string; endpoint: string; prices: { input: number; output: number; cached: number }; maxFeeUsd: number;
  /** Owner opt-in (`--proxy-fake-ip true`): admit a fake-IP system proxy's 198.18.0.0/15 answer for the cloud endpoint. */
  proxyFakeIp?: true;
}
export function parseCloudPrices(value: string): CloudArmInput["prices"] {
  const parts = value.split(",").map(part => Number(part));
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part) || part < 0) || parts[2]! > parts[0]!) throw new Error("local_screen_cli_invalid");
  return { input: parts[0]!, output: parts[1]!, cached: parts[2]! };
}
export function buildCloudArm(input: CloudArmInput, environment: NodeJS.ProcessEnv, coordinator: { maxOutputTokens: number; thinking: "disabled" | "medium"; maxRequestBytes: number }) {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== "https:" || !(input.maxFeeUsd > 0 && input.maxFeeUsd <= CLOUD_ARM_MAX_FEE_USD)) throw new Error("local_screen_cloud_arm_invalid");
  const apiKey = environment[CLOUD_ARM_KEY_VARIABLE];
  if (!apiKey || !/^[\x21-\x7e]{8,512}$/u.test(apiKey)) throw new Error("local_screen_cloud_key_missing");
  const credentialVersion = Number(environment.SOAR_PHASE2_CLOUD_CREDENTIAL_VERSION ?? "1");
  if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 0) throw new Error("local_screen_cloud_arm_invalid");
  const accountId = environment.SOAR_PHASE2_CLOUD_ACCOUNT_ID ?? "owner_cloud_account";
  // Synthetic-only and explicitly grant-free: the broker admits this destination to a wholly synthetic lineage and nothing else.
  const destination: BrokerDestination = { id: "cloud_coordinator", kind: "cloud_model", endpoint: endpoint.href, apiKey, accountId, credentialVersion,
    privateDataAdmitted: false, syntheticOnly: true, grantFreeSynthetic: true, maxResponseBytes: 512 * 1024, timeoutMs: 600_000, maxRequestBytes: coordinator.maxRequestBytes,
    ...(input.proxyFakeIp ? { proxyFakeIp: true as const } : {}) };
  // Same output limit, thinking mode and body cap as the local arm; only the API shape, the prices and the timeout differ.
  const modelConfig = { destinationId: "cloud_coordinator", model: input.model, api: "openai" as const, maxOutputTokens: coordinator.maxOutputTokens, thinking: coordinator.thinking,
    inputUsdPerMillion: input.prices.input, outputUsdPerMillion: input.prices.output, cachedInputUsdPerMillion: input.prices.cached, maxRequestBytes: coordinator.maxRequestBytes };
  const maxFeeMicrousd = Math.round(input.maxFeeUsd * 1_000_000);
  return { destination, modelConfig, maxFeeMicrousd, freeze: { arm: "cloud" as const, accountId, credentialVersion, endpointSha256: digest(endpoint.href), maxFeeMicrousd, modelConfig,
    ...(input.proxyFakeIp ? { proxyFakeIp: true as const } : {}) } };
}

/** Adds the claims ledger requirement: sources are the job's input files plus, for two-phase runs, the public sources the host retained (never the model-authored context files). */
export function withClaimsLedger(phase: SessionPhase, publicRetrieval: boolean): SessionPhase {
  const report = phase.contract.requiredArtifacts.find(artifact => artifact.path.endsWith(".md"))?.path ?? phase.contract.requiredArtifacts[0]!.path;
  const sources = phase.files.filter(file => file.path.startsWith("input/")).map(file => ({ id: file.path, path: file.path }));
  const check = claimsLedgerCheck({ reportPath: report, sources, publicSources: publicRetrieval });
  return { ...phase, checks: [...phase.checks, check], contract: { ...phase.contract, goal: `${phase.contract.goal}\n${claimsInstructions(report, sources, publicRetrieval)}`,
    requiredArtifacts: [...phase.contract.requiredArtifacts, { path: CLAIMS_LEDGER_PATH, description: "Claims ledger: one verbatim source quote per material claim." }],
    requiredChecks: [...phase.contract.requiredChecks, CLAIMS_LEDGER_CHECK_ID] } };
}

/** Bounded synthetic local evaluation only; no cloud route or disclosure grant. */
export async function runLocalArtifactScreen(input: {
  taskDirectory: string; expectedJobSha256: string; expectedBriefSha256: string;
  syntheticAuthoritySha256: string; expectedRuntimeSha256: string; imageId: string; outputDirectory: string;
  publicRetrieval?: boolean; publicSnapshot?: PublicSnapshotOptions; pauseAfterTools?: number;
  /** "standard" is the September desktop coordinator setting; "heavy" enables thinking with a larger output limit. */
  profile?: LocalScreenProfile;
  /** Require output/claims.json, verified by the host against the job's input and transferred context files. */
  claimsLedger?: boolean;
  /** PR-I: the job reviews its one input .docx through an edit plan, the pinned applier and the fidelity check (closed corpus). */
  documentReview?: boolean;
  /** Phase 2 cloud arm: the coordinator is a cloud model; the local model still judges claims. */
  cloudArm?: CloudArmInput;
  /** Phase 2 repair pair: start from a frozen failed draft with a critique (a directory written by scripts/phase2-repair.ts); local only. */
  repairFrom?: string;
}) {
  if (![input.expectedJobSha256, input.expectedBriefSha256, input.syntheticAuthoritySha256, input.expectedRuntimeSha256].every(hash => /^[a-f0-9]{64}$/u.test(hash)) ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.imageId) ||
      (input.pauseAfterTools !== undefined && (!Number.isInteger(input.pauseAfterTools) || input.pauseAfterTools < 1 || input.pauseAfterTools > 20))
      || (input.publicSnapshot !== undefined && input.publicRetrieval !== true)) throw new Error("local_screen_arguments_invalid");
  const sourceFreeze = localScreenSourceFreeze();
  if (sourceFreeze.sha256 !== input.expectedRuntimeSha256) throw new Error("local_screen_reviewed_source_changed");
  const task = loadPreparedOperatorTask(input.taskDirectory, { jobSha256: input.expectedJobSha256, briefSha256: input.expectedBriefSha256 });
  const profileName: LocalScreenProfile = input.profile ?? "standard", coordinator = COORDINATOR_PROFILES[profileName], budget = LOCAL_SCREEN_BUDGETS[profileName];
  // The prepared task binds the September contract caps; the profile's budget replaces them for this run only.
  const budgetedPhase = { ...task.phase, contract: { ...task.phase.contract, maxModelCalls: budget.maxModelCalls, maxToolCalls: budget.maxToolCalls, maxElapsedMs: budget.maxElapsedMs } };
  if (input.documentReview && (input.claimsLedger || input.publicRetrieval)) throw new Error("local_screen_document_review_closed_corpus");
  const modePhase = input.claimsLedger ? withClaimsLedger(budgetedPhase, input.publicRetrieval === true)
    : input.documentReview ? withDocumentReview(budgetedPhase) : budgetedPhase;
  // A repair starts from the identical frozen draft with the same task, profile and host-checked mode as the run that failed.
  const repair = input.repairFrom ? loadRepairDirectory(resolve(input.repairFrom)) : undefined;
  if (repair && (input.cloudArm || input.publicRetrieval || !repairMatchesRun(repair.binding, { jobSha256: task.binding.jobSha256, briefSha256: task.binding.briefSha256,
      profile: profileName, claimsLedger: input.claimsLedger === true, documentReview: input.documentReview === true }))) throw new Error("local_screen_repair_mismatch");
  const privatePhase = repair ? withRepair(modePhase, repair) : modePhase;
  // Bind all explicit public metadata and original public bytes before receiver/model/DB effects.
  const publicSnapshot = input.publicSnapshot ? preparePublicSnapshot(task, input.publicSnapshot) : undefined;
  const config = loadConfig();
  if (config.providerMode !== "local" || config.vllm.costPolicy !== "local_zero_cost") throw new Error("local_screen_provider_not_admitted");
  const directory = resolve(input.outputDirectory);
  mkdirSync(directory, { mode: 0o700 });
  const save = (name: string, value: unknown) => writeFileSync(join(directory, name), `${canonical(value)}\n`, { flag: "wx", mode: 0o600 });
  if (publicSnapshot) {
    writeFileSync(join(directory, "public-snapshot-brief.md"), publicSnapshot.brief, { flag: "wx", mode: 0o600 });
    writeFileSync(join(directory, "public-snapshot-map.json"), publicSnapshot.mapBytes, { flag: "wx", mode: 0o600 });
  }
  const jobId = randomUUID();
  const db = new Database(join(directory, "state.sqlite"));
  const store = new PrivateAgentStore(db), checkpoints = new PrivateCheckpointStore(join(directory, "checkpoints"), jobId);
  let receiver: Awaited<ReturnType<typeof startControlledSnapshotReceiver>> | undefined;
  let interval: NodeJS.Timeout | undefined;
  let session: GeneralAgentSession | undefined;
  const abort = new AbortController();
  const stop = () => { abort.abort(); session?.cancel(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const destinations: BrokerDestination[] = [{ id: "owned_local_model", kind: "local_model",
      endpoint: `${config.vllm.baseUrl}/chat/completions`, accountId: "operator_owned_local_server", credentialVersion: 1,
      apiKey: config.vllm.apiKey, privateDataAdmitted: false, syntheticOnly: true,
      maxResponseBytes: LOCAL_SCREEN_MAX_RESPONSE_BYTES, timeoutMs: coordinator.requestTimeoutMs, maxRequestBytes: coordinator.maxRequestBytes,
      ...(config.recoverableDispatch ? { recoverable: true } : {}),
      ...(config.streamingEnabled ? { stream: localStreamSettings(coordinator.requestTimeoutMs, LOCAL_SCREEN_MAX_RESPONSE_BYTES, coordinator.maxOutputTokens) } : {}) }];
    let publicPhase: ReturnType<typeof buildPublicRetrievalPhase> | undefined;
    if (publicSnapshot) {
      receiver = await startExplicitPublicSnapshotReceiver(publicSnapshot);
      destinations.push({ id: "approved_public_snapshots", kind: "public_web", endpoint: receiver.endpoint,
        accountId: "synthetic_snapshot_fixture", credentialVersion: 0, privateDataAdmitted: false,
        loopbackFixture: true, maxResponseBytes: 1024 * 1024, timeoutMs: 5000 });
      publicPhase = buildExplicitPublicSnapshotPhase(publicSnapshot, receiver.endpoint);
    } else if (input.publicRetrieval) {
      // Selection is checked against the frozen original job, not a mutable copy's new hash.
      const job = JSON.parse(task.phase.files.find(file => file.path === "job.json")!.bytes.toString("utf8")) as {
        inputs: { path: string; sha256: string; confidentiality: string }[];
      };
      const publicFiles = task.publicInputs.map(file => {
        const bound = job.inputs.find(row => `input/${row.path}` === file.path && row.confidentiality === "public");
        if (!bound || digest(file.bytes) !== bound.sha256) throw new Error("local_screen_public_source_changed");
        return { ...file, bytes: Buffer.from(file.bytes), boundHash: bound.sha256 };
      });
      const brief = publicFiles.find(file => file.path === "input/public/research-brief.md");
      const pages = publicFiles.filter(file => file.path.startsWith("input/public/sources/")).map(file => ({ path: file.path.slice("input/public/sources/".length), bytes: file.bytes }));
      if (!brief || !pages.some(file => file.path === "index.html")) throw new Error("local_screen_public_retrieval_inputs_missing");
      receiver = await startControlledSnapshotReceiver(pages, digest(canonical(sessionFileManifest(pages))));
      destinations.push({ id: "approved_public_snapshots", kind: "public_web", endpoint: receiver.endpoint,
        accountId: "synthetic_snapshot_fixture", credentialVersion: 0, privateDataAdmitted: false,
        loopbackFixture: true, maxResponseBytes: 1024 * 1024, timeoutMs: 5000 });
      publicPhase = buildPublicRetrievalPhase({ brief, expectedBriefSha256: brief.boundHash,
        destinationId: "approved_public_snapshots", indexUrl: `${receiver.endpoint}index.html` });
    }
    const cloud = input.cloudArm ? buildCloudArm(input.cloudArm, process.env, coordinator) : undefined;
    if (cloud) destinations.push(cloud.destination);
    const scanner = new RulePacketScanner();
    const broker = new PrivateAgentBroker(store, destinations, scanner);
    const localModelConfig = { destinationId: "owned_local_model", model: config.vllm.model, maxOutputTokens: coordinator.maxOutputTokens,
      inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: coordinator.thinking, maxRequestBytes: coordinator.maxRequestBytes,
      ...(coordinator.sampling ? { sampling: { ...coordinator.sampling } } : {}), ...(config.streamingEnabled ? { streaming: true } : {}) };
    const modelConfig = cloud ? cloud.modelConfig : localModelConfig;
    const freeze = { version: 1, jobId, sourceFreeze: sourceFreeze.files, sourceFreezeSha256: sourceFreeze.sha256, imageId: input.imageId,
      modelConfig, endpointIdentitySha256: digest(destinations[0]!.endpoint), deployment: "synthetic_only_unverified_for_private_data",
      taskBinding: task.binding, sourceBindingSha256: task.sourceBindingSha256,
      syntheticAuthoritySha256: input.syntheticAuthoritySha256, privatePhaseSha256: sessionPhaseIdentity(privatePhase),
      publicPhaseSha256: publicPhase ? sessionPhaseIdentity(publicPhase) : null,
      publicSnapshot: publicSnapshot?.binding ?? null,
      scanner: "rules_only_not_a_privacy_classifier", pauseAfterTools: input.pauseAfterTools ?? null,
      profile: profileName, claimsLedger: input.claimsLedger === true, ...(input.documentReview ? { documentReview: true } : {}), ...(repair ? { repair: repair.binding } : {}), arm: cloud ? cloud.freeze : { arm: "local" as const },
      limits: { requests: budget.maxRequests, modelCalls: budget.maxModelCalls, toolCalls: budget.maxToolCalls, outputTokens: modelConfig.maxOutputTokens,
        inputBytes: coordinator.maxRequestBytes, requestTimeoutMs: cloud ? cloud.destination.timeoutMs : coordinator.requestTimeoutMs, elapsedMs: budget.maxElapsedMs, feeMicrousd: cloud?.maxFeeMicrousd ?? 0 },
      startedAt: new Date().toISOString(), artifactAccepted: null };
    save("freeze.json", freeze);
    session = new GeneralAgentSession({ jobId, imageId: input.imageId, store, broker, checkpoints,
      trustedHostModelFactory: contextId => new PrivateAgentModel(broker, modelConfig, jobId, contextId),
      ...(cloud ? { cloudArm: { destinationId: cloud.destination.id, maxFeeMicrousd: cloud.maxFeeMicrousd },
        judgeModelFactory: (contextId: string) => new PrivateAgentModel(broker, localModelConfig, jobId, contextId) } : {}),
      privatePhase, publicPhase, limits: { maxRequests: budget.maxRequests, maxElapsedMs: budget.maxElapsedMs },
      syntheticInputApproval: { privatePhaseSha256: sessionPhaseIdentity(privatePhase), authoritySha256: input.syntheticAuthoritySha256 } });
    let requestedPause = false, lastReported = -1;
    interval = setInterval(() => {
      const events = store.events(jobId), calls = store.dispatches(jobId).length;
      if (input.pauseAfterTools && !requestedPause && events.filter(event => event.type === "tool_finished").length >= input.pauseAfterTools) {
        requestedPause = true; session!.pause();
      }
      if (calls !== lastReported) { lastReported = calls; process.stdout.write(`${canonical({ state: "running", requests: calls, completedTools: events.filter(event => event.type === "tool_finished").length })}\n`); }
    }, 1000);
    // A failure outside the runner's own handling still ends with a result record, so paid spend is always summarized.
    const guarded = async () => { try { return await session!.run(abort.signal); }
      catch { return { status: "incomplete" as const, reason: "session_failure", jobId, finalSnapshot: [], requests: store.dispatches(jobId).length, artifactAccepted: null, independentAcceptanceRequired: true as const }; } };
    let result = await guarded();
    if (result.status === "paused") { save("pause.json", result); result = await guarded(); }
    clearInterval(interval); interval = undefined;
    const files = checkpoints.load(result.finalSnapshot);
    const candidate = join(directory, "candidate"); mkdirSync(candidate, { mode: 0o700 });
    for (const file of files) {
      const target = join(candidate, file.path); mkdirSync(resolve(target, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(target, file.bytes, { flag: "wx", mode: 0o600 });
    }
    const closedSource = localScreenSourceFreeze();
    if (closedSource.sha256 !== sourceFreeze.sha256) result = { ...result, status: "incomplete", reason: "source_changed_during_run" };
    let publicSnapshotPreserved = true;
    if (publicSnapshot && input.publicSnapshot) {
      try {
        verifyPublicSnapshot(publicSnapshot);
        publicSnapshotPreserved = digest(readSnapshotMetadata(input.publicSnapshot.directory, "brief.md", 32768)) === publicSnapshot.binding.briefSha256
          && digest(readSnapshotMetadata(input.publicSnapshot.directory, "receiver-map.json", 1024 * 1024)) === publicSnapshot.binding.mapSha256;
      } catch { publicSnapshotPreserved = false; }
      if (!publicSnapshotPreserved) result = { ...result, status: "incomplete", reason: "public_snapshot_changed_during_run" };
    }
    save("result.json", { ...result, freezeSha256: digest(canonical(freeze)),
      closedSourceSha256: closedSource.sha256,
      publicSnapshot: publicSnapshot?.binding ?? null, publicSnapshotPreserved,
      snapshotSha256: checkpoints.fingerprint(result.finalSnapshot), candidateFiles: sessionFileManifest(files),
      controlledPublicRequests: receiver?.requestCount() ?? 0, dispatches: store.dispatches(jobId),
      finishedAt: new Date().toISOString() });
    process.stdout.write(`${canonical({ state: result.status, reason: result.reason, requests: result.requests, artifactAccepted: null })}\n`);
    return result;
  } finally {
    if (interval) clearInterval(interval);
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    try { await receiver?.close(); } finally { db.close(); }
  }
}

export function parseLocalArtifactScreenArguments(args: string[]): Parameters<typeof runLocalArtifactScreen>[0] {
    const snapshotNames = ["--public-snapshot-directory", "--public-snapshot-brief-sha256", "--public-snapshot-map-sha256", "--public-snapshot-index-path"];
    const cloudNames = ["--cloud-model", "--cloud-endpoint", "--cloud-prices", "--max-fee-usd"];
    const names = ["--task-directory", "--job-sha256", "--brief-sha256", "--authority-sha256", "--image-id", "--output-directory", "--runtime-sha256", "--public-retrieval", "--pause-after-tools", "--profile", "--claims-ledger", "--document-review", "--repair-from", "--arm", ...cloudNames, "--proxy-fake-ip", ...snapshotNames];
    if (args[0] !== "--execute-synthetic-local" || args.length % 2 !== 1 || args.slice(1).some((arg, i) => i % 2 === 0 && !names.includes(arg)) ||
        new Set(args.filter((_, i) => i % 2 === 1)).size !== (args.length - 1) / 2) throw new Error("local_screen_cli_invalid");
    const values = new Map(args.slice(1).filter((_, i) => i % 2 === 0).map(name => [name, args[args.indexOf(name) + 1]!]));
    if (names.slice(0, 7).some(name => !values.has(name)) || (values.has("--public-retrieval") && values.get("--public-retrieval") !== "true") ||
        (values.has("--profile") && !Object.hasOwn(LOCAL_SCREEN_PROFILES, values.get("--profile")!)) ||
        (values.has("--claims-ledger") && values.get("--claims-ledger") !== "true") ||
        (values.has("--document-review") && (values.get("--document-review") !== "true" || values.has("--claims-ledger") || values.has("--public-retrieval"))) ||
        (values.has("--repair-from") && (values.get("--arm") === "cloud" || !values.get("--repair-from"))) ||
        (values.has("--arm") && !["local", "cloud"].includes(values.get("--arm")!))) throw new Error("local_screen_cli_invalid");
    const cloudCount = cloudNames.filter(name => values.has(name)).length, cloudArm = values.get("--arm") === "cloud";
    // The cloud arm needs every cloud flag and the local arm none of them; the key itself is never a flag.
    if ((cloudArm && cloudCount !== cloudNames.length) || (!cloudArm && cloudCount) ||
        (values.has("--proxy-fake-ip") && (!cloudArm || values.get("--proxy-fake-ip") !== "true"))) throw new Error("local_screen_cli_invalid");
    const snapshotCount = snapshotNames.filter(name => values.has(name)).length;
    if (snapshotCount && (snapshotCount !== snapshotNames.length || values.get("--public-retrieval") !== "true")) throw new Error("local_screen_cli_invalid");
    return { taskDirectory: values.get("--task-directory")!, expectedJobSha256: values.get("--job-sha256")!,
      expectedBriefSha256: values.get("--brief-sha256")!, syntheticAuthoritySha256: values.get("--authority-sha256")!, imageId: values.get("--image-id")!,
      outputDirectory: values.get("--output-directory")!, expectedRuntimeSha256: values.get("--runtime-sha256")!, publicRetrieval: values.get("--public-retrieval") === "true",
      pauseAfterTools: values.has("--pause-after-tools") ? Number(values.get("--pause-after-tools")) : undefined,
      profile: values.has("--profile") ? values.get("--profile") as LocalScreenProfile : undefined,
      claimsLedger: values.get("--claims-ledger") === "true" ? true : undefined,
      ...(values.get("--document-review") === "true" ? { documentReview: true } : {}),
      ...(values.has("--repair-from") ? { repairFrom: values.get("--repair-from")! } : {}),
      ...(cloudArm ? { cloudArm: { model: values.get("--cloud-model")!, endpoint: values.get("--cloud-endpoint")!, prices: parseCloudPrices(values.get("--cloud-prices")!), maxFeeUsd: Number(values.get("--max-fee-usd")),
        ...(values.get("--proxy-fake-ip") === "true" ? { proxyFakeIp: true as const } : {}) } } : {}),
      ...(snapshotCount ? { publicSnapshot: { directory: values.get(snapshotNames[0]!)!, expectedBriefSha256: values.get(snapshotNames[1]!)!,
        expectedMapSha256: values.get(snapshotNames[2]!)!, indexPath: values.get(snapshotNames[3]!)! } } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runLocalArtifactScreen(parseLocalArtifactScreenArguments(process.argv.slice(2)));
    if (result.status !== "submitted") process.exitCode = 2;
  } catch { process.stderr.write(`${canonical({ state: "incomplete", error: "local_screen_failed_no_replay" })}\n`); process.exitCode = 1; }
}
