import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const progressInput = "id,quantity,unitCents\nalpha,7,135\nbeta,11,209\ngamma,3,875\n";
export const progressGoal = "Create report.json with totalsCents for every selected CSV row, calculated as quantity times unitCents. Preserve the original source. Inspect failed checks, change a failing approach and save the requested report before finishing.";
export const progressModel = "synthetic-progress-tools";
export const progressHeading = "Current host execution progress";
export const progressStop = "repeated_identical_execution_failure";
export const progressStopReason = "The agent selected the same failed command after a recovery warning. The command was stopped before execution. Saved progress is retained; this task cannot resume.";
export const progressFinishSummary = "Source-derived report saved and checked. Request host structural verification; independent correctness is checked by the fixture.";
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const python = (source: string) => `python3 -c '${source.replaceAll("'", "'\\''")}'`;
export const failureResult = { exitCode: 2, stdout: "SOURCE_CHECK failed: report has not been created.\n", stderr: "Create the required report from the original CSV.\n" };
// Deliberately deterministic and read-only. A counter would change the checkpoint
// and make another execution a legitimate changed-workspace retry.
export const failingCommand = python(`import hashlib,sys
from pathlib import Path
assert hashlib.sha256(Path("input/01-source.csv").read_bytes()).hexdigest()=="${digest(progressInput)}"
sys.stdout.write(${JSON.stringify(failureResult.stdout)})
sys.stderr.write(${JSON.stringify(failureResult.stderr)})
sys.exit(2)`);
export const repairCommand = python(`import csv,json
from pathlib import Path
source=Path("input/01-source.csv")
before=source.read_bytes()
rows=list(csv.DictReader(before.decode().splitlines()))
totals={row["id"]:int(row["quantity"])*int(row["unitCents"]) for row in rows}
Path("output").mkdir(exist_ok=True)
target=Path("output/report.json")
target.write_text(json.dumps({"totalsCents":totals},sort_keys=True)+"\\n")
written=json.loads(target.read_text())
assert written["totalsCents"]=={row["id"]:int(row["quantity"])*int(row["unitCents"]) for row in rows}
assert source.read_bytes()==before
print("SOURCE_CHECK_PASS rows="+str(len(rows)))`);

export type ProgressScenario = "recover" | "ignore";
export interface ProgressRequest { method: string; path: string; rawBody: string; body: Record<string, any>; bytes: number; sha256: string }
type Message = { role: string; content?: string; tool_call_id?: string };
export function currentProgressGuidance(body: Record<string, any>): string {
  if (!Array.isArray(body.messages)) throw new Error("fixture_messages_invalid");
  const system = body.messages.filter((row: Message) => row.role === "system");
  if (system.length !== 1 || typeof system[0].content !== "string") throw new Error("fixture_current_system_missing");
  const text: string = system[0].content, start = text.indexOf(progressHeading);
  if (start === -1) return "";
  const end = text.indexOf("\nCurrent host budget", start);
  if (text.indexOf(progressHeading, start + 1) !== -1 || end === -1) throw new Error("fixture_guidance_boundaries_invalid");
  return text.slice(start, end);
}
function toolResult(body: Record<string, any>, id: string): Record<string, any> {
  const matches = (body.messages as Message[]).filter(row => row.role === "tool" && row.tool_call_id === id);
  if (matches.length !== 1 || typeof matches[0]!.content !== "string") throw new Error("fixture_tool_result_missing");
  return JSON.parse(matches[0]!.content!);
}
function requireFailure(body: Record<string, any>, id: string): void {
  const value = toolResult(body, id);
  if (value.exitCode !== failureResult.exitCode || value.stdout !== failureResult.stdout || value.stderr !== failureResult.stderr ||
      typeof value.instruction !== "string" || !value.instruction.includes("The process failed.")) throw new Error("fixture_actual_failure_missing");
}

/** Pure protocol checks. The receiver can learn guidance only from the request;
 * it has no host filesystem, SQLite, checkpoint or production test override. */
