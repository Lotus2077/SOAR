import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ENTAILMENT_PROMPT_VERSION } from "../../src/main/private-agent/claims";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateAgentModel, type PrivateModelConfig } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { CLOUD_ARM_KEY_VARIABLE, buildCloudArm } from "../../scripts/private-agent-local-screen";
import { verifyJudgeFixtureInputs, type FixtureClaim } from "../../scripts/judge-fixture";
import { CALL_KINDS, CALL_STATES, CallRecordSchema, ENVELOPE_LINE, LABELLER_ENDPOINT, LABELLER_KEY_VARIABLE, LABELLER_MODEL, LABELLER_NAME, LABELLER_PRICES, LABELLING_CAP_MICROUSD,
  LABELLING_FAILURES, LABELLING_OUTCOMES, LEDGER_NAME, LOCK_NAME, LabellingSummarySchema, NOTE_MAX_CHARS, OUTPUT_TOKENS, PLANT_REJECTIONS, SECOND_REQUEST_VALUES, UNTRUSTED_SENTENCE,
  admittedEndpoint, countedMicrousd, labellerInstructions, minimumSentence, parseLabellerArguments, planRequest, reservationMicrousd, runLabelling, settlementMicrousd, shortenNote,
  stillToPlantSentence, userMessage, type LabellingOptions, type LabellingSummary } from "../../scripts/judge-labeller";
import { H5_GPT_ARM, OPENAI_ENVIRONMENT } from "./private-agent-identity-golden.fixture";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const step of cleanups.splice(0).reverse()) await step(); });
const ROOT = resolve(__dirname, "..", "..");
const PROTOCOL = readFileSync(join(ROOT, "docs", "experiments", "E0_JUDGE_LABELLING_PROTOCOL.md"), "utf8");
const KEY = "test-labeller-key-01";
const SIDECAR_RUN = "SIDECAR-RUN-NAME-r3-exposed-run";

/** Six synthetic claims; the reply labels them three supported, two partial and one unsupported. */
const PASSAGE_A = "The orchard recorded twelve healthy trees during the autumn survey, and the meadow recorded seven.";
const PASSAGE_B = "Water use fell by a fifth after the drip lines were installed in the spring of the second year.";
const CLAIMS: FixtureClaim[] = [
  { id: "C1", sentence: "The orchard had twelve healthy trees in autumn.", quote: "twelve healthy trees", context: PASSAGE_A },
  { id: "C2", sentence: "Water use fell after drip lines were installed.", quote: "Water use fell by a fifth", context: PASSAGE_B },
  { id: "C3", sentence: "Both sites had many healthy trees.", quote: "the meadow recorded seven", context: PASSAGE_A },
  { id: "C4", sentence: "Water use fell by a fifth in the first year.", quote: "Water use fell by a fifth", context: PASSAGE_B },
  { id: "C5", sentence: "The meadow recorded seven.", quote: "the meadow recorded seven", context: PASSAGE_A },
  { id: "C6", sentence: "Drip lines cost less than sprinklers.", quote: "drip lines were installed", context: PASSAGE_B },
];
const REAL_LABELS = [
  { id: "C1", label: "supported", note: null }, { id: "C2", label: "supported", note: null }, { id: "C3", label: "partial", note: "REAL-NOTE-C3 the passage names one site." },
  { id: "C4", label: "partial", note: null }, { id: "C5", label: "supported", note: null }, { id: "C6", label: "unsupported", note: null },
];
const PLANT_UNSUPPORTED = { sourceId: "C1", label: "unsupported", sentence: "The orchard had twelve healthy trees in autumn 2019.", note: "PLANT-NOTE-1 adds a year." };
const PLANT_CONTRADICTED_1 = { sourceId: "C2", label: "contradicted", sentence: "Water use rose after drip lines were installed.", note: "PLANT-NOTE-2 reverses the direction." };
const PLANT_CONTRADICTED_2 = { sourceId: "C5", label: "contradicted", sentence: "The meadow recorded nine.", note: "PLANT-NOTE-3 changes the number." };

function tempDir() { const root = mkdtempSync(join(tmpdir(), "soar-judge-labeller-")); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; }
/** A harvested set in its own .soar/experiments/e0-judge/, with the harvest's sidecar, written the way the harvest writes them. */
function harvested(claims: unknown[] = CLAIMS, origins?: unknown[]) {
  const base = tempDir(), root = join(base, ".soar", "experiments", "e0-judge");
  mkdirSync(root, { recursive: true });
  const claimsPath = join(root, "claims.json"), claimsText = `${JSON.stringify({ version: 1, task: "synthetic", claims }, null, 1)}\n`;
  writeFileSync(claimsPath, claimsText, { mode: 0o600 });
  writeFileSync(join(root, "claims.origin.json"), `${JSON.stringify({ version: 1, task: "synthetic",
    origins: origins ?? (claims as FixtureClaim[]).map(claim => ({ id: claim.id, run: SIDECAR_RUN, claimId: `C${Number(claim.id.slice(1)) + 40}` })) }, null, 1)}\n`, { mode: 0o600 });
  return { base, root, claimsPath, claimsText, labelsPath: join(root, "labels.json"), ledgerPath: join(root, LEDGER_NAME) };
}

