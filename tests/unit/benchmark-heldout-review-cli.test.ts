import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  HeldOutReviewCliError,
  MAX_HELD_OUT_REVIEW_CONTROL_BYTES,
  heldOutReviewEvaluatorExitCode,
  parseHeldOutReviewEvaluatorControlV1,
  runHeldOutReviewEvaluatorControlV1,
} from "../../scripts/benchmark-heldout-review";
import {
  HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
  HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
  HELD_OUT_REVIEW_PUBLICATION_PARENT,
} from "../../src/benchmark/heldout-review-publication";
import { canonicalHeldOutJsonV1 } from "../../src/shared/heldout-review-runner-contracts";
import {
  buildSyntheticHeldOutReviewScenarioV1,
  type SyntheticHeldOutReviewScenarioV1,
} from "../helpers/heldout-review-synthetic";

const PROJECT_ROOT = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const CLI_PATH = path.join(PROJECT_ROOT, "scripts/benchmark-heldout-review.ts");
const temporaryRoots: string[] = [];

function control(
  root = path.resolve("/tmp/soar-heldout-cli-test"),
  sensitiveValues: readonly string[] = ["PRIVATE_GOLD_SENTINEL"],
) {
  return {
    schemaVersion: "heldout-review-evaluator-control-v1" as const,
    runnerPath: path.join(root, "runner.json"),
    oraclePath: path.join(root, "oracle.json"),
    commitmentMaterialPath: path.join(root, "commitment.json"),
    runManifestPath: path.join(root, "manifest.json"),
    runResultsPath: path.join(root, "runs.json"),
    privateFindingsPath: path.join(root, "private-findings.json"),
    adjudicationPacketsPath: path.join(root, "packets.json"),
    judgmentsPath: path.join(root, "judgments.json"),
    coordinatorAttestationsPath: path.join(root, "attestations.json"),
    resolutionsPath: path.join(root, "resolutions.json"),
    coordinatorPublicKeyPath: path.join(root, "coordinator.pem"),
    outputRoot: path.join(root, "output"),
    publicationId: "synthetic-offline-001",
    sensitiveValues: [...sensitiveValues],
  };
}

