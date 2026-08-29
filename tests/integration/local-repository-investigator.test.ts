import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify, TextDecoder } from "node:util";

import { describe, expect, it } from "vitest";

import { SessionRunner } from "../../src/main/agent/run-session";
import { loadConfig } from "../../src/main/config";
import { createSoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { OpenAICompatibleProvider } from "../../src/main/providers/openai-compatible";
import type {
  CompleteInput,
  InferenceProvider,
  ProviderResult,
} from "../../src/main/providers/types";
import {
  sha256Hex,
  type ContextPacket,
  type ToolEvidence,
} from "../../src/shared/context-compiler";
import type {
  CompletionObligationToolName,
  StoredSessionEvent,
} from "../../src/shared/session-events";
import {
  parseSuccessfulRepositoryToolObservation,
  workspaceRelativePathForTool,
} from "../../src/shared/tool-observation";

const runLive = process.env.SOAR_RUN_LIVE_REPOSITORY === "true";
const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const citationPattern =
  /(^|[^A-Za-z0-9_./@+\\-])((?:[A-Za-z0-9_@+.-]+[\\/])*[A-Za-z0-9_@+.-]+):([1-9][0-9]*)(?![0-9])/gmu;
const execFileAsync = promisify(execFile);
const proofContextPolicy = { maxInputTokens: 16_384, safetyMargin: 0.2 } as const;
// This shared ceiling contains the current cancellation objective while
// leaving enough room for the larger symbol evidence set. The real envelope
// and final-retention tests below remain the authoritative capacity gates.
const proofObjectiveMaxUtf8Bytes = 2_800;
const symbolObjectiveMaxUtf8Bytes = 2_050;
const finalPacketDriftToleranceBytes = 250;
const proofModel = "RM-01 VLM";
const proofSchemaVersion = 5;
const proofRunType =
  "guided-evaluator-disclosed-repository-evidence-contract-v1";
const proofMethodologyDisclosure =
  "Evaluator-owned paths, source substrings, required relationships, and output-record shapes are agent-visible. This run proves bounded execution, evidence verification, and accepted-answer context retention; it is not blind repository discovery or a quality benchmark.";
const claimCoverageMarker = "SOAR_CLAIM_COVERAGE=";
const symbolAuditMarker = "SOAR_SYMBOL_AUDIT=";
const evaluatorExcludedPaths = [
  "tests/integration/local-repository-investigator.test.ts",
] as const;
const nonComparableHistoricalReference = {
  inputTokens: 934_311,
  toolCalls: 46,
  providerCalls: 49,
  latencyMs: 434_373,
  citations: 98,
  model: proofModel,
  limits: { inferenceRounds: 20, toolCalls: 24 },
  revision: "f221798+working-tree",
  comparisonStatus: "non-comparable",
  reasons: [
    "The historical repository state was an uncommitted working tree rather than an immutable Git revision.",
    "The historical artifact does not pin an agent-fixture hash.",
    "The completion-obligation and task-validator contract changed after the historical run.",
  ],
} as const;

interface ClaimEvidenceRequirement {
  path: string;
  lineIncludes: string;
}

interface ClaimCoverageRequirement {
  id: string;
  summaryPhrases: string[];
  evidence: ClaimEvidenceRequirement[];
}

interface SupportingSearchRequirement {
  path: string;
  query: string;
}

interface ArchitectureDiscoverySchedule {
  listArguments: Readonly<{
    relativePath: string;
    recursive: boolean;
    maxDepth: number;
    maxItems: number;
  }>;
  readArguments: Readonly<{ relativePath: string }>;
}

interface ProofTask {
  id: string;
  title: string;
  objective: string;
  requiredTools: CompletionObligationToolName[];
  minimumVerifiedPathLineCitations: number;
  maximumProviderCalls: number;
  maximumToolCalls: number;
  claimCoverage?: ClaimCoverageRequirement[];
  orderedEvidenceSearches?: SupportingSearchRequirement[];
  architectureDiscoverySchedule?: ArchitectureDiscoverySchedule;
  requiresClaimEvidenceReads?: boolean;
  requiresClaimEvidenceSearches?: boolean;
  requiresCallPathProse?: boolean;
  requiresExactSymbolAudit?: boolean;
}

interface RepositoryProofIdentity {
  revision: string;
  clean: true;
}

interface RepositoryProofFixture {
  temporaryRoot: string;
  workspaceRoot: string;
  sourceRevision: string;
  archiveSha256: string;
  excludedPaths: readonly string[];
}

interface IndependentSymbolOracle {
  method: "independent-utf8-filesystem-scan-v1";
  scope: string;
  filesVisited: number;
  textFilesScanned: number;
  bytesScanned: number;
  occurrences: string[];
  occurrencesSha256: string;
}

type ToolCallCompletedEvent = Extract<
  StoredSessionEvent,
  { type: "tool.call.completed" }
>;

type ToolCallRequestedEvent = Extract<
  StoredSessionEvent,
  { type: "tool.call.requested" }
>;

interface SuccessfulToolExecution {
  request: ToolCallRequestedEvent;
  completion: ToolCallCompletedEvent;
}

interface CapturedProviderInput {
  messages: CompleteInput["messages"];
  allowTools: boolean | undefined;
  allowedToolNames: CompleteInput["allowedToolNames"];
  requireToolCall: boolean | undefined;
}

interface FinalPacketRetentionAudit {
  acceptedRound: number;
  packetMode: ContextPacket["mode"];
  allowTools: boolean | undefined;
  allowedToolNames: string[] | null;
  requireToolCall: boolean;
  toolEvidenceItems: number;
  toolCitationSnippets: number;
  requiredVerifiedAnswerCitations: number;
  retainedVerifiedAnswerCitations: number;
  requiredVerifiedAnswerCitationsSha256: string;
  retainedVerifiedAnswerCitationsSha256: string;
  requiredClaimEvidence: number;
  retainedClaimEvidence: number;
  requiredClaimEvidenceSha256: string;
  retainedClaimEvidenceSha256: string;
  requiredSymbolOccurrences: number;
  retainedSymbolOccurrences: number;
  requiredSymbolOccurrencesSha256: string;
  retainedSymbolOccurrencesSha256: string;
  contextPacketSha256: string;
  contextMessagesSha256: string;
}

interface ProviderEndpointAttestation {
  apiBaseSha256: string;
  modelsResponseSha256: string;
  modelsResponseBytes: number;
  advertisedModelCount: number;
  model: {
    id: string;
    ownedBy: string | null;
    maxModelLen: number | null;
  };
}

class ContextEnvelopeProbeProvider implements InferenceProvider {
  private readonly reserveProvider = new OpenAICompatibleProvider({
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "non-live-budget-probe",
    model: proofModel,
    costPolicy: "local_zero_cost",
    maxOutputTokens: 128,
    timeoutMs: 1_000,
  });
  readonly id = this.reserveProvider.id;
  readonly model = this.reserveProvider.model;
  readonly costPolicy = this.reserveProvider.costPolicy;
  calls = 0;
  readonly allowTools: boolean[] = [];
  readonly allowedToolNames: Array<CompleteInput["allowedToolNames"]> = [];
  readonly requireToolCall: Array<CompleteInput["requireToolCall"]> = [];
  readonly contexts: Array<CompleteInput["messages"]> = [];

  estimateInputTokenReserve(
    allowTools: boolean,
    allowedToolNames?: CompleteInput["allowedToolNames"],
    requireToolCall?: boolean,
  ): number {
    return this.reserveProvider.estimateInputTokenReserve(
      allowTools,
      allowedToolNames,
      requireToolCall,
    );
  }

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.calls += 1;
    this.allowTools.push(input.allowTools ?? true);
    this.allowedToolNames.push(input.allowedToolNames);
    this.requireToolCall.push(input.requireToolCall);
    this.contexts.push(structuredClone(input.messages));
    const requiredTool = input.allowedToolNames?.[0];
    if (input.allowTools && input.requireToolCall && requiredTool !== undefined) {
      const arguments_ =
        requiredTool === "list_files"
          ? { relativePath: ".", recursive: false, maxItems: 5 }
          : requiredTool === "search_text"
            ? {
                query: `proof-envelope-probe-${this.calls}`,
                relativePath: "probe.txt",
                caseSensitive: true,
                maxMatches: 5,
                maxDepth: 1,
              }
            : { relativePath: `probe-${this.calls}.txt` };
      return {
        content: "",
        toolCalls: [
          {
            id: `${requiredTool}-${this.calls}`,
            type: "function",
            function: {
              name: requiredTool,
              arguments: JSON.stringify(arguments_),
            },
          },
        ],
        finishReason: "tool_calls",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        servedModel: this.model,
        costUsd: 0,
        durationMs: 1,
      };
    }
    const content = "Non-live finalization budget probe.";
    input.onDelta(content);
    return {
      content,
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      servedModel: this.model,
      costUsd: 0,
      durationMs: 1,
    };
  }
}

class CapturingInferenceProvider implements InferenceProvider {
  readonly id: string;
  readonly model: string;
  readonly costPolicy: InferenceProvider["costPolicy"];
  readonly inputs: CapturedProviderInput[] = [];

  constructor(private readonly delegate: InferenceProvider) {
    this.id = delegate.id;
    this.model = delegate.model;
    this.costPolicy = delegate.costPolicy;
  }

  estimateInputTokenReserve(
    allowTools: boolean,
    allowedToolNames?: CompleteInput["allowedToolNames"],
    requireToolCall?: boolean,
  ): number {
    return (
      this.delegate.estimateInputTokenReserve?.(
        allowTools,
        allowedToolNames,
        requireToolCall,
      ) ?? 0
    );
  }

  complete(input: CompleteInput): Promise<ProviderResult> {
    this.inputs.push({
      messages: structuredClone(input.messages),
      allowTools: input.allowTools,
      allowedToolNames:
        input.allowedToolNames === undefined
          ? undefined
          : [...input.allowedToolNames],
      requireToolCall: input.requireToolCall,
    });
    return this.delegate.complete(input);
  }
}

function contextPacketJson(messages: CompleteInput["messages"]): string {
  const prefix = "SOAR_CONTEXT_PACKET_V1\n";
  const packetMessage = messages.find((message) => message.role === "user");
  if (
    typeof packetMessage?.content !== "string" ||
    !packetMessage.content.startsWith(prefix)
  ) {
    throw new Error("Expected a SOAR context packet user message.");
  }
  return packetMessage.content.slice(prefix.length);
}

function parseContextPacket(messages: CompleteInput["messages"]): ContextPacket {
  return JSON.parse(contextPacketJson(messages)) as ContextPacket;
}

function requireProofEnvironment(name: "SOAR_PROOF_MODEL" | "SOAR_PROOF_REVISION"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for a live proof so the comparison cannot silently drift.`,
    );
  }
  return value;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalProofJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("Proof hashes cannot include undefined values.");
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalProofJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalProofJson(record[key])}`,
    )
    .join(",")}}`;
}

function capturedMessagesSha256(messages: CompleteInput["messages"]): string {
  return sha256Hex(canonicalProofJson(messages));
}

function hashSortedStrings(values: readonly string[]): string {
  return sha256Text(JSON.stringify([...values].sort()));
}

function normalizedApiBase(baseUrl: string): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return `${url.protocol}//${url.host}${pathname}`;
}

function endpointAttestationFromModelsResponse(options: {
  baseUrl: string;
  expectedModel: string;
  responseText: string;
}): ProviderEndpointAttestation {
  const responseBytes = new TextEncoder().encode(options.responseText).length;
  if (responseBytes > 1_048_576) {
    throw new Error("The vLLM model-list response exceeds the 1 MiB proof bound.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(options.responseText) as unknown;
  } catch {
    throw new Error("The vLLM model-list response is not valid JSON.");
  }
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("The vLLM model-list response must contain a data array.");
  }
  if (payload.data.length > 10_000) {
    throw new Error("The vLLM model-list response exceeds the proof model-count bound.");
  }

  const advertised = payload.data.filter(
    (entry) => isRecord(entry) && entry.id === options.expectedModel,
  );
  if (advertised.length !== 1 || !isRecord(advertised[0])) {
    throw new Error(
      `The vLLM model-list response must advertise ${JSON.stringify(options.expectedModel)} exactly once.`,
    );
  }
  const model = advertised[0];
  const ownedBy = model.owned_by;
  if (
    ownedBy !== undefined &&
    ownedBy !== null &&
    (typeof ownedBy !== "string" ||
      ownedBy.length > 128 ||
      !/^[A-Za-z0-9_.@+ -]*$/u.test(ownedBy))
  ) {
    throw new Error("The advertised model owned_by metadata is invalid or oversized.");
  }
  const maxModelLen = model.max_model_len;
  if (
    maxModelLen !== undefined &&
    maxModelLen !== null &&
    (!Number.isSafeInteger(maxModelLen) || (maxModelLen as number) <= 0)
  ) {
    throw new Error("The advertised model max_model_len metadata is invalid.");
  }

  return {
    apiBaseSha256: sha256Text(normalizedApiBase(options.baseUrl)),
    modelsResponseSha256: sha256Text(options.responseText),
    modelsResponseBytes: responseBytes,
    advertisedModelCount: payload.data.length,
    model: {
      id: options.expectedModel,
      ownedBy: typeof ownedBy === "string" ? ownedBy : null,
      maxModelLen:
        typeof maxModelLen === "number" ? maxModelLen : null,
    },
  };
}

async function attestProviderEndpoint(options: {
  baseUrl: string;
  apiKey: string;
  expectedModel: string;
  timeoutMs: number;
}): Promise<ProviderEndpointAttestation> {
  const timeoutMs = Math.min(options.timeoutMs, 30_000);
  let response: Response;
  try {
    response = await fetch(`${normalizedApiBase(options.baseUrl)}/models`, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(options.apiKey
          ? { authorization: `Bearer ${options.apiKey}` }
          : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("The configured vLLM model-list request failed.");
  }
  if (!response.ok) {
    throw new Error(
      `The configured vLLM model-list request returned HTTP ${response.status}.`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 1_048_576) {
    throw new Error("The vLLM model-list response exceeds the 1 MiB proof bound.");
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > 1_048_576) {
    throw new Error("The vLLM model-list response exceeds the 1 MiB proof bound.");
  }
  let responseText: string;
  try {
    responseText = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new Error("The vLLM model-list response is not valid UTF-8.");
  }
  return endpointAttestationFromModelsResponse({
    baseUrl: options.baseUrl,
    expectedModel: options.expectedModel,
    responseText,
  });
}

async function readRepositoryProofIdentity(
  repositoryRoot: string,
): Promise<RepositoryProofIdentity> {
  const [revisionResult, statusResult] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
    execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    ),
  ]);
  const revision = revisionResult.stdout.trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision)) {
    throw new Error("The live proof could not resolve a canonical Git HEAD.");
  }
  if (statusResult.stdout.trim()) {
    throw new Error(
      "The live proof requires a clean Git worktree, including no untracked source files.",
    );
  }
  return { revision, clean: true };
}

