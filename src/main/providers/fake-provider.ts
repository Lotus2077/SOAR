import type {
  CompleteInput,
  InferenceProvider,
  ProviderMessage,
  ProviderResult,
} from "./types";
import { ProviderAbortedError } from "./types";

function extractLastToolResult(messages: ProviderMessage[]): string | undefined {
  return [...messages].reverse().find((message) => message.role === "tool")?.content ?? undefined;
}

async function emitChunks(
  chunks: string[],
  input: CompleteInput,
  delayMs = 12,
): Promise<string> {
  let content = "";
  for (const chunk of chunks) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, delayMs);
      input.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(new ProviderAbortedError("Fake inference cancelled", content));
        },
        { once: true },
      );
    });
    if (input.signal.aborted) throw new ProviderAbortedError("Fake inference cancelled", content);
    content += chunk;
    input.onDelta(chunk);
  }
  return content;
}

export class FakeProvider implements InferenceProvider {
  readonly id = "local-vllm";
  readonly model = "RM-01 VLM (deterministic test double)";
  private readonly delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.delayMs = options.delayMs ?? 12;
  }

  async complete(input: CompleteInput): Promise<ProviderResult> {
    const startedAt = performance.now();
    const toolResult = extractLastToolResult(input.messages);

    if (!toolResult) {
      return {
        content: "",
        toolCalls: [
          {
            id: "read-probe",
            type: "function",
            function: {
              name: "read_text_file",
              arguments: JSON.stringify({ relativePath: "SOAR_PROBE.txt" }),
            },
          },
        ],
        finishReason: "tool_calls",
        usage: { inputTokens: 24, outputTokens: 12, totalTokens: 36 },
        timeToFirstTokenMs: 1,
        durationMs: performance.now() - startedAt,
      };
    }

    const parsed = JSON.parse(toolResult) as { text?: string };
    const chunks = ["The workspace marker is ", parsed.text?.trim() || "missing", "."];
    const content = await emitChunks(chunks, input, this.delayMs);
    return {
      content,
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 48, outputTokens: 16, totalTokens: 64 },
      timeToFirstTokenMs: 12,
      durationMs: performance.now() - startedAt,
    };
  }
}
