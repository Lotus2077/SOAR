import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { OpenAICompatibleProvider } from "../../src/main/providers/openai-compatible";
import {
  parseProviderDescriptor,
  type ProviderCapability,
} from "../../src/main/providers/provider-descriptor";
import { ProviderAbortedError } from "../../src/main/providers/types";
import { MODEL_TOOL_DEFINITIONS } from "../../src/main/tools/tool-registry";

interface FakeServerContext {
  body: Record<string, unknown>;
  requestUrl: string;
  response: ServerResponse;
}

interface FakeServer {
  baseUrl: string;
  requests: Record<string, unknown>[];
  requestUrls: string[];
  close(): Promise<void>;
}

const servers: FakeServer[] = [];

function writeSse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function writeSseInNetworkFragments(response: ServerResponse, value: unknown): void {
  const event = `data: ${JSON.stringify(value)}\n\n`;
  const firstBoundary = Math.max(1, Math.floor(event.length / 3));
  const secondBoundary = Math.max(firstBoundary + 1, Math.floor((event.length * 2) / 3));
  response.write(event.slice(0, firstBoundary));
  response.write(event.slice(firstBoundary, secondBoundary));
  response.write(event.slice(secondBoundary));
}

async function startFakeOpenAiServer(
  respond: (context: FakeServerContext) => Promise<void> | void,
): Promise<FakeServer> {
  const requests: Record<string, unknown>[] = [];
  const requestUrls: string[] = [];
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    requests.push(body);
    const requestUrl = request.url ?? "";
    requestUrls.push(requestUrl);

    response.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "close",
      "Content-Type": "text/event-stream",
    });

    await respond({ body, requestUrl, response });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  const fakeServer: FakeServer = {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    requestUrls,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
  servers.push(fakeServer);
  return fakeServer;
}

function createProvider(
  baseUrl: string,
  timeoutMs = 2_000,
  capabilities: ProviderCapability[] = [
    "chat_completions",
    "reasoning_effort",
    "streaming",
    "tool_calling",
  ],
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey: "test-key",
    baseUrl,
    timeoutMs,
    descriptor: parseProviderDescriptor({
      id: "unit-local",
      adapter: "openai-compatible",
      locality: "local",
      model: "local-test-model",
      enabled: true,
      capabilities,
      contextWindowTokens: 4_096,
      maxOutputTokens: 512,
      requestReserveTokens: 512,
      accounting: { kind: "local_zero_cost" },
    }),
  });
}

function completionChunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): Record<string, unknown> {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "local-test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("OpenAICompatibleProvider", () => {
  it("makes request fields capability-aware and rejects unsupported behavior before I/O", async () => {
    const minimalCapabilities: ProviderCapability[] = [
      "chat_completions",
      "streaming",
    ];
    const server = await startFakeOpenAiServer(({ response }) => {
      writeSse(response, completionChunk({ content: "minimal" }));
      writeSse(response, completionChunk({}, "stop"));
      response.end("data: [DONE]\n\n");
    });
    const provider = createProvider(server.baseUrl, 2_000, minimalCapabilities);

    await provider.complete({
      messages: [{ role: "user", content: "No optional capabilities" }],
      signal: new AbortController().signal,
      allowTools: false,
      onDelta: () => undefined,
    });

    expect(server.requests[0]).not.toHaveProperty("reasoning_effort");
    expect(server.requests[0]).not.toHaveProperty("tool_choice");
    expect(server.requests[0]).not.toHaveProperty("tools");
    await expect(
      provider.complete({
        messages: [{ role: "user", content: "Use a tool" }],
        signal: new AbortController().signal,
        allowTools: true,
        onDelta: () => undefined,
      }),
    ).rejects.toThrow(/does not advertise tool_calling/u);
    expect(server.requests).toHaveLength(1);
  });

  it("rejects unimplemented structured JSON capability advertisement", () => {
    expect(() =>
      createProvider("http://127.0.0.1:1/v1", 2_000, [
        "chat_completions",
        "reasoning_effort",
        "streaming",
        "structured_json_schema",
        "tool_calling",
      ]),
    ).toThrow(/cannot be advertised/u);
  });

  it("reserves conservative input space for adapter and tool-owned request fields", () => {
    const provider = createProvider("http://127.0.0.1:1/v1");
    const encoder = new TextEncoder();
    const expectedWorkingReserve =
      512 +
      encoder.encode("local-test-model").length +
      encoder.encode(
        JSON.stringify({
          reasoning_effort: "none",
          tools: MODEL_TOOL_DEFINITIONS,
          tool_choice: "auto",
          parallel_tool_calls: false,
        }),
      ).length;

    expect(provider.estimateInputTokenReserve(false)).toBeGreaterThanOrEqual(512);
    expect(provider.estimateInputTokenReserve(true)).toBe(expectedWorkingReserve);
    expect(provider.estimateInputTokenReserve(true)).toBeGreaterThan(
      provider.estimateInputTokenReserve(false),
    );
    expect(
      provider.estimateInputTokenReserve(true, ["read_text_file"]),
    ).toBeLessThan(provider.estimateInputTokenReserve(true));
    const selectedTool = MODEL_TOOL_DEFINITIONS.filter(
      (definition) =>
        definition.type === "function" &&
        definition.function.name === "read_text_file",
    );
    const expectedRequiredReserve =
      512 +
      encoder.encode("local-test-model").length +
      encoder.encode(
        JSON.stringify({
          reasoning_effort: "none",
          tools: selectedTool,
          tool_choice: "required",
          parallel_tool_calls: false,
        }),
      ).length;
    expect(
      provider.estimateInputTokenReserve(
        true,
        ["read_text_file"],
        true,
      ),
    ).toBe(expectedRequiredReserve);
    expect(() => provider.estimateInputTokenReserve(true, undefined, true)).toThrow(
      /exactly one enabled scheduler-selected tool/u,
    );
  });

  it("posts inference requests to the /v1/chat/completions resource", async () => {
    const server = await startFakeOpenAiServer(({ response }) => {
      writeSse(response, completionChunk({ content: "Endpoint contract" }));
      writeSse(response, completionChunk({}, "stop"));
      response.end("data: [DONE]\n\n");
    });

    await createProvider(server.baseUrl).complete({
      messages: [{ role: "user", content: "Verify the endpoint" }],
      signal: new AbortController().signal,
      onDelta: () => undefined,
    });

    expect(server.requestUrls).toEqual(["/v1/chat/completions"]);
  });

  it("exposes only the scheduler-selected tool subset", async () => {
    const server = await startFakeOpenAiServer(({ response }) => {
      writeSse(response, completionChunk({ content: "I will inspect the file." }));
      writeSse(response, completionChunk({}, "stop"));
      response.end("data: [DONE]\n\n");
    });

    await createProvider(server.baseUrl).complete({
      messages: [{ role: "user", content: "Read the implementation" }],
      signal: new AbortController().signal,
      allowTools: true,
      allowedToolNames: ["read_text_file"],
      requireToolCall: true,
      onDelta: () => undefined,
    });

    const requestedTools = server.requests[0]?.tools as Array<{
      function: { name: string };
    }>;
    expect(requestedTools.map((tool) => tool.function.name)).toEqual([
      "read_text_file",
    ]);
    expect(server.requests[0]).toMatchObject({
      tool_choice: "required",
      parallel_tool_calls: false,
      reasoning_effort: "none",
    });
  });

  it("keeps tool choice auto when no required step is active", async () => {
    const server = await startFakeOpenAiServer(({ response }) => {
      writeSse(response, completionChunk({ content: "No tool needed." }));
      writeSse(response, completionChunk({}, "stop"));
      response.end("data: [DONE]\n\n");
    });

    await createProvider(server.baseUrl).complete({
      messages: [{ role: "user", content: "Choose whether to inspect." }],
      signal: new AbortController().signal,
      allowTools: true,
      allowedToolNames: ["read_text_file"],
      onDelta: () => undefined,
    });

    expect(server.requests[0]).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning_effort: "none",
    });
  });

  it("assembles fragmented streamed text and reports usage and latency", async () => {
    const server = await startFakeOpenAiServer(async ({ response }) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      writeSseInNetworkFragments(response, completionChunk({ content: "Hel" }));
      writeSse(response, completionChunk({ content: "lo" }));
      writeSse(response, completionChunk({}, "stop"));
      writeSse(response, {
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        created: 1,
        model: "local-test-model",
        choices: [],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 2,
          total_tokens: 14,
          completion_tokens_details: { reasoning_tokens: 1 },
        },
      });
      response.end("data: [DONE]\n\n");
    });
    const deltas: string[] = [];

    const result = await createProvider(server.baseUrl).complete({
      messages: [{ role: "user", content: "Say hello" }],
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta),
    });

    expect(result).toMatchObject({
      content: "Hello",
      finishReason: "stop",
      servedModel: "local-test-model",
      toolCalls: [],
      usage: {
        inputTokens: 12,
        outputTokens: 1,
        totalTokens: 14,
        reasoningTokens: 1,
      },
    });
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(result.timeToFirstTokenMs).toEqual(expect.any(Number));
    expect(result.timeToFirstTokenMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(result.timeToFirstTokenMs ?? 0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      model: "local-test-model",
      messages: [{ role: "user", content: "Say hello" }],
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 512,
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning_effort: "none",
    });
    const requestedTools = server.requests[0]?.tools as Array<{
      type: string;
      function: { name: string; parameters: Record<string, unknown> };
    }>;
    expect(requestedTools.map((tool) => tool.function.name)).toEqual([
      "read_text_file",
      "list_files",
      "search_text",
    ]);
    expect(requestedTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function",
          function: expect.objectContaining({
            name: "read_text_file",
            parameters: expect.objectContaining({
              required: ["relativePath"],
              additionalProperties: false,
            }),
          }),
        }),
        expect.objectContaining({
          function: expect.objectContaining({
            name: "search_text",
            parameters: expect.objectContaining({ required: ["query"] }),
          }),
        }),
      ]),
    );
  });

  it("assembles fragmented tool-call ids, names, and JSON arguments", async () => {
    const server = await startFakeOpenAiServer(({ response }) => {
      writeSse(
        response,
        completionChunk({
          tool_calls: [
            {
              index: 0,
              id: "call_",
              type: "function",
              function: { name: "read_", arguments: "{\"relative" },
            },
          ],
        }),
      );
      writeSseInNetworkFragments(
        response,
        completionChunk({
          tool_calls: [
            {
              index: 0,
              id: "123",
              function: { name: "text_", arguments: "Path\":\"notes/" },
            },
          ],
        }),
      );
      writeSse(
        response,
        completionChunk(
          {
            tool_calls: [
              {
                index: 0,
                function: { name: "file", arguments: "todo.txt\"}" },
              },
            ],
          },
          "tool_calls",
        ),
      );
      response.end("data: [DONE]\n\n");
    });
    const deltas: string[] = [];

    const result = await createProvider(server.baseUrl).complete({
      messages: [{ role: "user", content: "Read my notes" }],
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta),
    });

    expect(result).toMatchObject({
      content: "",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_123",
          type: "function",
          function: {
            name: "read_text_file",
            arguments: '{"relativePath":"notes/todo.txt"}',
          },
        },
      ],
    });
    expect(deltas).toEqual([]);
    expect(result.timeToFirstTokenMs).toEqual(expect.any(Number));
    expect(result.durationMs).toBeGreaterThanOrEqual(result.timeToFirstTokenMs ?? 0);
  });

  it("assigns unique fallback ids when consecutive provider responses omit tool-call ids", async () => {
    const server = await startFakeOpenAiServer(({ response }) => {
      writeSse(
        response,
        completionChunk(
          {
            tool_calls: [
              {
                index: 0,
                type: "function",
                function: {
                  name: "read_text_file",
                  arguments: '{"relativePath":"notes.txt"}',
                },
              },
            ],
          },
          "tool_calls",
        ),
      );
      response.end("data: [DONE]\n\n");
    });
    const provider = createProvider(server.baseUrl);
    const input = {
      messages: [{ role: "user" as const, content: "Read the notes" }],
      signal: new AbortController().signal,
      onDelta: () => undefined,
    };

    const first = await provider.complete(input);
    const second = await provider.complete(input);
    const firstId = first.toolCalls[0]?.id;
    const secondId = second.toolCalls[0]?.id;

    expect(firstId).toMatch(/^tool-call-[0-9a-f-]{36}-0$/u);
    expect(secondId).toMatch(/^tool-call-[0-9a-f-]{36}-0$/u);
    expect(secondId).not.toBe(firstId);
    expect(server.requests).toHaveLength(2);
  });

  it("forces tool choice none when the runner reserves a final answer round", async () => {
    const server = await startFakeOpenAiServer(({ response }) => {
      writeSse(response, completionChunk({ content: "Final answer" }));
      writeSse(response, completionChunk({}, "stop"));
      response.end("data: [DONE]\n\n");
    });

    const result = await createProvider(server.baseUrl).complete({
      messages: [{ role: "user", content: "Finish now" }],
      signal: new AbortController().signal,
      allowTools: false,
      onDelta: () => undefined,
    });

    expect(result).toMatchObject({ content: "Final answer", finishReason: "stop" });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).not.toHaveProperty("tools");
    expect(server.requests[0]).toHaveProperty("tool_choice", "none");
    expect(server.requests[0]).toHaveProperty("reasoning_effort", "none");
    expect(server.requests[0]).not.toHaveProperty("parallel_tool_calls");
  });

  it("fails closed when the served model differs from the descriptor", async () => {
    const server = await startFakeOpenAiServer(({ response }) => {
      writeSse(response, {
        ...completionChunk({ content: "wrong model" }),
        model: "provider-substitute-model",
      });
      response.end("data: [DONE]\n\n");
    });

    await expect(
      createProvider(server.baseUrl).complete({
        messages: [{ role: "user", content: "Do not substitute models" }],
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    ).rejects.toThrow(/served unexpected model/u);
  });

  it("surfaces cancellation with the text received before abort", async () => {
    const server = await startFakeOpenAiServer(({ response }) => {
      writeSse(response, completionChunk({ content: "partial result" }));
    });
    const controller = new AbortController();
    const deltas: string[] = [];

    const completion = createProvider(server.baseUrl).complete({
      messages: [{ role: "user", content: "Start a long task" }],
      signal: controller.signal,
      onDelta: (delta) => {
        deltas.push(delta);
        controller.abort();
      },
    });

    await expect(completion).rejects.toMatchObject({
      name: "ProviderAbortedError",
      message: "Inference cancelled",
      partialContent: "partial result",
      abortKind: "cancelled",
    });
    await expect(completion).rejects.toBeInstanceOf(ProviderAbortedError);
    expect(deltas).toEqual(["partial result"]);
  });

  it("distinguishes provider timeout from user cancellation", async () => {
    const server = await startFakeOpenAiServer(async ({ response }) => {
      writeSse(response, completionChunk({ content: "partial before timeout" }));
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        response.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    });

    const completion = createProvider(server.baseUrl, 100).complete({
      messages: [{ role: "user", content: "Start a task that will time out" }],
      signal: new AbortController().signal,
      onDelta: () => undefined,
    });

    await expect(completion).rejects.toMatchObject({
      name: "ProviderAbortedError",
      message: "Inference timed out",
      partialContent: "partial before timeout",
      abortKind: "timeout",
    });
  });
});
