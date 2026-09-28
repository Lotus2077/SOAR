import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface GeneralTaskFixtureAction {
  name: "execute" | "finish" | "request_consultation";
  arguments: Record<string, unknown>;
  hold?: boolean;
  /** Optional synthetic assistant text for transport-boundary regressions. */
  content?: string;
}

/** A bounded HTTP protocol fixture, never an inference provider or runtime override. */
export async function generalTaskModelFixture() {
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  const actions: GeneralTaskFixtureAction[] = [];
  const held = new Map<number, () => void>();
  let canaryRequests = 0;
  const server = createServer(async (request, response) => {
    if (request.url === "/canary") {
      canaryRequests++;
      response.writeHead(204).end();
      return;
    }
    const fail = (reason: string) => {
      errors.push(reason);
      if (!response.headersSent) response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "synthetic_fixture_protocol_error" }));
    };
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") return fail("unexpected_route");
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) { fail("request_too_large"); request.destroy(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      const ordinal = requests.push({ method: request.method, path: request.url, body });
      const action = actions[ordinal - 1];
      if (!action) return fail("unplanned_model_request");
      const send = () => respond(response, ordinal, action);
      if (action.hold) held.set(ordinal, send);
      else send();
    } catch { fail("invalid_request_body"); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin, requests, errors, actions,
    get canaryRequests() { return canaryRequests; },
    release(ordinal: number) {
      const send = held.get(ordinal);
      if (!send) throw new Error("fixture_response_not_held");
      held.delete(ordinal); send();
    },
    async close() {
      held.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

function respond(response: ServerResponse, ordinal: number, action: GeneralTaskFixtureAction) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    id: `synthetic-general-${ordinal}`, model: "synthetic-general-tools",
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: action.content ?? null,
      tool_calls: [{ id: `desktop-action-${ordinal}`, type: "function",
        function: { name: action.name, arguments: JSON.stringify(action.arguments) } }],
    } }],
    usage: { prompt_tokens: 128, completion_tokens: 64, total_tokens: 192 },
  }));
}