interface Seen { url: string; headers: IncomingHttpHeaders; body: string; json: { input: { role: string; content: string }[]; max_output_tokens: number; text: { format: { name: string } } } & Record<string, unknown> }
type Scripted = { status?: number; body?: unknown; never?: true } | ((request: Seen) => { status?: number; body?: unknown; never?: true });
/** A loopback fake of the Responses endpoint: it records every request and answers from a script, in order. */
async function fake(script: Scripted[]) {
  const requests: Seen[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk as Buffer));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8"), seen: Seen = { url: request.url ?? "", headers: request.headers, body, json: JSON.parse(body) };
      requests.push(seen);
      const step = script[requests.length - 1], reply = typeof step === "function" ? step(seen) : step;
      if (!reply || reply.never) return;
      response.writeHead(reply.status ?? 200, { "content-type": "application/json", "x-request-id": `req_fake_${requests.length}` });
      response.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
  const address = server.address() as { port: number };
  return { endpoint: `http://127.0.0.1:${address.port}/v1/responses`, requests };
}
/** A Responses reply whose usage stays inside the request's projection unless `usage` overrides it. */
function reply(payload: unknown, usage: Partial<{ input: number; cached: number; written: number | null; output: number; reasoning: number }> = {}, extra: Record<string, unknown> = {}) {
  return (seen: Seen) => ({ body: { id: "resp_fake", object: "response", model: "gpt-6-sol-2026-09-22", status: "completed", service_tier: "default",
    output: [{ type: "reasoning", id: "rs_fake", summary: [] },
      { type: "message", id: "msg_fake", role: "assistant", status: "completed", content: [{ type: "output_text", text: typeof payload === "string" ? payload : JSON.stringify(payload), annotations: [] }] }],
    usage: { input_tokens: usage.input ?? Math.floor(Buffer.byteLength(seen.body) / 4), input_tokens_details: { cached_tokens: usage.cached ?? 0, ...(usage.written === null ? {} : { cache_write_tokens: usage.written ?? 0 }) },
      output_tokens: usage.output ?? 1_500, output_tokens_details: { reasoning_tokens: usage.reasoning ?? 900 } }, ...extra } });
}
const fullReply = (planted: unknown[] = [PLANT_UNSUPPORTED, PLANT_CONTRADICTED_1, PLANT_CONTRADICTED_2], labels: unknown[] = REAL_LABELS) => reply({ labels, planted });
function options(set: ReturnType<typeof harvested>, endpoint: string, overrides: Partial<LabellingOptions> = {}): LabellingOptions {
  let tick = 0;
  return { claimsPath: set.claimsPath, root: set.root, minimumPerClass: 2, protocolText: PROTOCOL, apiKey: KEY, endpoint,
    now: () => new Date(Date.UTC(2026, 10, 15, 20, 0, 0, tick++)), ...overrides };
}
/** The protocol's step 2 and 3 sections, cut independently of the tool: from the step 2 heading to the "## Files" heading. */
function protocolSteps(): string {
  const start = PROTOCOL.indexOf("## Step 2: label\n"), end = PROTOCOL.indexOf("\n## Files\n");
  return PROTOCOL.slice(start, end).replace(/\n+$/u, "");
}
const runDirectories = (root: string) => readdirSync(root).filter(name => /^labelling-[0-9]{4}-/u.test(name));
const mode = (path: string) => statSync(path).mode & 0o777;

describe("E0 judge labeller: what leaves the machine", () => {
  it("sends the protocol's steps 2 and 3 word for word, then claims.json's exact text and the minimum, and nothing else", async () => {
    const set = harvested(), server = await fake([fullReply()]);
    await runLabelling(options(set, server.endpoint));
    expect(server.requests).toHaveLength(1);
    const [request] = server.requests;
    expect(request!.url).toBe("/v1/responses");
    expect(request!.headers.authorization).toBe(`Bearer ${KEY}`);
    const steps = protocolSteps();
    expect(steps.startsWith("## Step 2: label\n\nThe labeller receives the definitions and rules of this step and of step 3, word")).toBe(true);
    expect(steps).toContain("\n## Step 3: plant negatives up to the minimum\n");
    expect(steps.endsWith("fixture reports the planted claims' detection separately (`plantedNotEstablished`).")).toBe(true);
    expect(labellerInstructions(PROTOCOL)).toBe(steps);
    expect(request!.json.input).toEqual([{ type: "message", role: "system", content: steps },
      { type: "message", role: "user", content: `${UNTRUSTED_SENTENCE}\n\nclaims.json:\n${set.claimsText}\n${minimumSentence(2)}` }]);
    expect(request!.json).toMatchObject({ model: LABELLER_MODEL, store: false, service_tier: "default", reasoning: { effort: "medium" },
      text: { format: { type: "json_schema", name: "e0_judge_labels", strict: true } } });
    expect(Object.keys(request!.json).sort()).toEqual(["input", "max_output_tokens", "model", "reasoning", "service_tier", "store", "text"]);
    // No provenance, path, address or key: the sidecar's run name and claim ids, the directories, and the endpoint never appear.
    for (const absent of [SIDECAR_RUN, "C41", "claims.origin.json", "claimId", set.base, set.root, homedir(), "127.0.0.1", KEY, ".soar"]) expect(request!.body).not.toContain(absent);
  });

  it("refuses any endpoint but the owner's host or the tests' loopback fake, before reading anything", async () => {
    expect(admittedEndpoint(LABELLER_ENDPOINT).href).toBe("https://api.openai.com/v1/responses");
    for (const endpoint of ["https://api.openai.com/v1/chat/completions", "https://example.com/v1/responses", "http://api.openai.com/v1/responses", "http://10.0.0.5:8000/v1/responses",
      "http://user:pass@127.0.0.1:9/v1/responses", "not a url"]) expect(() => admittedEndpoint(endpoint)).toThrow("labeller_endpoint_refused");
    expect(LABELLER_KEY_VARIABLE).toBe(CLOUD_ARM_KEY_VARIABLE);
  });
});

