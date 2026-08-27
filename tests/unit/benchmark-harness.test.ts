import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadCanaryWorkloadIds,
  resolveWorkload,
} from "../../src/benchmark/catalog.ts";
import {
  classifySweBenchReport,
  evaluateWorkload,
  normalizeLiveDrSubmission,
  validateLiveDrPredictionShape,
} from "../../src/benchmark/evaluators.ts";
import {
  artifactCachePath,
  fetchArtifact,
  materializeAgentFixture,
  prepareFixture,
} from "../../src/benchmark/fixture-cache.ts";
import { preflightWorkload } from "../../src/benchmark/preflight.ts";
import { exportRunRecord } from "../../src/benchmark/results.ts";
import { checkoutRepository } from "../../src/benchmark/workspace.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function createSyntheticProject(): Promise<{
  projectRoot: string;
  sourcePath: string;
  gold: string;
}> {
  const projectRoot = await temporaryDirectory("soar-benchmark-project-");
  const benchmarkRoot = path.join(projectRoot, "benchmarks");
  await mkdir(benchmarkRoot, { recursive: true });
  const gold = "TOP-SECRET-GOLD-ANSWER";
  const row = JSON.stringify({
    case_id: "case-1",
    prompt: "Return the public answer.",
    expected: { citations: 2, answer: "public" },
    hidden_test: gold,
  });
  const sourceText = `${row}\n`;
  const sourcePath = path.join(benchmarkRoot, "fixture.jsonl");
  await Promise.all([
    writeFile(sourcePath, sourceText),
    writeFile(
      path.join(benchmarkRoot, "research.jsonl"),
      `${JSON.stringify({
        id: "synthetic-research-1",
        track: "research",
        source: {
          dataset: "synthetic/cases",
          recordId: "case_id=case-1",
          url: "https://example.invalid/cases",
          revision: "fixture-v1",
        },
        task: { delivery: "JSON answer", fixture: "Pinned synthetic row" },
        evaluator: { kind: "exact-answer", commandOrProtocol: "offline exact match" },
        tags: ["synthetic"],
      })}\n`,
    ),
    writeFile(path.join(benchmarkRoot, "coding.jsonl"), ""),
    writeFile(
      path.join(benchmarkRoot, "sources.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        suites: [
          {
            id: "synthetic-suite",
            track: "research",
            dataset: "synthetic/cases",
            revision: "fixture-v1",
            selectorField: "case_id",
            promptField: "prompt",
            agentVisibleFields: ["case_id", "prompt"],
            evaluatorOnlyFields: ["expected", "hidden_test"],
            artifact: {
              path: "fixture.jsonl",
              url: "https://example.invalid/fixture.jsonl",
              sha256: sha256(sourceText),
            },
            evaluator: {
              repository: "synthetic/evaluator",
              url: "https://example.invalid/evaluator.git",
              revision: "0123456789abcdef0123456789abcdef01234567",
            },
          },
        ],
      })}\n`,
    ),
  ]);
  return { projectRoot, sourcePath, gold };
}

async function allFileContents(root: string): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return (
    await Promise.all(
      files.map((entry) => readFile(path.join(entry.parentPath, entry.name), "utf8")),
    )
  ).join("\n");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("benchmark fixture isolation", () => {
  it("materializes only allow-listed fields while retaining gold in an evaluator-only oracle", async () => {
    const { projectRoot, sourcePath, gold } = await createSyntheticProject();
    const prepared = await prepareFixture({
      projectRoot,
      workloadId: "synthetic-research-1",
      sourcePath,
    });

    const agentText = await readFile(prepared.agentFixturePath, "utf8");
    const oracleText = await readFile(prepared.evaluatorOraclePath, "utf8");
    expect(agentText).not.toContain(gold);
    expect(agentText).not.toContain("hidden_test");
    expect(oracleText).toContain(gold);

    const workspaceRoot = path.join(projectRoot, "agent-workspace");
    await mkdir(workspaceRoot);
    await materializeAgentFixture({
      projectRoot,
      workloadId: "synthetic-research-1",
      workspaceRoot,
    });
    expect(await allFileContents(workspaceRoot)).not.toContain(gold);
  });

  it("rejects a source fixture whose bytes do not match the pinned checksum", async () => {
    const { projectRoot, sourcePath } = await createSyntheticProject();
    await writeFile(sourcePath, '{"case_id":"tampered"}\n');
    await expect(
      prepareFixture({
        projectRoot,
        workloadId: "synthetic-research-1",
        sourcePath,
      }),
    ).rejects.toThrow("Checksum mismatch");
  });

  it("reuses a checksum-verified local artifact without making a network request", async () => {
    const { projectRoot, sourcePath } = await createSyntheticProject();
    const { suite } = await resolveWorkload(projectRoot, "synthetic-research-1");
    const cachedPath = artifactCachePath(projectRoot, suite);
    await mkdir(path.dirname(cachedPath), { recursive: true });
    await writeFile(cachedPath, await readFile(sourcePath));

    await expect(fetchArtifact(projectRoot, suite)).resolves.toEqual({
      path: cachedPath,
      cached: true,
    });
  });

  it("refuses to place an agent workspace around the evaluator cache", async () => {
    const { projectRoot, sourcePath } = await createSyntheticProject();
    await prepareFixture({
      projectRoot,
      workloadId: "synthetic-research-1",
      sourcePath,
    });
    await expect(
      materializeAgentFixture({
        projectRoot,
        workloadId: "synthetic-research-1",
        workspaceRoot: projectRoot,
      }),
    ).rejects.toThrow("must be isolated from benchmarks/cache");
  });
});

describe("benchmark canary catalog", () => {
  it("loads the exact first four workloads from the checked-in canary definition", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..");
    await expect(loadCanaryWorkloadIds(projectRoot)).resolves.toEqual([
      "research-ldr-023",
      "research-ldr-031",
      "coding-flask-5014",
      "coding-pytest-7432",
    ]);
  });
});

describe("benchmark evaluation and export", () => {
  it("executes an offline exact evaluator and exports stable score/trace evidence without gold", async () => {
    const { projectRoot, sourcePath, gold } = await createSyntheticProject();
    await prepareFixture({
      projectRoot,
      workloadId: "synthetic-research-1",
      sourcePath,
    });
    const submissionPath = path.join(projectRoot, "submission.json");
    const tracePath = path.join(projectRoot, "trace.jsonl");
    await Promise.all([
      writeFile(submissionPath, '{"answer":"public","citations":2}\n'),
      writeFile(tracePath, '{"type":"route","provider":"local"}\n'),
    ]);
    const evaluation = await evaluateWorkload({
      projectRoot,
      workloadId: "synthetic-research-1",
      submissionPath,
    });
    const exported = await exportRunRecord({
      projectRoot,
      runId: "offline-run-1",
      workloadId: "synthetic-research-1",
      policy: "local_only",
      submissionPath,
      tracePath,
      evaluation,
    });

    expect(exported.record).toMatchObject({
      runId: "offline-run-1",
      policy: "local_only",
      evaluation: {
        status: "completed",
        score: { metric: "exact_match", value: 1 },
      },
      trace: { relativePath: "route-tool-trace.jsonl" },
    });
    expect(exported.record.workload.artifactSha256).toBe(
      sha256(await readFile(sourcePath, "utf8")),
    );
    expect(exported.record.workload.evaluatorRevision).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(await readFile(exported.resultPath, "utf8")).not.toContain(gold);
    expect(await readFile(exported.tracePath!, "utf8")).toBe(
      '{"type":"route","provider":"local"}\n',
    );
    await expect(
      exportRunRecord({
        projectRoot,
        runId: "offline-run-1",
        workloadId: "synthetic-research-1",
        policy: "local_only",
        submissionPath,
        evaluation,
      }),
    ).rejects.toThrow("run records are immutable");

    const retryRunId = "retry-after-invalid-trace";
    await expect(
      exportRunRecord({
        projectRoot,
        runId: retryRunId,
        workloadId: "synthetic-research-1",
        policy: "local_only",
        submissionPath,
        tracePath: path.join(projectRoot, "missing-trace.jsonl"),
        evaluation,
      }),
    ).rejects.toThrow();
    await expect(
      exportRunRecord({
        projectRoot,
        runId: retryRunId,
        workloadId: "synthetic-research-1",
        policy: "local_only",
        submissionPath,
        evaluation,
      }),
    ).resolves.toMatchObject({ record: { runId: retryRunId } });
  });
});

describe("LiveDRBench submission normalization", () => {
  it("wraps the one-answer JSON shape requested by each task prompt", () => {
    const listAnswer = [{ framework: "example", most_biased_dimension: "value" }];
    const objectAnswer = { title: "example", year: 2026 };
    expect(normalizeLiveDrSubmission(listAnswer, "23")).toEqual([listAnswer]);
    expect(normalizeLiveDrSubmission(objectAnswer, "31")).toEqual([objectAnswer]);
    expect(normalizeLiveDrSubmission([], "23")).toEqual([[]]);
  });

  it("accepts the official keyed prediction schema and rejects a mismatched key", () => {
    const predictions = [[{ framework: "example" }]];
    expect(
      normalizeLiveDrSubmission([{ key: 23, preds: predictions }], "23"),
    ).toEqual(predictions);
    expect(() =>
      normalizeLiveDrSubmission([{ key: 31, preds: predictions }], "23"),
    ).toThrow("exactly one row for key 23");
  });

  it("rejects a prediction shape that cannot be graded", () => {
    expect(() => validateLiveDrPredictionShape([{}], [[{ expected: true }]])).toThrow(
      "does not match the required JSON shape",
    );
  });
});

describe("benchmark coding prerequisites", () => {
  it("reports official coding evaluation as blocked off native x86-64 Linux", async () => {
    const projectRoot = await temporaryDirectory("soar-benchmark-preflight-");
    const benchmarkRoot = path.join(projectRoot, "benchmarks");
    const workloadId = "coding-fixture-1";
    await mkdir(
      path.join(benchmarkRoot, "cache", "prepared", workloadId, "evaluator"),
      { recursive: true },
    );
    await Promise.all([
      writeFile(
        path.join(benchmarkRoot, "coding.jsonl"),
        `${JSON.stringify({
          id: workloadId,
          track: "coding",
          source: {
            dataset: "SWE-bench/SWE-bench_Verified",
            recordId: "instance_id=fixture__repo-1",
            url: "https://example.invalid",
            revision: "dataset-pin",
          },
          task: { delivery: "Patch", fixture: "Pinned row" },
          evaluator: { kind: "deterministic-tests", commandOrProtocol: "official" },
          tags: ["synthetic"],
        })}\n`,
      ),
      writeFile(path.join(benchmarkRoot, "research.jsonl"), ""),
      writeFile(
        path.join(benchmarkRoot, "sources.json"),
        JSON.stringify({
          schemaVersion: 1,
          suites: [
            {
              id: "coding-suite",
              track: "coding",
              dataset: "SWE-bench/SWE-bench_Verified",
              revision: "dataset-pin",
              selectorField: "instance_id",
              agentVisibleFields: ["repo", "base_commit", "version", "problem_statement"],
              evaluatorOnlyFields: ["patch"],
              evaluator: {
                repository: "SWE-bench/SWE-bench",
                url: "https://example.invalid/evaluator.git",
                revision: "0123456789abcdef0123456789abcdef01234567",
              },
            },
          ],
        }),
      ),
      writeFile(
        path.join(
          benchmarkRoot,
          "cache",
          "prepared",
          workloadId,
          "evaluator",
          "oracle.json",
        ),
        "{}",
      ),
    ]);

    const result = await preflightWorkload({
      projectRoot,
      workloadId,
      platform: "darwin",
      architecture: "arm64",
      pythonExecutable: "/usr/bin/false",
      dockerExecutable: "/usr/bin/false",
      environment: { PATH: "" },
    });
    expect(result.status).toBe("blocked");
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "x86-64-linux", ok: false }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "docker-daemon", ok: false }),
    );
  });
});

describe("SWE-bench result classification", () => {
  it("does not score infrastructure and incomplete runs as model failures", () => {
    expect(
      classifySweBenchReport(
        {
          unresolved_ids: ["repo__issue-1"],
          infra_failure_ids: ["repo__issue-1"],
        },
        "repo__issue-1",
      ),
    ).toEqual({ kind: "invalid", detail: "infrastructure failure" });
    expect(
      classifySweBenchReport(
        { incomplete_ids: ["repo__issue-1"] },
        "repo__issue-1",
      ),
    ).toEqual({ kind: "invalid", detail: "incomplete evaluation" });
  });

  it("distinguishes legitimate resolved and unresolved outcomes", () => {
    expect(
      classifySweBenchReport(
        { resolved_ids: ["repo__issue-1"], unresolved_ids: [] },
        "repo__issue-1",
      ),
    ).toEqual({ kind: "resolved" });
    expect(
      classifySweBenchReport(
        { resolved_ids: [], unresolved_ids: ["repo__issue-1"] },
        "repo__issue-1",
      ),
    ).toEqual({ kind: "unresolved" });
    expect(
      classifySweBenchReport(
        { unresolved_ids: ["repo__issue-1"], ambiguous_failure_ids: ["repo__issue-1"] },
        "repo__issue-1",
      ),
    ).toEqual({ kind: "unresolved" });
  });
});

describe("coding workspace checkout", () => {
  it("checks out exactly the pinned commit from an offline repository mirror", async () => {
    const projectRoot = await temporaryDirectory("soar-benchmark-checkout-");
    await mkdir(path.join(projectRoot, "benchmarks"), { recursive: true });
    const upstream = path.join(projectRoot, "upstream");
    await mkdir(upstream);
    execFileSync("git", ["init"], { cwd: upstream });
    execFileSync("git", ["config", "user.name", "SOAR test"], { cwd: upstream });
    execFileSync("git", ["config", "user.email", "soar@example.invalid"], {
      cwd: upstream,
    });
    await writeFile(path.join(upstream, "README.md"), "fixture\n");
    execFileSync("git", ["add", "README.md"], { cwd: upstream });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: upstream });
    const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: upstream,
      encoding: "utf8",
    }).trim();
    const workspaceRoot = path.join(projectRoot, "workspace");

    await checkoutRepository({
      projectRoot,
      repositoryName: "fixture/repository",
      repositoryUrl: upstream,
      baseCommit,
      workspaceRoot,
    });

    expect(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: workspaceRoot,
        encoding: "utf8",
      }).trim(),
    ).toBe(baseCommit);
    expect(
      execFileSync("git", ["rev-list", "--all", "--count"], {
        cwd: workspaceRoot,
        encoding: "utf8",
      }).trim(),
    ).toBe("1");
    expect(
      execFileSync("git", ["remote"], {
        cwd: workspaceRoot,
        encoding: "utf8",
      }).trim(),
    ).toBe("");
    expect(await readFile(path.join(workspaceRoot, "README.md"), "utf8")).toBe(
      "fixture\n",
    );
  });
});
