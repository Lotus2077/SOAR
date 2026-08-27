import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { parseRecordId, resolveWorkload } from "./catalog.ts";
import type {
  PreparedAgentFixture,
  PreparedEvaluatorOracle,
  PreparedFixturePaths,
  SourceSuite,
  WorkloadManifest,
} from "./types.ts";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error(`${label} contains characters that are unsafe in a path: ${value}`);
  }
  return value;
}

async function writeJsonPrivate(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: PRIVATE_FILE_MODE,
  });
  await rename(temporaryPath, filePath);
  await chmod(filePath, PRIVATE_FILE_MODE);
}

export async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export function artifactCachePath(
  projectRoot: string,
  suite: SourceSuite,
): string {
  if (!suite.artifact) throw new Error(`${suite.id} does not declare a source artifact`);
  const artifactName = path.basename(suite.artifact.path);
  return path.join(
    projectRoot,
    "benchmarks",
    "cache",
    "artifacts",
    safeSegment(suite.id, "suite id"),
    artifactName,
  );
}

export async function verifyArtifact(
  filePath: string,
  expectedSha256: string,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new Error(`Invalid expected SHA-256: ${expectedSha256}`);
  }
  const actual = await sha256File(filePath);
  if (actual !== expectedSha256) {
    throw new Error(
      `Checksum mismatch for ${filePath}: expected ${expectedSha256}, got ${actual}`,
    );
  }
}

export async function fetchArtifact(
  projectRoot: string,
  suite: SourceSuite,
): Promise<{ path: string; cached: boolean }> {
  if (!suite.artifact) throw new Error(`${suite.id} does not declare a source artifact`);
  const destination = artifactCachePath(projectRoot, suite);
  await mkdir(path.dirname(destination), {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  });

  try {
    await verifyArtifact(destination, suite.artifact.sha256);
    return { path: destination, cached: true };
  } catch (error) {
    const missing =
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!missing) throw error;
  }

  const response = await fetch(suite.artifact.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${suite.artifact.url}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const temporaryPath = `${destination}.${process.pid}.download`;
  try {
    await writeFile(temporaryPath, Buffer.from(await response.arrayBuffer()), {
      mode: PRIVATE_FILE_MODE,
    });
    await verifyArtifact(temporaryPath, suite.artifact.sha256);
    await rename(temporaryPath, destination);
    await chmod(destination, PRIVATE_FILE_MODE);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return { path: destination, cached: false };
}

async function runJsonProcess(
  executable: string,
  args: string[],
  cwd: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Fixture reader exited ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
        return;
      }
      try {
        const value: unknown = JSON.parse(Buffer.concat(stdout).toString("utf8"));
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("fixture reader returned a non-object");
        }
        resolve(value as Record<string, unknown>);
      } catch (error) {
        reject(
          new Error(
            `Fixture reader returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  });
}

async function loadJsonRows(filePath: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(filePath, "utf8");
  const parsed: unknown = filePath.endsWith(".jsonl")
    ? text
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line))
    : JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${filePath} contains a non-object fixture row`);
    }
  }
  return rows as Record<string, unknown>[];
}

