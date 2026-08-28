import type {
  CompleteInput,
  InferenceProvider,
  ProviderMessage,
  ProviderResult,
} from "./types";
import { ProviderAbortedError } from "./types";

function extractLastToolResult(messages: ProviderMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "tool") return message.content ?? undefined;
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
