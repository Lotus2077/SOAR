import {
  createHash,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import { Buffer } from "node:buffer";

import { z } from "zod";

import { Sha256Schema } from "../shared/change-review-contracts.ts";
import {
  HELD_OUT_COMMITMENT_SCHEME,
  HELD_OUT_EVALUATOR_VERSION,
  HELD_OUT_FIXTURE_COUNT,
  HELD_OUT_REVIEW_PROTOCOL_ID,
  HeldOutEvidenceRegionV1Schema,
  HeldOutRunManifestV1Schema,
  HeldOutRunResultsV1Schema,
  HeldOutRunnerBundleV1Schema,
  HeldOutRunnerFixtureV1Schema,
  canonicalHeldOutRunManifestV1,
  canonicalHeldOutJsonV1,
  type HeldOutEvidenceRegionV1,
  type HeldOutRunManifestV1,
  type HeldOutRunResultsV1,
  type HeldOutRunnerBundleV1,
} from "../shared/heldout-review-runner-contracts.ts";

export const HELD_OUT_CLEAN_FIXTURE_COUNT = 8 as const;
export const HELD_OUT_FAULTY_FIXTURE_COUNT = 16 as const;
export const HELD_OUT_MINIMUM_P0_P1_DEFECTS = 20 as const;
export const HELD_OUT_MINIMUM_P2_P3_DEFECTS = 8 as const;
export const HELD_OUT_SALT_BYTES = 32 as const;
export const HELD_OUT_SET_COMMITMENT_DOMAIN =
  "soar-heldout-set-v1" as const;
export const HELD_OUT_COORDINATOR_ATTESTATION_DOMAIN =
  "soar-heldout-coordinator-attestation-v1" as const;
export const HELD_OUT_JUDGMENT_COMMITMENT_DOMAIN =
  "soar-heldout-adjudicator-judgment-commitment-v1" as const;
export const HELD_OUT_RESOLUTION_SIGNATURE_DOMAIN =
  "soar-heldout-adjudication-resolution-signature-v1" as const;

const boundedId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const boundedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine(
      (value) => value.trim() === value && value.trim().length > 0,
      "Expected a bounded non-blank string without surrounding whitespace.",
    );
const safeNonNegativeInteger = z.number().int().nonnegative().safe();
const safePositiveInteger = z.number().int().positive().safe();
const boundedWitnessExitCode = z.number().int().min(-255).max(255).safe();
const fixtureOrdinal = z
  .number()
  .int()
  .min(1)
  .max(HELD_OUT_FIXTURE_COUNT)
  .safe();
const exactSaltBase64 = z.string().refine((value) => {
  try {
    const decoded = Buffer.from(value, "base64");
    return (
      decoded.byteLength === HELD_OUT_SALT_BYTES &&
      decoded.toString("base64") === value
    );
  } catch {
    return false;
  }
}, "Expected canonical base64 for exactly 32 salt bytes.");
const exactEd25519SignatureBase64 = z.string().refine((value) => {
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.byteLength === 64 && decoded.toString("base64") === value;
  } catch {
    return false;
  }
}, "Expected one canonical base64 Ed25519 signature.");
const studyId = z
  .string()
  .regex(
    /^study-[A-Za-z0-9_-]{22}$/u,
    "Expected a random or keyed 128-bit base64url study identifier.",
  );

