import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
  HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
  HELD_OUT_REVIEW_PUBLICATION_PARENT,
  HeldOutReviewPublicationError,
  MAX_HELD_OUT_REVIEW_AGGREGATE_BYTES,
  publishHeldOutReviewAggregateV1,
} from "../../src/benchmark/heldout-review-publication";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryRoot(label: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), label));
  temporaryDirectories.push(directory);
  return directory;
}

function safeAggregate() {
  return {
    schemaVersion: "held-out-review-aggregate-v1",
    protocolVersion: "change-review-eval-v1",
    evaluatorVersion: "change-review-evaluator-v1",
    setCommitment: "a".repeat(64),
    policy: "localOnlyV1",
    servedModelFingerprint: "b".repeat(64),
    deploymentFingerprint: "c".repeat(64),
    configurationFingerprint: "d".repeat(64),
    outcomeCounts: {
      accepted: 20,
      invalid: 1,
      blocked: 1,
      cancelled: 1,
      unstarted: 1,
    },
    stratumCounts: { clean: 8, faulty: 16, highSeverity: 20 },
    completedMetrics: {
      highSeverityRecall: { numerator: 18, denominator: 20, value: 0.9 },
      findingPrecision: { numerator: 18, denominator: 24, value: 0.75 },
    },
    intervalMethod: "wilson95",
    bootstrapSeed: "e".repeat(64),
    aggregateUsage: { inputTokens: 1234, outputTokens: 321 },
    aggregateCost: {
      amountMicrousd: 0,
      costProvenance: "localZeroCostPolicy",
    },
    aggregateLatency: { endToEndMs: 123.5 },
    nonClaims: [
      "No claim of hybrid routing benefit.",
      "Infrastructure cost was not measured.",
    ],
  };
}

function publicationDirectory(outputRoot: string, publicationId: string): string {
  return path.join(
    outputRoot,
    HELD_OUT_REVIEW_PUBLICATION_PARENT,
    publicationId,
  );
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function expectCode(
  operation: Promise<unknown>,
  code: HeldOutReviewPublicationError["code"],
): Promise<HeldOutReviewPublicationError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(HeldOutReviewPublicationError);
    expect((error as HeldOutReviewPublicationError).code).toBe(code);
    expect((error as Error).message).toBe(code);
    return error as HeldOutReviewPublicationError;
  }
  throw new Error(`Expected ${code}.`);
}

