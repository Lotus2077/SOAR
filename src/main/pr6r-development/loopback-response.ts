import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CloudApplicationRequestV1Schema,
  PR6R_MAX_ADMITTED_INPUT_TOKENS,
  PR6R_MODEL_SLUG,
  PR6R_REQUESTED_OUTPUT_TOKENS,
  PR6R_SYNTHETIC_UPSTREAM_SLUG,
  canonicalPr6rJsonV1,
  canonicalPr6rReviewResult,
  canonicalPr6rReviewResultSha256,
  type CloudApplicationRequestV1,
} from "../../shared/pr6r-development-contracts";
import {
  REVIEW_RESULT_V1_LIMITS,
  parseRawReviewResultV1,
  type ReviewResultV1,
} from "../../shared/review-result-contract";

export const PR6R_LOOPBACK_RESPONSE_SCHEMA_VERSION =
  "pr6r-loopback-chat-completion-response-v1" as const;
export const PR6R_MAX_LOOPBACK_HEADER_BYTES = 8_192 as const;

const utf8Encoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_REQUEST_ID_CHARACTERS = 128;

const nonNegativeSafeInteger = z.number().int().nonnegative().safe();
const usageSchema = z
  .object({
    completion_tokens: nonNegativeSafeInteger.max(
      PR6R_REQUESTED_OUTPUT_TOKENS,
    ),
    completion_tokens_details: z
      .object({
        reasoning_tokens: nonNegativeSafeInteger.max(
          PR6R_REQUESTED_OUTPUT_TOKENS,
        ),
      })
      .strict(),
    prompt_tokens: nonNegativeSafeInteger.max(
      PR6R_MAX_ADMITTED_INPUT_TOKENS,
    ),
    prompt_tokens_details: z
      .object({
        cached_tokens: nonNegativeSafeInteger.max(
          PR6R_MAX_ADMITTED_INPUT_TOKENS,
        ),
      })
      .strict(),
    total_tokens: nonNegativeSafeInteger.max(
      PR6R_MAX_ADMITTED_INPUT_TOKENS + PR6R_REQUESTED_OUTPUT_TOKENS,
    ),
  })
  .strict();

const responseEnvelopeSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            finish_reason: z.literal("stop"),
            index: z.literal(0),
            message: z
              .object({
                content: z.string(),
                role: z.literal("assistant"),
              })
              .strict(),
          })
          .strict(),
      )
      .length(1),
    created: z.literal(0),
    id: z.string().min(1).max(MAX_REQUEST_ID_CHARACTERS),
    model: z.literal(PR6R_MODEL_SLUG),
    object: z.literal("chat.completion"),
    provider: z.literal(PR6R_SYNTHETIC_UPSTREAM_SLUG),
    usage: usageSchema,
  })
  .strict();

export type Pr6rLoopbackResponseEnvelope = z.infer<
  typeof responseEnvelopeSchema
>;

const maximumEmptyContentEnvelope = responseEnvelopeSchema.parse({
  choices: [
    {
      finish_reason: "stop",
      index: 0,
      message: { content: "", role: "assistant" },
    },
  ],
  created: 0,
  id: "r".repeat(MAX_REQUEST_ID_CHARACTERS),
  model: PR6R_MODEL_SLUG,
  object: "chat.completion",
  provider: PR6R_SYNTHETIC_UPSTREAM_SLUG,
  usage: {
    completion_tokens: PR6R_REQUESTED_OUTPUT_TOKENS,
    completion_tokens_details: {
      reasoning_tokens: PR6R_REQUESTED_OUTPUT_TOKENS,
    },
    prompt_tokens: PR6R_MAX_ADMITTED_INPUT_TOKENS,
    prompt_tokens_details: {
      cached_tokens: PR6R_MAX_ADMITTED_INPUT_TOKENS,
    },
    total_tokens:
      PR6R_MAX_ADMITTED_INPUT_TOKENS + PR6R_REQUESTED_OUTPUT_TOKENS,
  },
});

export const PR6R_MAX_LOOPBACK_EMPTY_CONTENT_ENVELOPE_BYTES =
  utf8Encoder.encode(canonicalPr6rJsonV1(maximumEmptyContentEnvelope))
    .byteLength;

if (PR6R_MAX_LOOPBACK_EMPTY_CONTENT_ENVELOPE_BYTES !== 519) {
  throw new Error("PR6R loopback response envelope bound drifted from 519 bytes.");
}

