/**
 * Calibration step 0 (BL-20261030-0620): the live shape probe of the Anthropic adapter. It sends four requests through the
 * real broker, model and transport on wholly synthetic text under a USD 0.30 fee cap, and prints only fixed fields (no
 * model text): a tool-less call, then a three-turn tool loop at the heavy shape whose guidance goes as the final system
 * message, whose thinking blocks are dropped, and whose first tool result is edited before the third turn, as the
 * observation projector does. It runs only in an owner-declared window, through the key wrapper:
 *
 *   scripts/with-claude-key.sh node --import tsx scripts/anthropic-probe.ts --execute-live-probe [--proxy-fake-ip true]
 *
 * Outside the runtime digest: it changes nothing a run executes.
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ANTHROPIC_MESSAGES_ENDPOINT } from "../src/main/private-agent/anthropic";
import { PrivateAgentBroker, type BrokerRequest } from "../src/main/private-agent/broker";
import { canonical, digest } from "../src/main/private-agent/contracts";
import { PrivateAgentModel, type GeneralMessage, type GeneralToolDefinition, type PrivateModelConfig } from "../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../src/main/private-agent/profiles";
import { RulePacketScanner } from "../src/main/private-agent/scanner";
import { PrivateAgentStore } from "../src/main/private-agent/store";
import { buildCloudArm } from "./private-agent-local-screen";

export const PROBE_MAX_FEE_USD = 0.3;
export const PROBE_MODEL = "claude-sonnet-5-5";
/** The approved prices (BL-20261030-0745): input, output, cache read, 5-minute write. */
export const PROBE_PRICES = { input: 2, output: 10, cached: 0.1, write: 2.5 };

const SYSTEM = ["You are a careful synthetic arithmetic agent in a test harness. Everything here is synthetic.",
  ...Array.from({ length: 40 }, (_, i) => `Rule ${i + 1}: work in exact integers, show no working in prose, and use the calculate tool for every arithmetic step; a step is one operation on two integers, and the tool returns the exact result as JSON.`),
  "Make exactly one tool call per reply until the task is done, then answer with the final integer only."].join("\n");
const TASK = "Let a be the 9th Fibonacci number (F1 = F2 = 1). Compute ((a * 37) - 101) * 12, one calculate call per step, then give the final integer.";
const GUIDANCE = "Progress: synthetic probe turn. Remaining: a few model calls; one tool call per reply.";
/** The tool-less call's system text is padded so its body clears the prompt-token envelope by a wide margin. */
const ONE_WORD = ["Answer with one word.", ...Array.from({ length: 30 }, (_, i) => `Note ${i + 1}: this synthetic padding keeps the request body far larger than any prompt the API renders from it.`)].join("\n");
const TOOL: GeneralToolDefinition = { type: "function", function: { name: "calculate", description: "Apply one integer operation and return the exact result.",
  parameters: { type: "object", properties: { op: { type: "string", enum: ["add", "subtract", "multiply"] }, a: { type: "integer" }, b: { type: "integer" } },
    required: ["op", "a", "b"], additionalProperties: false } } };
const CalculateArgumentsSchema = z.object({ op: z.enum(["add", "subtract", "multiply"]), a: z.number().int().safe(), b: z.number().int().safe() }).strict();
const DEMOTED_OBSERVATION = "[observation demoted: see the workspace]";

function calculate(argumentsJson: string): string {
  try {
    const { op, a, b } = JSON.parse(argumentsJson) as { op?: unknown; a?: unknown; b?: unknown };
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return canonical({ error: "integers required" });
    const x = a as number, y = b as number;
    return canonical(op === "add" ? { result: x + y } : op === "subtract" ? { result: x - y } : op === "multiply" ? { result: x * y } : { error: "unknown op" });
  } catch { return canonical({ error: "invalid JSON" }); }
}

const raw = z.object({ model: z.string(), stop_reason: z.string(), content: z.array(z.object({ type: z.string(), signature: z.string().optional() }).passthrough()),
  usage: z.object({ cache_creation_input_tokens: z.number().nullable().optional(), cache_read_input_tokens: z.number().nullable().optional(),
    service_tier: z.string().nullable().optional(), inference_geo: z.string().nullable().optional(), speed: z.string().nullable().optional(),
    output_tokens_details: z.object({ thinking_tokens: z.number().optional() }).passthrough().nullable().optional() }).passthrough() }).passthrough();
export interface ProbeCall {
  call: number; kind: "tool_less" | "loop"; ok: boolean; failure?: string; servedModel?: string; stopReason?: string; serviceTier?: string | null;
  inferenceGeo?: string | null; speed?: string | null; cacheWrite?: number; cacheRead?: number; thinkingTokens?: number; thinkingBlocks?: number;
  signedThinkingBlocks?: number; toolCalls?: number; feeMicrousd?: number;
}

