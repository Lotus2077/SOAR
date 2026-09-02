import { z } from "zod";

import { Sha256Schema } from "./change-review-contracts";
import {
  estimateContextTokens,
  providerMessagesSha256,
  sha256Hex,
} from "./context-compiler";
import {
  PR6R_COST_SCOPE,
  PR6R_DEVELOPMENT_AUTHORITY_ID,
  PR6R_PHASE,
  PR6R_PLAN_ID,
} from "./pr6r-development-identity";
import {
  REVIEW_RESULT_V1_JSON_SCHEMA,
  REVIEW_RESULT_V1_JSON_SCHEMA_CANONICAL,
  REVIEW_RESULT_V1_JSON_SCHEMA_NAME,
  REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  ReviewResultV1Schema,
  type ReviewResultV1,
} from "./review-result-contract";

export {
  PR6R_COST_SCOPE,
  PR6R_DEVELOPMENT_AUTHORITY_ID,
  PR6R_PHASE,
  PR6R_PLAN_ID,
} from "./pr6r-development-identity";
export const PR6R_CAMPAIGN_ID = "pr6r-cal-007-v1" as const;
export const PR6R_CALIBRATION_SET_ID =
  "change-review-calibration-v1" as const;
export const PR6R_FIXTURE_ID = "cal-007-flask-jinja-name" as const;
export const PR6R_FIXTURE_REPOSITORY =
  "https://github.com/pallets/flask.git" as const;
export const PR6R_FIXTURE_BASE_REVISION =
  "38b4c1e19b50494cfcdc9332899e09b7fed34979" as const;
export const PR6R_FIXTURE_CHANGE_REVISION =
  "d8259eb11900285af9b80b0fa47f841174c054e3" as const;
export const PR6R_FIXTURE_SUBJECT = "use Jinja name consistently" as const;
export const PR6R_FIXTURE_MATERIALIZATION =
  "git-patch-to-index-v1" as const;
export const PR6R_FIXTURE_SNAPSHOT_ID =
  "193bf5f4aa818fd2e901fd49c50b288f7a7d966c21278cb09953c3b9a6088e4c" as const;
export const PR6R_FIXTURE_INDEX_SHA256 =
  "98fb7b5210dbc87b5526535eb60b8da01736a112f843b5df464d2b169b58f181" as const;
export const PR6R_FIXTURE_DISCOVERY_SHA256 =
  "2bd15f5da86c96a3e694dfae8ac83aea2d079189826da80063fdcffa14e6d7c7" as const;
export const PR6R_FIXTURE_CHANGED_PATH_COUNT = 9 as const;
export const PR6R_FIXTURE_CHANGED_LINE_COUNT = 62 as const;
export const PR6R_FIXTURE_RISK_SCORE = 3 as const;
export const PR6R_FIXTURE_CLASSIFICATION = "high_risk" as const;
export const PR6R_FIXTURE_REVIEW_ATTENTION = "heightened" as const;
export const PR6R_MAX_CANONICAL_PACKET_BYTES = 262_144 as const;
export const PR6R_MAX_ADMITTED_INPUT_TOKENS = 163_840 as const;
export const PR6R_REQUESTED_OUTPUT_TOKENS = 8_192 as const;

export const PR6R_MODEL_SLUG =
  "deepseek/deepseek-v4-flash-0731" as const;
export const PR6R_LOOPBACK_CHAT_COMPLETIONS_PATH =
  "/api/v1/chat/completions" as const;
export const PR6R_SYNTHETIC_UPSTREAM_SLUG = "soar-loopback" as const;
export const PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID =
  "pr6r-loopback-synthetic" as const;
export const PR6R_MAX_ACTUAL_EXTERNAL_SPEND_MICROUSD = 0 as const;
export const PR6R_MAX_EXTERNAL_PROVIDER_REQUESTS = 0 as const;
export const PR6R_MAX_LOOPBACK_DISPATCHES = 2 as const;
export const PR6R_OS_AUTHORITY_CLAIM_ID =
  "pr6r-os-authority-claim-v1" as const;
export const PR6R_SYNTHETIC_PROVIDER_ID =
  "pr6r-loopback-provider-v1" as const;
export const PR6R_PROVIDER_VALIDATION_ID =
  "pr6r-loopback-provider-validation-v1" as const;
export const PR6R_SIMULATION_PRICING_SNAPSHOT_ID =
  "pr6r-loopback-simulation-pricing-v1" as const;
export const PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION =
  1_000_000 as const;
export const PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION =
  4_000_000 as const;
export const PR6R_MAX_SIMULATED_RESERVATION_MICROUSD = 250_000 as const;
export const PR6R_MAX_RECORDED_DURATION_MS = 86_400_000 as const;
export const PR6R_MAX_COMMON_TOOL_CALLS = 10_000 as const;
export const PR6R_COMMON_INVESTIGATION_ID =
  "pr6r-common-investigation-v1" as const;
export const PR6R_CAMPAIGN_FALLBACK_ID =
  "pr6r-campaign-local-fallback-v1" as const;
export const PR6R_LOOPBACK_FAILED_NOT_SENT_REASONS = [
  "loopback.budget_denied",
] as const;
export const PR6R_LOOPBACK_FAILED_SENT_REASONS = [
  "loopback.http_error",
  "loopback.response_too_large",
  "loopback.response_malformed",
  "loopback.model_mismatch",
  "loopback.protocol_invalid",
  "loopback.usage_invalid",
  "loopback.review_result_invalid",
  "loopback.invalid_response",
  "loopback.accounting_invalid",
] as const;
export const PR6R_LOOPBACK_FAILED_UNKNOWN_REASONS = [
  "loopback.dispatch_unknown",
  "loopback.recovery_required",
  "loopback.timeout",
] as const;
export const PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS = [
  "loopback.cancelled_before_dispatch",
] as const;
export const PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS = [
  "loopback.cancelled_after_dispatch",
] as const;
export const PR6R_FAILED_TERMINAL_REASONS = [
  "local_synthesis.failed",
  "campaign.interrupted",
  ...PR6R_LOOPBACK_FAILED_NOT_SENT_REASONS,
  ...PR6R_LOOPBACK_FAILED_SENT_REASONS,
  ...PR6R_LOOPBACK_FAILED_UNKNOWN_REASONS,
] as const;
export const PR6R_CANCELLED_TERMINAL_REASONS = [
  "local_synthesis.cancelled",
  "campaign.cancelled",
  ...PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS,
  ...PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS,
] as const;
export const PR6R_MAX_RECORDED_TOTAL_TOKENS =
  PR6R_MAX_ADMITTED_INPUT_TOKENS + PR6R_REQUESTED_OUTPUT_TOKENS;

export const PR6R_SYNTHESIS_SLOT_IDS = [
  "local_synthesis",
  "cloud_synthesis",
  "hybrid_cloud_if_selected",
] as const;

export const PR6R_FIXTURE_CHANGED_PATHS = [
  "CHANGES.rst",
  "docs/design.rst",
  "docs/patterns/streaming.rst",
  "docs/patterns/wtforms.rst",
  "docs/quickstart.rst",
  "docs/templating.rst",
  "docs/web-security.rst",
  "src/flask/sansio/app.py",
  "src/flask/templating.py",
] as const;

export const PR6R_ALLOWLISTED_NON_SECRET_HEADERS = Object.freeze({
  accept: "application/json",
  "content-type": "application/json",
} as const);

const utf8Encoder = new TextEncoder();
const boundedId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const boundedStableCode = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
const safePositiveInteger = z.number().int().positive().safe();
const canonicalImplementationRevision = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
const canonicalTimestamp = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => {
      const timestamp = new Date(value);
      return (
        Number.isFinite(timestamp.getTime()) &&
        timestamp.toISOString() === value
      );
    },
    "Expected a canonical ISO timestamp.",
  );
const localFailedTerminalCode = z.enum([
  "local_synthesis.failed",
  "campaign.interrupted",
]);
const localCancelledTerminalCode = z.enum([
  "local_synthesis.cancelled",
  "campaign.cancelled",
]);
const loopbackFailedTerminalCode = z.enum([
  ...PR6R_LOOPBACK_FAILED_NOT_SENT_REASONS,
  ...PR6R_LOOPBACK_FAILED_SENT_REASONS,
  ...PR6R_LOOPBACK_FAILED_UNKNOWN_REASONS,
]);
const loopbackCancelledTerminalCode = z.enum([
  ...PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS,
  ...PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS,
]);
const boundedDurationMs = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .max(PR6R_MAX_RECORDED_DURATION_MS);

interface RefinementContext {
  addIssue(issue: {
    code: "custom";
    path?: PropertyKey[];
    message: string;
  }): void;
}

