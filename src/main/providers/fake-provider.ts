import type {
  CompleteInput,
  InferenceProvider,
  ProviderMessage,
  ProviderResult,
} from "./types";
import { ProviderAbortedError } from "./types";

const CONTEXT_PACKET_PREFIX = "SOAR_CONTEXT_PACKET_V1\n";

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
    const toolEvidence = [...(packet.evidence ?? [])]
      .reverse()
      .find(
        (entry): entry is ContextPacketToolEvidence =>
          entry.kind === "tool_evidence" &&
          "content" in entry &&
          typeof entry.content === "string",
      );
    if (!toolEvidence) return undefined;
    if (toolEvidence.citationSnippets?.length) {
      return JSON.stringify({
        text: toolEvidence.citationSnippets
          .map((snippet) => snippet.text)
          .join("\n"),
      });
    }
    return toolEvidence.content;
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

export class FakeProvider implements InferenceProvider {
  readonly id = "local-vllm";
  readonly model = "RM-01 VLM (deterministic test double)";
  readonly costPolicy = "local_zero_cost" as const;
  private readonly delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.delayMs = options.delayMs ?? 12;
  }

  async complete(input: CompleteInput): Promise<ProviderResult> {
    const startedAt = performance.now();
    const toolResult = extractLastToolResult(input.messages);
    const toolsPermitted = input.allowTools !== false;
    const requiredTool =
      toolsPermitted ? input.allowedToolNames?.[0] : undefined;
    const useLegacyDefaultTool =
      toolsPermitted && input.allowedToolNames === undefined && !toolResult;

    if (requiredTool || useLegacyDefaultTool) {
      const toolName = requiredTool ?? "read_text_file";
      const arguments_ =
        toolName === "list_files"
          ? {}
          : toolName === "search_text"
            ? { query: "SOAR" }
            : { relativePath: "SOAR_PROBE.txt" };
      return {
        content: "",
        toolCalls: [
          {
            id: `fake-${toolName}`,
            type: "function",
            function: {
              name: toolName,
              arguments: JSON.stringify(arguments_),
            },
          },
        ],
        finishReason: "tool_calls",
        usage: { inputTokens: 24, outputTokens: 12, totalTokens: 36 },
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
      timeToFirstTokenMs:
        firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
      durationMs: performance.now() - startedAt,
    };
  }
}
