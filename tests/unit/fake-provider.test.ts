import { describe, expect, it, vi } from "vitest";

import {
  canonicalizeReviewEvidenceSetV1,
  deriveReviewCoverageV1,
} from "../../src/main/change-acquisition-contracts";
import { FakeProvider } from "../../src/main/providers/fake-provider";
import type { ProviderAbortedError } from "../../src/main/providers/types";
import { compileReviewContextV1 } from "../../src/main/review-context-compiler-v1";
import { deriveVerifiedReviewEvidenceV1 } from "../../src/main/review-event-provenance";
import {
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  parseAndAcceptRawReviewResultV1,
} from "../../src/shared/review-result-contract";
import type { ReviewSynthesisPacketV1 } from "../../src/shared/review-synthesis-packet";
import { reviewFixtureEvents } from "../helpers/review-event-fixture";

function toolResultMessages(text = "probe") {
  return [
    {
      role: "tool" as const,
      content: JSON.stringify({ text }),
      tool_call_id: "read-probe",
    },
  ];
}

function compiledReviewMessages() {
  return compileReviewContextV1({
    objective: "Review the current changes for concrete defects.",
    verifiedEvidence: deriveVerifiedReviewEvidenceV1(reviewFixtureEvents()),
    systemPrompt: "Follow the deterministic test review policy.",
    maxInputTokens: 1_000_000,
  });
}

function reviewMessages(packet: ReviewSynthesisPacketV1) {
  return [
    {
      role: "user" as const,
      content: `SOAR_REVIEW_SYNTHESIS_PACKET_V1\n${JSON.stringify(packet)}`,
    },
  ];
}