describe("E0 judge labeller: the cap", () => {
  it("projects with model.ts's own reservation in both tiers, at H5's pinned gpt-6-sol prices, and settles with its own settlement", async () => {
    expect(LABELLER_PRICES).toEqual({ input: H5_GPT_ARM.prices.input, cached: H5_GPT_ARM.prices.cached, write: H5_GPT_ARM.prices.write, output: H5_GPT_ARM.prices.output,
      longContext: { aboveTokens: H5_GPT_ARM.longContext.aboveTokens, input: H5_GPT_ARM.longContext.input, cached: H5_GPT_ARM.longContext.cached, write: H5_GPT_ARM.longContext.write,
        output: H5_GPT_ARM.longContext.output } });
    const config = buildCloudArm(H5_GPT_ARM, OPENAI_ENVIRONMENT, COORDINATOR_PROFILES.heavy).modelConfig as PrivateModelConfig;
    let settled = 0;
    const usage = { input_tokens: 50, input_tokens_details: { cached_tokens: 10, cache_write_tokens: 20 }, output_tokens: 100 };
    const broker = { request: async (_input: unknown, settle: (bytes: Buffer) => number) => {
      const bytes = Buffer.from(JSON.stringify({ model: "gpt-6-sol", service_tier: "default", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}" }] }], usage }));
      settled = settle(bytes);
      return { bytes, receipt: { feeMicrousd: settled } };
    }, requestTimeoutMs: () => 600_000, zeroRiskDispatch: () => false } as unknown as PrivateAgentBroker;
    const model = new PrivateAgentModel(broker, config, "job-labeller-parity", "context-labeller-parity");
    for (const bytes of [1, 4_096, 271_999, 272_000, 272_001, 400_000]) for (const cap of [8_192, 40_000, OUTPUT_TOKENS.ceiling]) {
      expect(reservationMicrousd(bytes, cap)).toBe(model.reservationMicrousd(bytes, cap));
    }
    await model.complete([{ role: "system", content: "Synthetic parity check." }, { role: "user", content: "Reply with an empty object." }], [], new AbortController().signal);
    expect(settled).toBe(settlementMicrousd({ promptTokens: 50, cachedTokens: 10, cacheWriteTokens: 20, completionTokens: 100 }));
    expect(settled).toBe(Math.ceil(20 * 2 + 20 * 2.5 + 10 * 0.2 + 100 * 10));
    // Above 272K prompt tokens the long tier settles: 300,000 uncached input at 4 and 1,000 output at 15.
    expect(settlementMicrousd({ promptTokens: 300_000, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 1_000 })).toBe(1_215_000);
  });

  it("derives the output cap from the claim count and shrinks it to fit what the cap has left, never past it", () => {
    const instructions = labellerInstructions(PROTOCOL), user = userMessage(`${JSON.stringify({ version: 1, task: "synthetic", claims: CLAIMS }, null, 1)}\n`, minimumSentence(2));
    const roomy = planRequest("label_and_plant", instructions, user, 6, 6, LABELLING_CAP_MICROUSD);
    expect("refusal" in roomy).toBe(false);
    if ("refusal" in roomy) return;
    expect(roomy.maxOutputTokens).toBe(OUTPUT_TOKENS.base + 6 * OUTPUT_TOKENS.perClaim + 6 * OUTPUT_TOKENS.perPlant);
    expect(roomy.projectedMicrousd).toBe(reservationMicrousd(roomy.bodyBytes, roomy.maxOutputTokens));
    const floor = OUTPUT_TOKENS.floorBase + 6 * OUTPUT_TOKENS.floorPerClaim + 6 * OUTPUT_TOKENS.floorPerPlant;
    for (const remaining of [roomy.projectedMicrousd, roomy.projectedMicrousd - 1, roomy.projectedMicrousd - 50_000, reservationMicrousd(roomy.bodyBytes + 8, floor) + 3]) {
      const plan = planRequest("label_and_plant", instructions, user, 6, 6, remaining);
      expect("refusal" in plan).toBe(false);
      if ("refusal" in plan) continue;
      expect(plan.projectedMicrousd).toBeLessThanOrEqual(remaining);
      expect(plan.maxOutputTokens).toBeGreaterThanOrEqual(floor);
      expect(plan.maxOutputTokens).toBeLessThanOrEqual(roomy.maxOutputTokens);
    }
    expect(planRequest("label_and_plant", instructions, user, 6, 6, reservationMicrousd(roomy.bodyBytes, floor) - 1)).toEqual({ refusal: "labeller_cap_exceeded" });
    expect(planRequest("label_and_plant", instructions, user, 6, 6, -5)).toEqual({ refusal: "labeller_cap_exceeded" });
  });

  it("refuses before any request when the projection would pass what the ledger leaves, counting an unsettled reservation", async () => {
    const set = harvested(), server = await fake([fullReply()]);
    writeFileSync(set.ledgerPath, [
      { version: 1, run: "labelling-2026-11-15T190000000Z", call: 1, event: "reserved", microusd: 700_000, utc: "2026-11-15T19:00:00.000Z" },
      { version: 1, run: "labelling-2026-11-15T190000000Z", call: 1, event: "settled", microusd: 400_000, utc: "2026-11-15T19:01:00.000Z" },
      { version: 1, run: "labelling-2026-11-15T193000000Z", call: 1, event: "reserved", microusd: 560_000, utc: "2026-11-15T19:30:00.000Z" },
    ].map(line => JSON.stringify(line)).join("\n") + "\n");
    expect(countedMicrousd(readFileSync(set.ledgerPath, "utf8"))).toBe(960_000);
    await expect(runLabelling(options(set, server.endpoint))).rejects.toThrow("labeller_cap_exceeded");
    const dry = await runLabelling(options(set, server.endpoint, { dryRun: true, apiKey: undefined }));
    expect(dry).toMatchObject({ exitCode: 2, printed: { dryRun: true, admitted: false, refusal: "labeller_cap_exceeded", priorCountedUsd: 0.96, capUsd: 1 } });
    expect(server.requests).toHaveLength(0);
    expect(existsSync(set.labelsPath)).toBe(false);
    expect(runDirectories(set.root)).toHaveLength(0);
    expect(existsSync(join(set.root, LOCK_NAME))).toBe(false);
    expect(readFileSync(set.claimsPath, "utf8")).toBe(set.claimsText);
  });
});

describe("E0 judge labeller: the files", () => {
  it("writes claims.json and labels.json that the judge fixture accepts under a manifest pinned from the summary", async () => {
    const set = harvested(), server = await fake([fullReply()]);
    const result = await runLabelling(options(set, server.endpoint));
    expect(result.exitCode).toBe(0);
    const summary = result.summary!;
    expect(summary).toMatchObject({ outcome: "labelled", failure: null, secondRequest: null, modelCalls: 1, cloudModel: "gpt-6-sol", servedModel: "gpt-6-sol-2026-09-22",
      labeller: LABELLER_NAME, claims: { harvested: 6, planted: 3, minimumPerClass: 2, labelCounts: { supported: 3, partial: 2, unsupported: 2, contradicted: 2 }, belowMinimum: null } });
    const claims = JSON.parse(readFileSync(set.claimsPath, "utf8")), labels = JSON.parse(readFileSync(set.labelsPath, "utf8"));
    expect(mode(set.claimsPath)).toBe(0o600); expect(mode(set.labelsPath)).toBe(0o600);
    // The harvested claims are unchanged; each planted one carries its source's quote and context and the next free id, and no origin.
    expect(claims.claims.slice(0, 6)).toEqual(CLAIMS);
    expect(claims.claims.slice(6)).toEqual([
      { id: "C7", sentence: PLANT_UNSUPPORTED.sentence, quote: CLAIMS[0]!.quote, context: CLAIMS[0]!.context },
      { id: "C8", sentence: PLANT_CONTRADICTED_1.sentence, quote: CLAIMS[1]!.quote, context: CLAIMS[1]!.context },
      { id: "C9", sentence: PLANT_CONTRADICTED_2.sentence, quote: CLAIMS[4]!.quote, context: CLAIMS[4]!.context }]);
    expect(labels).toEqual({ version: 1, protocol: "e0-judge-labelling-v1", labeller: "openai/gpt-6-sol", labels: [
      { id: "C1", label: "supported", planted: false }, { id: "C2", label: "supported", planted: false },
      { id: "C3", label: "partial", planted: false, note: "REAL-NOTE-C3 the passage names one site." }, { id: "C4", label: "partial", planted: false },
      { id: "C5", label: "supported", planted: false }, { id: "C6", label: "unsupported", planted: false },
      { id: "C7", label: "unsupported", planted: true, note: PLANT_UNSUPPORTED.note }, { id: "C8", label: "contradicted", planted: true, note: PLANT_CONTRADICTED_1.note },
      { id: "C9", label: "contradicted", planted: true, note: PLANT_CONTRADICTED_2.note }] });
    const manifest = { schemaVersion: 1, name: "e0-judge-fixture-labeller-test", status: "pinned", task: "synthetic", exposure: "exposed", promptVersion: ENTAILMENT_PROMPT_VERSION,
      claimsSha256: summary.claims.claimsSha256, labelsSha256: summary.claims.labelsSha256, claimCount: 9, labelCounts: summary.claims.labelCounts,
      plantedCount: summary.claims.planted, minimumPerClass: 2, agreement: { measure: "exact", level: 0.95 }, conditions: ["j1-legacy"], repeats: 1 };
    const verified = verifyJudgeFixtureInputs({ claims: readFileSync(set.claimsPath), labels: readFileSync(set.labelsPath), manifest });
    expect(verified).toMatchObject({ plantedCount: 3, labelCounts: { supported: 3, partial: 2, unsupported: 2, contradicted: 2 } });
    // The ledger settles the one request at its reported usage, within its reservation; the lock is gone.
    const ledger = readFileSync(set.ledgerPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(ledger.map(line => line.event)).toEqual(["reserved", "settled"]);
    expect(ledger[1].microusd).toBeLessThanOrEqual(ledger[0].microusd);
    expect(summary.usd).toBe(ledger[1].microusd / 1_000_000);
    expect(summary).toMatchObject({ envelopeLine: ENVELOPE_LINE, reservedUnknownUsd: 0, unknownDispatches: 0, rejectedDispatches: 0, calls: [{ state: "settled", cacheWriteReported: true }] });
    expect(mode(set.ledgerPath)).toBe(0o600);
    expect(existsSync(join(set.root, LOCK_NAME))).toBe(false);
    // The run directory keeps the exact request and the raw reply, private; the summary and the printed line carry no path, key, claim text or label.
    const [run] = runDirectories(set.root);
    expect(run).toBe(summary.run);
    expect(readFileSync(join(set.root, run!, "requests", "call-1.json"), "utf8")).toBe(server.requests[0]!.body);
    for (const file of ["requests/call-1.json", "replies/call-1.json", "summary.json"]) expect(mode(join(set.root, run!, file))).toBe(0o600);
    expect(mode(join(set.root, run!))).toBe(0o700);
    const written = readFileSync(join(set.root, run!, "summary.json"), "utf8"), printed = JSON.stringify(result.printed);
    expect(JSON.parse(written)).toEqual(summary);
    for (const text of [written, printed]) {
      for (const absent of [set.base, homedir(), KEY, "127.0.0.1", SIDECAR_RUN, "REAL-NOTE-C3", "PLANT-NOTE", PASSAGE_A.slice(0, 30), CLAIMS[0]!.sentence, PLANT_UNSUPPORTED.sentence]) {
        expect(text).not.toContain(absent);
      }
    }
  });

  it("asks a second request for the counts still to plant, carrying no label and no planted sentence, and stops at two", async () => {
    const set = harvested(), server = await fake([fullReply([PLANT_CONTRADICTED_1]),
      reply({ planted: [PLANT_UNSUPPORTED, PLANT_CONTRADICTED_2, { ...PLANT_CONTRADICTED_2, sourceId: "C6", sentence: "Drip lines cost more than sprinklers." }] })]);
    const result = await runLabelling(options(set, server.endpoint));
    expect(server.requests).toHaveLength(2);
    const [first, second] = server.requests;
    expect(second!.json.text.format.name).toBe("e0_judge_plants");
    expect(second!.json.input).toEqual([first!.json.input[0],
      { type: "message", role: "user", content: userMessage(set.claimsText, stillToPlantSentence({ partial: 0, unsupported: 1, contradicted: 1 })) }]);
    expect(second!.json.input[1]!.content.startsWith(first!.json.input[1]!.content.slice(0, first!.json.input[1]!.content.indexOf(minimumSentence(2))))).toBe(true);
    for (const absent of [PLANT_CONTRADICTED_1.sentence, PLANT_CONTRADICTED_1.note, "REAL-NOTE-C3", SIDECAR_RUN]) expect(second!.body).not.toContain(absent);
    expect(result).toMatchObject({ exitCode: 0, summary: { outcome: "labelled", secondRequest: "sent", modelCalls: 2,
      claims: { planted: 3, labelCounts: { supported: 3, partial: 2, unsupported: 2, contradicted: 2 }, plantedRejected: { surplus: 1 } } } });
    expect(result.summary!.calls.map(call => [call.call, call.kind, call.state])).toEqual([[1, "label_and_plant", "settled"], [2, "plant_only", "settled"]]);
    const ledger = readFileSync(set.ledgerPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(ledger.map(line => `${line.call}:${line.event}`)).toEqual(["1:reserved", "1:settled", "2:reserved", "2:settled"]);
  });

  it("reports a class still short after two requests, and writes the labels it has", async () => {
    const set = harvested(), server = await fake([fullReply([]), reply({ planted: [PLANT_CONTRADICTED_1] }), fullReply()]);
    const result = await runLabelling(options(set, server.endpoint));
    expect(server.requests).toHaveLength(2);
    expect(result).toMatchObject({ exitCode: 3, summary: { outcome: "labelled_below_minimum", secondRequest: "sent", claims: { planted: 1, belowMinimum: { unsupported: 1, contradicted: 1 } } } });
    expect(JSON.parse(readFileSync(set.labelsPath, "utf8")).labels).toHaveLength(7);
  });

  it("shortens an over-long note to labels.json's bound and rejects invalid planted claims by reason", async () => {
    const face = String.fromCodePoint(0x1f600), long = `${"n".repeat(NOTE_MAX_CHARS - 1)}${face}tail`;
    expect(shortenNote(long)).toEqual({ note: "n".repeat(NOTE_MAX_CHARS - 1), shortened: true });
    expect(shortenNote("short")).toEqual({ note: "short", shortened: false });
    const labels = REAL_LABELS.map(item => item.id === "C4" ? { ...item, note: long } : item);
    const planted = [
      { ...PLANT_UNSUPPORTED, sourceId: "C99" }, { ...PLANT_UNSUPPORTED, sentence: CLAIMS[0]!.sentence }, { ...PLANT_UNSUPPORTED, sentence: CLAIMS[2]!.sentence, sourceId: "C5" },
      { ...PLANT_UNSUPPORTED, note: "" }, { ...PLANT_UNSUPPORTED, sentence: "x".repeat(601) },
      { ...PLANT_UNSUPPORTED, note: long }, { ...PLANT_UNSUPPORTED, sentence: `${PLANT_UNSUPPORTED.sentence} Again.` },
      PLANT_CONTRADICTED_1, PLANT_CONTRADICTED_1, PLANT_CONTRADICTED_2];
    const set = harvested(), server = await fake([fullReply(planted, labels)]);
    const result = await runLabelling(options(set, server.endpoint));
    expect(result.summary!.claims).toMatchObject({ planted: 3, notesShortened: 2,
      plantedRejected: { unknown_source: 1, unchanged_sentence: 1, duplicate: 2, empty_note: 1, sentence_bounds: 1, surplus: 1 } });
    const written = JSON.parse(readFileSync(set.labelsPath, "utf8")).labels as { id: string; note?: string }[];
    expect(written.find(item => item.id === "C4")!.note).toBe("n".repeat(NOTE_MAX_CHARS - 1));
    expect(written.find(item => item.id === "C7")!.note).toBe("n".repeat(NOTE_MAX_CHARS - 1));
    // The raw reply keeps the full note.
    expect(readFileSync(join(set.root, result.summary!.run, "replies", "call-1.json"), "utf8")).toContain(`${face}tail`);
  });
});

describe("E0 judge labeller: failing closed", () => {
  it("fails closed when the reported usage leaves the projection: nothing written, the reservation counted, no second request", async () => {
    for (const [usage, extra] of [[{ input: 10_000_000 }, {}], [{ output: 10_000_000 }, {}], [{ input: 0 }, {}], [{ cached: 9_000_000 }, {}], [{}, { service_tier: "priority" }]] as const) {
      const set = harvested(), server = await fake([reply({ labels: REAL_LABELS, planted: [] }, usage, extra), fullReply()]);
      const result = await runLabelling(options(set, server.endpoint));
      expect(server.requests).toHaveLength(1);
      expect(result).toMatchObject({ exitCode: 2, summary: { outcome: "failed", failure: "labeller_usage_outside_projection", usd: 0, unknownDispatches: 1,
        calls: [{ state: "outside_projection", usd: null }] } });
      const call = result.summary!.calls[0]!;
      expect(result.summary!.reservedUnknownUsd).toBe(call.countedUsd);
      expect(call.countedUsd).toBeGreaterThanOrEqual(call.projectedUsd);
      expect(existsSync(set.labelsPath)).toBe(false);
      expect(readFileSync(set.claimsPath, "utf8")).toBe(set.claimsText);
      expect(countedMicrousd(readFileSync(set.ledgerPath, "utf8"))).toBe(Math.round(call.countedUsd * 1_000_000));
    }
  });

  it("settles a rejection at zero, counts a 5xx and a timeout at their reservations, and a refused connection at zero", async () => {
    const rejected = harvested(), server = await fake([{ status: 401, body: { error: { type: "invalid_request_error", code: "invalid_api_key", message: "Incorrect API key sk-...0001" } } },
      { status: 503, body: { error: { message: "overloaded" } } }, { never: true }]);
    const first = await runLabelling(options(rejected, server.endpoint));
    expect(first).toMatchObject({ exitCode: 2, summary: { failure: "labeller_rejected", rejectedDispatches: 1, unknownDispatches: 0, usd: 0, reservedUnknownUsd: 0,
      calls: [{ state: "rejected", httpStatus: 401, errorType: "invalid_request_error", errorCode: "invalid_api_key", usd: 0, countedUsd: 0, inputTokens: 0 }] } });
    expect(countedMicrousd(readFileSync(rejected.ledgerPath, "utf8"))).toBe(0);
    expect(JSON.stringify(first.summary)).not.toContain("Incorrect API key");
    const unavailable = harvested(), second = await runLabelling(options(unavailable, server.endpoint));
    expect(second).toMatchObject({ exitCode: 2, summary: { failure: "labeller_http_status", unknownDispatches: 1, usd: 0, calls: [{ state: "unknown", httpStatus: 503, usd: null }] } });
    expect(second.summary!.reservedUnknownUsd).toBe(second.summary!.calls[0]!.projectedUsd);
    expect(countedMicrousd(readFileSync(unavailable.ledgerPath, "utf8"))).toBe(Math.round(second.summary!.calls[0]!.projectedUsd * 1_000_000));
    const slow = harvested(), third = await runLabelling(options(slow, server.endpoint, { timeoutMs: 300 }));
    expect(third).toMatchObject({ exitCode: 2, summary: { failure: "labeller_timeout", calls: [{ state: "unknown", httpStatus: null }] } });
    expect(third.summary!.reservedUnknownUsd).toBe(third.summary!.calls[0]!.projectedUsd);
    // A closed port: the connection is refused before any byte of the request leaves, so nothing is counted.
    const closed = createServer();
    await new Promise<void>(done => closed.listen(0, "127.0.0.1", done));
    const port = (closed.address() as { port: number }).port;
    await new Promise<void>(done => closed.close(() => done()));
    const refused = harvested(), fourth = await runLabelling(options(refused, `http://127.0.0.1:${port}/v1/responses`));
    expect(fourth).toMatchObject({ exitCode: 2, summary: { failure: "labeller_transport_failed", usd: 0, reservedUnknownUsd: 0, rejectedDispatches: 1,
      calls: [{ state: "not_sent", httpStatus: null, usd: 0, countedUsd: 0 }] } });
    for (const set of [rejected, unavailable, slow, refused]) { expect(existsSync(set.labelsPath)).toBe(false); expect(readFileSync(set.claimsPath, "utf8")).toBe(set.claimsText); }
  });

  it("writes nothing when the reply misses a label, repeats one, is cut at the output cap, is refused, or comes from another model", async () => {
    const cases: [Scripted, string][] = [
      [fullReply([], REAL_LABELS.slice(1)), "labeller_labels_incomplete"],
      [fullReply([], [...REAL_LABELS.slice(1), REAL_LABELS[1]]), "labeller_labels_incomplete"],
      [fullReply([], [...REAL_LABELS, { id: "C77", label: "supported", note: null }]), "labeller_labels_incomplete"],
      [reply({ labels: REAL_LABELS, planted: [] }, {}, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), "labeller_reply_cut_at_output_cap"],
      [reply({ labels: REAL_LABELS, planted: [] }, {}, { output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "No." }] }] }), "labeller_reply_refused"],
      [reply({ labels: REAL_LABELS, planted: [] }, {}, { model: "gpt-6-luna" }), "labeller_served_model_mismatch"],
      [reply("not json"), "labeller_reply_invalid"],
      [{ body: "<html>proxy error</html>" }, "labeller_reply_undecodable"],
    ];
    for (const [script, failure] of cases) {
      const set = harvested(), server = await fake([script]);
      const result = await runLabelling(options(set, server.endpoint));
      expect(server.requests).toHaveLength(1);
      expect(result).toMatchObject({ exitCode: 2, summary: { outcome: "failed", failure } });
      expect(existsSync(set.labelsPath)).toBe(false);
      expect(readFileSync(set.claimsPath, "utf8")).toBe(set.claimsText);
    }
  });

  it("refuses each invalid input before any request, and writes nothing", async () => {
    const server = await fake([fullReply()]);
    const refusals: [() => LabellingOptions, string][] = [
      [() => { const set = harvested(); return options(set, server.endpoint, { minimumPerClass: 0 }); }, "labeller_minimum_invalid"],
      [() => { const set = harvested(); return options(set, "https://example.com/v1/responses"); }, "labeller_endpoint_refused"],
      [() => { const set = harvested(); return options(set, server.endpoint, { protocolText: PROTOCOL.replace("## Step 3: plant negatives up to the minimum", "## Step 3") }); }, "labeller_protocol_unrecognised"],
      [() => { const set = harvested(); return options(set, server.endpoint, { protocolText: PROTOCOL.replace("## Files", "## Files and more\n\n## Step 2b: extra\n\n## Files") }); }, "labeller_protocol_unrecognised"],
      [() => { const set = harvested(), outside = join(set.base, "claims.json"); writeFileSync(outside, set.claimsText); return options(set, server.endpoint, { claimsPath: outside }); }, "labeller_claims_outside_root"],
      [() => { const set = harvested(), other = join(set.root, "other.json"); writeFileSync(other, set.claimsText); return options(set, server.endpoint, { claimsPath: other }); }, "labeller_claims_name_invalid"],
      [() => options(harvested(CLAIMS.map(claim => ({ ...claim, origin: SIDECAR_RUN })) as unknown[]), server.endpoint), "labeller_claims_invalid"],
      [() => options(harvested(CLAIMS, CLAIMS.slice(0, 5).map(claim => ({ id: claim.id, run: SIDECAR_RUN, claimId: claim.id }))), server.endpoint), "labeller_claims_not_harvested"],
      [() => { const set = harvested(); rmSync(join(set.root, "claims.origin.json")); return options(set, server.endpoint); }, "labeller_claims_not_harvested"],
      [() => { const set = harvested(); writeFileSync(set.labelsPath, "{}"); return options(set, server.endpoint); }, "labeller_labels_exist"],
      [() => options(harvested(), server.endpoint, { apiKey: undefined }), "labeller_key_missing"],
      [() => options(harvested(), server.endpoint, { apiKey: "short" }), "labeller_key_missing"],
      [() => { const set = harvested(); writeFileSync(set.ledgerPath, "{\"version\":1,\"run\":\"labelling-x\",\"call\":1,\"event\":\"settled\",\"microusd\":0,\"utc\":\"t\"}\n"); return options(set, server.endpoint); }, "labeller_ledger_invalid"],
      [() => { const set = harvested(); writeFileSync(set.ledgerPath, "{\"version\":1,"); return options(set, server.endpoint); }, "labeller_ledger_invalid"],
      [() => { const set = harvested(); writeFileSync(join(set.root, LOCK_NAME), ""); return options(set, server.endpoint); }, "labeller_busy"],
    ];
    for (const [build, code] of refusals) {
      const input = build(), before = readFileSync(input.claimsPath, "utf8");
      await expect(runLabelling(input)).rejects.toThrow(code);
      expect(readFileSync(input.claimsPath, "utf8")).toBe(before);
      expect(runDirectories(input.root)).toHaveLength(0);
    }
    expect(server.requests).toHaveLength(0);
  });

  it("never labels a set twice: once labels.json exists, or once claims.json holds planted claims, the tool refuses", async () => {
    const set = harvested(), server = await fake([fullReply(), fullReply()]);
    await runLabelling(options(set, server.endpoint));
    await expect(runLabelling(options(set, server.endpoint))).rejects.toThrow("labeller_labels_exist");
    rmSync(set.labelsPath);
    await expect(runLabelling(options(set, server.endpoint))).rejects.toThrow("labeller_claims_not_harvested");
    expect(server.requests).toHaveLength(1);
  });
});