interface RefinementContext {
  addIssue(issue: {
    code: "custom";
    path?: PropertyKey[];
    message: string;
  }): void;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(
  context: RefinementContext,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

function requireExactOrderedOrdinals(
  values: readonly { ordinal: number }[],
  context: RefinementContext,
  path: PropertyKey[],
): void {
  values.forEach((value, index) => {
    if (value.ordinal !== index + 1) {
      issue(
        context,
        [...path, index, "ordinal"],
        `Ordinals must be exactly 1 through ${HELD_OUT_FIXTURE_COUNT} in order.`,
      );
    }
  });
}

function requireUnique(
  values: readonly string[],
  context: RefinementContext,
  path: PropertyKey[],
  label: string,
): void {
  if (new Set(values).size !== values.length) {
    issue(context, path, `${label} must be unique.`);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function computeHeldOutRunManifestSha256V1(input: unknown): string {
  return sha256(canonicalHeldOutRunManifestV1(input));
}

const HeldOutSemanticRubricV1Schema = z
  .object({
    defectClaim: boundedText(4_096),
    impactCriterion: boundedText(4_096),
    nonMatchGuidance: boundedText(4_096).optional(),
  })
  .strict();

export const HeldOutGoldDefectV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-gold-defect-v1"),
    goldDefectId: boundedId,
    severity: z.enum(["P0", "P1", "P2", "P3"]),
    evidenceRegions: z.array(HeldOutEvidenceRegionV1Schema).min(1).max(32),
    semanticRubric: HeldOutSemanticRubricV1Schema,
    witnessCommitment: Sha256Schema,
  })
  .strict()
  .superRefine((record, context) => {
    requireUnique(
      record.evidenceRegions.map(canonicalHeldOutJsonV1),
      context,
      ["evidenceRegions"],
      "Evidence regions",
    );
  });

export type HeldOutGoldDefectV1 = z.infer<
  typeof HeldOutGoldDefectV1Schema
>;

const HeldOutOracleEntryBaseV1Schema = z.object({
  schemaVersion: z.literal("heldout-oracle-entry-v1"),
  ordinal: fixtureOrdinal,
  fixtureCommitment: Sha256Schema,
});

const HeldOutCleanOracleEntryV1Schema = HeldOutOracleEntryBaseV1Schema.extend({
  fixtureClass: z.literal("clean"),
  goldDefects: z.tuple([]),
}).strict();

const HeldOutFaultyOracleEntryV1Schema = HeldOutOracleEntryBaseV1Schema.extend({
  fixtureClass: z.literal("faulty"),
  goldDefects: z.array(HeldOutGoldDefectV1Schema).min(1).max(64),
})
  .strict()
  .superRefine((entry, context) => {
    const ids = entry.goldDefects.map((record) => record.goldDefectId);
    requireUnique(ids, context, ["goldDefects"], "Gold record IDs");
    if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) {
      issue(
        context,
        ["goldDefects"],
        "Gold records must be strictly sorted by ID.",
      );
    }
  });

export const HeldOutOracleEntryV1Schema = z.discriminatedUnion(
  "fixtureClass",
  [HeldOutCleanOracleEntryV1Schema, HeldOutFaultyOracleEntryV1Schema],
);

export type HeldOutOracleEntryV1 = z.infer<
  typeof HeldOutOracleEntryV1Schema
>;

export const HeldOutOracleBundleV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-oracle-bundle-v1"),
    protocolId: z.literal(HELD_OUT_REVIEW_PROTOCOL_ID),
    evaluatorVersion: z.literal(HELD_OUT_EVALUATOR_VERSION),
    setVersion: boundedId,
    setCommitment: Sha256Schema,
    entries: z
      .array(HeldOutOracleEntryV1Schema)
      .length(HELD_OUT_FIXTURE_COUNT),
  })
  .strict()
  .superRefine((bundle, context) => {
    requireExactOrderedOrdinals(bundle.entries, context, ["entries"]);
    requireUnique(
      bundle.entries.map((entry) => entry.fixtureCommitment),
      context,
      ["entries"],
      "Fixture commitments",
    );
    const cleanCount = bundle.entries.filter(
      (entry) => entry.fixtureClass === "clean",
    ).length;
    const faultyCount = bundle.entries.length - cleanCount;
    if (cleanCount !== HELD_OUT_CLEAN_FIXTURE_COUNT) {
      issue(
        context,
        ["entries"],
        `Exactly ${HELD_OUT_CLEAN_FIXTURE_COUNT} clean fixtures are required.`,
      );
    }
    if (faultyCount !== HELD_OUT_FAULTY_FIXTURE_COUNT) {
      issue(
        context,
        ["entries"],
        `Exactly ${HELD_OUT_FAULTY_FIXTURE_COUNT} faulty fixtures are required.`,
      );
    }
    const records = bundle.entries.flatMap((entry) => entry.goldDefects);
    const p0p1 = records.filter(
      (record) => record.severity === "P0" || record.severity === "P1",
    ).length;
    const p2p3 = records.length - p0p1;
    if (p0p1 < HELD_OUT_MINIMUM_P0_P1_DEFECTS) {
      issue(
        context,
        ["entries"],
        `At least ${HELD_OUT_MINIMUM_P0_P1_DEFECTS} P0/P1 records are required.`,
      );
    }
    if (p2p3 < HELD_OUT_MINIMUM_P2_P3_DEFECTS) {
      issue(
        context,
        ["entries"],
        `At least ${HELD_OUT_MINIMUM_P2_P3_DEFECTS} P2/P3 records are required.`,
      );
    }
  });

export type HeldOutOracleBundleV1 = z.infer<
  typeof HeldOutOracleBundleV1Schema
>;

const HeldOutWitnessProcessResultV1Schema = z
  .object({
    exitCode: boundedWitnessExitCode,
    stdoutSha256: Sha256Schema,
    stdoutBytes: safeNonNegativeInteger.max(1_048_576),
    stderrSha256: Sha256Schema,
    stderrBytes: safeNonNegativeInteger.max(1_048_576),
  })
  .strict();