export async function loadSelectedRow(options: {
  projectRoot: string;
  sourcePath: string;
  selectorField: string;
  selectorValue: string | number;
  pythonExecutable?: string;
}): Promise<Record<string, unknown>> {
  const extension = path.extname(options.sourcePath).toLowerCase();
  if (extension === ".parquet") {
    return runJsonProcess(
      options.pythonExecutable ?? process.env.SOAR_BENCHMARK_PYTHON ?? "python3",
      [
        path.join(options.projectRoot, "benchmarks", "harness", "read_parquet.py"),
        options.sourcePath,
        options.selectorField,
        JSON.stringify(options.selectorValue),
      ],
      options.projectRoot,
    );
  }
  if (extension !== ".json" && extension !== ".jsonl") {
    throw new Error(`Unsupported fixture format ${extension || "(none)"}`);
  }
  const rows = await loadJsonRows(options.sourcePath);
  const matches = rows.filter(
    (row) => String(row[options.selectorField]) === String(options.selectorValue),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one row where ${options.selectorField}=${String(options.selectorValue)}, found ${matches.length}`,
    );
  }
  return matches[0]!;
}

function pickAgentFields(
  row: Record<string, unknown>,
  suite: SourceSuite,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of suite.agentVisibleFields) {
    if (!(field in row)) throw new Error(`${suite.id}: source row is missing ${field}`);
    fields[field] = row[field];
  }
  for (const field of suite.evaluatorOnlyFields) {
    if (field in fields) {
      throw new Error(`${suite.id}: ${field} cannot be both agent-visible and evaluator-only`);
    }
  }
  return fields;
}

function promptFor(
  workload: WorkloadManifest,
  suite: SourceSuite,
  fields: Record<string, unknown>,
): string {
  const promptField = suite.promptField ??
    (workload.track === "coding" ? "problem_statement" : undefined);
  if (!promptField || typeof fields[promptField] !== "string") {
    throw new Error(`${workload.id}: agent-visible prompt field is missing or not text`);
  }
  return fields[promptField] as string;
}

export async function prepareFixture(options: {
  projectRoot: string;
  workloadId: string;
  sourcePath?: string;
  pythonExecutable?: string;
}): Promise<PreparedFixturePaths> {
  const { workload, suite } = await resolveWorkload(
    options.projectRoot,
    options.workloadId,
  );
  const sourcePath = options.sourcePath ?? artifactCachePath(options.projectRoot, suite);
  if (suite.artifact) await verifyArtifact(sourcePath, suite.artifact.sha256);
  const selectorValue = parseRecordId(workload.source.recordId, suite.selectorField);
  const row = await loadSelectedRow({
    projectRoot: options.projectRoot,
    sourcePath,
    selectorField: suite.selectorField,
    selectorValue,
    pythonExecutable: options.pythonExecutable,
  });
  const fields = pickAgentFields(row, suite);
  const prompt = promptFor(workload, suite, fields);
  const preparedRoot = path.join(
    options.projectRoot,
    "benchmarks",
    "cache",
    "prepared",
    safeSegment(workload.id, "workload id"),
  );
  const agentRoot = path.join(preparedRoot, "agent");
  const evaluatorRoot = path.join(preparedRoot, "evaluator");
  await Promise.all([
    mkdir(agentRoot, { recursive: true, mode: PRIVATE_DIRECTORY_MODE }),
    mkdir(evaluatorRoot, { recursive: true, mode: PRIVATE_DIRECTORY_MODE }),
  ]);
  await Promise.all([chmod(agentRoot, PRIVATE_DIRECTORY_MODE), chmod(evaluatorRoot, PRIVATE_DIRECTORY_MODE)]);

  const source = {
    dataset: workload.source.dataset,
    revision: workload.source.revision,
    recordId: workload.source.recordId,
  };
  const agentFixture: PreparedAgentFixture = {
    schemaVersion: 1,
    workload: {
      id: workload.id,
      track: workload.track,
      delivery: workload.task.delivery,
    },
    source,
    prompt,
    fields,
  };
  const oracle: PreparedEvaluatorOracle = {
    schemaVersion: 1,
    workloadId: workload.id,
    source,
    selector: { field: suite.selectorField, value: selectorValue },
    row,
  };
  const agentFixturePath = path.join(agentRoot, "fixture.json");
  const promptPath = path.join(agentRoot, "prompt.txt");
  const evaluatorOraclePath = path.join(evaluatorRoot, "oracle.json");
  await Promise.all([
    writeJsonPrivate(agentFixturePath, agentFixture),
    writeFile(promptPath, prompt, { encoding: "utf8", mode: PRIVATE_FILE_MODE }),
    writeJsonPrivate(evaluatorOraclePath, oracle),
  ]);
  return { workloadId: workload.id, agentFixturePath, evaluatorOraclePath, promptPath };
}

export async function materializeAgentFixture(options: {
  projectRoot: string;
  workloadId: string;
  workspaceRoot: string;
}): Promise<{ fixturePath: string; promptPath: string }> {
  const benchmarkCache = path.join(options.projectRoot, "benchmarks", "cache");
  const workspaceRoot = path.resolve(options.workspaceRoot);
  await stat(workspaceRoot);
  if (isWithin(workspaceRoot, benchmarkCache) || isWithin(benchmarkCache, workspaceRoot)) {
    throw new Error(
      "Agent workspace must be isolated from benchmarks/cache so evaluator-only gold cannot be reached",
    );
  }
  const preparedRoot = path.join(
    benchmarkCache,
    "prepared",
    safeSegment(options.workloadId, "workload id"),
  );
  const sourceFixture = path.join(preparedRoot, "agent", "fixture.json");
  const sourcePrompt = path.join(preparedRoot, "agent", "prompt.txt");
  await Promise.all([stat(sourceFixture), stat(sourcePrompt)]);
  const destinationRoot = path.join(
    workspaceRoot,
    ".soar-benchmark",
    safeSegment(options.workloadId, "workload id"),
  );
  await mkdir(destinationRoot, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const fixturePath = path.join(destinationRoot, "fixture.json");
  const promptPath = path.join(destinationRoot, "TASK.md");
  await Promise.all([
    copyFile(sourceFixture, fixturePath),
    copyFile(sourcePrompt, promptPath),
  ]);
  await Promise.all([chmod(fixturePath, PRIVATE_FILE_MODE), chmod(promptPath, PRIVATE_FILE_MODE)]);
  return { fixturePath, promptPath };
}
