import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { loadConfig, type LoadConfigOptions, type SoarConfig } from "../src/main/config";
import { PrivateAgentBroker, type BrokerDestination } from "../src/main/private-agent/broker";
import { canonical, digest } from "../src/main/private-agent/contracts";
import { PrivateCheckpointStore } from "../src/main/private-agent/checkpoints";
import { PrivateAgentModel, type PrivateModelConfig } from "../src/main/private-agent/model";
import { loadFlashNextTokenAdmission } from "../src/main/private-agent/flash-next-admission";
import { ANTHROPIC_API_VERSION, ANTHROPIC_MESSAGES_ENDPOINT } from "../src/main/private-agent/anthropic";
import { GeneralAgentSession, SESSION_LIMITS, researchTransferPhase, sessionFileManifest, sessionPhaseIdentity, type GeneralSessionOptions, type SessionPhase } from "../src/main/private-agent/session";
import { RulePacketScanner } from "../src/main/private-agent/scanner";
import { PrivateAgentStore } from "../src/main/private-agent/store";
import { COORDINATOR_PROFILES, GENERAL_TASK_BUDGETS, type CoordinatorModelProfile, type CoordinatorProfileName } from "../src/main/private-agent/profiles";
import { CLAIMS_LEDGER_CHECK_ID, CLAIMS_LEDGER_PATH, claimsInstructions, claimsLedgerCheck } from "../src/main/private-agent/claims";
import { claimsReportPath } from "../src/main/private-agent/host-flags";
import { withDocumentReview } from "../src/main/private-agent/document-review";
import { loadRepairDirectory, repairMatchesRun, repairSeedMatches, withRepair } from "../src/main/private-agent/repair";
import { DECK_CHECK_VERSION, deckArtifacts, withDeckValidity } from "../src/main/private-agent/ooxml";
import { assertSeedRolePolicy, loadResearchSeed, seededPipelineFreeze } from "../src/main/private-agent/research-seed";
import { assertRunDirectoryIgnored, createDiagnosticsFileSink } from "../src/main/private-agent/research-diagnostics";
import { buildPublicRetrievalPhase, loadPreparedOperatorTask, selectPreparedPublicInputs, startControlledSnapshotReceiver,
  type PreparedOperatorTask } from "./private-agent-run";
import { localStreamSettings } from "../src/main/liveness";
import { RESEARCH_PIPELINE_BUDGET, RESEARCH_PIPELINE_VERSION, RESEARCH_SPLIT_MAX_FEE_USD, researchProtocolSha256, researchSynthesisBelowFloor, type ResearchDiagnosticsSink } from "../src/main/private-agent/research-pipeline";
import { createResearchInput } from "../src/main/private-agent/research-producer";
import { researchPresentationPolicySha256, researchPresentationIdentity } from "../src/main/private-agent/research-presentation";
import { loadServingCard, servingCardExpectation, servingCardFreeze, servingCardRefusal, type LoadedServingCard } from "../src/main/private-agent/serving-card";
import { nonDefaultRoleParameters, type ResearchRolePolicy } from "../src/main/private-agent/research-roles";

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
    // H4: the loop's orchestration and the critique tool are part of what a frozen run ran under.
    "scripts/private-agent-run.ts", "scripts/private-agent-local-screen.ts", "scripts/phase4-loop.ts", "scripts/phase2-repair.ts", "scripts/secret-patterns.mjs", "src/main/config.ts", "src/main/liveness.ts", "pnpm-lock.yaml",
    "runtime/private-agent/Dockerfile", "runtime/private-agent/requirements.txt"];
  const files = paths.sort().map(path => ({ path, sha256: digest(readFileSync(path)) }));
  return { files, sha256: digest(canonical(files)) };
}