export const HeldOutWitnessFreezeRecordV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-witness-freeze-v1"),
    ordinal: fixtureOrdinal,
    fixtureCommitment: Sha256Schema,
    witnessCommitment: Sha256Schema,
    goldDefectIds: z.array(boundedId).min(1).max(64),
    materializationProtocolVersion: boundedId,
    commandProtocolVersion: boundedId,
    environmentFingerprint: Sha256Schema,
    faultyCandidate: HeldOutWitnessProcessResultV1Schema,
    correctedCandidate: HeldOutWitnessProcessResultV1Schema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.faultyCandidate.exitCode === 0) {
      issue(
        context,
        ["faultyCandidate", "exitCode"],
        "The faulty candidate must have a nonzero result.",
      );
    }
    if (record.correctedCandidate.exitCode !== 0) {
      issue(
        context,
        ["correctedCandidate", "exitCode"],
        "The corrected candidate must have a zero result.",
      );
    }
    requireUnique(
      record.goldDefectIds,
      context,
      ["goldDefectIds"],
      "Bound record IDs",
    );
    if (
      record.goldDefectIds.some(
        (id, index) => index > 0 && record.goldDefectIds[index - 1]! >= id,
      )
    ) {
      issue(
        context,
        ["goldDefectIds"],
        "Bound record IDs must be strictly sorted.",
      );
    }
  });

export type HeldOutWitnessFreezeRecordV1 = z.infer<
  typeof HeldOutWitnessFreezeRecordV1Schema
>;

export const HeldOutCommitmentPreimageV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-set-commitment-preimage-v1"),
    protocolId: z.literal(HELD_OUT_REVIEW_PROTOCOL_ID),
    evaluatorVersion: z.literal(HELD_OUT_EVALUATOR_VERSION),
    setVersion: boundedId,
    runnerFixtures: z
      .array(HeldOutRunnerFixtureV1Schema)
      .length(HELD_OUT_FIXTURE_COUNT),
    oracleEntries: z
      .array(HeldOutOracleEntryV1Schema)
      .length(HELD_OUT_FIXTURE_COUNT),
    witnessFreezeRecords: z
      .array(HeldOutWitnessFreezeRecordV1Schema)
      .min(HELD_OUT_FAULTY_FIXTURE_COUNT)
      .max(HELD_OUT_FAULTY_FIXTURE_COUNT * 64),
  })
  .strict()
  .superRefine((preimage, context) => {
    requireExactOrderedOrdinals(preimage.runnerFixtures, context, ["runnerFixtures"]);
    requireExactOrderedOrdinals(preimage.oracleEntries, context, ["oracleEntries"]);
    requireUnique(
      preimage.runnerFixtures.map((fixture) => fixture.fixtureCommitment),
      context,
      ["runnerFixtures"],
      "Runner fixture commitments",
    );
    requireUnique(
      preimage.witnessFreezeRecords.map(
        (record) => `${record.ordinal}:${record.witnessCommitment}`,
      ),
      context,
      ["witnessFreezeRecords"],
      "Witness bindings",
    );
    const sorted = [...preimage.witnessFreezeRecords].sort(
      (left, right) =>
        left.ordinal - right.ordinal ||
        compareText(left.witnessCommitment, right.witnessCommitment),
    );
    if (
      canonicalHeldOutJsonV1(sorted) !==
      canonicalHeldOutJsonV1(preimage.witnessFreezeRecords)
    ) {
      issue(
        context,
        ["witnessFreezeRecords"],
        "Witness records must be sorted by ordinal and commitment.",
      );
    }
  });

export type HeldOutCommitmentPreimageV1 = z.infer<
  typeof HeldOutCommitmentPreimageV1Schema
>;

export const HeldOutCommitmentMaterialV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-commitment-material-v1"),
    commitmentScheme: z.literal(HELD_OUT_COMMITMENT_SCHEME),
    saltBase64: exactSaltBase64,
    preimage: HeldOutCommitmentPreimageV1Schema,
    setCommitment: Sha256Schema,
  })
  .strict();

export type HeldOutCommitmentMaterialV1 = z.infer<
  typeof HeldOutCommitmentMaterialV1Schema
>;

export function computeHeldOutSetCommitmentV1(input: {
  saltBase64: string;
  preimage: unknown;
}): string {
  const saltBase64 = exactSaltBase64.parse(input.saltBase64);
  const preimage = HeldOutCommitmentPreimageV1Schema.parse(input.preimage);
  const hash = createHash("sha256");
  hash.update(HELD_OUT_SET_COMMITMENT_DOMAIN, "utf8");
  hash.update(Uint8Array.of(0));
  hash.update(Buffer.from(saltBase64, "base64"));
  hash.update(Uint8Array.of(0));
  hash.update(canonicalHeldOutJsonV1(preimage), "utf8");
  return hash.digest("hex");
}

export function assertHeldOutSetCommitmentV1(
  input: unknown,
): HeldOutCommitmentMaterialV1 {
  const material = HeldOutCommitmentMaterialV1Schema.parse(input);
  if (computeHeldOutSetCommitmentV1(material) !== material.setCommitment) {
    throw new TypeError("Salted set commitment does not match its material.");
  }
  return material;
}