async function createPinnedRepositoryFixture(
  repositoryRoot: string,
  sourceRevision: string,
): Promise<RepositoryProofFixture> {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "soar-repository-proof-"),
  );
  const archivePath = path.join(temporaryRoot, "fixture.tar");
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  await mkdir(workspaceRoot, { mode: 0o700 });

  try {
    await execFileAsync(
      "git",
      [
        "archive",
        "--format=tar",
        `--output=${archivePath}`,
        sourceRevision,
        "--",
        ".",
        ...evaluatorExcludedPaths.map((relativePath) =>
          `:(exclude)${relativePath}`,
        ),
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    const archive = await readFile(archivePath);
    const archiveSha256 = createHash("sha256").update(archive).digest("hex");
    await execFileAsync("tar", ["-xf", archivePath, "-C", workspaceRoot], {
      cwd: temporaryRoot,
      encoding: "utf8",
    });
    for (const relativePath of evaluatorExcludedPaths) {
      try {
        await stat(path.join(workspaceRoot, relativePath));
        throw new Error(
          `Evaluator source unexpectedly entered the agent fixture: ${relativePath}`,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          continue;
        }
        throw error;
      }
    }
    return {
      temporaryRoot,
      workspaceRoot,
      sourceRevision,
      archiveSha256,
      excludedPaths: evaluatorExcludedPaths,
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function buildIndependentSymbolOracle(
  workspaceRoot: string,
): Promise<IndependentSymbolOracle> {
  const occurrences: string[] = [];
  let filesVisited = 0;
  let textFilesScanned = 0;
  let bytesScanned = 0;
  const maximumFileBytes = 64 * 1024 * 1024;
  const maximumTotalBytes = 256 * 1024 * 1024;
  const maximumFiles = 50_000;

  const visit = async (
    absoluteDirectory: string,
    relativeDirectory: string,
  ): Promise<void> => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;

      filesVisited += 1;
      if (filesVisited > maximumFiles) {
        throw new Error(
          `Independent symbol oracle exceeded its ${maximumFiles}-file fail-closed limit.`,
        );
      }
      const fileStats = await stat(absolutePath);
      if (fileStats.size > maximumFileBytes) {
        throw new Error(
          `Independent symbol oracle refuses to omit oversized file ${relativePath}.`,
        );
      }
      bytesScanned += fileStats.size;
      if (bytesScanned > maximumTotalBytes) {
        throw new Error(
          `Independent symbol oracle exceeded its ${maximumTotalBytes}-byte fail-closed limit.`,
        );
      }

      const contents = await readFile(absolutePath);
      if (contents.includes(0)) continue;
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
      } catch {
        continue;
      }
      textFilesScanned += 1;
      const lines = text.split(/\r\n|\r|\n/u);
      for (const [index, line] of lines.entries()) {
        if (line.includes(symbol)) {
          occurrences.push(`${relativePath}:${index + 1}`);
        }
      }
    }
  };

  await visit(workspaceRoot, "");
  occurrences.sort();
  if (new Set(occurrences).size !== occurrences.length) {
    throw new Error("Independent symbol oracle produced duplicate path:line entries.");
  }
  const method = "independent-utf8-filesystem-scan-v1" as const;
  const scope =
    "Every regular UTF-8 file in the extracted Git archive; symlinks and binary files are excluded; one occurrence is recorded per matching line.";
  const occurrencesSha256 = createHash("sha256")
    .update(JSON.stringify({ method, scope, symbol, occurrences }))
    .digest("hex");
  return {
    method,
    scope,
    filesVisited,
    textFilesScanned,
    bytesScanned,
    occurrences,
    occurrencesSha256,
  };
}

async function quarantineExistingProofArtifacts(
  outputDirectory: string,
  artifactPaths: readonly string[],
): Promise<string[]> {
  const quarantineDirectory = path.join(outputDirectory, "quarantine");
  const quarantined: string[] = [];

  for (const artifactPath of [...new Set(artifactPaths)]) {
    let contents: Buffer;
    try {
      contents = await readFile(artifactPath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }

    await mkdir(quarantineDirectory, { recursive: true, mode: 0o700 });
    const digest = createHash("sha256").update(contents).digest("hex");
    const quarantinePath = path.join(
      quarantineDirectory,
      `${path.basename(artifactPath)}.${digest}.stale`,
    );
    try {
      await rename(artifactPath, quarantinePath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        await rm(artifactPath, { force: true });
      } else {
        throw error;
      }
    }
    quarantined.push(path.relative(projectRoot, quarantinePath));
  }

  return quarantined.sort();
}

async function writeProofArtifact(
  artifactPath: string,
  report: unknown,
  pathRedactions: readonly ProofPathRedaction[] = [],
): Promise<void> {
  const temporaryPath = `${artifactPath}.tmp`;
  const publicReport = redactProofArtifactPaths(report, pathRedactions);
  await writeFile(
    temporaryPath,
    `${JSON.stringify(publicReport, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, artifactPath);
}

interface ProofPathRedaction {
  source: string;
  replacement: string;
}

function proofArtifactRedactions(
  fixture?: RepositoryProofFixture,
): ProofPathRedaction[] {
  return [
    ...(fixture === undefined
      ? []
      : [
          {
            source: fixture.temporaryRoot,
            replacement: "<isolated-fixture-root>",
          },
        ]),
    { source: tmpdir(), replacement: "<temporary-root>" },
    { source: projectRoot, replacement: "<repository-root>" },
  ].sort((left, right) => right.source.length - left.source.length);
}

function redactProofArtifactPaths(
  value: unknown,
  redactions: readonly ProofPathRedaction[],
): unknown {
  if (typeof value === "string") {
    return redactions.reduce(
      (redacted, entry) => redacted.replaceAll(entry.source, entry.replacement),
      value,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactProofArtifactPaths(item, redactions));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactProofArtifactPaths(item, redactions),
      ]),
    );
  }
  return value;
}

const symbol = `${"cancel"}${"Session"}`;
const symbolGlobalSearchArguments = {
  query: symbol,
  relativePath: ".",
  caseSensitive: true,
  maxMatches: 500,
  maxDepth: 20,
} as const;
const symbolGlobalPacketArguments = {
  query: symbol,
  maxMatches: 500,
  maxDepth: 20,
} as const;

const architectureClaims: ClaimCoverageRequirement[] = [
  {
    id: "desktop-entry",
    summaryPhrases: ["Electron starts through bootstrap"],
    evidence: [
      {
        path: "src/main/index.ts",
        lineIncludes: "app.whenReady().then(bootstrap)",
      },
    ],
  },
  {
    id: "session-execution",
    summaryPhrases: ["SessionRunner owns task execution"],
    evidence: [
      {
        path: "src/main/agent/run-session.ts",
        lineIncludes: "export class SessionRunner",
      },
    ],
  },
  {
    id: "renderer",
    summaryPhrases: ["the renderer renders App"],
    evidence: [
      {
        path: "src/renderer/src/App.tsx",
        lineIncludes: "export function App()",
      },
    ],
  },
  {
    id: "persistence",
    summaryPhrases: [
      "EventStore persists events and reduceSessionEvent replays them",
    ],
    evidence: [
      {
        path: "src/main/event-store.ts",
        lineIncludes: "export class EventStore",
      },
      {
        path: "src/shared/session-reducer.ts",
        lineIncludes: "export function reduceSessionEvent",
      },
    ],
  },
  {
    id: "shared-event-contract",
    summaryPhrases: ["SessionEventDataSchema defines the event schema"],
    evidence: [
      {
        path: "src/shared/session-events.ts",
        lineIncludes: "export const SessionEventDataSchema",
      },
    ],
  },
  {
    id: "integration-tests",
    summaryPhrases: ["SessionRunner integration tests exercise execution"],
    evidence: [
      {
        path: "tests/integration/run-session.test.ts",
        lineIncludes: 'describe("SessionRunner"',
      },
    ],
  },
];

const architectureEvidenceSearches: SupportingSearchRequirement[] =
  architectureClaims.flatMap((requirement) =>
    requirement.evidence.map((evidence) => ({
      path: evidence.path,
      query: evidence.lineIncludes,
    })),
  );

const architectureDiscoverySchedule: ArchitectureDiscoverySchedule = {
  listArguments: {
    relativePath: ".",
    recursive: false,
    maxDepth: 1,
    maxItems: 200,
  },
  readArguments: { relativePath: "src/main/index.ts" },
};

const architectureRequiredToolSequence: CompletionObligationToolName[] = [
  "list_files",
  "read_text_file",
  ...architectureEvidenceSearches.map(
    (): CompletionObligationToolName => "search_text",
  ),
];

const cancellationClaims: ClaimCoverageRequirement[] = [
  {
    id: "renderer-to-preload",
    summaryPhrases: [
      "the renderer calls cancelSession through the preload bridge",
    ],
    evidence: [
      {
        path: "src/renderer/src/App.tsx",
        lineIncludes: "window.soar.cancelSession",
      },
      {
        path: "src/preload/index.ts",
        lineIncludes: "ipcRenderer.invoke(IPC_CHANNELS.cancelSession",
      },
    ],
  },
  {
    id: "ipc-to-runner",
    summaryPhrases: ["IPC dispatches cancelSession to SessionRunner"],
    evidence: [
      {
        path: "src/main/ipc.ts",
        lineIncludes: "ipcMain.handle(IPC_CHANNELS.cancelSession",
      },
      {
        path: "src/main/ipc.ts",
        lineIncludes: "runner.cancelSession(sessionId)",
      },
    ],
  },
  {
    id: "runner-abort",
    summaryPhrases: [
      "SessionRunner uses AbortController to abort the active session",
    ],
    evidence: [
      {
        path: "src/main/agent/run-session.ts",
        lineIncludes: "controller.abort()",
      },
    ],
  },
  {
    id: "provider-signal",
    summaryPhrases: [
      "the AbortController signal reaches the provider request",
    ],
    evidence: [
      {
        path: "src/main/agent/run-session.ts",
        lineIncludes: "signal: controller.signal",
      },
    ],
  },
  {
    id: "tool-signal",
    summaryPhrases: ["the AbortController signal reaches tool execution"],
    evidence: [
      {
        path: "src/main/agent/run-session.ts",
        lineIncludes: "this.runTool(sessionId, toolCall, controller.signal)",
      },
      {
        path: "src/main/agent/run-session.ts",
        lineIncludes:
          "executeToolCall(session.workspaceRoot, toolCall, signal)",
      },
    ],
  },
  {
    id: "cancellation-test",
    summaryPhrases: ["the integration test cancels active inference"],
    evidence: [
      {
        path: "tests/integration/run-session.test.ts",
        lineIncludes: "cancels an active inference once",
      },
    ],
  },
];

const cancellationEvidenceSearches: SupportingSearchRequirement[] =
  cancellationClaims.flatMap((requirement) =>
    requirement.evidence.map((evidence) => ({
      path: evidence.path,
      query: evidence.lineIncludes,
    })),
  );

const cancellationRequiredToolSequence: CompletionObligationToolName[] =
  cancellationEvidenceSearches.map(
    (): CompletionObligationToolName => "search_text",
  );

function cancellationObjective(): string {
  const schedule = cancellationEvidenceSearches.map(({ path, query }) => [
    query,
    path,
  ]);
  return (
    `Trace ${symbol} from UI/IPC through inference and tool signals to its tests. ` +
    `S=${JSON.stringify(schedule)}; execute exactly one search_text per S row in order with query=S[i][0], relativePath=S[i][1], caseSensitive=true, and bounded maxMatches. Do not call another tool or perform a broad search. ` +
    "Then explain the flow and cite only tool-verified relative path:line references." +
    claimCoverageInstruction(cancellationClaims)
  );
}

const symbolCallPathClaims: ClaimCoverageRequirement[] = [
  {
    id: "renderer-cancel",
    summaryPhrases: [
      "the renderer calls cancelSession through the preload bridge",
    ],
    evidence: [
      {
        path: "src/renderer/src/App.tsx",
        lineIncludes: "await window.soar.cancelSession(snapshot.id)",
      },
    ],
  },
  {
    id: "preload-bridge",
    summaryPhrases: ["the preload bridge invokes cancelSession over IPC"],
    evidence: [
      {
        path: "src/preload/index.ts",
        lineIncludes: "ipcRenderer.invoke(IPC_CHANNELS.cancelSession",
      },
    ],
  },
  {
    id: "ipc-dispatch",
    summaryPhrases: ["IPC dispatches cancelSession to SessionRunner"],
    evidence: [
      {
        path: "src/main/ipc.ts",
        lineIncludes: "ipcMain.handle(IPC_CHANNELS.cancelSession",
      },
      {
        path: "src/main/ipc.ts",
        lineIncludes: "runner.cancelSession(sessionId)",
      },
    ],
  },
  {
    id: "runner-abort",
    summaryPhrases: [
      "SessionRunner uses AbortController to abort the active session",
    ],
    evidence: [
      {
        path: "src/main/agent/run-session.ts",
        lineIncludes: "cancelSession(sessionId: string): void",
      },
      {
        path: "src/main/agent/run-session.ts",
        lineIncludes: "controller.abort()",
      },
    ],
  },
  {
    id: "signal-propagation",
    summaryPhrases: [
      "the AbortController signal reaches the provider request",
      "the AbortController signal reaches tool execution",
    ],
    evidence: [
      {
        path: "src/main/agent/run-session.ts",
        lineIncludes: "signal: controller.signal",
      },
      {
        path: "src/main/agent/run-session.ts",
        lineIncludes: "this.runTool(sessionId, toolCall, controller.signal)",
      },
      {
        path: "src/main/agent/run-session.ts",
        lineIncludes:
          "executeToolCall(session.workspaceRoot, toolCall, signal)",
      },
    ],
  },
  {
    id: "integration-test",
    summaryPhrases: ["the integration test cancels active inference"],
    evidence: [
      {
        path: "tests/integration/run-session.test.ts",
        lineIncludes: "cancels an active inference once",
      },
    ],
  },
];

const symbolCallPathProseRelationships = [
  "the renderer calls cancelSession through the preload bridge",
  "the preload bridge invokes cancelSession over IPC",
  "IPC dispatches cancelSession to SessionRunner",
  "SessionRunner uses AbortController to abort the active session",
  "the AbortController signal reaches the provider request",
  "the AbortController signal reaches tool execution",
] as const;

function requiredClaimCitationCount(
  requirements: readonly ClaimCoverageRequirement[],
): number {
  return requirements.reduce(
    (total, requirement) => total + requirement.evidence.length,
    0,
  );
}

function requiredClaimEvidencePaths(
  requirements: readonly ClaimCoverageRequirement[],
): string[] {
  return [
    ...new Set(
      requirements.flatMap((requirement) =>
        requirement.evidence.map((evidence) => evidence.path),
      ),
    ),
  ].sort();
}

function requiredSupportingSearches(
  requirements: readonly ClaimCoverageRequirement[],
): SupportingSearchRequirement[] {
  const seen = new Set<string>();
  return requirements
    .flatMap((requirement) => requirement.evidence)
    .filter((evidence) => !evidence.lineIncludes.includes(symbol))
    .flatMap((evidence) => {
      const key = `${evidence.path}\u0000${evidence.lineIncludes}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ path: evidence.path, query: evidence.lineIncludes }];
    })
    .sort((left, right) =>
      left.path === right.path
        ? left.query.localeCompare(right.query)
        : left.path.localeCompare(right.path),
    );
}

function claimCoverageInstruction(
  requirements: readonly ClaimCoverageRequirement[],
): string {
  const paths = requiredClaimEvidencePaths(requirements);
  const contract = requirements.map((requirement) => [
    requirement.id,
    requirement.summaryPhrases.length === 1
      ? requirement.summaryPhrases[0]
      : requirement.summaryPhrases,
    requirement.evidence.map((evidence) => [
      paths.indexOf(evidence.path),
      evidence.lineIncludes,
    ]),
  ]);
  return (
    ` P=${JSON.stringify(paths)};C=${JSON.stringify(contract)}; ` +
    "C=[id,exact summary phrase(s),[[P index,required line substring]]]. " +
    `Emit one ${claimCoverageMarker}{"claims":[...]} line: one object/C row, keys only id,summary,citations; summary has its phrase(s); one distinct verified path:line/evidence, cited line contains its substring, never reuse.`
  );
}

function architectureObjective(): string {
  const scheduledCalls = [
    `1. list_files(${JSON.stringify(architectureDiscoverySchedule.listArguments)})`,
    `2. read_text_file(${JSON.stringify(architectureDiscoverySchedule.readArguments)})`,
    ...architectureEvidenceSearches.map(
      ({ path: relativePath, query }, index) =>
        `${index + 3}. search_text(${JSON.stringify({
          query,
          relativePath,
          caseSensitive: true,
          maxMatches: 20,
        })})`,
    ),
  ];
  return (
    [
      "Summarize the Electron repository architecture: runtime entry, session execution, renderer, persistence/replay, shared event contract, and integration tests.",
      `Execute exactly these ${scheduledCalls.length} tool calls, one per round, in order; call no other tool:`,
      ...scheduledCalls,
      "Every call must succeed. The list, read, and searches must be complete/untruncated. Explain the architecture and cite only tool-verified relative path:line evidence.",
    ].join("\n") + claimCoverageInstruction(architectureClaims)
  );
}

function symbolClaimCoverageTemplate(): string {
  return `${claimCoverageMarker}{"claims":[{"id":"","summary":"","citations":[]}]}`;
}

function symbolAuditTemplate(): string {
  return `${symbolAuditMarker}{"query":"${symbol}","truncated":false,"occurrences":[]}`;
}

function symbolReferenceObjective(): string {
  const paths = requiredClaimEvidencePaths(symbolCallPathClaims);
  const supportingSearches = requiredSupportingSearches(symbolCallPathClaims);
  const claimPhrases = symbolCallPathClaims.map(
    (requirement) => requirement.summaryPhrases,
  );
  const claimEvidence = symbolCallPathClaims.map(
    (requirement) => requirement.evidence,
  );

  return [
    `Find case-sensitive ${JSON.stringify(symbol)} refs; trace UI-runtime. Calls 1-11 only:`,
    `1 search_text ${JSON.stringify(symbolGlobalSearchArguments)}`,
    `2-6 read_text_file, complete before 7: ${paths.map((path, index) => `${index + 2}=${JSON.stringify(path)}`).join(";")}`,
    `7-10 ordered search_text: relativePath=${JSON.stringify(paths[0])},caseSensitive=true,maxMatches=20; queries:`,
    ...supportingSearches
      .slice(0, 4)
      .map(
        (requirement, index) =>
          `${index + 7} ${JSON.stringify(requirement.query)}`,
      ),
    `11 search_text ${JSON.stringify({
      query: supportingSearches[4]?.query,
      relativePath: supportingSearches[4]?.path,
      caseSensitive: true,
      maxMatches: 20,
    })}`,
    "Searches complete. Claims:",
    "First 4: phrase + global-1 substring from cited read. Others: named search.",
    `renderer-cancel/R5: ${JSON.stringify(claimPhrases[0]?.[0])}; ${JSON.stringify(claimEvidence[0]?.[0]?.lineIncludes)}`,
    `preload-bridge/R4: ${JSON.stringify(claimPhrases[1]?.[0])}; ${JSON.stringify(claimEvidence[1]?.[0]?.lineIncludes)}`,
    `ipc-dispatch/R3: ${JSON.stringify(claimPhrases[2]?.[0])}; ${JSON.stringify(claimEvidence[2]?.[0]?.lineIncludes)}; ${JSON.stringify(claimEvidence[2]?.[1]?.lineIncludes)}`,
    `runner-abort/R2: ${JSON.stringify(claimPhrases[3]?.[0])}; ${JSON.stringify(claimEvidence[3]?.[0]?.lineIncludes)}; S7`,
    `signal-propagation: ${JSON.stringify(claimPhrases[4]?.[0])}; ${JSON.stringify(claimPhrases[4]?.[1])}; S9,10,8`,
    `integration-test: ${JSON.stringify(claimPhrases[5]?.[0])}; S11`,
    "Before records: >=120 prose chars; phrases verbatim/in order; distinct citation/substr; prose required.",
    "Finish with adjacent unfenced lines; no extra text/keys. Audit=all unique global-1 path:line strings lexicographically sorted, not search order:",
    symbolClaimCoverageTemplate(),
    symbolAuditTemplate(),
  ].join("\n");
}

const symbolRequiredToolSequence: CompletionObligationToolName[] = [
  "search_text",
  ...requiredClaimEvidencePaths(symbolCallPathClaims).map(
    (): CompletionObligationToolName => "read_text_file",
  ),
  ...requiredSupportingSearches(symbolCallPathClaims).map(
    (): CompletionObligationToolName => "search_text",
  ),
];

const tasks: ProofTask[] = [
  {
    id: "architecture",
    title: "Summarize repository architecture",
    objective: architectureObjective(),
    requiredTools: architectureRequiredToolSequence,
    minimumVerifiedPathLineCitations:
      requiredClaimCitationCount(architectureClaims),
    maximumProviderCalls: 10,
    maximumToolCalls: 9,
    claimCoverage: architectureClaims,
    orderedEvidenceSearches: architectureEvidenceSearches,
    architectureDiscoverySchedule,
  },
  {
    id: "cancellation",
    title: "Trace session cancellation",
    objective: cancellationObjective(),
    requiredTools: cancellationRequiredToolSequence,
    minimumVerifiedPathLineCitations:
      requiredClaimCitationCount(cancellationClaims),
    maximumProviderCalls: 11,
    maximumToolCalls: 9,
    claimCoverage: cancellationClaims,
    orderedEvidenceSearches: cancellationEvidenceSearches,
  },
  {
    id: "symbol-references",
    title: "Locate every symbol reference",
    objective: symbolReferenceObjective(),
    requiredTools: symbolRequiredToolSequence,
    minimumVerifiedPathLineCitations:
      requiredClaimCitationCount(symbolCallPathClaims),
    maximumProviderCalls: 13,
    maximumToolCalls: 11,
    claimCoverage: symbolCallPathClaims,
    requiresClaimEvidenceReads: true,
    requiresClaimEvidenceSearches: true,
    requiresCallPathProse: true,
    requiresExactSymbolAudit: true,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function hasExactArguments(
  value: unknown,
  expected: Readonly<Record<string, string | number | boolean>>,
): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, Object.keys(expected)) &&
    Object.entries(expected).every(
      ([key, expectedValue]) => value[key] === expectedValue,
    )
  );
}

