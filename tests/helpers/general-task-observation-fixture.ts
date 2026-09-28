import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const observationInput = "id,quantity,unitCents\nalpha,7,135\nbeta,11,209\ngamma,3,875\n";
export const observationGoal = "Create report.json with totalsCents for every selected CSV row, calculated as quantity times unitCents. Preserve the source. Inspect failed checks and repair the reported row before finishing; a zero process exit alone does not prove a correct report.";
export const observationModel = "synthetic-observation-tools";
export const observationLogBytes = 210 * 1024;
export const observationDetailOffset = 100000;
export const observationReadBytes = 512;
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const python = (source: string) => `python3 -c '${source.replaceAll("'", "'\\''")}'`;
const checkProgram = `import csv,json
from pathlib import Path
rows=list(csv.DictReader(Path("input/01-source.csv").read_text().splitlines()))
report=json.loads(Path("output/report.json").read_text())
expected={r["id"]:int(r["quantity"])*int(r["unitCents"]) for r in rows}
assert report["totalsCents"]==expected
print("SOURCE_CHECK_PASS rows="+str(len(rows)))`;
const initialCommand = python(`import csv,json,secrets,sys
from pathlib import Path
source=Path("input/01-source.csv")
rows=list(csv.DictReader(source.read_text().splitlines()))
totals={r["id"]:int(r["quantity"])*int(r["unitCents"]) for r in rows}
broken=secrets.choice(rows)
key=broken["id"]
correct=totals[key]
totals[key]=correct-1
Path("output").mkdir(exist_ok=True)
Path("output/report.json").write_text(json.dumps({"totalsCents":totals},sort_keys=True)+"\\n")
failure={"caseId":key,"quantity":int(broken["quantity"]),"unitCents":int(broken["unitCents"]),"reportedCents":totals[key],"computedCents":correct,"nonce":secrets.token_hex(8)}
header=b"CHECK_LOG failed=1 details_offset=${observationDetailOffset} details_bytes=${observationReadBytes}\\n"
detail=("FAIL "+json.dumps(failure,separators=(",",":"))+"\\n").encode()
tail=b"\\nCHECK_LOG_END\\n"
log=header+b"."*(${observationDetailOffset}-len(header))+detail
log+=b"."*(${observationLogBytes}-len(log)-len(tail))+tail
assert len(log)==${observationLogBytes}
sys.stdout.buffer.write(log)
sys.stdout.buffer.flush()
# Exit zero intentionally: process success is not semantic check success.
`);

export interface ObservationFailure {
  caseId: string; quantity: number; unitCents: number; reportedCents: number; computedCents: number; nonce: string;
}
export interface ObservationFixtureRequest {
  method: string; path: string; rawBody: string; body: Record<string, unknown>; bytes: number; sha256: string;
}
type ToolMessage = { role: string; tool_call_id?: string; content?: string };
function toolResult(body: Record<string, unknown>, id: string): Record<string, unknown> {
  const messages = body.messages as ToolMessage[];
  if (!Array.isArray(messages)) throw new Error("fixture_messages_missing");
  const results = messages.filter(row => row.role === "tool" && row.tool_call_id === id);
  if (results.length !== 1 || typeof results[0]!.content !== "string") throw new Error("fixture_tool_result_missing");
  const value: unknown = JSON.parse(results[0]!.content);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("fixture_tool_result_invalid");
  return value as Record<string, unknown>;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("fixture_reference_invalid");
  return value as Record<string, unknown>;
}
function failureFromText(text: string): ObservationFailure {
  const line = text.split("\n").find(value => value.startsWith("FAIL "));
  if (!line) throw new Error("fixture_hidden_failure_not_retrieved");
  const value = JSON.parse(line.slice(5)) as ObservationFailure;
  if (!["alpha", "beta", "gamma"].includes(value.caseId) || !/^[a-f0-9]{16}$/u.test(value.nonce) ||
      ![value.quantity, value.unitCents, value.reportedCents, value.computedCents].every(Number.isSafeInteger) ||
      value.quantity <= 0 || value.unitCents <= 0 || value.computedCents !== value.quantity * value.unitCents ||
      value.reportedCents !== value.computedCents - 1) throw new Error("fixture_failure_record_invalid");
  return value;
}

