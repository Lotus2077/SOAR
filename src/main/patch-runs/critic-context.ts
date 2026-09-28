import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { createIsolatedGitEnvironment, DEFAULT_GIT_EXECUTABLE } from "../tools/git-command-policy";
import { isIgnoredRelativePath } from "../tools/workspace-policy";
import { buildCompactCriticMessages, validateCompactCriticBundle, COMPACT_CRITIC_BUNDLE_MAX_BYTES,
  type CompactCriticBundle } from "./compact-critic";
import { canonicalRequest } from "./native-contract";
import { isOpenAiSol, providerLimits, type PatchRuntimeConfig } from "./config";
import { inspectRoutingPatchScope } from "./patch-scope";

const execute = promisify(execFile);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const canonicalHash = (value: unknown) => hash(canonicalRequest(value));
const decode = (value: Buffer) => new TextDecoder("utf-8", { fatal: true }).decode(value);
const requireThat = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
export interface CriticSourceFile { path: string; bytes: Buffer; executable: boolean }

function safePath(value: string): string {
  requireThat(Buffer.byteLength(value) <= 1024 && !/[\\:\x00-\x1f\x7f]/u.test(value) && !value.startsWith("/") &&
    value.split("/").every(part => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git") &&
    !isIgnoredRelativePath(value, "file"), "Unsupported or excluded critic source path.");
  return value;
}
/** Match Python's code-point ordering, including paths outside the BMP. */
function comparePaths(a: string, b: string): number {
  const left = Array.from(a, c => c.codePointAt(0)!), right = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
}
export function criticSourceIdentity(files: readonly CriticSourceFile[]): string {
  const rows = [...files].sort((a, b) => comparePaths(a.path, b.path)).map(file => ({
    path: safePath(file.path), bytes: file.bytes.length, executable: file.executable, sha256: hash(file.bytes),
  }));
  requireThat(new Set(rows.map(row => row.path)).size === rows.length, "Duplicate critic source path.");
  return canonicalHash(rows);
}

interface SourceEnvelope { files: number; bytes: number; fileBytes: number }
const criticEnvelope: SourceEnvelope = { files: 64, bytes: COMPACT_CRITIC_BUNDLE_MAX_BYTES, fileBytes: COMPACT_CRITIC_BUNDLE_MAX_BYTES };
const workspaceEnvelope: SourceEnvelope = { files: 2000, bytes: 32 * 1024 * 1024, fileBytes: 1024 * 1024 };
async function sourceFiles(root: string, signal?: AbortSignal, ownGitDirectory = false,
  envelope: SourceEnvelope = criticEnvelope): Promise<CriticSourceFile[]> {
  const files: CriticSourceFile[] = [];
  let bytes = 0;
  async function visit(relative = ""): Promise<void> {
    signal?.throwIfAborted();
    for (const name of await readdir(path.join(root, relative))) {
      if (ownGitDirectory && !relative && name === ".git") continue;
      const item = safePath(relative ? `${relative}/${name}` : name), target = path.join(root, item), stat = await lstat(target);
      requireThat(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()), "Critic source must contain regular files only.");
      if (stat.isDirectory()) await visit(item);
      else {
        bytes += stat.size;
        requireThat(files.length < envelope.files && bytes <= envelope.bytes && stat.size <= envelope.fileBytes,
          "Complete critic source exceeds its admitted context envelope.");
        const data = await readFile(target, { signal });
        requireThat(data.length === stat.size, "Critic source changed while reading.");
        decode(data);
        files.push({ path: item, bytes: data, executable: Boolean(stat.mode & 0o111) });
      }
    }
  }
  await visit(); return files.sort((a, b) => comparePaths(a.path, b.path));
}

function git(root: string, args: string[], signal?: AbortSignal): Promise<unknown> {
  return execute(DEFAULT_GIT_EXECUTABLE, ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
    "-c", "protocol.allow=never", ...args], { cwd: root, env: createIsolatedGitEnvironment(),
    signal, timeout: 15_000, maxBuffer: 1_048_576 });
}

/** Applies only a structurally inspected diff in a fresh private directory.
 * Candidate code, hooks, filters and network transports never run on the host. */
async function reconstruct(baseline: readonly CriticSourceFile[], patch: string, signal?: AbortSignal,
  envelope: SourceEnvelope = criticEnvelope): Promise<CriticSourceFile[]> {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "soar-critic-context-")));
  const source = path.join(temporary, "source");
  try {
    await mkdir(source, { mode: 0o700 });
    await git(source, ["init", "--quiet"], signal);
    for (const file of baseline) {
      signal?.throwIfAborted();
      const target = path.join(source, safePath(file.path));
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, file.bytes, { flag: "wx", mode: file.executable ? 0o700 : 0o600, signal });
      await chmod(target, file.executable ? 0o700 : 0o600);
    }
    const patchFile = path.join(temporary, "candidate.patch");
    await writeFile(patchFile, patch, { flag: "wx", mode: 0o600, signal });
    await git(source, ["apply", "--check", "--whitespace=nowarn", "--", patchFile], signal);
    await git(source, ["apply", "--whitespace=nowarn", "--", patchFile], signal);
    return await sourceFiles(source, signal, true, envelope);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export function buildCriticBody(bundle: CompactCriticBundle, config: PatchRuntimeConfig) {
  const provider = config.cloud;
  requireThat(provider, "Critic provider is unavailable.");
  const limits = providerLimits(config, provider!);
  requireThat(limits.maxOutputTokens === 8192, "Critic output envelope changed.");
  const body: Record<string, unknown> = { model: provider!.model, messages: buildCompactCriticMessages(bundle), stream: false,
    ...(isOpenAiSol(provider!) ? { max_completion_tokens: 8192, reasoning_effort: "medium", service_tier: "default",
      prompt_cache_options: { mode: "explicit" } } : { max_tokens: 8192, ...(provider!.routing ? { provider: provider!.routing } : {}) }) };
  const encoded = canonicalRequest(body), bodyBytes = Buffer.byteLength(encoded);
  requireThat(bodyBytes <= Math.min(128000, limits.maxInputBytes), "Complete critic body exceeds its admitted envelope.");
  return { body, bodyBytes, bodySha256: hash(encoded),
    reservationMicrousd: Math.ceil(bodyBytes * provider!.inputUsdPerMillion + 8192 * provider!.outputUsdPerMillion) };
}