/** Runs the four calls against any broker-shaped transport; the live run passes the real broker, tests a mock. */
export async function runProbe(broker: Pick<PrivateAgentBroker, "request">, config: PrivateModelConfig, jobId: string, contextId: string,
  onCall?: (call: ProbeCall) => void) {
  const calls: ProbeCall[] = [];
  let last: z.infer<typeof raw> | undefined;
  let currentCall = 0, firstToolId: string | undefined, editedFirstResultSent = false;
  const loopTools: { valid: boolean; id?: string }[] = [];
  // Wraps the real request so the raw reply's fixed fields are read beside the model's own decoder and settlement.
  const observed = { request: (input: BrokerRequest, settle: (bytes: Buffer) => number) => {
    // Check the serialized third loop request, not just the intended history:
    // step 0 must exercise the edited result's actual tool_result wire shape.
    if (currentCall === 4 && firstToolId) {
      try {
        const body = JSON.parse(input.body!) as { messages?: { content?: unknown }[] };
        editedFirstResultSent = (body.messages ?? []).some(message => Array.isArray(message.content) && message.content.some(block =>
          typeof block === "object" && block !== null && block.type === "tool_result" && block.tool_use_id === firstToolId && block.content === DEMOTED_OBSERVATION));
      } catch { /* A malformed body cannot prove the required history path. */ }
    }
    return broker.request(input, bytes => {
      last = undefined; try { last = raw.parse(JSON.parse(bytes.toString("utf8"))); } catch { /* the model's decoder decides */ }
      return settle(bytes);
    });
  } } as unknown as PrivateAgentBroker;
  const model = new PrivateAgentModel(observed, config, jobId, contextId);
  const record = async (call: number, kind: ProbeCall["kind"], run: () => ReturnType<PrivateAgentModel["complete"]>) => {
    currentCall = call;
    try {
      const result = await run();
      const blocks = last?.content.filter(block => block.type === "thinking" || block.type === "redacted_thinking") ?? [];
      calls.push({ call, kind, ok: true, servedModel: result.servedModel ?? "", stopReason: last?.stop_reason ?? "", serviceTier: last?.usage.service_tier ?? null,
        inferenceGeo: last?.usage.inference_geo ?? null, speed: last?.usage.speed ?? null, cacheWrite: result.usage?.cacheWriteTokens ?? 0,
        cacheRead: result.usage?.cacheReadTokens ?? 0, ...(result.usage?.thinkingTokens !== undefined ? { thinkingTokens: result.usage.thinkingTokens } : {}),
        // A redacted block counts like a signed one: either is reasoning the API returned and this adapter dropped.
        thinkingBlocks: blocks.length, signedThinkingBlocks: blocks.filter(block => block.type === "redacted_thinking" || (typeof block.signature === "string" && block.signature.length > 0)).length,
        toolCalls: result.toolCalls.length, feeMicrousd: Math.round((result.costUsd ?? 0) * 1_000_000) });
      onCall?.(calls.at(-1)!);
      return result;
    } catch (error) {
      calls.push({ call, kind, ok: false, failure: error instanceof Error && /^[a-z0-9_]{1,80}$/u.test(error.message) ? error.message : "probe_call_failed" });
      onCall?.(calls.at(-1)!);
      return undefined;
    }
  };
  await record(1, "tool_less", () => model.complete([{ role: "system", content: ONE_WORD }, { role: "user", content: "Say ready." }], [],
    new AbortController().signal, { maxOutputTokens: 1024, purpose: "anthropic shape probe" }));
  const history: GeneralMessage[] = [{ role: "system", content: SYSTEM }, { role: "user", content: TASK }];
  for (let turn = 1; turn <= 3; turn++) {
    // Before the third turn the first tool result is rewritten, as the projector demotes an old observation.
    if (turn === 3) { const first = history.findIndex(message => message.role === "tool"); if (first > 0) history[first] = { ...history[first]!, content: DEMOTED_OBSERVATION }; }
    const reply = await record(turn + 1, "loop", () => model.complete([...history, { role: "user", content: GUIDANCE }], [TOOL], new AbortController().signal,
      { purpose: "anthropic shape probe", trailingTurnMessage: true }));
    if (!reply) break;
    const call = reply.toolCalls[0];
    if (turn <= 2) {
      let valid = false;
      try { valid = reply.finishReason === "tool_calls" && reply.toolCalls.length === 1 && call?.function.name === "calculate" && CalculateArgumentsSchema.safeParse(JSON.parse(call.function.arguments)).success; }
      catch { /* Invalid tool arguments never satisfy the tool-history gate. */ }
      loopTools.push({ valid, ...(call ? { id: call.id } : {}) });
      if (turn === 1 && valid) firstToolId = call!.id;
    }
    history.push({ role: "assistant", content: reply.content || (call ? null : "[reply not executed]"), ...(call ? { tool_calls: [call] } : {}) });
    if (call) history.push({ role: "tool", tool_call_id: call.id, content: calculate(call.function.arguments) });
    else history.push({ role: "user", content: "Use the calculate tool for the next step." });
  }
  const loop = calls.filter(item => item.kind === "loop");
  const thinkingSeen = (item: ProbeCall | undefined) => item !== undefined && ((item.thinkingTokens ?? 0) > 0 || (item.signedThinkingBlocks ?? 0) > 0);
  const checks = {
    allAnswered: calls.length === 4 && calls.every(item => item.ok),
    servedModelAndTier: calls.every(item => item.ok && item.servedModel === config.model && (item.serviceTier === null || item.serviceTier === "standard")),
    geography: calls.every(item => item.inferenceGeo === null || item.inferenceGeo === "global"),
    cacheWriteThenReads: (loop[0]?.cacheWrite ?? 0) > 0 && loop.slice(1).every(item => (item.cacheRead ?? 0) > 0),
    toolLoopHistory: loopTools.length === 2 && loopTools.every(item => item.valid) && loopTools[0]!.id !== loopTools[1]!.id && editedFirstResultSent,
  };
  const thinking = { droppedTurnsHadThinking: loop.length >= 2 && loop.slice(0, 2).every(item => (item.signedThinkingBlocks ?? 0) > 0),
    laterTurnsThought: loop.slice(1).length === 2 && loop.slice(1).every(thinkingSeen) };
  const pass = Object.values(checks).every(Boolean);
  // A turn with no thinking is a reason to run the probe once more as a new job, not a failure of the adapter.
  return { calls, checks, thinking, pass, rerunAdvised: pass && !(thinking.droppedTurnsHadThinking && thinking.laterTurnsThought) };
}

