import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface ResearchServerRequest { system: string; user: string; maxTokens?: number; responseFormat: boolean }

/**
 * Backlog item 13a: a loopback chat-completions endpoint for the desktop's research stage in tests (the stage seam). Each request's
 * system and user messages go to `reply`, whose text is the assistant message of a JSON reply (never streamed), finished "stop"
 * unless the reply names another finish reason ("length" for a reply cut at the output limit); a reply may also be a promise, which
 * holds the request open until it settles, or one tool call (a scripted writer's action, answered with finish_reason "tool_calls"); the
 * request's parsed body is the third argument. A reply that throws or rejects answers 500, as an unreachable model does. Invented model
 * text only, and nothing listens beyond 127.0.0.1.
 */
type ResearchServerAnswer = string | { content: string; finishReason: string } | { toolCall: { name: string; arguments: Record<string, unknown> } };
export async function researchModelServer(reply: (system: string, user: string, body: Record<string, unknown>) => ResearchServerAnswer | Promise<ResearchServerAnswer>) {
  const requests: ResearchServerRequest[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let body: { model?: string; max_tokens?: number; response_format?: unknown; messages?: { role: string; content: unknown }[] };
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { response.writeHead(400).end(); return; }
    const text = (role: string) => { const message = (body.messages ?? []).find(item => item.role === role); return typeof message?.content === "string" ? message.content : ""; };
    const system = text("system"), user = text("user");
    requests.push({ system, user, ...(typeof body.max_tokens === "number" ? { maxTokens: body.max_tokens } : {}), responseFormat: body.response_format !== undefined });
    let answer: ResearchServerAnswer;
    try { answer = await reply(system, user, body as Record<string, unknown>); } catch {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "synthetic_fixture_refusal" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    const id = `research-${requests.length}`;
    const choice = typeof answer === "object" && "toolCall" in answer
      ? { index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
        tool_calls: [{ id: `${id}-call`, type: "function", function: { name: answer.toolCall.name, arguments: JSON.stringify(answer.toolCall.arguments) } }] } }
      : { index: 0, finish_reason: typeof answer === "string" ? "stop" : answer.finishReason, message: { role: "assistant", content: typeof answer === "string" ? answer : answer.content } };
    response.end(JSON.stringify({ id, model: body.model, choices: [choice],
      usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 } }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