describe("E0 judge labeller: the summary contract (lane S-harn's registry row)", () => {
  it("writes the summary ahead of each request, so a killed tool still leaves the call counted at its reservation", async () => {
    const set = harvested(), seen: LabellingSummary[] = [];
    const ahead = (step: Scripted) => (request: Seen) => {
      const [run] = runDirectories(set.root);
      seen.push(LabellingSummarySchema.parse(JSON.parse(readFileSync(join(set.root, run!, "summary.json"), "utf8"))));
      return typeof step === "function" ? step(request) : step;
    };
    const server = await fake([ahead(fullReply([PLANT_CONTRADICTED_1])), ahead(reply({ planted: [PLANT_UNSUPPORTED, PLANT_CONTRADICTED_2] }))]);
    const result = await runLabelling(options(set, server.endpoint));
    expect(server.requests).toHaveLength(2);
    expect(seen[0]).toMatchObject({ outcome: "failed", failure: "labeller_interrupted", modelCalls: 1, unknownDispatches: 1, usd: 0,
      calls: [{ call: 1, state: "unknown", failure: "labeller_interrupted", usd: null, httpStatus: null }], claims: { claimsSha256: null, labelsSha256: null } });
    expect(seen[0]!.reservedUnknownUsd).toBe(seen[0]!.calls[0]!.projectedUsd);
    // While the second request is in flight, the first is settled and the second counts at its reservation.
    expect(seen[1]).toMatchObject({ outcome: "failed", failure: "labeller_interrupted", modelCalls: 2, unknownDispatches: 1,
      calls: [{ call: 1, state: "settled", failure: null }, { call: 2, state: "unknown", failure: "labeller_interrupted" }] });
    expect(seen[1]!.usd).toBe(seen[1]!.calls[0]!.usd);
    expect(seen[1]!.reservedUnknownUsd).toBe(seen[1]!.calls[1]!.projectedUsd);
    expect(result.summary).toMatchObject({ outcome: "labelled", failure: null, modelCalls: 2, unknownDispatches: 0, reservedUnknownUsd: 0 });
    expect(JSON.parse(readFileSync(join(set.root, result.summary!.run, "summary.json"), "utf8"))).toEqual(result.summary);
    expect(readdirSync(join(set.root, result.summary!.run)).sort()).toEqual(["replies", "requests", "summary.json"]);
  });

  it("settles a reply that does not report its cache writes as if every uncached input token was written", async () => {
    const set = harvested(), server = await fake([reply({ labels: REAL_LABELS, planted: [PLANT_UNSUPPORTED, PLANT_CONTRADICTED_1, PLANT_CONTRADICTED_2] },
      { input: 2_000, cached: 100, written: null, output: 1_500, reasoning: 700 })]);
    const result = await runLabelling(options(set, server.endpoint));
    expect(settlementMicrousd({ promptTokens: 2_000, cachedTokens: 100, cacheWriteTokens: 1_900, completionTokens: 1_500 })).toBe(1_900 * 2.5 + 100 * 0.2 + 1_500 * 10);
    expect(result.summary).toMatchObject({ outcome: "labelled", usd: 0.01977, cacheWriteTokens: 1_900,
      calls: [{ state: "settled", inputTokens: 2_000, cachedTokens: 100, cacheWriteTokens: 1_900, cacheWriteReported: false, usd: 0.01977, countedUsd: 0.01977 }] });
  });

  it("pins the agreed keys and closed sets, and refuses a summary that breaks a cross-check", async () => {
    expect(Object.keys(CallRecordSchema.shape)).toEqual(["call", "kind", "httpStatus", "state", "failure", "projectedUsd", "usd", "countedUsd", "maxOutputTokens", "bodyBytes",
      "bodySha256", "inputTokens", "cachedTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens", "cacheWriteReported", "elapsedMs", "servedModel", "requestId",
      "errorType", "errorCode"]);
    expect(Object.keys(LabellingSummarySchema.shape)).toEqual(["version", "kind", "protocol", "labeller", "cloudModel", "cloudApi", "servedModel", "envelopeLine", "run",
      "startedUtc", "finishedUtc", "outcome", "failure", "secondRequest", "modelCalls", "rejectedDispatches", "unknownDispatches", "inputTokens", "cachedTokens",
      "cacheWriteTokens", "outputTokens", "reasoningTokens", "usd", "reservedUnknownUsd", "priorCountedUsd", "capUsd", "instructionsSha256", "prices", "calls", "claims"]);
    expect(Object.keys(LabellingSummarySchema.shape.claims.shape.plantedRejected.shape)).toEqual([...PLANT_REJECTIONS]);
    expect([LABELLING_OUTCOMES, CALL_KINDS, CALL_STATES, SECOND_REQUEST_VALUES].map(set => [...set])).toEqual([["labelled", "labelled_below_minimum", "failed"],
      ["label_and_plant", "plant_only"], ["settled", "rejected", "not_sent", "unknown", "outside_projection"], ["sent", "labeller_cap_exceeded"]]);
    expect(LABELLING_FAILURES).toHaveLength(18);
    expect(LABELLING_FAILURES.every(code => /^labeller_[a-z_]+$/u.test(code))).toBe(true);
    const set = harvested(), server = await fake([fullReply()]);
    const summary = (await runLabelling(options(set, server.endpoint))).summary!;
    expect(LabellingSummarySchema.safeParse(summary).success).toBe(true);
    const call = summary.calls[0]!;
    const broken: [string, Record<string, unknown>][] = [
      ["usd", { usd: summary.usd + 0.000001 }], ["reservedUnknownUsd", { reservedUnknownUsd: 0.5 }], ["modelCalls", { modelCalls: 2 }],
      ["unknownDispatches", { unknownDispatches: 1 }], ["rejectedDispatches", { rejectedDispatches: 1 }], ["outputTokens", { outputTokens: summary.outputTokens + 1 }],
      ["an extra key", { costUsd: 1 }], ["a failure outside the set", { failure: "labeller_something_else" }], ["an outcome outside the set", { outcome: "accepted" }],
      ["labelled with a shortfall", { claims: { ...summary.claims, belowMinimum: { contradicted: 1 } } }],
      ["failed with files written", { outcome: "failed", failure: "labeller_reply_invalid" }],
      ["a settled call without its fee", { calls: [{ ...call, usd: null }] }], ["a rejected call with a fee", { calls: [{ ...call, state: "rejected", httpStatus: 401 }] }],
      ["an unknown call under its reservation", { calls: [{ ...call, state: "unknown", usd: null, inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0,
        cacheWriteReported: false }], usd: 0, reservedUnknownUsd: call.countedUsd, unknownDispatches: 1, inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0 }],
      ["a fee below one micro-USD", { usd: 0.0000001 }], ["a path in run", { run: "../labelling-x" }],
    ];
    for (const [name, change] of broken) expect(LabellingSummarySchema.safeParse({ ...summary, ...change }).success, name).toBe(false);
  });
});

