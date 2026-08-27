#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  loadCanaryWorkloadIds,
  loadWorkloads,
  resolveWorkload,
} from "../src/benchmark/catalog.ts";
import { evaluateWorkload } from "../src/benchmark/evaluators.ts";
import {
  artifactCachePath,
  fetchArtifact,
  prepareFixture,
} from "../src/benchmark/fixture-cache.ts";
import { preflightWorkload } from "../src/benchmark/preflight.ts";
import { exportRunRecord } from "../src/benchmark/results.ts";
import {
  prepareAgentWorkspace,
  setupPinnedEvaluator,
} from "../src/benchmark/workspace.ts";

interface ParsedArguments {
  command: string;
  options: Map<string, string[]>;
}

const projectRoot = path.resolve(import.meta.dirname, "..");

function parseArguments(argv: string[]): ParsedArguments {
  const [command = "help", ...rest] = argv;
  const options = new Map<string, string[]>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith("--")) throw new Error(`Unexpected positional argument: ${token}`);
    const name = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      options.set(name, [...(options.get(name) ?? []), "true"]);
      continue;
    }
    options.set(name, [...(options.get(name) ?? []), value]);
    index += 1;
  }
  return { command, options };
}

function option(arguments_: ParsedArguments, name: string): string | undefined {
  return arguments_.options.get(name)?.at(-1);
}

function requireOption(arguments_: ParsedArguments, name: string): string {
  const value = option(arguments_, name);
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function workloadIds(arguments_: ParsedArguments): string[] {
  const ids = arguments_.options.get("id") ?? [];
  if (ids.length > 0) return ids;
  throw new Error("At least one --id is required");
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help(): void {
  process.stdout.write(`SOAR benchmark harness

Commands (all structured command output is JSON):
  list
  fetch --id WORKLOAD [--id WORKLOAD]
  prepare --id WORKLOAD [--source FILE]
  workspace --id WORKLOAD --workspace DIRECTORY
  setup-evaluator --id WORKLOAD
  preflight [--id WORKLOAD ...]       Defaults to the four canary workloads.
  evaluate --id WORKLOAD --submission FILE --run-id ID --policy POLICY [--trace JSONL]

fetch, workspace, and setup-evaluator download pinned inputs. evaluate may use the
network through an explicitly configured judge or the official Docker evaluator.
Official evaluation never runs when its pinned evaluator, credentials, Docker daemon,
or native x86-64 Linux worker prerequisites are missing.
`);
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  switch (arguments_.command) {
    case "help":
    case "--help":
    case "-h":
      help();
      return;
    case "list": {
      const workloads = await loadWorkloads(projectRoot);
      print(
        workloads.map((workload) => ({
          id: workload.id,
          track: workload.track,
          dataset: workload.source.dataset,
          revision: workload.source.revision,
        })),
      );
      return;
    }
    case "fetch": {
      const results = [];
      for (const id of workloadIds(arguments_)) {
        const { suite } = await resolveWorkload(projectRoot, id);
        results.push({ id, ...(await fetchArtifact(projectRoot, suite)) });
      }
      print(results);
      return;
    }
    case "prepare": {
      const ids = workloadIds(arguments_);
      const explicitSource = option(arguments_, "source");
      if (explicitSource && ids.length !== 1) {
        throw new Error("--source can only be used with one --id");
      }
      const results = [];
      for (const id of ids) {
        const { suite } = await resolveWorkload(projectRoot, id);
        results.push(
          await prepareFixture({
            projectRoot,
            workloadId: id,
            sourcePath: explicitSource
              ? path.resolve(explicitSource)
              : artifactCachePath(projectRoot, suite),
          }),
        );
      }
      print(results);
      return;
    }
    case "workspace": {
      const ids = workloadIds(arguments_);
      if (ids.length !== 1) throw new Error("workspace accepts exactly one --id");
      print(
        await prepareAgentWorkspace({
          projectRoot,
          workloadId: ids[0]!,
          workspaceRoot: path.resolve(requireOption(arguments_, "workspace")),
        }),
      );
      return;
    }
    case "setup-evaluator": {
      const results = [];
      for (const id of workloadIds(arguments_)) {
        results.push({ id, ...(await setupPinnedEvaluator({ projectRoot, workloadId: id })) });
      }
      print(results);
      return;
    }
    case "preflight": {
      const ids = arguments_.options.has("id")
        ? workloadIds(arguments_)
        : await loadCanaryWorkloadIds(projectRoot);
      const results = await Promise.all(
        ids.map((workloadId) =>
          preflightWorkload({ projectRoot, workloadId }),
        ),
      );
      print({
        status: results.every((result) => result.status === "ready") ? "ready" : "blocked",
        workloads: results,
      });
      if (results.some((result) => result.status === "blocked")) process.exitCode = 2;
      return;
    }
    case "evaluate": {
      const ids = workloadIds(arguments_);
      if (ids.length !== 1) throw new Error("evaluate accepts exactly one --id");
      const workloadId = ids[0]!;
      const submissionPath = path.resolve(requireOption(arguments_, "submission"));
      await readFile(submissionPath);
      const evaluation = await evaluateWorkload({ projectRoot, workloadId, submissionPath });
      const exported = await exportRunRecord({
        projectRoot,
        workloadId,
        submissionPath,
        runId: requireOption(arguments_, "run-id"),
        policy: requireOption(arguments_, "policy"),
        tracePath: option(arguments_, "trace")
          ? path.resolve(requireOption(arguments_, "trace"))
          : undefined,
        evaluation,
      });
      print(exported);
      if (evaluation.status !== "completed") process.exitCode = 2;
      return;
    }
    default:
      throw new Error(`Unknown benchmark command: ${arguments_.command}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