export const PR6R_MAX_LOOPBACK_RESPONSE_BYTES =
  PR6R_MAX_LOOPBACK_EMPTY_CONTENT_ENVELOPE_BYTES +
  2 * REVIEW_RESULT_V1_LIMITS.maxRawOutputBytes;

if (PR6R_MAX_LOOPBACK_RESPONSE_BYTES !== 524_807) {
  throw new Error("PR6R loopback response bound drifted from 524807 bytes.");
}

export type Pr6rLoopbackSentFailureCode =
  | "loopback.http_error"
  | "loopback.response_too_large"
  | "loopback.response_malformed"
  | "loopback.model_mismatch"
  | "loopback.protocol_invalid"
  | "loopback.usage_invalid"
  | "loopback.review_result_invalid"
  | "loopback.invalid_response";

export class Pr6rLoopbackResponseError extends Error {
  readonly requestDisposition = "sent" as const;

  constructor(
    readonly code: Pr6rLoopbackSentFailureCode,
    readonly responseBodySha256?: string,
    readonly usage?: Pr6rLoopbackNormalizedUsage,
  ) {
    super(code);
    this.name = "Pr6rLoopbackResponseError";
  }
}

export interface Pr6rLoopbackNormalizedUsage {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: 0;
  readonly reasoningTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface Pr6rParsedLoopbackResponse {
  readonly schemaVersion: typeof PR6R_LOOPBACK_RESPONSE_SCHEMA_VERSION;
  readonly requestId: string;
  readonly reviewResult: ReviewResultV1;
  readonly usage: Pr6rLoopbackNormalizedUsage;
  readonly responseBodySha256: string;
  readonly reviewResultSha256: string;
}

export interface ParsePr6rLoopbackResponseInput {
  readonly applicationRequest: unknown;
  readonly statusCode: number;
  readonly rawHeaders: readonly string[];
  readonly rawTrailers?: readonly string[];
  readonly informationalResponseCount?: number;
  readonly body: Uint8Array;
}

export function sha256Pr6rLoopbackBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(
  code: Pr6rLoopbackSentFailureCode,
  responseBodySha256?: string,
  usage?: Pr6rLoopbackNormalizedUsage,
): never {
  throw new Pr6rLoopbackResponseError(code, responseBodySha256, usage);
}

function parseRawHeaderPairs(
  rawHeaders: readonly string[],
  responseBodySha256: string,
): ReadonlyMap<string, readonly string[]> {
  if (rawHeaders.length % 2 !== 0) {
    fail("loopback.protocol_invalid", responseBodySha256);
  }
  let encodedBytes = 2;
  const values = new Map<string, string[]>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name === undefined || value === undefined) {
      fail("loopback.protocol_invalid", responseBodySha256);
    }
    encodedBytes += utf8Encoder.encode(name).byteLength;
    encodedBytes += utf8Encoder.encode(value).byteLength + 4;
    const normalized = name.toLowerCase();
    const prior = values.get(normalized);
    if (prior === undefined) values.set(normalized, [value]);
    else prior.push(value);
  }
  if (encodedBytes > PR6R_MAX_LOOPBACK_HEADER_BYTES) {
    fail("loopback.protocol_invalid", responseBodySha256);
  }
  return values;
}

function validateFraming(
  input: ParsePr6rLoopbackResponseInput,
  responseBodySha256: string,
): void {
  if (
    (input.informationalResponseCount ?? 0) !== 0 ||
    (input.rawTrailers?.length ?? 0) !== 0
  ) {
    fail("loopback.protocol_invalid", responseBodySha256);
  }
  const headers = parseRawHeaderPairs(input.rawHeaders, responseBodySha256);
  const contentTypes = headers.get("content-type") ?? [];
  const contentLengths = headers.get("content-length") ?? [];
  if (
    contentTypes.length !== 1 ||
    contentTypes[0] !== "application/json" ||
    contentLengths.length !== 1 ||
    !/^(?:0|[1-9][0-9]*)$/u.test(contentLengths[0] ?? "") ||
    Number(contentLengths[0]) !== input.body.byteLength
  ) {
    fail("loopback.protocol_invalid", responseBodySha256);
  }
  for (const forbidden of [
    "transfer-encoding",
    "content-encoding",
    "upgrade",
    "trailer",
  ]) {
    if (headers.has(forbidden)) {
      fail("loopback.protocol_invalid", responseBodySha256);
    }
  }
}

