import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
} from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  HELD_OUT_FIXTURE_COUNT,
  HeldOutRunManifestV1Schema,
  HeldOutRunResultsV1Schema,
  HeldOutRunTelemetryV1Schema,
  HeldOutRunnerBundleV1Schema,
  canonicalHeldOutJsonV1,
  validateHeldOutRunResultsV1,
} from "../../src/shared/heldout-review-runner-contracts";
import {
  HELD_OUT_COORDINATOR_ATTESTATION_DOMAIN,
  HELD_OUT_SET_COMMITMENT_DOMAIN,
  HeldOutAdjudicationPacketV1Schema,
  HeldOutAdjudicationResolutionV1Schema,
  HeldOutAdjudicationResolutionSigningPayloadV1Schema,
  HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema,
  HeldOutAdjudicatorJudgmentV1Schema,
  HeldOutCommitmentMaterialV1Schema,
  HeldOutCommitmentPreimageV1Schema,
  HeldOutCoordinatorAttestationV1Schema,
  HeldOutOracleBundleV1Schema,
  HeldOutPrivateFindingV1Schema,
  assertHeldOutSetCommitmentV1,
  computeHeldOutAdjudicationPacketSha256V1,
  computeHeldOutCoordinatorAttestationSha256V1,
  computeHeldOutJudgmentCommitmentV1,
  computeHeldOutJudgmentSha256V1,
  computeHeldOutPrivateFindingSha256V1,
  computeHeldOutRunManifestSha256V1,
  computeHeldOutSetCommitmentV1,
  coordinatorVerificationKeyFingerprintV1,
  heldOutAdjudicationResolutionSigningBytesV1,
  heldOutCoordinatorAttestationSigningBytesV1,
  validateHeldOutAdjudicationPairV1,
  validateHeldOutCorpusV1,
  validateHeldOutPrivateFindingBindingsV1,
  verifyHeldOutCoordinatorAttestationV1,
  type HeldOutFindingDispositionV1,
} from "../../src/benchmark/heldout-review-evaluator-contracts";

function digest(label: string): string {
  return createHash("sha256").update(label, "utf8").digest("hex");
}

function evidenceRegion(ordinal: number) {
  return {
    kind: "change" as const,
    path: `src/fixture-${String(ordinal).padStart(2, "0")}.ts`,
    side: "working" as const,
    startLine: ordinal,
    endLine: ordinal,
    hunkSha256: digest(`hunk:${ordinal}`),
  };
}

function syntheticCorpus() {
  const fixtures = Array.from({ length: HELD_OUT_FIXTURE_COUNT }, (_, index) => {
    const ordinal = index + 1;
    return {
      schemaVersion: "heldout-runner-fixture-v1" as const,
      ordinal,
      fixtureCommitment: digest(`fixture:${ordinal}`),
      snapshotCommitment: digest(`snapshot:${ordinal}`),
      evidencePacketCommitment: digest(`evidence:${ordinal}`),
      promptSchemaCommitment: digest("prompt-schema:v1"),
      evidenceLimitsCommitment: digest("evidence-limits:v1"),
    };
  });
  const witnessFreezeRecords: Array<Record<string, unknown>> = [];
  const entries = fixtures.map((fixture) => {
    if (fixture.ordinal <= 8) {
      return {
        schemaVersion: "heldout-oracle-entry-v1" as const,
        ordinal: fixture.ordinal,
        fixtureCommitment: fixture.fixtureCommitment,
        fixtureClass: "clean" as const,
        goldDefects: [] as [],
      };
    }
    const specifications = [
      { suffix: "core", severity: "P1" as const },
      ...(fixture.ordinal <= 12
        ? [{ suffix: "critical", severity: "P0" as const }]
        : []),
      ...(fixture.ordinal <= 16
        ? [{ suffix: "lower", severity: "P2" as const }]
        : []),
    ];
    const goldDefects = specifications
      .map(({ suffix, severity }) => {
        const goldDefectId = `d-${String(fixture.ordinal).padStart(2, "0")}-${suffix}`;
        return {
          schemaVersion: "heldout-gold-defect-v1" as const,
          goldDefectId,
          severity,
          evidenceRegions: [evidenceRegion(fixture.ordinal)],
          semanticRubric: {
            defectClaim: `Required defect claim for ${goldDefectId}.`,
            impactCriterion: `Required impact criterion for ${goldDefectId}.`,
            nonMatchGuidance: `Do not match unrelated behavior for ${goldDefectId}.`,
          },
          witnessCommitment: digest(`witness:${fixture.ordinal}:${goldDefectId}`),
        };
      })
      .sort((left, right) =>
        left.goldDefectId < right.goldDefectId ? -1 : 1,
      );
    for (const defect of goldDefects) {
      witnessFreezeRecords.push({
        schemaVersion: "heldout-witness-freeze-v1",
        ordinal: fixture.ordinal,
        fixtureCommitment: fixture.fixtureCommitment,
        witnessCommitment: defect.witnessCommitment,
        goldDefectIds: [defect.goldDefectId],
        materializationProtocolVersion: "materialization-v1",
        commandProtocolVersion: "command-v1",
        environmentFingerprint: digest("environment:v1"),
        faultyCandidate: {
          exitCode: 1,
          stdoutSha256: digest(`faulty-stdout:${defect.goldDefectId}`),
          stdoutBytes: 24,
          stderrSha256: digest(`faulty-stderr:${defect.goldDefectId}`),
          stderrBytes: 48,
        },
        correctedCandidate: {
          exitCode: 0,
          stdoutSha256: digest(`corrected-stdout:${defect.goldDefectId}`),
          stdoutBytes: 12,
          stderrSha256: digest(`corrected-stderr:${defect.goldDefectId}`),
          stderrBytes: 0,
        },
      });
    }
    return {
      schemaVersion: "heldout-oracle-entry-v1" as const,
      ordinal: fixture.ordinal,
      fixtureCommitment: fixture.fixtureCommitment,
      fixtureClass: "faulty" as const,
      goldDefects,
    };
  });
  witnessFreezeRecords.sort((left, right) => {
    const ordinalDifference =
      (left.ordinal as number) - (right.ordinal as number);
    if (ordinalDifference !== 0) return ordinalDifference;
    return (left.witnessCommitment as string) <
      (right.witnessCommitment as string)
      ? -1
      : 1;
  });
  const preimage = HeldOutCommitmentPreimageV1Schema.parse({
    schemaVersion: "heldout-set-commitment-preimage-v1",
    protocolId: "change-review-eval-v1",
    evaluatorVersion: "change-review-evaluator-v1",
    setVersion: "synthetic-24-v1",
    runnerFixtures: fixtures,
    oracleEntries: entries,
    witnessFreezeRecords,
  });
  const saltBase64 = Buffer.alloc(32, 0x5a).toString("base64");
  const setCommitment = computeHeldOutSetCommitmentV1({ saltBase64, preimage });
  const runner = HeldOutRunnerBundleV1Schema.parse({
    schemaVersion: "heldout-runner-bundle-v1",
    protocolId: "change-review-eval-v1",
    setVersion: preimage.setVersion,
    commitmentScheme: "soar-heldout-commitment-v1",
    setCommitment,
    fixtures,
  });
  const oracle = HeldOutOracleBundleV1Schema.parse({
    schemaVersion: "heldout-oracle-bundle-v1",
    protocolId: "change-review-eval-v1",
    evaluatorVersion: "change-review-evaluator-v1",
    setVersion: preimage.setVersion,
    setCommitment,
    entries,
  });
  const commitmentMaterial = HeldOutCommitmentMaterialV1Schema.parse({
    schemaVersion: "heldout-commitment-material-v1",
    commitmentScheme: "soar-heldout-commitment-v1",
    saltBase64,
    preimage,
    setCommitment,
  });
  return { runner, oracle, commitmentMaterial };
}