export interface ValidatedHeldOutCorpusV1 {
  runner: HeldOutRunnerBundleV1;
  oracle: HeldOutOracleBundleV1;
  commitmentMaterial: HeldOutCommitmentMaterialV1;
  counts: {
    fixtures: 24;
    clean: 8;
    faulty: 16;
    p0p1Defects: number;
    p2p3Defects: number;
    witnessFreezeRecords: number;
  };
}

export function validateHeldOutCorpusV1(input: {
  runner: unknown;
  oracle: unknown;
  commitmentMaterial: unknown;
}): ValidatedHeldOutCorpusV1 {
  const runner = HeldOutRunnerBundleV1Schema.parse(input.runner);
  const oracle = HeldOutOracleBundleV1Schema.parse(input.oracle);
  const material = assertHeldOutSetCommitmentV1(input.commitmentMaterial);
  if (
    runner.setCommitment !== material.setCommitment ||
    oracle.setCommitment !== material.setCommitment
  ) {
    throw new TypeError("Corpus inputs do not share one set commitment.");
  }
  if (
    runner.setVersion !== oracle.setVersion ||
    runner.setVersion !== material.preimage.setVersion
  ) {
    throw new TypeError("Corpus inputs do not share one set version.");
  }
  if (
    canonicalHeldOutJsonV1(runner.fixtures) !==
      canonicalHeldOutJsonV1(material.preimage.runnerFixtures) ||
    canonicalHeldOutJsonV1(oracle.entries) !==
      canonicalHeldOutJsonV1(material.preimage.oracleEntries)
  ) {
    throw new TypeError("Corpus content differs from its committed preimage.");
  }
  runner.fixtures.forEach((fixture, index) => {
    const entry = oracle.entries[index];
    if (
      !entry ||
      entry.ordinal !== fixture.ordinal ||
      entry.fixtureCommitment !== fixture.fixtureCommitment
    ) {
      throw new TypeError("Runner and evaluator fixture bindings differ.");
    }
  });

  const covered = new Set<string>();
  for (const freeze of material.preimage.witnessFreezeRecords) {
    const entry = oracle.entries[freeze.ordinal - 1];
    if (
      !entry ||
      entry.fixtureClass !== "faulty" ||
      entry.fixtureCommitment !== freeze.fixtureCommitment
    ) {
      throw new TypeError("Witness record does not bind one faulty fixture.");
    }
    for (const recordId of freeze.goldDefectIds) {
      const record = entry.goldDefects.find(
        (candidate) => candidate.goldDefectId === recordId,
      );
      const key = `${entry.ordinal}:${recordId}`;
      if (
        !record ||
        record.witnessCommitment !== freeze.witnessCommitment ||
        covered.has(key)
      ) {
        throw new TypeError("Witness record does not uniquely cover its bound record.");
      }
      covered.add(key);
    }
  }
  const allBoundRecords = oracle.entries.flatMap((entry) =>
    entry.goldDefects.map((record) => `${entry.ordinal}:${record.goldDefectId}`),
  );
  if (
    covered.size !== allBoundRecords.length ||
    allBoundRecords.some((key) => !covered.has(key))
  ) {
    throw new TypeError("Every bound record requires exactly one witness record.");
  }

  const records = oracle.entries.flatMap((entry) => entry.goldDefects);
  const p0p1Defects = records.filter(
    (record) => record.severity === "P0" || record.severity === "P1",
  ).length;
  return {
    runner,
    oracle,
    commitmentMaterial: material,
    counts: {
      fixtures: HELD_OUT_FIXTURE_COUNT,
      clean: HELD_OUT_CLEAN_FIXTURE_COUNT,
      faulty: HELD_OUT_FAULTY_FIXTURE_COUNT,
      p0p1Defects,
      p2p3Defects: records.length - p0p1Defects,
      witnessFreezeRecords: material.preimage.witnessFreezeRecords.length,
    },
  };
}

export const HeldOutPrivateFindingV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-private-finding-v1"),
    ordinal: fixtureOrdinal,
    fixtureCommitment: Sha256Schema,
    findingId: boundedId,
    reviewResultSha256: Sha256Schema,
    title: boundedText(512),
    defectClaim: boundedText(4_096),
    impact: boundedText(4_096),
    proposedCorrection: boundedText(4_096),
    testRecommendation: boundedText(4_096),
    evidenceRegions: z.array(HeldOutEvidenceRegionV1Schema).min(1).max(32),
  })
  .strict()
  .superRefine((finding, context) => {
    requireUnique(
      finding.evidenceRegions.map(canonicalHeldOutJsonV1),
      context,
      ["evidenceRegions"],
      "Finding evidence regions",
    );
  });

export type HeldOutPrivateFindingV1 = z.infer<
  typeof HeldOutPrivateFindingV1Schema
>;

export function computeHeldOutPrivateFindingSha256V1(input: unknown): string {
  return sha256(
    canonicalHeldOutJsonV1(HeldOutPrivateFindingV1Schema.parse(input)),
  );
}

