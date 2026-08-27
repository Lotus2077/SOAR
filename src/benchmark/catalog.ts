import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  SourceCatalog,
  SourceSuite,
  WorkloadManifest,
} from "./types.ts";

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export async function readJsonLines(filePath: string): Promise<unknown[]> {
  const text = await readFile(filePath, "utf8");
  const records: unknown[] = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `${filePath}:${index + 1}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return records;
}

export async function loadWorkloads(
  projectRoot: string,
): Promise<WorkloadManifest[]> {
  const benchmarkRoot = path.join(projectRoot, "benchmarks");
  const values = (
    await Promise.all(
      ["research.jsonl", "coding.jsonl"].map((name) =>
        readJsonLines(path.join(benchmarkRoot, name)),
      ),
    )
  ).flat();

  return values.map((value, index) => {
    assertObject(value, `workload ${index + 1}`);
    assertString(value.id, `workload ${index + 1}.id`);
    assertString(value.track, `${value.id}.track`);
    assertObject(value.source, `${value.id}.source`);
    assertString(value.source.dataset, `${value.id}.source.dataset`);
    assertString(value.source.recordId, `${value.id}.source.recordId`);
    assertString(value.source.revision, `${value.id}.source.revision`);
    return value as unknown as WorkloadManifest;
  });
}

export async function loadSourceCatalog(projectRoot: string): Promise<SourceCatalog> {
  const filePath = path.join(projectRoot, "benchmarks", "sources.json");
  const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
  assertObject(value, "benchmarks/sources.json");
  if (!Array.isArray(value.suites)) {
    throw new Error("benchmarks/sources.json.suites must be an array");
  }
  return value as unknown as SourceCatalog;
}

export async function loadCanaryWorkloadIds(projectRoot: string): Promise<string[]> {
  const filePath = path.join(projectRoot, "benchmarks", "canary.json");
  const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
  assertObject(value, "benchmarks/canary.json");
  if (!Array.isArray(value.workloads) || value.workloads.length === 0) {
    throw new Error("benchmarks/canary.json.workloads must be a non-empty array");
  }
  const entries = value.workloads.map((entry, index) => {
    assertObject(entry, `canary workload ${index + 1}`);
    assertString(entry.id, `canary workload ${index + 1}.id`);
    assertString(entry.adapter, `canary workload ${index + 1}.adapter`);
    return { id: entry.id, adapter: entry.adapter };
  });
  const ids = entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("benchmarks/canary.json contains duplicate workload ids");
  }
  const workloadsById = new Map(
    (await loadWorkloads(projectRoot)).map((workload) => [workload.id, workload]),
  );
  for (const entry of entries) {
    const workload = workloadsById.get(entry.id);
    if (!workload) throw new Error(`Unknown canary workload: ${entry.id}`);
    const expectedAdapter = workload.source.dataset === "microsoft/LiveDRBench"
      ? "livedrbench"
      : workload.source.dataset === "SWE-bench/SWE-bench_Verified"
        ? "swebench"
        : null;
    if (entry.adapter !== expectedAdapter) {
      throw new Error(
        `${entry.id}: canary adapter ${entry.adapter} does not match ${expectedAdapter ?? "an executable adapter"}`,
      );
    }
  }
  return ids;
}

export async function resolveWorkload(
  projectRoot: string,
  workloadId: string,
): Promise<{ workload: WorkloadManifest; suite: SourceSuite }> {
  const [workloads, catalog] = await Promise.all([
    loadWorkloads(projectRoot),
    loadSourceCatalog(projectRoot),
  ]);
  const workload = workloads.find((candidate) => candidate.id === workloadId);
  if (!workload) throw new Error(`Unknown benchmark workload: ${workloadId}`);
  const suite = catalog.suites.find(
    (candidate) =>
      candidate.dataset === workload.source.dataset &&
      candidate.revision === workload.source.revision,
  );
  if (!suite) {
    throw new Error(
      `${workload.id}: no source suite matches ${workload.source.dataset}@${workload.source.revision}`,
    );
  }
  return { workload, suite };
}

export function parseRecordId(
  recordId: string,
  selectorField: string,
): string | number {
  const equals = recordId.indexOf("=");
  const raw = equals >= 0 ? recordId.slice(equals + 1) : recordId;
  if (equals >= 0 && recordId.slice(0, equals) !== selectorField) {
    throw new Error(
      `Record selector ${recordId} does not match suite field ${selectorField}`,
    );
  }
  return /^-?\d+(?:\.\d+)?$/u.test(raw) ? Number(raw) : raw;
}