function parseEnvelope(
  rawBody: string,
  responseBodySha256: string,
): Pr6rLoopbackResponseEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    fail("loopback.response_malformed", responseBodySha256);
  }
  const envelope = responseEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    const candidate =
      parsed !== null && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : undefined;
    if (candidate?.model !== undefined && candidate.model !== PR6R_MODEL_SLUG) {
      fail("loopback.model_mismatch", responseBodySha256);
    }
    if (candidate?.usage !== undefined && !usageSchema.safeParse(candidate.usage).success) {
      fail("loopback.usage_invalid", responseBodySha256);
    }
    fail("loopback.protocol_invalid", responseBodySha256);
  }
  if (canonicalPr6rJsonV1(envelope.data) !== rawBody) {
    fail("loopback.response_malformed", responseBodySha256);
  }
  return envelope.data;
}

function normalizeUsage(
  request: CloudApplicationRequestV1,
  envelope: Pr6rLoopbackResponseEnvelope,
  responseBodySha256: string,
): Pr6rLoopbackNormalizedUsage {
  const usage = envelope.usage;
  const cachedTokens = usage.prompt_tokens_details.cached_tokens;
  const reasoningTokens =
    usage.completion_tokens_details.reasoning_tokens;
  if (
    usage.prompt_tokens !== request.estimatedInputTokens ||
    cachedTokens > usage.prompt_tokens ||
    reasoningTokens > usage.completion_tokens ||
    usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens
  ) {
    fail("loopback.usage_invalid", responseBodySha256);
  }
  return Object.freeze({
    inputTokens: usage.prompt_tokens,
    cacheReadTokens: cachedTokens,
    cacheWriteTokens: 0 as const,
    reasoningTokens,
    outputTokens: usage.completion_tokens - reasoningTokens,
    totalTokens: usage.total_tokens,
  });
}

/** Parse only a complete bounded body obtained from the direct loopback transport. */
export function parsePr6rLoopbackResponse(
  input: ParsePr6rLoopbackResponseInput,
): Pr6rParsedLoopbackResponse {
  const requestResult = CloudApplicationRequestV1Schema.safeParse(
    input.applicationRequest,
  );
  if (!requestResult.success) fail("loopback.protocol_invalid");
  if (!(input.body instanceof Uint8Array)) fail("loopback.invalid_response");
  if (input.body.byteLength > PR6R_MAX_LOOPBACK_RESPONSE_BYTES) {
    fail("loopback.response_too_large");
  }
  const responseBodySha256 = sha256Pr6rLoopbackBytes(input.body);
  if (input.statusCode !== 200) {
    fail("loopback.http_error", responseBodySha256);
  }
  validateFraming(input, responseBodySha256);
  let rawBody: string;
  try {
    rawBody = fatalUtf8Decoder.decode(input.body);
  } catch {
    fail("loopback.response_malformed", responseBodySha256);
  }
  const envelope = parseEnvelope(rawBody, responseBodySha256);
  const request = requestResult.data;
  if (envelope.id !== request.requestId) {
    fail("loopback.protocol_invalid", responseBodySha256);
  }
  const usage = normalizeUsage(request, envelope, responseBodySha256);
  const content = envelope.choices[0]?.message.content;
  if (content === undefined) {
    fail("loopback.protocol_invalid", responseBodySha256);
  }
  let reviewResult: ReviewResultV1;
  try {
    reviewResult = canonicalPr6rReviewResult(parseRawReviewResultV1(content));
  } catch {
    fail("loopback.review_result_invalid", responseBodySha256, usage);
  }
  return Object.freeze({
    schemaVersion: PR6R_LOOPBACK_RESPONSE_SCHEMA_VERSION,
    requestId: request.requestId,
    reviewResult,
    usage,
    responseBodySha256,
    reviewResultSha256: canonicalPr6rReviewResultSha256(reviewResult),
  });
}

/** Build exact canonical fixture bytes through the same strict envelope schema. */
export function buildCanonicalPr6rLoopbackResponseBody(input: {
  readonly requestId: string;
  readonly content: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
}): Uint8Array {
  const envelope = responseEnvelopeSchema.parse({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message: { content: input.content, role: "assistant" },
      },
    ],
    created: 0,
    id: input.requestId,
    model: PR6R_MODEL_SLUG,
    object: "chat.completion",
    provider: PR6R_SYNTHETIC_UPSTREAM_SLUG,
    usage: {
      completion_tokens: input.completionTokens,
      completion_tokens_details: {
        reasoning_tokens: input.reasoningTokens ?? 0,
      },
      prompt_tokens: input.promptTokens,
      prompt_tokens_details: { cached_tokens: input.cachedTokens ?? 0 },
      total_tokens: input.promptTokens + input.completionTokens,
    },
  });
  return utf8Encoder.encode(canonicalPr6rJsonV1(envelope));
}
