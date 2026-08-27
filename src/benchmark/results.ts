import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveWorkload } from "./catalog.ts";
import { sha256File } from "./fixture-cache.ts";
import type { BenchmarkRunRecord, EvaluationOutcome } from "./types.ts";

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error(`${label} contains unsafe path characters: ${value}`);
  }
  return value;
}

export async function exportRunRecord(options: {
  projectRoot: string;
  runId: string;
  workloadId: string;
  policy: string;
  submissionPath: string;
  tracePath?: string;
  evaluation: EvaluationOutcome;
}): Promise<{ record: BenchmarkRunRecord; resultPath: string; tracePath?: string }> {
  const { workload, suite } = await resolveWorkload(options.projectRoot, options.workloadId);
  const submissionStat = await stat(options.submissionPath);
  const submissionSha256 = await sha256File(options.submissionPath);
  const traceContents = options.tracePath
    ? await readFile(options.tracePath)
    : undefined;
  const runRoot = path.join(
    options.projectRoot,
    "benchmarks",
    "runs",
    safeSegment(options.runId, "run id"),
    safeSegment(workload.id, "workload id"),
  );
  await mkdir(path.dirname(runRoot), { recursive: true, mode: 0o700 });
  try {
    await mkdir(runRoot, { mode: 0o700 });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      throw new Error(
        `Benchmark result already exists for ${options.runId}/${workload.id}; run records are immutable`,
      );
    }
    throw error;
  }
  try {
    let exportedTracePath: string | undefined;
    let trace: BenchmarkRunRecord["trace"];
    if (traceContents) {
      exportedTracePath = path.join(runRoot, "route-tool-trace.jsonl");
      await writeFile(exportedTracePath, traceContents, { mode: 0o600 });
      trace = {
        sha256: await sha256File(exportedTracePath),
        bytes: traceContents.byteLength,
        relativePath: "route-tool-trace.jsonl",
      };
    }
    const record: BenchmarkRunRecord = {
      schemaVersion: 1,
      runId: options.runId,
      workload: {
        id: workload.id,
        track: workload.track,
        dataset: workload.source.dataset,
        revision: workload.source.revision,
        recordId: workload.source.recordId,
        ...(suite.artifact ? { artifactSha256: suite.artifact.sha256 } : {}),
        ...(suite.evaluator ? { evaluatorRevision: suite.evaluator.revision } : {}),
      },
      policy: options.policy,
      submission: {
        sha256: submissionSha256,
        bytes: submissionStat.size,
      },
      ...(trace ? { trace } : {}),
      evaluation: options.evaluation,
    };
    const resultPath = path.join(runRoot, "result.json");
    await writeFile(resultPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return { record, resultPath, ...(exportedTracePath ? { tracePath: exportedTracePath } : {}) };
  } catch (error) {
    await rm(runRoot, { recursive: true, force: true });
    throw error;
  }
}
