import type {
  CompleteInput,
  DescribedInferenceProvider,
  ProviderMessage,
  ProviderModelAvailabilityResult,
  ProviderResult,
} from "./types";
import { ProviderAbortedError } from "./types";
import { parseProviderDescriptor } from "./provider-descriptor";
import { deriveReviewCoverageV1 } from "../change-acquisition-contracts";
import {
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  ReviewResultV1Schema,
} from "../../shared/review-result-contract";
import {
  ReviewSynthesisPacketV1Schema,
  type ReviewSynthesisPacketV1,
} from "../../shared/review-synthesis-packet";

const CONTEXT_PACKET_PREFIX = "SOAR_CONTEXT_PACKET_V1\n";
const REVIEW_SYNTHESIS_PACKET_PREFIX =
  "SOAR_REVIEW_SYNTHESIS_PACKET_V1\n";

interface ContextPacketToolEvidence {
  kind: "tool_evidence";
  content: string;
  citationSnippets?: Array<{ citation: string; text: string }>;
}

interface ContextPacketShape {
  evidence?: Array<ContextPacketToolEvidence | { kind?: string }>;
}

function toolResultFromContextPacket(message: ProviderMessage): string | undefined {
  if (message.role !== "user" || !message.content.startsWith(CONTEXT_PACKET_PREFIX)) {
    return undefined;
  }

  try {
    const packet = JSON.parse(
      message.content.slice(CONTEXT_PACKET_PREFIX.length),
    ) as ContextPacketShape;
    const toolEvidence = [...(packet.evidence ?? [])].reverse().filter(
      (entry): entry is ContextPacketToolEvidence =>
        entry.kind === "tool_evidence" &&
        "content" in entry &&
        typeof entry.content === "string",
    );
    const groundedEvidence = toolEvidence.find(
      (entry) => (entry.citationSnippets?.length ?? 0) > 0,
    );
    if (groundedEvidence?.citationSnippets?.length) {
      return JSON.stringify({
        text: groundedEvidence.citationSnippets
          .map((snippet) => snippet.text)
          .join("\n"),
      });
    }
    return toolEvidence[0]?.content;
  } catch {
    return undefined;
  }
}

function extractLastToolResult(messages: ProviderMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "tool") return message.content ?? undefined;
    if (message) {
      const packetToolResult = toolResultFromContextPacket(message);
      if (packetToolResult !== undefined) return packetToolResult;
    }
  }
  return undefined;
}

function extractReviewSynthesisPacket(
  messages: ProviderMessage[],
): ReviewSynthesisPacketV1 {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role !== "user" ||
      !message.content.startsWith(REVIEW_SYNTHESIS_PACKET_PREFIX)
    ) {
      continue;
    }
    return ReviewSynthesisPacketV1Schema.parse(
      JSON.parse(message.content.slice(REVIEW_SYNTHESIS_PACKET_PREFIX.length)),
    );
  }
  throw new TypeError(
    "The fake change-review provider requires one review synthesis packet.",
  );
}

function deterministicReviewResult(packet: ReviewSynthesisPacketV1): string {
  const coverage = deriveReviewCoverageV1({
    snapshot: packet.snapshot,
    evidenceSet: packet.evidenceSet,
    packetRetainedEvidenceSet: true,
    // The fake models a stable deterministic fixture. The production host owns
    // the real post-inference snapshot revalidation and can still reject it.
    snapshotRevalidated: true,
  });
  const complete = coverage.status === "complete";
  return JSON.stringify(
    ReviewResultV1Schema.parse({
      schemaVersion: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      snapshotId: packet.snapshot.snapshotId,
      summary: complete
        ? "No blocking findings were produced from the admitted deterministic test evidence."
        : "The deterministic test review is incomplete because the admitted evidence does not satisfy every coverage gate.",
      conclusion: complete ? "no_blocking_findings" : "incomplete",
      evidenceSetId: packet.evidenceSet.evidenceSetId,
      omissions: complete
        ? []
        : [
            {
              code: "fake_incomplete_evidence",
              description:
                "One or more host-derived evidence coverage gates are incomplete.",
            },
          ],
      findings: [],
    }),
  );
}

function waitForDelay(
  delayMs: number,
  signal: AbortSignal,
  partialContent: string,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new ProviderAbortedError("Fake inference cancelled", partialContent));
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new ProviderAbortedError("Fake inference cancelled", partialContent));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function emitChunks(
  chunks: string[],
  input: CompleteInput,
  delayMs = 12,
): Promise<string> {
  let content = "";
  for (const chunk of chunks) {
    await waitForDelay(delayMs, input.signal, content);
    content += chunk;
    input.onDelta(chunk);
  }
  return content;
}