function makeManifest(
  corpus: ReturnType<typeof syntheticCorpus>,
  verificationKeyFingerprint = digest("coordinator-key"),
) {
  return HeldOutRunManifestV1Schema.parse({
    schemaVersion: "heldout-run-manifest-v1",
    protocolId: "change-review-eval-v1",
    evaluatorVersion: "change-review-evaluator-v1",
    setVersion: corpus.runner.setVersion,
    setCommitment: corpus.runner.setCommitment,
    implementationRevision: "a".repeat(40),
    policy: "local_only_v1",
    providerIdentity: {
      providerId: "local-vllm",
      requestedModel: "test-model",
      servedModel: "test-model-build-1",
    },
    deploymentFingerprint: digest("deployment"),
    configurationFingerprint: digest("configuration"),
    limits: {
      maxInputTokens: 16_384,
      maxOutputTokens: 4_096,
      maxInferenceRounds: 8,
      maxToolCalls: 24,
      attemptTimeoutMs: 60_000,
      episodeTimeoutMs: 300_000,
    },
    retryRule: "one_shot_no_retry_after_sent_or_unknown_v1",
    statistics: {
      wilsonIntervalId: "wilson-score-95-v1",
      bootstrapAlgorithmId: "mulberry32-percentile-95-v1",
      bootstrapSeedUint32: 0x1020_3040,
      bootstrapReplicateCount: 10_000,
    },
    campaignAuthorityId: "offline-campaign-v1",
    coordinator: {
      signatureAlgorithm: "Ed25519",
      verificationKeyFingerprint,
    },
  });
}

function unstartedTelemetry(infrastructureCostMicrousd: number | null = null) {
  return {
    inferenceAttemptCount: 0,
    successfulToolCount: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      reportedAttempts: 0,
    },
    endToEndLatencyMs: null,
    selectedTokenCostMicrousd: 0,
    selectedCostProvenance: "no_dispatch" as const,
    infrastructureCostMicrousd,
  };
}

function makeRunResults(
  corpus: ReturnType<typeof syntheticCorpus>,
  manifest: ReturnType<typeof makeManifest>,
) {
  return HeldOutRunResultsV1Schema.parse({
    schemaVersion: "heldout-run-results-v1",
    protocolId: "change-review-eval-v1",
    evaluatorVersion: "change-review-evaluator-v1",
    setVersion: corpus.runner.setVersion,
    setCommitment: corpus.runner.setCommitment,
    runManifestSha256: computeHeldOutRunManifestSha256V1(manifest),
    results: corpus.runner.fixtures.map((fixture) => ({
      schemaVersion: "heldout-run-result-v1",
      ordinal: fixture.ordinal,
      fixtureCommitment: fixture.fixtureCommitment,
      telemetry: unstartedTelemetry(fixture.ordinal === 1 ? 17 : null),
      outcome: "unstarted",
      failureCode: "not-dispatched",
    })),
  });
}