function issue(
  context: RefinementContext,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

/** Sort object keys, preserve array order, and reject non-JSON values. */
export function canonicalPr6rJsonV1(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(
        "Canonical PR6R JSON numbers must be finite and cannot be negative zero.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) {
      throw new TypeError("Canonical PR6R JSON arrays cannot be sparse.");
    }
    return `[${value.map((entry) => canonicalPr6rJsonV1(entry)).join(",")}]`;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError("Canonical PR6R JSON contains a non-JSON value.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Canonical PR6R JSON accepts plain objects only.");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => {
      if (record[key] === undefined) {
        throw new TypeError("Canonical PR6R JSON cannot contain undefined.");
      }
      return `${JSON.stringify(key)}:${canonicalPr6rJsonV1(record[key])}`;
    })
    .join(",")}}`;
}

const Pr6rChangedPathsSchema = z.tuple([
  z.literal("CHANGES.rst"),
  z.literal("docs/design.rst"),
  z.literal("docs/patterns/streaming.rst"),
  z.literal("docs/patterns/wtforms.rst"),
  z.literal("docs/quickstart.rst"),
  z.literal("docs/templating.rst"),
  z.literal("docs/web-security.rst"),
  z.literal("src/flask/sansio/app.py"),
  z.literal("src/flask/templating.py"),
]);

export const Pr6rFixtureV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-frozen-fixture-v1"),
    calibrationSetId: z.literal(PR6R_CALIBRATION_SET_ID),
    fixtureId: z.literal(PR6R_FIXTURE_ID),
    repository: z.literal(PR6R_FIXTURE_REPOSITORY),
    baseRevision: z.literal(PR6R_FIXTURE_BASE_REVISION),
    changeRevision: z.literal(PR6R_FIXTURE_CHANGE_REVISION),
    subject: z.literal(PR6R_FIXTURE_SUBJECT),
    materialization: z.literal(PR6R_FIXTURE_MATERIALIZATION),
    snapshotId: z.literal(PR6R_FIXTURE_SNAPSHOT_ID),
    indexSha256: z.literal(PR6R_FIXTURE_INDEX_SHA256),
    discoverySha256: z.literal(PR6R_FIXTURE_DISCOVERY_SHA256),
    changedPaths: Pr6rChangedPathsSchema,
    changedPathCount: z.literal(PR6R_FIXTURE_CHANGED_PATH_COUNT),
    changedLineCount: z.literal(PR6R_FIXTURE_CHANGED_LINE_COUNT),
    riskScore: z.literal(PR6R_FIXTURE_RISK_SCORE),
    classification: z.literal(PR6R_FIXTURE_CLASSIFICATION),
    reviewAttention: z.literal(PR6R_FIXTURE_REVIEW_ATTENTION),
    bounds: z
      .object({
        maxCanonicalPacketBytes: z.literal(
          PR6R_MAX_CANONICAL_PACKET_BYTES,
        ),
        maxAdmittedInputTokens: z.literal(
          PR6R_MAX_ADMITTED_INPUT_TOKENS,
        ),
        requestedOutputTokens: z.literal(PR6R_REQUESTED_OUTPUT_TOKENS),
      })
      .strict(),
  })
  .strict();

export type Pr6rFixtureV1 = z.infer<typeof Pr6rFixtureV1Schema>;

export const PR6R_FROZEN_FIXTURE_V1: Pr6rFixtureV1 = deepFreeze(
  Pr6rFixtureV1Schema.parse({
    schemaVersion: "pr6r-frozen-fixture-v1",
    calibrationSetId: PR6R_CALIBRATION_SET_ID,
    fixtureId: PR6R_FIXTURE_ID,
    repository: PR6R_FIXTURE_REPOSITORY,
    baseRevision: PR6R_FIXTURE_BASE_REVISION,
    changeRevision: PR6R_FIXTURE_CHANGE_REVISION,
    subject: PR6R_FIXTURE_SUBJECT,
    materialization: PR6R_FIXTURE_MATERIALIZATION,
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    indexSha256: PR6R_FIXTURE_INDEX_SHA256,
    discoverySha256: PR6R_FIXTURE_DISCOVERY_SHA256,
    changedPaths: PR6R_FIXTURE_CHANGED_PATHS,
    changedPathCount: PR6R_FIXTURE_CHANGED_PATH_COUNT,
    changedLineCount: PR6R_FIXTURE_CHANGED_LINE_COUNT,
    riskScore: PR6R_FIXTURE_RISK_SCORE,
    classification: PR6R_FIXTURE_CLASSIFICATION,
    reviewAttention: PR6R_FIXTURE_REVIEW_ATTENTION,
    bounds: {
      maxCanonicalPacketBytes: PR6R_MAX_CANONICAL_PACKET_BYTES,
      maxAdmittedInputTokens: PR6R_MAX_ADMITTED_INPUT_TOKENS,
      requestedOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
    },
  }),
);

export const Pr6rDevelopmentAuthorityV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-development-authority-v1"),
    planId: z.literal(PR6R_PLAN_ID),
    phase: z.literal(PR6R_PHASE),
    authorityId: z.literal(PR6R_DEVELOPMENT_AUTHORITY_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    fixtureId: z.literal(PR6R_FIXTURE_ID),
    snapshotId: z.literal(PR6R_FIXTURE_SNAPSHOT_ID),
    model: z.literal(PR6R_MODEL_SLUG),
    upstreamSlug: z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG),
    credentialMetadataId: z.literal(
      PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    ),
    providerKind: z.literal("synthetic_loopback"),
    transport: z.literal("loopback_only"),
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
    maxActualExternalSpendMicrousd: z.literal(
      PR6R_MAX_ACTUAL_EXTERNAL_SPEND_MICROUSD,
    ),
    maxExternalProviderRequests: z.literal(
      PR6R_MAX_EXTERNAL_PROVIDER_REQUESTS,
    ),
    maxLoopbackDispatches: z.literal(PR6R_MAX_LOOPBACK_DISPATCHES),
  })
  .strict();

export type Pr6rDevelopmentAuthorityV1 = z.infer<
  typeof Pr6rDevelopmentAuthorityV1Schema
>;

export const PR6R_DEVELOPMENT_AUTHORITY_V1: Pr6rDevelopmentAuthorityV1 =
  deepFreeze(
    Pr6rDevelopmentAuthorityV1Schema.parse({
      schemaVersion: "pr6r-development-authority-v1",
      planId: PR6R_PLAN_ID,
      phase: PR6R_PHASE,
      authorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
      campaignId: PR6R_CAMPAIGN_ID,
      fixtureId: PR6R_FIXTURE_ID,
      snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
      model: PR6R_MODEL_SLUG,
      upstreamSlug: PR6R_SYNTHETIC_UPSTREAM_SLUG,
      credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
      providerKind: "synthetic_loopback",
      transport: "loopback_only",
      costScope: PR6R_COST_SCOPE,
      actualPaidAuthority: false,
      actualExternalSpendMicrousd: 0,
      maxActualExternalSpendMicrousd:
        PR6R_MAX_ACTUAL_EXTERNAL_SPEND_MICROUSD,
      maxExternalProviderRequests: PR6R_MAX_EXTERNAL_PROVIDER_REQUESTS,
      maxLoopbackDispatches: PR6R_MAX_LOOPBACK_DISPATCHES,
    }),
  );

const Pr6rLocalSynthesisSlotV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-synthesis-slot-v1"),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    ordinal: z.literal(1),
    slotId: z.literal("local_synthesis"),
    route: z.literal("local_only_v1"),
    execution: z.literal("local"),
    maxLoopbackDispatches: z.literal(0),
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
  })
  .strict();

const Pr6rCloudSynthesisSlotV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-synthesis-slot-v1"),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    ordinal: z.literal(2),
    slotId: z.literal("cloud_synthesis"),
    route: z.literal("cloud_synthesis_v1"),
    execution: z.literal("loopback_cloud"),
    maxLoopbackDispatches: z.literal(1),
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
  })
  .strict();

const Pr6rHybridCloudIfSelectedSlotV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-synthesis-slot-v1"),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    ordinal: z.literal(3),
    slotId: z.literal("hybrid_cloud_if_selected"),
    route: z.literal("hybrid_checkpoint_v1"),
    execution: z.literal("loopback_cloud_if_selected"),
    maxLoopbackDispatches: z.literal(1),
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
  })
  .strict();

export const Pr6rSynthesisSlotV1Schema = z.discriminatedUnion("slotId", [
  Pr6rLocalSynthesisSlotV1Schema,
  Pr6rCloudSynthesisSlotV1Schema,
  Pr6rHybridCloudIfSelectedSlotV1Schema,
]);
export type Pr6rSynthesisSlotV1 = z.infer<
  typeof Pr6rSynthesisSlotV1Schema
>;

export const Pr6rSynthesisSlotsV1Schema = z.tuple([
  Pr6rLocalSynthesisSlotV1Schema,
  Pr6rCloudSynthesisSlotV1Schema,
  Pr6rHybridCloudIfSelectedSlotV1Schema,
]);
export type Pr6rSynthesisSlotsV1 = z.infer<
  typeof Pr6rSynthesisSlotsV1Schema
>;

export const PR6R_SYNTHESIS_SLOTS_V1: Pr6rSynthesisSlotsV1 = deepFreeze(
  Pr6rSynthesisSlotsV1Schema.parse([
    {
      schemaVersion: "pr6r-synthesis-slot-v1",
      campaignId: PR6R_CAMPAIGN_ID,
      ordinal: 1,
      slotId: "local_synthesis",
      route: "local_only_v1",
      execution: "local",
      maxLoopbackDispatches: 0,
      costScope: PR6R_COST_SCOPE,
      actualPaidAuthority: false,
    },
    {
      schemaVersion: "pr6r-synthesis-slot-v1",
      campaignId: PR6R_CAMPAIGN_ID,
      ordinal: 2,
      slotId: "cloud_synthesis",
      route: "cloud_synthesis_v1",
      execution: "loopback_cloud",
      maxLoopbackDispatches: 1,
      costScope: PR6R_COST_SCOPE,
      actualPaidAuthority: false,
    },
    {
      schemaVersion: "pr6r-synthesis-slot-v1",
      campaignId: PR6R_CAMPAIGN_ID,
      ordinal: 3,
      slotId: "hybrid_cloud_if_selected",
      route: "hybrid_checkpoint_v1",
      execution: "loopback_cloud_if_selected",
      maxLoopbackDispatches: 1,
      costScope: PR6R_COST_SCOPE,
      actualPaidAuthority: false,
    },
  ]),
);

const Pr6rLoopbackOriginSchema = z.string().superRefine((value, context) => {
  if (!/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/u.test(value)) {
    issue(
      context,
      [],
      "Expected a canonical HTTP origin using literal 127.0.0.1 or ::1 and an explicit port.",
    );
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    issue(context, [], "Expected a valid loopback origin.");
    return;
  }
  const port = Number(parsed.port);
  if (
    parsed.origin !== value ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    issue(context, [], "Expected a canonical bounded loopback origin.");
  }
});

const Pr6rNonSecretHeadersSchema = z
  .object({
    accept: z.literal("application/json"),
    "content-type": z.literal("application/json"),
  })
  .strict();

const Pr6rSystemMessageSchema = z
  .object({
    role: z.literal("system"),
    content: z.string().min(1).max(PR6R_MAX_CANONICAL_PACKET_BYTES),
  })
  .strict();
const Pr6rUserMessageSchema = z
  .object({
    role: z.literal("user"),
    content: z.string().min(1).max(PR6R_MAX_CANONICAL_PACKET_BYTES),
  })
  .strict();

export const Pr6rSemanticMessagesV1Schema = z.tuple([
  Pr6rSystemMessageSchema,
  Pr6rUserMessageSchema,
]);
export type Pr6rSemanticMessagesV1 = z.infer<
  typeof Pr6rSemanticMessagesV1Schema
>;

const Pr6rReviewResultResponseFormatSchema = z
  .object({
    type: z.literal("json_schema"),
    json_schema: z
      .object({
        name: z.literal(REVIEW_RESULT_V1_JSON_SCHEMA_NAME),
        strict: z.literal(true),
        schema: z.unknown(),
      })
      .strict(),
  })
  .strict()
  .superRefine((format, context) => {
    try {
      if (
        canonicalPr6rJsonV1(format.json_schema.schema) !==
        REVIEW_RESULT_V1_JSON_SCHEMA_CANONICAL
      ) {
        issue(
          context,
          ["json_schema", "schema"],
          "Expected the exact canonical ReviewResultV1 JSON schema.",
        );
      }
    } catch {
      issue(
        context,
        ["json_schema", "schema"],
        "Expected a canonical JSON ReviewResultV1 schema.",
      );
    }
  });

export const CloudApplicationBodyV1Schema = z
  .object({
    model: z.literal(PR6R_MODEL_SLUG),
    messages: Pr6rSemanticMessagesV1Schema,
    max_completion_tokens: z.literal(PR6R_REQUESTED_OUTPUT_TOKENS),
    temperature: z.literal(0),
    stream: z.literal(false),
    response_format: Pr6rReviewResultResponseFormatSchema,
    provider: z
      .object({
        only: z.tuple([z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG)]),
        order: z.tuple([z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG)]),
        allow_fallbacks: z.literal(false),
        require_parameters: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type CloudApplicationBodyV1 = z.infer<
  typeof CloudApplicationBodyV1Schema
>;

const EMPTY_PR6R_SEMANTIC_MESSAGES = [
  { role: "system", content: "" },
  { role: "user", content: "" },
] as const;
const EMPTY_PR6R_APPLICATION_BODY = {
  model: PR6R_MODEL_SLUG,
  messages: EMPTY_PR6R_SEMANTIC_MESSAGES,
  max_completion_tokens: PR6R_REQUESTED_OUTPUT_TOKENS,
  temperature: 0,
  stream: false,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: REVIEW_RESULT_V1_JSON_SCHEMA_NAME,
      strict: true,
      schema: REVIEW_RESULT_V1_JSON_SCHEMA,
    },
  },
  provider: {
    only: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
    order: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
    allow_fallbacks: false,
    require_parameters: true,
  },
} as const;
const PR6R_CANONICAL_BODY_FIXED_OVERHEAD_BYTES =
  utf8Encoder.encode(canonicalPr6rJsonV1(EMPTY_PR6R_APPLICATION_BODY))
    .byteLength -
  utf8Encoder.encode(canonicalPr6rJsonV1(EMPTY_PR6R_SEMANTIC_MESSAGES))
    .byteLength;

/** Exact body ceiling: admitted semantic-message bytes plus fixed body fields. */
export const PR6R_MAX_CANONICAL_APPLICATION_BODY_BYTES =
  PR6R_MAX_ADMITTED_INPUT_TOKENS +
  PR6R_CANONICAL_BODY_FIXED_OVERHEAD_BYTES;

const pr6rCommonCheckpointIdentityShape = {
  campaignId: z.literal(PR6R_CAMPAIGN_ID),
  parentSessionId: boundedId,
  fixtureId: z.literal(PR6R_FIXTURE_ID),
  snapshotId: z.literal(PR6R_FIXTURE_SNAPSHOT_ID),
  packetSha256: Sha256Schema,
  semanticMessagesSha256: Sha256Schema,
  responseSchemaSha256: z.literal(REVIEW_RESULT_V1_JSON_SCHEMA_SHA256),
  packetByteLength: safePositiveInteger.max(
    PR6R_MAX_CANONICAL_PACKET_BYTES,
  ),
  estimatedInputTokens: safePositiveInteger.max(
    PR6R_MAX_ADMITTED_INPUT_TOKENS,
  ),
  requestedOutputTokens: z.literal(PR6R_REQUESTED_OUTPUT_TOKENS),
  costScope: z.literal(PR6R_COST_SCOPE),
} as const;

export const Pr6rCommonCheckpointPreimageV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-common-checkpoint-preimage-v1"),
    ...pr6rCommonCheckpointIdentityShape,
  })
  .strict();
export type Pr6rCommonCheckpointPreimageV1 = z.infer<
  typeof Pr6rCommonCheckpointPreimageV1Schema
>;

function checkpointPreimageFromFields(input: {
  campaignId: typeof PR6R_CAMPAIGN_ID;
  parentSessionId: string;
  fixtureId: typeof PR6R_FIXTURE_ID;
  snapshotId: typeof PR6R_FIXTURE_SNAPSHOT_ID;
  packetSha256: string;
  semanticMessagesSha256: string;
  responseSchemaSha256: typeof REVIEW_RESULT_V1_JSON_SCHEMA_SHA256;
  packetByteLength: number;
  estimatedInputTokens: number;
  requestedOutputTokens: typeof PR6R_REQUESTED_OUTPUT_TOKENS;
  costScope: typeof PR6R_COST_SCOPE;
}): Pr6rCommonCheckpointPreimageV1 {
  return Pr6rCommonCheckpointPreimageV1Schema.parse({
    schemaVersion: "pr6r-common-checkpoint-preimage-v1",
    campaignId: input.campaignId,
    parentSessionId: input.parentSessionId,
    fixtureId: input.fixtureId,
    snapshotId: input.snapshotId,
    packetSha256: input.packetSha256,
    semanticMessagesSha256: input.semanticMessagesSha256,
    responseSchemaSha256: input.responseSchemaSha256,
    packetByteLength: input.packetByteLength,
    estimatedInputTokens: input.estimatedInputTokens,
    requestedOutputTokens: input.requestedOutputTokens,
    costScope: input.costScope,
  });
}

export function canonicalPr6rCommonCheckpointSha256(
  value: unknown,
): string {
  const preimage = Pr6rCommonCheckpointPreimageV1Schema.parse(value);
  return sha256Hex(canonicalPr6rJsonV1(preimage));
}

export const Pr6rCommonCheckpointV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-common-checkpoint-v1"),
    ...pr6rCommonCheckpointIdentityShape,
    checkpointSha256: Sha256Schema,
  })
  .strict()
  .superRefine((checkpoint, context) => {
    const preimage = checkpointPreimageFromFields(checkpoint);
    if (
      canonicalPr6rCommonCheckpointSha256(preimage) !==
      checkpoint.checkpointSha256
    ) {
      issue(
        context,
        ["checkpointSha256"],
        "Common checkpoint SHA-256 does not match its canonical preimage.",
      );
    }
  });

export type Pr6rCommonCheckpointV1 = z.infer<
  typeof Pr6rCommonCheckpointV1Schema
>;

function requireCanonicalPacketUtf8(value: string): string {
  const packetByteLength = utf8Encoder.encode(value).byteLength;
  if (
    packetByteLength < 1 ||
    packetByteLength > PR6R_MAX_CANONICAL_PACKET_BYTES
  ) {
    throw new RangeError("PR6R canonical packet exceeds its byte bound.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("PR6R packet must be valid canonical JSON UTF-8 text.");
  }
  if (canonicalPr6rJsonV1(parsed) !== value) {
    throw new TypeError("PR6R packet must use canonical JSON bytes.");
  }
  return value;
}

export interface BuildPr6rCommonCheckpointV1Input {
  parentSessionId: string;
  packetUtf8: string;
  semanticMessages: unknown;
}

/** Build a checkpoint only from the actual admitted packet and messages. */
export function buildPr6rCommonCheckpointV1(
  input: BuildPr6rCommonCheckpointV1Input,
): Pr6rCommonCheckpointV1 {
  const packetUtf8 = requireCanonicalPacketUtf8(input.packetUtf8);
  const semanticMessages = Pr6rSemanticMessagesV1Schema.parse(
    input.semanticMessages,
  );
  const canonicalMessagesUtf8 = canonicalPr6rJsonV1(semanticMessages);
  if (
    estimateContextTokens(canonicalMessagesUtf8) >
    PR6R_MAX_ADMITTED_INPUT_TOKENS
  ) {
    throw new RangeError("PR6R semantic messages exceed the admitted input bound.");
  }
  const preimage = checkpointPreimageFromFields({
    campaignId: PR6R_CAMPAIGN_ID,
    parentSessionId: input.parentSessionId,
    fixtureId: PR6R_FIXTURE_ID,
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    packetSha256: sha256Hex(packetUtf8),
    semanticMessagesSha256: providerMessagesSha256(semanticMessages),
    responseSchemaSha256: REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
    packetByteLength: utf8Encoder.encode(packetUtf8).byteLength,
    estimatedInputTokens: estimateContextTokens(canonicalMessagesUtf8),
    requestedOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
    costScope: PR6R_COST_SCOPE,
  });
  return deepFreeze(
    Pr6rCommonCheckpointV1Schema.parse({
      schemaVersion: "pr6r-common-checkpoint-v1",
      ...Object.fromEntries(
        Object.entries(preimage).filter(([key]) => key !== "schemaVersion"),
      ),
      checkpointSha256: canonicalPr6rCommonCheckpointSha256(preimage),
    }),
  );
}

const cloudSlotIdSchema = z.enum([
  "cloud_synthesis",
  "hybrid_cloud_if_selected",
]);

export const CloudApplicationRequestV1Schema = z
  .object({
    schemaVersion: z.literal("cloud-application-request-v1"),
    planId: z.literal(PR6R_PLAN_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    fixtureId: z.literal(PR6R_FIXTURE_ID),
    snapshotId: z.literal(PR6R_FIXTURE_SNAPSHOT_ID),
    authorityId: z.literal(PR6R_DEVELOPMENT_AUTHORITY_ID),
    requestId: boundedId,
    parentSessionId: boundedId,
    synthesisSessionId: boundedId,
    attemptId: boundedId,
    slotId: cloudSlotIdSchema,
    commonCheckpoint: Pr6rCommonCheckpointV1Schema,
    commonCheckpointSha256: Sha256Schema,
    semanticMessagesSha256: Sha256Schema,
    packetSha256: Sha256Schema,
    responseSchemaSha256: z.literal(
      REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
    ),
    packetByteLength: safePositiveInteger.max(
      PR6R_MAX_CANONICAL_PACKET_BYTES,
    ),
    estimatedInputTokens: safePositiveInteger.max(
      PR6R_MAX_ADMITTED_INPUT_TOKENS,
    ),
    requestedOutputTokens: z.literal(PR6R_REQUESTED_OUTPUT_TOKENS),
    model: z.literal(PR6R_MODEL_SLUG),
    upstreamSlug: z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG),
    credentialMetadataId: z.literal(
      PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    ),
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    origin: Pr6rLoopbackOriginSchema,
    path: z.literal(PR6R_LOOPBACK_CHAT_COMPLETIONS_PATH),
    method: z.literal("POST"),
    headers: Pr6rNonSecretHeadersSchema,
    canonicalBodyUtf8: z
      .string()
      .min(1)
      .max(PR6R_MAX_CANONICAL_APPLICATION_BODY_BYTES),
    canonicalBodyByteLength: safePositiveInteger.max(
      PR6R_MAX_CANONICAL_APPLICATION_BODY_BYTES,
    ),
    canonicalBodySha256: Sha256Schema,
    responseContract: z.literal(
      REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
    ),
  })
  .strict()
  .superRefine((request, context) => {
    const checkpointBindings = [
      [
        request.commonCheckpoint.checkpointSha256,
        request.commonCheckpointSha256,
        "commonCheckpointSha256",
      ],
      [
        request.commonCheckpoint.semanticMessagesSha256,
        request.semanticMessagesSha256,
        "semanticMessagesSha256",
      ],
      [
        request.commonCheckpoint.packetSha256,
        request.packetSha256,
        "packetSha256",
      ],
      [
        request.commonCheckpoint.responseSchemaSha256,
        request.responseSchemaSha256,
        "responseSchemaSha256",
      ],
      [
        request.commonCheckpoint.packetByteLength,
        request.packetByteLength,
        "packetByteLength",
      ],
      [
        request.commonCheckpoint.estimatedInputTokens,
        request.estimatedInputTokens,
        "estimatedInputTokens",
      ],
      [
        request.commonCheckpoint.requestedOutputTokens,
        request.requestedOutputTokens,
        "requestedOutputTokens",
      ],
    ] as const;
    for (const [expected, actual, field] of checkpointBindings) {
      if (expected !== actual) {
        issue(
          context,
          [field],
          `${field} does not match the admitted common checkpoint.`,
        );
      }
    }
    if (
      request.commonCheckpoint.parentSessionId !== request.parentSessionId
    ) {
      issue(
        context,
        ["parentSessionId"],
        "Request parent does not match the admitted common checkpoint.",
      );
    }
    if (request.synthesisSessionId === request.parentSessionId) {
      issue(
        context,
        ["synthesisSessionId"],
        "Cloud synthesis must use a child session distinct from the campaign parent.",
      );
    }
    const bodyBytes = utf8Encoder.encode(request.canonicalBodyUtf8);
    if (bodyBytes.byteLength !== request.canonicalBodyByteLength) {
      issue(
        context,
        ["canonicalBodyByteLength"],
        "Canonical body byte length does not match its UTF-8 bytes.",
      );
    }
    if (sha256Hex(request.canonicalBodyUtf8) !== request.canonicalBodySha256) {
      issue(
        context,
        ["canonicalBodySha256"],
        "Canonical body SHA-256 does not match its UTF-8 bytes.",
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(request.canonicalBodyUtf8);
    } catch {
      issue(
        context,
        ["canonicalBodyUtf8"],
        "Canonical body must be valid JSON.",
      );
      return;
    }
    let canonicalBody: string;
    try {
      canonicalBody = canonicalPr6rJsonV1(parsedBody);
    } catch {
      issue(
        context,
        ["canonicalBodyUtf8"],
        "Canonical body must contain canonical JSON values only.",
      );
      return;
    }
    if (canonicalBody !== request.canonicalBodyUtf8) {
      issue(
        context,
        ["canonicalBodyUtf8"],
        "Request body bytes are not the canonical PR6R JSON encoding.",
      );
    }
    const bodyResult = CloudApplicationBodyV1Schema.safeParse(parsedBody);
    if (!bodyResult.success) {
      issue(
        context,
        ["canonicalBodyUtf8"],
        "Canonical body does not satisfy the sealed Cloud application body contract.",
      );
      return;
    }
    const canonicalMessagesUtf8 = canonicalPr6rJsonV1(
      bodyResult.data.messages,
    );
    const messagesSha256 = providerMessagesSha256(bodyResult.data.messages);
    const estimatedInputTokens = estimateContextTokens(canonicalMessagesUtf8);
    if (messagesSha256 !== request.semanticMessagesSha256) {
      issue(
        context,
        ["semanticMessagesSha256"],
        "Request messages do not match the admitted semantic-message hash.",
      );
    }
    if (estimatedInputTokens !== request.estimatedInputTokens) {
      issue(
        context,
        ["estimatedInputTokens"],
        "Request message bytes do not match the admitted input-token estimate.",
      );
    }
    if (bodyBytes.byteLength > PR6R_MAX_CANONICAL_APPLICATION_BODY_BYTES) {
      issue(
        context,
        ["canonicalBodyByteLength"],
        "Canonical Cloud application body exceeds its derived byte bound.",
      );
    }
  });

export type CloudApplicationRequestV1 = z.infer<
  typeof CloudApplicationRequestV1Schema
>;

/** Hash only a fully parsed, internally bound sealed application request. */
export function canonicalPr6rCloudApplicationRequestSha256(
  value: unknown,
): string {
  const request = CloudApplicationRequestV1Schema.parse(value);
  return sha256Hex(canonicalPr6rJsonV1(request));
}

export interface SealCloudApplicationRequestV1Input {
  requestId: string;
  parentSessionId: string;
  synthesisSessionId: string;
  attemptId: string;
  slotId: "cloud_synthesis" | "hybrid_cloud_if_selected";
  commonCheckpoint: unknown;
  packetUtf8: string;
  origin: string;
  body: unknown;
}

/** Canonicalize once and seal the exact application bytes admitted to transport. */
export function sealCloudApplicationRequestV1(
  input: SealCloudApplicationRequestV1Input,
): CloudApplicationRequestV1 {
  const commonCheckpoint = Pr6rCommonCheckpointV1Schema.parse(
    input.commonCheckpoint,
  );
  const packetUtf8 = requireCanonicalPacketUtf8(input.packetUtf8);
  if (
    sha256Hex(packetUtf8) !== commonCheckpoint.packetSha256 ||
    utf8Encoder.encode(packetUtf8).byteLength !==
      commonCheckpoint.packetByteLength
  ) {
    throw new Error(
      "PR6R packet bytes do not match the admitted common checkpoint.",
    );
  }
  const body = CloudApplicationBodyV1Schema.parse(input.body);
  const canonicalBodyUtf8 = canonicalPr6rJsonV1(body);
  return deepFreeze(
    CloudApplicationRequestV1Schema.parse({
      schemaVersion: "cloud-application-request-v1",
      planId: PR6R_PLAN_ID,
      campaignId: PR6R_CAMPAIGN_ID,
      fixtureId: PR6R_FIXTURE_ID,
      snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
      authorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
      requestId: input.requestId,
      parentSessionId: input.parentSessionId,
      synthesisSessionId: input.synthesisSessionId,
      attemptId: input.attemptId,
      slotId: input.slotId,
      commonCheckpoint,
      commonCheckpointSha256: commonCheckpoint.checkpointSha256,
      semanticMessagesSha256: commonCheckpoint.semanticMessagesSha256,
      packetSha256: commonCheckpoint.packetSha256,
      responseSchemaSha256: REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
      packetByteLength: commonCheckpoint.packetByteLength,
      estimatedInputTokens: commonCheckpoint.estimatedInputTokens,
      requestedOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
      model: PR6R_MODEL_SLUG,
      upstreamSlug: PR6R_SYNTHETIC_UPSTREAM_SLUG,
      credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
      costScope: PR6R_COST_SCOPE,
      actualPaidAuthority: false,
      origin: input.origin,
      path: PR6R_LOOPBACK_CHAT_COMPLETIONS_PATH,
      method: "POST",
      headers: PR6R_ALLOWLISTED_NON_SECRET_HEADERS,
      canonicalBodyUtf8,
      canonicalBodyByteLength: utf8Encoder.encode(canonicalBodyUtf8).byteLength,
      canonicalBodySha256: sha256Hex(canonicalBodyUtf8),
      responseContract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
    }),
  );
}

export const Pr6rOsAuthorityClaimPreimageV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-os-authority-claim-preimage-v1"),
    authorityClaimId: z.literal(PR6R_OS_AUTHORITY_CLAIM_ID),
    ledgerSchemaVersion: z.literal("pr6r-authority-ledger-v1"),
    recordType: z.literal("campaign_claimed"),
    planId: z.literal(PR6R_PLAN_ID),
    phase: z.literal(PR6R_PHASE),
    authorityId: z.literal(PR6R_DEVELOPMENT_AUTHORITY_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalImplementationRevision,
    storageScope: z.literal("os_user_local"),
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
    claimedAt: canonicalTimestamp,
    ledgerCampaignRecordSha256: Sha256Schema,
    ledgerGuardRecordSha256: Sha256Schema,
  })
  .strict();

export type Pr6rOsAuthorityClaimPreimageV1 = z.infer<
  typeof Pr6rOsAuthorityClaimPreimageV1Schema
>;

export function canonicalPr6rOsAuthorityClaimSha256(
  value: unknown,
): string {
  const preimage = Pr6rOsAuthorityClaimPreimageV1Schema.parse(value);
  return sha256Hex(canonicalPr6rJsonV1(preimage));
}

export const Pr6rOsAuthorityClaimV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-os-authority-claim-v1"),
    authorityClaimId: z.literal(PR6R_OS_AUTHORITY_CLAIM_ID),
    ledgerSchemaVersion: z.literal("pr6r-authority-ledger-v1"),
    recordType: z.literal("campaign_claimed"),
    planId: z.literal(PR6R_PLAN_ID),
    phase: z.literal(PR6R_PHASE),
    authorityId: z.literal(PR6R_DEVELOPMENT_AUTHORITY_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalImplementationRevision,
    storageScope: z.literal("os_user_local"),
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
    claimedAt: canonicalTimestamp,
    ledgerCampaignRecordSha256: Sha256Schema,
    ledgerGuardRecordSha256: Sha256Schema,
    authorityClaimSha256: Sha256Schema,
  })
  .strict()
  .superRefine((claim, context) => {
    const preimage = Pr6rOsAuthorityClaimPreimageV1Schema.safeParse({
      schemaVersion: "pr6r-os-authority-claim-preimage-v1",
      authorityClaimId: claim.authorityClaimId,
      ledgerSchemaVersion: claim.ledgerSchemaVersion,
      recordType: claim.recordType,
      planId: claim.planId,
      phase: claim.phase,
      authorityId: claim.authorityId,
      campaignId: claim.campaignId,
      implementationRevision: claim.implementationRevision,
      storageScope: claim.storageScope,
      costScope: claim.costScope,
      actualPaidAuthority: claim.actualPaidAuthority,
      actualExternalSpendMicrousd: claim.actualExternalSpendMicrousd,
      claimedAt: claim.claimedAt,
      ledgerCampaignRecordSha256: claim.ledgerCampaignRecordSha256,
      ledgerGuardRecordSha256: claim.ledgerGuardRecordSha256,
    });
    if (!preimage.success) return;
    const expected = sha256Hex(canonicalPr6rJsonV1(preimage.data));
    if (claim.authorityClaimSha256 !== expected) {
      issue(
        context,
        ["authorityClaimSha256"],
        "OS authority claim canonical hash mismatch.",
      );
    }
  });

export type Pr6rOsAuthorityClaimV1 = z.infer<
  typeof Pr6rOsAuthorityClaimV1Schema
>;

export function buildPr6rOsAuthorityClaimV1(input: {
  implementationRevision: string;
  claimedAt: string;
  ledgerCampaignRecordSha256: string;
  ledgerGuardRecordSha256: string;
}): Pr6rOsAuthorityClaimV1 {
  const preimage = Pr6rOsAuthorityClaimPreimageV1Schema.parse({
    schemaVersion: "pr6r-os-authority-claim-preimage-v1",
    authorityClaimId: PR6R_OS_AUTHORITY_CLAIM_ID,
    ledgerSchemaVersion: "pr6r-authority-ledger-v1",
    recordType: "campaign_claimed",
    planId: PR6R_PLAN_ID,
    phase: PR6R_PHASE,
    authorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: input.implementationRevision,
    storageScope: "os_user_local",
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
    claimedAt: input.claimedAt,
    ledgerCampaignRecordSha256: input.ledgerCampaignRecordSha256,
    ledgerGuardRecordSha256: input.ledgerGuardRecordSha256,
  });
  return deepFreeze(
    Pr6rOsAuthorityClaimV1Schema.parse({
      ...preimage,
      schemaVersion: "pr6r-os-authority-claim-v1",
      authorityClaimSha256:
        canonicalPr6rOsAuthorityClaimSha256(preimage),
    }),
  );
}

const Pr6rLoopbackCapabilitiesV1Schema = z
  .object({
    chatCompletions: z.literal(true),
    strictStructuredOutput: z.literal(true),
    tools: z.literal(false),
    redirects: z.literal(false),
    retries: z.literal(false),
  })
  .strict();

export const Pr6rLoopbackProviderValidationPreimageV1Schema = z
  .object({
    schemaVersion: z.literal(
      "pr6r-loopback-provider-validation-preimage-v1",
    ),
    validationId: z.literal(PR6R_PROVIDER_VALIDATION_ID),
    syntheticProviderId: z.literal(PR6R_SYNTHETIC_PROVIDER_ID),
    implementationRevision: canonicalImplementationRevision,
    model: z.literal(PR6R_MODEL_SLUG),
    upstreamSlug: z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG),
    credentialMetadataId: z.literal(
      PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    ),
    providerKind: z.literal("synthetic_loopback"),
    transport: z.literal("loopback_only"),
    validationOutcome: z.literal("accepted"),
    capabilities: Pr6rLoopbackCapabilitiesV1Schema,
    validatedAt: canonicalTimestamp,
    externalProviderContact: z.literal(false),
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
  })
  .strict();

export type Pr6rLoopbackProviderValidationPreimageV1 = z.infer<
  typeof Pr6rLoopbackProviderValidationPreimageV1Schema
>;

export function canonicalPr6rLoopbackProviderValidationSha256(
  value: unknown,
): string {
  const preimage =
    Pr6rLoopbackProviderValidationPreimageV1Schema.parse(value);
  return sha256Hex(canonicalPr6rJsonV1(preimage));
}

export const Pr6rLoopbackProviderValidationV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-loopback-provider-validation-v1"),
    validationId: z.literal(PR6R_PROVIDER_VALIDATION_ID),
    syntheticProviderId: z.literal(PR6R_SYNTHETIC_PROVIDER_ID),
    implementationRevision: canonicalImplementationRevision,
    model: z.literal(PR6R_MODEL_SLUG),
    upstreamSlug: z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG),
    credentialMetadataId: z.literal(
      PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    ),
    providerKind: z.literal("synthetic_loopback"),
    transport: z.literal("loopback_only"),
    validationOutcome: z.literal("accepted"),
    capabilities: Pr6rLoopbackCapabilitiesV1Schema,
    validatedAt: canonicalTimestamp,
    externalProviderContact: z.literal(false),
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
    validationSha256: Sha256Schema,
  })
  .strict()
  .superRefine((validation, context) => {
    const preimage =
      Pr6rLoopbackProviderValidationPreimageV1Schema.safeParse({
      schemaVersion: "pr6r-loopback-provider-validation-preimage-v1",
      validationId: validation.validationId,
      syntheticProviderId: validation.syntheticProviderId,
      implementationRevision: validation.implementationRevision,
      model: validation.model,
      upstreamSlug: validation.upstreamSlug,
      credentialMetadataId: validation.credentialMetadataId,
      providerKind: validation.providerKind,
      transport: validation.transport,
      validationOutcome: validation.validationOutcome,
      capabilities: validation.capabilities,
      validatedAt: validation.validatedAt,
      externalProviderContact: validation.externalProviderContact,
      costScope: validation.costScope,
      actualPaidAuthority: validation.actualPaidAuthority,
      actualExternalSpendMicrousd: validation.actualExternalSpendMicrousd,
    });
    if (!preimage.success) return;
    const expected = sha256Hex(canonicalPr6rJsonV1(preimage.data));
    if (validation.validationSha256 !== expected) {
      issue(
        context,
        ["validationSha256"],
        "Loopback provider validation canonical hash mismatch.",
      );
    }
  });

export type Pr6rLoopbackProviderValidationV1 = z.infer<
  typeof Pr6rLoopbackProviderValidationV1Schema
>;

export function buildPr6rLoopbackProviderValidationV1(input: {
  implementationRevision: string;
  validatedAt: string;
}): Pr6rLoopbackProviderValidationV1 {
  const preimage =
    Pr6rLoopbackProviderValidationPreimageV1Schema.parse({
      schemaVersion: "pr6r-loopback-provider-validation-preimage-v1",
      validationId: PR6R_PROVIDER_VALIDATION_ID,
      syntheticProviderId: PR6R_SYNTHETIC_PROVIDER_ID,
      implementationRevision: input.implementationRevision,
      model: PR6R_MODEL_SLUG,
      upstreamSlug: PR6R_SYNTHETIC_UPSTREAM_SLUG,
      credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
      providerKind: "synthetic_loopback",
      transport: "loopback_only",
      validationOutcome: "accepted",
      capabilities: {
        chatCompletions: true,
        strictStructuredOutput: true,
        tools: false,
        redirects: false,
        retries: false,
      },
      validatedAt: input.validatedAt,
      externalProviderContact: false,
      costScope: PR6R_COST_SCOPE,
      actualPaidAuthority: false,
      actualExternalSpendMicrousd: 0,
    });
  return deepFreeze(
    Pr6rLoopbackProviderValidationV1Schema.parse({
      ...preimage,
      schemaVersion: "pr6r-loopback-provider-validation-v1",
      validationSha256:
        canonicalPr6rLoopbackProviderValidationSha256(preimage),
    }),
  );
}

export const Pr6rSimulationPricingSnapshotPreimageV1Schema = z
  .object({
    schemaVersion: z.literal(
      "pr6r-simulation-pricing-snapshot-preimage-v1",
    ),
    pricingSnapshotId: z.literal(PR6R_SIMULATION_PRICING_SNAPSHOT_ID),
    syntheticProviderId: z.literal(PR6R_SYNTHETIC_PROVIDER_ID),
    providerValidationId: z.literal(PR6R_PROVIDER_VALIDATION_ID),
    providerValidationSha256: Sha256Schema,
    implementationRevision: canonicalImplementationRevision,
    model: z.literal(PR6R_MODEL_SLUG),
    upstreamSlug: z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG),
    currency: z.literal("USD"),
    rateUnit: z.literal("microusd_per_million_tokens"),
    inputRateMicrousdPerMillion: z.literal(
      PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
    ),
    outputRateMicrousdPerMillion: z.literal(
      PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
    ),
    cacheReadRateMicrousdPerMillion: z.literal(0),
    cacheWriteRateMicrousdPerMillion: z.literal(0),
    reasoningBilling: z.literal("included_in_output"),
    source: z.literal("synthetic_fixed_v1"),
    validatedAt: canonicalTimestamp,
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
  })
  .strict();

export type Pr6rSimulationPricingSnapshotPreimageV1 = z.infer<
  typeof Pr6rSimulationPricingSnapshotPreimageV1Schema
>;

export function canonicalPr6rSimulationPricingSnapshotSha256(
  value: unknown,
): string {
  const preimage =
    Pr6rSimulationPricingSnapshotPreimageV1Schema.parse(value);
  return sha256Hex(canonicalPr6rJsonV1(preimage));
}

export const Pr6rSimulationPricingSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-simulation-pricing-snapshot-v1"),
    pricingSnapshotId: z.literal(PR6R_SIMULATION_PRICING_SNAPSHOT_ID),
    syntheticProviderId: z.literal(PR6R_SYNTHETIC_PROVIDER_ID),
    providerValidationId: z.literal(PR6R_PROVIDER_VALIDATION_ID),
    providerValidationSha256: Sha256Schema,
    implementationRevision: canonicalImplementationRevision,
    model: z.literal(PR6R_MODEL_SLUG),
    upstreamSlug: z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG),
    currency: z.literal("USD"),
    rateUnit: z.literal("microusd_per_million_tokens"),
    inputRateMicrousdPerMillion: z.literal(
      PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
    ),
    outputRateMicrousdPerMillion: z.literal(
      PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
    ),
    cacheReadRateMicrousdPerMillion: z.literal(0),
    cacheWriteRateMicrousdPerMillion: z.literal(0),
    reasoningBilling: z.literal("included_in_output"),
    source: z.literal("synthetic_fixed_v1"),
    validatedAt: canonicalTimestamp,
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
    pricingSnapshotSha256: Sha256Schema,
  })
  .strict()
  .superRefine((pricing, context) => {
    const preimage =
      Pr6rSimulationPricingSnapshotPreimageV1Schema.safeParse({
      schemaVersion: "pr6r-simulation-pricing-snapshot-preimage-v1",
      pricingSnapshotId: pricing.pricingSnapshotId,
      syntheticProviderId: pricing.syntheticProviderId,
      providerValidationId: pricing.providerValidationId,
      providerValidationSha256: pricing.providerValidationSha256,
      implementationRevision: pricing.implementationRevision,
      model: pricing.model,
      upstreamSlug: pricing.upstreamSlug,
      currency: pricing.currency,
      rateUnit: pricing.rateUnit,
      inputRateMicrousdPerMillion: pricing.inputRateMicrousdPerMillion,
      outputRateMicrousdPerMillion: pricing.outputRateMicrousdPerMillion,
      cacheReadRateMicrousdPerMillion: pricing.cacheReadRateMicrousdPerMillion,
      cacheWriteRateMicrousdPerMillion: pricing.cacheWriteRateMicrousdPerMillion,
      reasoningBilling: pricing.reasoningBilling,
      source: pricing.source,
      validatedAt: pricing.validatedAt,
      costScope: pricing.costScope,
      actualPaidAuthority: pricing.actualPaidAuthority,
      actualExternalSpendMicrousd: pricing.actualExternalSpendMicrousd,
    });
    if (!preimage.success) return;
    const expected = sha256Hex(canonicalPr6rJsonV1(preimage.data));
    if (pricing.pricingSnapshotSha256 !== expected) {
      issue(
        context,
        ["pricingSnapshotSha256"],
        "Simulation pricing snapshot canonical hash mismatch.",
      );
    }
  });

export type Pr6rSimulationPricingSnapshotV1 = z.infer<
  typeof Pr6rSimulationPricingSnapshotV1Schema
>;

export function buildPr6rSimulationPricingSnapshotV1(input: {
  implementationRevision: string;
  providerValidationSha256: string;
  validatedAt: string;
}): Pr6rSimulationPricingSnapshotV1 {
  const preimage =
    Pr6rSimulationPricingSnapshotPreimageV1Schema.parse({
      schemaVersion: "pr6r-simulation-pricing-snapshot-preimage-v1",
      pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
      syntheticProviderId: PR6R_SYNTHETIC_PROVIDER_ID,
      providerValidationId: PR6R_PROVIDER_VALIDATION_ID,
      providerValidationSha256: input.providerValidationSha256,
      implementationRevision: input.implementationRevision,
      model: PR6R_MODEL_SLUG,
      upstreamSlug: PR6R_SYNTHETIC_UPSTREAM_SLUG,
      currency: "USD",
      rateUnit: "microusd_per_million_tokens",
      inputRateMicrousdPerMillion:
        PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
      outputRateMicrousdPerMillion:
        PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
      cacheReadRateMicrousdPerMillion: 0,
      cacheWriteRateMicrousdPerMillion: 0,
      reasoningBilling: "included_in_output",
      source: "synthetic_fixed_v1",
      validatedAt: input.validatedAt,
      costScope: PR6R_COST_SCOPE,
      actualPaidAuthority: false,
      actualExternalSpendMicrousd: 0,
    });
  return deepFreeze(
    Pr6rSimulationPricingSnapshotV1Schema.parse({
      ...preimage,
      schemaVersion: "pr6r-simulation-pricing-snapshot-v1",
      pricingSnapshotSha256:
        canonicalPr6rSimulationPricingSnapshotSha256(preimage),
    }),
  );
}

export const Pr6rCommonInvestigationPreimageV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-common-investigation-preimage-v1"),
    investigationId: z.literal(PR6R_COMMON_INVESTIGATION_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalImplementationRevision,
    parentSessionId: boundedId,
    commonCheckpointSha256: Sha256Schema,
    durationMs: boundedDurationMs,
    toolCallCount: z
      .number()
      .int()
      .nonnegative()
      .safe()
      .max(PR6R_MAX_COMMON_TOOL_CALLS),
    terminalReason: z.literal("completed"),
  })
  .strict();

export type Pr6rCommonInvestigationPreimageV1 = z.infer<
  typeof Pr6rCommonInvestigationPreimageV1Schema
>;

export function canonicalPr6rCommonInvestigationSha256(
  value: unknown,
): string {
  const preimage = Pr6rCommonInvestigationPreimageV1Schema.parse(value);
  return sha256Hex(canonicalPr6rJsonV1(preimage));
}

export const Pr6rCommonInvestigationV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-common-investigation-v1"),
    investigationId: z.literal(PR6R_COMMON_INVESTIGATION_ID),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalImplementationRevision,
    parentSessionId: boundedId,
    commonCheckpointSha256: Sha256Schema,
    durationMs: boundedDurationMs,
    toolCallCount: z
      .number()
      .int()
      .nonnegative()
      .safe()
      .max(PR6R_MAX_COMMON_TOOL_CALLS),
    terminalReason: z.literal("completed"),
    investigationSha256: Sha256Schema,
  })
  .strict()
  .superRefine((investigation, context) => {
    const preimage = Pr6rCommonInvestigationPreimageV1Schema.safeParse({
      schemaVersion: "pr6r-common-investigation-preimage-v1",
      investigationId: investigation.investigationId,
      campaignId: investigation.campaignId,
      implementationRevision: investigation.implementationRevision,
      parentSessionId: investigation.parentSessionId,
      commonCheckpointSha256: investigation.commonCheckpointSha256,
      durationMs: investigation.durationMs,
      toolCallCount: investigation.toolCallCount,
      terminalReason: investigation.terminalReason,
    });
    if (!preimage.success) return;
    const expected = sha256Hex(canonicalPr6rJsonV1(preimage.data));
    if (investigation.investigationSha256 !== expected) {
      issue(
        context,
        ["investigationSha256"],
        "Common investigation canonical hash mismatch.",
      );
    }
  });

export type Pr6rCommonInvestigationV1 = z.infer<
  typeof Pr6rCommonInvestigationV1Schema
>;

export function buildPr6rCommonInvestigationV1(input: {
  implementationRevision: string;
  parentSessionId: string;
  commonCheckpointSha256: string;
  durationMs: number;
  toolCallCount: number;
}): Pr6rCommonInvestigationV1 {
  const preimage = Pr6rCommonInvestigationPreimageV1Schema.parse({
    schemaVersion: "pr6r-common-investigation-preimage-v1",
    investigationId: PR6R_COMMON_INVESTIGATION_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: input.implementationRevision,
    parentSessionId: input.parentSessionId,
    commonCheckpointSha256: input.commonCheckpointSha256,
    durationMs: input.durationMs,
    toolCallCount: input.toolCallCount,
    terminalReason: "completed",
  });
  return deepFreeze(
    Pr6rCommonInvestigationV1Schema.parse({
      ...preimage,
      schemaVersion: "pr6r-common-investigation-v1",
      investigationSha256:
        canonicalPr6rCommonInvestigationSha256(preimage),
    }),
  );
}

const boundedInputTokenCount = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .max(PR6R_MAX_ADMITTED_INPUT_TOKENS);
const boundedOutputTokenCount = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .max(PR6R_REQUESTED_OUTPUT_TOKENS);
const boundedTotalTokenCount = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .max(PR6R_MAX_RECORDED_TOTAL_TOKENS);

const Pr6rReportedTokenAccountingV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-token-accounting-v1"),
    reported: z.literal(true),
    provenance: z.literal("provider_reported"),
    inputTokens: boundedInputTokenCount,
    cacheReadTokens: boundedInputTokenCount,
    cacheWriteTokens: boundedInputTokenCount,
    reasoningTokens: boundedOutputTokenCount,
    visibleOutputTokens: boundedOutputTokenCount,
    totalTokens: boundedTotalTokenCount,
  })
  .strict()
  .superRefine((usage, context) => {
    if (usage.cacheReadTokens + usage.cacheWriteTokens > usage.inputTokens) {
      issue(
        context,
        ["cacheReadTokens"],
        "Cache read and write tokens must be a bounded subset of input tokens.",
      );
    }
    if (
      usage.reasoningTokens + usage.visibleOutputTokens >
      PR6R_REQUESTED_OUTPUT_TOKENS
    ) {
      issue(
        context,
        ["visibleOutputTokens"],
        "Reasoning and visible output tokens exceed the output allowance.",
      );
    }
    if (
      usage.totalTokens !==
      usage.inputTokens + usage.reasoningTokens + usage.visibleOutputTokens
    ) {
      issue(
        context,
        ["totalTokens"],
        "Reported total tokens must equal input plus reasoning plus visible output.",
      );
    }
  });

const Pr6rUnreportedTokenAccountingV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-token-accounting-v1"),
    reported: z.literal(false),
    provenance: z.literal("provider_unreported"),
    inputTokens: z.null(),
    cacheReadTokens: z.null(),
    cacheWriteTokens: z.null(),
    reasoningTokens: z.null(),
    visibleOutputTokens: z.null(),
    totalTokens: z.null(),
  })
  .strict();

export const Pr6rTokenAccountingV1Schema = z.discriminatedUnion("reported", [
  Pr6rReportedTokenAccountingV1Schema,
  Pr6rUnreportedTokenAccountingV1Schema,
]);
export type Pr6rTokenAccountingV1 = z.infer<
  typeof Pr6rTokenAccountingV1Schema
>;

const simulationCostIdentityShape = {
  schemaVersion: z.literal("pr6r-simulation-cost-v1"),
  pricingSnapshotId: z.literal(PR6R_SIMULATION_PRICING_SNAPSHOT_ID),
  pricingSnapshotSha256: Sha256Schema,
  costScope: z.literal(PR6R_COST_SCOPE),
  actualPaidAuthority: z.literal(false),
  actualExternalSpendMicrousd: z.literal(0),
} as const;
const boundedSimulationMicrousd = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .max(PR6R_MAX_SIMULATED_RESERVATION_MICROUSD);
const positiveSimulationMicrousd = z
  .number()
  .int()
  .positive()
  .safe()
  .max(PR6R_MAX_SIMULATED_RESERVATION_MICROUSD);

const Pr6rNotReservedSimulationCostV1Schema = z
  .object({
    ...simulationCostIdentityShape,
    settlementState: z.literal("not_reserved"),
    reservationId: z.null(),
    projectedMicrousd: z.literal(0),
    reservedMicrousd: z.literal(0),
    settledMicrousd: z.literal(0),
    provenance: z.literal("not_settled"),
  })
  .strict();
const Pr6rReservedSimulationCostV1Schema = z
  .object({
    ...simulationCostIdentityShape,
    settlementState: z.literal("reserved"),
    reservationId: boundedId,
    projectedMicrousd: positiveSimulationMicrousd,
    reservedMicrousd: positiveSimulationMicrousd,
    settledMicrousd: z.null(),
    provenance: z.literal("not_settled"),
  })
  .strict();
const Pr6rSettledSimulationCostV1Schema = z
  .object({
    ...simulationCostIdentityShape,
    settlementState: z.literal("settled"),
    reservationId: boundedId,
    projectedMicrousd: positiveSimulationMicrousd,
    reservedMicrousd: positiveSimulationMicrousd,
    settledMicrousd: boundedSimulationMicrousd,
    provenance: z.enum(["provider_reported", "host_pricing_snapshot"]),
  })
  .strict();
const Pr6rUnknownSimulationCostV1Schema = z
  .object({
    ...simulationCostIdentityShape,
    settlementState: z.literal("unknown"),
    reservationId: boundedId,
    projectedMicrousd: positiveSimulationMicrousd,
    reservedMicrousd: positiveSimulationMicrousd,
    settledMicrousd: z.null(),
    provenance: z.literal("reserved_unknown"),
  })
  .strict();

function validateProjectedReservation(
  cost: {
    settlementState: string;
    projectedMicrousd: number;
    reservedMicrousd: number;
  },
  context: RefinementContext,
): void {
  if (
    cost.settlementState !== "not_reserved" &&
    cost.projectedMicrousd > cost.reservedMicrousd
  ) {
    issue(
      context,
      ["projectedMicrousd"],
      "The simulated projection cannot exceed its admitted reservation.",
    );
  }
}

export const Pr6rSimulationCostV1Schema = z.discriminatedUnion(
  "settlementState",
  [
    Pr6rNotReservedSimulationCostV1Schema,
    Pr6rReservedSimulationCostV1Schema,
    Pr6rSettledSimulationCostV1Schema,
    Pr6rUnknownSimulationCostV1Schema,
  ],
).superRefine(validateProjectedReservation);
export type Pr6rSimulationCostV1 = z.infer<
  typeof Pr6rSimulationCostV1Schema
>;

const safeSimulationCostIdentityShape = {
  schemaVersion: z.literal("pr6r-safe-simulation-cost-v1"),
  pricingSnapshotId: z.literal(PR6R_SIMULATION_PRICING_SNAPSHOT_ID),
  pricingSnapshotSha256: Sha256Schema,
  costScope: z.literal(PR6R_COST_SCOPE),
  actualPaidAuthority: z.literal(false),
  actualExternalSpendMicrousd: z.literal(0),
} as const;
const Pr6rSafeNotReservedSimulationCostV1Schema = z
  .object({
    ...safeSimulationCostIdentityShape,
    settlementState: z.literal("not_reserved"),
    projectedMicrousd: z.literal(0),
    reservedMicrousd: z.literal(0),
    settledMicrousd: z.literal(0),
    provenance: z.literal("not_settled"),
  })
  .strict();
const Pr6rSafeSettledSimulationCostV1Schema = z
  .object({
    ...safeSimulationCostIdentityShape,
    settlementState: z.literal("settled"),
    projectedMicrousd: positiveSimulationMicrousd,
    reservedMicrousd: positiveSimulationMicrousd,
    settledMicrousd: boundedSimulationMicrousd,
    provenance: z.enum(["provider_reported", "host_pricing_snapshot"]),
  })
  .strict();
const Pr6rSafeUnknownSimulationCostV1Schema = z
  .object({
    ...safeSimulationCostIdentityShape,
    settlementState: z.literal("unknown"),
    projectedMicrousd: positiveSimulationMicrousd,
    reservedMicrousd: positiveSimulationMicrousd,
    settledMicrousd: z.null(),
    provenance: z.literal("reserved_unknown"),
  })
  .strict();

export const Pr6rSafeSimulationCostV1Schema = z.discriminatedUnion(
  "settlementState",
  [
    Pr6rSafeNotReservedSimulationCostV1Schema,
    Pr6rSafeSettledSimulationCostV1Schema,
    Pr6rSafeUnknownSimulationCostV1Schema,
  ],
).superRefine(validateProjectedReservation);
export type Pr6rSafeSimulationCostV1 = z.infer<
  typeof Pr6rSafeSimulationCostV1Schema
>;

export function calculatePr6rHostPricedSimulationCostMicrousd(usage: {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  visibleOutputTokens: number;
}): number {
  const uncachedInputTokens =
    usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens;
  const outputTokens = usage.reasoningTokens + usage.visibleOutputTokens;
  return (
    Math.ceil(
      (uncachedInputTokens *
        PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION) /
        1_000_000,
    ) +
    Math.ceil(
      (outputTokens *
        PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION) /
        1_000_000,
    )
  );
}

function validateDecisionSimulationEvidence(
  decision: {
    tokenAccounting: {
      reported: boolean;
      inputTokens: number | null;
      cacheReadTokens: number | null;
      cacheWriteTokens: number | null;
      reasoningTokens: number | null;
      visibleOutputTokens: number | null;
    };
    simulationCost: {
      settlementState: string;
      projectedMicrousd: number;
      reservedMicrousd: number;
      settledMicrousd: number | null;
      provenance: string;
    };
  },
  context: RefinementContext,
): void {
  const cost = decision.simulationCost;
  if (
    cost.settlementState !== "not_reserved" &&
    cost.projectedMicrousd > cost.reservedMicrousd
  ) {
    issue(
      context,
      ["simulationCost", "projectedMicrousd"],
      "The simulated projection cannot exceed its admitted reservation.",
    );
  }
  if (cost.provenance !== "host_pricing_snapshot") return;
  const usage = decision.tokenAccounting;
  if (
    !usage.reported ||
    usage.inputTokens === null ||
    usage.cacheReadTokens === null ||
    usage.cacheWriteTokens === null ||
    usage.reasoningTokens === null ||
    usage.visibleOutputTokens === null
  ) {
    issue(
      context,
      ["tokenAccounting", "provenance"],
      "Host-priced settlement requires complete reported token accounting.",
    );
    return;
  }
  const expected = calculatePr6rHostPricedSimulationCostMicrousd({
    inputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: usage.reasoningTokens,
    visibleOutputTokens: usage.visibleOutputTokens,
  });
  if (cost.settledMicrousd !== expected) {
    issue(
      context,
      ["simulationCost", "settledMicrousd"],
      "Host-priced settlement does not match the fixed synthetic price and reported tokens.",
    );
  }
}

const Pr6rUnavailableOutputValidityV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-output-validity-v1"),
    status: z.literal("not_available"),
    schemaAccepted: z.null(),
    citationSupport: z.null(),
    evidenceIntegrity: z.null(),
    snapshotFreshness: z.null(),
    coverageComplete: z.null(),
  })
  .strict();
/**
 * A1 can prove that the provider output parsed as ReviewResultV1, but it does
 * not yet own the admitted-evidence inputs needed to recompute citation,
 * integrity, freshness, and coverage. Keep those claims explicitly deferred
 * until the A3 coordinator can derive them rather than trusting a caller.
 */
export const Pr6rPostSchemaValidityDeferredOutputValidityV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-output-validity-v1"),
    status: z.literal("post_schema_validity_deferred"),
    schemaAccepted: z.literal(true),
    citationSupport: z.null(),
    evidenceIntegrity: z.null(),
    snapshotFreshness: z.null(),
    coverageComplete: z.null(),
  })
  .strict();
export type Pr6rPostSchemaValidityDeferredOutputValidityV1 = z.infer<
  typeof Pr6rPostSchemaValidityDeferredOutputValidityV1Schema
>;
const Pr6rSchemaRejectedOutputValidityV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-output-validity-v1"),
    status: z.literal("failed"),
    schemaAccepted: z.literal(false),
    citationSupport: z.literal(false),
    evidenceIntegrity: z.literal(false),
    snapshotFreshness: z.literal(false),
    coverageComplete: z.literal(false),
  })
  .strict();
export const Pr6rOutputValidityV1Schema = z.union([
  Pr6rUnavailableOutputValidityV1Schema,
  Pr6rPostSchemaValidityDeferredOutputValidityV1Schema,
  Pr6rSchemaRejectedOutputValidityV1Schema,
]);
export type Pr6rOutputValidityV1 = z.infer<
  typeof Pr6rOutputValidityV1Schema
>;

const fallbackIdentityShape = {
  schemaVersion: z.literal("pr6r-campaign-fallback-state-v1"),
  fallbackId: z.literal(PR6R_CAMPAIGN_FALLBACK_ID),
  campaignId: z.literal(PR6R_CAMPAIGN_ID),
  implementationRevision: canonicalImplementationRevision,
  costScope: z.literal(PR6R_COST_SCOPE),
  actualPaidAuthority: z.literal(false),
  actualExternalSpendMicrousd: z.literal(0),
} as const;
const fallbackTriggerShape = {
  triggerSlotId: z.enum([
    "cloud_synthesis",
    "hybrid_cloud_if_selected",
  ]),
  triggerTerminalSha256: Sha256Schema,
  fallbackClaimSha256: Sha256Schema,
  claimedAt: canonicalTimestamp,
  resolution: z.literal("reuse_local_synthesis"),
  sourceSlotId: z.literal("local_synthesis"),
  sourceSynthesisSessionId: boundedId,
  sourceReviewResultSha256: Sha256Schema,
} as const;

const Pr6rAvailableFallbackStateV1Schema = z
  .object({
    ...fallbackIdentityShape,
    state: z.literal("available"),
    triggerSlotId: z.null(),
    triggerTerminalSha256: z.null(),
    fallbackClaimSha256: z.null(),
    claimedAt: z.null(),
    resolution: z.null(),
    sourceSlotId: z.null(),
    sourceSynthesisSessionId: z.null(),
    sourceReviewResultSha256: z.null(),
    terminalAt: z.null(),
    terminalReason: z.null(),
  })
  .strict();
const Pr6rClaimedFallbackStateV1Schema = z
  .object({
    ...fallbackIdentityShape,
    ...fallbackTriggerShape,
    state: z.literal("claimed"),
    terminalAt: z.null(),
    terminalReason: z.literal("fallback.claimed"),
  })
  .strict();
const Pr6rCompletedFallbackStateV1Schema = z
  .object({
    ...fallbackIdentityShape,
    ...fallbackTriggerShape,
    state: z.literal("completed"),
    terminalAt: canonicalTimestamp,
    terminalReason: z.literal("fallback.local_result_reused"),
  })
  .strict()
  .superRefine((fallback, context) => {
    if (fallback.terminalAt < fallback.claimedAt) {
      issue(
        context,
        ["terminalAt"],
        "Fallback completion cannot predate its durable claim.",
      );
    }
  });
const Pr6rNotUsedFallbackStateV1Schema = z
  .object({
    ...fallbackIdentityShape,
    state: z.literal("not_used"),
    triggerSlotId: z.null(),
    triggerTerminalSha256: z.null(),
    fallbackClaimSha256: z.null(),
    claimedAt: z.null(),
    resolution: z.null(),
    sourceSlotId: z.null(),
    sourceSynthesisSessionId: z.null(),
    sourceReviewResultSha256: z.null(),
    terminalAt: z.null(),
    terminalReason: z.literal("fallback.not_used"),
  })
  .strict();

export const Pr6rCampaignFallbackStateV1Schema = z.discriminatedUnion(
  "state",
  [
    Pr6rAvailableFallbackStateV1Schema,
    Pr6rClaimedFallbackStateV1Schema,
    Pr6rCompletedFallbackStateV1Schema,
    Pr6rNotUsedFallbackStateV1Schema,
  ],
);
export type Pr6rCampaignFallbackStateV1 = z.infer<
  typeof Pr6rCampaignFallbackStateV1Schema
>;

function synthesisDecisionSchema<Slot extends z.ZodType>(slot: Slot) {
  return z
    .object({
      schemaVersion: z.literal("pr6r-synthesis-decision-v1"),
      slot,
      parentSessionId: boundedId,
      commonCheckpointSha256: Sha256Schema,
    })
    .strict();
}

const Pr6rLocalSynthesisDecisionV1Schema = synthesisDecisionSchema(
  Pr6rLocalSynthesisSlotV1Schema,
);
const Pr6rCloudSynthesisDecisionV1Schema = synthesisDecisionSchema(
  Pr6rCloudSynthesisSlotV1Schema,
);
const Pr6rHybridSynthesisDecisionV1Schema = synthesisDecisionSchema(
  Pr6rHybridCloudIfSelectedSlotV1Schema,
);

export const Pr6rCampaignV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-campaign-v1"),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalImplementationRevision,
    authority: Pr6rDevelopmentAuthorityV1Schema,
    osAuthorityClaim: Pr6rOsAuthorityClaimV1Schema,
    providerValidation: Pr6rLoopbackProviderValidationV1Schema,
    pricingSnapshot: Pr6rSimulationPricingSnapshotV1Schema,
    fixture: Pr6rFixtureV1Schema,
    parent: z
      .object({
        sessionId: boundedId,
        commonCheckpoint: Pr6rCommonCheckpointV1Schema,
      })
      .strict(),
    commonInvestigation: Pr6rCommonInvestigationV1Schema,
    synthesisDecisions: z.tuple([
      Pr6rLocalSynthesisDecisionV1Schema,
      Pr6rCloudSynthesisDecisionV1Schema,
      Pr6rHybridSynthesisDecisionV1Schema,
    ]),
    fallbackState: Pr6rAvailableFallbackStateV1Schema,
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
  })
  .strict()
  .superRefine((campaign, context) => {
    if (
      campaign.parent.commonCheckpoint.parentSessionId !==
      campaign.parent.sessionId
    ) {
      issue(
        context,
        ["parent", "commonCheckpoint", "parentSessionId"],
        "The common checkpoint must belong to the single campaign parent.",
      );
    }
    const revisionBindings = [
      ["osAuthorityClaim", campaign.osAuthorityClaim.implementationRevision],
      ["providerValidation", campaign.providerValidation.implementationRevision],
      ["pricingSnapshot", campaign.pricingSnapshot.implementationRevision],
      ["commonInvestigation", campaign.commonInvestigation.implementationRevision],
      ["fallbackState", campaign.fallbackState.implementationRevision],
    ] as const;
    revisionBindings.forEach(([field, revision]) => {
      if (revision !== campaign.implementationRevision) {
        issue(
          context,
          [field, "implementationRevision"],
          "Campaign evidence must bind the exact implementation revision.",
        );
      }
    });
    if (
      campaign.pricingSnapshot.providerValidationSha256 !==
      campaign.providerValidation.validationSha256
    ) {
      issue(
        context,
        ["pricingSnapshot", "providerValidationSha256"],
        "The simulation price must bind the accepted loopback validation.",
      );
    }
    if (
      campaign.pricingSnapshot.validatedAt <
      campaign.providerValidation.validatedAt
    ) {
      issue(
        context,
        ["pricingSnapshot", "validatedAt"],
        "The simulation price cannot predate the provider validation it references.",
      );
    }
    if (
      campaign.commonInvestigation.parentSessionId !==
      campaign.parent.sessionId
    ) {
      issue(
        context,
        ["commonInvestigation", "parentSessionId"],
        "The common investigation must belong to the campaign parent.",
      );
    }
    if (
      campaign.commonInvestigation.commonCheckpointSha256 !==
      campaign.parent.commonCheckpoint.checkpointSha256
    ) {
      issue(
        context,
        ["commonInvestigation", "commonCheckpointSha256"],
        "The common investigation must bind the common checkpoint.",
      );
    }
    campaign.synthesisDecisions.forEach((decision, index) => {
      if (decision.parentSessionId !== campaign.parent.sessionId) {
        issue(
          context,
          ["synthesisDecisions", index, "parentSessionId"],
          "Every synthesis decision must share the single campaign parent.",
        );
      }
      if (
        decision.commonCheckpointSha256 !==
        campaign.parent.commonCheckpoint.checkpointSha256
      ) {
        issue(
          context,
          ["synthesisDecisions", index, "commonCheckpointSha256"],
          "Every synthesis decision must use the common checkpoint.",
        );
      }
    });
  });

export type Pr6rCampaignV1 = z.infer<typeof Pr6rCampaignV1Schema>;

export const PR6R_COMPARISON_STATES = [
  "pending",
  "completed",
  "failed",
  "cancelled",
  "not_selected",
] as const;

const loopbackFailedReasonsByDisposition = {
  not_sent: new Set<string>(PR6R_LOOPBACK_FAILED_NOT_SENT_REASONS),
  sent: new Set<string>(PR6R_LOOPBACK_FAILED_SENT_REASONS),
  unknown: new Set<string>(PR6R_LOOPBACK_FAILED_UNKNOWN_REASONS),
} as const;
const loopbackCancelledReasonsByDisposition = {
  not_sent: new Set<string>(PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS),
  sent: new Set<string>(),
  unknown: new Set<string>(PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS),
} as const;
const schemaRejectedTerminalReasons = new Set<string>([
  "loopback.response_malformed",
  "loopback.protocol_invalid",
  "loopback.review_result_invalid",
  "loopback.invalid_response",
]);

function validateLoopbackTerminalEvidence(
  decision: {
    state: "failed" | "cancelled";
    requestDisposition: "not_sent" | "sent" | "unknown";
    responseBodySha256?: string | null;
    tokenAccounting: { reported: boolean };
    simulationCost: { settlementState: string };
    outputValidity: Pr6rOutputValidityV1;
    terminalReason: string;
  },
  context: RefinementContext,
): void {
  const allowed =
    decision.state === "failed"
      ? loopbackFailedReasonsByDisposition[decision.requestDisposition]
      : loopbackCancelledReasonsByDisposition[decision.requestDisposition];
  if (!allowed.has(decision.terminalReason)) {
    issue(
      context,
      ["terminalReason"],
      "Loopback terminal reason does not match its request disposition.",
    );
  }
  if (
    decision.requestDisposition !== "sent" &&
    decision.responseBodySha256 !== undefined &&
    decision.responseBodySha256 !== null
  ) {
    issue(
      context,
      ["responseBodySha256"],
      "A non-sent loopback terminal cannot claim a response body.",
    );
  }
  if (decision.requestDisposition === "not_sent") {
    if (decision.simulationCost.settlementState !== "not_reserved") {
      issue(
        context,
        ["simulationCost", "settlementState"],
        "A definitely unsent loopback terminal cannot claim a reservation or settlement.",
      );
    }
    if (decision.tokenAccounting.reported) {
      issue(
        context,
        ["tokenAccounting", "reported"],
        "A definitely unsent loopback terminal cannot claim provider token usage.",
      );
    }
  } else if (decision.requestDisposition === "sent") {
    if (decision.simulationCost.settlementState === "not_reserved") {
      issue(
        context,
        ["simulationCost", "settlementState"],
        "A sent loopback terminal must retain settled or unknown reservation evidence.",
      );
    }
  } else {
    if (decision.simulationCost.settlementState !== "unknown") {
      issue(
        context,
        ["simulationCost", "settlementState"],
        "An unknown-disposition loopback terminal must consume an unknown reservation.",
      );
    }
    if (decision.tokenAccounting.reported) {
      issue(
        context,
        ["tokenAccounting", "reported"],
        "An unknown-disposition loopback terminal cannot claim provider token usage.",
      );
    }
  }
  if (
    decision.outputValidity.status === "failed" &&
    (!schemaRejectedTerminalReasons.has(decision.terminalReason) ||
      (Object.hasOwn(decision, "responseBodySha256") &&
        decision.responseBodySha256 === null))
  ) {
    issue(
      context,
      ["outputValidity"],
      "Schema-rejected validity requires a retained post-response schema failure.",
    );
  }
}

function comparisonDecisionSchema<
  SlotId extends "local_synthesis" | "cloud_synthesis" | "hybrid_cloud_if_selected",
>(slotId: SlotId, ordinal: 1 | 2 | 3) {
  const identityShape = {
    slotId: z.literal(slotId),
    ordinal: z.literal(ordinal),
    parentSessionId: boundedId,
    commonCheckpointSha256: Sha256Schema,
  } as const;
  const loopback = slotId !== "local_synthesis";
  const completedCost = loopback
    ? Pr6rSettledSimulationCostV1Schema
    : Pr6rNotReservedSimulationCostV1Schema;
  const failedReason = loopback
    ? loopbackFailedTerminalCode
    : localFailedTerminalCode;
  const cancelledReason = loopback
    ? loopbackCancelledTerminalCode
    : localCancelledTerminalCode;
  const failedCost = loopback
    ? z.union([
        Pr6rNotReservedSimulationCostV1Schema,
        Pr6rSettledSimulationCostV1Schema,
        Pr6rUnknownSimulationCostV1Schema,
      ])
    : Pr6rNotReservedSimulationCostV1Schema;
  const pending = z
    .object({
      ...identityShape,
      synthesisSessionId: z.null(),
      state: z.literal("pending"),
      requestDisposition: z.null(),
      applicationRequestSha256: z.null(),
      authoritySlotClaimSha256: z.null(),
      authoritySlotTerminalSha256: z.null(),
      requestBodySha256: z.null(),
      responseBodySha256: z.null(),
      reviewResultSha256: z.null(),
      synthesisLatencyMs: z.null(),
      tokenAccounting: Pr6rUnreportedTokenAccountingV1Schema,
      simulationCost: Pr6rNotReservedSimulationCostV1Schema,
      outputValidity: Pr6rUnavailableOutputValidityV1Schema,
      terminalReason: z.null(),
    })
    .strict();
  const completed = z
    .object({
      ...identityShape,
      synthesisSessionId: boundedId,
      state: z.literal("completed"),
      requestDisposition: loopback ? z.literal("sent") : z.null(),
      applicationRequestSha256: loopback ? Sha256Schema : z.null(),
      authoritySlotClaimSha256: loopback ? Sha256Schema : z.null(),
      authoritySlotTerminalSha256: loopback ? Sha256Schema : z.null(),
      requestBodySha256: loopback ? Sha256Schema : z.null(),
      responseBodySha256: loopback ? Sha256Schema : z.null(),
      reviewResultSha256: Sha256Schema,
      synthesisLatencyMs: boundedDurationMs,
      tokenAccounting: Pr6rTokenAccountingV1Schema,
      simulationCost: completedCost,
      outputValidity: Pr6rPostSchemaValidityDeferredOutputValidityV1Schema,
      terminalReason: z.literal("completed"),
    })
    .strict();
  const failed = z
    .object({
      ...identityShape,
      synthesisSessionId: boundedId,
      state: z.literal("failed"),
      requestDisposition: loopback
        ? z.enum(["not_sent", "sent", "unknown"])
        : z.null(),
      applicationRequestSha256: loopback ? Sha256Schema : z.null(),
      authoritySlotClaimSha256: loopback ? Sha256Schema : z.null(),
      authoritySlotTerminalSha256: loopback ? Sha256Schema : z.null(),
      requestBodySha256: loopback ? Sha256Schema : z.null(),
      responseBodySha256: loopback ? Sha256Schema.nullable() : z.null(),
      reviewResultSha256: z.null(),
      synthesisLatencyMs: boundedDurationMs,
      tokenAccounting: Pr6rTokenAccountingV1Schema,
      simulationCost: failedCost,
      outputValidity: z.union([
        Pr6rUnavailableOutputValidityV1Schema,
        Pr6rSchemaRejectedOutputValidityV1Schema,
      ]),
      terminalReason: failedReason,
    })
    .strict();
  const cancelled = z
    .object({
      ...identityShape,
      synthesisSessionId: boundedId,
      state: z.literal("cancelled"),
      requestDisposition: loopback
        ? z.enum(["not_sent", "unknown"])
        : z.null(),
      applicationRequestSha256: loopback ? Sha256Schema : z.null(),
      authoritySlotClaimSha256: loopback ? Sha256Schema : z.null(),
      authoritySlotTerminalSha256: loopback ? Sha256Schema : z.null(),
      requestBodySha256: loopback ? Sha256Schema : z.null(),
      responseBodySha256: loopback ? Sha256Schema.nullable() : z.null(),
      reviewResultSha256: z.null(),
      synthesisLatencyMs: boundedDurationMs,
      tokenAccounting: Pr6rTokenAccountingV1Schema,
      simulationCost: failedCost,
      outputValidity: Pr6rUnavailableOutputValidityV1Schema,
      terminalReason: cancelledReason,
    })
    .strict();
  const notSelected = z
    .object({
      ...identityShape,
      synthesisSessionId: z.null(),
      state: z.literal("not_selected"),
      requestDisposition: z.null(),
      applicationRequestSha256: z.null(),
      authoritySlotClaimSha256: z.null(),
      authoritySlotTerminalSha256: z.null(),
      requestBodySha256: z.null(),
      responseBodySha256: z.null(),
      reviewResultSha256: z.null(),
      synthesisLatencyMs: z.null(),
      tokenAccounting: Pr6rUnreportedTokenAccountingV1Schema,
      simulationCost: Pr6rNotReservedSimulationCostV1Schema,
      outputValidity: Pr6rUnavailableOutputValidityV1Schema,
      terminalReason: z.literal("route.not_selected"),
    })
    .strict();
  return z
    .discriminatedUnion("state", [
      pending,
      completed,
      failed,
      cancelled,
      notSelected,
    ])
    .superRefine((decision, context) => {
      validateDecisionSimulationEvidence(decision, context);
      if (
        loopback &&
        (decision.state === "failed" || decision.state === "cancelled")
      ) {
        validateLoopbackTerminalEvidence(
          decision as typeof decision & {
            state: "failed" | "cancelled";
            requestDisposition: "not_sent" | "sent" | "unknown";
          },
          context,
        );
      }
      if (
        decision.state === "not_selected" &&
        slotId !== "hybrid_cloud_if_selected"
      ) {
        issue(
          context,
          ["state"],
          "Only the conditional Hybrid slot may be not selected.",
        );
      }
      if (
        (decision.state === "failed" || decision.state === "cancelled") &&
        decision.responseBodySha256 !== null &&
        decision.requestBodySha256 === null
      ) {
        issue(
          context,
          ["requestBodySha256"],
          "A loopback response hash requires an admitted request-body hash.",
        );
      }
    });
}

const Pr6rLocalComparisonDecisionV1Schema = comparisonDecisionSchema(
  "local_synthesis",
  1,
);
const Pr6rCloudComparisonDecisionV1Schema = comparisonDecisionSchema(
  "cloud_synthesis",
  2,
);
const Pr6rHybridComparisonDecisionV1Schema = comparisonDecisionSchema(
  "hybrid_cloud_if_selected",
  3,
);

export const Pr6rComparisonV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-comparison-v1"),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalImplementationRevision,
    fixtureId: z.literal(PR6R_FIXTURE_ID),
    snapshotId: z.literal(PR6R_FIXTURE_SNAPSHOT_ID),
    parentSessionId: boundedId,
    commonCheckpointSha256: Sha256Schema,
    osAuthorityClaim: Pr6rOsAuthorityClaimV1Schema,
    providerValidation: Pr6rLoopbackProviderValidationV1Schema,
    pricingSnapshot: Pr6rSimulationPricingSnapshotV1Schema,
    commonInvestigation: Pr6rCommonInvestigationV1Schema,
    fallbackState: Pr6rCampaignFallbackStateV1Schema,
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(
      PR6R_MAX_ACTUAL_EXTERNAL_SPEND_MICROUSD,
    ),
    synthesisDecisions: z.tuple([
      Pr6rLocalComparisonDecisionV1Schema,
      Pr6rCloudComparisonDecisionV1Schema,
      Pr6rHybridComparisonDecisionV1Schema,
    ]),
  })
  .strict()
  .superRefine((comparison, context) => {
    const revisionBindings = [
      ["osAuthorityClaim", comparison.osAuthorityClaim.implementationRevision],
      ["providerValidation", comparison.providerValidation.implementationRevision],
      ["pricingSnapshot", comparison.pricingSnapshot.implementationRevision],
      ["commonInvestigation", comparison.commonInvestigation.implementationRevision],
      ["fallbackState", comparison.fallbackState.implementationRevision],
    ] as const;
    revisionBindings.forEach(([field, revision]) => {
      if (revision !== comparison.implementationRevision) {
        issue(
          context,
          [field, "implementationRevision"],
          "Comparison evidence must bind the exact implementation revision.",
        );
      }
    });
    if (
      comparison.pricingSnapshot.providerValidationSha256 !==
      comparison.providerValidation.validationSha256
    ) {
      issue(
        context,
        ["pricingSnapshot", "providerValidationSha256"],
        "The simulation price must bind the accepted loopback validation.",
      );
    }
    if (
      comparison.pricingSnapshot.validatedAt <
      comparison.providerValidation.validatedAt
    ) {
      issue(
        context,
        ["pricingSnapshot", "validatedAt"],
        "The simulation price cannot predate the provider validation it references.",
      );
    }
    if (
      comparison.commonInvestigation.parentSessionId !==
      comparison.parentSessionId
    ) {
      issue(
        context,
        ["commonInvestigation", "parentSessionId"],
        "The common investigation must belong to the comparison parent.",
      );
    }
    if (
      comparison.commonInvestigation.commonCheckpointSha256 !==
      comparison.commonCheckpointSha256
    ) {
      issue(
        context,
        ["commonInvestigation", "commonCheckpointSha256"],
        "The common investigation must bind the comparison checkpoint.",
      );
    }
    comparison.synthesisDecisions.forEach((decision, index) => {
      if (decision.parentSessionId !== comparison.parentSessionId) {
        issue(
          context,
          ["synthesisDecisions", index, "parentSessionId"],
          "Every comparison decision must share the campaign parent.",
        );
      }
      if (
        decision.commonCheckpointSha256 !==
        comparison.commonCheckpointSha256
      ) {
        issue(
          context,
          ["synthesisDecisions", index, "commonCheckpointSha256"],
          "Every comparison decision must use the common checkpoint.",
        );
      }
      if (
        decision.simulationCost.pricingSnapshotSha256 !==
        comparison.pricingSnapshot.pricingSnapshotSha256
      ) {
        issue(
          context,
          ["synthesisDecisions", index, "simulationCost", "pricingSnapshotSha256"],
          "Every simulated cost must bind the campaign price snapshot.",
        );
      }
    });
    const [, cloudDecision, hybridDecision] = comparison.synthesisDecisions;
    for (const field of [
      "applicationRequestSha256",
      "authoritySlotClaimSha256",
      "authoritySlotTerminalSha256",
    ] as const) {
      if (
        cloudDecision[field] !== null &&
        hybridDecision[field] !== null &&
        cloudDecision[field] === hybridDecision[field]
      ) {
        issue(
          context,
          ["synthesisDecisions", 2, field],
          "Cloud and Hybrid authority identities must be distinct.",
        );
      }
    }
    if (
      cloudDecision.synthesisSessionId !== null &&
      hybridDecision.synthesisSessionId !== null &&
      cloudDecision.synthesisSessionId === hybridDecision.synthesisSessionId
    ) {
      issue(
        context,
        ["synthesisDecisions", 2, "synthesisSessionId"],
        "Cloud and Hybrid synthesis sessions must be distinct.",
      );
    }
    if (
      cloudDecision.simulationCost.reservationId !== null &&
      hybridDecision.simulationCost.reservationId !== null &&
      cloudDecision.simulationCost.reservationId ===
        hybridDecision.simulationCost.reservationId
    ) {
      issue(
        context,
        ["synthesisDecisions", 2, "simulationCost", "reservationId"],
        "Cloud and Hybrid reservations must be distinct.",
      );
    }
    if (
      cloudDecision.requestBodySha256 !== null &&
      hybridDecision.requestBodySha256 !== null &&
      cloudDecision.requestBodySha256 !== hybridDecision.requestBodySha256
    ) {
      issue(
        context,
        ["synthesisDecisions", 2, "requestBodySha256"],
        "Cloud and Hybrid attempts must share the exact canonical request body.",
      );
    }
    if (
      comparison.fallbackState.state === "claimed" ||
      comparison.fallbackState.state === "completed"
    ) {
      const triggerDecision = comparison.synthesisDecisions.find(
        (decision) =>
          decision.slotId === comparison.fallbackState.triggerSlotId,
      );
      if (
        triggerDecision?.state !== "failed" ||
        triggerDecision.authoritySlotTerminalSha256 !==
          comparison.fallbackState.triggerTerminalSha256
      ) {
        issue(
          context,
          ["fallbackState", "triggerTerminalSha256"],
          "A claimed fallback must bind the failed triggering slot terminal.",
        );
      }
      if (
        comparison.synthesisDecisions[0].state !== "completed" ||
        comparison.synthesisDecisions[0].synthesisSessionId !==
          comparison.fallbackState.sourceSynthesisSessionId ||
        comparison.synthesisDecisions[0].reviewResultSha256 !==
          comparison.fallbackState.sourceReviewResultSha256
      ) {
        issue(
          context,
          ["fallbackState", "sourceReviewResultSha256"],
          "The fallback must reuse the exact completed Local synthesis result.",
        );
      }
    }
    if (
      comparison.fallbackState.state === "not_used" &&
      comparison.synthesisDecisions.some(
        (decision) => decision.state === "pending",
      )
    ) {
      issue(
        context,
        ["fallbackState", "state"],
        "A not-used fallback is terminal only after every synthesis slot is decided.",
      );
    }
  });

export type Pr6rComparisonV1 = z.infer<typeof Pr6rComparisonV1Schema>;

const numericIpv4Pattern =
  /(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?=$|[^0-9])/u;
const bracketedIpv6Pattern = /\[[0-9A-Fa-f:.%]+\](?::\d{1,5})?/u;
const rawIpv6Pattern =
  /(?:^|[^0-9A-Za-z])(?:[0-9A-Fa-f]{0,4}:){2,}[0-9A-Fa-f]{0,4}(?:%[0-9A-Za-z_.-]+)?(?=$|[^0-9A-Za-z])/u;
const highConfidenceCredentialPatterns = [
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/iu,
  /\b(?:sk|pk)-(?:or-v\d+-)?[A-Za-z0-9_-]{12,}\b/u,
  /\b(?:github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\b(?:(?:[A-Z][A-Z0-9_]{1,63}_)?(?:API_KEY|ACCESS_KEY|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY|SECRET|TOKEN|PASSWORD)|api[-_ ]?key|access[-_ ]?(?:key|token)|auth[-_ ]?token|private[-_ ]?key|secret|token|password)\s*(?:=|:)\s*["']?[^\s"',;]{16,}/iu,
] as const;

function containsHighConfidenceCredential(value: string): boolean {
  return highConfidenceCredentialPatterns.some((pattern) =>
    pattern.test(value),
  );
}

const pr6rAdmittedEvidencePaths = new Set<string>(PR6R_FIXTURE_CHANGED_PATHS);
const forbiddenSafeReviewTextPatterns = [
  /[\u0000-\u001f\u007f]/u,
  /\b[A-Za-z][A-Za-z0-9+.-]{1,31}:(?:\/\/)?[^\s]+/u,
  /(?:^|[^A-Za-z0-9._~+-])\/{1,2}[^\s/][^\s]*/u,
  /(?:^|[^A-Za-z0-9._~+-])(?:[A-Za-z]:[\\/]|\\\\[^\s\\]+\\)/u,
  numericIpv4Pattern,
  bracketedIpv6Pattern,
  rawIpv6Pattern,
  /(?:^|[^A-Za-z0-9._-])(?:localhost|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?):\d{1,5}(?=$|[^0-9])/iu,
  /(?:^|[^A-Za-z0-9._~-])(?:\.\.[\\/])+/u,
  /(?:^|[^A-Za-z0-9._~-])~[\\/][^\s]+/u,
  /\bHTTP\/\d(?:\.\d)?\b/iu,
  /\b(?:authorization|proxy-authorization|set-cookie|content-type|x-[a-z0-9-]+)\s*:/iu,
  /\bbearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /\braw\s+(?:request|response|error|diagnostic|envelope|body|headers?)\b/iu,
  /\benvelope\b/iu,
  /\b(?:stack\s+trace|traceback|canonicalBodyUtf8)\b/iu,
  /(?:^|[^A-Za-z0-9_])[\[{]\s*["']?[A-Za-z0-9_-]+["']?\s*:/u,
  ...highConfidenceCredentialPatterns,
] as const;

function rendererSafeReviewText(value: string): boolean {
  return forbiddenSafeReviewTextPatterns.every(
    (pattern) => !pattern.test(value),
  );
}

function rendererSafeEvidencePath(value: string): boolean {
  const segments = value.split("/");
  return (
    value.length > 0 &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !value.startsWith("/") &&
    !value.startsWith("~") &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !/%(?:2e|2f|5c)/iu.test(value) &&
    !numericIpv4Pattern.test(value) &&
    !bracketedIpv6Pattern.test(value) &&
    !rawIpv6Pattern.test(value) &&
    !containsHighConfidenceCredential(value) &&
    !/\benvelope\b/iu.test(value) &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    )
  );
}

function validateRendererSafeReviewResult(
  reviewResult: ReviewResultV1,
  context: RefinementContext,
): void {
  const textFields: Array<{ path: PropertyKey[]; value: string }> = [
    { path: ["reviewResult", "summary"], value: reviewResult.summary },
  ];
  reviewResult.omissions.forEach((omission, index) => {
    textFields.push(
      {
        path: ["reviewResult", "omissions", index, "code"],
        value: omission.code,
      },
      {
        path: ["reviewResult", "omissions", index, "description"],
        value: omission.description,
      },
    );
  });
  reviewResult.findings.forEach((finding, findingIndex) => {
    textFields.push(
      {
        path: ["reviewResult", "findings", findingIndex, "findingId"],
        value: finding.findingId,
      },
      {
        path: ["reviewResult", "findings", findingIndex, "title"],
        value: finding.title,
      },
      {
        path: ["reviewResult", "findings", findingIndex, "impact"],
        value: finding.impact,
      },
      {
        path: [
          "reviewResult",
          "findings",
          findingIndex,
          "suggestedCorrection",
        ],
        value: finding.suggestedCorrection,
      },
      {
        path: [
          "reviewResult",
          "findings",
          findingIndex,
          "suggestedTest",
        ],
        value: finding.suggestedTest,
      },
    );
    finding.evidence.forEach((reference, evidenceIndex) => {
      if (
        reference.kind === "repository" &&
        !rendererSafeReviewText(reference.observationId)
      ) {
        issue(
          context,
          [
            "reviewResult",
            "findings",
            findingIndex,
            "evidence",
            evidenceIndex,
            "observationId",
          ],
          "Renderer-safe repository observation IDs contain forbidden endpoint or credential material.",
        );
      }
      if (!rendererSafeEvidencePath(reference.path)) {
        issue(
          context,
          [
            "reviewResult",
            "findings",
            findingIndex,
            "evidence",
            evidenceIndex,
            "path",
          ],
          "Renderer-safe review evidence paths must remain relative and traversal-free.",
        );
      } else if (!pr6rAdmittedEvidencePaths.has(reference.path)) {
        issue(
          context,
          [
            "reviewResult",
            "findings",
            findingIndex,
            "evidence",
            evidenceIndex,
            "path",
          ],
          "Renderer-safe review evidence paths must belong to the frozen admitted change.",
        );
      }
    });
  });
  textFields.forEach((field) => {
    if (!rendererSafeReviewText(field.value)) {
      issue(
        context,
        field.path,
        "Renderer-safe review text contains forbidden transport, endpoint, path, credential, or diagnostic material.",
      );
    }
  });
}

const Pr6rCanonicalReviewOutputV1Schema = z
  .object({
    reviewResult: ReviewResultV1Schema,
    reviewResultSha256: Sha256Schema,
  })
  .strict()
  .superRefine((output, context) => {
    validateRendererSafeReviewResult(output.reviewResult, context);
    if (output.reviewResult.snapshotId !== PR6R_FIXTURE_SNAPSHOT_ID) {
      issue(
        context,
        ["reviewResult", "snapshotId"],
        "ReviewResultV1 must belong to the frozen PR6R snapshot.",
      );
    }
    if (
      sha256Hex(canonicalPr6rJsonV1(output.reviewResult)) !==
      output.reviewResultSha256
    ) {
      issue(
        context,
        ["reviewResultSha256"],
        "ReviewResultV1 canonical hash mismatch.",
      );
    }
  });

function safeProjectionDecisionSchema<
  SlotId extends "local_synthesis" | "cloud_synthesis" | "hybrid_cloud_if_selected",
>(slotId: SlotId, ordinal: 1 | 2 | 3) {
  const identityShape = {
    slotId: z.literal(slotId),
    ordinal: z.literal(ordinal),
  } as const;
  const loopback = slotId !== "local_synthesis";
  const completedCost = loopback
    ? Pr6rSafeSettledSimulationCostV1Schema
    : Pr6rSafeNotReservedSimulationCostV1Schema;
  const failedCost = loopback
    ? z.union([
        Pr6rSafeNotReservedSimulationCostV1Schema,
        Pr6rSafeSettledSimulationCostV1Schema,
        Pr6rSafeUnknownSimulationCostV1Schema,
      ])
    : Pr6rSafeNotReservedSimulationCostV1Schema;
  const failedReason = loopback
    ? loopbackFailedTerminalCode
    : localFailedTerminalCode;
  const cancelledReason = loopback
    ? loopbackCancelledTerminalCode
    : localCancelledTerminalCode;
  const pending = z
    .object({
      ...identityShape,
      state: z.literal("pending"),
      requestDisposition: z.null(),
      synthesisLatencyMs: z.null(),
      tokenAccounting: Pr6rUnreportedTokenAccountingV1Schema,
      simulationCost: Pr6rSafeNotReservedSimulationCostV1Schema,
      outputValidity: Pr6rUnavailableOutputValidityV1Schema,
      terminalReason: z.null(),
      output: z.null(),
    })
    .strict();
  const completed = z
    .object({
      ...identityShape,
      state: z.literal("completed"),
      requestDisposition: loopback ? z.literal("sent") : z.null(),
      synthesisLatencyMs: boundedDurationMs,
      tokenAccounting: Pr6rTokenAccountingV1Schema,
      simulationCost: completedCost,
      outputValidity: Pr6rPostSchemaValidityDeferredOutputValidityV1Schema,
      terminalReason: z.literal("completed"),
      output: Pr6rCanonicalReviewOutputV1Schema,
    })
    .strict();
  const failed = z
    .object({
      ...identityShape,
      state: z.literal("failed"),
      requestDisposition: loopback
        ? z.enum(["not_sent", "sent", "unknown"])
        : z.null(),
      synthesisLatencyMs: boundedDurationMs,
      tokenAccounting: Pr6rTokenAccountingV1Schema,
      simulationCost: failedCost,
      outputValidity: z.union([
        Pr6rUnavailableOutputValidityV1Schema,
        Pr6rSchemaRejectedOutputValidityV1Schema,
      ]),
      terminalReason: failedReason,
      output: z.null(),
    })
    .strict();
  const cancelled = z
    .object({
      ...identityShape,
      state: z.literal("cancelled"),
      requestDisposition: loopback
        ? z.enum(["not_sent", "unknown"])
        : z.null(),
      synthesisLatencyMs: boundedDurationMs,
      tokenAccounting: Pr6rTokenAccountingV1Schema,
      simulationCost: failedCost,
      outputValidity: Pr6rUnavailableOutputValidityV1Schema,
      terminalReason: cancelledReason,
      output: z.null(),
    })
    .strict();
  const notSelected = z
    .object({
      ...identityShape,
      state: z.literal("not_selected"),
      requestDisposition: z.null(),
      synthesisLatencyMs: z.null(),
      tokenAccounting: Pr6rUnreportedTokenAccountingV1Schema,
      simulationCost: Pr6rSafeNotReservedSimulationCostV1Schema,
      outputValidity: Pr6rUnavailableOutputValidityV1Schema,
      terminalReason: z.literal("route.not_selected"),
      output: z.null(),
    })
    .strict();
  return z
    .discriminatedUnion("state", [
      pending,
      completed,
      failed,
      cancelled,
      notSelected,
    ])
    .superRefine((decision, context) => {
      validateDecisionSimulationEvidence(decision, context);
      if (
        loopback &&
        (decision.state === "failed" || decision.state === "cancelled")
      ) {
        validateLoopbackTerminalEvidence(
          decision as typeof decision & {
            state: "failed" | "cancelled";
            requestDisposition: "not_sent" | "sent" | "unknown";
          },
          context,
        );
      }
      if (
        decision.state === "not_selected" &&
        slotId !== "hybrid_cloud_if_selected"
      ) {
        issue(
          context,
          ["state"],
          "Only the conditional Hybrid slot may be not selected.",
        );
      }
    });
}

const Pr6rLocalSafeProjectionDecisionV1Schema = safeProjectionDecisionSchema(
  "local_synthesis",
  1,
);
const Pr6rCloudSafeProjectionDecisionV1Schema = safeProjectionDecisionSchema(
  "cloud_synthesis",
  2,
);
const Pr6rHybridSafeProjectionDecisionV1Schema = safeProjectionDecisionSchema(
  "hybrid_cloud_if_selected",
  3,
);

const Pr6rSafeAuthorityClaimV1Schema = z
  .object({
    authorityClaimId: z.literal(PR6R_OS_AUTHORITY_CLAIM_ID),
    authorityClaimSha256: Sha256Schema,
    implementationRevision: canonicalImplementationRevision,
    storageScope: z.literal("os_user_local"),
    claimedAt: canonicalTimestamp,
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
  })
  .strict();
const Pr6rSafeProviderValidationV1Schema = z
  .object({
    validationId: z.literal(PR6R_PROVIDER_VALIDATION_ID),
    validationSha256: Sha256Schema,
    syntheticProviderId: z.literal(PR6R_SYNTHETIC_PROVIDER_ID),
    implementationRevision: canonicalImplementationRevision,
    model: z.literal(PR6R_MODEL_SLUG),
    upstreamSlug: z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG),
    providerKind: z.literal("synthetic_loopback"),
    transport: z.literal("loopback_only"),
    validationOutcome: z.literal("accepted"),
    validatedAt: canonicalTimestamp,
    externalProviderContact: z.literal(false),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
  })
  .strict();
const Pr6rSafePricingSnapshotV1Schema = z
  .object({
    pricingSnapshotId: z.literal(PR6R_SIMULATION_PRICING_SNAPSHOT_ID),
    pricingSnapshotSha256: Sha256Schema,
    providerValidationId: z.literal(PR6R_PROVIDER_VALIDATION_ID),
    providerValidationSha256: Sha256Schema,
    implementationRevision: canonicalImplementationRevision,
    model: z.literal(PR6R_MODEL_SLUG),
    upstreamSlug: z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG),
    currency: z.literal("USD"),
    rateUnit: z.literal("microusd_per_million_tokens"),
    inputRateMicrousdPerMillion: z.literal(
      PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
    ),
    outputRateMicrousdPerMillion: z.literal(
      PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
    ),
    cacheReadRateMicrousdPerMillion: z.literal(0),
    cacheWriteRateMicrousdPerMillion: z.literal(0),
    reasoningBilling: z.literal("included_in_output"),
    source: z.literal("synthetic_fixed_v1"),
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(0),
  })
  .strict();
const Pr6rSafeCommonInvestigationV1Schema = z
  .object({
    investigationId: z.literal(PR6R_COMMON_INVESTIGATION_ID),
    investigationSha256: Sha256Schema,
    implementationRevision: canonicalImplementationRevision,
    durationMs: boundedDurationMs,
    toolCallCount: z
      .number()
      .int()
      .nonnegative()
      .safe()
      .max(PR6R_MAX_COMMON_TOOL_CALLS),
    terminalReason: z.literal("completed"),
  })
  .strict();

const safeFallbackIdentityShape = {
  schemaVersion: z.literal("pr6r-safe-campaign-fallback-state-v1"),
  fallbackId: z.literal(PR6R_CAMPAIGN_FALLBACK_ID),
  campaignId: z.literal(PR6R_CAMPAIGN_ID),
  implementationRevision: canonicalImplementationRevision,
  costScope: z.literal(PR6R_COST_SCOPE),
  actualPaidAuthority: z.literal(false),
  actualExternalSpendMicrousd: z.literal(0),
} as const;
const safeFallbackTriggerShape = {
  triggerSlotId: z.enum([
    "cloud_synthesis",
    "hybrid_cloud_if_selected",
  ]),
  triggerTerminalSha256: Sha256Schema,
  fallbackClaimSha256: Sha256Schema,
  claimedAt: canonicalTimestamp,
  resolution: z.literal("reuse_local_synthesis"),
  sourceSlotId: z.literal("local_synthesis"),
  sourceReviewResultSha256: Sha256Schema,
} as const;
const Pr6rSafeAvailableFallbackStateV1Schema = z
  .object({
    ...safeFallbackIdentityShape,
    state: z.literal("available"),
    triggerSlotId: z.null(),
    triggerTerminalSha256: z.null(),
    fallbackClaimSha256: z.null(),
    claimedAt: z.null(),
    resolution: z.null(),
    sourceSlotId: z.null(),
    sourceReviewResultSha256: z.null(),
    terminalAt: z.null(),
    terminalReason: z.null(),
  })
  .strict();
const Pr6rSafeClaimedFallbackStateV1Schema = z
  .object({
    ...safeFallbackIdentityShape,
    ...safeFallbackTriggerShape,
    state: z.literal("claimed"),
    terminalAt: z.null(),
    terminalReason: z.literal("fallback.claimed"),
  })
  .strict();
const Pr6rSafeCompletedFallbackStateV1Schema = z
  .object({
    ...safeFallbackIdentityShape,
    ...safeFallbackTriggerShape,
    state: z.literal("completed"),
    terminalAt: canonicalTimestamp,
    terminalReason: z.literal("fallback.local_result_reused"),
  })
  .strict()
  .superRefine((fallback, context) => {
    if (fallback.terminalAt < fallback.claimedAt) {
      issue(
        context,
        ["terminalAt"],
        "Safe fallback completion cannot predate its durable claim.",
      );
    }
  });
const Pr6rSafeNotUsedFallbackStateV1Schema = z
  .object({
    ...safeFallbackIdentityShape,
    state: z.literal("not_used"),
    triggerSlotId: z.null(),
    triggerTerminalSha256: z.null(),
    fallbackClaimSha256: z.null(),
    claimedAt: z.null(),
    resolution: z.null(),
    sourceSlotId: z.null(),
    sourceReviewResultSha256: z.null(),
    terminalAt: z.null(),
    terminalReason: z.literal("fallback.not_used"),
  })
  .strict();

export const Pr6rSafeCampaignFallbackStateV1Schema = z.discriminatedUnion(
  "state",
  [
    Pr6rSafeAvailableFallbackStateV1Schema,
    Pr6rSafeClaimedFallbackStateV1Schema,
    Pr6rSafeCompletedFallbackStateV1Schema,
    Pr6rSafeNotUsedFallbackStateV1Schema,
  ],
);
export type Pr6rSafeCampaignFallbackStateV1 = z.infer<
  typeof Pr6rSafeCampaignFallbackStateV1Schema
>;

/** Remove the internal Local child-session identity from renderer-safe state. */
export function projectPr6rSafeCampaignFallbackStateV1(
  value: unknown,
): Pr6rSafeCampaignFallbackStateV1 {
  const fallback = Pr6rCampaignFallbackStateV1Schema.parse(value);
  const {
    sourceSynthesisSessionId: _sourceSynthesisSessionId,
    schemaVersion: _schemaVersion,
    ...safeFallback
  } = fallback;
  return deepFreeze(
    Pr6rSafeCampaignFallbackStateV1Schema.parse({
      ...safeFallback,
      schemaVersion: "pr6r-safe-campaign-fallback-state-v1",
    }),
  );
}

/**
 * Persisted/renderer-safe result surface. Strict schemas intentionally leave no
 * field for request bytes, HTTP envelopes, headers, raw errors, or exceptions.
 */
export const Pr6rSafeProjectionV1Schema = z
  .object({
    schemaVersion: z.literal("pr6r-safe-projection-v1"),
    campaignId: z.literal(PR6R_CAMPAIGN_ID),
    implementationRevision: canonicalImplementationRevision,
    fixtureId: z.literal(PR6R_FIXTURE_ID),
    snapshotId: z.literal(PR6R_FIXTURE_SNAPSHOT_ID),
    commonCheckpointSha256: Sha256Schema,
    packetSha256: Sha256Schema,
    semanticMessagesSha256: Sha256Schema,
    outputContractSha256: z.literal(
      REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
    ),
    osAuthorityClaim: Pr6rSafeAuthorityClaimV1Schema,
    providerValidation: Pr6rSafeProviderValidationV1Schema,
    pricingSnapshot: Pr6rSafePricingSnapshotV1Schema,
    commonInvestigation: Pr6rSafeCommonInvestigationV1Schema,
    fallbackState: Pr6rSafeCampaignFallbackStateV1Schema,
    costScope: z.literal(PR6R_COST_SCOPE),
    actualPaidAuthority: z.literal(false),
    actualExternalSpendMicrousd: z.literal(
      PR6R_MAX_ACTUAL_EXTERNAL_SPEND_MICROUSD,
    ),
    synthesisDecisions: z.tuple([
      Pr6rLocalSafeProjectionDecisionV1Schema,
      Pr6rCloudSafeProjectionDecisionV1Schema,
      Pr6rHybridSafeProjectionDecisionV1Schema,
    ]),
  })
  .strict()
  .superRefine((projection, context) => {
    const revisionBindings = [
      ["osAuthorityClaim", projection.osAuthorityClaim.implementationRevision],
      ["providerValidation", projection.providerValidation.implementationRevision],
      ["pricingSnapshot", projection.pricingSnapshot.implementationRevision],
      ["commonInvestigation", projection.commonInvestigation.implementationRevision],
      ["fallbackState", projection.fallbackState.implementationRevision],
    ] as const;
    revisionBindings.forEach(([field, revision]) => {
      if (revision !== projection.implementationRevision) {
        issue(
          context,
          [field, "implementationRevision"],
          "Safe evidence must bind the exact implementation revision.",
        );
      }
    });
    if (
      projection.pricingSnapshot.providerValidationSha256 !==
      projection.providerValidation.validationSha256
    ) {
      issue(
        context,
        ["pricingSnapshot", "providerValidationSha256"],
        "The safe simulation price must bind the safe provider validation.",
      );
    }
    projection.synthesisDecisions.forEach((decision, index) => {
      if (
        decision.simulationCost.pricingSnapshotSha256 !==
        projection.pricingSnapshot.pricingSnapshotSha256
      ) {
        issue(
          context,
          ["synthesisDecisions", index, "simulationCost", "pricingSnapshotSha256"],
          "Every safe simulated cost must bind the safe price snapshot.",
        );
      }
    });
  });

export type Pr6rSafeProjectionV1 = z.infer<
  typeof Pr6rSafeProjectionV1Schema
>;

export function canonicalPr6rReviewResultSha256(value: unknown): string {
  const reviewResult = ReviewResultV1Schema.parse(value);
  return sha256Hex(canonicalPr6rJsonV1(reviewResult));
}

export function canonicalPr6rReviewResult(value: unknown): ReviewResultV1 {
  return deepFreeze(ReviewResultV1Schema.parse(value));
}