/** The repository the driver's own file lives in: the source freeze must be read from its root for a run's commit to describe it. */
const LOCAL_SCREEN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Read-only git as scripts/verify-release-head.ts runs it: no user or system configuration, pager, prompts or optional locks. */
const RUN_GIT_ENVIRONMENT: Readonly<NodeJS.ProcessEnv> = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", GIT_PROTOCOL_FROM_USER: "0", GIT_TERMINAL_PROMPT: "0" });
/** The verifier's overrides, so no hook, file-system monitor or external diff runs. */
const RUN_GIT_CONFIG = Object.freeze(["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-c", "diff.trustExitCode=false", "-c", "protocol.allow=never"]);
/** One read-only git query; the arguments never carry a path but the source freeze's own relative ones. */
export type LocalScreenGit = (args: readonly string[]) => string;
/** Git in `root` as its working directory, with no repository found above it, stdin closed, stderr discarded and bounded time and output. */
export function localScreenGitRunner(root: string): LocalScreenGit {
  return args => execFileSync("/usr/bin/git", [...RUN_GIT_CONFIG, ...args], { cwd: root, env: { ...RUN_GIT_ENVIRONMENT, GIT_CEILING_DIRECTORIES: dirname(root) },
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
}
/** The commit a run starts at, and whether a checkout of it would not reproduce the frozen sources (backlog item 11, finding E4). */
export interface LocalScreenGitState { commit: string; dirty: boolean }
const GIT_OBJECT_NAME = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
/** Git's blob id of these bytes in the repository's object format: SHA-1 beside a 40-hex commit, SHA-256 beside a 64-hex one. */
function gitBlobId(bytes: Buffer, format: "sha1" | "sha256"): string {
  return createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
/** Whether a `git config --get-regexp` query names anything; git exits 1 when nothing matches. */
function gitConfigured(git: LocalScreenGit, args: readonly string[]): boolean {
  try { return git(args).trim().length > 0; } catch (error) { if ((error as { status?: unknown }).status === 1) return false; throw error; }
}
/**
 * Backlog item 11, part 2 (BL-20261109-0422): the run's commit for its freeze, so a registry row names the commit the run executed
 * rather than the one the row is written at. `dirty` is true when the repository's own clean test fails (anything staged, unstaged,
 * or untracked and not ignored by the repository's own rules), when an index entry is one `git status` does not compare
 * (skip-worktree, assume-unchanged, sparse checkout), or when a frozen file's bytes are not the ones the source freeze hashed or not
 * its blob in `commit`. So `dirty: false` means a checkout of `commit` reproduces the source freeze, as long as a checkout writes
 * blobs unchanged (no filter, `ident` or CRLF conversion; true of this repository's `.gitattributes`). Null when git cannot say, a
 * filter command is configured (the status would run it), HEAD moves while the tree is read, or the working directory the source
 * freeze reads is not the driver's repository. Status lines and tree entries name paths: they stay in memory and are never stored,
 * printed or rethrown.
 */
export function localScreenGitState(frozen: readonly { path: string; sha256: string }[], options: { root?: string; cwd?: string; git?: LocalScreenGit } = {}): LocalScreenGitState | null {
  try {
    const real = realpathSync.native;
    const root = real(options.root ?? LOCAL_SCREEN_ROOT);
    if (real(options.cwd ?? process.cwd()) !== root) return null;
    const git = options.git ?? localScreenGitRunner(root);
    if (real(git(["rev-parse", "--show-toplevel"]).trim()) !== root) return null;
    if (gitConfigured(git, ["config", "--name-only", "--get-regexp", "^filter\\."])) return null;
    const commit = git(["rev-parse", "--verify", "HEAD^{commit}"]).trim();
    if (!GIT_OBJECT_NAME.test(commit)) return null;
    let dirty: boolean;
    try { dirty = git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]).length > 0; }
    catch (error) { if ((error as { code?: unknown }).code !== "ENOBUFS") return null; dirty = true; }
    // A tracked file deleted behind skip-worktree or assume-unchanged is missing from both the status and the source freeze's listing.
    if (!dirty) dirty = git(["ls-files", "-z", "-v"]).split("\0").some(entry => entry.length > 0 && !entry.startsWith("H "));
    if (!dirty && frozen.length) {
      const blobs = new Map<string, string>();
      for (const entry of git(["--literal-pathspecs", "ls-tree", "-r", "-z", commit, "--", ...frozen.map(file => file.path)]).split("\0")) {
        const match = /^[0-7]{6} blob ([0-9a-f]{40}(?:[0-9a-f]{24})?)\t(.+)$/su.exec(entry);
        if (match) blobs.set(match[2]!, match[1]!);
      }
      const format = commit.length === 64 ? "sha256" : "sha1";
      dirty = frozen.some(file => { const bytes = readFileSync(join(root, file.path)); return digest(bytes) !== file.sha256 || blobs.get(file.path) !== gitBlobId(bytes, format); });
    }
    // Every answer above must describe `commit`: a commit made while the tree was read leaves nothing to record.
    if (git(["rev-parse", "--verify", "HEAD^{commit}"]).trim() !== commit) return null;
    return { commit, dirty };
  } catch { return null; }
}

export type LocalScreenProfile = CoordinatorProfileName;
export const LOCAL_SCREEN_PROFILES = COORDINATOR_PROFILES;
/** Every harness local role, including the independently launched critic, shares this explicit deployment contract. */
export function buildLocalScreenModelConfig(
  config: Pick<SoarConfig, "vllm" | "streamingEnabled">,
  coordinator: Readonly<CoordinatorModelProfile>,
  cacheSalt = true,
): PrivateModelConfig {
  return { destinationId: "owned_local_model", model: config.vllm.model, maxOutputTokens: coordinator.maxOutputTokens,
    inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: coordinator.thinking, maxRequestBytes: coordinator.maxRequestBytes,
    ...(cacheSalt ? { promptCaching: "vllm_job_salt_v1" as const } : {}),
    ...(coordinator.sampling ? { sampling: { ...coordinator.sampling } } : {}), ...(config.streamingEnabled ? { streaming: true } : {}),
    ...(config.vllm.localReplyContract ? { localReplyContract: config.vllm.localReplyContract, localContextTokens: config.vllm.localContextTokens } : {}),
    ...(config.vllm.localTokenAdmission ? { localTokenAdmissionSha256: config.vllm.localTokenAdmission.sha256 } : {}) };
}
/** Main-process-only loading shared by the coordinator, reader/writer, judge and separate critic. */
export function buildLocalScreenTokenAdmission(config: Pick<SoarConfig, "vllm">) {
  return config.vllm.localTokenAdmission ? loadFlashNextTokenAdmission(config.vllm.localTokenAdmission) : undefined;
}
/**
 * SC: the adopted serving card the operator's env pair selects, read and checked before any run directory, database or
 * request exists; undefined without the pair. A refusal throws ServingCardError. Since 7a.2 and item 9 the research stage reads its
 * role policy (the caps, thinking and structured-output flags); nothing reads K or admission yet.
 */
export function buildLocalScreenServingCard(config: Pick<SoarConfig, "vllm">): LoadedServingCard | undefined {
  return config.vllm.servingCard ? loadServingCard(config.vllm.servingCard, servingCardExpectation(config)) : undefined;
}
/**
 * The session's research option (H2b/H2c): the local reader, and the planner and synthesiser on the local configuration or, under the
 * split arm, the cloud model's; the operator's diagnostics sink; and since 7a.2 the role policy an adopted card set, which the session
 * hands to the pipeline and binds into its identity.
 */
export function localScreenResearchOption(broker: PrivateAgentBroker, jobId: string, local: PrivateModelConfig, cloud: PrivateModelConfig | undefined,
  extras: { diagnostics?: ResearchDiagnosticsSink; roles?: ResearchRolePolicy } = {}): NonNullable<GeneralSessionOptions["research"]> {
  return { models: (contextId: string) => ({ reader: new PrivateAgentModel(broker, local, jobId, contextId), planner: new PrivateAgentModel(broker, cloud ?? local, jobId, contextId),
    synthesiser: new PrivateAgentModel(broker, cloud ?? local, jobId, contextId) }),
    ...(extras.diagnostics ? { diagnostics: extras.diagnostics } : {}), ...(extras.roles ? { roles: extras.roles } : {}) };
}
/**
 * freeze.json's pipeline block for a run with the reading stage: the protocol under the card's role policy, which the block names
 * only when it is not the default (7a.2, BL-20261114-1346-research-role-policy-design), so a run without a card records what it did.
 */
export function researchPipelineFreeze(planner: "cloud" | "local", roles?: ResearchRolePolicy) {
  return { name: "research" as const, version: RESEARCH_PIPELINE_VERSION, protocolSha256: researchProtocolSha256(RESEARCH_PIPELINE_BUDGET, roles), budget: RESEARCH_PIPELINE_BUDGET,
    planner, writer: "local" as const, ...(roles && nonDefaultRoleParameters(roles).length ? { roles } : {}) };
}
/**
 * The CLI's one failure line. A serving-card refusal adds its fixed code and allowlisted key path; every other failure prints
 * the bytes it printed before SC.
 */
export function localScreenFailureLine(error: unknown): string {
  return `${canonical({ state: "incomplete", error: "local_screen_failed_no_replay", ...servingCardRefusal(error) })}\n`;
}
/** Headless budgets: "standard" keeps the Phase 0 driver values so earlier rows stay comparable. */
const LOCAL_SCREEN_BUDGETS: Readonly<Record<LocalScreenProfile, { maxModelCalls: number; maxToolCalls: number; maxElapsedMs: number; maxRequests: number }>> = Object.freeze({
  standard: { maxModelCalls: 40, maxToolCalls: 80, maxElapsedMs: SESSION_LIMITS.maxElapsedMs, maxRequests: SESSION_LIMITS.maxRequests },
  heavy: { maxModelCalls: GENERAL_TASK_BUDGETS.heavy.modelCalls, maxToolCalls: GENERAL_TASK_BUDGETS.heavy.toolCalls,
    maxElapsedMs: GENERAL_TASK_BUDGETS.heavy.elapsedMs, maxRequests: GENERAL_TASK_BUDGETS.heavy.sessionRequests },
});

/** Phase 2 cloud arm (PR-E): the key comes from the process environment only and never reaches the freeze, the result or the registry. */
export const CLOUD_ARM_MAX_FEE_USD = 8;
export const CLOUD_ARM_KEY_VARIABLE = "SOAR_PHASE2_CLOUD_API_KEY";
/** The Claude key's own variable (scripts/with-claude-key.sh), so no wrapper mix-up can send one provider's key to the other. */
export const CLAUDE_ARM_KEY_VARIABLE = "SOAR_CLAUDE_CLOUD_API_KEY";
/** OpenAI's published 30-minute cache-write price for GPT-5.6-and-later models is 1.25× the input price; a fourth value in `--cloud-prices` overrides it. */
export const CLOUD_CACHE_WRITE_FACTOR = 1.25;
export interface CloudArmInput {
  /** `--cloud-prices in,out,cached[,write]` per million tokens; an absent write price means CLOUD_CACHE_WRITE_FACTOR × input. */
  model: string; endpoint: string; prices: { input: number; output: number; cached: number; write?: number }; maxFeeUsd: number;
  /** Owner opt-in (`--proxy-fake-ip true`): admit a fake-IP system proxy's 198.18.0.0/15 answer for the cloud endpoint. */
  proxyFakeIp?: true;
  /**
   * Long-context tier (`--cloud-long-context above,in,out,cached[,write]`): required on the OpenAI paths, whose heavy bodies
   * can exceed it; optional on `/v1/messages`, whose proposed model bills the whole window at one rate.
   */
  longContext?: { aboveTokens: number; input: number; output: number; cached: number; write?: number };
}
export function parseCloudLongContext(value: string): NonNullable<CloudArmInput["longContext"]> {
  const parts = value.split(",").map(part => Number(part));
  if (![4, 5].includes(parts.length) || !Number.isSafeInteger(parts[0]) || parts[0]! <= 0 || parts.slice(1).some(part => !Number.isFinite(part) || part < 0) || parts[3]! > parts[1]!) throw new Error("local_screen_cli_invalid");
  return { aboveTokens: parts[0]!, input: parts[1]!, output: parts[2]!, cached: parts[3]!, ...(parts.length === 5 ? { write: parts[4]! } : {}) };
}
/** The endpoint path selects the request shape exactly; any other path is refused rather than guessed. */
const CLOUD_API_BY_PATH: Readonly<Record<string, "openai" | "openai_responses" | "anthropic_messages">> = Object.freeze({ "/v1/chat/completions": "openai",
  "/v1/responses": "openai_responses", "/v1/messages": "anthropic_messages" });
export function parseCloudPrices(value: string): CloudArmInput["prices"] {
  const parts = value.split(",").map(part => Number(part));
  if (![3, 4].includes(parts.length) || parts.some(part => !Number.isFinite(part) || part < 0) || parts[2]! > parts[0]!) throw new Error("local_screen_cli_invalid");
  return { input: parts[0]!, output: parts[1]!, cached: parts[2]!, ...(parts.length === 4 ? { write: parts[3]! } : {}) };
}
export function buildCloudArm(input: CloudArmInput, environment: NodeJS.ProcessEnv, coordinator: { maxOutputTokens: number; thinking: "disabled" | "medium"; maxRequestBytes: number }) {
  const endpoint = new URL(input.endpoint);
  const api = Object.hasOwn(CLOUD_API_BY_PATH, endpoint.pathname) ? CLOUD_API_BY_PATH[endpoint.pathname]! : undefined;
  if (endpoint.protocol !== "https:" || !(input.maxFeeUsd > 0 && input.maxFeeUsd <= CLOUD_ARM_MAX_FEE_USD) || !api || endpoint.search) throw new Error("local_screen_cloud_arm_invalid");
  // Anthropic: the one published host only, so the Claude key reaches no other; adaptive thinking only (the model refuses `disabled`).
  const anthropic = api === "anthropic_messages";
  if (anthropic && (endpoint.href !== ANTHROPIC_MESSAGES_ENDPOINT || coordinator.thinking !== "medium")) throw new Error("local_screen_cloud_arm_invalid");
  const apiKey = environment[anthropic ? CLAUDE_ARM_KEY_VARIABLE : CLOUD_ARM_KEY_VARIABLE];
  if (!apiKey || !/^[\x21-\x7e]{8,512}$/u.test(apiKey)) throw new Error("local_screen_cloud_key_missing");
  const credentialVersion = Number((anthropic ? environment.SOAR_CLAUDE_CLOUD_CREDENTIAL_VERSION : environment.SOAR_PHASE2_CLOUD_CREDENTIAL_VERSION) ?? "1");
  if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 0) throw new Error("local_screen_cloud_arm_invalid");
  const accountId = anthropic ? environment.SOAR_CLAUDE_CLOUD_ACCOUNT_ID ?? "owner_anthropic_account" : environment.SOAR_PHASE2_CLOUD_ACCOUNT_ID ?? "owner_cloud_account";
  // Synthetic-only and explicitly grant-free: the broker admits this destination to a wholly synthetic lineage and nothing else.
  const destination: BrokerDestination = { id: "cloud_coordinator", kind: "cloud_model", endpoint: endpoint.href, apiKey, accountId, credentialVersion,
    privateDataAdmitted: false, syntheticOnly: true, grantFreeSynthetic: true, maxResponseBytes: 512 * 1024, timeoutMs: 600_000, maxRequestBytes: coordinator.maxRequestBytes,
    ...(input.proxyFakeIp ? { proxyFakeIp: true as const } : {}), ...(anthropic ? { anthropicVersion: ANTHROPIC_API_VERSION } : {}) };
  // Same output limit, thinking mode and body cap as the local arm; only the API shape, the prices and the timeout differ.
  // /v1/responses is the only OpenAI shape that serves tools with reasoning (BL-20261008-1300).
  // The Responses shape places explicit breakpoints and settles its reported cache writes at the published write price
  // (default 1.25× input) (H1). The chat-completions shape reports no write counts, so it keeps its previous configuration
  // and identity unchanged; a write price given for it is ignored.
  // The Anthropic shape places 5-minute breakpoints at the same positions and settles writes at the 5-minute write price
  // (also 1.25 times input), so it shares the Responses shape's write-price handling.
  const responses = api === "openai_responses", writes = responses || anthropic;
  const modelConfig = { destinationId: "cloud_coordinator", model: input.model, api, maxOutputTokens: coordinator.maxOutputTokens, thinking: coordinator.thinking,
    inputUsdPerMillion: input.prices.input, outputUsdPerMillion: input.prices.output, cachedInputUsdPerMillion: input.prices.cached,
    ...(writes ? { cacheWriteUsdPerMillion: input.prices.write ?? CLOUD_CACHE_WRITE_FACTOR * input.prices.input } : {}), maxRequestBytes: coordinator.maxRequestBytes,
    ...(input.longContext ? { longContext: { aboveTokens: input.longContext.aboveTokens, inputUsdPerMillion: input.longContext.input,
      outputUsdPerMillion: input.longContext.output, cachedInputUsdPerMillion: input.longContext.cached,
      ...(writes ? { cacheWriteUsdPerMillion: input.longContext.write ?? CLOUD_CACHE_WRITE_FACTOR * input.longContext.input } : {}) } } : {}),
    ...(responses ? { promptCaching: "responses_explicit_v1" as const } : anthropic ? { promptCaching: "anthropic_explicit_5m_v1" as const } : {}) };
  const maxFeeMicrousd = Math.round(input.maxFeeUsd * 1_000_000);
  return { destination, modelConfig, maxFeeMicrousd, freeze: { arm: "cloud" as const, accountId, credentialVersion, endpointSha256: digest(endpoint.href), maxFeeMicrousd, modelConfig,
    ...(input.proxyFakeIp ? { proxyFakeIp: true as const } : {}), ...(anthropic ? { anthropicVersion: ANTHROPIC_API_VERSION } : {}) } };
}

