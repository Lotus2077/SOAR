import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PR6R_FIXTURE_SNAPSHOT_ID,
  PR6R_MODEL_SLUG,
  PR6R_REQUESTED_OUTPUT_TOKENS,
  PR6R_SYNTHETIC_UPSTREAM_SLUG,
  buildPr6rCommonCheckpointV1,
  canonicalPr6rJsonV1,
  canonicalPr6rReviewResultSha256,
  sealCloudApplicationRequestV1,
  type CloudApplicationRequestV1,
} from "../../src/shared/pr6r-development-contracts";
import { reviewResultV1ResponseFormat } from "../../src/shared/review-result-contract";
import {
  PR6R_MAX_LOOPBACK_EMPTY_CONTENT_ENVELOPE_BYTES,
  PR6R_MAX_LOOPBACK_RESPONSE_BYTES,
  Pr6rLoopbackResponseError,
  buildCanonicalPr6rLoopbackResponseBody,
  parsePr6rLoopbackResponse,
} from "../../src/main/pr6r-development/loopback-response";

const PACKET_UTF8 = canonicalPr6rJsonV1({ fixture: "cal-007" });

function applicationBody() {
  return {
    model: PR6R_MODEL_SLUG,
    messages: [
      { role: "system" as const, content: "Review the frozen change." },
      { role: "user" as const, content: "Return the strict result." },
    ],
    max_completion_tokens: PR6R_REQUESTED_OUTPUT_TOKENS,
    temperature: 0,
    stream: false,
    response_format: reviewResultV1ResponseFormat(),
    provider: {
      only: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
      order: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
      allow_fallbacks: false,
      require_parameters: true,
    },
  };
}

function sealedRequest(): CloudApplicationRequestV1 {
  const body = applicationBody();
  const checkpoint = buildPr6rCommonCheckpointV1({
    parentSessionId: "parent-session",
    packetUtf8: PACKET_UTF8,
    semanticMessages: body.messages,
  });
  return sealCloudApplicationRequestV1({
    requestId: "request-loopback-response",
    parentSessionId: "parent-session",
    synthesisSessionId: "synthesis-session",
    attemptId: "attempt-loopback-response",
    slotId: "cloud_synthesis",
    commonCheckpoint: checkpoint,
    packetUtf8: PACKET_UTF8,
    origin: "http://127.0.0.1:43123",
    body,
  });
}

function reviewResult() {
  return {
    schemaVersion: "change-review-result-v1" as const,
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    summary: "No blocking finding was found.",
    conclusion: "no_blocking_findings" as const,
    evidenceSetId: "e".repeat(64),
    omissions: [],
    findings: [],
  };
}

function validBody(request = sealedRequest()): Uint8Array {
  return buildCanonicalPr6rLoopbackResponseBody({
    requestId: request.requestId,
    content: canonicalPr6rJsonV1(reviewResult()),
    promptTokens: request.estimatedInputTokens,
    completionTokens: 17,
    cachedTokens: 3,
    reasoningTokens: 5,
  });
}

type LoopbackParseInput = Parameters<typeof parsePr6rLoopbackResponse>[0] & {
  readonly applicationRequest: CloudApplicationRequestV1;
};

function parseInput(
  overrides: Partial<Parameters<typeof parsePr6rLoopbackResponse>[0]> = {},
): LoopbackParseInput {
  const applicationRequest = sealedRequest();
  const body = validBody(applicationRequest);
  return {
    applicationRequest,
    statusCode: 200,
    rawHeaders: [
      "Content-Type",
      "application/json",
      "Content-Length",
      String(body.byteLength),
    ],
    rawTrailers: [],
    informationalResponseCount: 0,
    body,
    ...overrides,
  } as LoopbackParseInput;
}

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Expected loopback response parsing to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(Pr6rLoopbackResponseError);
    expect(error).toMatchObject({ code });
  }
}