/** Only HTTP input can reveal the random failure. No host files, blobs or DB are read here. */
export async function generalTaskObservationFixture() {
  const requests: ObservationFixtureRequest[] = [], responses: string[] = [], errors: string[] = [];
  let held: (() => void) | undefined, learnedFailure: ObservationFailure | undefined;
  let selectedReference: { observationId: string; sha256: string } | undefined;
  const server = createServer(async (request, response) => {
    const fail = (reason: string) => { errors.push(reason); if (!response.headersSent) response.writeHead(400, { "content-type": "application/json" }); response.end('{"error":"scripted_observation_protocol_error"}'); };
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") { fail("unexpected_route"); return; }
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 192 * 1024) { fail("request_body_exceeded_192kib"); request.destroy(); return; } chunks.push(Buffer.from(chunk)); }
      const rawBody = Buffer.concat(chunks).toString("utf8"), body = object(JSON.parse(rawBody));
      const ordinal = requests.push({ method: request.method, path: request.url, rawBody, body, bytes, sha256: digest(rawBody) });
      if (body.model !== observationModel) throw new Error("fixture_model_mismatch");
      let name: "execute" | "read_observation" | "finish", args: Record<string, unknown>;
      if (ordinal === 1) {
        if (!(body.tools as { function?: { name?: string } }[]).some(tool => tool.function?.name === "read_observation")) throw new Error("fixture_reader_not_advertised");
        name = "execute"; args = { command: initialCommand };
      } else if (ordinal === 2) {
        const output = toolResult(body, "observation-action-1");
        const text = JSON.stringify(output);
        if (Buffer.byteLength(JSON.stringify((body.messages as ToolMessage[]).find(row => row.tool_call_id === "observation-action-1")!.content!)) > 8192 ||
            !text.includes(`details_offset=${observationDetailOffset}`) || text.includes('FAIL {')) throw new Error("fixture_preview_not_bounded_or_hidden");
        const reference = output;
        if (output.kind !== "execution_observation" || output.version !== 1 || output.exitCode !== 0 || output.truncated !== true) throw new Error("fixture_execute_observation_invalid");
        if (typeof reference.observationId !== "string" || typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(reference.sha256)) throw new Error("fixture_observation_identity_missing");
        selectedReference = { observationId: reference.observationId, sha256: reference.sha256 };
        name = "read_observation"; args = { ...selectedReference, stream: "stdout", offset: observationDetailOffset, maxBytes: observationReadBytes };
      } else if (ordinal === 3) {
        const output = toolResult(body, "observation-action-2");
        if (typeof output.text !== "string" || !selectedReference || output.observationId !== selectedReference.observationId || output.sha256 !== selectedReference.sha256 || output.stream !== "stdout") throw new Error("fixture_readback_identity_mismatch");
        learnedFailure = failureFromText(output.text);
        if (requests.slice(0, 2).some(row => row.rawBody.includes(learnedFailure!.nonce))) throw new Error("fixture_hidden_record_leaked_before_read");
        // Values come from the delivered read response, not from a private expected artifact.
        const encoded = Buffer.from(JSON.stringify(learnedFailure)).toString("base64");
        name = "execute"; args = { command: python(`import base64,json\nfrom pathlib import Path\nf=json.loads(base64.b64decode("${encoded}"))\np=Path("output/report.json")\nr=json.loads(p.read_text())\nassert r["totalsCents"][f["caseId"]]==f["reportedCents"]\nr["totalsCents"][f["caseId"]]=f["quantity"]*f["unitCents"]\nr["recoveryEvidence"]=f\np.write_text(json.dumps(r,sort_keys=True)+"\\n")\n${checkProgram}`) };
      } else if (ordinal === 4) {
        const output = toolResult(body, "observation-action-3");
        if (output.exitCode !== 0 || !JSON.stringify(output).includes("SOURCE_CHECK_PASS rows=3")) throw new Error("fixture_repair_check_not_observed");
        name = "finish"; args = { summary: "Source-derived repair checked. Request host structural checks; correctness remains independently evaluated by the test." };
      } else throw new Error("unplanned_model_request");
      const send = () => respond(response, ordinal, name, args, responses);
      if (ordinal === 1) held = send; else send();
    } catch (error) { fail(error instanceof Error && error.message.startsWith("fixture_") ? error.message : "fixture_protocol_invalid"); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, responses, errors,
    get learnedFailure() { return learnedFailure; }, get selectedReference() { return selectedReference; },
    releaseFirst() { if (!held) throw new Error("fixture_response_not_held"); const send = held; held = undefined; send(); },
    async close() { held = undefined; server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
function respond(response: ServerResponse, ordinal: number, name: string, args: Record<string, unknown>, retained: string[]) {
  const text = JSON.stringify({ id: `synthetic-observation-${ordinal}`, model: observationModel,
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
      tool_calls: [{ id: `observation-action-${ordinal}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
    usage: { prompt_tokens: 128, completion_tokens: 64, total_tokens: 192 } });
  retained.push(text); response.writeHead(200, { "content-type": "application/json" }); response.end(text);
}