/** Adds the claims ledger requirement: sources are the job's input files plus, for two-phase runs, the public sources the host retained (never the model-authored context files). */
export function withClaimsLedger(phase: SessionPhase, publicRetrieval: boolean): SessionPhase {
  const report = claimsReportPath(phase.contract);
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
  /** H2a: salt the owned server's prefix cache per job (default true); `--cache-salt false` is the unsalted control arm of the isolation probe. */
  cacheSalt?: boolean;
  /** H2b/H2c: run the host-run research stage before the write phase; with the cloud arm the planner and synthesiser are the cloud model (split arm). */
  pipeline?: "research";
  /** PR-I: the job reviews its one input .docx through an edit plan, the pinned applier and the fidelity check (closed corpus). */
  documentReview?: boolean;
  /** Phase 2 cloud arm: the coordinator is a cloud model; the local model still judges claims. */
  cloudArm?: CloudArmInput;
  /** Phase 2 repair pair: start from a frozen failed draft with a critique (a directory written by scripts/phase2-repair.ts); local only. */
  repairFrom?: string;
  /** H4: write from the evidence packet another run's reading stage produced (that run's directory) instead of running the stage; local writer, claims ledger, heavy profile. */
  researchFrom?: string;
  /**
   * Backlog item 4: retain every rejected or truncated reading-stage reply (and since 7a.1 every kept extraction reply with drops), with its validation reasons, as files under
   * `<output-directory>/diagnostics/`; refused unless git ignores the output directory. The driver's lineage is
   * synthetic-attested, so the session's label gate admits the sink; a seeded run has no stage and builds none.
   */
  retainDiagnostics?: boolean;
},
/** For tests only, so a test never reads the repository's .env.local; the CLI and the loop never pass it, and undefined is loadConfig()'s default. */
configOptions?: LoadConfigOptions) {
  if (![input.expectedJobSha256, input.expectedBriefSha256, input.syntheticAuthoritySha256, input.expectedRuntimeSha256].every(hash => /^[a-f0-9]{64}$/u.test(hash)) ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.imageId) ||
      (input.pauseAfterTools !== undefined && (!Number.isInteger(input.pauseAfterTools) || input.pauseAfterTools < 1 || input.pauseAfterTools > 20))
      || (input.publicSnapshot !== undefined && input.publicRetrieval !== true)
      // H4: a seeded run is the write phase of a research pipeline run, so it keeps the pipeline's own requirements and never runs the stage or a cloud writer itself.
      || (input.researchFrom !== undefined && (input.pipeline !== undefined || input.cloudArm !== undefined || input.profile !== "heavy" || input.claimsLedger !== true ||
        input.publicRetrieval || input.documentReview))) throw new Error("local_screen_arguments_invalid");
  const sourceFreeze = localScreenSourceFreeze();
  if (sourceFreeze.sha256 !== input.expectedRuntimeSha256) throw new Error("local_screen_reviewed_source_changed");
  // Backlog item 11, part 2 (finding E4): the commit this run executes, read once beside the source freeze, for its registry row.
  const git = localScreenGitState(sourceFreeze.files);
  const task = loadPreparedOperatorTask(input.taskDirectory, { jobSha256: input.expectedJobSha256, briefSha256: input.expectedBriefSha256 });
  const profileName: LocalScreenProfile = input.profile ?? "standard", coordinator = COORDINATOR_PROFILES[profileName], budget = LOCAL_SCREEN_BUDGETS[profileName];
  // The prepared task binds the September contract caps; the profile's budget replaces them for this run only.
  const budgetedPhase = { ...task.phase, contract: { ...task.phase.contract, maxModelCalls: budget.maxModelCalls, maxToolCalls: budget.maxToolCalls, maxElapsedMs: budget.maxElapsedMs } };
  if (input.documentReview && (input.claimsLedger || input.publicRetrieval)) throw new Error("local_screen_document_review_closed_corpus");
  // H4: a task whose deliverables include a deck gets the OOXML validity check beside its other finish checks.
  const modePhase = withDeckValidity(input.claimsLedger ? withClaimsLedger(budgetedPhase, input.publicRetrieval === true)
    : input.documentReview ? withDocumentReview(budgetedPhase) : budgetedPhase);
  // H4: a second sample or a repair writes from the packet a first sample's stage produced; the seed is verified against that run's own ledger and the current protocol.
  const seed = input.researchFrom ? loadResearchSeed(resolve(input.researchFrom), task.binding) : undefined;
  const seededPhase = seed ? researchTransferPhase(modePhase, seed.files) : modePhase;
  // A repair starts from the identical frozen draft with the same task, profile and host-checked mode as the run that failed.
  const repair = input.repairFrom ? loadRepairDirectory(resolve(input.repairFrom)) : undefined;
  if (repair && (input.cloudArm || input.publicRetrieval || !repairMatchesRun(repair.binding, { jobSha256: task.binding.jobSha256, briefSha256: task.binding.briefSha256,
      profile: profileName, claimsLedger: input.claimsLedger === true, documentReview: input.documentReview === true }))) throw new Error("local_screen_repair_mismatch");
  // H4: a draft written from a packet is repaired on that packet and no other; a draft written without one takes no seed.
  if (repair && !repairSeedMatches(repair, seed?.seed)) throw new Error("local_screen_repair_seed_mismatch");
  const privatePhase = repair ? withRepair(seededPhase, repair) : seededPhase;
  // Bind all explicit public metadata and original public bytes before receiver/model/DB effects.
  const publicSnapshot = input.publicSnapshot ? preparePublicSnapshot(task, input.publicSnapshot) : undefined;
  const config = loadConfig(configOptions);
  if (config.providerMode !== "local" || config.vllm.costPolicy !== "local_zero_cost") throw new Error("local_screen_provider_not_admitted");
  // SC: a refused card stops the run before the output directory, the database or any request exists, so a loop stays resumable.
  const servingCard = buildLocalScreenServingCard(config);
  // 7a.2 (BL-20261114-1346-research-role-policy-design): the card's role policy reaches the reading stage and, when it is not the
  // default, the freeze's pipeline block. A seeded run writes from a packet read under a policy, so its source must have read under
  // this run's policy (the default without a card); refused, like the card, before anything is created.
  const roles = servingCard?.policy.roles;
  if (seed) assertSeedRolePolicy(seed.pipeline, roles);
  // 7a.2: a card whose synthesis attempts cannot hold the 100-word floor would be refused inside the session, after the run directory,
  // freeze.json and the database exist; it is refused here instead, like any card refusal. A split-arm synthesiser never reads the policy,
  // and the pipeline keeps its own check (research-pipeline.ts).
  if (input.pipeline === "research" && !input.cloudArm && roles && nonDefaultRoleParameters(roles).length && researchSynthesisBelowFloor(roles.synthesis))
    throw new Error("research_role_policy_invalid");
  const directory = resolve(input.outputDirectory);
  // Retained model text may only ever sit in a path the repository ignores (backlog item 4); refused before anything is created.
  if (input.retainDiagnostics) assertRunDirectoryIgnored(directory);
  mkdirSync(directory, { mode: 0o700 });
  const save = (name: string, value: unknown) => writeFileSync(join(directory, name), `${canonical(value)}\n`, { flag: "wx", mode: 0o600 });
  // The pinned card bytes stay beside freeze.json, which records their sha256 and never the path.
  if (servingCard) writeFileSync(join(directory, "serving-card.json"), servingCard.bytes, { flag: "wx", mode: 0o600 });
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
    const localTokenAdmission = buildLocalScreenTokenAdmission(config);
    const destinations: BrokerDestination[] = [{ id: "owned_local_model", kind: "local_model",
      endpoint: `${config.vllm.baseUrl}/chat/completions`, accountId: "operator_owned_local_server", credentialVersion: 1,
      apiKey: config.vllm.apiKey, privateDataAdmitted: false, syntheticOnly: true,
      ...(config.vllm.localTokenAdmission ? { localTokenAdmissionSha256: config.vllm.localTokenAdmission.sha256 } : {}),
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
    const broker = new PrivateAgentBroker(store, destinations, scanner,
      localTokenAdmission ? { localTokenAdmissions: [localTokenAdmission] } : {});
    // H2a: the harness track salts the owned server's prefix cache per job unless the run is the unsalted control arm. The one
    // local configuration serves the coordinator and the judge; freeze.json records it as modelConfig on local-arm runs and as
    // judgeModelConfig on cloud-arm runs. Runs before H2a sent no salt.
    const localModelConfig = buildLocalScreenModelConfig(config, coordinator, input.cacheSalt !== false);
    // The all-cloud arm writes with the cloud model; under the research pipeline the writer and reader are local and the cloud plans and synthesises (split arm).
    const pipeline = input.pipeline === "research";
    const modelConfig = cloud && !pipeline ? cloud.modelConfig : localModelConfig;
    // Backlog item 4: the file sink exists only for a run with a reading stage and the operator's flag; the freeze records the fact, never the text.
    const diagnostics = input.retainDiagnostics && pipeline ? createDiagnosticsFileSink(directory) : undefined;
    const freeze = { version: 1, jobId, sourceFreeze: sourceFreeze.files, sourceFreezeSha256: sourceFreeze.sha256, imageId: input.imageId,
      modelConfig, endpointIdentitySha256: digest(destinations[0]!.endpoint), deployment: "synthetic_only_unverified_for_private_data",
      taskBinding: task.binding, sourceBindingSha256: task.sourceBindingSha256, ...(cloud ? { judgeModelConfig: localModelConfig } : {}),
      syntheticAuthoritySha256: input.syntheticAuthoritySha256, privatePhaseSha256: sessionPhaseIdentity(privatePhase),
      publicPhaseSha256: publicPhase ? sessionPhaseIdentity(publicPhase) : null,
      publicSnapshot: publicSnapshot?.binding ?? null,
      scanner: "rules_only_not_a_privacy_classifier", pauseAfterTools: input.pauseAfterTools ?? null,
      profile: profileName, claimsLedger: input.claimsLedger === true, ...(input.documentReview ? { documentReview: true } : {}), ...(repair ? { repair: repair.binding } : {}), arm: cloud ? cloud.freeze : { arm: "local" as const },
      ...(pipeline ? { pipeline: researchPipelineFreeze(cloud ? "cloud" : "local", roles) } : {}),
      ...(diagnostics ? { diagnosticsRetained: true } : {}),
      ...(pipeline || seed ? { researchPresentationPolicySha256: researchPresentationPolicySha256() } : {}),
      ...(pipeline && !publicPhase ? { researchInput: createResearchInput(privatePhase.contract.goal,
        privatePhase.files.filter(file => file.path.startsWith("input/")).map(file => ({ id: file.path, path: file.path, bytes: file.bytes }))) } : {}),
      ...(privatePhase.initialEvidence ? { initialEvidenceIdentity: researchPresentationIdentity(privatePhase.initialEvidence) } : {}),
      // H4: a seeded run carries the source's pipeline block (so rows keep the pipeline columns) and names its seed; a deck task records the check it ran under.
      ...(seed ? { researchFrom: seed.seed, pipeline: seededPipelineFreeze(seed.pipeline, seed.seed) } : {}),
      ...(deckArtifacts(modePhase).length ? { deckCheck: { version: DECK_CHECK_VERSION, paths: deckArtifacts(modePhase) } } : {}),
      // SC: {sha256, version, date, entry} only when the pair selects a card; never the path, never inside `pipeline`.
      ...servingCardFreeze(servingCard),
      // Backlog item 11, part 2: {commit, dirty} or null; never a path.
      git,
      limits: { requests: budget.maxRequests, modelCalls: budget.maxModelCalls, toolCalls: budget.maxToolCalls, outputTokens: modelConfig.maxOutputTokens,
        inputBytes: coordinator.maxRequestBytes, requestTimeoutMs: cloud && !pipeline ? cloud.destination.timeoutMs : coordinator.requestTimeoutMs, elapsedMs: budget.maxElapsedMs, feeMicrousd: cloud?.maxFeeMicrousd ?? 0 },
      startedAt: new Date().toISOString(), artifactAccepted: null };
    save("freeze.json", freeze);
    session = new GeneralAgentSession({ jobId, imageId: input.imageId, store, broker, checkpoints,
      trustedHostModelFactory: contextId => new PrivateAgentModel(broker, modelConfig, jobId, contextId),
      ...(cloud ? { cloudArm: { destinationId: cloud.destination.id, maxFeeMicrousd: cloud.maxFeeMicrousd },
        judgeModelFactory: (contextId: string) => new PrivateAgentModel(broker, localModelConfig, jobId, contextId) } : {}),
      ...(pipeline ? { research: localScreenResearchOption(broker, jobId, localModelConfig, cloud?.modelConfig, { ...(diagnostics ? { diagnostics } : {}), ...(roles ? { roles } : {}) }) } : {}),
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

function messagesPath(endpoint: string | undefined): boolean {
  try { return endpoint !== undefined && new URL(endpoint).pathname === "/v1/messages"; } catch { return false; }
}

export function parseLocalArtifactScreenArguments(args: string[]): Parameters<typeof runLocalArtifactScreen>[0] {
    const snapshotNames = ["--public-snapshot-directory", "--public-snapshot-brief-sha256", "--public-snapshot-map-sha256", "--public-snapshot-index-path"];
    const cloudNames = ["--cloud-model", "--cloud-endpoint", "--cloud-prices", "--cloud-long-context", "--max-fee-usd"];
    const names = ["--task-directory", "--job-sha256", "--brief-sha256", "--authority-sha256", "--image-id", "--output-directory", "--runtime-sha256", "--public-retrieval", "--pause-after-tools", "--profile", "--claims-ledger", "--document-review", "--repair-from", "--arm", ...cloudNames, "--proxy-fake-ip", "--cache-salt", "--pipeline", "--research-from", "--retain-diagnostics", ...snapshotNames];
    if (args[0] !== "--execute-synthetic-local" || args.length % 2 !== 1 || args.slice(1).some((arg, i) => i % 2 === 0 && !names.includes(arg)) ||
        new Set(args.filter((_, i) => i % 2 === 1)).size !== (args.length - 1) / 2) throw new Error("local_screen_cli_invalid");
    const values = new Map(args.slice(1).filter((_, i) => i % 2 === 0).map(name => [name, args[args.indexOf(name) + 1]!]));
    if (names.slice(0, 7).some(name => !values.has(name)) || (values.has("--public-retrieval") && values.get("--public-retrieval") !== "true") ||
        (values.has("--profile") && !Object.hasOwn(LOCAL_SCREEN_PROFILES, values.get("--profile")!)) ||
        (values.has("--claims-ledger") && values.get("--claims-ledger") !== "true") ||
        (values.has("--cache-salt") && !["true", "false"].includes(values.get("--cache-salt")!)) ||
        // H2b/H2c: the stage needs the heavy profile's 200 session requests (reader 68 + writer 80) and the claims-ledger check that verifies its packet at finish.
        (values.has("--pipeline") && (values.get("--pipeline") !== "research" || values.has("--repair-from") || values.has("--document-review") ||
          values.get("--profile") !== "heavy" || values.get("--claims-ledger") !== "true")) ||
        // H3: the split arm's two cloud slots (one retry each) run on the Responses shape, or on Anthropic's Messages endpoint
        // (BL-20261030-0620), under a per-task fee cap of RESEARCH_SPLIT_MAX_FEE_USD.
        (values.has("--pipeline") && values.get("--arm") === "cloud" && (!(Number(values.get("--max-fee-usd")) > 0 && Number(values.get("--max-fee-usd")) <= RESEARCH_SPLIT_MAX_FEE_USD) ||
          !(/^https:\/\/[^/?#]+\/v1\/responses$/u.test(values.get("--cloud-endpoint") ?? "") || values.get("--cloud-endpoint") === ANTHROPIC_MESSAGES_ENDPOINT))) ||
        (values.has("--document-review") && (values.get("--document-review") !== "true" || values.has("--claims-ledger") || values.has("--public-retrieval"))) ||
        (values.has("--repair-from") && (values.get("--arm") === "cloud" || !values.get("--repair-from"))) ||
        // H4: a seeded write phase keeps the pipeline's requirements (heavy profile, claims ledger), runs no stage of its own and never writes with the cloud model.
        (values.has("--research-from") && (!values.get("--research-from") || values.has("--pipeline") || values.get("--arm") === "cloud" || values.get("--profile") !== "heavy" ||
          values.get("--claims-ledger") !== "true" || values.has("--document-review") || values.has("--public-retrieval"))) ||
        // Backlog item 4: retained diagnostics are a reading-stage affair and an explicit opt-in; the directory check happens in the run.
        (values.has("--retain-diagnostics") && (values.get("--retain-diagnostics") !== "true" || values.get("--pipeline") !== "research")) ||
        (values.has("--arm") && !["local", "cloud"].includes(values.get("--arm")!))) throw new Error("local_screen_cli_invalid");
    const cloudCount = cloudNames.filter(name => values.has(name)).length, cloudArm = values.get("--arm") === "cloud";
    // `/v1/messages` takes no long-context tier for the proposed model, only the published host and only the heavy profile
    // (the standard profile's thinking is `disabled`, which that model refuses), refused here before any directory exists.
    const anthropicArm = cloudArm && messagesPath(values.get("--cloud-endpoint"));
    const required = anthropicArm ? cloudNames.filter(name => name !== "--cloud-long-context") : cloudNames;
    // The cloud arm needs every required cloud flag and the local arm none of them; the key itself is never a flag.
    if ((cloudArm && required.some(name => !values.has(name))) || (!cloudArm && cloudCount) ||
        (anthropicArm && (values.get("--profile") !== "heavy" || values.get("--cloud-endpoint") !== ANTHROPIC_MESSAGES_ENDPOINT)) ||
        (values.has("--proxy-fake-ip") && (!cloudArm || values.get("--proxy-fake-ip") !== "true"))) throw new Error("local_screen_cli_invalid");
    const snapshotCount = snapshotNames.filter(name => values.has(name)).length;
    if (snapshotCount && (snapshotCount !== snapshotNames.length || values.get("--public-retrieval") !== "true")) throw new Error("local_screen_cli_invalid");
    return { taskDirectory: values.get("--task-directory")!, expectedJobSha256: values.get("--job-sha256")!,
      expectedBriefSha256: values.get("--brief-sha256")!, syntheticAuthoritySha256: values.get("--authority-sha256")!, imageId: values.get("--image-id")!,
      outputDirectory: values.get("--output-directory")!, expectedRuntimeSha256: values.get("--runtime-sha256")!, publicRetrieval: values.get("--public-retrieval") === "true",
      pauseAfterTools: values.has("--pause-after-tools") ? Number(values.get("--pause-after-tools")) : undefined,
      profile: values.has("--profile") ? values.get("--profile") as LocalScreenProfile : undefined,
      claimsLedger: values.get("--claims-ledger") === "true" ? true : undefined,
      ...(values.has("--cache-salt") ? { cacheSalt: values.get("--cache-salt") === "true" } : {}),
      ...(values.get("--pipeline") === "research" ? { pipeline: "research" as const } : {}),
      ...(values.get("--document-review") === "true" ? { documentReview: true } : {}),
      ...(values.has("--repair-from") ? { repairFrom: values.get("--repair-from")! } : {}),
      ...(values.has("--research-from") ? { researchFrom: values.get("--research-from")! } : {}),
      ...(values.get("--retain-diagnostics") === "true" ? { retainDiagnostics: true } : {}),
      ...(cloudArm ? { cloudArm: { model: values.get("--cloud-model")!, endpoint: values.get("--cloud-endpoint")!, prices: parseCloudPrices(values.get("--cloud-prices")!), maxFeeUsd: Number(values.get("--max-fee-usd")),
        ...(values.has("--cloud-long-context") ? { longContext: parseCloudLongContext(values.get("--cloud-long-context")!) } : {}),
        ...(values.get("--proxy-fake-ip") === "true" ? { proxyFakeIp: true as const } : {}) } } : {}),
      ...(snapshotCount ? { publicSnapshot: { directory: values.get(snapshotNames[0]!)!, expectedBriefSha256: values.get(snapshotNames[1]!)!,
        expectedMapSha256: values.get(snapshotNames[2]!)!, indexPath: values.get(snapshotNames[3]!)! } } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runLocalArtifactScreen(parseLocalArtifactScreenArguments(process.argv.slice(2)));
    if (result.status !== "submitted") process.exitCode = 2;
  } catch (error) { process.stderr.write(localScreenFailureLine(error)); process.exitCode = 1; }
}