export function validateHeldOutPrivateFindingBindingsV1(input: {
  runResults: unknown;
  privateFindings: readonly unknown[];
}): {
  runResults: HeldOutRunResultsV1;
  privateFindings: HeldOutPrivateFindingV1[];
} {
  const runResults = HeldOutRunResultsV1Schema.parse(input.runResults);
  const privateFindings = input.privateFindings.map((finding) =>
    HeldOutPrivateFindingV1Schema.parse(finding),
  );
  const privateByBinding = new Map<string, HeldOutPrivateFindingV1>();
  for (const finding of privateFindings) {
    const key = `${finding.ordinal}:${finding.findingId}`;
    if (privateByBinding.has(key)) {
      throw new TypeError("Private finding bindings must be unique.");
    }
    privateByBinding.set(key, finding);
  }
  let expectedCount = 0;
  for (const result of runResults.results) {
    if (result.outcome !== "accepted") {
      continue;
    }
    for (const runFinding of result.findings) {
      expectedCount += 1;
      const key = `${result.ordinal}:${runFinding.findingId}`;
      const privateFinding = privateByBinding.get(key);
      if (
        !privateFinding ||
        privateFinding.fixtureCommitment !== result.fixtureCommitment ||
        privateFinding.reviewResultSha256 !== result.reviewResultSha256 ||
        canonicalHeldOutJsonV1(privateFinding.evidenceRegions) !==
          canonicalHeldOutJsonV1(runFinding.evidenceRegions) ||
        computeHeldOutPrivateFindingSha256V1(privateFinding) !==
          runFinding.privateFindingSha256
      ) {
        throw new TypeError("Private finding does not match its accepted run finding.");
      }
      privateByBinding.delete(key);
    }
  }
  if (privateByBinding.size !== 0 || expectedCount !== privateFindings.length) {
    throw new TypeError("Private findings must exactly cover accepted run findings.");
  }
  return { runResults, privateFindings };
}

const HeldOutBlindedCandidateV1Schema = z
  .object({
    goldDefectId: boundedId,
    severity: z.enum(["P0", "P1", "P2", "P3"]),
    semanticRubric: HeldOutSemanticRubricV1Schema,
    overlappingRegions: z.array(HeldOutEvidenceRegionV1Schema).min(1).max(32),
  })
  .strict();

export const HeldOutAdjudicationPacketV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-adjudication-packet-v1"),
    setCommitment: Sha256Schema,
    runManifestSha256: Sha256Schema,
    finding: HeldOutPrivateFindingV1Schema,
    candidateGold: z.array(HeldOutBlindedCandidateV1Schema).max(64),
  })
  .strict()
  .superRefine((packet, context) => {
    requireUnique(
      packet.candidateGold.map((candidate) => candidate.goldDefectId),
      context,
      ["candidateGold"],
      "Candidate record IDs",
    );
    const findingRegions = new Set(
      packet.finding.evidenceRegions.map(canonicalHeldOutJsonV1),
    );
    if (
      packet.candidateGold.some((candidate) =>
        candidate.overlappingRegions.some(
          (region) => !findingRegions.has(canonicalHeldOutJsonV1(region)),
        ),
      )
    ) {
      issue(
        context,
        ["candidateGold"],
        "Candidate overlap must be present in the finding evidence.",
      );
    }
  });

export type HeldOutAdjudicationPacketV1 = z.infer<
  typeof HeldOutAdjudicationPacketV1Schema
>;

export function computeHeldOutAdjudicationPacketSha256V1(input: unknown): string {
  return sha256(
    canonicalHeldOutJsonV1(HeldOutAdjudicationPacketV1Schema.parse(input)),
  );
}

export const HeldOutFindingDispositionV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("matched_gold"), goldDefectId: boundedId }).strict(),
  z.object({ kind: z.literal("valid_novel_defect") }).strict(),
  z.object({ kind: z.literal("false_positive") }).strict(),
]);

export type HeldOutFindingDispositionV1 = z.infer<
  typeof HeldOutFindingDispositionV1Schema
>;

const RequiredBlindingV1Schema = z
  .object({
    providerHidden: z.literal(true),
    policyHidden: z.literal(true),
    costHidden: z.literal(true),
    peerJudgmentHidden: z.literal(true),
  })
  .strict();

/**
 * Exact non-circular judgment commitment preimage. It contains every judgment
 * field except coordinatorAttestationSha256, which cannot exist until the
 * coordinator has signed this preimage's commitment.
 */
export const HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-adjudicator-judgment-v1"),
    setCommitment: Sha256Schema,
    runManifestSha256: Sha256Schema,
    packetSha256: Sha256Schema,
    ordinal: fixtureOrdinal,
    fixtureCommitment: Sha256Schema,
    findingId: boundedId,
    studyId,
    blinding: RequiredBlindingV1Schema,
    disposition: HeldOutFindingDispositionV1Schema,
  })
  .strict();

