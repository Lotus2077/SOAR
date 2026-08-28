import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, it } from "vitest";

import { SessionRunner } from "../../src/main/agent/run-session";
import { loadConfig } from "../../src/main/config";
import { createSoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { OpenAICompatibleProvider } from "../../src/main/providers/openai-compatible";
import { searchText } from "../../src/main/tools/search-text";

const runLive = process.env.SOAR_RUN_LIVE_REPOSITORY === "true";
const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const citationPattern = /(?:^|[\s(`])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+):(\d+)/gmu;
const execFileAsync = promisify(execFile);
const proofLimits = { inferenceRounds: 20, toolCalls: 24 } as const;
const historicalBaseline = {
  inputTokens: 934_311,
  toolCalls: 46,
  providerCalls: 49,
  latencyMs: 434_373,
  citations: 98,
  model: "RM-01 VLM",
  limits: proofLimits,
  revision: "f221798+working-tree",
} as const;
const maximumAcceptedInputTokens = Math.floor(
  historicalBaseline.inputTokens * 0.4,
);

interface ProofTask {
  id: string;
  title: string;
  objective: string;
  requiredTools: string[];
  requiredPaths: string[];
}

interface RepositoryProofIdentity {
  revision: string;
  clean: true;
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

const symbol = `${"cancel"}${"Session"}`;

const tasks: ProofTask[] = [
  {
    id: "architecture",
    title: "Summarize repository architecture",
    objective:
      "Treat this as an unfamiliar repository. Use list_files to map its structure, then " +
      "search_text and read_text_file to verify the important entry points. Summarize the " +
      "architecture, runtime flow, persistence model, and test layers. Cite every substantive " +
      "claim as an exact workspace-relative path and 1-based line number confirmed by a tool result.",
    requiredTools: ["list_files", "read_text_file"],
    requiredPaths: ["src/main/", "src/renderer/", "src/shared/"],
  },
  {
    id: "cancellation",
    title: "Trace session cancellation",
    objective:
      `Find where session cancellation is implemented and identify its tests. Use search_text ` +
      `for the exact symbol ${symbol}, read the relevant implementation and test files, and explain ` +
      "the call path from UI or IPC to the running inference and tool signal. Cite exact " +
      "workspace-relative path:line references confirmed by tool results.",
    requiredTools: ["search_text", "read_text_file"],
    requiredPaths: [
      "src/main/agent/run-session.ts",
      "src/main/ipc.ts",
      "tests/integration/run-session.test.ts",
    ],
  },
  {
    id: "symbol-references",
    title: "Locate every symbol reference",
    objective:
      `Use search_text with the exact literal symbol ${symbol} across the entire workspace. ` +
      "List every returned occurrence exactly once as workspace-relative path:line, state whether " +
      "the search was truncated, then read the relevant files and explain the end-to-end call path. " +
      "Do not omit test or renderer references.",
    requiredTools: ["search_text", "read_text_file"],
    requiredPaths: [],
  },
];

function citationsIn(result: string): Set<string> {
  const citations = new Set<string>();
  for (const match of result.matchAll(citationPattern)) {
    citations.add(`${match[1]}:${match[2]}`);
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

async function citationFailures(citations: Set<string>): Promise<string[]> {
  const failures: string[] = [];
  for (const citation of citations) {
    const separator = citation.lastIndexOf(":");
    const relativePath = citation.slice(0, separator);
    const lineNumber = Number(citation.slice(separator + 1));
    const absolutePath = path.resolve(projectRoot, relativePath);
    const resolvedRelative = path.relative(projectRoot, absolutePath);
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

describe.skipIf(!runLive)("Local Repository Investigator v1", () => {
  it(
    "completes three unfamiliar-repository tasks at zero cost with cited, replayable traces",
    async () => {
      const declaredRevision = requireProofEnvironment("SOAR_PROOF_REVISION");
      const expectedModel = requireProofEnvironment("SOAR_PROOF_MODEL");
      const repository = await readRepositoryProofIdentity(projectRoot);
      if (declaredRevision !== repository.revision) {
        throw new Error(
          `SOAR_PROOF_REVISION must equal the clean Git HEAD ${repository.revision}.`,
        );
      }
      if (expectedModel !== historicalBaseline.model) {
        throw new Error(
          `SOAR_PROOF_MODEL must equal the baseline model ${JSON.stringify(
            historicalBaseline.model,
          )}.`,
        );
      }
      const config = loadConfig();
      if (expectedModel !== config.vllm.model) {
        throw new Error(
          `SOAR_PROOF_MODEL ${JSON.stringify(expectedModel)} does not match the configured model ` +
            `${JSON.stringify(config.vllm.model)}.`,
        );
      }
      const database = createSoarDatabase();
      const store = new EventStore(database);
      const provider = new OpenAICompatibleProvider(config.vllm);
      const proofTasks: Array<Record<string, unknown>> = [];
      const actualUsage: Array<{ inputTokens: number; reported: boolean }> = [];
      const failures: string[] = [];

      try {
        const expectedSymbolMatches = await searchText({
          workspaceRoot: projectRoot,
          query: symbol,
          maxMatches: 200,
        });
        recordFailure(
          failures,
          !expectedSymbolMatches.truncated,
          "symbol fixture search must not be truncated",
        );

        for (const task of tasks) {
          const session = store.createSession({
            id: `local-repository-investigator:${task.id}`,
            title: task.title,
            objective: task.objective,
            workspaceRoot: projectRoot,
            profile: "economy",
          });
          const runner = new SessionRunner({
            store,
            provider,
            limits: proofLimits,
            context: config.context,
          });

          await runner.startSession(session.id);

          const record = store.requireSession(session.id);
          const events = store.getEvents(session.id);
          const result = record.result ?? "";
          const toolNames = events
            .filter((event) => event.type === "tool.call.completed")
            .map((event) => event.payload.name);
          const citations = citationsIn(result);
          const usageEvents = events.filter(
            (event) => event.type === "usage.recorded",
          );
          const contextEvents = events.filter(
            (event) => event.type === "context.compiled",
          );
          actualUsage.push(
            ...usageEvents.map((event) => ({
              inputTokens: event.payload.inputTokens,
              reported: event.payload.reported === true,
            })),
          );

          proofTasks.push({
            id: task.id,
            objective: task.objective,
            record,
            result,
            citations: [...citations].sort(),
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
            citations.size >= 2,
            `${task.id}: expected at least two path:line citations; got ${citations.size}`,
          );
          failures.push(
            ...(await citationFailures(citations)).map(
              (failure) => `${task.id}: ${failure}`,
            ),
          );
          recordFailure(
            failures,
            events.filter((event) => event.type === "route.assigned").length === 1,
            `${task.id}: expected exactly one route trace`,
          );
          recordFailure(
            failures,
            contextEvents.length === usageEvents.length,
            `${task.id}: expected one context checkpoint per provider call; got ${contextEvents.length} checkpoints and ${usageEvents.length} usage events`,
          );
          recordFailure(
            failures,
            contextEvents.length > 0,
            `${task.id}: expected at least one context checkpoint`,
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
                event.payload.inputTokens <= config.context.maxInputTokens,
            ),
            `${task.id}: every provider call must remain within the configured actual input cap`,
          );
          recordFailure(
            failures,
            contextEvents.every(
              (event) =>
                event.payload.estimatedTokens <=
                  event.payload.effectiveInputTokenBudget &&
                event.payload.maxTokens === config.context.maxInputTokens &&
                event.payload.reservedInputTokens > 0 &&
                /^[a-f0-9]{64}$/u.test(event.payload.packetSha256) &&
                /^[a-f0-9]{64}$/u.test(event.payload.messagesSha256),
            ),
            `${task.id}: expected bounded, hashed context checkpoints`,
          );
          recordFailure(
            failures,
            !events.some(
              (event) => event.type === "tool.call.completed" && event.payload.isError,
            ),
            `${task.id}: expected no tool errors`,
          );
          for (const toolName of task.requiredTools) {
            recordFailure(
              failures,
              toolNames.includes(toolName),
              `${task.id}: missing required tool ${toolName}`,
            );
          }
          for (const requiredPath of task.requiredPaths) {
            recordFailure(
              failures,
              result.includes(requiredPath),
              `${task.id}: result is missing required path ${requiredPath}`,
            );
          }

          if (task.id === "symbol-references") {
            for (const match of expectedSymbolMatches.matches) {
              const expectedCitation = `${match.path}:${match.lineNumber}`;
              recordFailure(
                failures,
                citations.has(expectedCitation),
                `${task.id}: missing symbol reference ${expectedCitation}`,
              );
            }
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
        const providerCalls = proofTasks.reduce(
          (total, task) =>
            total +
            ((task.events as Array<{ type: string }>).filter(
              (event) => event.type === "usage.recorded",
            ).length),
          0,
        );
        const contextCheckpoints = proofTasks.reduce(
          (total, task) =>
            total +
            ((task.events as Array<{ type: string }>).filter(
              (event) => event.type === "context.compiled",
            ).length),
          0,
        );
        const toolCalls = proofTasks.reduce(
          (total, task) =>
            total +
            ((task.events as Array<{ type: string }>).filter(
              (event) => event.type === "tool.call.completed",
            ).length),
          0,
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
            (usage) => usage.reported && usage.inputTokens > 0,
          ),
          "every provider call must report positive actual input usage",
        );
        recordFailure(
          failures,
          actualUsage.every(
            (usage) => usage.inputTokens <= config.context.maxInputTokens,
          ),
          `every provider call must stay within the ${config.context.maxInputTokens}-token configured input cap`,
        );
        recordFailure(
          failures,
          totals.inputTokens <= maximumAcceptedInputTokens,
          `total input usage ${totals.inputTokens} exceeds the ${maximumAcceptedInputTokens}-token acceptance ceiling`,
        );

        const outputDirectory = path.join(projectRoot, "benchmarks", "runs");
        const canonicalOutputPath = path.join(
          outputDirectory,
          "local-repository-investigator-v1.json",
        );
        const diagnosticOutputPath = path.join(
          outputDirectory,
          "local-repository-investigator-v1.failed.json",
        );
        await mkdir(outputDirectory, { recursive: true });

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
          baseline: historicalBaseline,
          candidate: {
            revision: repository.revision,
            clean: repository.clean,
            model: config.vllm.model,
            limits: proofLimits,
            context: config.context,
          },
        } as const;
        const report = {
          schemaVersion: 2,
          artifactKind: passed
            ? "accepted-live-proof"
            : "failed-live-proof-diagnostic",
          passed,
          failures: [...failures],
          runType: "context-handoff-engine-v1",
          createdAt: new Date().toISOString(),
          provider: { id: provider.id, model: provider.model },
          workspace: {
            kind: "repository",
            revision: repository.revision,
            clean: repository.clean,
          },
          publicationCheck: {
            declaredRevision,
            start: repository,
            end: publicationRepository ?? null,
            ...(publicationRepositoryError === undefined
              ? {}
              : { error: publicationRepositoryError }),
          },
          baseline: historicalBaseline,
          comparison,
          acceptance: {
            maximumInputTokens: maximumAcceptedInputTokens,
            requiredReduction: 0.6,
            validatorParityTasks: tasks.length,
            requiredCostUsd: 0,
          },
          contextPolicy: config.context,
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
          tasks: proofTasks,
        };
        const outputPath = passed
          ? canonicalOutputPath
          : diagnosticOutputPath;
        await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

        if (!passed) {
          throw new Error(
            `Local Repository Investigator proof failed ${failures.length} acceptance gate(s). ` +
              `Diagnostic artifact: ${diagnosticOutputPath}\n- ${failures.join("\n- ")}`,
          );
        }
      } finally {
        database.close();
      }
    },
    20 * 60_000,
  );
});
