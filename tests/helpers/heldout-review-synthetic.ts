import { Buffer } from "node:buffer";
import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
} from "node:crypto";

import {
  HELD_OUT_FIXTURE_COUNT,
  HeldOutRunManifestV1Schema,
  HeldOutRunResultsV1Schema,
  HeldOutRunnerBundleV1Schema,
  canonicalHeldOutJsonV1,
  type HeldOutEvidenceRegionV1,
  type HeldOutRunResultV1,
} from "../../src/shared/heldout-review-runner-contracts";
import {
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
  type HeldOutFindingDispositionV1,
  type HeldOutOracleEntryV1,
  type HeldOutPrivateFindingV1,
} from "../../src/benchmark/heldout-review-evaluator-contracts";
import type { EvaluateHeldOutReviewV1Input } from "../../src/benchmark/heldout-review-evaluator";

export type SyntheticHeldOutDispositionKindV1 =
  | "matched_gold"
  | "valid_novel_defect"
  | "false_positive";

export type SyntheticHeldOutRunSpecV1 =
  | {
      ordinal: number;
      outcome: "accepted";
      conclusion?: "blocking_findings" | "no_blocking_findings";
    }
  | {
      ordinal: number;
      outcome: "invalid" | "blocked" | "cancelled" | "unstarted";
      failureCode?: string;
    };

export interface SyntheticHeldOutFindingSpecV1 {
  ordinal: number;
  findingId: string;
  /** Selects the evidence region and the gold ID used by matched dispositions. */
  evidenceGoldIndex?: number;
  adjudicatorDispositions?: readonly [
    SyntheticHeldOutDispositionKindV1,
    SyntheticHeldOutDispositionKindV1,
  ];
  /** Present only when the two independent dispositions disagree. */
  resolutionDisposition?: SyntheticHeldOutDispositionKindV1;
  /** Zero or one deliberately produces an incomplete adjudication. */
  judgmentCount?: 0 | 1 | 2;
  /** False deliberately leaves the emitted finding without a packet. */
  includePacket?: boolean;
}

export interface BuildSyntheticHeldOutReviewScenarioV1Config {
  runSpecs?: readonly SyntheticHeldOutRunSpecV1[];
  findingSpecs?: readonly SyntheticHeldOutFindingSpecV1[];
  bootstrapSeedUint32?: number;
  bootstrapReplicateCount?: number;
  /** Optional exact private value for executable disclosure-regression tests. */
  privateSentinel?: string;
}

export function syntheticHeldOutDigestV1(label: string): string {
  return createHash("sha256").update(`synthetic:${label}`, "utf8").digest("hex");
}

export function syntheticHeldOutEvidenceRegionV1(ordinal: number) {
  return {
    kind: "change" as const,
    path: `src/synthetic-fixture-${String(ordinal).padStart(2, "0")}.ts`,
    side: "working" as const,
    startLine: ordinal,
    endLine: ordinal,
    hunkSha256: syntheticHeldOutDigestV1(`hunk:${ordinal}`),
  };
}

export function syntheticHeldOutDispositionV1(
  kind: SyntheticHeldOutDispositionKindV1,
  goldDefectId?: string,
): HeldOutFindingDispositionV1 {
  if (kind === "matched_gold") {
    if (!goldDefectId) {
      throw new TypeError("Synthetic matched disposition requires a gold ID.");
    }
    return { kind, goldDefectId };
  }
  return { kind };
}