export type HeldOutAdjudicatorJudgmentCommitmentPreimageV1 = z.infer<
  typeof HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema
>;

export const HeldOutAdjudicatorJudgmentV1Schema =
  HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema.extend({
    coordinatorAttestationSha256: Sha256Schema,
  }).strict();

export type HeldOutAdjudicatorJudgmentV1 = z.infer<
  typeof HeldOutAdjudicatorJudgmentV1Schema
>;

export function computeHeldOutJudgmentCommitmentV1(input: unknown): string {
  const preimage =
    HeldOutAdjudicatorJudgmentCommitmentPreimageV1Schema.parse(input);
  const hash = createHash("sha256");
  hash.update(HELD_OUT_JUDGMENT_COMMITMENT_DOMAIN, "utf8");
  hash.update(Uint8Array.of(0));
  hash.update(canonicalHeldOutJsonV1(preimage), "utf8");
  return hash.digest("hex");
}

export const HeldOutCoordinatorAttestationPayloadV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-coordinator-attestation-payload-v1"),
    setCommitment: Sha256Schema,
    runManifestSha256: Sha256Schema,
    packetSha256: Sha256Schema,
    studyId,
    pairedStudyId: studyId,
    judgmentCommitment: Sha256Schema,
    distinctHumans: z.literal(true),
    blinding: RequiredBlindingV1Schema,
    issuedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.studyId === payload.pairedStudyId) {
      issue(
        context,
        ["pairedStudyId"],
        "Two distinct study IDs are required.",
      );
    }
  });

export type HeldOutCoordinatorAttestationPayloadV1 = z.infer<
  typeof HeldOutCoordinatorAttestationPayloadV1Schema
>;

export const HeldOutCoordinatorAttestationV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-coordinator-attestation-v1"),
    signatureAlgorithm: z.literal("Ed25519"),
    payload: HeldOutCoordinatorAttestationPayloadV1Schema,
    signatureBase64: exactEd25519SignatureBase64,
  })
  .strict();

export type HeldOutCoordinatorAttestationV1 = z.infer<
  typeof HeldOutCoordinatorAttestationV1Schema
>;

export function heldOutCoordinatorAttestationSigningBytesV1(
  input: unknown,
): Uint8Array {
  const payload = HeldOutCoordinatorAttestationPayloadV1Schema.parse(input);
  return Buffer.concat([
    Buffer.from(HELD_OUT_COORDINATOR_ATTESTATION_DOMAIN, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalHeldOutJsonV1(payload), "utf8"),
  ]);
}

export function computeHeldOutCoordinatorAttestationSha256V1(
  input: unknown,
): string {
  return sha256(
    canonicalHeldOutJsonV1(HeldOutCoordinatorAttestationV1Schema.parse(input)),
  );
}

export function coordinatorVerificationKeyFingerprintV1(
  publicKey: KeyObject,
): string {
  if (
    publicKey.type !== "public" ||
    publicKey.asymmetricKeyType !== "ed25519"
  ) {
    throw new TypeError("Coordinator key must be a public Ed25519 key.");
  }
  return sha256(
    publicKey.export({ format: "der", type: "spki" }) as Uint8Array,
  );
}

export function verifyHeldOutCoordinatorAttestationV1(input: {
  attestation: unknown;
  manifest: unknown;
  publicKey: KeyObject;
}): boolean {
  const attestation = HeldOutCoordinatorAttestationV1Schema.parse(
    input.attestation,
  );
  const manifest = HeldOutRunManifestV1Schema.parse(input.manifest);
  const key = input.publicKey;
  if (
    key.type !== "public" ||
    key.asymmetricKeyType !== "ed25519" ||
    coordinatorVerificationKeyFingerprintV1(key) !==
      manifest.coordinator.verificationKeyFingerprint ||
    attestation.payload.setCommitment !== manifest.setCommitment ||
    attestation.payload.runManifestSha256 !==
      computeHeldOutRunManifestSha256V1(manifest)
  ) {
    return false;
  }
  return verifySignature(
    null,
    heldOutCoordinatorAttestationSigningBytesV1(attestation.payload),
    key,
    Buffer.from(attestation.signatureBase64, "base64"),
  );
}

const HeldOutAdjudicationResolutionSigningPayloadBaseV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-adjudication-resolution-v1"),
    setCommitment: Sha256Schema,
    runManifestSha256: Sha256Schema,
    packetSha256: Sha256Schema,
    ordinal: fixtureOrdinal,
    fixtureCommitment: Sha256Schema,
    findingId: boundedId,
    studyIds: z.tuple([studyId, studyId]),
    judgmentSha256s: z.tuple([Sha256Schema, Sha256Schema]),
    finalDisposition: HeldOutFindingDispositionV1Schema,
    resolvedJointly: z.literal(true),
    resolvedAt: z.string().datetime({ offset: true }),
  })
  .strict();

