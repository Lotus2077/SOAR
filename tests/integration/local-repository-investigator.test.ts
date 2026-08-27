import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SessionRunner } from "../../src/main/agent/run-session";
import { loadConfig } from "../../src/main/config";
import { createSoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { OpenAICompatibleProvider } from "../../src/main/providers/openai-compatible";
import { searchText } from "../../src/main/tools/search-text";

const runLive = process.env.SOAR_RUN_LIVE_REPOSITORY === "true";
const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const citationPattern = /(?:^|[\s(`])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+):(\d+)/gmu;

interface ProofTask {
  id: string;
  title: string;
  objective: string;
  requiredTools: string[];
  requiredPaths: string[];
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

async function validateCitations(citations: Set<string>): Promise<void> {
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
    expect.soft(
      insideWorkspace,
      `citation remains inside the workspace: ${citation}`,
    ).toBe(true);
    if (!insideWorkspace) continue;

    let contents: string;
    try {
      contents = await readFile(absolutePath, "utf8");
    } catch {
      expect.soft(false, `citation path exists: ${citation}`).toBe(true);
      continue;
    }
    const lineCount = contents.split(/\r\n|\n|\r/u).length;
    expect.soft(
      Number.isSafeInteger(lineNumber) && lineNumber >= 1 && lineNumber <= lineCount,
      `citation resolves to a real line: ${citation}`,
    ).toBe(true);
  }
}

describe.skipIf(!runLive)("Local Repository Investigator v1", () => {
  it(
    "completes three unfamiliar-repository tasks at zero cost with cited, replayable traces",
    async () => {
      const config = loadConfig();
      const database = createSoarDatabase();
      const store = new EventStore(database);
      const provider = new OpenAICompatibleProvider(config.vllm);
      const proofTasks: Array<Record<string, unknown>> = [];

      try {
        const expectedSymbolMatches = await searchText({
          workspaceRoot: projectRoot,
          query: symbol,
          maxMatches: 200,
        });
        expect(expectedSymbolMatches.truncated).toBe(false);

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
            limits: { inferenceRounds: 20, toolCalls: 24 },
          });

          await runner.startSession(session.id);

          const record = store.requireSession(session.id);
          const events = store.getEvents(session.id);
          const result = record.result ?? "";
          const toolNames = events
            .filter((event) => event.type === "tool.call.completed")
            .map((event) => event.payload.name);
          const citations = citationsIn(result);

          proofTasks.push({
            id: task.id,
            objective: task.objective,
            record,
            result,
            citations: [...citations].sort(),
            events,
          });

          expect.soft(record.status, `${task.id}: ${record.error ?? "no result"}`).toBe("completed");
          expect.soft(record.totalCostUsd, `${task.id}: route cost`).toBe(0);
          expect.soft(result.trim().length, `${task.id}: visible result`).toBeGreaterThan(0);
          expect.soft(citations.size, `${task.id}: path:line citations`).toBeGreaterThanOrEqual(2);
          await validateCitations(citations);
          expect.soft(
            events.filter((event) => event.type === "route.assigned"),
            `${task.id}: one route trace`,
          ).toHaveLength(1);
          expect.soft(
            events.some(
              (event) => event.type === "tool.call.completed" && event.payload.isError,
            ),
            `${task.id}: tool errors`,
          ).toBe(false);
          for (const toolName of task.requiredTools) {
            expect.soft(toolNames, `${task.id}: required tool ${toolName}`).toContain(toolName);
          }
          for (const requiredPath of task.requiredPaths) {
            expect.soft(result, `${task.id}: required path ${requiredPath}`).toContain(requiredPath);
          }

          if (task.id === "symbol-references") {
            for (const match of expectedSymbolMatches.matches) {
              const expectedCitation = `${match.path}:${match.lineNumber}`;
              expect.soft(citations, `symbol reference ${expectedCitation}`).toContain(
                expectedCitation,
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
          }),
          { costUsd: 0, inputTokens: 0, visibleOutputTokens: 0, reasoningTokens: 0 },
        );
        const report = {
          schemaVersion: 1,
          runType: "local-repository-investigator-v1",
          createdAt: new Date().toISOString(),
          provider: { id: provider.id, model: provider.model },
          workspace: { kind: "repository", revision: process.env.SOAR_PROOF_REVISION ?? "working-tree" },
          totals,
          tasks: proofTasks,
        };
        const outputDirectory = path.join(projectRoot, "benchmarks", "runs");
        const outputPath = path.join(outputDirectory, "local-repository-investigator-v1.json");
        await mkdir(outputDirectory, { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

        expect(totals.costUsd).toBe(0);
      } finally {
        database.close();
      }
    },
    20 * 60_000,
  );
});