const requiredBlinding = {
  providerHidden: true,
  policyHidden: true,
  costHidden: true,
  peerJudgmentHidden: true,
} as const;

describe("held-out runner boundary", () => {
  it("keeps runner contracts policy-neutral and evaluator-private vocabulary out of the import graph", () => {
    const source = readFileSync(
      new URL(
        "../../src/shared/heldout-review-runner-contracts.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /\b(?:oracle|gold|rubric|witness|adjudicat(?:e|ed|ion|or)|defect|severity)\b/iu,
    );
    const importSpecifiers = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(
      (match) => match[1],
    );
    expect(importSpecifiers).toEqual([
      "zod",
      "./change-review-contracts.ts",
    ]);
  });

  it("requires exactly 24 ordered opaque fixtures and rejects private or unknown fields", () => {
    const { runner } = syntheticCorpus();
    expect(runner.fixtures).toHaveLength(24);
    expect(
      HeldOutRunnerBundleV1Schema.safeParse({
        ...runner,
        fixtures: runner.fixtures.slice(0, 23),
      }).success,
    ).toBe(false);
    const reordered = structuredClone(runner);
    [reordered.fixtures[0], reordered.fixtures[1]] = [
      reordered.fixtures[1]!,
      reordered.fixtures[0]!,
    ];
    expect(HeldOutRunnerBundleV1Schema.safeParse(reordered).success).toBe(false);
    expect(
      HeldOutRunnerBundleV1Schema.safeParse({
        ...runner,
        fixtures: [
          { ...runner.fixtures[0], fixtureClass: "clean" },
          ...runner.fixtures.slice(1),
        ],
      }).success,
    ).toBe(false);
  });
});

describe("held-out commitment and corpus validation", () => {
  it("canonicalizes keys, preserves array order, and uses the exact salted domain-separated formula", () => {
    expect(canonicalHeldOutJsonV1({ z: [2, 1], a: "x" })).toBe(
      '{"a":"x","z":[2,1]}',
    );
    expect(() => canonicalHeldOutJsonV1({ value: undefined })).toThrow();
    expect(() => canonicalHeldOutJsonV1([, 1])).toThrow(/sparse/u);
    expect(() => canonicalHeldOutJsonV1(new Date())).toThrow(/plain objects/u);

    const { commitmentMaterial } = syntheticCorpus();
    const manual = createHash("sha256")
      .update(HELD_OUT_SET_COMMITMENT_DOMAIN, "utf8")
      .update(Uint8Array.of(0))
      .update(Buffer.from(commitmentMaterial.saltBase64, "base64"))
      .update(Uint8Array.of(0))
      .update(canonicalHeldOutJsonV1(commitmentMaterial.preimage), "utf8")
      .digest("hex");
    expect(commitmentMaterial.setCommitment).toBe(manual);
    expect(assertHeldOutSetCommitmentV1(commitmentMaterial).setCommitment).toBe(
      manual,
    );
  });

  it("rejects bad salts, unknown fields, and any committed preimage mutation", () => {
    const { commitmentMaterial } = syntheticCorpus();
    expect(
      HeldOutCommitmentMaterialV1Schema.safeParse({
        ...commitmentMaterial,
        saltBase64: Buffer.alloc(31).toString("base64"),
      }).success,
    ).toBe(false);
    expect(
      HeldOutCommitmentMaterialV1Schema.safeParse({
        ...commitmentMaterial,
        coordinatorSignature: "not-part-of-the-preimage",
      }).success,
    ).toBe(false);
    const changed = structuredClone(commitmentMaterial);
    changed.preimage.runnerFixtures[0]!.snapshotCommitment = digest("changed");
    expect(() => assertHeldOutSetCommitmentV1(changed)).toThrow(/does not match/u);
    expect(
      computeHeldOutSetCommitmentV1({
        saltBase64: commitmentMaterial.saltBase64,
        preimage: changed.preimage,
      }),
    ).not.toBe(commitmentMaterial.setCommitment);
  });

  it("enforces the 8 clean / 16 faulty split and severity minima", () => {
    const corpus = syntheticCorpus();
    const validated = validateHeldOutCorpusV1(corpus);
    expect(validated.counts).toMatchObject({
      fixtures: 24,
      clean: 8,
      faulty: 16,
      p0p1Defects: 20,
      p2p3Defects: 8,
    });
    const wrongClass = structuredClone(corpus.oracle);
    wrongClass.entries[7] = {
      ...wrongClass.entries[8]!,
      ordinal: 8,
      fixtureCommitment: wrongClass.entries[7]!.fixtureCommitment,
    };
    expect(HeldOutOracleBundleV1Schema.safeParse(wrongClass).success).toBe(false);
    const noLowerSeverity = structuredClone(corpus.oracle);
    for (const entry of noLowerSeverity.entries) {
      for (const defect of entry.goldDefects) {
        if (defect.severity === "P2" || defect.severity === "P3") {
          defect.severity = "P1";
        }
      }
    }
    expect(
      HeldOutOracleBundleV1Schema.safeParse(noLowerSeverity).success,
    ).toBe(false);
  });

  it("requires every private record to have one correctly bound frozen witness", () => {
    const corpus = syntheticCorpus();
    const missing = structuredClone(corpus);
    missing.commitmentMaterial.preimage.witnessFreezeRecords.pop();
    missing.commitmentMaterial.setCommitment = computeHeldOutSetCommitmentV1({
      saltBase64: missing.commitmentMaterial.saltBase64,
      preimage: missing.commitmentMaterial.preimage,
    });
    missing.runner.setCommitment = missing.commitmentMaterial.setCommitment;
    missing.oracle.setCommitment = missing.commitmentMaterial.setCommitment;
    expect(() => validateHeldOutCorpusV1(missing)).toThrow(/exactly one witness/u);

    const wrongExit = structuredClone(
      corpus.commitmentMaterial.preimage.witnessFreezeRecords[0]!,
    );
    wrongExit.faultyCandidate.exitCode = 0;
    expect(
      HeldOutCommitmentPreimageV1Schema.safeParse({
        ...corpus.commitmentMaterial.preimage,
        witnessFreezeRecords: [
          wrongExit,
          ...corpus.commitmentMaterial.preimage.witnessFreezeRecords.slice(1),
        ],
      }).success,
    ).toBe(false);
    const duplicate = structuredClone(corpus.commitmentMaterial.preimage);
    duplicate.witnessFreezeRecords.splice(
      1,
      0,
      structuredClone(duplicate.witnessFreezeRecords[0]!),
    );
    expect(HeldOutCommitmentPreimageV1Schema.safeParse(duplicate).success).toBe(
      false,
    );
  });
});

describe("held-out run manifest and results", () => {
  it("commits statistics controls and rejects uncommitted override fields", () => {
    const corpus = syntheticCorpus();
    const manifest = makeManifest(corpus);
    expect(manifest.statistics).toEqual({
      wilsonIntervalId: "wilson-score-95-v1",
      bootstrapAlgorithmId: "mulberry32-percentile-95-v1",
      bootstrapSeedUint32: 0x1020_3040,
      bootstrapReplicateCount: 10_000,
    });
    expect(
      HeldOutRunManifestV1Schema.safeParse({
        ...manifest,
        endpoint: "http://private.invalid/v1",
      }).success,
    ).toBe(false);
    expect(
      HeldOutRunManifestV1Schema.safeParse({
        ...manifest,
        statistics: { ...manifest.statistics, bootstrapReplicateCount: 100_001 },
      }).success,
    ).toBe(false);
  });

  it("binds all 24 results and makes unstarted cost explicit without erasing infrastructure cost", () => {
    const corpus = syntheticCorpus();
    const manifest = makeManifest(corpus);
    const runResults = makeRunResults(corpus, manifest);
    expect(
      validateHeldOutRunResultsV1({
        runner: corpus.runner,
        manifest,
        runManifestSha256: computeHeldOutRunManifestSha256V1(manifest),
        runResults,
      }).results,
    ).toHaveLength(24);
    expect(runResults.results[0]!.telemetry).toMatchObject({
      selectedTokenCostMicrousd: 0,
      selectedCostProvenance: "no_dispatch",
      infrastructureCostMicrousd: 17,
    });
    const nonzeroTokenCost = structuredClone(runResults);
    nonzeroTokenCost.results[0]!.telemetry.selectedTokenCostMicrousd = 1;
    expect(HeldOutRunResultsV1Schema.safeParse(nonzeroTokenCost).success).toBe(
      false,
    );
    for (const outcome of ["invalid", "cancelled"] as const) {
      const attemptedNoDispatch = structuredClone(runResults) as Record<
        string,
        any
      >;
      attemptedNoDispatch.results[0].outcome = outcome;
      attemptedNoDispatch.results[0].telemetry.inferenceAttemptCount = 1;
      attemptedNoDispatch.results[0].telemetry.usage.inputTokens = 100;
      attemptedNoDispatch.results[0].telemetry.usage.reportedAttempts = 1;
      expect(
        HeldOutRunResultsV1Schema.safeParse(attemptedNoDispatch).success,
      ).toBe(false);
    }

    const preInferenceBlocked = structuredClone(runResults) as Record<
      string,
      any
    >;
    preInferenceBlocked.results[0].outcome = "blocked";
    preInferenceBlocked.results[0].telemetry.successfulToolCount = 1;
    preInferenceBlocked.results[0].telemetry.endToEndLatencyMs = 25;
    expect(HeldOutRunResultsV1Schema.safeParse(preInferenceBlocked).success).toBe(
      true,
    );
    for (const outcome of ["invalid", "blocked", "cancelled"] as const) {
      const zeroAttemptPaid = structuredClone(preInferenceBlocked) as Record<
        string,
        any
      >;
      zeroAttemptPaid.results[0].outcome = outcome;
      zeroAttemptPaid.results[0].telemetry.selectedCostProvenance =
        "provider_reported";
      zeroAttemptPaid.results[0].telemetry.selectedTokenCostMicrousd = 1;
      expect(
        HeldOutRunResultsV1Schema.safeParse(zeroAttemptPaid).success,
      ).toBe(false);
    }
    const wrongCommitment = structuredClone(runResults);
    wrongCommitment.results[0]!.fixtureCommitment = digest("wrong-fixture");
    expect(() =>
      validateHeldOutRunResultsV1({
        runner: corpus.runner,
        manifest,
        runManifestSha256: computeHeldOutRunManifestSha256V1(manifest),
        runResults: wrongCommitment,
      }),
    ).toThrow(/ordered fixture/u);
  });

  it("rejects internally incoherent provider usage telemetry", () => {
    const telemetry = {
      inferenceAttemptCount: 1,
      successfulToolCount: 0,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 10,
        cacheReadTokens: 10,
        reportedAttempts: 1,
      },
      endToEndLatencyMs: 100,
      selectedTokenCostMicrousd: 0,
      selectedCostProvenance: "local_zero_cost_policy" as const,
      infrastructureCostMicrousd: null,
    };
    expect(HeldOutRunTelemetryV1Schema.safeParse(telemetry).success).toBe(true);

    const excessiveCache = structuredClone(telemetry);
    excessiveCache.usage.cacheReadTokens = excessiveCache.usage.inputTokens + 1;
    expect(
      HeldOutRunTelemetryV1Schema.safeParse(excessiveCache).success,
    ).toBe(false);

    const tokensWithoutReportedAttempt = structuredClone(telemetry);
    tokensWithoutReportedAttempt.usage.reportedAttempts = 0;
    expect(
      HeldOutRunTelemetryV1Schema.safeParse(tokensWithoutReportedAttempt)
        .success,
    ).toBe(false);

    const reportedAttemptWithoutInput = structuredClone(telemetry);
    reportedAttemptWithoutInput.usage.inputTokens = 0;
    reportedAttemptWithoutInput.usage.cacheReadTokens = 0;
    expect(
      HeldOutRunTelemetryV1Schema.safeParse(reportedAttemptWithoutInput).success,
    ).toBe(false);

    const unreportedAttempt = structuredClone(telemetry);
    unreportedAttempt.usage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      reportedAttempts: 0,
    };
    expect(HeldOutRunTelemetryV1Schema.safeParse(unreportedAttempt).success).toBe(
      true,
    );
  });

  it("accepts only complete revalidated reviews with measured latency", () => {
    const corpus = syntheticCorpus();
    const manifest = makeManifest(corpus);
    const runResults = makeRunResults(corpus, manifest);
    runResults.results[0] = {
      schemaVersion: "heldout-run-result-v1",
      ordinal: 1,
      fixtureCommitment: corpus.runner.fixtures[0]!.fixtureCommitment,
      telemetry: {
        inferenceAttemptCount: 1,
        successfulToolCount: 3,
        usage: {
          inputTokens: 100,
          outputTokens: 30,
          reasoningTokens: 10,
          cacheReadTokens: 0,
          reportedAttempts: 1,
        },
        endToEndLatencyMs: 125,
        selectedTokenCostMicrousd: 0,
        selectedCostProvenance: "local_zero_cost_policy",
        infrastructureCostMicrousd: null,
      },
      outcome: "accepted",
      conclusion: "no_blocking_findings",
      freshness: "fresh_complete",
      coverage: {
        status: "complete",
        snapshotRevalidated: true,
        changedPaths: 1,
        admittedPaths: 1,
        omittedPaths: 0,
        changedHunks: 1,
        admittedHunks: 1,
        omittedHunks: 0,
        omissionCount: 0,
      },
      findings: [],
      reviewResultSha256: digest("review-result:1"),
      safeTraceSha256: digest("trace:1"),
    };
    expect(HeldOutRunResultsV1Schema.safeParse(runResults).success).toBe(true);
    const zeroAttempts = structuredClone(runResults);
    zeroAttempts.results[0]!.telemetry.inferenceAttemptCount = 0;
    zeroAttempts.results[0]!.telemetry.usage.reportedAttempts = 0;
    expect(HeldOutRunResultsV1Schema.safeParse(zeroAttempts).success).toBe(false);
    const incompleteUsage = structuredClone(runResults);
    incompleteUsage.results[0]!.telemetry.usage.reportedAttempts = 0;
    expect(HeldOutRunResultsV1Schema.safeParse(incompleteUsage).success).toBe(
      false,
    );
    const zeroInputUsage = structuredClone(runResults);
    zeroInputUsage.results[0]!.telemetry.usage.inputTokens = 0;
    expect(HeldOutRunResultsV1Schema.safeParse(zeroInputUsage).success).toBe(
      false,
    );
    const zeroOutputUsage = structuredClone(runResults);
    zeroOutputUsage.results[0]!.telemetry.usage.outputTokens = 0;
    expect(HeldOutRunResultsV1Schema.safeParse(zeroOutputUsage).success).toBe(
      false,
    );
    const noDispatch = structuredClone(runResults);
    noDispatch.results[0]!.telemetry.selectedCostProvenance = "no_dispatch";
    expect(HeldOutRunResultsV1Schema.safeParse(noDispatch).success).toBe(false);
    const noLatency = structuredClone(runResults);
    noLatency.results[0]!.telemetry.endToEndLatencyMs = null;
    expect(HeldOutRunResultsV1Schema.safeParse(noLatency).success).toBe(false);

    const validate = (candidate: typeof runResults) =>
      validateHeldOutRunResultsV1({
        runner: corpus.runner,
        manifest,
        runManifestSha256: computeHeldOutRunManifestSha256V1(manifest),
        runResults: candidate,
      });
    const tooManyRounds = structuredClone(runResults);
    tooManyRounds.results[0]!.telemetry.inferenceAttemptCount =
      manifest.limits.maxInferenceRounds + 1;
    tooManyRounds.results[0]!.telemetry.usage.reportedAttempts =
      tooManyRounds.results[0]!.telemetry.inferenceAttemptCount;
    expect(() => validate(tooManyRounds)).toThrow(/execution envelope/u);

    const tooManyTools = structuredClone(runResults);
    tooManyTools.results[0]!.telemetry.successfulToolCount =
      manifest.limits.maxToolCalls + 1;
    expect(() => validate(tooManyTools)).toThrow(/execution envelope/u);

    const tooSlow = structuredClone(runResults);
    tooSlow.results[0]!.telemetry.endToEndLatencyMs =
      manifest.limits.episodeTimeoutMs + 1;
    expect(() => validate(tooSlow)).toThrow(/execution envelope/u);

    const excessiveInput = structuredClone(runResults);
    excessiveInput.results[0]!.telemetry.usage.inputTokens =
      manifest.limits.maxInputTokens + 1;
    expect(() => validate(excessiveInput)).toThrow(/token envelope/u);

    const excessiveOutput = structuredClone(runResults);
    excessiveOutput.results[0]!.telemetry.usage.outputTokens =
      manifest.limits.maxOutputTokens;
    excessiveOutput.results[0]!.telemetry.usage.reasoningTokens = 1;
    expect(() => validate(excessiveOutput)).toThrow(/token envelope/u);

    const wideManifest = HeldOutRunManifestV1Schema.parse({
      ...manifest,
      limits: {
        ...manifest.limits,
        maxOutputTokens: Number.MAX_SAFE_INTEGER,
      },
    });
    const overflowSafeOutput = structuredClone(runResults);
    overflowSafeOutput.runManifestSha256 =
      computeHeldOutRunManifestSha256V1(wideManifest);
    overflowSafeOutput.results[0]!.telemetry.usage.outputTokens =
      Number.MAX_SAFE_INTEGER;
    overflowSafeOutput.results[0]!.telemetry.usage.reasoningTokens = 1;
    expect(() =>
      validateHeldOutRunResultsV1({
        runner: corpus.runner,
        manifest: wideManifest,
        runManifestSha256: computeHeldOutRunManifestSha256V1(wideManifest),
        runResults: overflowSafeOutput,
      }),
    ).toThrow(/token envelope/u);

    const incomplete = structuredClone(runResults) as Record<string, any>;
    incomplete.results[0].conclusion = "incomplete";
    incomplete.results[0].coverage.status = "incomplete";
    expect(HeldOutRunResultsV1Schema.safeParse(incomplete).success).toBe(false);
    const unsupportedBlocking = structuredClone(runResults) as Record<string, any>;
    unsupportedBlocking.results[0].conclusion = "blocking_findings";
    expect(
      HeldOutRunResultsV1Schema.safeParse(unsupportedBlocking).success,
    ).toBe(false);

    const cloudManifest = HeldOutRunManifestV1Schema.parse({
      ...manifest,
      policy: "cloud_synthesis_all_eval",
    });
    const cloudRunResults = structuredClone(runResults);
    cloudRunResults.runManifestSha256 =
      computeHeldOutRunManifestSha256V1(cloudManifest);
    expect(() =>
      validateHeldOutRunResultsV1({
        runner: corpus.runner,
        manifest: cloudManifest,
        runManifestSha256: computeHeldOutRunManifestSha256V1(cloudManifest),
        runResults: cloudRunResults,
      }),
    ).toThrow(/cloud-only run/u);
  });
});