function controlWithCanonicalBytes(
  targetBytes: number,
  base = control(path.resolve("/tmp/soar-heldout-cli-byte-boundary"), []),
) {
  const empty = { ...base, sensitiveValues: [] };
  const emptyBytes = Buffer.byteLength(canonicalHeldOutJsonV1(empty), "utf8");
  const valueCount = 4;
  const arrayElementSyntaxBytes = valueCount * 3 - 1;
  let remainingStringBytes =
    targetBytes - emptyBytes - arrayElementSyntaxBytes;
  if (
    remainingStringBytes < 0 ||
    remainingStringBytes > valueCount * 16_384
  ) {
    throw new RangeError("Requested control byte length is not constructible.");
  }
  const sensitiveValues = Array.from({ length: valueCount }, () => {
    const length = Math.min(16_384, remainingStringBytes);
    remainingStringBytes -= length;
    return "x".repeat(length);
  });
  const value = { ...empty, sensitiveValues };
  if (
    Buffer.byteLength(canonicalHeldOutJsonV1(value), "utf8") !== targetBytes
  ) {
    throw new Error("Failed to construct exact-size canonical control JSON.");
  }
  return value;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "soar-heldout-cli-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

async function writeSyntheticControlInputs(
  root: string,
  scenario: SyntheticHeldOutReviewScenarioV1,
  sensitiveValues: readonly string[],
) {
  const privateRoot = path.join(root, "private-input");
  await mkdir(privateRoot, { mode: 0o700 });
  const value = control(privateRoot, sensitiveValues);
  value.outputRoot = path.join(root, "public-output");
  await writeJson(value.runnerPath, scenario.corpus.runner);
  await writeJson(value.oraclePath, scenario.corpus.oracle);
  await writeJson(
    value.commitmentMaterialPath,
    scenario.corpus.commitmentMaterial,
  );
  await writeJson(value.runManifestPath, scenario.manifest);
  await writeJson(value.runResultsPath, scenario.runResults);
  await writeJson(
    value.privateFindingsPath,
    scenario.privateInputFiles.privateFindings,
  );
  await writeJson(
    value.adjudicationPacketsPath,
    scenario.privateInputFiles.adjudicationPackets,
  );
  await writeJson(value.judgmentsPath, scenario.privateInputFiles.judgments);
  await writeJson(
    value.coordinatorAttestationsPath,
    scenario.privateInputFiles.coordinatorAttestations,
  );
  await writeJson(value.resolutionsPath, scenario.privateInputFiles.resolutions);
  await writeFile(
    value.coordinatorPublicKeyPath,
    scenario.coordinatorPublicKeyPem,
    { mode: 0o600 },
  );
  return value;
}

function publicationDirectory(value: ReturnType<typeof control>): string {
  return path.join(
    value.outputRoot,
    HELD_OUT_REVIEW_PUBLICATION_PARENT,
    value.publicationId,
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface SpawnedCliResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

async function spawnCli(
  value: ReturnType<typeof control>,
  invocation: "direct" | "package" = "direct",
): Promise<SpawnedCliResult> {
  return new Promise((resolve, reject) => {
    const command = invocation === "package" ? "pnpm" : process.execPath;
    const arguments_ =
      invocation === "package"
        ? ["--silent", "benchmark:heldout-review"]
        : ["--no-warnings", "--experimental-strip-types", CLI_PATH];
    const cleanEnvironment = Object.fromEntries(
      ["LANG", "LC_ALL", "PATH", "TMPDIR"]
        .map((key) => [key, process.env[key]])
        .filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const child = spawn(
      command,
      arguments_,
      {
        cwd: PROJECT_ROOT,
        env: cleanEnvironment,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.end(`${JSON.stringify(value)}\n`);
  });
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("held-out review evaluator CLI contract", () => {
  it("keeps the documented package command on the socket-free Node loader path", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["benchmark:heldout-review"]).toBe(
      "node --no-warnings --experimental-strip-types scripts/benchmark-heldout-review.ts",
    );
  });

  it("accepts one strict stdin control document with no live option", () => {
    expect(parseHeldOutReviewEvaluatorControlV1(control())).toEqual(control());
  });

  it("accepts the exact canonical UTF-8 byte boundary and rejects one byte over", () => {
    const boundary = controlWithCanonicalBytes(
      MAX_HELD_OUT_REVIEW_CONTROL_BYTES,
    );
    const oversized = controlWithCanonicalBytes(
      MAX_HELD_OUT_REVIEW_CONTROL_BYTES + 1,
    );

    expect(
      Buffer.byteLength(canonicalHeldOutJsonV1(boundary), "utf8"),
    ).toBe(MAX_HELD_OUT_REVIEW_CONTROL_BYTES);
    expect(parseHeldOutReviewEvaluatorControlV1(boundary)).toEqual(boundary);
    expect(
      Buffer.byteLength(canonicalHeldOutJsonV1(oversized), "utf8"),
    ).toBe(MAX_HELD_OUT_REVIEW_CONTROL_BYTES + 1);
    expect(() =>
      parseHeldOutReviewEvaluatorControlV1(oversized),
    ).toThrowError(new HeldOutReviewCliError("control_invalid"));
  });

  it(
    "accepts an exact-boundary control with terminal LF and rejects a canonical byte over",
    async () => {
      const scenario = buildSyntheticHeldOutReviewScenarioV1();
      const root = await temporaryRoot();
      const base = await writeSyntheticControlInputs(root, scenario, []);
      const boundary = controlWithCanonicalBytes(
        MAX_HELD_OUT_REVIEW_CONTROL_BYTES,
        base,
      );
      const oversized = controlWithCanonicalBytes(
        MAX_HELD_OUT_REVIEW_CONTROL_BYTES + 1,
        base,
      );

      const accepted = await spawnCli(boundary);
      expect(accepted).toMatchObject({
        exitCode: 0,
        signal: null,
        stderr: "",
      });

      const rejected = await spawnCli(oversized);
      expect(rejected).toMatchObject({
        exitCode: 1,
        signal: null,
        stdout: "",
      });
      expect(JSON.parse(rejected.stderr)).toEqual({
        schemaVersion: "heldout-review-evaluator-error-v1",
        status: "error",
        code: "control_invalid",
      });
    },
    20_000,
  );

  it.each([
    { ...control(), runnerPath: "relative.json" },
    { ...control(), publicationId: "../escape" },
    { ...control(), provider: "cloud" },
    { ...control(), live: true },
    { ...control(), sensitiveValues: Array.from({ length: 257 }, () => "x") },
  ])("rejects relative, unsafe, unknown, live, or oversized control", (value) => {
    expect(() => parseHeldOutReviewEvaluatorControlV1(value)).toThrowError(
      new HeldOutReviewCliError("control_invalid"),
    );
  });

  it("maps only a fully complete aggregate to success", () => {
    expect(heldOutReviewEvaluatorExitCode("complete")).toBe(0);
    expect(heldOutReviewEvaluatorExitCode("pending_adjudication")).toBe(2);
    expect(
      heldOutReviewEvaluatorExitCode("adjudication_attestation_unverified"),
    ).toBe(2);
    expect(
      heldOutReviewEvaluatorExitCode("corpus_correction_required"),
    ).toBe(2);
  });

  it("returns a stable non-disclosing code when private input is unavailable", async () => {
    const missing = control();
    await expect(
      runHeldOutReviewEvaluatorControlV1(missing),
    ).rejects.toEqual(new HeldOutReviewCliError("private_input_unavailable"));
    try {
      await runHeldOutReviewEvaluatorControlV1(missing);
    } catch (error) {
      expect(String(error)).not.toContain(missing.runnerPath);
      expect(String(error)).not.toContain("PRIVATE_GOLD_SENTINEL");
    }
  });

  it(
    "executes a complete synthetic control, publishes aggregate before marker, and discloses no private bytes",
    async () => {
      const privateSentinel =
        "SYNTHETIC_PRIVATE_FINDING_SENTINEL_7F4E0A36";
      const scenario = buildSyntheticHeldOutReviewScenarioV1({
        privateSentinel,
        findingSpecs: [
          {
            ordinal: 1,
            findingId: "synthetic-cli-complete",
            adjudicatorDispositions: ["false_positive", "false_positive"],
          },
        ],
      });
      const root = await temporaryRoot();
      const value = await writeSyntheticControlInputs(
        root,
        scenario,
        [privateSentinel],
      );
      expect(await readFile(value.privateFindingsPath, "utf8")).toContain(
        privateSentinel,
      );

      const execution = await spawnCli(value, "package");
      expect(execution).toMatchObject({
        exitCode: 0,
        signal: null,
        stderr: "",
      });
      const summary = JSON.parse(execution.stdout) as {
        schemaVersion: string;
        assessmentStatus: string;
        semanticStatusReason: string | null;
        publication: {
          aggregateRelativePath: string;
          completionMarkerRelativePath: string;
          aggregateSha256: string;
          aggregateBytes: number;
          completionMarkerSha256: string;
          completionMarkerBytes: number;
        };
      };
      expect(summary).toMatchObject({
        schemaVersion: "heldout-review-evaluator-summary-v1",
        assessmentStatus: "complete",
        semanticStatusReason: null,
        publication: {
          aggregateRelativePath: HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
          completionMarkerRelativePath:
            HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
        },
      });

      const directory = publicationDirectory(value);
      expect((await readdir(directory)).sort()).toEqual([
        HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
        HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
      ]);
      const aggregatePath = path.join(
        directory,
        HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
      );
      const markerPath = path.join(
        directory,
        HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
      );
      const [aggregateBytes, markerBytes, aggregateState, markerState] =
        await Promise.all([
          readFile(aggregatePath),
          readFile(markerPath),
          stat(aggregatePath, { bigint: true }),
          stat(markerPath, { bigint: true }),
        ]);
      const marker = JSON.parse(markerBytes.toString("utf8")) as {
        schemaVersion: string;
        aggregateSha256: string;
        aggregateBytes: number;
      };
      expect(marker).toEqual({
        schemaVersion: "held-out-review-publication-complete-v1",
        aggregateSha256: sha256(aggregateBytes),
        aggregateBytes: aggregateBytes.byteLength,
      });
      expect(summary.publication).toMatchObject({
        aggregateSha256: sha256(aggregateBytes),
        aggregateBytes: aggregateBytes.byteLength,
        completionMarkerSha256: sha256(markerBytes),
        completionMarkerBytes: markerBytes.byteLength,
      });
      expect(markerState.mtimeNs >= aggregateState.mtimeNs).toBe(true);

      const externallyVisibleBytes = [
        execution.stdout,
        execution.stderr,
        aggregateBytes.toString("utf8"),
        markerBytes.toString("utf8"),
      ].join("\n");
      const absoluteInputPaths = [
        value.runnerPath,
        value.oraclePath,
        value.commitmentMaterialPath,
        value.runManifestPath,
        value.runResultsPath,
        value.privateFindingsPath,
        value.adjudicationPacketsPath,
        value.judgmentsPath,
        value.coordinatorAttestationsPath,
        value.resolutionsPath,
        value.coordinatorPublicKeyPath,
      ];
      for (const privateValue of [
        privateSentinel,
        root,
        ...absoluteInputPaths,
      ]) {
        expect(externallyVisibleBytes).not.toContain(privateValue);
      }
    },
    20_000,
  );

  it(
    "rejects malformed and private coordinator keys without creating a completion marker",
    async () => {
      for (const keyKind of ["malformed", "private"] as const) {
        const privateSentinel = `SYNTHETIC_REJECTED_KEY_SENTINEL_${keyKind.toUpperCase()}`;
        const scenario = buildSyntheticHeldOutReviewScenarioV1({
          privateSentinel,
          findingSpecs: [
            {
              ordinal: 1,
              findingId: `synthetic-cli-rejected-${keyKind}`,
              adjudicatorDispositions: ["false_positive", "false_positive"],
            },
          ],
        });
        const root = await temporaryRoot();
        const value = await writeSyntheticControlInputs(
          root,
          scenario,
          [privateSentinel],
        );
        const rejectedKey =
          keyKind === "private"
            ? scenario.coordinatorPrivateKey.export({
                format: "pem",
                type: "pkcs8",
              })
            : Buffer.from("not-a-canonical-spki-public-key\n", "utf8");
        await writeFile(value.coordinatorPublicKeyPath, rejectedKey, {
          mode: 0o600,
        });

        const execution = await spawnCli(value);
        expect(execution.exitCode).toBe(1);
        expect(execution.signal).toBeNull();
        expect(execution.stdout).toBe("");
        expect(JSON.parse(execution.stderr)).toEqual({
          schemaVersion: "heldout-review-evaluator-error-v1",
          status: "error",
          code: "private_input_invalid",
        });
        expect(execution.stderr).not.toContain(privateSentinel);
        expect(execution.stderr).not.toContain(root);

        const markerPath = path.join(
          publicationDirectory(value),
          HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
        );
        expect(await pathExists(markerPath)).toBe(false);
      }
    },
    20_000,
  );
});