export function selectProgressAction(scenario: ProgressScenario, ordinal: number, body: Record<string, any>) {
  if (body.model !== progressModel || !Array.isArray(body.messages)) throw new Error("fixture_model_or_messages_invalid");
  const system = body.messages.filter((row: Message) => row.role === "system");
  if (system.length !== 1 || typeof system[0].content !== "string") throw new Error("fixture_current_system_missing");
  const systemContent: string = system[0].content;
  const guidance = currentProgressGuidance(body);
  if (ordinal === 1 || ordinal === 2) {
    if (systemContent.includes(progressHeading)) throw new Error("fixture_guidance_before_two_failures");
    if (ordinal === 2) requireFailure(body, "progress-action-1");
    return { name: "execute", arguments: { command: failingCommand }, guidanceObserved: false };
  }
  if (ordinal === 3) {
    requireFailure(body, "progress-action-1"); requireFailure(body, "progress-action-2");
    const match = guidance.match(/Prior execution IDs: (\[[^\n]*\])\./u);
    const ids: unknown = match ? JSON.parse(match[1]!) : null;
    if (!guidance.includes("Another identical execute against this unchanged checkpoint will be stopped before invocation.") ||
        !Array.isArray(ids) || ids.length !== 2 || ids[0] === ids[1] || ids.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/u.test(id))) throw new Error("fixture_repeated_failure_guidance_missing");
    return { name: "execute", arguments: { command: scenario === "recover" ? repairCommand : failingCommand }, guidanceObserved: true };
  }
  if (ordinal === 4 && scenario === "recover") {
    const result = toolResult(body, "progress-action-3");
    if (result.exitCode !== 0 || typeof result.stdout !== "string" || !result.stdout.includes("SOURCE_CHECK_PASS rows=3")) throw new Error("fixture_source_check_not_observed");
    if (systemContent.includes(progressHeading)) throw new Error("fixture_stale_failure_guidance_after_repair");
    return { name: "finish", arguments: { summary: progressFinishSummary }, guidanceObserved: false };
  }
  throw new Error("fixture_unplanned_request");
}

export async function generalTaskProgressFixture(scenario: ProgressScenario) {
  const requests: ProgressRequest[] = [], responses: string[] = [], errors: string[] = [];
  const decisions: { ordinal: number; guidanceObserved: boolean; name: string; commandSha256?: string }[] = [];
  let held: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    const fail = (code: string) => { errors.push(code); if (!response.headersSent) response.writeHead(400, { "content-type": "application/json" }); response.end('{"error":"scripted_progress_protocol_error"}'); };
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") { fail("unexpected_route"); return; }
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 192 * 1024) { fail("request_body_exceeded_192kib"); request.destroy(); return; } chunks.push(Buffer.from(chunk)); }
      const rawBody = Buffer.concat(chunks).toString("utf8"), body = JSON.parse(rawBody);
      const ordinal = requests.push({ method: request.method, path: request.url, rawBody, body, bytes, sha256: digest(rawBody) });
      const action = selectProgressAction(scenario, ordinal, body);
      decisions.push({ ordinal, guidanceObserved: action.guidanceObserved, name: action.name,
        ...(typeof action.arguments.command === "string" ? { commandSha256: digest(action.arguments.command) } : {}) });
      const send = () => respond(response, ordinal, action.name, action.arguments, responses);
      if (scenario === "recover" && ordinal === 2) held = send; else send();
    } catch { fail("scripted_request_validation_failed"); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, responses, errors, decisions,
    releaseSecond() { if (!held) throw new Error("fixture_second_response_not_held"); const send = held; held = undefined; send(); },
    async close() { held = undefined; server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
function respond(response: ServerResponse, ordinal: number, name: string, args: Record<string, unknown>, retained: string[]) {
  const text = JSON.stringify({ id: `synthetic-progress-${ordinal}`, model: progressModel,
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
      tool_calls: [{ id: `progress-action-${ordinal}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
    usage: { prompt_tokens: 128, completion_tokens: 64, total_tokens: 192 } });
  retained.push(text); response.writeHead(200, { "content-type": "application/json" }); response.end(text);
}