describe("E0 judge labeller: the command", () => {
  const TSX = pathToFileURL(join(ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href, SCRIPT = join(ROOT, "scripts", "judge-labeller.ts");
  const cli = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
    spawnSync(process.execPath, ["--import", TSX, SCRIPT, ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });

  it("parses its flags strictly", () => {
    expect(parseLabellerArguments(["--claims", "c.json", "--minimum-per-class", "10", "--dry-run"])).toEqual({ claims: "c.json", minimumPerClass: 10, dryRun: true });
    for (const args of [[], ["--claims", "c.json"], ["--claims", "c.json", "--minimum-per-class", "ten"], ["--claims", "c.json", "--minimum-per-class", "10", "--model", "x"],
      ["--claims", "a.json", "--claims", "b.json", "--minimum-per-class", "10"], ["--claims", "c.json", "--minimum-per-class", "10", "--dry-run", "--dry-run"],
      ["--claims", "c.json", "--minimum-per-class", "1000"]]) expect(parseLabellerArguments(args)).toBeUndefined();
  });

  it("dry-runs with pnpm's argument shape and no key, printing aggregates and no path; a paid run without the key refuses with a fixed code", () => {
    const set = harvested();
    const dry = cli(set.base, ["--", "--claims", ".soar/experiments/e0-judge/claims.json", "--minimum-per-class", "2", "--dry-run"]);
    expect(dry.status).toBe(0);
    const printed = JSON.parse(dry.stdout);
    expect(printed).toMatchObject({ dryRun: true, admitted: true, claims: 6, minimumPerClass: 2, priorCountedUsd: 0, capUsd: 1 });
    expect(printed.projectedUsd).toBeGreaterThan(0);
    expect(printed.projectedUsd).toBeLessThanOrEqual(1);
    for (const absent of [set.base, homedir(), "api.openai.com", SIDECAR_RUN]) expect(dry.stdout + dry.stderr).not.toContain(absent);
    expect(readdirSync(set.root).sort()).toEqual(["claims.json", "claims.origin.json"]);
    const paid = cli(set.base, ["--", "--claims", ".soar/experiments/e0-judge/claims.json", "--minimum-per-class", "2"], { [LABELLER_KEY_VARIABLE]: "" });
    expect(paid.status).toBe(2);
    expect(paid.stderr.trim()).toBe("labeller_key_missing");
    expect(paid.stdout).toBe("");
    const outside = cli(set.base, ["--", "--claims", "/etc/hosts", "--minimum-per-class", "2", "--dry-run"]);
    expect(outside.status).toBe(2);
    expect(outside.stderr.trim()).toBe("labeller_claims_outside_root");
    expect(cli(set.base, ["--claims"]).stderr).toContain("usage:");
  });
});