describe("private finding and adjudication integrity", () => {
  it("binds each full private semantic finding to one accepted run finding", () => {
    const corpus = syntheticCorpus();
    const manifest = makeManifest(corpus);
    const runResults = makeRunResults(corpus, manifest);
    const reviewResultSha256 = digest("accepted-review:9");
    const finding = HeldOutPrivateFindingV1Schema.parse({
      schemaVersion: "heldout-private-finding-v1",
      ordinal: 9,
      fixtureCommitment: corpus.runner.fixtures[8]!.fixtureCommitment,
      findingId: "finding-9-a",
      reviewResultSha256,
      title: "Incorrect boundary condition",
      defectClaim: "The changed branch admits an invalid boundary value.",
      impact: "The invalid value reaches the persisted result.",
      proposedCorrection: "Reject the invalid boundary before persistence.",
      testRecommendation: "Add a boundary regression case.",
      evidenceRegions: [evidenceRegion(9)],
    });
    runResults.results[8] = {
      schemaVersion: "heldout-run-result-v1",
      ordinal: 9,
      fixtureCommitment: corpus.runner.fixtures[8]!.fixtureCommitment,
      telemetry: {
        inferenceAttemptCount: 1,
        successfulToolCount: 2,
        usage: {
          inputTokens: 200,
          outputTokens: 80,
          reasoningTokens: 20,
          cacheReadTokens: 0,
          reportedAttempts: 1,
        },
        endToEndLatencyMs: 250,
        selectedTokenCostMicrousd: 0,
        selectedCostProvenance: "local_zero_cost_policy",
        infrastructureCostMicrousd: null,
      },
      outcome: "accepted",
      conclusion: "blocking_findings",
      freshness: "fresh_complete",
      coverage: {
        status: "complete",
        snapshotRevalidated: true,
        changedPaths: 1,
        admittedPaths: 1,
        omittedPaths: 0,
        changedHunks: 1,
        admittedHunks: 1,
        omittedHunks: 0,
        omissionCount: 0,
      },
      findings: [
        {
          findingId: finding.findingId,
          evidenceRegions: finding.evidenceRegions,
          privateFindingSha256: computeHeldOutPrivateFindingSha256V1(finding),
        },
      ],
      reviewResultSha256,
      safeTraceSha256: digest("trace:9"),
    };
    expect(
      validateHeldOutPrivateFindingBindingsV1({
        runResults,
        privateFindings: [finding],
      }).privateFindings,
    ).toHaveLength(1);
    const rewritten = { ...finding, impact: "Rewritten after the run." };
    expect(() =>
      validateHeldOutPrivateFindingBindingsV1({
        runResults,
        privateFindings: [rewritten],
      }),
    ).toThrow(/does not match/u);
    expect(
      HeldOutPrivateFindingV1Schema.safeParse({
        ...finding,
        evidenceRegions: [evidenceRegion(9), evidenceRegion(9)],
      }).success,
    ).toBe(false);
  });

  it("verifies two blinded, distinct, Ed25519-attested judgments and candidate-only matches", () => {
    const corpus = syntheticCorpus();
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    expect(() =>
      coordinatorVerificationKeyFingerprintV1(privateKey),
    ).toThrow(/public Ed25519 key/u);
    const manifest = makeManifest(
      corpus,
      coordinatorVerificationKeyFingerprintV1(publicKey),
    );
    const oracleEntry = corpus.oracle.entries[8]!;
    if (oracleEntry.fixtureClass !== "faulty") {
      throw new Error("Synthetic fixture 9 must be faulty.");
    }
    const gold = oracleEntry.goldDefects[0]!;
    const finding = HeldOutPrivateFindingV1Schema.parse({
      schemaVersion: "heldout-private-finding-v1",
      ordinal: 9,
      fixtureCommitment: oracleEntry.fixtureCommitment,
      findingId: "finding-9-a",
      reviewResultSha256: digest("review-result:9"),
      title: "Boundary failure",
      defectClaim: "The boundary condition fails.",
      impact: "A persisted value is invalid.",
      proposedCorrection: "Validate the boundary.",
      testRecommendation: "Exercise both boundary sides.",
      evidenceRegions: gold.evidenceRegions,
    });
    const packet = HeldOutAdjudicationPacketV1Schema.parse({
      schemaVersion: "heldout-adjudication-packet-v1",
      setCommitment: corpus.runner.setCommitment,
      runManifestSha256: computeHeldOutRunManifestSha256V1(manifest),
      finding,
      candidateGold: [
        {
          goldDefectId: gold.goldDefectId,
          severity: gold.severity,
          semanticRubric: gold.semanticRubric,
          overlappingRegions: gold.evidenceRegions,
        },
      ],
    });
    const packetSha256 = computeHeldOutAdjudicationPacketSha256V1(packet);
    const studies = [
      `study-${"A".repeat(22)}`,
      `study-${"B".repeat(22)}`,
    ] as const;
    const buildPair = (
      dispositions: readonly [
        HeldOutFindingDispositionV1,
        HeldOutFindingDispositionV1,
      ],
    ) => {
      const judgmentPreimages = studies.map((studyId, index) =>
        HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema.parse({
          schemaVersion: "heldout-adjudicator-judgment-v1",
          setCommitment: corpus.runner.setCommitment,
          runManifestSha256: computeHeldOutRunManifestSha256V1(manifest),
          packetSha256,
          ordinal: 9,
          fixtureCommitment: oracleEntry.fixtureCommitment,
          findingId: finding.findingId,
          studyId,
          blinding: requiredBlinding,
          disposition: dispositions[index],
        }),
      ) as [
        ReturnType<
          typeof HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema.parse
        >,
        ReturnType<
          typeof HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema.parse
        >,
      ];
      const attestations = studies.map((studyId, index) => {
        const payload = {
          schemaVersion: "heldout-coordinator-attestation-payload-v1" as const,
          setCommitment: corpus.runner.setCommitment,
          runManifestSha256: computeHeldOutRunManifestSha256V1(manifest),
          packetSha256,
          studyId,
          pairedStudyId: studies[1 - index]!,
          judgmentCommitment: computeHeldOutJudgmentCommitmentV1(
            judgmentPreimages[index],
          ),
          distinctHumans: true as const,
          blinding: requiredBlinding,
          issuedAt: `2026-08-30T0${index}:00:00.000Z`,
        };
        return HeldOutCoordinatorAttestationV1Schema.parse({
          schemaVersion: "heldout-coordinator-attestation-v1",
          signatureAlgorithm: "Ed25519",
          payload,
          signatureBase64: signBytes(
            null,
            heldOutCoordinatorAttestationSigningBytesV1(payload),
            privateKey,
          ).toString("base64"),
        });
      }) as [
        ReturnType<typeof HeldOutCoordinatorAttestationV1Schema.parse>,
        ReturnType<typeof HeldOutCoordinatorAttestationV1Schema.parse>,
      ];
      const judgments = judgmentPreimages.map((preimage, index) =>
        HeldOutAdjudicatorJudgmentV1Schema.parse({
          ...preimage,
          coordinatorAttestationSha256:
            computeHeldOutCoordinatorAttestationSha256V1(attestations[index]),
        }),
      ) as [
        ReturnType<typeof HeldOutAdjudicatorJudgmentV1Schema.parse>,
        ReturnType<typeof HeldOutAdjudicatorJudgmentV1Schema.parse>,
      ];
      return { attestations, judgments };
    };
    const matchedDisposition = {
      kind: "matched_gold" as const,
      goldDefectId: gold.goldDefectId,
    };
    const { attestations, judgments } = buildPair([
      matchedDisposition,
      matchedDisposition,
    ]);
    expect(HELD_OUT_COORDINATOR_ATTESTATION_DOMAIN).toBe(
      "soar-heldout-coordinator-attestation-v1",
    );
    expect(
      verifyHeldOutCoordinatorAttestationV1({
        attestation: attestations[0],
        manifest,
        publicKey,
      }),
    ).toBe(true);
    expect(
      validateHeldOutAdjudicationPairV1({
        packet,
        judgments,
        attestations,
        manifest,
        coordinatorPublicKey: publicKey,
      }).finalDisposition,
    ).toEqual({ kind: "matched_gold", goldDefectId: gold.goldDefectId });

    const fakeSignature = structuredClone(attestations[0]);
    fakeSignature.signatureBase64 = Buffer.alloc(64, 7).toString("base64");
    expect(
      verifyHeldOutCoordinatorAttestationV1({
        attestation: fakeSignature,
        manifest,
        publicKey,
      }),
    ).toBe(false);
    const nonexistentDisposition = {
      kind: "matched_gold",
      goldDefectId: "not-a-candidate",
    } as const;
    const nonexistentMatch = buildPair([
      nonexistentDisposition,
      nonexistentDisposition,
    ]);
    expect(() =>
      validateHeldOutAdjudicationPairV1({
        packet,
        judgments: nonexistentMatch.judgments,
        attestations: nonexistentMatch.attestations,
        manifest,
        coordinatorPublicKey: publicKey,
      }),
    ).toThrow(/candidate overlap/u);

    const mutatedJudgments = structuredClone(judgments);
    mutatedJudgments[0].disposition = { kind: "false_positive" };
    expect(() =>
      validateHeldOutAdjudicationPairV1({
        packet,
        judgments: mutatedJudgments,
        attestations,
        manifest,
        coordinatorPublicKey: publicKey,
      }),
    ).toThrow(/binding is invalid/u);

    const disagreement = buildPair([
      matchedDisposition,
      { kind: "false_positive" },
    ]);
    expect(() =>
      validateHeldOutAdjudicationPairV1({
        packet,
        judgments: disagreement.judgments,
        attestations: disagreement.attestations,
        manifest,
        coordinatorPublicKey: publicKey,
      }),
    ).toThrow(/joint resolution/u);
    const resolutionPayload =
      HeldOutAdjudicationResolutionSigningPayloadV1Schema.parse({
        schemaVersion: "heldout-adjudication-resolution-v1",
        setCommitment: corpus.runner.setCommitment,
        runManifestSha256: computeHeldOutRunManifestSha256V1(manifest),
        packetSha256,
        ordinal: 9,
        fixtureCommitment: oracleEntry.fixtureCommitment,
        findingId: finding.findingId,
        studyIds: studies,
        judgmentSha256s: disagreement.judgments.map(
          computeHeldOutJudgmentSha256V1,
        ),
        finalDisposition: { kind: "valid_novel_defect" },
        resolvedJointly: true,
        resolvedAt: "2026-08-30T03:00:00.000Z",
      });
    const resolution = HeldOutAdjudicationResolutionV1Schema.parse({
      ...resolutionPayload,
      signatureAlgorithm: "Ed25519",
      coordinatorSignatureBase64: signBytes(
        null,
        heldOutAdjudicationResolutionSigningBytesV1(resolutionPayload),
        privateKey,
      ).toString("base64"),
    });
    expect(
      validateHeldOutAdjudicationPairV1({
        packet,
        judgments: disagreement.judgments,
        attestations: disagreement.attestations,
        manifest,
        coordinatorPublicKey: publicKey,
        resolution,
      }).finalDisposition,
    ).toEqual({ kind: "valid_novel_defect" });
    const mutatedResolution = structuredClone(resolution);
    mutatedResolution.finalDisposition = matchedDisposition;
    expect(() =>
      validateHeldOutAdjudicationPairV1({
        packet,
        judgments: disagreement.judgments,
        attestations: disagreement.attestations,
        manifest,
        coordinatorPublicKey: publicKey,
        resolution: mutatedResolution,
      }),
    ).toThrow(/does not bind both judgments/u);
    expect(
      HeldOutAdjudicationResolutionV1Schema.safeParse({
        ...resolution,
        adjudicatorIdentity: "must-not-be-recorded",
      }).success,
    ).toBe(false);
  });
});