describe("FakeProvider", () => {
  it("uses citation-only grounded packet evidence after finalization compaction", async () => {
    const packet = {
      evidence: [
        {
          kind: "tool_evidence",
          content: "",
          citationSnippets: [
            {
              citation: "SOAR_PROBE.txt:1",
              text: "SOAR-E2E-PROBE-91D7",
            },
          ],
        },
        {
          kind: "tool_evidence",
          content: "Complete file lines are represented by citationSnippets.",
        },
      ],
    };
    const result = await new FakeProvider({ delayMs: 0 }).complete({
      messages: [
        {
          role: "user",
          content: `SOAR_CONTEXT_PACKET_V1\n${JSON.stringify(packet)}`,
        },
      ],
      signal: new AbortController().signal,
      allowTools: false,
      onDelta: vi.fn(),
    });

    expect(result.content).toBe(
      "The workspace marker at SOAR_PROBE.txt:1 is SOAR-E2E-PROBE-91D7.",
    );
  });

  it("removes abort listeners after each completed delay", async () => {
    const signal = new AbortController().signal;
    const addListener = vi.spyOn(signal, "addEventListener");
    const removeListener = vi.spyOn(signal, "removeEventListener");
    const deltas: string[] = [];

    const result = await new FakeProvider({ delayMs: 0 }).complete({
      messages: toolResultMessages(),
      signal,
      onDelta: (delta) => deltas.push(delta),
    });

    expect(result.content).toBe(
      "The workspace marker at SOAR_PROBE.txt:1 is probe.",
    );
    expect(deltas.join("")).toBe(result.content);
    expect(addListener).toHaveBeenCalledTimes(3);
    expect(removeListener).toHaveBeenCalledTimes(3);
  });

  it("honors the scheduler-selected Repository Investigator tool", async () => {
    const result = await new FakeProvider({ delayMs: 0 }).complete({
      messages: [],
      signal: new AbortController().signal,
      allowTools: true,
      allowedToolNames: ["search_text"],
      requireToolCall: true,
      onDelta: vi.fn(),
    });

    expect(result.toolCalls).toEqual([
      {
        id: "fake-search_text-1",
        type: "function",
        function: {
          name: "search_text",
          arguments: JSON.stringify({ query: "SOAR" }),
        },
      },
    ]);
  });

  it("advertises deterministic structured review and bounded model availability", async () => {
    const provider = new FakeProvider({ delayMs: 0 });

    expect(provider.descriptor.capabilities).toEqual([
      "chat_completions",
      "streaming",
      "structured_json_schema",
      "tool_calling",
    ]);
    await expect(provider.checkConfiguredModelAvailability()).resolves.toEqual({
      providerId: provider.id,
      model: provider.model,
      locality: "local",
      status: "healthy",
      code: "configured_model_available",
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.checkConfiguredModelAvailability(controller.signal),
    ).resolves.toMatchObject({ status: "unhealthy", code: "cancelled" });
  });

  it("emits exact scheduler-owned inspection arguments with unique call IDs", async () => {
    const provider = new FakeProvider({ delayMs: 0 });
    const invoke = () =>
      provider.complete({
        messages: [],
        signal: new AbortController().signal,
        allowTools: true,
        allowedToolNames: ["inspect_git_changes"],
        requireToolCall: true,
        onDelta: vi.fn(),
      });

    const first = await invoke();
    const second = await invoke();

    expect(first.toolCalls[0]).toEqual({
      id: "fake-inspect_git_changes-1",
      type: "function",
      function: {
        name: "inspect_git_changes",
        arguments: JSON.stringify({
          schemaVersion: "inspect-git-changes-v1",
        }),
      },
    });
    expect(second.toolCalls[0]?.id).toBe("fake-inspect_git_changes-2");
  });

  it("returns a host-acceptable structured result without streaming raw JSON", async () => {
    const compiled = compiledReviewMessages();
    const onDelta = vi.fn();
    const provider = new FakeProvider({ delayMs: 0 });

    const result = await provider.complete({
      messages: compiled.messages,
      signal: new AbortController().signal,
      allowTools: false,
      structuredOutputContract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      onDelta,
    });
    const coverage = deriveReviewCoverageV1({
      snapshot: compiled.packet.snapshot,
      evidenceSet: compiled.packet.evidenceSet,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    });

    expect(result.finishReason).toBe("stop");
    expect(result.servedModel).toBe(provider.model);
    expect(result.toolCalls).toEqual([]);
    expect(onDelta).not.toHaveBeenCalled();
    expect(
      parseAndAcceptRawReviewResultV1(result.content, {
        snapshot: compiled.packet.snapshot,
        evidenceSet: compiled.packet.evidenceSet,
        coverage,
      }),
    ).toMatchObject({
      snapshotId: compiled.packet.snapshot.snapshotId,
      evidenceSetId: compiled.packet.evidenceSet.evidenceSetId,
      conclusion: "no_blocking_findings",
      omissions: [],
      findings: [],
    });
  });

  it("marks structurally valid but incomplete packet evidence as incomplete", async () => {
    const compiled = compiledReviewMessages();
    const {
      evidenceSetId: _evidenceSetId,
      ...evidenceSetPreimage
    } = compiled.packet.evidenceSet;
    const evidenceSet = canonicalizeReviewEvidenceSetV1({
      ...evidenceSetPreimage,
      repositoryObservations: [],
    });
    const packet: ReviewSynthesisPacketV1 = {
      ...compiled.packet,
      evidenceSet,
      evidenceBodies: compiled.packet.evidenceBodies.filter(
        (body) => body.kind !== "repository_file",
      ),
    };
    const provider = new FakeProvider({ delayMs: 0 });
    const result = await provider.complete({
      messages: reviewMessages(packet),
      signal: new AbortController().signal,
      allowTools: false,
      structuredOutputContract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      onDelta: vi.fn(),
    });
    const coverage = deriveReviewCoverageV1({
      snapshot: packet.snapshot,
      evidenceSet,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    });

    expect(coverage.status).toBe("incomplete");
    expect(
      parseAndAcceptRawReviewResultV1(result.content, {
        snapshot: packet.snapshot,
        evidenceSet,
        coverage,
      }),
    ).toMatchObject({
      conclusion: "incomplete",
      omissions: [
        expect.objectContaining({ code: "fake_incomplete_evidence" }),
      ],
      findings: [],
    });
  });

  it("does not emit a fallback tool call when tools are disabled", async () => {
    const result = await new FakeProvider({ delayMs: 0 }).complete({
      messages: [],
      signal: new AbortController().signal,
      allowTools: false,
      onDelta: vi.fn(),
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("stop");
  });

  it("rejects an already-aborted completion without streaming output", async () => {
    const controller = new AbortController();
    controller.abort();
    const onDelta = vi.fn();

    await expect(
      new FakeProvider({ delayMs: 0 }).complete({
        messages: toolResultMessages(),
        signal: controller.signal,
        onDelta,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProviderAbortedError>>({
        name: "ProviderAbortedError",
        partialContent: "",
        abortKind: "cancelled",
      }),
    );
    expect(onDelta).not.toHaveBeenCalled();
  });
});