function taskScope(objective: string, baseline: readonly CriticSourceFile[], changedPaths: readonly string[]): string[] {
  changedPaths.forEach(safePath);
  const declarations = [...objective.matchAll(/^Allowed paths \(JSON\): (.+)$/gmu)];
  requireThat(declarations.length <= 1, "Critic task scope is ambiguous.");
  const allowedFiles = declarations.length ? z.array(z.string()).min(1).max(1000).parse(JSON.parse(declarations[0]![1]!)).map(safePath)
    : [...new Set([...baseline.map(file => file.path), ...changedPaths])].sort(comparePaths);
  requireThat(new Set(allowedFiles).size === allowedFiles.length && changedPaths.every(file => allowedFiles.includes(file)),
    "Critic draft exceeds the original task scope.");
  return allowedFiles;
}

/** Final repair verification needs source identity, not another critic context.
 * Keep ordinary workspace limits; no prompt construction or model request. */
export async function verifyCriticCandidate(input: {
  workspace: string; baseRevision: string; objective: string; patch: string; expectedSourceSha256: string; signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u).parse(input.baseRevision);
  z.string().regex(/^[a-f0-9]{64}$/u).parse(input.expectedSourceSha256);
  const stat = await lstat(input.workspace);
  requireThat(stat.isDirectory() && !stat.isSymbolicLink(), "Trusted critic baseline is unavailable.");
  const baseline = await sourceFiles(input.workspace, input.signal, false, workspaceEnvelope);
  const baselineSourceSha256 = criticSourceIdentity(baseline);
  const scope = await inspectRoutingPatchScope(input.patch, []);
  requireThat(scope.reason === "outside_allowed_paths" && scope.changedPaths.length > 0, "Final patch is not a supported Git diff.");
  taskScope(input.objective, baseline, scope.changedPaths);
  const sourceSha256 = criticSourceIdentity(await reconstruct(baseline, input.patch, input.signal, workspaceEnvelope));
  requireThat(sourceSha256 === input.expectedSourceSha256, "Final patch differs from its checked source.");
  requireThat(criticSourceIdentity(await sourceFiles(input.workspace, input.signal, false, workspaceEnvelope)) === baselineSourceSha256,
    "Trusted critic baseline changed during verification.");
  return { sourceSha256, baselineSourceSha256, patchSha256: hash(input.patch) };
}

/** The caller supplies only its own immutable materialized baseline path. */
export async function prepareCriticContext(input: {
  workspace: string; taskId: string; objective: string; visibleCommand: string; baseRevision: string;
  patch: string; expectedSourceSha256: string; config: PatchRuntimeConfig; signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  z.string().regex(/^[a-f0-9]{64}$/u).parse(input.expectedSourceSha256);
  const rootStat = await lstat(input.workspace);
  requireThat(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "Trusted critic baseline is unavailable.");
  const baseline = await sourceFiles(input.workspace, input.signal), baselineSourceSha256 = criticSourceIdentity(baseline);
  // An empty allowed set still returns fully parsed safe paths. A malformed diff
  // returns no paths; no candidate-controlled path is read from the host.
  const scope = await inspectRoutingPatchScope(input.patch, []);
  requireThat(scope.reason === "outside_allowed_paths" && scope.changedPaths.length > 0,
    "Critic draft is not a complete supported Git diff.");
  const allowedFiles = taskScope(input.objective, baseline, scope.changedPaths);
  const candidate = await reconstruct(baseline, input.patch, input.signal), sourceSha256 = criticSourceIdentity(candidate);
  requireThat(sourceSha256 === input.expectedSourceSha256, "Critic reconstructed source differs from the checked draft.");
  requireThat(criticSourceIdentity(await sourceFiles(input.workspace, input.signal)) === baselineSourceSha256,
    "Trusted critic baseline changed during preparation.");
  const files: CompactCriticBundle["files"] = [];
  for (const revision of ["baseline", "candidate"] as const) for (const file of revision === "baseline" ? baseline : candidate) {
    const text = decode(file.bytes);
    files.push({ path: file.path, revision, sha256: hash(file.bytes), bytes: file.bytes.length,
      sections: text ? [{ startLine: 1, endLine: text.split("\n").length - Number(text.endsWith("\n")), text,
        selectionReason: "Complete public repository file; identical selection rule for every artifact." }] : [] });
  }
  const bundle = validateCompactCriticBundle({ schemaVersion: 1, taskId: input.taskId, objective: input.objective,
    visibleTestCommand: input.visibleCommand, allowedFiles, baseRevision: input.baseRevision,
    candidatePatch: input.patch, changedPaths: scope.changedPaths, files,
    inventory: files.map(({ sections: _sections, ...file }) => ({ ...file, included: true })), omissions: [], contextComplete: true });
  return { bundle, ...buildCriticBody(bundle, input.config), bundleSha256: canonicalHash(bundle), baselineSourceSha256,
    sourceSha256, patchSha256: hash(input.patch), objectiveSha256: hash(input.objective), visibleCommandSha256: hash(input.visibleCommand) };
}