function markerPayload(
  result: string,
  marker: string,
): { payload?: unknown; failures: string[] } {
  const lines = result
    .split(/\r\n|\r|\n/u)
    .filter((line) => line.startsWith(marker));
  if (lines.length !== 1) {
    return {
      failures: [
        `expected exactly one single-line ${marker} record; got ${lines.length}`,
      ],
    };
  }
  try {
    return {
      payload: JSON.parse((lines[0] ?? "").slice(marker.length)) as unknown,
      failures: [],
    };
  } catch (error) {
    return {
      failures: [
        `${marker} payload is not valid single-line JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
}

function finalRecordSuffixFailures(result: string): string[] {
  const lines = result.replace(/[\r\n]+$/u, "").split(/\r\n|\r|\n/u);
  const claimLine = lines.at(-2);
  const auditLine = lines.at(-1);
  const failures: string[] = [];
  if (
    claimLine?.startsWith(claimCoverageMarker) !== true ||
    auditLine?.startsWith(symbolAuditMarker) !== true
  ) {
    failures.push(
        `the final two adjacent lines must be ${claimCoverageMarker.slice(0, -1)} then ${symbolAuditMarker.slice(0, -1)}, with no trailing text`,
    );
  }

  let openFence: { character: "`" | "~"; length: number } | undefined;
  const markerIndexes = new Set([lines.length - 2, lines.length - 1]);
  for (const [index, line] of lines.entries()) {
    if (markerIndexes.has(index) && openFence !== undefined) {
      failures.push("the final claim and audit records must be outside Markdown fences");
      break;
    }
    const trimmed = line.trim();
    if (openFence === undefined) {
      const opening = /^[ \t]{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
      if (opening !== undefined) {
        openFence = {
          character: opening[0] as "`" | "~",
          length: opening.length,
        };
      }
      continue;
    }
    const activeFence = openFence;
    if (
      trimmed.length >= activeFence.length &&
      [...trimmed].every(
        (character) => character === activeFence.character,
      )
    ) {
      openFence = undefined;
    }
  }
  return failures;
}

function callPathProseFailures(result: string): string[] {
  const prose = result
    .split(/\r\n|\r|\n/u)
    .filter(
      (line) =>
        !line.startsWith(claimCoverageMarker) &&
        !line.startsWith(symbolAuditMarker),
    )
    .join("\n")
    .trim();
  const failures: string[] = [];
  if (prose.length < 120) {
    failures.push(
      "symbol call-path answer must include substantive prose outside evaluator records",
    );
  }
  const normalized = prose.toLowerCase();
  let relationshipCursor = 0;
  const missingOrOutOfOrderRelationships: string[] = [];
  for (const relationship of symbolCallPathProseRelationships) {
    const normalizedRelationship = relationship.toLowerCase();
    const relationshipIndex = normalized.indexOf(
      normalizedRelationship,
      relationshipCursor,
    );
    if (relationshipIndex === -1) {
      missingOrOutOfOrderRelationships.push(relationship);
      continue;
    }
    relationshipCursor = relationshipIndex + normalizedRelationship.length;
  }
  if (missingOrOutOfOrderRelationships.length > 0) {
    failures.push(
      "symbol call-path prose must state the evaluator-owned relationships in order; " +
        `missing or out of order: ${missingOrOutOfOrderRelationships.join("; ")}`,
    );
  }
  return failures;
}

function citationPath(citation: string): string | undefined {
  const separator = citation.lastIndexOf(":");
  if (separator <= 0 || !/^[1-9][0-9]*$/u.test(citation.slice(separator + 1))) {
    return undefined;
  }
  return citation.slice(0, separator);
}

function argumentsExcerptMatches(
  argumentsExcerpt: string,
  expected: Readonly<Record<string, string | number | boolean>>,
): boolean {
  try {
    return hasExactArguments(JSON.parse(argumentsExcerpt), expected);
  } catch {
    return false;
  }
}

function finalPacketRetentionAudit(options: {
  input: CapturedProviderInput;
  acceptedRound: number;
  expectedContextPacketSha256: string;
  expectedContextMessagesSha256: string;
  requirements: readonly ClaimCoverageRequirement[];
  verifiedAnswerCitations?: readonly string[];
  expectedSymbolOccurrences?: readonly string[];
  expectedSymbolSearchArguments?: Readonly<
    Record<string, string | number | boolean>
  >;
}): { audit: FinalPacketRetentionAudit; failures: string[] } {
  const packetJson = contextPacketJson(options.input.messages);
  const packet = JSON.parse(packetJson) as ContextPacket;
  const contextPacketSha256 = sha256Hex(packetJson);
  const contextMessagesSha256 = capturedMessagesSha256(
    options.input.messages,
  );
  const toolEvidence = packet.evidence.filter(
    (evidence): evidence is ToolEvidence =>
      evidence.kind === "tool_evidence" && evidence.status === "completed",
  );
  const toolSnippets = toolEvidence.flatMap(
    (evidence) => evidence.citationSnippets ?? [],
  );
  const requiredClaimEntries = options.requirements.flatMap((requirement) =>
    requirement.evidence.map((evidence, index) => ({
      key: `${requirement.id}\u0000${index}\u0000${evidence.path}\u0000${evidence.lineIncludes}`,
      path: evidence.path,
      lineIncludes: evidence.lineIncludes,
    })),
  );
  const claimCandidates = requiredClaimEntries.map((required) =>
    [
      ...new Set(
        toolSnippets.flatMap((snippet) =>
          citationPath(snippet.citation) === required.path &&
          snippet.text.includes(required.lineIncludes)
            ? [snippet.citation]
            : [],
        ),
      ),
    ].sort(),
  );
  const matchedRequirementByCitation = new Map<string, number>();
  const matchedClaimIndexes = new Set<number>();
  const matchClaim = (claimIndex: number, visited: Set<string>): boolean => {
    for (const citation of claimCandidates[claimIndex] ?? []) {
      if (visited.has(citation)) continue;
      visited.add(citation);
      const displaced = matchedRequirementByCitation.get(citation);
      if (displaced === undefined || matchClaim(displaced, visited)) {
        matchedRequirementByCitation.set(citation, claimIndex);
        matchedClaimIndexes.add(claimIndex);
        return true;
      }
    }
    return false;
  };
  for (const claimIndex of requiredClaimEntries.keys()) {
    matchClaim(claimIndex, new Set());
  }
  const retainedClaimKeys = [...matchedClaimIndexes]
    .sort((left, right) => left - right)
    .map((index) => requiredClaimEntries[index]?.key)
    .filter((key): key is string => key !== undefined);
  const toolCitations = new Set(
    toolSnippets.map((snippet) => snippet.citation),
  );
  const failures: string[] = [];
  const requiredVerifiedAnswerCitations = [
    ...new Set(options.verifiedAnswerCitations ?? []),
  ].sort();
  const retainedVerifiedAnswerCitations =
    requiredVerifiedAnswerCitations.filter((citation) =>
      toolCitations.has(citation),
    );
  const requiredSymbolOccurrences = [
    ...new Set(options.expectedSymbolOccurrences ?? []),
  ].sort();
  const expectedSymbolSearchArguments =
    options.expectedSymbolSearchArguments;
  let retainedSymbolOccurrences: string[];
  if (
    requiredSymbolOccurrences.length > 0 &&
    expectedSymbolSearchArguments !== undefined
  ) {
    const matchingSearchEvidence = toolEvidence.filter(
      (evidence) =>
        evidence.toolName === "search_text" &&
        evidence.workspaceRelativePath === "." &&
        argumentsExcerptMatches(
          evidence.argumentsExcerpt,
          expectedSymbolSearchArguments,
        ),
    );
    if (matchingSearchEvidence.length !== 1) {
      failures.push(
        `accepted provider input must retain exactly one completed global search envelope with the expected arguments; got ${matchingSearchEvidence.length}`,
      );
    }
    const globalSearchEvidence = matchingSearchEvidence[0];
    retainedSymbolOccurrences =
      globalSearchEvidence?.citationSnippets
        ?.map((snippet) => snippet.citation)
        .sort() ?? [];
    if (globalSearchEvidence !== undefined) {
      if (globalSearchEvidence.sourceResultTruncated !== false) {
        failures.push(
          "accepted provider input global search envelope must attest sourceResultTruncated=false",
        );
      }
      if (
        globalSearchEvidence.sourceResultCount !==
        requiredSymbolOccurrences.length
      ) {
        failures.push(
          `accepted provider input global search envelope declared ${globalSearchEvidence.sourceResultCount ?? "no"}/${requiredSymbolOccurrences.length} independent-oracle symbol occurrences`,
        );
      }
    }
    if (
      retainedSymbolOccurrences.length !== requiredSymbolOccurrences.length ||
      retainedSymbolOccurrences.some(
        (occurrence, index) =>
          occurrence !== requiredSymbolOccurrences[index],
      )
    ) {
      failures.push(
        `accepted provider input global search envelope retained ${retainedSymbolOccurrences.length}/${requiredSymbolOccurrences.length} exact independent-oracle symbol occurrences`,
      );
    }
  } else {
    retainedSymbolOccurrences = requiredSymbolOccurrences.filter(
      (occurrence) => toolCitations.has(occurrence),
    );
  }
  if (packet.schema !== "soar.context-packet.v1") {
    failures.push("accepted provider input did not contain the v1 canonical context packet");
  }
  if (contextPacketSha256 !== options.expectedContextPacketSha256) {
    failures.push("accepted provider input packet hash does not match its persisted context checkpoint");
  }
  if (contextMessagesSha256 !== options.expectedContextMessagesSha256) {
    failures.push("accepted provider input messages hash does not match its persisted context checkpoint");
  }
  if (retainedClaimKeys.length !== requiredClaimEntries.length) {
    failures.push(
      `accepted provider input retained ${retainedClaimKeys.length}/${requiredClaimEntries.length} evaluator-required claim evidence snippets`,
    );
  }
  if (
    retainedVerifiedAnswerCitations.length !==
    requiredVerifiedAnswerCitations.length
  ) {
    failures.push(
      `accepted provider input retained ${retainedVerifiedAnswerCitations.length}/${requiredVerifiedAnswerCitations.length} completion-guard-verified answer citations`,
    );
  }
  if (
    expectedSymbolSearchArguments === undefined &&
    retainedSymbolOccurrences.length !== requiredSymbolOccurrences.length
  ) {
    failures.push(
      `accepted provider input retained ${retainedSymbolOccurrences.length}/${requiredSymbolOccurrences.length} independent-oracle symbol occurrences`,
    );
  }

  return {
    audit: {
      acceptedRound: options.acceptedRound,
      packetMode: packet.mode,
      allowTools: options.input.allowTools,
      allowedToolNames:
        options.input.allowedToolNames === undefined
          ? null
          : [...options.input.allowedToolNames],
      requireToolCall: options.input.requireToolCall ?? false,
      toolEvidenceItems: toolEvidence.length,
      toolCitationSnippets: toolSnippets.length,
      requiredVerifiedAnswerCitations:
        requiredVerifiedAnswerCitations.length,
      retainedVerifiedAnswerCitations:
        retainedVerifiedAnswerCitations.length,
      requiredVerifiedAnswerCitationsSha256: hashSortedStrings(
        requiredVerifiedAnswerCitations,
      ),
      retainedVerifiedAnswerCitationsSha256: hashSortedStrings(
        retainedVerifiedAnswerCitations,
      ),
      requiredClaimEvidence: requiredClaimEntries.length,
      retainedClaimEvidence: retainedClaimKeys.length,
      requiredClaimEvidenceSha256: hashSortedStrings(
        requiredClaimEntries.map((entry) => entry.key),
      ),
      retainedClaimEvidenceSha256: hashSortedStrings(retainedClaimKeys),
      requiredSymbolOccurrences: requiredSymbolOccurrences.length,
      retainedSymbolOccurrences: retainedSymbolOccurrences.length,
      requiredSymbolOccurrencesSha256: hashSortedStrings(
        requiredSymbolOccurrences,
      ),
      retainedSymbolOccurrencesSha256: hashSortedStrings(
        retainedSymbolOccurrences,
      ),
      contextPacketSha256,
      contextMessagesSha256,
    },
    failures,
  };
}

async function claimCoverageFailures(options: {
  workspaceRoot: string;
  result: string;
  requirements: readonly ClaimCoverageRequirement[];
  verifiedCitations: readonly string[];
}): Promise<string[]> {
  const parsed = markerPayload(options.result, claimCoverageMarker);
  const failures = [...parsed.failures];
  if (!isRecord(parsed.payload) || !hasExactKeys(parsed.payload, ["claims"])) {
    if (parsed.failures.length === 0) {
      failures.push("claim coverage must be a strict object containing only claims");
    }
    return failures;
  }
  if (!Array.isArray(parsed.payload.claims)) {
    failures.push("claim coverage claims must be an array");
    return failures;
  }

  const claims = parsed.payload.claims;
  const requiredIds = options.requirements.map((requirement) => requirement.id);
  const observedIds = claims.map((claim) =>
    isRecord(claim) && typeof claim.id === "string" ? claim.id : "<invalid>",
  );
  if (
    observedIds.length !== requiredIds.length ||
    new Set(observedIds).size !== observedIds.length ||
    [...observedIds].sort().some(
      (id, index) => id !== [...requiredIds].sort()[index],
    )
  ) {
    failures.push(
      `claim coverage ids must equal ${requiredIds.join(", ")} exactly once; got ${observedIds.join(", ")}`,
    );
  }

  const verified = new Set(options.verifiedCitations);
  const coverageCitations: string[] = [];
  const fileLines = new Map<string, string[]>();
  const lineFor = async (citation: string): Promise<string | undefined> => {
    const relativePath = citationPath(citation);
    if (relativePath === undefined) return undefined;
    const separator = citation.lastIndexOf(":");
    const lineNumber = Number(citation.slice(separator + 1));
    let lines = fileLines.get(relativePath);
    if (lines === undefined) {
      try {
        const contents = await readFile(
          path.join(options.workspaceRoot, ...relativePath.split("/")),
          "utf8",
        );
        lines = contents.split(/\r\n|\r|\n/u);
        fileLines.set(relativePath, lines);
      } catch {
        return undefined;
      }
    }
    return lines[lineNumber - 1];
  };
  const usedEvidenceCitations = new Set<string>();
  for (const requirement of options.requirements) {
    const claim = claims.find(
      (candidate) => isRecord(candidate) && candidate.id === requirement.id,
    );
    if (!isRecord(claim)) continue;
    if (!hasExactKeys(claim, ["id", "summary", "citations"])) {
      failures.push(
        `${requirement.id}: claim object must contain only id, summary, and citations`,
      );
      continue;
    }
    if (typeof claim.summary !== "string" || claim.summary.trim().length < 12) {
      failures.push(`${requirement.id}: summary must be a substantive non-empty claim`);
    } else {
      const normalizedSummary = claim.summary.toLowerCase();
      const missingPhrases = requirement.summaryPhrases.filter(
        (phrase) => !normalizedSummary.includes(phrase.toLowerCase()),
      );
      if (missingPhrases.length > 0) {
        failures.push(
          `${requirement.id}: summary is missing required relational phrases ${missingPhrases.join("; ")}`,
        );
      }
    }
    if (
      !Array.isArray(claim.citations) ||
      claim.citations.length === 0 ||
      !claim.citations.every((citation) => typeof citation === "string")
    ) {
      failures.push(`${requirement.id}: citations must be a non-empty string array`);
      continue;
    }
    const citations = claim.citations as string[];
    if (citations.length < requirement.evidence.length) {
      failures.push(
        `${requirement.id}: expected at least ${requirement.evidence.length} evidence citations; got ${citations.length}`,
      );
    }
    if (new Set(citations).size !== citations.length) {
      failures.push(`${requirement.id}: citations contain duplicates`);
    }
    const allowedPaths = new Set(
      requirement.evidence.map((evidence) => evidence.path),
    );
    for (const citation of citations) {
      coverageCitations.push(citation);
      if (!verified.has(citation)) {
        failures.push(
          `${requirement.id}: citation was not verified by the completion guard: ${citation}`,
        );
      }
      const relativePath = citationPath(citation);
      if (relativePath === undefined || !allowedPaths.has(relativePath)) {
        failures.push(
          `${requirement.id}: citation is outside its exact evidence path set: ${citation}`,
        );
      }
    }
    for (const evidence of requirement.evidence) {
      let supportingCitation: string | undefined;
      for (const citation of citations) {
        if (
          usedEvidenceCitations.has(citation) ||
          citationPath(citation) !== evidence.path
        ) {
          continue;
        }
        const line = await lineFor(citation);
        if (line?.includes(evidence.lineIncludes)) {
          supportingCitation = citation;
          break;
        }
      }
      if (supportingCitation === undefined) {
        failures.push(
          `${requirement.id}: no distinct citation proves ${evidence.path} containing ${JSON.stringify(evidence.lineIncludes)}`,
        );
      } else {
        usedEvidenceCitations.add(supportingCitation);
      }
    }
  }
  if (new Set(coverageCitations).size !== coverageCitations.length) {
    failures.push("claim coverage must use a distinct citation for each supported claim");
  }
  return failures;
}

function symbolAuditFailures(options: {
  result: string;
  expectedOccurrences: readonly string[];
  verifiedCitations: readonly string[];
}): string[] {
  const parsed = markerPayload(options.result, symbolAuditMarker);
  const failures = [...parsed.failures];
  if (
    !isRecord(parsed.payload) ||
    !hasExactKeys(parsed.payload, ["query", "truncated", "occurrences"])
  ) {
    if (parsed.failures.length === 0) {
      failures.push(
        "symbol audit must be a strict object containing query, truncated, and occurrences",
      );
    }
    return failures;
  }
  if (parsed.payload.query !== symbol) {
    failures.push(`symbol audit query must be ${symbol}`);
  }
  if (parsed.payload.truncated !== false) {
    failures.push("symbol audit must report truncated=false for the complete fixture search");
  }
  if (
    !Array.isArray(parsed.payload.occurrences) ||
    !parsed.payload.occurrences.every(
      (occurrence) => typeof occurrence === "string",
    )
  ) {
    failures.push("symbol audit occurrences must be a string array");
    return failures;
  }
  const occurrences = parsed.payload.occurrences as string[];
  if (new Set(occurrences).size !== occurrences.length) {
    failures.push("symbol audit occurrences contain duplicates");
  }
  const expected = [...options.expectedOccurrences].sort();
  if (
    occurrences.length !== expected.length ||
    occurrences.some((occurrence, index) => occurrence !== expected[index])
  ) {
    failures.push(
      `symbol audit occurrences must exactly equal the sorted fixture set (${expected.length} entries)`,
    );
  }
  const verified = new Set(options.verifiedCitations);
  for (const occurrence of occurrences) {
    if (!verified.has(occurrence)) {
      failures.push(
        `symbol audit occurrence was not verified by the completion guard: ${occurrence}`,
      );
    }
  }
  return failures;
}

function successfulToolExecutions(
  events: readonly StoredSessionEvent[],
): SuccessfulToolExecution[] {
  const requests = new Map(
    events
      .filter(
        (event): event is ToolCallRequestedEvent =>
          event.type === "tool.call.requested",
      )
      .map((event) => [event.payload.toolCallId, event]),
  );
  return events
    .filter(
      (event): event is ToolCallCompletedEvent =>
        event.type === "tool.call.completed" && !event.payload.isError,
    )
    .flatMap((completion) => {
      const request = requests.get(completion.payload.toolCallId);
      return request === undefined ? [] : [{ request, completion }];
    });
}

function claimEvidenceByPath(
  requirements: readonly ClaimCoverageRequirement[],
): Map<string, Set<string>> {
  const evidenceByPath = new Map<string, Set<string>>();
  for (const requirement of requirements) {
    for (const evidence of requirement.evidence) {
      const snippets = evidenceByPath.get(evidence.path) ?? new Set<string>();
      snippets.add(evidence.lineIncludes);
      evidenceByPath.set(evidence.path, snippets);
    }
  }
  return evidenceByPath;
}

function qualifyingClaimEvidenceReads(
  executions: readonly SuccessfulToolExecution[],
  requiredPath: string,
  requiredSnippets: ReadonlySet<string>,
): SuccessfulToolExecution[] {
  return executions.filter((execution) => {
    if (
      execution.request.payload.name !== "read_text_file" ||
      execution.completion.payload.name !== "read_text_file" ||
      workspaceRelativePathForTool(
        execution.request.payload.name,
        execution.request.payload.arguments,
      ) !== requiredPath
    ) {
      return false;
    }
    const observation = parseSuccessfulRepositoryToolObservation(
      execution.request.payload.name,
      execution.request.payload.arguments,
      execution.completion.payload.content,
    );
    const observationText = observation?.text;
    return (
      observation?.truncated === false &&
      typeof observationText === "string" &&
      [...requiredSnippets].every((snippet) =>
        observationText.includes(snippet),
      )
    );
  });
}

function claimEvidenceReadFailures(
  executions: readonly SuccessfulToolExecution[],
  requirements: readonly ClaimCoverageRequirement[],
): string[] {
  const failures: string[] = [];
  const evidenceByPath = claimEvidenceByPath(requirements);

  for (const [requiredPath, requiredSnippets] of evidenceByPath) {
    if (
      qualifyingClaimEvidenceReads(
        executions,
        requiredPath,
        requiredSnippets,
      ).length === 0
    ) {
      failures.push(
        `no successful complete read_text_file observation for ${requiredPath} contained every required call-path evidence snippet`,
      );
    }
  }
  return failures;
}

function orderedClaimEvidenceReadFailures(
  executions: readonly SuccessfulToolExecution[],
  requirements: readonly ClaimCoverageRequirement[],
): string[] {
  const failures: string[] = [];
  const expectedPaths = requiredClaimEvidencePaths(requirements);
  const evidenceByPath = claimEvidenceByPath(requirements);
  const reads = executions.filter(
    (execution) =>
      execution.request.payload.name === "read_text_file" &&
      execution.completion.payload.name === "read_text_file",
  );
  if (reads.length !== expectedPaths.length) {
    failures.push(
      `expected exactly ${expectedPaths.length} successful evidence reads; got ${reads.length}`,
    );
  }

  for (const [index, expectedPath] of expectedPaths.entries()) {
    const execution = reads[index];
    if (execution === undefined) {
      failures.push(`missing evidence read ${index + 1} for ${expectedPath}`);
      continue;
    }
    const arguments_ = execution.request.payload.arguments;
    if (!hasExactArguments(arguments_, { relativePath: expectedPath })) {
      failures.push(
        `evidence read ${index + 1} must use exactly relativePath=${JSON.stringify(expectedPath)}`,
      );
      continue;
    }
    const requiredSnippets = evidenceByPath.get(expectedPath) ?? new Set();
    const observation = parseSuccessfulRepositoryToolObservation(
      execution.request.payload.name,
      arguments_,
      execution.completion.payload.content,
    );
    const observationText = observation?.text;
    if (
      observation?.truncated !== false ||
      typeof observationText !== "string" ||
      ![...requiredSnippets].every((snippet) =>
        observationText.includes(snippet),
      )
    ) {
      failures.push(
        `evidence read ${index + 1} must be complete and contain every required string for ${expectedPath}`,
      );
    }
  }
  return failures;
}

function claimEvidenceSupportingSearchFailures(
  executions: readonly SuccessfulToolExecution[],
  requirements: readonly ClaimCoverageRequirement[],
): string[] {
  const failures: string[] = [];
  const requiredSearches = requiredSupportingSearches(requirements);
  const readCompletionSequences = [
    ...claimEvidenceByPath(requirements),
  ].flatMap(([requiredPath, requiredSnippets]) => {
    const sequences = qualifyingClaimEvidenceReads(
      executions,
      requiredPath,
      requiredSnippets,
    ).map((execution) => execution.completion.sequence);
    return sequences.length === 0 ? [] : [Math.max(...sequences)];
  });
  const requiredReadCount = requiredClaimEvidencePaths(requirements).length;
  if (readCompletionSequences.length !== requiredReadCount) {
    return [
      "supporting evidence searches require a successful complete read of every required evidence file first",
    ];
  }
  const latestRequiredReadSequence = Math.max(...readCompletionSequences);

  for (const requiredSearch of requiredSearches) {
    const matchingRequests = executions.filter((execution) => {
      const arguments_ = execution.request.payload.arguments;
      return (
        execution.request.payload.name === "search_text" &&
        execution.completion.payload.name === "search_text" &&
        hasExactArguments(arguments_, {
          query: requiredSearch.query,
          relativePath: requiredSearch.path,
          caseSensitive: true,
          maxMatches: 20,
        })
      );
    });
    const qualifyingSearches = matchingRequests.filter((execution) => {
      const observation = parseSuccessfulRepositoryToolObservation(
        execution.request.payload.name,
        execution.request.payload.arguments,
        execution.completion.payload.content,
      );
      return (
        observation?.truncated === false &&
        Array.isArray(observation.matches) &&
        observation.matches.some(
          (match) =>
            isRecord(match) &&
            match.path === requiredSearch.path &&
            typeof match.text === "string" &&
            match.text.includes(requiredSearch.query),
        )
      );
    });
    if (
      matchingRequests.length !== 1 ||
      qualifyingSearches.length !== 1 ||
      (qualifyingSearches[0]?.completion.sequence ?? 0) <=
        latestRequiredReadSequence
    ) {
      failures.push(
        `expected exactly one successful untruncated post-read search_text observation for ${requiredSearch.path} containing ${JSON.stringify(requiredSearch.query)}`,
      );
    }
  }

  const orderedPostReadSearches = executions
    .filter(
      (execution) =>
        execution.request.payload.name === "search_text" &&
        execution.completion.payload.name === "search_text" &&
        execution.completion.sequence > latestRequiredReadSequence,
    )
    .sort(
      (left, right) => left.completion.sequence - right.completion.sequence,
    );
  failures.push(
    ...orderedEvidenceSearchFailures(
      orderedPostReadSearches,
      requiredSearches,
      { requireExactSupportArguments: true },
    ).map((failure) => `supporting search order: ${failure}`),
  );
  return failures;
}

function architectureDiscoveryScheduleFailures(
  executions: readonly SuccessfulToolExecution[],
  schedule: ArchitectureDiscoverySchedule,
  evidenceSearches: readonly SupportingSearchRequirement[],
): string[] {
  const failures: string[] = [];
  const expectedToolSequence: CompletionObligationToolName[] = [
    "list_files",
    "read_text_file",
    ...evidenceSearches.map(
      (): CompletionObligationToolName => "search_text",
    ),
  ];
  const observedToolSequence = executions.map(
    (execution) => execution.completion.payload.name,
  );
  if (
    observedToolSequence.length !== expectedToolSequence.length ||
    observedToolSequence.some(
      (toolName, index) => toolName !== expectedToolSequence[index],
    )
  ) {
    failures.push(
      `architecture discovery must contain exactly the successful ordered tool sequence ${expectedToolSequence.join(" -> ")}; got ${observedToolSequence.join(" -> ")}`,
    );
  }

  const listExecutions = executions.filter(
    (execution) =>
      execution.request.payload.name === "list_files" &&
      execution.completion.payload.name === "list_files",
  );
  if (
    listExecutions.length !== 1 ||
    !hasExactArguments(
      listExecutions[0]?.request.payload.arguments,
      schedule.listArguments,
    ) ||
    parseSuccessfulRepositoryToolObservation(
      "list_files",
      listExecutions[0]?.request.payload.arguments ?? {},
      listExecutions[0]?.completion.payload.content,
    )?.truncated !== false
  ) {
    failures.push(
      `architecture discovery must contain exactly one successful complete list_files call with arguments ${JSON.stringify(schedule.listArguments)}`,
    );
  }

  const readExecutions = executions.filter(
    (execution) =>
      execution.request.payload.name === "read_text_file" &&
      execution.completion.payload.name === "read_text_file",
  );
  const readObservation = parseSuccessfulRepositoryToolObservation(
    "read_text_file",
    readExecutions[0]?.request.payload.arguments ?? {},
    readExecutions[0]?.completion.payload.content,
  );
  if (
    readExecutions.length !== 1 ||
    !hasExactArguments(
      readExecutions[0]?.request.payload.arguments,
      schedule.readArguments,
    ) ||
    readObservation?.truncated !== false ||
    typeof readObservation.text !== "string" ||
    !readObservation.text.includes("app.whenReady().then(bootstrap)")
  ) {
    failures.push(
      `architecture discovery must contain exactly one successful complete read_text_file call with arguments ${JSON.stringify(schedule.readArguments)} and the desktop-entry evidence`,
    );
  }

  failures.push(
    ...orderedEvidenceSearchFailures(executions, evidenceSearches, {
      requireExactSupportArguments: true,
    }).map((failure) => `architecture evidence schedule: ${failure}`),
  );
  return failures;
}

function orderedEvidenceSearchFailures(
  executions: readonly SuccessfulToolExecution[],
  requirements: readonly SupportingSearchRequirement[],
  options: { requireExactSupportArguments?: boolean } = {},
): string[] {
  const failures: string[] = [];
  const successfulSearches = executions.filter(
    (execution) =>
      execution.request.payload.name === "search_text" &&
      execution.completion.payload.name === "search_text",
  );
  if (successfulSearches.length !== requirements.length) {
    failures.push(
      `expected exactly ${requirements.length} successful evidence searches; got ${successfulSearches.length}`,
    );
  }

  for (const [index, requirement] of requirements.entries()) {
    const execution = successfulSearches[index];
    if (execution === undefined) {
      failures.push(
        `missing evidence search ${index + 1} for ${requirement.path} containing ${JSON.stringify(requirement.query)}`,
      );
      continue;
    }
    const arguments_ = execution.request.payload.arguments;
    const hasExpectedRequest =
      execution.request.payload.name === "search_text" &&
      execution.completion.payload.name === "search_text" &&
      (options.requireExactSupportArguments === true
        ? hasExactArguments(arguments_, {
            query: requirement.query,
            relativePath: requirement.path,
            caseSensitive: true,
            maxMatches: 20,
          })
        : isRecord(arguments_) &&
          arguments_.query === requirement.query &&
          arguments_.relativePath === requirement.path &&
          arguments_.caseSensitive === true);
    if (!hasExpectedRequest) {
      failures.push(
        options.requireExactSupportArguments === true
          ? `evidence search ${index + 1} must use exactly query, relativePath, caseSensitive=true, and maxMatches=20 for ${requirement.path} containing ${JSON.stringify(requirement.query)}`
          : `evidence search ${index + 1} must be a case-sensitive search_text call for ${requirement.path} containing ${JSON.stringify(requirement.query)}`,
      );
      continue;
    }
    const observation = parseSuccessfulRepositoryToolObservation(
      execution.request.payload.name,
      arguments_,
      execution.completion.payload.content,
    );
    if (
      observation?.truncated !== false ||
      !Array.isArray(observation.matches) ||
      !observation.matches.some(
        (match) =>
          isRecord(match) &&
          match.path === requirement.path &&
          typeof match.text === "string" &&
          match.text.includes(requirement.query),
      )
    ) {
      failures.push(
        `evidence search ${index + 1} did not return an untruncated matching line for ${requirement.path} containing ${JSON.stringify(requirement.query)}`,
      );
    }
  }

  return failures;
}

function completeSymbolSearchFailures(
  executions: readonly SuccessfulToolExecution[],
  expectedOccurrences: readonly string[],
): string[] {
  const failures: string[] = [];
  const symbolSearches = executions.filter((execution) => {
    const arguments_ = execution.request.payload.arguments;
    return (
      execution.request.payload.name === "search_text" &&
      execution.completion.payload.name === "search_text" &&
      isRecord(arguments_) &&
      arguments_.query === symbol
    );
  });
  if (symbolSearches.length !== 1) {
    failures.push(
      `expected exactly one successful global ${symbol} search_text call; got ${symbolSearches.length}`,
    );
  }

  const exactGlobalSearches = symbolSearches.filter((execution) =>
    hasExactArguments(execution.request.payload.arguments, {
      query: symbol,
      relativePath: ".",
      caseSensitive: true,
      maxMatches: 500,
      maxDepth: 20,
    }),
  );
  if (exactGlobalSearches.length !== 1) {
    failures.push(
      `the global ${symbol} search must use exactly query, relativePath=".", caseSensitive=true, maxMatches=500, and maxDepth=20`,
    );
  }
  if (symbolSearches.length !== 1 || exactGlobalSearches.length !== 1) {
    return failures;
  }

  const expected = [...expectedOccurrences].sort();
  const qualifying = exactGlobalSearches.some((execution) => {
    let output: unknown;
    try {
      output = JSON.parse(execution.completion.payload.content) as unknown;
    } catch {
      return false;
    }
    if (
      !isRecord(output) ||
      output.ok !== true ||
      output.truncated !== false ||
      !Array.isArray(output.matches) ||
      output.count !== output.matches.length ||
      !isRecord(output.skipped) ||
      output.skipped.tooLarge !== 0 ||
      output.skipped.unreadable !== 0
    ) {
      return false;
    }
    const occurrences = output.matches.map((match) =>
      isRecord(match) &&
      typeof match.path === "string" &&
      Number.isSafeInteger(match.lineNumber)
        ? `${match.path}:${String(match.lineNumber)}`
        : "<invalid>",
    );
    return (
      new Set(occurrences).size === occurrences.length &&
      occurrences.length === expected.length &&
      [...occurrences]
        .sort()
        .every((occurrence, index) => occurrence === expected[index])
    );
  });
  if (!qualifying) {
    failures.push(
      "no successful exact-symbol search returned the complete, untruncated fixture occurrence set without unreadable or oversized files",
    );
  }
  return failures;
}

function citationsIn(result: string): Set<string> {
  const citations = new Set<string>();
  for (const match of result.matchAll(citationPattern)) {
    citations.add(`${match[2]}:${match[3]}`);
  }
  return citations;
}

function recordFailure(
  failures: string[],
  condition: boolean,
  message: string,
): void {
  if (!condition) failures.push(message);
}

function followsOrderedToolSequence(
  observed: readonly string[],
  required: readonly CompletionObligationToolName[],
): boolean {
  let requiredIndex = 0;
  for (const toolName of observed) {
    if (toolName === required[requiredIndex]) requiredIndex += 1;
    if (requiredIndex === required.length) return true;
  }
  return required.length === 0;
}

function toolErrorCode(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as { error?: { code?: unknown } };
    return typeof parsed.error?.code === "string"
      ? parsed.error.code
      : undefined;
  } catch {
    return undefined;
  }
}

async function citationFailures(
  workspaceRoot: string,
  citations: Set<string>,
): Promise<string[]> {
  const failures: string[] = [];
  for (const citation of citations) {
    const separator = citation.lastIndexOf(":");
    const relativePath = citation.slice(0, separator);
    const lineNumber = Number(citation.slice(separator + 1));
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    const resolvedRelative = path.relative(workspaceRoot, absolutePath);
    const insideWorkspace =
      resolvedRelative !== "" &&
      !resolvedRelative.startsWith(`..${path.sep}`) &&
      resolvedRelative !== ".." &&
      !path.isAbsolute(resolvedRelative);
    recordFailure(
      failures,
      insideWorkspace,
      `citation remains inside the workspace: ${citation}`,
    );
    if (!insideWorkspace) continue;

    let contents: string;
    try {
      contents = await readFile(absolutePath, "utf8");
    } catch {
      failures.push(`citation path exists: ${citation}`);
      continue;
    }
    const lineCount = contents.split(/\r\n|\n|\r/u).length;
    recordFailure(
      failures,
      Number.isSafeInteger(lineNumber) && lineNumber >= 1 && lineNumber <= lineCount,
      `citation resolves to a real line: ${citation}`,
    );
  }
  return failures;
}

describe("Local Repository Investigator evaluator contract", () => {
  it("attests the configured API base and advertised model without exposing endpoint secrets", () => {
    const responseText = JSON.stringify({
      object: "list",
      data: [
        {
          id: proofModel,
          owned_by: "vllm",
          max_model_len: 16_384,
          root: "/private/models/RM-01",
        },
      ],
    });
    const attestation = endpointAttestationFromModelsResponse({
      baseUrl: "http://endpoint-secret@127.0.0.1:58000/v1",
      expectedModel: proofModel,
      responseText,
    });
    const serialized = JSON.stringify(attestation);

    expect(attestation).toMatchObject({
      apiBaseSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      modelsResponseSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      advertisedModelCount: 1,
      model: {
        id: proofModel,
        ownedBy: "vllm",
        maxModelLen: 16_384,
      },
    });
    expect(serialized).not.toContain("endpoint-secret");
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("/private/models/RM-01");
  });

  it("redacts machine-local roots from attachable proof data", () => {
    const privateRepositoryRoot = "/Users/contributor/projects/SOAR";
    const privateFixtureRoot = "/private/tmp/soar-proof-123";
    const redacted = redactProofArtifactPaths(
      {
        record: {
          workspaceRoot: `${privateFixtureRoot}/workspace`,
        },
        events: [
          {
            type: "session.created",
            payload: { workspaceRoot: `${privateFixtureRoot}/workspace` },
          },
        ],
        diagnostic: `failed while reading ${privateRepositoryRoot}/package.json`,
      },
      [
        {
          source: privateFixtureRoot,
          replacement: "<isolated-fixture-root>",
        },
        {
          source: privateRepositoryRoot,
          replacement: "<repository-root>",
        },
      ],
    );
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain(privateFixtureRoot);
    expect(serialized).not.toContain(privateRepositoryRoot);
    expect(serialized).toContain("<isolated-fixture-root>/workspace");
    expect(serialized).toContain("<repository-root>/package.json");

    const failedSetupPath = path.join(
      tmpdir(),
      "soar-repository-proof-unassigned",
      "fixture.tar",
    );
    const failedSetup = JSON.stringify(
      redactProofArtifactPaths(
        { error: `git archive failed for --output=${failedSetupPath}` },
        proofArtifactRedactions(),
      ),
    );
    expect(failedSetup).not.toContain(tmpdir());
    expect(failedSetup).toContain(
      "<temporary-root>/soar-repository-proof-unassigned/fixture.tar",
    );
  });

  it("keeps guided objectives explicit within the shared proof-envelope budget", () => {
    const task = tasks.find((candidate) => candidate.id === "symbol-references");
    const cancellationTask = tasks.find(
      (candidate) => candidate.id === "cancellation",
    );
    if (task?.claimCoverage === undefined) {
      throw new Error("symbol-references task must define claim coverage");
    }
    if (cancellationTask === undefined) {
      throw new Error("cancellation task must be defined");
    }
    const requiredReadPaths = requiredClaimEvidencePaths(task.claimCoverage);
    const supportingSearches = requiredSupportingSearches(task.claimCoverage);
    expect(requiredReadPaths).toHaveLength(5);
    expect(supportingSearches).toHaveLength(5);
    expect(supportingSearches).toEqual([
      {
        path: "src/main/agent/run-session.ts",
        query: "controller.abort()",
      },
      {
        path: "src/main/agent/run-session.ts",
        query: "executeToolCall(session.workspaceRoot, toolCall, signal)",
      },
      {
        path: "src/main/agent/run-session.ts",
        query: "signal: controller.signal",
      },
      {
        path: "src/main/agent/run-session.ts",
        query: "this.runTool(sessionId, toolCall, controller.signal)",
      },
      {
        path: "tests/integration/run-session.test.ts",
        query: "cancels an active inference once",
      },
    ]);
    expect(task.maximumToolCalls).toBe(
      1 + requiredReadPaths.length + supportingSearches.length,
    );
    expect(task.maximumProviderCalls).toBeGreaterThanOrEqual(
      task.maximumToolCalls + 1,
    );
    expect(task.maximumProviderCalls).toBe(13);
    expect(task.requiredTools).toEqual(symbolRequiredToolSequence);
    expect(task.requiredTools).toHaveLength(task.maximumToolCalls);
    expect(
      followsOrderedToolSequence(
        [
          "search_text",
          "read_text_file",
          "read_text_file",
          "read_text_file",
          "read_text_file",
          "read_text_file",
          "search_text",
          "search_text",
          "search_text",
          "search_text",
          "search_text",
        ],
        task.requiredTools,
      ),
    ).toBe(true);
    expect(
      followsOrderedToolSequence(
        ["search_text", "read_text_file", "search_text"],
        task.requiredTools,
      ),
    ).toBe(false);
    expect(
      tasks.reduce((total, candidate) => total + candidate.maximumProviderCalls, 0),
    ).toBe(34);
    expect(
      tasks.reduce((total, candidate) => total + candidate.maximumToolCalls, 0),
    ).toBe(29);
    expect(
      tasks.reduce((total, candidate) => total + candidate.maximumProviderCalls, 0) *
        proofContextPolicy.maxInputTokens,
    ).toBe(557_056);
    expect(proofObjectiveMaxUtf8Bytes).toBe(2_800);
    for (const boundedTask of [cancellationTask, task]) {
      expect(
        new TextEncoder().encode(boundedTask.objective).length,
        `${boundedTask.id} objective UTF-8 bytes`,
      ).toBeLessThanOrEqual(proofObjectiveMaxUtf8Bytes);
    }
    expect(
      new TextEncoder().encode(task.objective).length,
      "symbol-references objective UTF-8 bytes",
    ).toBeLessThanOrEqual(symbolObjectiveMaxUtf8Bytes);

    const objectiveSupportingSearchPairs = supportingSearches.map(
      ({ path: relativePath, query }) => ({ query, relativePath }),
    );
    expect(objectiveSupportingSearchPairs).toEqual([
      {
        query: "controller.abort()",
        relativePath: "src/main/agent/run-session.ts",
      },
      {
        query: "executeToolCall(session.workspaceRoot, toolCall, signal)",
        relativePath: "src/main/agent/run-session.ts",
      },
      {
        query: "signal: controller.signal",
        relativePath: "src/main/agent/run-session.ts",
      },
      {
        query: "this.runTool(sessionId, toolCall, controller.signal)",
        relativePath: "src/main/agent/run-session.ts",
      },
      {
        query: "cancels an active inference once",
        relativePath: "tests/integration/run-session.test.ts",
      },
    ]);
    const objectiveLines = task.objective.split("\n");
    expect(objectiveLines).toContain(
      `1 search_text ${JSON.stringify(symbolGlobalSearchArguments)}`,
    );
    expect(objectiveLines).toContain(
      `2-6 read_text_file, complete before 7: ${requiredReadPaths.map((path, index) => `${index + 2}=${JSON.stringify(path)}`).join(";")}`,
    );
    expect(objectiveLines).toContain(
      "First 4: phrase + global-1 substring from cited read. Others: named search.",
    );
    expect(
      new Set(
        objectiveSupportingSearchPairs
          .slice(0, 4)
          .map((pair) => pair.relativePath),
      ),
    ).toEqual(new Set(["src/main/agent/run-session.ts"]));
    expect(objectiveLines).toContain(
      '7-10 ordered search_text: relativePath="src/main/agent/run-session.ts",caseSensitive=true,maxMatches=20; queries:',
    );
    const supportingQueryInstructions = objectiveSupportingSearchPairs
      .slice(0, 4)
      .map((pair, index) => `${index + 7} ${JSON.stringify(pair.query)}`);
    let previousQueryIndex = -1;
    for (const instruction of supportingQueryInstructions) {
      expect(
        objectiveLines.filter((line) => line === instruction),
      ).toHaveLength(1);
      const instructionIndex = objectiveLines.indexOf(instruction);
      expect(instructionIndex).toBeGreaterThan(previousQueryIndex);
      previousQueryIndex = instructionIndex;
    }
    expect(objectiveLines).toContain(
      `11 search_text ${JSON.stringify({
        query: objectiveSupportingSearchPairs[4]?.query,
        relativePath: objectiveSupportingSearchPairs[4]?.relativePath,
        caseSensitive: true,
        maxMatches: 20,
      })}`,
    );
    expect(objectiveLines).toEqual(
      expect.arrayContaining([
        `renderer-cancel/R5: ${JSON.stringify(symbolCallPathClaims[0]?.summaryPhrases[0])}; ${JSON.stringify(symbolCallPathClaims[0]?.evidence[0]?.lineIncludes)}`,
        `preload-bridge/R4: ${JSON.stringify(symbolCallPathClaims[1]?.summaryPhrases[0])}; ${JSON.stringify(symbolCallPathClaims[1]?.evidence[0]?.lineIncludes)}`,
        `ipc-dispatch/R3: ${JSON.stringify(symbolCallPathClaims[2]?.summaryPhrases[0])}; ${JSON.stringify(symbolCallPathClaims[2]?.evidence[0]?.lineIncludes)}; ${JSON.stringify(symbolCallPathClaims[2]?.evidence[1]?.lineIncludes)}`,
        `runner-abort/R2: ${JSON.stringify(symbolCallPathClaims[3]?.summaryPhrases[0])}; ${JSON.stringify(symbolCallPathClaims[3]?.evidence[0]?.lineIncludes)}; S7`,
        `signal-propagation: ${JSON.stringify(symbolCallPathClaims[4]?.summaryPhrases[0])}; ${JSON.stringify(symbolCallPathClaims[4]?.summaryPhrases[1])}; S9,10,8`,
        `integration-test: ${JSON.stringify(symbolCallPathClaims[5]?.summaryPhrases[0])}; S11`,
      ]),
    );
    expect(task.objective).not.toContain("undefined");
    expect(task.objective).not.toContain("P#[S#]");
    expect(task.objective).not.toContain("S1..");
    expect(task.objective).not.toContain("E(e)");
    expect(task.objective).not.toContain("X/Y");
    expect(task.objective).not.toMatch(/\b\d+\/\d+:/u);
    for (const requirement of symbolCallPathClaims.slice(0, 4)) {
      for (const evidence of requirement.evidence) {
        expect(task.objective.split(evidence.lineIncludes)).toHaveLength(2);
      }
    }

    expect(
      objectiveLines.filter((line) => line.startsWith(claimCoverageMarker)),
    ).toEqual([symbolClaimCoverageTemplate()]);
    expect(
      objectiveLines.filter((line) => line.startsWith(symbolAuditMarker)),
    ).toEqual([symbolAuditTemplate()]);
    expect(task.objective.split(claimCoverageMarker)).toHaveLength(2);
    expect(task.objective.split(symbolAuditMarker)).toHaveLength(2);
    expect(objectiveLines.slice(-2)).toEqual([
      symbolClaimCoverageTemplate(),
      symbolAuditTemplate(),
    ]);
    expect(objectiveLines).toContain(
      "Before records: >=120 prose chars; phrases verbatim/in order; distinct citation/substr; prose required.",
    );
    expect(objectiveLines).toContain(
      "Finish with adjacent unfenced lines; no extra text/keys. Audit=all unique global-1 path:line strings lexicographically sorted, not search order:",
    );
    expect(task.objective).toContain("no extra text/keys");
  });

  it("pins architecture to one bounded list, one entry read, and seven exact evidence searches", () => {
    const task = tasks.find((candidate) => candidate.id === "architecture");
    if (
      task?.architectureDiscoverySchedule === undefined ||
      task.orderedEvidenceSearches === undefined
    ) {
      throw new Error("architecture task must define its discovery schedule");
    }
    expect(task.architectureDiscoverySchedule).toEqual(
      architectureDiscoverySchedule,
    );
    expect(task.orderedEvidenceSearches).toEqual(
      architectureClaims.flatMap((requirement) =>
        requirement.evidence.map((evidence) => ({
          path: evidence.path,
          query: evidence.lineIncludes,
        })),
      ),
    );
    expect(task.orderedEvidenceSearches).toHaveLength(7);
    expect(task.requiredTools).toEqual(architectureRequiredToolSequence);
    expect(task.requiredTools).toEqual([
      "list_files",
      "read_text_file",
      ...Array.from({ length: 7 }, () => "search_text" as const),
    ]);
    expect(task.requiredTools).toHaveLength(9);
    expect(task.maximumToolCalls).toBe(9);
    expect(task.maximumProviderCalls).toBe(10);
    expect(new TextEncoder().encode(task.objective).length).toBeLessThanOrEqual(
      proofObjectiveMaxUtf8Bytes,
    );

    const objectiveLines = task.objective.split("\n");
    expect(objectiveLines).toContain(
      `1. list_files(${JSON.stringify(architectureDiscoverySchedule.listArguments)})`,
    );
    expect(objectiveLines).toContain(
      `2. read_text_file(${JSON.stringify(architectureDiscoverySchedule.readArguments)})`,
    );
    for (const [index, requirement] of architectureEvidenceSearches.entries()) {
      expect(objectiveLines).toContain(
        `${index + 3}. search_text(${JSON.stringify({
          query: requirement.query,
          relativePath: requirement.path,
          caseSensitive: true,
          maxMatches: 20,
        })})`,
      );
    }
    expect(task.objective).toContain(
      "Execute exactly these 9 tool calls, one per round, in order; call no other tool",
    );

    const makeExecution = (
      id: string,
      name: CompletionObligationToolName,
      arguments_: Record<string, string | number | boolean>,
      content: string,
      sequence: number,
    ): SuccessfulToolExecution => ({
      request: {
        id: `request-${id}`,
        sessionId: "architecture-contract",
        sequence: sequence * 2 - 1,
        createdAt: "2026-08-29T00:00:00.000Z",
        type: "tool.call.requested",
        payload: {
          toolCallId: id,
          name,
          arguments: arguments_,
          messageId: "message",
        },
      },
      completion: {
        id: `completion-${id}`,
        sessionId: "architecture-contract",
        sequence: sequence * 2,
        createdAt: "2026-08-29T00:00:01.000Z",
        type: "tool.call.completed",
        payload: {
          toolCallId: id,
          name,
          content,
          isError: false,
        },
      },
    });
    const indexText = "app.whenReady().then(bootstrap);\n";
    const exactExecutions: SuccessfulToolExecution[] = [
      makeExecution(
        "list",
        "list_files",
        { ...architectureDiscoverySchedule.listArguments },
        JSON.stringify({
          ok: true,
          entries: [{ path: "src", type: "directory" }],
          count: 1,
          skipped: { ignored: 0, unreadable: 0 },
          truncated: false,
          outputBytes: 1,
        }),
        1,
      ),
      makeExecution(
        "read",
        "read_text_file",
        { ...architectureDiscoverySchedule.readArguments },
        JSON.stringify({
          ok: true,
          text: indexText,
          bytes: new TextEncoder().encode(indexText).length,
          truncated: false,
        }),
        2,
      ),
      ...architectureEvidenceSearches.map((requirement, index) =>
        makeExecution(
          `search-${index}`,
          "search_text",
          {
            query: requirement.query,
            relativePath: requirement.path,
            caseSensitive: true,
            maxMatches: 20,
          },
          JSON.stringify({
            ok: true,
            truncated: false,
            count: 1,
            matches: [
              {
                path: requirement.path,
                lineNumber: 1,
                text: requirement.query,
                textTruncated: false,
              },
            ],
            filesSearched: 1,
            bytesScanned: new TextEncoder().encode(requirement.query).length,
            skipped: {
              binary: 0,
              ignored: 0,
              symlink: 0,
              tooLarge: 0,
              unreadable: 0,
            },
            outputBytes: 1,
          }),
          index + 3,
        ),
      ),
    ];
    expect(
      architectureDiscoveryScheduleFailures(
        exactExecutions,
        task.architectureDiscoverySchedule,
        task.orderedEvidenceSearches,
      ),
    ).toEqual([]);
    expect(
      orderedEvidenceSearchFailures(
        exactExecutions,
        task.orderedEvidenceSearches,
        { requireExactSupportArguments: true },
      ),
    ).toEqual([]);

    const extraSearchArgument = structuredClone(exactExecutions);
    const firstArchitectureSearch = architectureEvidenceSearches[0]!;
    extraSearchArgument[2]!.request.payload.arguments = {
      query: firstArchitectureSearch.query,
      relativePath: firstArchitectureSearch.path,
      caseSensitive: true,
      maxMatches: 20,
      maxDepth: 12,
    };
    expect(
      architectureDiscoveryScheduleFailures(
        extraSearchArgument,
        task.architectureDiscoverySchedule,
        task.orderedEvidenceSearches,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must use exactly query, relativePath"),
      ]),
    );

    const duplicateRead = [
      ...exactExecutions.slice(0, 2),
      exactExecutions[1]!,
      ...exactExecutions.slice(2),
    ];
    expect(
      architectureDiscoveryScheduleFailures(
        duplicateRead,
        task.architectureDiscoverySchedule,
        task.orderedEvidenceSearches,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("exactly the successful ordered tool sequence"),
        expect.stringContaining("exactly one successful complete read_text_file"),
      ]),
    );
  });

  it("pins cancellation to one ordered exact search per evaluator evidence row", () => {
    const task = tasks.find((candidate) => candidate.id === "cancellation");
    expect(task?.orderedEvidenceSearches).toEqual(
      cancellationClaims.flatMap((requirement) =>
        requirement.evidence.map((evidence) => ({
          path: evidence.path,
          query: evidence.lineIncludes,
        })),
      ),
    );
    expect(task?.orderedEvidenceSearches).toHaveLength(9);
    expect(task?.requiredTools).toEqual(cancellationRequiredToolSequence);
    expect(task?.requiredTools).toEqual(
      Array.from({ length: 9 }, () => "search_text"),
    );
    expect(task?.maximumToolCalls).toBe(9);
    expect(task?.maximumProviderCalls).toBe(11);
    expect(task?.objective).toContain(
      "execute exactly one search_text per S row in order",
    );
    expect(task?.objective).toContain("caseSensitive=true");
    expect(task?.objective).toContain("Do not call another tool");
  });

  it("compiles every proof task through its real working and finalization envelopes", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "soar-proof-envelope-"),
    );
    try {
      await writeFile(
        path.join(workspaceRoot, "probe.txt"),
        Array.from(
          { length: 16 },
          (_unused, index) => `proof-envelope-probe-${index + 1}`,
        ).join("\n") + "\n",
        "utf8",
      );
      await Promise.all(
        Array.from({ length: 16 }, (_unused, index) =>
          writeFile(
            path.join(workspaceRoot, `probe-${index + 1}.txt`),
            `proof-envelope-read-${index + 1}\n`,
            "utf8",
          ),
        ),
      );
      for (const task of tasks) {
        const finalizationRounds = task.id === "architecture" ? 1 : 2;
        const inferenceRounds =
          task.requiredTools.length + finalizationRounds;
        const toolCalls = task.requiredTools.length;
        const database = createSoarDatabase();
        try {
          const store = new EventStore(database);
          const provider = new ContextEnvelopeProbeProvider();
          const session = store.createSession({
            id: `finalization-budget-${task.id}`,
            title: task.title,
            objective: task.objective,
            workspaceRoot,
            profile: "economy",
            taskTrack: "repository-investigator-v1",
            completionObligations: {
              requiredSuccessfulTools: task.requiredTools,
              minimumVerifiedPathLineCitations:
                task.minimumVerifiedPathLineCitations,
            },
            executionPolicy: {
              schemaVersion: "agentic-execution-v1",
              inferenceRounds,
              toolCalls,
            },
          });
          const runner = new SessionRunner({
            store,
            provider,
            limits: {
              inferenceRounds,
              toolCalls,
            },
            context: proofContextPolicy,
          });

          await runner.startSession(session.id);

          expect(
            provider.calls,
            `${task.id}: ${store.requireSession(session.id).error ?? "no session error"}`,
          ).toBe(inferenceRounds);
          expect(provider.allowTools, task.id).toEqual([
            ...task.requiredTools.map(() => true),
            ...Array.from({ length: finalizationRounds }, () => false),
          ]);
          expect(provider.allowedToolNames, task.id).toEqual([
            ...task.requiredTools.map((tool) => [tool]),
            ...Array.from({ length: finalizationRounds }, () => undefined),
          ]);
          expect(provider.requireToolCall, task.id).toEqual([
            ...task.requiredTools.map(() => true),
            ...Array.from({ length: finalizationRounds }, () => undefined),
          ]);
          if (task.id !== "architecture") {
            expect(inferenceRounds).toBe(task.maximumProviderCalls);
            expect(toolCalls).toBe(task.maximumToolCalls);
          }
          expect(
            provider.estimateInputTokenReserve(false),
            `${task.id} finalization reserve`,
          ).toBe(569);
          const events = store.getEvents(session.id);
          const toolCompletions = events.filter(
            (event) => event.type === "tool.call.completed",
          );
          expect(toolCompletions, task.id).toHaveLength(toolCalls);
          expect(
            toolCompletions.map((event) => event.payload.isError),
            task.id,
          ).toEqual(task.requiredTools.map(() => false));
          const contextEvents = events
            .filter((event) => event.type === "context.compiled");
          expect(contextEvents, task.id).toHaveLength(inferenceRounds);
          expect(
            contextEvents.map((event) => event.payload.reason),
            task.id,
          ).toEqual([
            "session_start",
            ...task.requiredTools.slice(1).map(() => "tool_result_boundary"),
            "finalization_boundary",
            ...(finalizationRounds === 2
              ? ["obligation_retry_boundary" as const]
              : []),
          ]);
          const obligationChecks = events.filter(
            (event) => event.type === "completion.obligations.checked",
          );
          expect(
            obligationChecks.map((event) => event.payload.outcome),
            task.id,
          ).toEqual(
            finalizationRounds === 2
              ? ["retry", "exhausted"]
              : ["exhausted"],
          );
          const firstContext = contextEvents[0];
          const firstReserve = provider.estimateInputTokenReserve(
            true,
            [task.requiredTools[0]!],
            true,
          );
          const firstEffectiveBudget =
            proofContextPolicy.maxInputTokens -
            Math.ceil(
              proofContextPolicy.maxInputTokens *
                proofContextPolicy.safetyMargin,
            ) -
            firstReserve;
          expect(firstContext?.payload, task.id).toMatchObject({
            reason: "session_start",
            mode: "working",
            maxTokens: proofContextPolicy.maxInputTokens,
            reservedInputTokens: firstReserve,
            effectiveInputTokenBudget: firstEffectiveBudget,
          });
          if (task.id === "symbol-references") {
            expect(firstReserve).toBe(1_463);
            expect(firstEffectiveBudget).toBe(11_644);
          }
          expect(
            firstContext?.payload.estimatedTokens ?? Number.POSITIVE_INFINITY,
            `${task.id} first working estimate`,
          ).toBeLessThanOrEqual(
            firstContext?.payload.effectiveInputTokenBudget ?? 0,
          );
          const finalContext = contextEvents.at(-1);
          expect(finalContext?.payload, task.id).toMatchObject({
            reason:
              finalizationRounds === 2
                ? "obligation_retry_boundary"
                : "finalization_boundary",
            mode: "finalization",
            maxTokens: proofContextPolicy.maxInputTokens,
            reservedInputTokens: 569,
            effectiveInputTokenBudget: 12_538,
          });
          expect(
            finalContext?.payload.estimatedTokens ?? Number.POSITIVE_INFINITY,
            `${task.id} finalization estimate`,
          ).toBeLessThanOrEqual(12_538);
          if (task.id === "symbol-references") {
            const finalMessages = provider.contexts.at(-1) ?? [];
            const finalPacket = parseContextPacket(finalMessages);
            expect(
              sha256Hex(contextPacketJson(finalMessages)),
              `${task.id} packet hash binding`,
            ).toBe(finalContext?.payload.packetSha256);
            expect(
              capturedMessagesSha256(finalMessages),
              `${task.id} message hash binding`,
            ).toBe(finalContext?.payload.messagesSha256);
            const toolEvidence = finalPacket.evidence.filter(
              (evidence) => evidence.kind === "tool_evidence",
            );
            const retainedCitations = new Set(
              toolEvidence.flatMap((evidence) =>
                (evidence.citationSnippets ?? []).map(
                  (snippet) => snippet.citation,
                ),
              ),
            );
            expect(finalPacket, task.id).toMatchObject({
              mode: "finalization",
              requirements: {
                requiredSuccessfulTools: task.requiredTools,
              },
              progress: {
                successfulRequiredTools: task.requiredTools,
                missingRequiredTools: [],
              },
              selection: {
                raw: { toolEvidence: task.maximumToolCalls },
                deduplicated: { toolEvidence: 0 },
              },
            });
            expect(finalPacket.selection.included.toolEvidence, task.id).toBe(
              toolEvidence.length,
            );
            expect(
              finalPacket.selection.included.toolEvidence +
                finalPacket.selection.omitted.toolEvidence,
              task.id,
            ).toBe(task.maximumToolCalls);
            expect(toolEvidence, task.id).toHaveLength(task.maximumToolCalls);
            expect(retainedCitations.size, task.id).toBeGreaterThanOrEqual(
              task.minimumVerifiedPathLineCitations,
            );
            expect(
              [...retainedCitations].every((citation) =>
                /^probe(?:-\d+)?\.txt:\d+$/u.test(citation),
              ),
              task.id,
            ).toBe(true);
            const retention = finalPacketRetentionAudit({
              input: {
                messages: finalMessages,
                allowTools: false,
                allowedToolNames: undefined,
                requireToolCall: undefined,
              },
              acceptedRound: inferenceRounds,
              expectedContextPacketSha256: sha256Hex(
                contextPacketJson(finalMessages),
              ),
              expectedContextMessagesSha256:
                capturedMessagesSha256(finalMessages),
              requirements: [
                {
                  id: "probe-read",
                  summaryPhrases: [],
                  evidence: [
                    {
                      path: "probe-2.txt",
                      lineIncludes: "proof-envelope-read-2",
                    },
                  ],
                },
                {
                  id: "probe-search",
                  summaryPhrases: [],
                  evidence: [
                    {
                      path: "probe.txt",
                      lineIncludes: "proof-envelope-probe-7",
                    },
                  ],
                },
              ],
              verifiedAnswerCitations: ["probe.txt:7"],
              expectedSymbolOccurrences: ["probe.txt:1", "probe.txt:7"],
            });
            expect(retention.failures, task.id).toEqual([]);
            expect(retention.audit, task.id).toMatchObject({
              requiredClaimEvidence: 2,
              retainedClaimEvidence: 2,
              requiredVerifiedAnswerCitations: 1,
              retainedVerifiedAnswerCitations: 1,
              requiredSymbolOccurrences: 2,
              retainedSymbolOccurrences: 2,
            });
            expect(
              finalPacketRetentionAudit({
                input: {
                  messages: finalMessages,
                  allowTools: false,
                  allowedToolNames: undefined,
                  requireToolCall: undefined,
                },
                acceptedRound: inferenceRounds,
                expectedContextPacketSha256: sha256Hex(
                  contextPacketJson(finalMessages),
                ),
                expectedContextMessagesSha256:
                  capturedMessagesSha256(finalMessages),
                requirements: [],
                expectedSymbolOccurrences: ["probe.txt:16"],
              }).failures,
              task.id,
            ).toEqual([
              expect.stringContaining("0/1 independent-oracle symbol occurrences"),
            ]);
            expect(
              finalPacketRetentionAudit({
                input: {
                  messages: finalMessages,
                  allowTools: false,
                  allowedToolNames: undefined,
                  requireToolCall: undefined,
                },
                acceptedRound: inferenceRounds,
                expectedContextPacketSha256: sha256Hex(
                  contextPacketJson(finalMessages),
                ),
                expectedContextMessagesSha256:
                  capturedMessagesSha256(finalMessages),
                requirements: [
                  {
                    id: "overlap-a",
                    summaryPhrases: [],
                    evidence: [
                      {
                        path: "probe.txt",
                        lineIncludes: "proof-envelope-probe-7",
                      },
                    ],
                  },
                  {
                    id: "overlap-b",
                    summaryPhrases: [],
                    evidence: [
                      {
                        path: "probe.txt",
                        lineIncludes: "proof-envelope-probe-7",
                      },
                    ],
                  },
                ],
              }).failures,
              task.id,
            ).toEqual([
              expect.stringContaining(
                "1/2 evaluator-required claim evidence snippets",
              ),
            ]);
          }
          expect(store.requireSession(session.id), task.id).toMatchObject({
            status: "failed",
            error: expect.stringContaining(
              "exhausted the completion contract",
            ),
          });
        } finally {
          database.close();
        }
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("retains the real symbol schedule with 250-byte objective drift at 16,384 tokens", async () => {
    const task = tasks.find((candidate) => candidate.id === "symbol-references");
    if (task?.claimCoverage === undefined) {
      throw new Error("symbol-references task must define claim coverage");
    }
    const claimCoverage = task.claimCoverage;
    const revision = (
      await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: projectRoot,
        encoding: "utf8",
      })
    ).stdout.trim();
    const fixture = await createPinnedRepositoryFixture(projectRoot, revision);

    try {
      const symbolOracle = await buildIndependentSymbolOracle(
        fixture.workspaceRoot,
      );
      expect(symbolOracle.occurrences.length).toBeGreaterThan(2);

      const fileLines = new Map<string, string[]>();
      const evidenceCitations = new Map<string, string>();
      for (const requirement of claimCoverage) {
        for (const evidence of requirement.evidence) {
          let lines = fileLines.get(evidence.path);
          if (lines === undefined) {
            lines = (
              await readFile(path.join(fixture.workspaceRoot, evidence.path), "utf8")
            ).split(/\r\n|\r|\n/u);
            fileLines.set(evidence.path, lines);
          }
          const lineIndex = lines.findIndex((line) =>
            line.includes(evidence.lineIncludes),
          );
          if (lineIndex < 0) {
            throw new Error(
              `Fixture is missing ${evidence.path} containing ${JSON.stringify(evidence.lineIncludes)}`,
            );
          }
          evidenceCitations.set(
            `${evidence.path}\u0000${evidence.lineIncludes}`,
            `${evidence.path}:${lineIndex + 1}`,
          );
        }
      }
      const requiredEvidenceCount = requiredClaimCitationCount(
        claimCoverage,
      );
      expect(evidenceCitations.size).toBe(requiredEvidenceCount);
      expect(new Set(evidenceCitations.values()).size).toBe(
        requiredEvidenceCount,
      );

      const coverageClaims = claimCoverage.map((requirement) => ({
        id: requirement.id,
        summary: requirement.summaryPhrases.join("; "),
        citations: requirement.evidence.map((evidence) => {
          const citation = evidenceCitations.get(
            `${evidence.path}\u0000${evidence.lineIncludes}`,
          );
          if (citation === undefined) {
            throw new Error(`No fixture citation was derived for ${requirement.id}`);
          }
          return citation;
        }),
      }));
      const finalAnswer =
        `${symbolCallPathProseRelationships.join(". Then ")}. ` +
        `The evidence is ${[...evidenceCitations.values()].join(", ")}.\n` +
        `${claimCoverageMarker}${JSON.stringify({ claims: coverageClaims })}\n` +
        `${symbolAuditMarker}${JSON.stringify({
          query: symbol,
          truncated: false,
          occurrences: symbolOracle.occurrences,
        })}`;

      const scheduledToolCalls = [
        {
          name: "search_text",
          arguments: { ...symbolGlobalSearchArguments },
        },
        ...requiredClaimEvidencePaths(claimCoverage).map(
          (relativePath) => ({
            name: "read_text_file",
            arguments: { relativePath },
          }),
        ),
        ...requiredSupportingSearches(claimCoverage).map(
          ({ path: relativePath, query }) => ({
            name: "search_text",
            arguments: {
              query,
              relativePath,
              caseSensitive: true,
              maxMatches: 20,
            },
          }),
        ),
      ];
      expect(scheduledToolCalls.map((call) => call.name)).toEqual(
        task.requiredTools,
      );

      const runRetentionScenario = async (
        objective: string,
        sessionId: string,
      ): Promise<void> => {
      const reserveProvider = new OpenAICompatibleProvider({
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "non-live-symbol-retention",
        model: proofModel,
        costPolicy: "local_zero_cost",
        maxOutputTokens: 128,
        timeoutMs: 1_000,
      });
      let scriptedRound = 0;
      const scriptedProvider: InferenceProvider = {
        id: "scripted-symbol-retention",
        model: proofModel,
        costPolicy: "local_zero_cost",
        estimateInputTokenReserve: (
          allowTools,
          allowedToolNames,
          requireToolCall,
        ) =>
          reserveProvider.estimateInputTokenReserve(
            allowTools,
            allowedToolNames,
            requireToolCall,
          ),
        complete: async (input) => {
          const scheduled = scheduledToolCalls[scriptedRound];
          scriptedRound += 1;
          if (scheduled !== undefined) {
            return {
              content: "",
              toolCalls: [
                {
                  id: `scripted-symbol-${scriptedRound}`,
                  type: "function",
                  function: {
                    name: scheduled.name,
                    arguments: JSON.stringify(scheduled.arguments),
                  },
                },
              ],
              finishReason: "tool_calls",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              servedModel: proofModel,
              costUsd: 0,
              durationMs: 1,
            };
          }
          input.onDelta(finalAnswer);
          return {
            content: finalAnswer,
            toolCalls: [],
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            servedModel: proofModel,
            costUsd: 0,
            durationMs: 1,
          };
        },
      };
      const provider = new CapturingInferenceProvider(scriptedProvider);
      const database = createSoarDatabase();
      try {
        const store = new EventStore(database);
        const session = store.createSession({
          id: sessionId,
          title: task.title,
          objective,
          workspaceRoot: fixture.workspaceRoot,
          profile: "economy",
          taskTrack: "repository-investigator-v1",
          completionObligations: {
            requiredSuccessfulTools: task.requiredTools,
            minimumVerifiedPathLineCitations:
              task.minimumVerifiedPathLineCitations,
          },
          executionPolicy: {
            schemaVersion: "agentic-execution-v1",
            inferenceRounds: task.maximumProviderCalls,
            toolCalls: task.maximumToolCalls,
          },
        });
        const runner = new SessionRunner({
          store,
          provider,
          limits: {
            inferenceRounds: task.maximumProviderCalls,
            toolCalls: task.maximumToolCalls,
          },
          context: proofContextPolicy,
        });

        await runner.startSession(session.id);

        const record = store.requireSession(session.id);
        const events = store.getEvents(session.id);
        const executions = successfulToolExecutions(events);
        expect(record).toMatchObject({ status: "completed", result: finalAnswer });
        expect(executions.map((execution) => execution.request.payload.name)).toEqual(
          task.requiredTools,
        );
        expect(
          provider.inputs
            .slice(0, task.maximumToolCalls)
            .map((input) => input.allowedToolNames),
        ).toEqual(task.requiredTools.map((tool) => [tool]));
        expect(
          provider.inputs
            .slice(0, task.maximumToolCalls)
            .map((input) => input.requireToolCall),
        ).toEqual(task.requiredTools.map(() => true));
        expect(
          completeSymbolSearchFailures(
            executions,
            symbolOracle.occurrences,
          ),
        ).toEqual([]);
        expect(
          claimEvidenceReadFailures(executions, claimCoverage),
        ).toEqual([]);
        expect(
          orderedClaimEvidenceReadFailures(executions, claimCoverage),
        ).toEqual([]);
        expect(
          claimEvidenceSupportingSearchFailures(
            executions,
            claimCoverage,
          ),
        ).toEqual([]);

        const completionChecks = events.filter(
          (event) => event.type === "completion.obligations.checked",
        );
        const acceptedChecks = completionChecks.filter(
          (event) => event.payload.outcome === "accepted",
        );
        expect(acceptedChecks).toHaveLength(1);
        const acceptedCheck = acceptedChecks[0]!;
        const acceptedRound = acceptedCheck.payload.round;
        const acceptedInput = provider.inputs[acceptedRound - 1];
        const contextEvents = events.filter(
          (event) => event.type === "context.compiled",
        );
        const acceptedContexts = contextEvents.filter(
          (event) =>
            event.payload.checkpointId ===
              `${session.id}:context:${acceptedRound}`,
        );
        expect(acceptedRound).toBe(task.maximumToolCalls + 1);
        expect(acceptedInput).toBeDefined();
        expect(acceptedContexts).toHaveLength(1);
        const acceptedContext = acceptedContexts[0]!;
        expect(acceptedContext.payload.maxTokens).toBe(
          proofContextPolicy.maxInputTokens,
        );
        const acceptedPacket = JSON.parse(
          contextPacketJson(acceptedInput!.messages),
        ) as ContextPacket;
        const acceptedToolEvidence = acceptedPacket.evidence.filter(
          (evidence) => evidence.kind === "tool_evidence",
        );
        expect(acceptedToolEvidence.length).toBeLessThanOrEqual(
          task.maximumToolCalls,
        );
        expect(acceptedToolEvidence.length).toBeGreaterThanOrEqual(6);
        expect(
          acceptedToolEvidence.every(
            (evidence) =>
              typeof evidence.content === "string" &&
              typeof evidence.argumentsExcerpt === "string",
          ),
        ).toBe(true);
        expect(
          acceptedToolEvidence
            .filter((evidence) => evidence.toolName === "read_text_file")
            .map((evidence) => evidence.argumentsExcerpt),
        ).toEqual(Array.from({ length: 5 }, () => "{}"));
        const expectedSearchArguments = [
          symbolGlobalPacketArguments,
          ...requiredSupportingSearches(claimCoverage).map(
            (requirement) => ({
              maxMatches: 20,
              query: requirement.query,
            }),
          ),
        ];
        const retainedSearchArguments = acceptedToolEvidence
          .filter((evidence) => evidence.toolName === "search_text")
          .map((evidence) => JSON.parse(evidence.argumentsExcerpt));
        expect(retainedSearchArguments[0]).toEqual(expectedSearchArguments[0]);
        expect(
          retainedSearchArguments.every((arguments_) =>
            expectedSearchArguments.some(
              (expected) => hasExactArguments(arguments_, expected),
            ),
          ),
        ).toBe(true);
        expect(
          new Set(
            retainedSearchArguments.map((arguments_) =>
              JSON.stringify(arguments_),
            ),
          ).size,
        ).toBe(retainedSearchArguments.length);

        const retention = finalPacketRetentionAudit({
          input: acceptedInput!,
          acceptedRound,
          expectedContextPacketSha256: acceptedContext.payload.packetSha256,
          expectedContextMessagesSha256: acceptedContext.payload.messagesSha256,
          requirements: claimCoverage,
          verifiedAnswerCitations:
            acceptedCheck.payload.verifiedPathLineCitations,
          expectedSymbolOccurrences: symbolOracle.occurrences,
          expectedSymbolSearchArguments: symbolGlobalPacketArguments,
        });
        expect(retention.failures).toEqual([]);
        expect(retention.audit).toMatchObject({
          packetMode: "finalization",
          allowTools: false,
          requireToolCall: false,
          toolEvidenceItems: acceptedToolEvidence.length,
          requiredClaimEvidence: requiredEvidenceCount,
          retainedClaimEvidence: requiredEvidenceCount,
          requiredSymbolOccurrences: symbolOracle.occurrences.length,
          retainedSymbolOccurrences: symbolOracle.occurrences.length,
        });
        expect(retention.audit.retainedVerifiedAnswerCitations).toBe(
          retention.audit.requiredVerifiedAnswerCitations,
        );

        const defectiveMessages = structuredClone(acceptedInput!.messages);
        const defectivePacket = JSON.parse(
          contextPacketJson(defectiveMessages),
        ) as ContextPacket;
        const globalSearchEvidence = defectivePacket.evidence.find(
          (evidence) =>
            evidence.kind === "tool_evidence" &&
            evidence.toolName === "search_text" &&
            evidence.workspaceRelativePath === "." &&
            argumentsExcerptMatches(
              evidence.argumentsExcerpt,
              symbolGlobalPacketArguments,
            ),
        );
        const readCitations = new Set(
          defectivePacket.evidence
            .filter(
              (evidence) =>
                evidence.kind === "tool_evidence" &&
                evidence.toolName === "read_text_file",
            )
            .flatMap((evidence) => evidence.citationSnippets ?? [])
            .map((snippet) => snippet.citation),
        );
        const citationPresentInSearchAndRead =
          globalSearchEvidence?.citationSnippets?.find((snippet) =>
            readCitations.has(snippet.citation),
          )?.citation;
        if (
          globalSearchEvidence === undefined ||
          citationPresentInSearchAndRead === undefined
        ) {
          throw new Error(
            "The retention fixture must contain overlapping global-search and read evidence",
          );
        }
        globalSearchEvidence.citationSnippets =
          globalSearchEvidence.citationSnippets?.filter(
            (snippet) =>
              snippet.citation !== citationPresentInSearchAndRead,
          );
        expect(
          defectivePacket.evidence.some((evidence) =>
            evidence.citationSnippets?.some(
              (snippet) =>
                snippet.citation === citationPresentInSearchAndRead,
            ),
          ),
        ).toBe(true);
        const defectivePacketMessage = defectiveMessages.find(
          (message) => message.role === "user",
        );
        if (defectivePacketMessage === undefined) {
          throw new Error("The finalization input must contain a packet message");
        }
        defectivePacketMessage.content =
          `SOAR_CONTEXT_PACKET_V1\n${JSON.stringify(defectivePacket)}`;
        const defectiveRetention = finalPacketRetentionAudit({
          input: { ...acceptedInput!, messages: defectiveMessages },
          acceptedRound,
          expectedContextPacketSha256: sha256Hex(
            contextPacketJson(defectiveMessages),
          ),
          expectedContextMessagesSha256:
            capturedMessagesSha256(defectiveMessages),
          requirements: [],
          expectedSymbolOccurrences: symbolOracle.occurrences,
          expectedSymbolSearchArguments: symbolGlobalPacketArguments,
        });
        expect(defectiveRetention.failures).toEqual([
          expect.stringContaining(
            `global search envelope retained ${symbolOracle.occurrences.length - 1}/${symbolOracle.occurrences.length} exact independent-oracle symbol occurrences`,
          ),
        ]);
      } finally {
        database.close();
      }
      };
      await runRetentionScenario(
        task.objective,
        "deterministic-real-symbol-retention",
      );
      const finalRecordInstruction =
        "Finish with adjacent unfenced lines";
      const inertCapacityPadding = `<!--${"x".repeat(242)}-->\n`;
      const paddedObjective = task.objective.replace(
        finalRecordInstruction,
        `${inertCapacityPadding}${finalRecordInstruction}`,
      );
      expect(new TextEncoder().encode(inertCapacityPadding)).toHaveLength(
        finalPacketDriftToleranceBytes,
      );
      expect(
        new TextEncoder().encode(paddedObjective).length -
          new TextEncoder().encode(task.objective).length,
      ).toBe(finalPacketDriftToleranceBytes);
      await runRetentionScenario(
        paddedObjective,
        "deterministic-real-symbol-retention-padded",
      );
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  it("requires exact, sorted, unique symbol occurrences and a false truncation flag", () => {
    const expected = ["src/a.ts:2", "tests/a.test.ts:7"];
    const accepted =
      `${symbolAuditMarker}` +
      JSON.stringify({
        query: symbol,
        truncated: false,
        occurrences: expected,
      });
    expect(
      symbolAuditFailures({
        result: accepted,
        expectedOccurrences: expected,
        verifiedCitations: expected,
      }),
    ).toEqual([]);

    const rejected =
      `${symbolAuditMarker}` +
      JSON.stringify({
        query: symbol,
        truncated: true,
        occurrences: [expected[0], expected[0], "src/extra.ts:1"],
      });
    expect(
      symbolAuditFailures({
        result: rejected,
        expectedOccurrences: expected,
        verifiedCitations: expected,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("truncated=false"),
        expect.stringContaining("duplicates"),
        expect.stringContaining("exactly equal"),
        expect.stringContaining("not verified"),
      ]),
    );
  });

  it("requires claim coverage and symbol audit as the final adjacent records", () => {
    const claim = `${claimCoverageMarker}{"claims":[]}`;
    const audit = `${symbolAuditMarker}{"query":"${symbol}","truncated":false,"occurrences":[]}`;

    expect(
      finalRecordSuffixFailures(`Substantive call-path prose.\n${claim}\n${audit}`),
    ).toEqual([]);
    expect(
      finalRecordSuffixFailures(`Substantive call-path prose.\n${audit}\n${claim}`),
    ).toEqual([expect.stringContaining("final two adjacent lines")]);
    expect(
      finalRecordSuffixFailures(
        `Substantive call-path prose.\n${claim}\n${audit}\nTrailing prose.`,
      ),
    ).toEqual([expect.stringContaining("no trailing text")]);
    expect(
      finalRecordSuffixFailures(
        `Substantive call-path prose.\n${claim}\nIntervening prose.\n${audit}`,
      ),
    ).toEqual([expect.stringContaining("final two adjacent lines")]);
    expect(
      finalRecordSuffixFailures(
        [
          "```text",
          "Earlier fenced example.",
          "```",
          "Substantive call-path prose.",
          claim,
          audit,
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(
      finalRecordSuffixFailures(
        ["Substantive call-path prose.", "~~~json", claim, audit].join(
          "\n",
        ),
      ),
    ).toEqual([expect.stringContaining("outside Markdown fences")]);
  });

  it("requires the successful search tool trace to return the exact untruncated set", () => {
    const expected = ["src/a.ts:2", "tests/a.test.ts:7"];
    const makeExecution = (
      options: {
        truncated: boolean;
        occurrences: string[];
        arguments?: Record<string, string | number | boolean>;
      },
    ): SuccessfulToolExecution => ({
      request: {
        id: "event-request",
        sessionId: "session",
        sequence: 1,
        createdAt: "2026-08-28T00:00:00.000Z",
        type: "tool.call.requested",
        payload: {
          toolCallId: "call",
          name: "search_text",
          arguments: options.arguments ?? {
              query: symbol,
              relativePath: ".",
              caseSensitive: true,
              maxMatches: 500,
              maxDepth: 20,
            },
          messageId: "message",
        },
      },
      completion: {
        id: "event-completion",
        sessionId: "session",
        sequence: 2,
        createdAt: "2026-08-28T00:00:01.000Z",
        type: "tool.call.completed",
        payload: {
          toolCallId: "call",
          name: "search_text",
          content: JSON.stringify({
            ok: true,
            truncated: options.truncated,
            count: options.occurrences.length,
            matches: options.occurrences.map((occurrence) => {
              const separator = occurrence.lastIndexOf(":");
              return {
                path: occurrence.slice(0, separator),
                lineNumber: Number(occurrence.slice(separator + 1)),
              };
            }),
            skipped: { tooLarge: 0, unreadable: 0 },
          }),
          isError: false,
        },
      },
    });

    expect(
      completeSymbolSearchFailures(
        [makeExecution({ truncated: false, occurrences: expected })],
        expected,
      ),
    ).toEqual([]);
    expect(
      completeSymbolSearchFailures(
        [
          makeExecution({
            truncated: true,
            occurrences: [expected[0]!, expected[0]!, "src/extra.ts:1"],
          }),
        ],
        expected,
      ),
    ).toEqual([
      expect.stringContaining("complete, untruncated fixture occurrence set"),
    ]);
    const invalidGlobalArguments: Array<
      Record<string, string | number | boolean>
    > = [
      {
        query: symbol,
        relativePath: ".",
        caseSensitive: true,
        maxMatches: 500,
      },
      {
        query: symbol,
        relativePath: ".",
        caseSensitive: true,
        maxMatches: 500,
        maxDepth: 20,
        extra: true,
      },
    ];
    for (const arguments_ of invalidGlobalArguments) {
      expect(
        completeSymbolSearchFailures(
          [
            makeExecution({
              truncated: false,
              occurrences: expected,
              arguments: arguments_,
            }),
          ],
          expected,
        ),
      ).toEqual([
        expect.stringContaining("must use exactly query, relativePath"),
      ]);
    }
  });

  it("requires substantive call-path prose outside machine-readable records", () => {
    const markerOnly =
      `${claimCoverageMarker}{"claims":[]}\n` +
      `${symbolAuditMarker}{"query":"${symbol}","truncated":false,"occurrences":[]}`;
    expect(callPathProseFailures(markerOnly)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("substantive prose"),
        expect.stringContaining("evaluator-owned relationships in order"),
      ]),
    );

    const keywordSalad =
      "cancelSession renderer preload IPC SessionRunner AbortController provider tool signal " +
      "appear in this deliberately long paragraph, but listing the nouns does not establish " +
      "which component calls which downstream component or how cancellation propagates.";
    expect(callPathProseFailures(keywordSalad)).toEqual([
      expect.stringContaining("evaluator-owned relationships in order"),
    ]);

    const reversedRelationships = [...symbolCallPathProseRelationships]
      .reverse()
      .join(". ");
    expect(callPathProseFailures(reversedRelationships)).toEqual([
      expect.stringContaining("missing or out of order"),
    ]);

    const prose = symbolCallPathProseRelationships.join(". Then ");
    expect(callPathProseFailures(prose)).toEqual([]);
  });

  it("requires successful complete reads of every call-path evidence file", () => {
    const requirements: ClaimCoverageRequirement[] = [
      {
        id: "runner",
        summaryPhrases: ["the runner aborts the active task"],
        evidence: [
          { path: "src/runner.ts", lineIncludes: "controller.abort()" },
          { path: "src/runner.ts", lineIncludes: "signal: controller.signal" },
        ],
      },
      {
        id: "renderer",
        summaryPhrases: ["the renderer requests cancellation"],
        evidence: [
          { path: "src/App.tsx", lineIncludes: "window.soar.cancelSession" },
        ],
      },
    ];
    const makeReadExecution = (
      id: string,
      relativePath: string,
      text: string,
      completionSequence = 2,
    ): SuccessfulToolExecution => ({
      request: {
        id: `request-${id}`,
        sessionId: "session",
        sequence: completionSequence - 1,
        createdAt: "2026-08-28T00:00:00.000Z",
        type: "tool.call.requested",
        payload: {
          toolCallId: id,
          name: "read_text_file",
          arguments: { relativePath },
          messageId: "message",
        },
      },
      completion: {
        id: `completion-${id}`,
        sessionId: "session",
        sequence: completionSequence,
        createdAt: "2026-08-28T00:00:01.000Z",
        type: "tool.call.completed",
        payload: {
          toolCallId: id,
          name: "read_text_file",
          content: JSON.stringify({
            ok: true,
            text,
            bytes: new TextEncoder().encode(text).length,
            truncated: false,
          }),
          isError: false,
        },
      },
    });

    const unrelatedRead = makeReadExecution(
      "unrelated",
      "README.md",
      "controller.abort()\nsignal: controller.signal\nwindow.soar.cancelSession\n",
    );
    expect(claimEvidenceReadFailures([unrelatedRead], requirements)).toEqual([
      expect.stringContaining("src/runner.ts"),
      expect.stringContaining("src/App.tsx"),
    ]);

    const incompleteRunnerRead = makeReadExecution(
      "runner-incomplete",
      "src/runner.ts",
      "controller.abort()\n",
    );
    expect(
      claimEvidenceReadFailures([incompleteRunnerRead], requirements),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("src/runner.ts"),
        expect.stringContaining("src/App.tsx"),
      ]),
    );

    expect(
      claimEvidenceReadFailures(
        [
          makeReadExecution(
            "runner",
            "src/runner.ts",
            "controller.abort()\nsignal: controller.signal\n",
          ),
          makeReadExecution(
            "renderer",
            "src/App.tsx",
            "await window.soar.cancelSession(snapshot.id);\n",
          ),
        ],
        requirements,
      ),
    ).toEqual([]);

    const orderedReads = [
      makeReadExecution(
        "renderer-ordered",
        "src/App.tsx",
        "await window.soar.cancelSession(snapshot.id);\n",
        20,
      ),
      makeReadExecution(
        "runner-ordered",
        "src/runner.ts",
        "controller.abort()\nsignal: controller.signal\n",
        22,
      ),
    ];
    expect(
      orderedClaimEvidenceReadFailures(orderedReads, requirements),
    ).toEqual([]);
    expect(
      orderedClaimEvidenceReadFailures(
        [...orderedReads].reverse(),
        requirements,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("evidence read 1"),
        expect.stringContaining("evidence read 2"),
      ]),
    );
    const extraArgumentRead = structuredClone(orderedReads[0]!);
    extraArgumentRead.request.payload.arguments = {
      relativePath: "src/App.tsx",
      startLine: 1,
    };
    expect(
      orderedClaimEvidenceReadFailures(
        [extraArgumentRead, orderedReads[1]!],
        requirements,
      ),
    ).toEqual([
      expect.stringContaining("must use exactly relativePath"),
    ]);
  });

  it("requires exact supporting searches after every complete evidence read", () => {
    const requirements: ClaimCoverageRequirement[] = [
      {
        id: "runner",
        summaryPhrases: ["the runner propagates cancellation"],
        evidence: [
          { path: "src/runner.ts", lineIncludes: "controller.abort()" },
          { path: "src/runner.ts", lineIncludes: "signal: controller.signal" },
        ],
      },
      {
        id: "renderer",
        summaryPhrases: ["the renderer requests cancellation"],
        evidence: [
          { path: "src/App.tsx", lineIncludes: "window.soar.cancelSession" },
        ],
      },
    ];
    const makeReadExecution = (
      id: string,
      relativePath: string,
      text: string,
      completionSequence: number,
    ): SuccessfulToolExecution => ({
      request: {
        id: `request-${id}`,
        sessionId: "session",
        sequence: completionSequence - 1,
        createdAt: "2026-08-28T00:00:00.000Z",
        type: "tool.call.requested",
        payload: {
          toolCallId: id,
          name: "read_text_file",
          arguments: { relativePath },
          messageId: "message",
        },
      },
      completion: {
        id: `completion-${id}`,
        sessionId: "session",
        sequence: completionSequence,
        createdAt: "2026-08-28T00:00:01.000Z",
        type: "tool.call.completed",
        payload: {
          toolCallId: id,
          name: "read_text_file",
          content: JSON.stringify({
            ok: true,
            text,
            bytes: new TextEncoder().encode(text).length,
            truncated: false,
          }),
          isError: false,
        },
      },
    });
    const makeSearchExecution = (
      id: string,
      requirement: SupportingSearchRequirement,
      completionSequence: number,
      argumentsOverride?: Record<string, string | number | boolean>,
    ): SuccessfulToolExecution => ({
      request: {
        id: `request-${id}`,
        sessionId: "session",
        sequence: completionSequence - 1,
        createdAt: "2026-08-28T00:00:02.000Z",
        type: "tool.call.requested",
        payload: {
          toolCallId: id,
          name: "search_text",
          arguments: argumentsOverride ?? {
              query: requirement.query,
              relativePath: requirement.path,
              caseSensitive: true,
              maxMatches: 20,
            },
          messageId: "message",
        },
      },
      completion: {
        id: `completion-${id}`,
        sessionId: "session",
        sequence: completionSequence,
        createdAt: "2026-08-28T00:00:03.000Z",
        type: "tool.call.completed",
        payload: {
          toolCallId: id,
          name: "search_text",
          content: JSON.stringify({
            ok: true,
            truncated: false,
            count: 1,
            matches: [
              {
                path: requirement.path,
                lineNumber: 1,
                text: requirement.query,
                textTruncated: false,
              },
            ],
            filesSearched: 1,
            bytesScanned: new TextEncoder().encode(requirement.query).length,
            skipped: {
              binary: 0,
              ignored: 0,
              symlink: 0,
              tooLarge: 0,
              unreadable: 0,
            },
            outputBytes: 0,
          }),
          isError: false,
        },
      },
    });

    const reads = [
      makeReadExecution(
        "runner",
        "src/runner.ts",
        "controller.abort()\nsignal: controller.signal\n",
        10,
      ),
      makeReadExecution(
        "renderer",
        "src/App.tsx",
        "window.soar.cancelSession();\n",
        20,
      ),
    ];
    const supportingSearches = requiredSupportingSearches(requirements);
    expect(supportingSearches).toHaveLength(2);
    expect(
      claimEvidenceSupportingSearchFailures(
        [
          ...reads,
          makeSearchExecution("early", supportingSearches[0]!, 9),
          makeSearchExecution("late", supportingSearches[1]!, 22),
        ],
        requirements,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("src/runner.ts"),
        expect.stringContaining("supporting search order"),
      ]),
    );
    expect(
      claimEvidenceSupportingSearchFailures(
        [
          ...reads,
          ...supportingSearches.map((requirement, index) =>
            makeSearchExecution(`support-${index}`, requirement, 21 + index),
          ),
        ],
        requirements,
      ),
    ).toEqual([]);
    expect(
      claimEvidenceSupportingSearchFailures(
        [
          ...reads,
          makeSearchExecution(
            "support-extra-argument",
            supportingSearches[0]!,
            21,
            {
              query: supportingSearches[0]!.query,
              relativePath: supportingSearches[0]!.path,
              caseSensitive: true,
              maxMatches: 20,
              maxDepth: 12,
            },
          ),
          makeSearchExecution(
            "support-missing-max-matches",
            supportingSearches[1]!,
            22,
            {
              query: supportingSearches[1]!.query,
              relativePath: supportingSearches[1]!.path,
              caseSensitive: true,
            },
          ),
        ],
        requirements,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("src/runner.ts"),
        expect.stringContaining("exactly query, relativePath"),
      ]),
    );
    expect(
      claimEvidenceSupportingSearchFailures(
        [
          ...reads,
          makeSearchExecution("support-reversed-1", supportingSearches[1]!, 21),
          makeSearchExecution("support-reversed-2", supportingSearches[0]!, 22),
        ],
        requirements,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("supporting search order: evidence search 1"),
        expect.stringContaining("supporting search order: evidence search 2"),
      ]),
    );

    const orderedSearches = supportingSearches.map((requirement, index) =>
      makeSearchExecution(`ordered-${index}`, requirement, 30 + index),
    );
    expect(
      orderedEvidenceSearchFailures(orderedSearches, supportingSearches, {
        requireExactSupportArguments: true,
      }),
    ).toEqual([]);
    expect(
      orderedEvidenceSearchFailures(
        [...orderedSearches].reverse(),
        supportingSearches,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("evidence search 1"),
        expect.stringContaining("evidence search 2"),
      ]),
    );
    expect(
      orderedEvidenceSearchFailures(
        orderedSearches.slice(0, 1),
        supportingSearches,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("expected exactly 2"),
        expect.stringContaining("missing evidence search 2"),
      ]),
    );
  });

  it("binds every claim to exact verified lines that prove its required structure", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "soar-claim-coverage-test-"),
    );
    const requirements: ClaimCoverageRequirement[] = [
      {
        id: "runtime",
        summaryPhrases: ["the main process owns execution"],
        evidence: [
          { path: "src/main/index.ts", lineIncludes: "ownsExecution" },
        ],
      },
      {
        id: "tests",
        summaryPhrases: ["the integration test checks execution"],
        evidence: [
          { path: "tests/run.test.ts", lineIncludes: "checksExecution" },
        ],
      },
    ];
    const accepted =
      `${claimCoverageMarker}` +
      JSON.stringify({
        claims: [
          {
            id: "runtime",
            summary: "The main process owns execution.",
            citations: ["src/main/index.ts:3"],
          },
          {
            id: "tests",
            summary: "The integration test checks execution.",
            citations: ["tests/run.test.ts:8"],
          },
        ],
      });
    try {
      await mkdir(path.join(workspaceRoot, "src", "main"), {
        recursive: true,
      });
      await mkdir(path.join(workspaceRoot, "tests"), { recursive: true });
      await writeFile(
        path.join(workspaceRoot, "src", "main", "index.ts"),
        "line one\nline two\nconst ownsExecution = true;\n",
        "utf8",
      );
      await writeFile(
        path.join(workspaceRoot, "tests", "run.test.ts"),
        "1\n2\n3\n4\n5\n6\n7\nchecksExecution();\n",
        "utf8",
      );
      expect(
        await claimCoverageFailures({
          workspaceRoot,
          result: accepted,
          requirements,
          verifiedCitations: ["src/main/index.ts:3", "tests/run.test.ts:8"],
        }),
      ).toEqual([]);

      const keywordSalad = accepted.replace(
        "The main process owns execution.",
        "Main process execution ownership words appear without the required relationship.",
      );
      expect(
        await claimCoverageFailures({
          workspaceRoot,
          result: keywordSalad,
          requirements,
          verifiedCitations: ["src/main/index.ts:3", "tests/run.test.ts:8"],
        }),
      ).toEqual([
        expect.stringContaining("missing required relational phrases"),
      ]);

      const rejected = accepted.replace(
        "tests/run.test.ts:8",
        "src/main/index.ts:3",
      );
      expect(
        await claimCoverageFailures({
          workspaceRoot,
          result: rejected,
          requirements,
          verifiedCitations: ["src/main/index.ts:3"],
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining("exact evidence path set"),
          expect.stringContaining("distinct citation"),
          expect.stringContaining("no distinct citation proves"),
        ]),
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("extracts citations from JSON markers as well as prose", () => {
    expect(
      citationsIn(
        `${claimCoverageMarker}{"claims":[{"citations":["src/main/index.ts:3"]}]}\nSee tests/run.test.ts:8.`,
      ),
    ).toEqual(new Set(["src/main/index.ts:3", "tests/run.test.ts:8"]));
  });

  it("copies a content-addressed Git fixture without exposing evaluator source", async () => {
    const revisionResult = await execFileAsync(
      "git",
      ["rev-parse", "--verify", "HEAD"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    const revision = revisionResult.stdout.trim();
    const fixture = await createPinnedRepositoryFixture(projectRoot, revision);
    try {
      expect(fixture.sourceRevision).toBe(revision);
      expect(fixture.archiveSha256).toMatch(/^[a-f0-9]{64}$/u);
      await expect(
        stat(path.join(fixture.workspaceRoot, "package.json")),
      ).resolves.toMatchObject({});
      for (const relativePath of evaluatorExcludedPaths) {
        await expect(
          stat(path.join(fixture.workspaceRoot, relativePath)),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  it("derives symbol gold with an independent UTF-8 filesystem oracle", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "soar-symbol-oracle-test-"),
    );
    try {
      await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
      await writeFile(
        path.join(workspaceRoot, "src", "a.ts"),
        `${symbol}(); ${symbol}();\nno match\n${symbol}();\n`,
        "utf8",
      );
      await writeFile(
        path.join(workspaceRoot, "src", "binary.dat"),
        Buffer.from([0, ...Buffer.from(symbol, "utf8")]),
      );
      const first = await buildIndependentSymbolOracle(workspaceRoot);
      const second = await buildIndependentSymbolOracle(workspaceRoot);
      expect(first).toMatchObject({
        method: "independent-utf8-filesystem-scan-v1",
        occurrences: ["src/a.ts:1", "src/a.ts:3"],
        occurrencesSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(second).toEqual(first);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("quarantines ambiguous and same-revision artifacts before a proof run", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "soar-proof-quarantine-test-"),
    );
    const outputDirectory = path.join(temporaryRoot, "runs");
    const legacyPath = path.join(
      outputDirectory,
      "local-repository-investigator-v1.json",
    );
    const contents = '{"passed":true,"schemaVersion":1}\n';
    try {
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(legacyPath, contents, "utf8");
      const quarantined = await quarantineExistingProofArtifacts(
        outputDirectory,
        [legacyPath],
      );
      const digest = createHash("sha256").update(contents).digest("hex");
      const quarantinePath = path.join(
        outputDirectory,
        "quarantine",
        `${path.basename(legacyPath)}.${digest}.stale`,
      );
      expect(quarantined).toHaveLength(1);
      await expect(stat(legacyPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(quarantinePath, "utf8")).resolves.toBe(contents);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!runLive)("Local Repository Investigator v1", () => {
  it(
    "completes three guided evaluator-disclosed evidence contracts at zero cost with retained, replayable traces",
    async () => {
      const declaredRevision = requireProofEnvironment("SOAR_PROOF_REVISION");
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(declaredRevision)) {
        throw new Error("SOAR_PROOF_REVISION must be a full lowercase Git object ID.");
      }
      const outputDirectory = path.join(projectRoot, "benchmarks", "runs");
      const artifactStem =
        `local-repository-investigator-v1.schema${proofSchemaVersion}.` +
        declaredRevision;
      const acceptedOutputPath = path.join(
        outputDirectory,
        `${artifactStem}.accepted.json`,
      );
      const diagnosticOutputPath = path.join(
        outputDirectory,
        `${artifactStem}.failed.json`,
      );
      const ambiguousLegacyArtifactPaths = [
        path.join(outputDirectory, "local-repository-investigator-v1.json"),
        path.join(
          outputDirectory,
          "local-repository-investigator-v1.failed.json",
        ),
      ];
      await mkdir(outputDirectory, { recursive: true });
      const quarantinedBeforeRun = await quarantineExistingProofArtifacts(
        outputDirectory,
        [
          acceptedOutputPath,
          diagnosticOutputPath,
          `${acceptedOutputPath}.tmp`,
          `${diagnosticOutputPath}.tmp`,
          ...ambiguousLegacyArtifactPaths,
        ],
      );

      const setup = await (async () => {
        let repository: RepositoryProofIdentity | undefined;
        let fixture: RepositoryProofFixture | undefined;
        let database: ReturnType<typeof createSoarDatabase> | undefined;
        let configuredModel: string | undefined;
        let configuredEndpointSha256: string | undefined;
        let endpointAttestation: ProviderEndpointAttestation | undefined;
        try {
          const expectedModel = requireProofEnvironment("SOAR_PROOF_MODEL");
          repository = await readRepositoryProofIdentity(projectRoot);
          if (declaredRevision !== repository.revision) {
            throw new Error(
              `SOAR_PROOF_REVISION must equal the clean Git HEAD ${repository.revision}.`,
            );
          }
          if (expectedModel !== proofModel) {
            throw new Error(
              `SOAR_PROOF_MODEL must equal the pinned proof model ${JSON.stringify(proofModel)}.`,
            );
          }
          if (expectedModel !== nonComparableHistoricalReference.model) {
            throw new Error(
              `SOAR_PROOF_MODEL must equal the historical reference model ${JSON.stringify(
                nonComparableHistoricalReference.model,
              )}.`,
            );
          }
          const config = loadConfig();
          configuredModel = config.vllm.model;
          configuredEndpointSha256 = sha256Text(
            normalizedApiBase(config.vllm.baseUrl),
          );
          if (expectedModel !== config.vllm.model) {
            throw new Error(
              `SOAR_PROOF_MODEL ${JSON.stringify(expectedModel)} does not match the configured model ` +
                `${JSON.stringify(config.vllm.model)}.`,
            );
          }
          if (
            config.context.maxInputTokens !==
              proofContextPolicy.maxInputTokens ||
            config.context.safetyMargin !== proofContextPolicy.safetyMargin
          ) {
            throw new Error(
              `The live proof requires the pinned context policy ${JSON.stringify(
                proofContextPolicy,
              )}; got ${JSON.stringify(config.context)}.`,
            );
          }
          endpointAttestation = await attestProviderEndpoint({
            baseUrl: config.vllm.baseUrl,
            apiKey: config.vllm.apiKey,
            expectedModel,
            timeoutMs: config.vllm.timeoutMs,
          });

          fixture = await createPinnedRepositoryFixture(
            projectRoot,
            repository.revision,
          );
          database = createSoarDatabase();
          const store = new EventStore(database);
          const provider = new CapturingInferenceProvider(
            new OpenAICompatibleProvider(config.vllm),
          );
          return {
            expectedModel,
            repository,
            config,
            fixture,
            database,
            store,
            provider,
            endpointAttestation,
          };
        } catch (error) {
          const failureMessage =
            error instanceof Error ? error.message : String(error);
          const preflightDiagnostic = {
            schemaVersion: proofSchemaVersion,
            artifactKind: "failed-live-proof-diagnostic",
            passed: false,
            failures: [`Live proof preflight failed: ${failureMessage}`],
            runType: proofRunType,
            methodology: {
              disclosure: proofMethodologyDisclosure,
              evaluatorContractAgentVisible: true,
              blindDiscoveryClaimed: false,
              qualityBenchmarkClaimed: false,
            },
            phase: "preflight",
            createdAt: new Date().toISOString(),
            declared: {
              revision: declaredRevision,
              model: process.env.SOAR_PROOF_MODEL?.trim() || null,
            },
            observed: {
              repository: repository ?? null,
              configuredModel: configuredModel ?? null,
              configuredEndpointSha256:
                configuredEndpointSha256 ?? null,
              endpointAttestation: endpointAttestation ?? null,
              fixture:
                fixture === undefined
                  ? null
                  : {
                      sourceRevision: fixture.sourceRevision,
                      archiveSha256: fixture.archiveSha256,
                      evaluatorSourceExcluded: [...fixture.excludedPaths],
                    },
            },
            artifactPolicy: {
              acceptedPath: path.relative(projectRoot, acceptedOutputPath),
              diagnosticPath: path.relative(
                projectRoot,
                diagnosticOutputPath,
              ),
              ambiguousLegacyNamesIgnored:
                ambiguousLegacyArtifactPaths.map((artifactPath) =>
                  path.relative(projectRoot, artifactPath),
                ),
              quarantinedBeforeRun,
            },
          } as const;
          let diagnosticError: unknown;
          try {
            await writeProofArtifact(
              diagnosticOutputPath,
              preflightDiagnostic,
              proofArtifactRedactions(fixture),
            );
          } catch (writeError) {
            diagnosticError = writeError;
          } finally {
            database?.close();
            if (fixture !== undefined) {
              await rm(fixture.temporaryRoot, {
                recursive: true,
                force: true,
              });
            }
          }
          if (diagnosticError !== undefined) {
            throw new AggregateError(
              [error, diagnosticError],
              "Live proof preflight failed and its diagnostic could not be written.",
            );
          }
          throw error;
        }
      })();
      const {
        expectedModel,
        repository,
        config,
        fixture,
        database,
        store,
        provider,
        endpointAttestation,
      } = setup;
      const proofTasks: Array<Record<string, unknown>> = [];
      const actualUsage: Array<{
        sessionId: string;
        sequence: number;
        inputTokens: number;
        reported: boolean;
        costUsd: number;
        costProvenance: string | undefined;
        servedModel: string | undefined;
      }> = [];
      const failures: string[] = [];
      const maximumProviderCalls = tasks.reduce(
        (total, task) => total + task.maximumProviderCalls,
        0,
      );
      const maximumToolCalls = tasks.reduce(
        (total, task) => total + task.maximumToolCalls,
        0,
      );
      const maximumTotalInputTokens =
        maximumProviderCalls * proofContextPolicy.maxInputTokens;
      let providerCalls = 0;
      let contextCheckpoints = 0;
      let toolCalls = 0;
      let diagnosticWritten = false;

      try {
        const symbolOracle = await buildIndependentSymbolOracle(
          fixture.workspaceRoot,
        );
        const expectedSymbolOccurrences = symbolOracle.occurrences;

        for (const task of tasks) {
          const session = store.createSession({
            id: `local-repository-investigator:${task.id}`,
            title: task.title,
            objective: task.objective,
            workspaceRoot: fixture.workspaceRoot,
            profile: "economy",
            taskTrack: "repository-investigator-v1",
            completionObligations: {
              requiredSuccessfulTools: task.requiredTools,
              minimumVerifiedPathLineCitations:
                task.minimumVerifiedPathLineCitations,
            },
            executionPolicy: {
              schemaVersion: "agentic-execution-v1",
              inferenceRounds: task.maximumProviderCalls,
              toolCalls: task.maximumToolCalls,
            },
          });
          const runner = new SessionRunner({
            store,
            provider,
            limits: {
              inferenceRounds: task.maximumProviderCalls,
              toolCalls: task.maximumToolCalls,
            },
            context: proofContextPolicy,
          });

          const providerInputStart = provider.inputs.length;
          await runner.startSession(session.id);
          const taskProviderInputs = provider.inputs.slice(providerInputStart);

          const record = store.requireSession(session.id);
          const events = store.getEvents(session.id);
          const result = record.result ?? "";
          const successfulToolEvents = events.filter(
            (event): event is ToolCallCompletedEvent =>
              event.type === "tool.call.completed" && !event.payload.isError,
          );
          const toolNames = successfulToolEvents.map(
            (event) => event.payload.name,
          );
          const toolRequestEvents = events.filter(
            (event): event is ToolCallRequestedEvent =>
              event.type === "tool.call.requested",
          );
          const toolCompletionEvents = events.filter(
            (event): event is ToolCallCompletedEvent =>
              event.type === "tool.call.completed",
          );
          const successfulExecutions = successfulToolExecutions(events);
          const citations = citationsIn(result);
          const usageEvents = events.filter(
            (event) => event.type === "usage.recorded",
          );
          const routeEvents = events.filter(
            (event) => event.type === "route.assigned",
          );
          const createdEvent = events.find(
            (event) => event.type === "session.created",
          );
          const contextEvents = events.filter(
            (event) => event.type === "context.compiled",
          );
          const completionChecks = events.filter(
            (event) => event.type === "completion.obligations.checked",
          );
          const acceptedCompletionChecks = completionChecks.filter(
            (event) => event.payload.outcome === "accepted",
          );
          const toolErrorEvents = events.filter(
            (event): event is ToolCallCompletedEvent =>
              event.type === "tool.call.completed" && event.payload.isError,
          );
          const duplicateObservationEvents = toolErrorEvents.filter(
            (event) =>
              toolErrorCode(event.payload.content) ===
              "DUPLICATE_OBSERVATION",
          );
          const unexpectedToolErrors = toolErrorEvents.filter(
            (event) =>
              toolErrorCode(event.payload.content) !==
              "DUPLICATE_OBSERVATION",
          );
          const finalCompletionCheck = completionChecks.at(-1);
          const verifiedCitations =
            finalCompletionCheck?.payload.verifiedPathLineCitations ?? [];
          let finalRetentionAudit: FinalPacketRetentionAudit | null = null;
          if (acceptedCompletionChecks.length !== 1) {
            failures.push(
              `${task.id}: expected exactly one accepted completion check; got ${acceptedCompletionChecks.length}`,
            );
          } else {
            const acceptedCheck = acceptedCompletionChecks[0]!;
            const acceptedRound = acceptedCheck.payload.round;
            const acceptedInput = taskProviderInputs[acceptedRound - 1];
            const acceptedContexts = contextEvents.filter(
              (event) =>
                event.payload.checkpointId ===
                `${session.id}:context:${acceptedRound}`,
            );
            const acceptedContext =
              acceptedContexts.length === 1 ? acceptedContexts[0] : undefined;
            if (acceptedInput === undefined || acceptedContext === undefined) {
              failures.push(
                `${task.id}: accepted completion round ${acceptedRound} requires one captured provider input and one persisted context checkpoint; got ${acceptedInput === undefined ? 0 : 1} input and ${acceptedContexts.length} checkpoints`,
              );
            } else {
              try {
                const retention = finalPacketRetentionAudit({
                  input: acceptedInput,
                  acceptedRound,
                  expectedContextPacketSha256:
                    acceptedContext.payload.packetSha256,
                  expectedContextMessagesSha256:
                    acceptedContext.payload.messagesSha256,
                  requirements: task.claimCoverage ?? [],
                  verifiedAnswerCitations:
                    acceptedCheck.payload.verifiedPathLineCitations,
                  expectedSymbolOccurrences:
                    task.requiresExactSymbolAudit === true
                      ? expectedSymbolOccurrences
                      : [],
                  expectedSymbolSearchArguments:
                    task.requiresExactSymbolAudit === true
                      ? symbolGlobalPacketArguments
                      : undefined,
                });
                finalRetentionAudit = retention.audit;
                failures.push(
                  ...retention.failures.map(
                    (failure) => `${task.id}: ${failure}`,
                  ),
                );
              } catch (error) {
                failures.push(
                  `${task.id}: accepted provider input retention audit failed to parse: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                );
              }
            }
          }
          actualUsage.push(
            ...usageEvents.map((event) => ({
              sessionId: session.id,
              sequence: event.sequence,
              inputTokens: event.payload.inputTokens,
              reported: event.payload.reported === true,
              costUsd: event.payload.costUsd,
              costProvenance: event.payload.costProvenance,
              servedModel: event.payload.servedModel,
            })),
          );
          providerCalls += usageEvents.length;
          contextCheckpoints += contextEvents.length;
          toolCalls += toolRequestEvents.length;

          proofTasks.push({
            id: task.id,
            objective: task.objective,
            limits: {
              providerCalls: task.maximumProviderCalls,
              toolCalls: task.maximumToolCalls,
            },
            record,
            result,
            citations: [...citations].sort(),
            completionChecks,
            taskTrack:
              createdEvent?.type === "session.created"
                ? createdEvent.payload.taskTrack
                : undefined,
            executionPolicy:
              createdEvent?.type === "session.created"
                ? createdEvent.payload.executionPolicy
                : undefined,
            duplicateObservations: duplicateObservationEvents.length,
            acceptedAnswerInputRetention: finalRetentionAudit,
            context: {
              checkpoints: contextEvents.length,
              totalEstimatedTokens: contextEvents.reduce(
                (total, event) => total + event.payload.estimatedTokens,
                0,
              ),
              maximumEstimatedTokens: Math.max(
                0,
                ...contextEvents.map((event) => event.payload.estimatedTokens),
              ),
              deduplicatedEvidence: contextEvents.reduce(
                (total, event) =>
                  total + event.payload.deduplicatedEvidenceCount,
                0,
              ),
              omittedEvidence: contextEvents.reduce(
                (total, event) => total + event.payload.omittedEvidenceCount,
                0,
              ),
            },
            events,
          });

          recordFailure(
            failures,
            record.status === "completed",
            `${task.id}: expected completed status; got ${record.status}: ${
              record.error ?? "no result"
            }`,
          );
          recordFailure(
            failures,
            record.totalCostUsd === 0,
            `${task.id}: expected zero route cost; got ${record.totalCostUsd}`,
          );
          recordFailure(
            failures,
            result.trim().length > 0,
            `${task.id}: expected a visible result`,
          );
          recordFailure(
            failures,
            citations.size >= task.minimumVerifiedPathLineCitations,
            `${task.id}: expected at least ${task.minimumVerifiedPathLineCitations} path:line citations; got ${citations.size}`,
          );
          recordFailure(
            failures,
            finalCompletionCheck?.payload.outcome === "accepted",
            `${task.id}: expected the final completion-obligation check to be accepted`,
          );
          recordFailure(
            failures,
            verifiedCitations.length >=
              task.minimumVerifiedPathLineCitations,
            `${task.id}: completion guard accepted fewer than ${task.minimumVerifiedPathLineCitations} verified citations`,
          );
          failures.push(
            ...(await citationFailures(fixture.workspaceRoot, citations)).map(
              (failure) => `${task.id}: ${failure}`,
            ),
          );
          recordFailure(
            failures,
            routeEvents.length === 1 &&
              routeEvents[0]?.payload.providerId === provider.id &&
              routeEvents[0].payload.model === proofModel,
            `${task.id}: expected exactly one route trace for ${provider.id}/${proofModel}`,
          );
          recordFailure(
            failures,
            createdEvent?.type === "session.created" &&
              createdEvent.payload.taskTrack ===
                "repository-investigator-v1",
            `${task.id}: persisted task track must be repository-investigator-v1`,
          );
          recordFailure(
            failures,
            createdEvent?.type === "session.created" &&
              createdEvent.payload.executionPolicy?.schemaVersion ===
                "agentic-execution-v1" &&
              createdEvent.payload.executionPolicy.inferenceRounds ===
                task.maximumProviderCalls &&
              createdEvent.payload.executionPolicy.toolCalls ===
                task.maximumToolCalls,
            `${task.id}: persisted execution policy must match the task provider/tool bounds`,
          );
          recordFailure(
            failures,
            contextEvents.length === usageEvents.length,
            `${task.id}: expected one context checkpoint per provider call; got ${contextEvents.length} checkpoints and ${usageEvents.length} usage events`,
          );
          recordFailure(
            failures,
            taskProviderInputs.length === contextEvents.length,
            `${task.id}: expected one captured provider input per context checkpoint; got ${taskProviderInputs.length} inputs and ${contextEvents.length} checkpoints`,
          );
          recordFailure(
            failures,
            contextEvents.length > 0,
            `${task.id}: expected at least one context checkpoint`,
          );
          recordFailure(
            failures,
            usageEvents.length <= task.maximumProviderCalls,
            `${task.id}: provider calls ${usageEvents.length} exceed the bound ${task.maximumProviderCalls}`,
          );
          recordFailure(
            failures,
            toolRequestEvents.length <= task.maximumToolCalls,
            `${task.id}: tool calls ${toolRequestEvents.length} exceed the bound ${task.maximumToolCalls}`,
          );
          recordFailure(
            failures,
            toolCompletionEvents.length === toolRequestEvents.length,
            `${task.id}: expected every requested tool call to have one completion; got ${toolRequestEvents.length} requests and ${toolCompletionEvents.length} completions`,
          );
          recordFailure(
            failures,
            usageEvents.every(
              (event) =>
                event.payload.reported && event.payload.inputTokens > 0,
            ),
            `${task.id}: every provider call must report positive actual input usage`,
          );
          recordFailure(
            failures,
            usageEvents.every(
              (event) =>
                event.payload.inputTokens <=
                proofContextPolicy.maxInputTokens,
            ),
            `${task.id}: every provider call must remain within the configured actual input cap`,
          );
          recordFailure(
            failures,
            usageEvents.every(
              (event) =>
                event.payload.costUsd === 0 &&
                event.payload.costProvenance ===
                  "local_zero_cost_policy",
            ),
            `${task.id}: every provider call must attest the local zero-cost policy and record zero cost`,
          );
          recordFailure(
            failures,
            usageEvents.every(
              (event) => event.payload.servedModel === proofModel,
            ),
            `${task.id}: every provider response must attest servedModel=${JSON.stringify(proofModel)}`,
          );
          recordFailure(
            failures,
            contextEvents.every(
              (event) =>
                event.payload.estimatedTokens <=
                  event.payload.effectiveInputTokenBudget &&
                event.payload.maxTokens ===
                  proofContextPolicy.maxInputTokens &&
                event.payload.providerId === provider.id &&
                event.payload.model === proofModel &&
                event.payload.reservedInputTokens > 0 &&
                /^[a-f0-9]{64}$/u.test(event.payload.packetSha256) &&
                /^[a-f0-9]{64}$/u.test(event.payload.messagesSha256),
            ),
            `${task.id}: expected bounded, hashed context checkpoints`,
          );
          recordFailure(
            failures,
            unexpectedToolErrors.length === 0,
            `${task.id}: expected no unexpected tool errors; got ${unexpectedToolErrors.length}`,
          );
          recordFailure(
            failures,
            duplicateObservationEvents.length <= 2,
            `${task.id}: duplicate-observation guard exceeded its two-event bound`,
          );
          recordFailure(
            failures,
            followsOrderedToolSequence(toolNames, task.requiredTools),
            `${task.id}: successful required tools did not follow the persisted order ${task.requiredTools.join(" -> ")}`,
          );

          if (task.claimCoverage !== undefined) {
            failures.push(
              ...(await claimCoverageFailures({
                workspaceRoot: fixture.workspaceRoot,
                result,
                requirements: task.claimCoverage,
                verifiedCitations,
              })).map((failure) => `${task.id}: ${failure}`),
            );
          }

          if (
            task.architectureDiscoverySchedule !== undefined &&
            task.orderedEvidenceSearches !== undefined
          ) {
            failures.push(
              ...architectureDiscoveryScheduleFailures(
                successfulExecutions,
                task.architectureDiscoverySchedule,
                task.orderedEvidenceSearches,
              ).map((failure) => `${task.id}: ${failure}`),
            );
          } else if (task.orderedEvidenceSearches !== undefined) {
            failures.push(
              ...orderedEvidenceSearchFailures(
                successfulExecutions,
                task.orderedEvidenceSearches,
              ).map((failure) => `${task.id}: ${failure}`),
            );
          }

          if (
            task.requiresClaimEvidenceReads === true &&
            task.claimCoverage !== undefined
          ) {
            failures.push(
              ...claimEvidenceReadFailures(
                successfulExecutions,
                task.claimCoverage,
              ).map((failure) => `${task.id}: ${failure}`),
              ...orderedClaimEvidenceReadFailures(
                successfulExecutions,
                task.claimCoverage,
              ).map((failure) => `${task.id}: ${failure}`),
            );
          }

          if (
            task.requiresClaimEvidenceSearches === true &&
            task.claimCoverage !== undefined
          ) {
            failures.push(
              ...claimEvidenceSupportingSearchFailures(
                successfulExecutions,
                task.claimCoverage,
              ).map((failure) => `${task.id}: ${failure}`),
            );
          }

          if (task.requiresCallPathProse === true) {
            failures.push(
              ...callPathProseFailures(result).map(
                (failure) => `${task.id}: ${failure}`,
              ),
            );
          }

          if (task.requiresExactSymbolAudit === true) {
            failures.push(
              ...finalRecordSuffixFailures(result).map(
                (failure) => `${task.id}: ${failure}`,
              ),
              ...completeSymbolSearchFailures(
                successfulExecutions,
                expectedSymbolOccurrences,
              ).map((failure) => `${task.id}: ${failure}`),
              ...symbolAuditFailures({
                result,
                expectedOccurrences: expectedSymbolOccurrences,
                verifiedCitations,
              }).map((failure) => `${task.id}: ${failure}`),
            );
          }
        }

        const totals = store.listSessions({ limit: tasks.length }).reduce(
          (sum, session) => ({
            costUsd: sum.costUsd + session.totalCostUsd,
            inputTokens: sum.inputTokens + session.totalInputTokens,
            visibleOutputTokens: sum.visibleOutputTokens + session.totalOutputTokens,
            reasoningTokens: sum.reasoningTokens + session.totalReasoningTokens,
            latencyMs: sum.latencyMs + session.totalLatencyMs,
          }),
          {
            costUsd: 0,
            inputTokens: 0,
            visibleOutputTokens: 0,
            reasoningTokens: 0,
            latencyMs: 0,
          },
        );
        recordFailure(
          failures,
          proofTasks.length === tasks.length,
          `expected ${tasks.length} completed proof task traces; got ${proofTasks.length}`,
        );
        recordFailure(
          failures,
          totals.costUsd === 0,
          `expected zero total cost; got ${totals.costUsd}`,
        );
        recordFailure(
          failures,
          providerCalls === contextCheckpoints,
          `expected one context checkpoint per provider call; got ${providerCalls} provider calls and ${contextCheckpoints} checkpoints`,
        );
        recordFailure(
          failures,
          actualUsage.length === providerCalls,
          `expected one actual-usage record per provider call; got ${actualUsage.length} usage records and ${providerCalls} provider calls`,
        );
        recordFailure(
          failures,
          actualUsage.every(
            (usage) =>
              usage.reported &&
              usage.inputTokens > 0 &&
              usage.costUsd === 0 &&
              usage.costProvenance === "local_zero_cost_policy" &&
              usage.servedModel === proofModel,
          ),
          "every provider call must report positive actual input usage, local-zero-cost provenance, zero cost, and the pinned served model",
        );
        recordFailure(
          failures,
          actualUsage.every(
            (usage) =>
              usage.inputTokens <= proofContextPolicy.maxInputTokens,
          ),
          `every provider call must stay within the ${proofContextPolicy.maxInputTokens}-token configured input cap`,
        );
        recordFailure(
          failures,
          totals.inputTokens ===
            actualUsage.reduce(
              (total, usage) => total + usage.inputTokens,
              0,
            ),
          "persisted total input usage must equal the sum of provider-call usage records",
        );
        recordFailure(
          failures,
          providerCalls <= maximumProviderCalls,
          `provider calls ${providerCalls} exceed the episode bound ${maximumProviderCalls}`,
        );
        recordFailure(
          failures,
          toolCalls <= maximumToolCalls,
          `tool calls ${toolCalls} exceed the episode bound ${maximumToolCalls}`,
        );
        recordFailure(
          failures,
          totals.inputTokens <= maximumTotalInputTokens,
          `total input usage ${totals.inputTokens} exceeds the derived ${maximumTotalInputTokens}-token episode cap`,
        );

        let publicationRepository: RepositoryProofIdentity | undefined;
        let publicationRepositoryError: string | undefined;
        try {
          publicationRepository = await readRepositoryProofIdentity(projectRoot);
          recordFailure(
            failures,
            publicationRepository.revision === repository.revision,
            `Git HEAD changed during the proof from ${repository.revision} to ${publicationRepository.revision}`,
          );
          recordFailure(
            failures,
            publicationRepository.revision === declaredRevision,
            `Git HEAD at publication ${publicationRepository.revision} no longer matches SOAR_PROOF_REVISION ${declaredRevision}`,
          );
        } catch (error) {
          publicationRepositoryError =
            error instanceof Error ? error.message : String(error);
          failures.push(
            `repository publication check failed: ${publicationRepositoryError}`,
          );
        }

        const passed = failures.length === 0;
        const comparison = {
          status: "not-performed",
          reason:
            "The historical reference is non-comparable: its revision was dirty, its fixture was unhashed, and its validator contract differed.",
          historicalReference: nonComparableHistoricalReference,
          candidate: {
            revision: repository.revision,
            clean: repository.clean,
            model: config.vllm.model,
            apiBaseSha256: endpointAttestation.apiBaseSha256,
            fixtureArchiveSha256: fixture.archiveSha256,
            taskLimits: tasks.map((task) => ({
              id: task.id,
              maximumProviderCalls: task.maximumProviderCalls,
              maximumToolCalls: task.maximumToolCalls,
            })),
            context: proofContextPolicy,
          },
        } as const;
        const reportBase = {
          schemaVersion: proofSchemaVersion,
          runType: proofRunType,
          methodology: {
            disclosure: proofMethodologyDisclosure,
            evaluatorContractAgentVisible: true,
            blindDiscoveryClaimed: false,
            qualityBenchmarkClaimed: false,
          },
          createdAt: new Date().toISOString(),
          provider: {
            id: provider.id,
            configuredModel: provider.model,
            requiredServedModel: proofModel,
            requiredCostProvenance: "local_zero_cost_policy",
            endpointAttestation,
          },
          workspace: {
            kind: "isolated-pinned-git-archive",
            sourceRevision: fixture.sourceRevision,
            sourceClean: repository.clean,
            archiveSha256: fixture.archiveSha256,
            evaluatorSourceExcluded: [...fixture.excludedPaths],
          },
          publicationCheck: {
            declaredRevision,
            start: repository,
            end: publicationRepository ?? null,
            ...(publicationRepositoryError === undefined
              ? {}
              : { error: publicationRepositoryError }),
          },
          artifactPolicy: {
            acceptedPath: path.relative(projectRoot, acceptedOutputPath),
            diagnosticPath: path.relative(projectRoot, diagnosticOutputPath),
            ambiguousLegacyNamesIgnored: ambiguousLegacyArtifactPaths.map(
              (artifactPath) => path.relative(projectRoot, artifactPath),
            ),
            quarantinedBeforeRun,
          },
          evaluator: {
            symbolOracle,
            claimContractScope:
              "Evaluator-owned structural path, source-snippet, relational-summary, citation-evidence, ordered evidence-search, required-read, post-read supporting-search, and ordered call-path relationship coverage; unrestricted prose is not otherwise semantically graded.",
            claimContract: tasks.map((task) => ({
              id: task.id,
              minimumVerifiedPathLineCitations:
                task.minimumVerifiedPathLineCitations,
              claimCoverage: task.claimCoverage ?? null,
              requiredReadEvidencePaths:
                task.requiresClaimEvidenceReads === true
                  ? requiredClaimEvidencePaths(task.claimCoverage ?? [])
                  : [],
              requiredSupportingSearches:
                task.requiresClaimEvidenceSearches === true
                  ? requiredSupportingSearches(task.claimCoverage ?? [])
                  : [],
              requiredOrderedEvidenceSearches:
                task.orderedEvidenceSearches ?? [],
              requiredArchitectureDiscoverySchedule:
                task.architectureDiscoverySchedule ?? null,
              requiredOrderedCallPathRelationships:
                task.requiresCallPathProse === true
                  ? [...symbolCallPathProseRelationships]
                  : [],
              requiresExactSymbolAudit:
                task.requiresExactSymbolAudit ?? false,
            })),
          },
          comparison,
          acceptance: {
            taskValidatorContract:
              "architecture-schedule-relational-claim-ordered-evidence-read-post-read-exact-arguments-final-record-suffix-and-exact-global-search-symbol-occurrences-v6",
            maximumProviderCalls,
            maximumToolCalls,
            maximumInputTokensPerCall:
              proofContextPolicy.maxInputTokens,
            maximumTotalInputTokens,
            requiredCostUsd: 0,
            requiredCostProvenance: "local_zero_cost_policy",
            requiredServedModel: proofModel,
            requiredTaskTrack: "repository-investigator-v1",
            requiredEndpointAttestation: true,
            requiredAcceptedAnswerContextRetention: true,
          },
          contextPolicy: proofContextPolicy,
          totals: {
            ...totals,
            providerCalls,
            toolCalls,
            contextCheckpoints,
            maximumActualInputTokens: Math.max(
              0,
              ...actualUsage.map((usage) => usage.inputTokens),
            ),
          },
          usageAttestations: actualUsage,
          tasks: proofTasks,
        };

        if (!passed) {
          const diagnosticReport = {
            ...reportBase,
            artifactKind: "failed-live-proof-diagnostic",
            passed: false,
            failures: [...failures],
          } as const;
          await writeProofArtifact(
            diagnosticOutputPath,
            diagnosticReport,
            proofArtifactRedactions(fixture),
          );
          diagnosticWritten = true;
          throw new Error(
            `Local Repository Investigator proof failed ${failures.length} acceptance gate(s). ` +
              `Diagnostic artifact: ${diagnosticOutputPath}\n- ${failures.join("\n- ")}`,
          );
        }

        const acceptedReport = {
          ...reportBase,
          artifactKind: "accepted-live-proof",
          passed: true,
          failures: [],
        } as const;
        await writeProofArtifact(
          acceptedOutputPath,
          acceptedReport,
          proofArtifactRedactions(fixture),
        );
      } catch (error) {
        if (!diagnosticWritten) {
          const failureMessage =
            error instanceof Error ? error.message : String(error);
          const unexpectedDiagnostic = {
            schemaVersion: proofSchemaVersion,
            artifactKind: "failed-live-proof-diagnostic",
            passed: false,
            failures: [
              `The live proof aborted before normal gate publication: ${failureMessage}`,
            ],
            runType: proofRunType,
            methodology: {
              disclosure: proofMethodologyDisclosure,
              evaluatorContractAgentVisible: true,
              blindDiscoveryClaimed: false,
              qualityBenchmarkClaimed: false,
            },
            createdAt: new Date().toISOString(),
            provider: {
              id: provider.id,
              configuredModel: provider.model,
              requiredServedModel: proofModel,
              requiredCostProvenance: "local_zero_cost_policy",
              endpointAttestation,
            },
            workspace: {
              kind: "isolated-pinned-git-archive",
              sourceRevision: fixture.sourceRevision,
              sourceClean: repository.clean,
              archiveSha256: fixture.archiveSha256,
              evaluatorSourceExcluded: [...fixture.excludedPaths],
            },
            publicationCheck: {
              declaredRevision,
              start: repository,
              end: null,
              error: "Normal publication checks did not complete.",
            },
            artifactPolicy: {
              acceptedPath: path.relative(projectRoot, acceptedOutputPath),
              diagnosticPath: path.relative(
                projectRoot,
                diagnosticOutputPath,
              ),
              ambiguousLegacyNamesIgnored:
                ambiguousLegacyArtifactPaths.map((artifactPath) =>
                  path.relative(projectRoot, artifactPath),
                ),
              quarantinedBeforeRun,
            },
            contextPolicy: proofContextPolicy,
            partial: {
              providerCalls,
              contextCheckpoints,
              toolCalls,
              usageAttestations: actualUsage,
              tasks: proofTasks,
            },
          } as const;
          await writeProofArtifact(
            diagnosticOutputPath,
            unexpectedDiagnostic,
            proofArtifactRedactions(fixture),
          );
        }
        throw error;
      } finally {
        database.close();
        await rm(fixture.temporaryRoot, { recursive: true, force: true });
      }
    },
    20 * 60_000,
  );
});