function refineHeldOutAdjudicationResolutionV1(
  resolution: z.infer<
    typeof HeldOutAdjudicationResolutionSigningPayloadBaseV1Schema
  >,
  context: RefinementContext,
): void {
  if (resolution.studyIds[0] === resolution.studyIds[1]) {
    issue(context, ["studyIds"], "Two distinct study IDs are required.");
  }
  if (resolution.studyIds[0] > resolution.studyIds[1]) {
    issue(context, ["studyIds"], "Study IDs must be sorted.");
  }
  if (resolution.judgmentSha256s[0] === resolution.judgmentSha256s[1]) {
    issue(
      context,
      ["judgmentSha256s"],
      "Two distinct judgment records are required.",
    );
  }
}

export const HeldOutAdjudicationResolutionSigningPayloadV1Schema =
  HeldOutAdjudicationResolutionSigningPayloadBaseV1Schema.superRefine(
    refineHeldOutAdjudicationResolutionV1,
  );

export type HeldOutAdjudicationResolutionSigningPayloadV1 = z.infer<
  typeof HeldOutAdjudicationResolutionSigningPayloadV1Schema
>;

export const HeldOutAdjudicationResolutionV1Schema =
  HeldOutAdjudicationResolutionSigningPayloadBaseV1Schema.extend({
    signatureAlgorithm: z.literal("Ed25519"),
    coordinatorSignatureBase64: exactEd25519SignatureBase64,
  })
    .strict()
    .superRefine(refineHeldOutAdjudicationResolutionV1);

export type HeldOutAdjudicationResolutionV1 = z.infer<
  typeof HeldOutAdjudicationResolutionV1Schema
>;

export function heldOutAdjudicationResolutionSigningBytesV1(
  input: unknown,
): Uint8Array {
  const payload =
    HeldOutAdjudicationResolutionSigningPayloadV1Schema.parse(input);
  return Buffer.concat([
    Buffer.from(HELD_OUT_RESOLUTION_SIGNATURE_DOMAIN, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalHeldOutJsonV1(payload), "utf8"),
  ]);
}

export function verifyHeldOutAdjudicationResolutionV1(input: {
  resolution: unknown;
  manifest: unknown;
  publicKey: KeyObject;
}): boolean {
  const resolution = HeldOutAdjudicationResolutionV1Schema.parse(
    input.resolution,
  );
  const manifest = HeldOutRunManifestV1Schema.parse(input.manifest);
  const key = input.publicKey;
  if (
    key.type !== "public" ||
    key.asymmetricKeyType !== "ed25519" ||
    coordinatorVerificationKeyFingerprintV1(key) !==
      manifest.coordinator.verificationKeyFingerprint ||
    resolution.setCommitment !== manifest.setCommitment ||
    resolution.runManifestSha256 !==
      computeHeldOutRunManifestSha256V1(manifest)
  ) {
    return false;
  }
  const {
    signatureAlgorithm: _signatureAlgorithm,
    coordinatorSignatureBase64: _coordinatorSignatureBase64,
    ...payload
  } = resolution;
  return verifySignature(
    null,
    heldOutAdjudicationResolutionSigningBytesV1(payload),
    key,
    Buffer.from(resolution.coordinatorSignatureBase64, "base64"),
  );
}

export function computeHeldOutJudgmentSha256V1(input: unknown): string {
  return sha256(
    canonicalHeldOutJsonV1(HeldOutAdjudicatorJudgmentV1Schema.parse(input)),
  );
}

export interface ValidatedHeldOutAdjudicationPairV1 {
  packet: HeldOutAdjudicationPacketV1;
  judgments: readonly [
    HeldOutAdjudicatorJudgmentV1,
    HeldOutAdjudicatorJudgmentV1,
  ];
  attestations: readonly [
    HeldOutCoordinatorAttestationV1,
    HeldOutCoordinatorAttestationV1,
  ];
  finalDisposition: HeldOutFindingDispositionV1;
  resolution: HeldOutAdjudicationResolutionV1 | null;
}