/**
 * The probe's verdict: every call answered and every ledger row settled (a retried 429 or 529 fails it, since step 0
 * requires HTTP 200 throughout). Exit 0 passed; 3 passed but the model did not show thinking, so run it once more; 2 failed.
 */
export function summarizeProbe(result: Awaited<ReturnType<typeof runProbe>>, dispatches: { status: string; feeMicrousd: number }[]) {
  const allSettled = dispatches.length === result.calls.length && dispatches.every(row => row.status === "settled");
  const pass = result.pass && allSettled;
  return { ...result, pass, allSettled, dispatches, settledMicrousd: dispatches.reduce((sum, row) => sum + row.feeMicrousd, 0),
    exitCode: !pass ? 2 : result.rerunAdvised ? 3 : 0 };
}

export async function probeMain(args: string[]) {
  if (args[0] !== "--execute-live-probe" || !(args.length === 1 || (args.length === 3 && args[1] === "--proxy-fake-ip" && args[2] === "true"))) throw new Error("probe_cli_invalid");
  const arm = buildCloudArm({ model: PROBE_MODEL, endpoint: ANTHROPIC_MESSAGES_ENDPOINT, prices: PROBE_PRICES, maxFeeUsd: PROBE_MAX_FEE_USD,
    ...(args.length === 3 ? { proxyFakeIp: true as const } : {}) }, process.env, COORDINATOR_PROFILES.heavy);
  const db = new Database(":memory:"), store = new PrivateAgentStore(db), jobId = randomUUID(), contextId = randomUUID();
  try {
    store.createJob({ version: 1, id: jobId, mode: "cloud_help", revision: 0, cancelled: false, destinations: [arm.destination.id], maxRequests: 8, maxFeeMicrousd: arm.maxFeeMicrousd });
    store.createContext({ id: contextId, jobId, sources: [{ id: "probe_text", version: digest(`${SYSTEM}\n${TASK}`), classification: "public", synthetic: true }] });
    const broker = new PrivateAgentBroker(store, [arm.destination], new RulePacketScanner());
    // Each call and the ledger so far are printed as they complete, so an interrupted probe still leaves its paid receipts.
    const rows = () => store.dispatches(jobId).map(row => ({ status: row.status, feeMicrousd: row.feeMicrousd ?? 0, ...(row.failure ? { failure: row.failure } : {}) }));
    const result = await runProbe(broker, arm.modelConfig as PrivateModelConfig, jobId, contextId,
      call => process.stdout.write(`${canonical({ call, dispatches: rows() })}\n`));
    const summary = summarizeProbe(result, rows());
    process.stdout.write(`${canonical(summary)}\n`);
    process.exitCode = summary.exitCode;
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  probeMain(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${canonical({ state: "probe_failed", error: error instanceof Error && /^[a-z0-9_]{1,80}$/u.test(error.message) ? error.message : "probe_failed" })}\n`);
    process.exitCode = 1;
  });
}
