#!/usr/bin/env -S tsx

import path from "node:path";
import process from "node:process";

import {
  LocalReviewEvaluationAdmissionError,
  runLocalReviewEvaluationV1,
  type LocalReviewEvaluationSummaryV1,
} from "../src/benchmark/local-review-evaluation";
import { LOCAL_REVIEW_FIXTURE_ID } from "../src/benchmark/local-review-fixture";

export interface LocalReviewCliArguments {
  calibrationId: typeof LOCAL_REVIEW_FIXTURE_ID;
  sourceRepository: string;
  runId: string;
  liveLocalVllm: true;
}

const VALUE_OPTIONS = new Set([
  "calibration-id",
  "source-repository",
  "run-id",
]);
const BOOLEAN_OPTIONS = new Set(["live-local-vllm"]);

export function parseLocalReviewCliArguments(
  argv: readonly string[],
): LocalReviewCliArguments {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) throw new Error("argument_invalid");
    const name = token.slice(2);
    if (VALUE_OPTIONS.has(name)) {
      if (values.has(name)) throw new Error("argument_duplicate");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("argument_missing_value");
      values.set(name, value);
      index += 1;
      continue;
    }
    if (BOOLEAN_OPTIONS.has(name)) {
      if (booleans.has(name)) throw new Error("argument_duplicate");
      booleans.add(name);
      continue;
    }
    throw new Error("argument_unknown");
  }
  const calibrationId = values.get("calibration-id");
  const sourceRepository = values.get("source-repository");
  const runId = values.get("run-id");
  if (
    calibrationId !== LOCAL_REVIEW_FIXTURE_ID ||
    !sourceRepository ||
    !runId ||
    !booleans.has("live-local-vllm")
  ) {
    throw new Error("argument_required");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)) {
    throw new Error("run_id_invalid");
  }
  return {
    calibrationId,
    sourceRepository: path.resolve(sourceRepository),
    runId,
    liveLocalVllm: true,
  };
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function localReviewExitCode(
  summary: Pick<LocalReviewEvaluationSummaryV1, "status">,
): number {
  if (summary.status === "passed") return 0;
  if (summary.status === "cancelled") return 130;
  return 2;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed: LocalReviewCliArguments;
  try {
    parsed = parseLocalReviewCliArguments(argv);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: "local-review-evaluation-error-v1",
        status: "error",
        code: error instanceof Error ? error.message : "argument_invalid",
      })}\n`,
    );
    return 1;
  }

  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const summary = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: parsed.sourceRepository,
      runId: parsed.runId,
      allowProviderDispatch: parsed.liveLocalVllm,
      signal: controller.signal,
    });
    print(summary);
    return localReviewExitCode(summary);
  } catch (error) {
    if (error instanceof LocalReviewEvaluationAdmissionError) {
      process.stderr.write(
        `${JSON.stringify({
          schemaVersion: "local-review-evaluation-error-v1",
          status: "blocked",
          code: error.code,
        })}\n`,
      );
      return 2;
    }
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: "local-review-evaluation-error-v1",
        status: "error",
        code: "harness_error",
      })}\n`,
    );
    return controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", cancel);
  }
}

const invokedAsScript =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename;
if (invokedAsScript) {
  process.exitCode = await main();
}
