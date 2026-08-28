import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { SoarConfig } from "../../src/main/config";
import { OpenAICompatibleProvider } from "../../src/main/providers/openai-compatible";
import { ProviderAbortedError } from "../../src/main/providers/types";

interface FakeServerContext {
  body: Record<string, unknown>;
  response: ServerResponse;
}

interface FakeServer {
  baseUrl: string;
  requests: Record<string, unknown>[];
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
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    requests.push(body);

    response.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "close",
      "Content-Type": "text/event-stream",
    });

    await respond({ body, response });
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

function createProvider(baseUrl: string, timeoutMs = 2_000): OpenAICompatibleProvider {
  const config: SoarConfig["vllm"] = {
    apiKey: "test-key",
    baseUrl,
    maxOutputTokens: 512,
    model: "local-test-model",
    timeoutMs,
  };
  return new OpenAICompatibleProvider(config);
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
  it("reserves conservative input space for adapter and tool-owned request fields", () => {
    const provider = createProvider("http://127.0.0.1:1/v1");

    expect(provider.estimateInputTokenReserve(false)).toBeGreaterThanOrEqual(512);
    expect(provider.estimateInputTokenReserve(true)).toBeGreaterThan(
      provider.estimateInputTokenReserve(false),
    );
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