export function validateHeldOutAdjudicationPairV1(input: {
  packet: unknown;
  judgments: readonly [unknown, unknown];
  attestations: readonly [unknown, unknown];
  manifest: unknown;
  coordinatorPublicKey: KeyObject;
  resolution?: unknown;
}): ValidatedHeldOutAdjudicationPairV1 {
  const packet = HeldOutAdjudicationPacketV1Schema.parse(input.packet);
  const manifest = HeldOutRunManifestV1Schema.parse(input.manifest);
  const packetSha256 = computeHeldOutAdjudicationPacketSha256V1(packet);
  const manifestSha256 = computeHeldOutRunManifestSha256V1(manifest);
  if (
    packet.setCommitment !== manifest.setCommitment ||
    packet.runManifestSha256 !== manifestSha256
  ) {
    throw new TypeError("Packet does not match the run manifest.");
  }
  const judgments = input.judgments.map((record) =>
    HeldOutAdjudicatorJudgmentV1Schema.parse(record),
  ) as [HeldOutAdjudicatorJudgmentV1, HeldOutAdjudicatorJudgmentV1];
  const attestations = input.attestations.map((record) =>
    HeldOutCoordinatorAttestationV1Schema.parse(record),
  ) as [HeldOutCoordinatorAttestationV1, HeldOutCoordinatorAttestationV1];
  if (judgments[0].studyId === judgments[1].studyId) {
    throw new TypeError("Two distinct study IDs are required.");
  }
  for (let index = 0; index < 2; index += 1) {
    const judgment = judgments[index]!;
    const peer = judgments[1 - index]!;
    const attestation = attestations[index]!;
    if (
      judgment.setCommitment !== packet.setCommitment ||
      judgment.runManifestSha256 !== manifestSha256 ||
      judgment.packetSha256 !== packetSha256 ||
      judgment.ordinal !== packet.finding.ordinal ||
      judgment.fixtureCommitment !== packet.finding.fixtureCommitment ||
      judgment.findingId !== packet.finding.findingId ||
      judgment.coordinatorAttestationSha256 !==
        computeHeldOutCoordinatorAttestationSha256V1(attestation) ||
      attestation.payload.packetSha256 !== packetSha256 ||
      attestation.payload.studyId !== judgment.studyId ||
      attestation.payload.pairedStudyId !== peer.studyId ||
      attestation.payload.judgmentCommitment !==
        computeHeldOutJudgmentCommitmentV1({
          schemaVersion: judgment.schemaVersion,
          setCommitment: judgment.setCommitment,
          runManifestSha256: judgment.runManifestSha256,
          packetSha256: judgment.packetSha256,
          ordinal: judgment.ordinal,
          fixtureCommitment: judgment.fixtureCommitment,
          findingId: judgment.findingId,
          studyId: judgment.studyId,
          blinding: judgment.blinding,
          disposition: judgment.disposition,
        }) ||
      !verifyHeldOutCoordinatorAttestationV1({
        attestation,
        manifest,
        publicKey: input.coordinatorPublicKey,
      })
    ) {
      throw new TypeError("Judgment or coordinator attestation binding is invalid.");
    }
    if (judgment.disposition.kind === "matched_gold") {
      const matchedGoldDefectId = judgment.disposition.goldDefectId;
      if (
        !packet.candidateGold.some(
          (candidate) => candidate.goldDefectId === matchedGoldDefectId,
        )
      ) {
        throw new TypeError("A match requires deterministic candidate overlap.");
      }
    }
  }

  const sameDisposition =
    canonicalHeldOutJsonV1(judgments[0].disposition) ===
    canonicalHeldOutJsonV1(judgments[1].disposition);
  let resolution: HeldOutAdjudicationResolutionV1 | null = null;
  let finalDisposition = judgments[0].disposition;
  if (sameDisposition) {
    if (input.resolution !== undefined) {
      throw new TypeError(
        "Identical independent judgments resolve without a joint record.",
      );
    }
  } else {
    if (input.resolution === undefined) {
      throw new TypeError("Disagreement requires an explicit joint resolution.");
    }
    resolution = HeldOutAdjudicationResolutionV1Schema.parse(input.resolution);
    const orderedJudgments = [...judgments].sort((left, right) =>
      compareText(left.studyId, right.studyId),
    );
    const expectedStudyIds = orderedJudgments.map((record) => record.studyId);
    const expectedJudgmentHashes = orderedJudgments.map((record) =>
      computeHeldOutJudgmentSha256V1(record),
    );
    if (
      resolution.setCommitment !== packet.setCommitment ||
      resolution.runManifestSha256 !== manifestSha256 ||
      resolution.packetSha256 !== packetSha256 ||
      resolution.ordinal !== packet.finding.ordinal ||
      resolution.fixtureCommitment !== packet.finding.fixtureCommitment ||
      resolution.findingId !== packet.finding.findingId ||
      canonicalHeldOutJsonV1(resolution.studyIds) !==
        canonicalHeldOutJsonV1(expectedStudyIds) ||
      canonicalHeldOutJsonV1(resolution.judgmentSha256s) !==
        canonicalHeldOutJsonV1(expectedJudgmentHashes) ||
      !verifyHeldOutAdjudicationResolutionV1({
        resolution,
        manifest,
        publicKey: input.coordinatorPublicKey,
      })
    ) {
      throw new TypeError("Joint resolution does not bind both judgments.");
    }
    if (
      resolution.finalDisposition.kind === "matched_gold" &&
      !packet.candidateGold.some(
        (candidate) =>
          resolution?.finalDisposition.kind === "matched_gold" &&
          candidate.goldDefectId === resolution.finalDisposition.goldDefectId,
      )
    ) {
      throw new TypeError("A resolved match requires candidate overlap.");
    }
    finalDisposition = resolution.finalDisposition;
  }
  return {
    packet,
    judgments,
    attestations,
    finalDisposition,
    resolution,
  };
}
