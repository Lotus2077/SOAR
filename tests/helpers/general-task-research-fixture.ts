import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const samples = [
  { fixtureId: "soar-public-source-a-v1", label: "Aster", quantity: 12, unit: "widgets" },
  { fixtureId: "soar-public-source-b-v1", label: "Beacon", quantity: 7, unit: "widgets" },
  { fixtureId: "soar-public-source-c-v1", label: "Cedar — Café 你好", quantity: 4, unit: "widgets" },
];
export const researchSources = samples.map(sample => {
  const text = `${JSON.stringify(sample)}\n`;
  return { text, bytes: Buffer.byteLength(text), sha256: digest(text),
    url: `https://httpbin.org/base64/${encodeURIComponent(Buffer.from(text).toString("base64"))}` };
});
export const unknownSourceUrl = "https://httpbin.org/status/503";
export const researchReport = "# Scripted public-source report\n\n" + samples.map((sample, index) =>
  `- ${sample.label}: ${sample.quantity} ${sample.unit}. [Source ${index + 1}](${researchSources[index].url})\n`).join("") +
  `\nTotal: ${samples.reduce((sum, sample) => sum + sample.quantity, 0)} widgets.\n`;

export function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function python(source: string): string { return `python3 -c '${source.replaceAll("'", "'\\''")}'`; }
interface Action { name: "fetch_public" | "execute" | "finish"; arguments: Record<string, unknown>; hold?: boolean }
interface Message { role: string; content?: string; tool_call_id?: string }

function actionFor(mode: "success" | "unknown", ordinal: number, body: Record<string, unknown>): Action {
  const tools = body.tools as { function: { name: string } }[];
  if (!tools.some(tool => tool.function.name === "fetch_public")) throw new Error("fetch_tool_missing");
  if (mode === "unknown") {
    if (ordinal !== 1) throw new Error("model_called_after_unknown_fetch");
    return { name: "fetch_public", arguments: { destinationId: "desktop_web_1", url: unknownSourceUrl } };
  }
  if (ordinal <= 3) return { name: "fetch_public", hold: ordinal === 1,
    arguments: { destinationId: `desktop_web_${ordinal}`, url: researchSources[ordinal - 1].url } };
  if (ordinal === 4) {
    const messages = body.messages as Message[];
    const observed = researchSources.map((source, index) => {
      const message = messages.find(item => item.role === "tool" && item.tool_call_id === `research-action-${index + 1}`);
      if (!message?.content) throw new Error("retained_fetch_observation_missing");
      const value = JSON.parse(message.content) as { text: string; sha256: string; bytes: number; url: string; dispatchId: string; truncated: boolean };
      if (value.text !== source.text || value.sha256 !== source.sha256 || value.bytes !== source.bytes || value.url !== source.url || value.truncated !== false || !value.dispatchId) {
        throw new Error("fetch_observation_identity_mismatch");
      }
      return { url: value.url, sample: JSON.parse(value.text) };
    });
    // This synthetic response uses actual delivered tool observations, not unseen source bytes.
    const encoded = Buffer.from(JSON.stringify(observed)).toString("base64");
    return { name: "execute", arguments: { command: python([
      "import base64,json",
      "from pathlib import Path",
      `rows=json.loads(base64.b64decode('${encoded}'))`,
      "text='# Scripted public-source report\\n\\n'",
      "for i,row in enumerate(rows):",
      "    s=row['sample']; text+=f\"- {s['label']}: {s['quantity']} {s['unit']}. [Source {i+1}]({row['url']})\\n\"",
      "text+=f\"\\nTotal: {sum(row['sample']['quantity'] for row in rows)} widgets.\\n\"",
      "Path('output').mkdir(exist_ok=True)",
      "Path('output/research.md').write_text(text,encoding='utf-8')",
      "assert Path('output/research.md').read_text(encoding='utf-8')==text",
      "print('scripted report written and read back')",
    ].join("\n")) } };
  }
  if (ordinal === 5) return { name: "finish", arguments: { summary: "Submit the source-cited scripted fixture report." } };
  throw new Error("unplanned_model_request");
}

/** Local synthetic model only. Public HTTPS sources use the normal app broker. */
export async function generalTaskResearchFixture(mode: "success" | "unknown") {
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  const held = new Map<number, () => void>();
  const server = createServer(async (request, response) => {
    const fail = (reason: string) => {
      errors.push(reason);
      if (!response.headersSent) response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "synthetic_research_protocol_error" }));
    };
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") return fail("unexpected_route");
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) { fail("request_too_large"); request.destroy(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      const ordinal = requests.push({ method: request.method, path: request.url, body });
      const action = actionFor(mode, ordinal, body);
      const send = () => respond(response, ordinal, action);
      if (action.hold) held.set(ordinal, send); else send();
    } catch (error) { fail(error instanceof Error ? error.message : "invalid_fixture_request"); }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, errors,
    release(ordinal: number) {
      const send = held.get(ordinal); if (!send) throw new Error("fixture_response_not_held");
      held.delete(ordinal); send();
    },
    async close() {
      held.clear(); server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

function respond(response: ServerResponse, ordinal: number, action: Action): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ id: `synthetic-research-${ordinal}`, model: "synthetic-research-tools",
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
      tool_calls: [{ id: `research-action-${ordinal}`, type: "function", function: { name: action.name, arguments: JSON.stringify(action.arguments) } }] } }],
    usage: { prompt_tokens: 128, completion_tokens: 64, total_tokens: 192 } }));
}
