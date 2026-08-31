import { describe, expect, it, vi } from "vitest";

import { deriveReviewCoverageV1 } from "../../src/main/change-acquisition-contracts";
import {
  FAKE_CLOUD_REVIEW_MODEL,
  createFakeCloudReviewProviderV1,
  isFakeCloudReviewProviderV1,
  type FakeCloudReviewScenarioV1,
} from "../../src/main/providers/fake-cloud-review-provider";
import { compileReviewContextV1 } from "../../src/main/review-context-compiler-v1";
import { deriveVerifiedReviewEvidenceV1 } from "../../src/main/review-event-provenance";
import {
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  parseAndAcceptRawReviewResultV1,
} from "../../src/shared/review-result-contract";
import { reviewFixtureEvents } from "../helpers/review-event-fixture";

const PRICING_AT = "2026-09-01T00:00:00.000Z";

function compiledReviewMessages() {
  return compileReviewContextV1({
    objective: "Review the current changes for concrete defects.",
    verifiedEvidence: deriveVerifiedReviewEvidenceV1(reviewFixtureEvents()),
    systemPrompt: "Follow the deterministic test review policy.",
    maxInputTokens: 1_000_000,
  });
}

function provider(scenario: FakeCloudReviewScenarioV1 = "success") {
  return createFakeCloudReviewProviderV1({
    pricingVerifiedAt: PRICING_AT,
    delayMs: 0,
    scenario,
  });
}

function input() {
  const compiled = compiledReviewMessages();
  return {
    compiled,
    request: {
      messages: [...compiled.messages],
      signal: new AbortController().signal,
      allowTools: false as const,
      structuredOutputContract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      onDelta: vi.fn(),
    },
  };
}

describe("FakeCloudReviewProviderV1", () => {
  it("is a nominally branded, metered, tool-free fake with no transport configuration", () => {
    const fake = provider();

    expect(isFakeCloudReviewProviderV1(fake)).toBe(true);
    expect(fake.model).toBe(FAKE_CLOUD_REVIEW_MODEL);
    expect(fake.descriptor).toMatchObject({
      locality: "cloud",
      capabilities: [
        "chat_completions",
        "streaming",
        "structured_json_schema",
      ],
      accounting: { kind: "metered" },
    });
    expect(fake.descriptor.capabilities).not.toContain("tool_calling");
    expect(JSON.stringify(fake)).not.toMatch(/api.?key|endpoint|base.?url|https?:\/\/(?!localhost\.invalid)/i);
  });

  it("returns deterministic host-acceptable review JSON without streaming it", async () => {
    const fake = provider();
    const { compiled, request } = input();

    const result = await fake.complete(request);
    const coverage = deriveReviewCoverageV1({
      snapshot: compiled.packet.snapshot,
      evidenceSet: compiled.packet.evidenceSet,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    });

    expect(request.onDelta).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      finishReason: "stop",
      servedModel: FAKE_CLOUD_REVIEW_MODEL,
      toolCalls: [],
      usage: { inputTokens: 320, outputTokens: 160, totalTokens: 480 },
      costUsd: 0.00096,
    });
    expect(
      parseAndAcceptRawReviewResultV1(result.content, {
        snapshot: compiled.packet.snapshot,
        evidenceSet: compiled.packet.evidenceSet,
        coverage,
      }),
    ).toMatchObject({
      snapshotId: compiled.packet.snapshot.snapshotId,
      evidenceSetId: compiled.packet.evidenceSet.evidenceSetId,
    });
  });

  it("rejects every non-structured or tool-capable request before dispatch", async () => {
    const fake = provider();
    const { request } = input();

    await expect(
      fake.complete({ ...request, structuredOutputContract: undefined }),
    ).rejects.toThrow("only tool-free ReviewResultV1 synthesis");
    await expect(
      fake.complete({ ...request, allowTools: true }),
    ).rejects.toThrow("only tool-free ReviewResultV1 synthesis");
    await expect(
      fake.complete({ ...request, allowedToolNames: ["read_text_file"] }),
    ).rejects.toThrow("only tool-free ReviewResultV1 synthesis");
  });

  it.each([
    ["invalid_json", "{invalid"],
    ["schema_invalid", "{}"],
    ["model_mismatch", "Fake Cloud Review unexpected model"],
    ["finish_length", "length"],
    ["tool_call_protocol", "read_text_file"],
  ] as const)("exposes deterministic %s failure telemetry", async (scenario, marker) => {
    const { request } = input();
    const result = await provider(scenario).complete(request);
    expect(JSON.stringify(result)).toContain(marker);
  });

  it("supports provider and cancellation failures without partial output", async () => {
    const { request } = input();
    await expect(provider("provider_error").complete(request)).rejects.toThrow(
      "Deterministic fake cloud provider failure",
    );

    const controller = new AbortController();
    const delayed = createFakeCloudReviewProviderV1({
      pricingVerifiedAt: PRICING_AT,
      delayMs: 10_000,
    });
    const promise = delayed.complete({
      ...request,
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({
      name: "ProviderAbortedError",
      partialContent: "",
    });
    expect(request.onDelta).not.toHaveBeenCalled();
  });
});