function syntheticCorpusV1() {
  const fixtures = Array.from({ length: HELD_OUT_FIXTURE_COUNT }, (_, index) => {
    const ordinal = index + 1;
    return {
      schemaVersion: "heldout-runner-fixture-v1" as const,
      ordinal,
      fixtureCommitment: syntheticHeldOutDigestV1(`fixture:${ordinal}`),
      snapshotCommitment: syntheticHeldOutDigestV1(`snapshot:${ordinal}`),
      evidencePacketCommitment: syntheticHeldOutDigestV1(`evidence:${ordinal}`),
      promptSchemaCommitment: syntheticHeldOutDigestV1("prompt-schema:v1"),
      evidenceLimitsCommitment: syntheticHeldOutDigestV1("evidence-limits:v1"),
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
        const goldDefectId = `synthetic-d-${String(fixture.ordinal).padStart(2, "0")}-${suffix}`;
        return {
          schemaVersion: "heldout-gold-defect-v1" as const,
          goldDefectId,
          severity,
          evidenceRegions: [syntheticHeldOutEvidenceRegionV1(fixture.ordinal)],
          semanticRubric: {
            defectClaim: `Synthetic required defect claim for ${goldDefectId}.`,
            impactCriterion: `Synthetic required impact for ${goldDefectId}.`,
            nonMatchGuidance: `Synthetic non-match guidance for ${goldDefectId}.`,
          },
          witnessCommitment: syntheticHeldOutDigestV1(
            `witness:${fixture.ordinal}:${goldDefectId}`,
          ),
        };
      })
      .sort((left, right) => left.goldDefectId.localeCompare(right.goldDefectId));
    for (const defect of goldDefects) {
      witnessFreezeRecords.push({
        schemaVersion: "heldout-witness-freeze-v1",
        ordinal: fixture.ordinal,
        fixtureCommitment: fixture.fixtureCommitment,
        witnessCommitment: defect.witnessCommitment,
        goldDefectIds: [defect.goldDefectId],
        materializationProtocolVersion: "synthetic-materialization-v1",
        commandProtocolVersion: "synthetic-command-v1",
        environmentFingerprint: syntheticHeldOutDigestV1("environment:v1"),
        faultyCandidate: {
          exitCode: 1,
          stdoutSha256: syntheticHeldOutDigestV1(
            `faulty-stdout:${defect.goldDefectId}`,
          ),
          stdoutBytes: 24,
          stderrSha256: syntheticHeldOutDigestV1(
            `faulty-stderr:${defect.goldDefectId}`,
          ),
          stderrBytes: 48,
        },
        correctedCandidate: {
          exitCode: 0,
          stdoutSha256: syntheticHeldOutDigestV1(
            `corrected-stdout:${defect.goldDefectId}`,
          ),
          stdoutBytes: 12,
          stderrSha256: syntheticHeldOutDigestV1(
            `corrected-stderr:${defect.goldDefectId}`,
          ),
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
    return String(left.witnessCommitment).localeCompare(
      String(right.witnessCommitment),
    );
  });
  const preimage = HeldOutCommitmentPreimageV1Schema.parse({
    schemaVersion: "heldout-set-commitment-preimage-v1",
    protocolId: "change-review-eval-v1",
    evaluatorVersion: "change-review-evaluator-v1",
    setVersion: "synthetic-heldout-24-v1",
    runnerFixtures: fixtures,
    oracleEntries: entries,
    witnessFreezeRecords,
  });
  const saltBase64 = Buffer.alloc(32, 0x53).toString("base64");
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

function regionsOverlap(
  left: HeldOutEvidenceRegionV1,
  right: HeldOutEvidenceRegionV1,
): boolean {
  if (left.kind !== right.kind || left.path !== right.path) return false;
  if (left.kind === "change_metadata" || right.kind === "change_metadata") {
    return (
      left.kind === "change_metadata" &&
      right.kind === "change_metadata" &&
      left.changeKind === right.changeKind
    );
  }
  return (
    left.side === right.side &&
    left.hunkSha256 === right.hunkSha256 &&
    left.startLine <= right.endLine &&
    right.startLine <= left.endLine
  );
}

function candidateGoldFor(
  finding: HeldOutPrivateFindingV1,
  entry: HeldOutOracleEntryV1,
) {
  if (entry.fixtureClass === "clean") return [];
  return entry.goldDefects
    .flatMap((gold) => {
      const overlappingRegions = finding.evidenceRegions.filter((region) =>
        gold.evidenceRegions.some((goldRegion) =>
          regionsOverlap(region, goldRegion),
        ),
      );
      return overlappingRegions.length === 0
        ? []
        : [
            {
              goldDefectId: gold.goldDefectId,
              severity: gold.severity,
              semanticRubric: gold.semanticRubric,
              overlappingRegions,
            },
          ];
    })
    .sort((left, right) => left.goldDefectId.localeCompare(right.goldDefectId));
}

function unstartedTelemetry() {
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
    infrastructureCostMicrousd: null,
  };
}

function attemptedTelemetry(ordinal: number, accepted: boolean) {
  return {
    inferenceAttemptCount: 1,
    successfulToolCount: accepted ? 2 : 0,
    usage: {
      inputTokens: 100 + ordinal,
      outputTokens: 20 + ordinal,
      reasoningTokens: ordinal,
      cacheReadTokens: 0,
      reportedAttempts: 1,
    },
    endToEndLatencyMs: accepted ? 100 + ordinal * 10 : null,
    selectedTokenCostMicrousd: 0,
    selectedCostProvenance: "local_zero_cost_policy" as const,
    infrastructureCostMicrousd: null,
  };
}

const REQUIRED_BLINDING = {
  providerHidden: true,
  policyHidden: true,
  costHidden: true,
  peerJudgmentHidden: true,
} as const;

function studyId(pairIndex: number, side: "A" | "B"): string {
  return `study-${String(pairIndex).padStart(21, "0")}${side}`;
}

/**
 * Builds a complete, in-memory, explicitly synthetic 24-case evaluation input.
 * It performs no filesystem, subprocess, provider, or network operation.
 */
export function buildSyntheticHeldOutReviewScenarioV1(
  config: BuildSyntheticHeldOutReviewScenarioV1Config = {},
) {
  const corpus = syntheticCorpusV1();
  const findingSpecs = [...(config.findingSpecs ?? [])];
  const runSpecByOrdinal = new Map<number, SyntheticHeldOutRunSpecV1>();
  for (const runSpec of config.runSpecs ?? []) {
    if (runSpecByOrdinal.has(runSpec.ordinal)) {
      throw new TypeError("Synthetic run ordinals must be unique.");
    }
    runSpecByOrdinal.set(runSpec.ordinal, runSpec);
  }
  const findingSpecsByOrdinal = new Map<number, SyntheticHeldOutFindingSpecV1[]>();
  for (const findingSpec of findingSpecs) {
    const records = findingSpecsByOrdinal.get(findingSpec.ordinal) ?? [];
    records.push(findingSpec);
    findingSpecsByOrdinal.set(findingSpec.ordinal, records);
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const manifest = HeldOutRunManifestV1Schema.parse({
    schemaVersion: "heldout-run-manifest-v1",
    protocolId: "change-review-eval-v1",
    evaluatorVersion: "change-review-evaluator-v1",
    setVersion: corpus.runner.setVersion,
    setCommitment: corpus.runner.setCommitment,
    implementationRevision: "a".repeat(40),
    policy: "local_only_v1",
    providerIdentity: {
      providerId: "synthetic-local-provider",
      requestedModel: "synthetic-test-model",
      servedModel: "synthetic-test-model-build-v1",
    },
    deploymentFingerprint: syntheticHeldOutDigestV1("deployment:v1"),
    configurationFingerprint: syntheticHeldOutDigestV1("configuration:v1"),
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
      bootstrapSeedUint32: config.bootstrapSeedUint32 ?? 0x1020_3040,
      bootstrapReplicateCount: config.bootstrapReplicateCount ?? 256,
    },
    campaignAuthorityId: "synthetic-offline-campaign-v1",
    coordinator: {
      signatureAlgorithm: "Ed25519",
      verificationKeyFingerprint:
        coordinatorVerificationKeyFingerprintV1(publicKey),
    },
  });
  const runManifestSha256 = computeHeldOutRunManifestSha256V1(manifest);

  const privateFindings = findingSpecs.map((findingSpec) => {
    const entry = corpus.oracle.entries[findingSpec.ordinal - 1];
    if (!entry) throw new TypeError("Synthetic finding ordinal is invalid.");
    const selectedGold =
      entry.fixtureClass === "faulty"
        ? entry.goldDefects[findingSpec.evidenceGoldIndex ?? 0]
        : undefined;
    if (entry.fixtureClass === "faulty" && !selectedGold) {
      throw new TypeError("Synthetic gold index is invalid.");
    }
    return HeldOutPrivateFindingV1Schema.parse({
      schemaVersion: "heldout-private-finding-v1",
      ordinal: findingSpec.ordinal,
      fixtureCommitment: entry.fixtureCommitment,
      findingId: findingSpec.findingId,
      reviewResultSha256: syntheticHeldOutDigestV1(
        `review-result:${findingSpec.ordinal}`,
      ),
      title: `Synthetic finding ${findingSpec.findingId}`,
      defectClaim: `Synthetic defect claim for ${findingSpec.findingId}.${
        config.privateSentinel ? ` ${config.privateSentinel}` : ""
      }`,
      impact: `Synthetic impact for ${findingSpec.findingId}.`,
      proposedCorrection: `Synthetic correction for ${findingSpec.findingId}.`,
      testRecommendation: `Synthetic regression test for ${findingSpec.findingId}.`,
      evidenceRegions:
        selectedGold?.evidenceRegions ?? [
          syntheticHeldOutEvidenceRegionV1(findingSpec.ordinal),
        ],
    });
  });
  const privateFindingByBinding = new Map(
    privateFindings.map((finding) => [
      `${finding.ordinal}:${finding.findingId}`,
      finding,
    ]),
  );

  const runResults = HeldOutRunResultsV1Schema.parse({
    schemaVersion: "heldout-run-results-v1",
    protocolId: "change-review-eval-v1",
    evaluatorVersion: "change-review-evaluator-v1",
    setVersion: corpus.runner.setVersion,
    setCommitment: corpus.runner.setCommitment,
    runManifestSha256,
    results: corpus.runner.fixtures.map((fixture): HeldOutRunResultV1 => {
      const ordinalFindingSpecs = findingSpecsByOrdinal.get(fixture.ordinal) ?? [];
      const runSpec: SyntheticHeldOutRunSpecV1 =
        runSpecByOrdinal.get(fixture.ordinal) ??
        (ordinalFindingSpecs.length > 0
          ? { ordinal: fixture.ordinal, outcome: "accepted" }
          : { ordinal: fixture.ordinal, outcome: "unstarted" });
      if (runSpec.outcome === "accepted") {
        const findings = ordinalFindingSpecs.map((findingSpec) => {
          const finding = privateFindingByBinding.get(
            `${fixture.ordinal}:${findingSpec.findingId}`,
          );
          if (!finding) throw new TypeError("Synthetic private finding is missing.");
          return {
            findingId: finding.findingId,
            evidenceRegions: finding.evidenceRegions,
            privateFindingSha256:
              computeHeldOutPrivateFindingSha256V1(finding),
          };
        });
        return {
          schemaVersion: "heldout-run-result-v1",
          ordinal: fixture.ordinal,
          fixtureCommitment: fixture.fixtureCommitment,
          telemetry: attemptedTelemetry(fixture.ordinal, true),
          outcome: "accepted",
          conclusion:
            runSpec.conclusion ??
            (findings.length > 0
              ? "blocking_findings"
              : "no_blocking_findings"),
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
          findings,
          reviewResultSha256: syntheticHeldOutDigestV1(
            `review-result:${fixture.ordinal}`,
          ),
          safeTraceSha256: syntheticHeldOutDigestV1(
            `safe-trace:${fixture.ordinal}`,
          ),
        };
      }
      if (ordinalFindingSpecs.length > 0) {
        throw new TypeError("Synthetic findings require an accepted result.");
      }
      if (runSpec.outcome === "unstarted") {
        return {
          schemaVersion: "heldout-run-result-v1",
          ordinal: fixture.ordinal,
          fixtureCommitment: fixture.fixtureCommitment,
          telemetry: unstartedTelemetry(),
          outcome: "unstarted",
          failureCode: runSpec.failureCode ?? "synthetic-not-dispatched",
        };
      }
      return {
        schemaVersion: "heldout-run-result-v1",
        ordinal: fixture.ordinal,
        fixtureCommitment: fixture.fixtureCommitment,
        telemetry: attemptedTelemetry(fixture.ordinal, false),
        outcome: runSpec.outcome,
        failureCode: runSpec.failureCode ?? `synthetic-${runSpec.outcome}`,
        safeTraceSha256: syntheticHeldOutDigestV1(
          `safe-trace:${fixture.ordinal}`,
        ),
      };
    }),
  });

  const packets: ReturnType<typeof HeldOutAdjudicationPacketV1Schema.parse>[] = [];
  const judgments: ReturnType<typeof HeldOutAdjudicatorJudgmentV1Schema.parse>[] = [];
  const attestations: ReturnType<
    typeof HeldOutCoordinatorAttestationV1Schema.parse
  >[] = [];
  const resolutions: ReturnType<
    typeof HeldOutAdjudicationResolutionV1Schema.parse
  >[] = [];

  findingSpecs.forEach((findingSpec, findingIndex) => {
    if (findingSpec.includePacket === false) return;
    const finding = privateFindingByBinding.get(
      `${findingSpec.ordinal}:${findingSpec.findingId}`,
    );
    const entry = corpus.oracle.entries[findingSpec.ordinal - 1];
    if (!finding || !entry) throw new TypeError("Synthetic finding binding failed.");
    const selectedGold =
      entry.fixtureClass === "faulty"
        ? entry.goldDefects[findingSpec.evidenceGoldIndex ?? 0]
        : undefined;
    const defaultDisposition = selectedGold
      ? ("matched_gold" as const)
      : ("false_positive" as const);
    const dispositions = findingSpec.adjudicatorDispositions ??
      ([defaultDisposition, defaultDisposition] as const);
    const dispositionRecords = dispositions.map((kind) =>
      syntheticHeldOutDispositionV1(kind, selectedGold?.goldDefectId),
    ) as [HeldOutFindingDispositionV1, HeldOutFindingDispositionV1];
    const packet = HeldOutAdjudicationPacketV1Schema.parse({
      schemaVersion: "heldout-adjudication-packet-v1",
      setCommitment: corpus.runner.setCommitment,
      runManifestSha256,
      finding,
      candidateGold: candidateGoldFor(finding, entry),
    });
    packets.push(packet);
    const packetSha256 = computeHeldOutAdjudicationPacketSha256V1(packet);
    const studies = [
      studyId(findingIndex + 1, "A"),
      studyId(findingIndex + 1, "B"),
    ] as const;
    const judgmentPreimages = studies.map((currentStudyId, index) =>
      HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema.parse({
        schemaVersion: "heldout-adjudicator-judgment-v1",
        setCommitment: corpus.runner.setCommitment,
        runManifestSha256,
        packetSha256,
        ordinal: finding.ordinal,
        fixtureCommitment: finding.fixtureCommitment,
        findingId: finding.findingId,
        studyId: currentStudyId,
        blinding: REQUIRED_BLINDING,
        disposition: dispositionRecords[index],
      }),
    ) as [
      ReturnType<
        typeof HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema.parse
      >,
      ReturnType<
        typeof HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema.parse
      >,
    ];
    const pairAttestations = studies.map((currentStudyId, index) => {
      const payload = {
        schemaVersion: "heldout-coordinator-attestation-payload-v1" as const,
        setCommitment: corpus.runner.setCommitment,
        runManifestSha256,
        packetSha256,
        studyId: currentStudyId,
        pairedStudyId: studies[1 - index]!,
        judgmentCommitment: computeHeldOutJudgmentCommitmentV1(
          judgmentPreimages[index],
        ),
        distinctHumans: true as const,
        blinding: REQUIRED_BLINDING,
        issuedAt: "2026-08-30T12:00:00.000Z",
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
    const pairJudgments = studies.map((_currentStudyId, index) =>
      HeldOutAdjudicatorJudgmentV1Schema.parse({
        ...judgmentPreimages[index],
        coordinatorAttestationSha256:
          computeHeldOutCoordinatorAttestationSha256V1(
            pairAttestations[index],
          ),
      }),
    ) as [
      ReturnType<typeof HeldOutAdjudicatorJudgmentV1Schema.parse>,
      ReturnType<typeof HeldOutAdjudicatorJudgmentV1Schema.parse>,
    ];
    const judgmentCount = findingSpec.judgmentCount ?? 2;
    judgments.push(...pairJudgments.slice(0, judgmentCount));
    attestations.push(...pairAttestations.slice(0, judgmentCount));

    if (findingSpec.resolutionDisposition !== undefined) {
      if (
        judgmentCount !== 2 ||
        canonicalHeldOutJsonV1(dispositionRecords[0]) ===
          canonicalHeldOutJsonV1(dispositionRecords[1])
      ) {
        throw new TypeError(
          "Synthetic resolution requires two disagreeing judgments.",
        );
      }
      const resolutionPayload =
        HeldOutAdjudicationResolutionSigningPayloadV1Schema.parse({
          schemaVersion: "heldout-adjudication-resolution-v1",
          setCommitment: corpus.runner.setCommitment,
          runManifestSha256,
          packetSha256,
          ordinal: finding.ordinal,
          fixtureCommitment: finding.fixtureCommitment,
          findingId: finding.findingId,
          studyIds: studies,
          judgmentSha256s: pairJudgments.map(computeHeldOutJudgmentSha256V1),
          finalDisposition: syntheticHeldOutDispositionV1(
            findingSpec.resolutionDisposition,
            selectedGold?.goldDefectId,
          ),
          resolvedJointly: true,
          resolvedAt: "2026-08-30T13:00:00.000Z",
        });
      resolutions.push(
        HeldOutAdjudicationResolutionV1Schema.parse({
          ...resolutionPayload,
          signatureAlgorithm: "Ed25519",
          coordinatorSignatureBase64: signBytes(
            null,
            heldOutAdjudicationResolutionSigningBytesV1(resolutionPayload),
            privateKey,
          ).toString("base64"),
        }),
      );
    }
  });

  const input: EvaluateHeldOutReviewV1Input = {
    runner: corpus.runner,
    oracle: corpus.oracle,
    commitmentMaterial: corpus.commitmentMaterial,
    manifest,
    runResults,
    privateFindings,
    adjudicationPackets: packets,
    judgments,
    coordinatorAttestations: attestations,
    resolutions,
    coordinatorPublicKey: publicKey,
  };

  return {
    input,
    corpus,
    manifest,
    runManifestSha256,
    runResults,
    privateFindings,
    packets,
    judgments,
    attestations,
    resolutions,
    coordinatorPublicKey: publicKey,
    coordinatorPrivateKey: privateKey,
    coordinatorPublicKeyPem: publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
    privateInputFiles: {
      privateFindings: {
        schemaVersion: "heldout-private-findings-file-v1" as const,
        privateFindings,
      },
      adjudicationPackets: {
        schemaVersion: "heldout-adjudication-packets-file-v1" as const,
        adjudicationPackets: packets,
      },
      judgments: {
        schemaVersion: "heldout-adjudicator-judgments-file-v1" as const,
        judgments,
      },
      coordinatorAttestations: {
        schemaVersion: "heldout-coordinator-attestations-file-v1" as const,
        coordinatorAttestations: attestations,
      },
      resolutions: {
        schemaVersion: "heldout-adjudication-resolutions-file-v1" as const,
        resolutions,
      },
    },
  };
}

export type SyntheticHeldOutReviewScenarioV1 = ReturnType<
  typeof buildSyntheticHeldOutReviewScenarioV1
>;