describe("PR6R strict loopback response", () => {
  it("derives the frozen empty-envelope and complete-response byte ceilings", () => {
    expect(PR6R_MAX_LOOPBACK_EMPTY_CONTENT_ENVELOPE_BYTES).toBe(519);
    expect(PR6R_MAX_LOOPBACK_RESPONSE_BYTES).toBe(524_807);
  });

  it("parses canonical bytes and normalizes visible output apart from reasoning", () => {
    const input = parseInput();
    const parsed = parsePr6rLoopbackResponse(input);
    expect(parsed).toMatchObject({
      schemaVersion: "pr6r-loopback-chat-completion-response-v1",
      requestId: input.applicationRequest.requestId,
      reviewResult: reviewResult(),
      usage: {
        inputTokens: input.applicationRequest.estimatedInputTokens,
        cacheReadTokens: 3,
        cacheWriteTokens: 0,
        reasoningTokens: 5,
        outputTokens: 12,
        totalTokens: input.applicationRequest.estimatedInputTokens + 17,
      },
      responseBodySha256: createHash("sha256")
        .update(input.body)
        .digest("hex"),
      reviewResultSha256: canonicalPr6rReviewResultSha256(reviewResult()),
    });
    expect(parsed).not.toHaveProperty("content");
  });

  it("requires exact raw framing and rejects HTTP, duplicate, encoded, and trailer responses", () => {
    expectCode(
      () => parsePr6rLoopbackResponse(parseInput({ statusCode: 302 })),
      "loopback.http_error",
    );
    for (const rawHeaders of [
      ["Content-Type", "application/json"],
      [
        "Content-Type",
        "application/json",
        "Content-Type",
        "application/json",
        "Content-Length",
        String(validBody().byteLength),
      ],
      [
        "Content-Type",
        "application/json; charset=utf-8",
        "Content-Length",
        String(validBody().byteLength),
      ],
      [
        "Content-Type",
        "application/json",
        "Content-Length",
        `0${validBody().byteLength}`,
      ],
      [
        "Content-Type",
        "application/json",
        "Content-Length",
        String(validBody().byteLength),
        "Transfer-Encoding",
        "chunked",
      ],
      [
        "Content-Type",
        "application/json",
        "Content-Length",
        String(validBody().byteLength),
        "Content-Encoding",
        "gzip",
      ],
    ]) {
      expectCode(
        () => parsePr6rLoopbackResponse(parseInput({ rawHeaders })),
        "loopback.protocol_invalid",
      );
    }
    expectCode(
      () =>
        parsePr6rLoopbackResponse(
          parseInput({ rawTrailers: ["X-Trailer", "present"] }),
        ),
      "loopback.protocol_invalid",
    );
    expectCode(
      () =>
        parsePr6rLoopbackResponse(
          parseInput({ informationalResponseCount: 1 }),
        ),
      "loopback.protocol_invalid",
    );
  });

  it("rejects oversized and non-UTF-8 bodies without claiming a body hash", () => {
    try {
      parsePr6rLoopbackResponse(
        parseInput({ body: new Uint8Array(PR6R_MAX_LOOPBACK_RESPONSE_BYTES + 1) }),
      );
      throw new Error("Expected the oversized response to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "loopback.response_too_large",
        responseBodySha256: undefined,
      });
    }

    const body = new Uint8Array([0xc3, 0x28]);
    expectCode(
      () =>
        parsePr6rLoopbackResponse(
          parseInput({
            body,
            rawHeaders: [
              "Content-Type",
              "application/json",
              "Content-Length",
              String(body.byteLength),
            ],
          }),
        ),
      "loopback.response_malformed",
    );
  });

  it("rejects noncanonical envelopes, extra fields, identity drift, and invalid ReviewResult", () => {
    const base = parseInput();
    const raw = new TextDecoder().decode(base.body);
    const withWhitespace = new TextEncoder().encode(`${raw}\n`);
    expectCode(
      () =>
        parsePr6rLoopbackResponse(
          parseInput({
            body: withWhitespace,
            rawHeaders: [
              "Content-Type",
              "application/json",
              "Content-Length",
              String(withWhitespace.byteLength),
            ],
          }),
        ),
      "loopback.response_malformed",
    );

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [mutation, code] of [
      [{ ...parsed, extra: true }, "loopback.protocol_invalid"],
      [{ ...parsed, model: "different/model" }, "loopback.model_mismatch"],
      [{ ...parsed, id: "different-request" }, "loopback.protocol_invalid"],
      [
        {
          ...parsed,
          usage: {
            ...(parsed.usage as Record<string, unknown>),
            prompt_tokens: base.applicationRequest.estimatedInputTokens + 1,
          },
        },
        "loopback.usage_invalid",
      ],
    ] as const) {
      const body = new TextEncoder().encode(canonicalPr6rJsonV1(mutation));
      expectCode(
        () =>
          parsePr6rLoopbackResponse(
            parseInput({
              body,
              rawHeaders: [
                "Content-Type",
                "application/json",
                "Content-Length",
                String(body.byteLength),
              ],
            }),
          ),
        code,
      );
    }

    const invalidResultBody = buildCanonicalPr6rLoopbackResponseBody({
      requestId: base.applicationRequest.requestId,
      content: "{}",
      promptTokens: base.applicationRequest.estimatedInputTokens,
      completionTokens: 1,
    });
    try {
      parsePr6rLoopbackResponse(
        parseInput({
          body: invalidResultBody,
          rawHeaders: [
            "Content-Type",
            "application/json",
            "Content-Length",
            String(invalidResultBody.byteLength),
          ],
        }),
      );
      throw new Error("Expected invalid ReviewResult content to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "loopback.review_result_invalid",
        usage: {
          inputTokens: base.applicationRequest.estimatedInputTokens,
          outputTokens: 1,
          reasoningTokens: 0,
        },
      });
    }
  });
});
