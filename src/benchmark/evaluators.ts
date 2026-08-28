import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveWorkload } from "./catalog.ts";
import { preflightWorkload } from "./preflight.ts";
import { runBoundedProcess } from "./process.ts";
import type {
  EvaluationOutcome,
  PreparedEvaluatorOracle,
} from "./types.ts";

const PRIVATE_FILE_MODE = 0o600;

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error(`${label} contains unsafe path characters: ${value}`);
  }
  return value;
}

async function readOracle(
  projectRoot: string,
  workloadId: string,
): Promise<PreparedEvaluatorOracle> {
  const oraclePath = path.join(
    projectRoot,
    "benchmarks",
    "cache",
    "prepared",
    safeSegment(workloadId, "workload id"),
    "evaluator",
    "oracle.json",
  );
  const oracle = JSON.parse(
    await readFile(oraclePath, "utf8"),
  ) as PreparedEvaluatorOracle;
  const { workload } = await resolveWorkload(projectRoot, workloadId);
  if (
    oracle.schemaVersion !== 1 ||
    oracle.workloadId !== workload.id ||
    oracle.source?.dataset !== workload.source.dataset ||
    oracle.source?.revision !== workload.source.revision ||
    oracle.source?.recordId !== workload.source.recordId
  ) {
    throw new Error(
      `${workload.id}: prepared evaluator oracle does not match the pinned workload source; prepare the fixture again`,
    );
  }
  return oracle;
}

function blockedOutcome(preflight: Awaited<ReturnType<typeof preflightWorkload>>): EvaluationOutcome {
  return {
    status: "blocked",
    adapter: preflight.adapter,
    score: null,
    evidence: preflight.checks
      .filter((check) => !check.ok)
      .map((check) => ({ kind: `prerequisite:${check.id}`, detail: check.detail })),
  };
}

function parseSubmissionJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Research submission must be JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function normalizeLiveDrSubmission(
  submission: unknown,
  expectedKey: string,
): unknown[] {
  let predictions: unknown;
  if (
    Array.isArray(submission) &&
    submission.length > 0 &&
    submission.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        "key" in entry &&
        "preds" in entry,
    )
  ) {
    const matches = submission.filter(
      (entry) => String((entry as Record<string, unknown>).key) === expectedKey,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Official LiveDRBench submission must contain exactly one row for key ${expectedKey}; found ${matches.length}`,
      );
    }
    predictions = (matches[0] as Record<string, unknown>).preds;
  } else if (
    submission !== null &&
    typeof submission === "object" &&
    !Array.isArray(submission) &&
    "preds" in submission
  ) {
    const wrapper = submission as Record<string, unknown>;
    if ("key" in wrapper && String(wrapper.key) !== expectedKey) {
      throw new Error(
        `LiveDRBench submission key ${String(wrapper.key)} does not match ${expectedKey}`,
      );
    }
    predictions = wrapper.preds;
  } else {
    // The task prompt asks for one JSON answer, while the official evaluator
    // expects an outer list with one prediction per question row.
    predictions = [submission];
  }
  if (!Array.isArray(predictions)) {
    throw new Error("LiveDRBench predictions must be an array");
  }
  return predictions;
}

export function validateLiveDrPredictionShape(
  predictions: unknown[],
  groundTruths: unknown,
): void {
  if (!Array.isArray(groundTruths)) {
    throw new Error("LiveDRBench oracle ground_truths must decode to an array");
  }
  if (predictions.length !== groundTruths.length) {
    throw new Error(
      `LiveDRBench expected ${groundTruths.length} prediction group(s), got ${predictions.length}`,
    );
  }
  for (let index = 0; index < groundTruths.length; index += 1) {
    const expected = groundTruths[index];
    const actual = predictions[index];
    const expectedIsArray = Array.isArray(expected);
    const actualIsArray = Array.isArray(actual);
    const expectedIsObject = expected !== null && typeof expected === "object";
    const actualIsObject = actual !== null && typeof actual === "object";
    if (
      expectedIsArray !== actualIsArray ||
      expectedIsObject !== actualIsObject
    ) {
      throw new Error(
        `LiveDRBench prediction group ${index + 1} does not match the required JSON shape`,
      );
    }
  }
}

export function evaluateSyntheticExact(
  actual: unknown,
  expected: unknown,
): EvaluationOutcome {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, canonicalize(child)]),
      );
    }
    return value;
  };
  const matches =
    JSON.stringify(canonicalize(actual)) === JSON.stringify(canonicalize(expected));
  return {
    status: "completed",
    adapter: "synthetic-exact",
    score: { metric: "exact_match", value: matches ? 1 : 0 },
    evidence: [
      {
        kind: "deterministic-comparison",
        detail: matches
          ? "Submission exactly matches the isolated oracle."
          : "Submission does not exactly match the isolated oracle.",
      },
    ],
  };
}

async function evaluateLiveDrBench(options: {
  projectRoot: string;
  workloadId: string;
  submissionPath: string;
  environment: NodeJS.ProcessEnv;
  pythonExecutable: string;
}): Promise<EvaluationOutcome> {
  const evaluatorRoot = path.join(
    options.projectRoot,
    "benchmarks",
    "cache",
    "evaluators",
    "livedrbench",
  );
  const oraclePath = path.join(
    options.projectRoot,
    "benchmarks",
    "cache",
    "prepared",
    options.workloadId,
    "evaluator",
    "oracle.json",
  );
  const workRoot = path.join(
    options.projectRoot,
    "benchmarks",
    "cache",
    "evaluator-work",
    options.workloadId,
    randomUUID(),
  );
  await mkdir(workRoot, { recursive: true, mode: 0o700 });
  // Parse before handing the file to the official adapter, so malformed answers
  // fail without starting a paid judge call.
  const submission = parseSubmissionJson(await readFile(options.submissionPath, "utf8"));
  const oracle = await readOracle(options.projectRoot, options.workloadId);
  const expectedKey = String(oracle.row.key ?? "");
  if (!expectedKey) throw new Error(`${options.workloadId}: oracle has no LiveDRBench key`);
  const predictions = normalizeLiveDrSubmission(submission, expectedKey);
  const encodedGroundTruths = oracle.row.ground_truths;
  if (typeof encodedGroundTruths !== "string") {
    throw new Error(`${options.workloadId}: oracle has no encoded LiveDRBench ground_truths`);
  }
  validateLiveDrPredictionShape(predictions, parseSubmissionJson(encodedGroundTruths));
  const normalizedSubmissionPath = path.join(workRoot, "predictions.json");
  await writeFile(
    normalizedSubmissionPath,
    `${JSON.stringify({ key: expectedKey, preds: predictions })}\n`,
    { mode: PRIVATE_FILE_MODE },
  );
  const command = {
    executable: options.pythonExecutable,
    args: [
      path.join(options.projectRoot, "benchmarks", "harness", "evaluate_livedr_row.py"),
      "--evaluator-root",
      evaluatorRoot,
      "--oracle",
      oraclePath,
      "--submission",
      normalizedSubmissionPath,
      "--judge",
      options.environment.SOAR_LIVEDR_JUDGE_MODEL ?? "gpt-4o",
    ],
  };
  const result = await runBoundedProcess({
    ...command,
    cwd: options.projectRoot,
    env: options.environment,
    timeoutMs: 30 * 60 * 1_000,
  });
  await Promise.all([
    writeFile(path.join(workRoot, "process.stdout.log"), result.stdout, {
      mode: PRIVATE_FILE_MODE,
    }),
    writeFile(path.join(workRoot, "process.stderr.log"), result.stderr, {
      mode: PRIVATE_FILE_MODE,
    }),
  ]);
  if (result.exitCode !== 0) {
    return {
      status: "failed",
      adapter: "livedrbench",
      score: null,
      evidence: [
        {
          kind: "evaluator-error",
          detail: result.timedOut
            ? "Pinned LiveDRBench evaluator timed out."
            : `Pinned LiveDRBench evaluator exited ${result.exitCode}; private logs are retained under benchmarks/cache/evaluator-work.`,
        },
      ],
      command: { ...command, exitCode: result.exitCode },
    };
  }
  let metrics: Record<string, unknown>;
  try {
    metrics = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    return {
      status: "failed",
      adapter: "livedrbench",
      score: null,
      evidence: [{ kind: "evaluator-error", detail: "Evaluator returned invalid JSON." }],
      command: { ...command, exitCode: result.exitCode },
    };
  }
  const f1 = metrics.f1;
  if (typeof f1 !== "number" || !Number.isFinite(f1)) {
    return {
      status: "failed",
      adapter: "livedrbench",
      score: null,
      evidence: [{ kind: "evaluator-error", detail: "Evaluator result did not contain numeric F1." }],
      command: { ...command, exitCode: result.exitCode },
    };
  }
  return {
    status: "completed",
    adapter: "livedrbench",
    score: { metric: "f1", value: f1 },
    evidence: [
      {
        kind: "official-evaluator",
        detail: "Scored by the pinned LiveDRBench category evaluator with its configured judge.",
      },
    ],
    command: { ...command, exitCode: result.exitCode },
  };
}

export interface SweBenchReportClassification {
  kind: "resolved" | "unresolved" | "invalid";
  detail?: string;
}

function includesInstance(value: unknown, instanceId: string): boolean {
  return Array.isArray(value) && value.includes(instanceId);
}

export function classifySweBenchReport(
  value: unknown,
  instanceId: string,
): SweBenchReportClassification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const invalidClassifications = [
    ["infra_failure_ids", "infrastructure failure"],
    ["error_ids", "evaluator error"],
    ["incomplete_ids", "incomplete evaluation"],
  ] as const;
  for (const [field, detail] of invalidClassifications) {
    if (includesInstance(object[field], instanceId)) {
      return { kind: "invalid", detail };
    }
  }
  if (includesInstance(object.resolved_ids, instanceId)) return { kind: "resolved" };
  if (
    includesInstance(object.unresolved_ids, instanceId) ||
    includesInstance(object.empty_patch_ids, instanceId) ||
    includesInstance(object.ambiguous_failure_ids, instanceId)
  ) {
    return { kind: "unresolved" };
  }
  const instance = object[instanceId];
  if (instance && typeof instance === "object" && !Array.isArray(instance)) {
    const resolved = (instance as Record<string, unknown>).resolved;
    if (typeof resolved === "boolean") {
      return { kind: resolved ? "resolved" : "unresolved" };
    }
  }
  return null;
}

async function findResolution(
  reportRoot: string,
  instanceId: string,
): Promise<SweBenchReportClassification | null> {
  const entries = await readdir(reportRoot, { recursive: true, withFileTypes: true });
  const reports = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  for (const reportPath of reports) {
    try {
      const value: unknown = JSON.parse(await readFile(reportPath, "utf8"));
      const classification = classifySweBenchReport(value, instanceId);
      if (classification) return classification;
    } catch {
      // Ignore unrelated JSON log files.
    }
  }
  return null;
}

async function evaluateSweBench(options: {
  projectRoot: string;
  workloadId: string;
  submissionPath: string;
  environment: NodeJS.ProcessEnv;
  pythonExecutable: string;
}): Promise<EvaluationOutcome> {
  const { suite } = await resolveWorkload(options.projectRoot, options.workloadId);
  const oracle = await readOracle(options.projectRoot, options.workloadId);
  const instanceId = String(oracle.row.instance_id ?? "");
  if (!instanceId) throw new Error(`${options.workloadId}: oracle has no instance_id`);
  const modelPatch = await readFile(options.submissionPath, "utf8");
  if (!modelPatch.trim()) throw new Error("SWE-bench submission patch is empty");
  const workRoot = path.join(
    options.projectRoot,
    "benchmarks",
    "cache",
    "evaluator-work",
    safeSegment(options.workloadId, "workload id"),
    randomUUID(),
  );
  const reportRoot = path.join(workRoot, "reports");
  await mkdir(reportRoot, { recursive: true, mode: 0o700 });
  const datasetPath = path.join(workRoot, "dataset.json");
  const predictionsPath = path.join(workRoot, "predictions.jsonl");
  await Promise.all([
    writeFile(datasetPath, `${JSON.stringify([oracle.row])}\n`, { mode: PRIVATE_FILE_MODE }),
    writeFile(
      predictionsPath,
      `${JSON.stringify({
        instance_id: instanceId,
        model_name_or_path: "soar",
        model_patch: modelPatch,
      })}\n`,
      { mode: PRIVATE_FILE_MODE },
    ),
  ]);
  const runId = `soar-${options.workloadId}-${randomUUID().slice(0, 8)}`;
  const command = {
    executable: options.pythonExecutable,
    args: [
      "-m",
      "swebench.harness.run_evaluation",
      "--dataset_name",
      datasetPath,
      "--split",
      "test",
      "--predictions_path",
      predictionsPath,
      "--instance_ids",
      instanceId,
      "--max_workers",
      "1",
      "--run_id",
      runId,
      "--report_dir",
      reportRoot,
    ],
  };
  const evaluatorRoot = path.join(
    options.projectRoot,
    "benchmarks",
    "cache",
    "evaluators",
    suite.id,
  );
  const evaluatorEnvironment = {
    ...options.environment,
    PYTHONPATH: [evaluatorRoot, options.environment.PYTHONPATH]
      .filter((value): value is string => Boolean(value))
      .join(path.delimiter),
  };
  const result = await runBoundedProcess({
    ...command,
    cwd: workRoot,
    env: evaluatorEnvironment,
    timeoutMs: 2 * 60 * 60 * 1_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  await Promise.all([
    writeFile(path.join(workRoot, "process.stdout.log"), result.stdout, {
      mode: PRIVATE_FILE_MODE,
    }),
    writeFile(path.join(workRoot, "process.stderr.log"), result.stderr, {
      mode: PRIVATE_FILE_MODE,
    }),
  ]);
  if (result.exitCode !== 0) {
    return {
      status: "failed",
      adapter: "swebench",
      score: null,
      evidence: [
        {
          kind: "evaluator-error",
          detail: result.timedOut
            ? "Official SWE-bench evaluation timed out."
            : `Official SWE-bench harness exited ${result.exitCode}; private logs are retained under benchmarks/cache/evaluator-work.`,
        },
      ],
      command: { ...command, exitCode: result.exitCode },
    };
  }
  const classification = await findResolution(reportRoot, instanceId);
  if (classification === null) {
    return {
      status: "failed",
      adapter: "swebench",
      score: null,
      evidence: [
        {
          kind: "evaluator-error",
          detail: "SWE-bench exited successfully but produced no instance resolution report.",
        },
      ],
      command: { ...command, exitCode: result.exitCode },
    };
  }
  if (classification.kind === "invalid") {
    return {
      status: "failed",
      adapter: "swebench",
      score: null,
      evidence: [
        {
          kind: "evaluator-infrastructure",
          detail: `SWE-bench did not produce a valid task outcome: ${classification.detail ?? "invalid evaluator result"}.`,
        },
      ],
      command: { ...command, exitCode: result.exitCode },
    };
  }
  const resolved = classification.kind === "resolved";
  return {
    status: "completed",
    adapter: "swebench",
    score: { metric: "resolved", value: resolved ? 1 : 0, resolved },
    evidence: [
      {
        kind: "official-evaluator",
        detail: `Official SWE-bench Verified harness reported resolved=${String(resolved)}.`,
      },
    ],
    command: { ...command, exitCode: result.exitCode },
  };
}

export async function evaluateWorkload(options: {
  projectRoot: string;
  workloadId: string;
  submissionPath: string;
  environment?: NodeJS.ProcessEnv;
  pythonExecutable?: string;
}): Promise<EvaluationOutcome> {
  const environment = options.environment ?? process.env;
  const preflight = await preflightWorkload({
    projectRoot: options.projectRoot,
    workloadId: options.workloadId,
    environment,
    pythonExecutable: options.pythonExecutable,
  });
  if (preflight.status === "blocked") return blockedOutcome(preflight);
  const { workload } = await resolveWorkload(options.projectRoot, options.workloadId);
  const pythonExecutable =
    options.pythonExecutable ?? environment.SOAR_BENCHMARK_PYTHON ?? "python3";
  if (workload.source.dataset === "microsoft/LiveDRBench") {
    return evaluateLiveDrBench({ ...options, environment, pythonExecutable });
  }
  if (workload.source.dataset === "SWE-bench/SWE-bench_Verified") {
    return evaluateSweBench({ ...options, environment, pythonExecutable });
  }
  if (preflight.adapter === "synthetic") {
    const oracle = await readOracle(options.projectRoot, workload.id);
    if (!("expected" in oracle.row)) {
      throw new Error(`${workload.id}: synthetic oracle has no expected field`);
    }
    return evaluateSyntheticExact(
      parseSubmissionJson(await readFile(options.submissionPath, "utf8")),
      oracle.row.expected,
    );
  }
  throw new Error(`${workload.id}: no evaluator adapter for ${workload.source.dataset}`);
}