export class FakeProvider implements DescribedInferenceProvider {
  readonly id = "local-vllm";
  readonly model = "RM-01 VLM (deterministic test double)";
  readonly costPolicy = "local_zero_cost" as const;
  readonly descriptor = parseProviderDescriptor({
    id: this.id,
    adapter: "openai-compatible",
    locality: "local",
    model: this.model,
    enabled: true,
    capabilities: [
      "chat_completions",
      "streaming",
      "structured_json_schema",
      "tool_calling",
    ],
    contextWindowTokens: 32_768,
    maxOutputTokens: 8_192,
    requestReserveTokens: 512,
    accounting: { kind: "local_zero_cost" },
  });
  private readonly delayMs: number;
  private toolCallSequence = 0;

  constructor(options: { delayMs?: number } = {}) {
    this.delayMs = options.delayMs ?? 12;
  }

  async checkConfiguredModelAvailability(
    signal?: AbortSignal,
  ): Promise<ProviderModelAvailabilityResult> {
    return {
      providerId: this.id,
      model: this.model,
      locality: "local",
      status: signal?.aborted ? "unhealthy" : "healthy",
      code: signal?.aborted ? "cancelled" : "configured_model_available",
    };
  }

  async complete(input: CompleteInput): Promise<ProviderResult> {
    const startedAt = performance.now();
    if (
      input.structuredOutputContract ===
      REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT
    ) {
      if (
        input.allowTools !== false ||
        input.allowedToolNames !== undefined ||
        input.requireToolCall === true
      ) {
        throw new RangeError(
          "structured output is mutually exclusive with provider tools",
        );
      }
      if (input.signal.aborted) {
        throw new ProviderAbortedError("Fake inference cancelled", "");
      }
      const packet = extractReviewSynthesisPacket(input.messages);
      const content = deterministicReviewResult(packet);
      return {
        content,
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 96, outputTokens: 48, totalTokens: 144 },
        servedModel: this.model,
        timeToFirstTokenMs: 1,
        durationMs: performance.now() - startedAt,
      };
    }
    const toolResult = extractLastToolResult(input.messages);
    const toolsPermitted = input.allowTools !== false;
    const requiredTool =
      toolsPermitted && input.requireToolCall
        ? input.allowedToolNames?.[0]
        : undefined;
    if (
      input.requireToolCall &&
      (requiredTool === undefined || input.allowedToolNames?.length !== 1)
    ) {
      throw new RangeError(
        "requireToolCall needs exactly one enabled scheduler-selected tool in the fake provider.",
      );
    }
    const useLegacyDefaultTool =
      toolsPermitted && input.allowedToolNames === undefined && !toolResult;

    if (requiredTool || useLegacyDefaultTool) {
      const toolName = requiredTool ?? "read_text_file";
      const arguments_ =
        toolName === "list_files"
          ? {}
          : toolName === "search_text"
            ? { query: "SOAR" }
            : toolName === "inspect_git_changes"
              ? { schemaVersion: "inspect-git-changes-v1" }
              : { relativePath: "SOAR_PROBE.txt" };
      this.toolCallSequence += 1;
      return {
        content: "",
        toolCalls: [
          {
            id: `fake-${toolName}-${this.toolCallSequence}`,
            type: "function",
            function: {
              name: toolName,
              arguments: JSON.stringify(arguments_),
            },
          },
        ],
        finishReason: "tool_calls",
        usage: { inputTokens: 24, outputTokens: 12, totalTokens: 36 },
        servedModel: this.model,
        timeToFirstTokenMs: 1,
        durationMs: performance.now() - startedAt,
      };
    }

    const parsed = toolResult
      ? (JSON.parse(toolResult) as { text?: string })
      : {};
    const chunks = [
      "The workspace marker at SOAR_PROBE.txt:1 is ",
      parsed.text?.trim() || "missing",
      ".",
    ];
    let firstTokenAt: number | undefined;
    const content = await emitChunks(
      chunks,
      {
        ...input,
        onDelta: (delta) => {
          firstTokenAt ??= performance.now();
          input.onDelta(delta);
        },
      },
      this.delayMs,
    );
    return {
      content,
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 48, outputTokens: 16, totalTokens: 64 },
      servedModel: this.model,
      timeToFirstTokenMs:
        firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
      durationMs: performance.now() - startedAt,
    };
  }
}