describe("held-out review aggregate publication", () => {
  it.runIf(process.platform === "darwin")(
    "creates a missing immediate child beneath the trusted macOS /tmp alias",
    async () => {
      const outputRoot = path.join(
        "/tmp",
        `soar-heldout-trusted-alias-${randomUUID()}`,
      );
      temporaryDirectories.push(outputRoot);
      await expect(lstat(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });

      const summary = await publishHeldOutReviewAggregateV1({
        outputRoot,
        publicationId: "trusted-alias-publication",
        aggregate: safeAggregate(),
      });

      expect(summary.aggregateRelativePath).toBe(
        HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
      );
      expect(
        await readdir(
          publicationDirectory(outputRoot, "trusted-alias-publication"),
        ),
      ).toEqual([
        HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
        HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
      ]);
    },
  );

  it("publishes the aggregate first and a non-circular completion marker last", async () => {
    const container = await temporaryRoot("soar-heldout-publication-");
    const outputRoot = path.join(container, "missing", "runs");
    const publicationId = "heldout-offline-001";
    const summary = await publishHeldOutReviewAggregateV1({
      outputRoot,
      publicationId,
      aggregate: safeAggregate(),
      sensitiveValues: ["PRIVATE_GOLD_SENTINEL"],
    });

    const directory = publicationDirectory(outputRoot, publicationId);
    const aggregatePath = path.join(
      directory,
      HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
    );
    const markerPath = path.join(
      directory,
      HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
    );
    const [aggregate, marker] = await Promise.all([
      readFile(aggregatePath),
      readFile(markerPath),
    ]);
    const parsedMarker = JSON.parse(marker.toString("utf8")) as Record<
      string,
      unknown
    >;

    expect(summary).toEqual({
      schemaVersion: "held-out-review-publication-summary-v1",
      aggregateRelativePath: "aggregate.json",
      completionMarkerRelativePath: "publication.complete-v1.json",
      aggregateSha256: sha256(aggregate),
      aggregateBytes: aggregate.byteLength,
      completionMarkerSha256: sha256(marker),
      completionMarkerBytes: marker.byteLength,
    });
    expect(parsedMarker).toEqual({
      schemaVersion: "held-out-review-publication-complete-v1",
      aggregateSha256: summary.aggregateSha256,
      aggregateBytes: summary.aggregateBytes,
    });
    expect(parsedMarker).not.toHaveProperty("completionMarkerSha256");
    expect(parsedMarker).not.toHaveProperty("completionMarkerBytes");
    expect(await readdir(directory)).toEqual([
      HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
      HELD_OUT_REVIEW_COMPLETION_MARKER_FILE_NAME,
    ]);

    const [directoryState, aggregateState, markerState] = await Promise.all([
      stat(directory),
      stat(aggregatePath),
      stat(markerPath),
    ]);
    expect(directoryState.mode & 0o777).toBe(0o700);
    expect(aggregateState.mode & 0o777).toBe(0o600);
    expect(markerState.mode & 0o777).toBe(0o600);
    expect(aggregateState.nlink).toBe(1);
    expect(markerState.nlink).toBe(1);
  });

  it("canonicalizes object and JSON-string inputs to byte-identical output", async () => {
    const container = await temporaryRoot("soar-heldout-canonical-");
    const aggregate = safeAggregate();
    const objectSummary = await publishHeldOutReviewAggregateV1({
      outputRoot: path.join(container, "object"),
      publicationId: "object-input",
      aggregate,
    });
    const stringSummary = await publishHeldOutReviewAggregateV1({
      outputRoot: path.join(container, "string"),
      publicationId: "string-input",
      aggregate: JSON.stringify(aggregate),
    });

    expect(stringSummary.aggregateSha256).toBe(objectSummary.aggregateSha256);
    expect(stringSummary.aggregateBytes).toBe(objectSummary.aggregateBytes);
  });

  it("validates the complete aggregate before creating the output root", async () => {
    const container = await temporaryRoot("soar-heldout-before-write-");
    const outputRoot = path.join(container, "must-not-exist");

    await expectCode(
      publishHeldOutReviewAggregateV1({
        outputRoot,
        publicationId: "unsafe-input",
        aggregate: { schemaVersion: "v1", path: "/private/oracle.json" },
      }),
      "publication_input_unsafe",
    );
    await expect(lstat(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    {
      label: "sensitive sentinel",
      publicationId: "PRIVATE_GOLD_SENTINEL",
      sensitiveValues: ["PRIVATE_GOLD_SENTINEL"],
    },
    {
      label: "secret-like identifier",
      publicationId: `sk-or-v1-${"x".repeat(32)}`,
      sensitiveValues: [],
    },
    {
      label: "URL-like identifier",
      publicationId: "www.private.example.test",
      sensitiveValues: [],
    },
  ])(
    "rejects an unsafe publication ID containing a $label before filesystem mutation",
    async ({ publicationId, sensitiveValues }) => {
      const container = await temporaryRoot("soar-heldout-unsafe-id-");
      const outputRoot = path.join(container, "must-not-exist");
      const error = await expectCode(
        publishHeldOutReviewAggregateV1({
          outputRoot,
          publicationId,
          aggregate: safeAggregate(),
          sensitiveValues,
        }),
        "publication_input_unsafe",
      );

      expect(error.message).not.toContain(publicationId);
      await expect(lstat(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("rejects malformed, non-object, non-finite, cyclic, exotic, and accessor input", async () => {
    const container = await temporaryRoot("soar-heldout-invalid-");
    const cyclic: Record<string, unknown> = { schemaVersion: "v1" };
    cyclic.child = cyclic;
    let getterInvoked = false;
    const accessor: Record<string, unknown> = { schemaVersion: "v1" };
    Object.defineProperty(accessor, "metrics", {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return {};
      },
    });
    const sparse = [1, 2, 3];
    delete sparse[1];
    let arrayGetterInvoked = false;
    const accessorArray = [1, 2, 3];
    Object.defineProperty(accessorArray, "1", {
      enumerable: true,
      get: () => {
        arrayGetterInvoked = true;
        return 2;
      },
    });

    const cases: unknown[] = [
      "{",
      "[]",
      null,
      [safeAggregate()],
      { schemaVersion: "v1", metric: Number.NaN },
      { schemaVersion: "v1", metric: Number.POSITIVE_INFINITY },
      cyclic,
      new Date(),
      accessor,
      { schemaVersion: "v1", values: sparse },
      { schemaVersion: "v1", values: accessorArray },
    ];
    for (const [index, aggregate] of cases.entries()) {
      await expectCode(
        publishHeldOutReviewAggregateV1({
          outputRoot: path.join(container, `case-${index}`),
          publicationId: `invalid-${index}`,
          aggregate,
        }),
        "publication_input_invalid",
      );
    }
    expect(getterInvoked).toBe(false);
    expect(arrayGetterInvoked).toBe(false);
  });

  it("fails closed on aggregate, string, depth, and node bounds", async () => {
    const container = await temporaryRoot("soar-heldout-bounds-");
    const tooLarge = "x".repeat(MAX_HELD_OUT_REVIEW_AGGREGATE_BYTES);
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 40; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    const tooManyNodes = {
      schemaVersion: "v1",
      values: Array.from({ length: 8_192 }, () =>
        Array.from({ length: 7 }, () => 1),
      ),
    };

    for (const [publicationId, aggregate] of [
      ["large", { schemaVersion: "v1", note: tooLarge }],
      ["deep", deep],
      ["nodes", tooManyNodes],
    ] as const) {
      await expectCode(
        publishHeldOutReviewAggregateV1({
          outputRoot: path.join(container, publicationId),
          publicationId,
          aggregate,
        }),
        "publication_input_too_large",
      );
    }
  });

  it.each([
    ["forbidden key", { schemaVersion: "v1", fixtureId: "opaque-1" }],
    ["nested oracle key", { schemaVersion: "v1", metrics: { oracle: "x" } }],
    ["POSIX path", { schemaVersion: "v1", note: "stored at /private/gold" }],
    ["Windows path", { schemaVersion: "v1", note: "C:\\Users\\gold" }],
    ["home path", { schemaVersion: "v1", note: "read ~/gold.json" }],
    ["URL", { schemaVersion: "v1", note: "https://private.example.test" }],
    [
      "credential",
      { schemaVersion: "v1", note: `sk-or-v1-${"x".repeat(32)}` },
    ],
  ])("rejects unsafe %s without echoing it", async (_label, aggregate) => {
    const container = await temporaryRoot("soar-heldout-unsafe-");
    const error = await expectCode(
      publishHeldOutReviewAggregateV1({
        outputRoot: path.join(container, "output"),
        publicationId: "unsafe",
        aggregate,
      }),
      "publication_input_unsafe",
    );
    expect(JSON.stringify(error)).not.toContain(JSON.stringify(aggregate));
  });

  it.each([
    "privateInputSha256",
    "privateInputBytes",
    "privateInputChecksum",
    "privateCorpusDigestHex",
    "fixturePayloadSize",
    "oracleInputLength",
  ])("rejects disguised private measure key %s", async (privateMeasureKey) => {
    const container = await temporaryRoot("soar-heldout-private-measure-");
    await expectCode(
      publishHeldOutReviewAggregateV1({
        outputRoot: path.join(container, "output"),
        publicationId: "private-measure",
        aggregate: {
          schemaVersion: "v1",
          [privateMeasureKey]: "f".repeat(64),
        },
      }),
      "publication_input_unsafe",
    );
  });

  it("permits the approved safe fingerprint keys", async () => {
    const container = await temporaryRoot("soar-heldout-fingerprints-");
    await expect(
      publishHeldOutReviewAggregateV1({
        outputRoot: path.join(container, "output"),
        publicationId: "safe-fingerprints",
        aggregate: {
          schemaVersion: "v1",
          servedModelFingerprint: "a".repeat(64),
          deploymentFingerprint: "b".repeat(64),
          configurationFingerprint: "c".repeat(64),
        },
      }),
    ).resolves.toMatchObject({
      schemaVersion: "held-out-review-publication-summary-v1",
    });
  });

  it("rejects exact and JSON-escaped sensitive values with a stable message", async () => {
    const container = await temporaryRoot("soar-heldout-sensitive-");
    const sensitive = "PRIVATE_SECRET_SENTINEL";

    for (const [publicationId, aggregate] of [
      ["exact", { schemaVersion: "v1", note: sensitive }],
      [
        "escaped",
        '{"schemaVersion":"v1","note":"PRIVATE\\u005fSECRET_SENTINEL"}',
      ],
    ] as const) {
      const error = await expectCode(
        publishHeldOutReviewAggregateV1({
          outputRoot: path.join(container, publicationId),
          publicationId,
          aggregate,
          sensitiveValues: [sensitive],
        }),
        "publication_input_unsafe",
      );
      expect(error.message).not.toContain(sensitive);
    }
  });

  it("never replaces an existing or concurrently claimed publication", async () => {
    const container = await temporaryRoot("soar-heldout-no-replace-");
    const outputRoot = path.join(container, "runs");
    const publicationId = "same-publication";
    const input = { outputRoot, publicationId, aggregate: safeAggregate() };
    const concurrent = await Promise.allSettled([
      publishHeldOutReviewAggregateV1(input),
      publishHeldOutReviewAggregateV1(input),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = concurrent.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(HeldOutReviewPublicationError);
    expect((rejected?.reason as HeldOutReviewPublicationError).code).toBe(
      "publication_target_exists",
    );

    const aggregatePath = path.join(
      publicationDirectory(outputRoot, publicationId),
      HELD_OUT_REVIEW_AGGREGATE_FILE_NAME,
    );
    const original = await readFile(aggregatePath);
    await expectCode(
      publishHeldOutReviewAggregateV1({
        ...input,
        aggregate: { schemaVersion: "different-v1", metric: 0 },
      }),
      "publication_target_exists",
    );
    expect(await readFile(aggregatePath)).toEqual(original);
  });

  it("rejects symlinked output and publication parents without writing through", async () => {
    const container = await temporaryRoot("soar-heldout-symlink-");
    const target = path.join(container, "target");
    const linkedRoot = path.join(container, "linked-root");
    await writeFile(path.join(container, "placeholder"), "x");
    await mkdir(target, { mode: 0o700 });
    await symlink(target, linkedRoot, "dir");

    const rootError = await expectCode(
      publishHeldOutReviewAggregateV1({
        outputRoot: linkedRoot,
        publicationId: "linked-root",
        aggregate: safeAggregate(),
      }),
      "publication_path_unsafe",
    );
    expect(rootError.message).not.toContain(linkedRoot);
    expect(await readdir(target)).toEqual([]);

    const realRoot = path.join(container, "real-root");
    await mkdir(realRoot, { mode: 0o700 });
    const parentTarget = path.join(container, "parent-target");
    await mkdir(parentTarget, { mode: 0o700 });
    await symlink(
      parentTarget,
      path.join(realRoot, HELD_OUT_REVIEW_PUBLICATION_PARENT),
      "dir",
    );
    await expectCode(
      publishHeldOutReviewAggregateV1({
        outputRoot: realRoot,
        publicationId: "linked-parent",
        aggregate: safeAggregate(),
      }),
      "publication_path_unsafe",
    );
    expect(await readdir(parentTarget)).toEqual([]);
  });

  it("uses only offline filesystem and hashing dependencies", async () => {
    const source = await readFile(
      path.resolve(
        import.meta.dirname,
        "../../src/benchmark/heldout-review-publication.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/node:(?:child_process|http|https|net|tls)/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/openai|providers?\//iu);
  });
});
