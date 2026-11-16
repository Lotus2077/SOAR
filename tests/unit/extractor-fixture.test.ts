import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, jsonSchemaResponseFormat, vllmCacheSalt } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { EXTRACT_SYSTEM, OUTPUT_TOKENS, RESEARCH_ROLE_SCHEMAS, THINKING, assessResearchExtractionReply, researchProtocolSha256, runResearchPipeline } from "../../src/main/private-agent/research-pipeline";
import type { RequestSettings } from "../../scripts/export-role-schemas";
import { CONDITION_CALLS, DEPLOYED_CONDITION, EXTRACTOR_CLASSES, EXTRACTOR_CONDITIONS, EXTRACTOR_SUMMARY_MANIFEST_FIELDS, buildExtractorRequests, fixtureJobId, numericUsage,
  parseExtractorArguments, runExtractorFixture, verifyExtractorInputs, type ExtractorFixtureInputs } from "../../scripts/extractor-fixture";
import { buildLocalScreenModelConfig } from "../../scripts/private-agent-local-screen";
import { RESEARCH_PROTOCOL_SHA256 } from "../helpers/research-protocol-pin";
import { researchV4Reply } from "../helpers/research-v4-fixture";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const step of cleanups.splice(0).reverse()) await step(); });
const ROOT = resolve(__dirname, "..", "..");
const EXPERIMENTS = join(ROOT, "docs", "experiments");
const CORPUS = join(EXPERIMENTS, "e0-extractor-fixture-v1");
const QUESTIONS = ["Q1", "Q2", "Q3", "Q4", "Q5"];
/** Manifest v1's four conditions; EXTRACTOR_CONDITIONS also holds v2's structured cell (BL-20261116-1256-e0-extractor-structured-condition-design). */
const V1_CONDITIONS = ["thinking-off", "thinking-on", "thinking-on-8192", "thinking-on-16384"];
const LEGACY: RequestSettings = { vllm: { model: "Synthetic" }, streamingEnabled: false };
const STREAMED: RequestSettings = { vllm: { model: "Synthetic" }, streamingEnabled: true };
const FLASH: RequestSettings = { vllm: { model: "Synthetic", localReplyContract: "flash_next_v1", localContextTokens: 262144 }, streamingEnabled: false };
// Quotes copied from the committed sources.
const NOTICE_BUILT = "Between 3 March and 29 August 2033 the contractor built 140 metres of stepped concrete seawall with a recurved crest.";
const NOTICE_COST = "The trial cost 2.6 million crowns.";
const LOG_CALIBRATION = "G3 readings before that date may read about 15 per cent high.";
const REPORT_COST = "The Board's final account for the trial was 2.9 million crowns.";

/** The committed manifest and corpus, read as the command line reads them. */
function committed(): ExtractorFixtureInputs {
  return { manifest: JSON.parse(readFileSync(join(EXPERIMENTS, "e0-extractor-fixture-v1.json"), "utf8")), read: path => readFileSync(join(EXPERIMENTS, path)) };
}
/** The committed inputs with the manifest changed and some files replaced. */
function inputsWith(mutate: (manifest: Record<string, any>) => void, files: Record<string, Buffer> = {}): ExtractorFixtureInputs {
  const base = committed(), manifest = structuredClone(base.manifest) as Record<string, any>;
  mutate(manifest);
  return { manifest, read: path => files[path] ?? base.read(path) };
}
const extraction = (statuses: Record<string, string>, quotes: { quote: string; questionIds: string[]; note?: string }[] = [], ids = QUESTIONS) =>
  JSON.stringify({ questions: ids.map(id => ({ questionId: id, status: statuses[id] ?? "no_verified_evidence" })), quotes, conflicts: [] });
/** A plain reply; its usage carries a text field the summary must drop. */
const completion = (content: string | undefined, finish = "stop", message: Record<string, unknown> = {}) => ({ id: "x", object: "chat.completion", model: "Synthetic",
  choices: [{ index: 0, message: { role: "assistant", ...(content === undefined ? {} : { content }), ...message }, finish_reason: finish }],
  usage: { prompt_tokens: 1500, completion_tokens: 90, prompt_tokens_details: { cached_tokens: 1024 }, completion_tokens_details: { reasoning_tokens: 0 }, server_note: "hidden usage text" } });
/** A streamed reply as vLLM sends it: content deltas, the finish reason, the usage chunk, then [DONE] unless `cut`. */
const sse = (content: string, finish = "stop", cut = false) => {
  const half = Math.floor(content.length / 2), chunk = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  return [chunk({ id: "x", model: "Synthetic", choices: [{ index: 0, delta: { content: content.slice(0, half) }, finish_reason: null }] }),
    chunk({ id: "x", model: "Synthetic", choices: [{ index: 0, delta: { content: content.slice(half) }, finish_reason: finish }] }),
    ...(cut ? [] : [chunk({ id: "x", model: "Synthetic", choices: [], usage: { prompt_tokens: 1500, completion_tokens: 90 } }), "data: [DONE]\n\n"])];
};

type Reply = { status?: number; raw?: string; json?: unknown; sse?: string[]; destroy?: boolean };
/** A loopback fake of the chat-completions route: it answers a scripted reply per call and records every request. */
async function fakeServer(script: (ordinal: number, body: Record<string, unknown>) => Reply) {
  const requests: { url: string; headers: IncomingHttpHeaders; raw: string; body: Record<string, unknown> }[] = [];
  const server: Server = createServer((request, response) => {
    let data = ""; request.setEncoding("utf8"); request.on("data", part => { data += part; });
    request.on("end", () => {
      const body = JSON.parse(data) as Record<string, unknown>; requests.push({ url: request.url ?? "", headers: request.headers, raw: data, body });
      const reply = script(requests.length, body);
      if (reply.destroy) { request.socket.destroy(); return; }
      if (reply.sse) { response.writeHead(200, { "content-type": "text/event-stream" }); response.end(reply.sse.join("")); return; }
      response.writeHead(reply.status ?? 200, { "content-type": "application/json" }); response.end(reply.raw ?? JSON.stringify(reply.json));
    });
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  cleanups.push(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
  return { requests, baseUrl: `http://127.0.0.1:${port}/v1`, port };
}
function tempDir() { const root = mkdtempSync(join(tmpdir(), "soar-extractor-fixture-")); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; }

describe("E0 extractor fixture: inputs and requests", () => {
  it("verifies the committed corpus against its pinned manifest: five units, an accepted plan, three single-chunk sources and four conditions", () => {
    const inputs = committed(), fixture = verifyExtractorInputs(inputs);
    expect(fixture.manifest).toMatchObject({ schemaVersion: 1, name: "e0-extractor-fixture-v1", status: "pinned", task: "e0-extractor-synthetic-v1", exposure: "fresh",
      conditions: V1_CONDITIONS, repeats: 10 });
    expect(fixture.manifestSha256).toBe(digest(canonical(inputs.manifest)));
    expect(fixture.units.map(unit => unit.id)).toEqual(["U1", "U2", "U3", "U4", "U5"]);
    expect(fixture.plan.questions.map(question => question.id)).toEqual(QUESTIONS); expect([...fixture.questions]).toEqual(QUESTIONS);
    expect(fixture.chunks.map(chunk => [chunk.chunkId, chunk.sourceId, chunk.bytes, chunk.startLine])).toEqual([
      ["S1C1", "input/corpus/board-notice.md", 1745, 1], ["S2C1", "input/corpus/gauge-log.md", 62694, 1], ["S3C1", "input/corpus/monitoring-report.md", 6691, 1]]);
    // The stage's layout: the stable packet line, then the chunk line with repairReason null.
    for (const chunk of fixture.chunks) {
      const [stable, perChunk] = chunk.userContent.split("\n").map(line => JSON.parse(line));
      expect(Object.keys(stable).sort()).toEqual(["brief", "plan", "units"]); expect(stable.brief).toBe(fixture.brief);
      expect(perChunk).toEqual({ chunk: { endByte: chunk.bytes, id: chunk.chunkId, startByte: 0, text: chunk.text }, repairReason: null, source: { id: chunk.sourceId, sha256: chunk.sourceSha256 } });
    }
    expect(fixture.chunks.map(chunk => Buffer.byteLength(chunk.userContent))).toEqual([5109, 66709, 10116]);
    // The registry's copies are pinned to these runtime arrays.
    expect(EXTRACTOR_CONDITIONS).toEqual([...V1_CONDITIONS, "thinking-off-structured"]);
    expect(EXTRACTOR_CLASSES).toEqual(["complete", "held", "needs_followup", "invalid", "truncated", "request_rejected", "malformed_reply", "transport_failed"]);
    expect(EXTRACTOR_SUMMARY_MANIFEST_FIELDS).toEqual(["sha256", "name", "task", "exposure", "briefSha256", "planSha256", "unitCount", "sourceCount"]);
  });

  it("refuses every input that differs from the pin before any request is sent or any file is written", async () => {
    const server = await fakeServer(() => ({ json: completion(extraction({})) })), out = join(tempDir(), "run");
    const attempt = (inputs: ExtractorFixtureInputs, target = out) => runExtractorFixture({ endpoint: { baseUrl: server.baseUrl }, settings: LEGACY, inputs, out: target });
    const invalid = [(m: Record<string, any>) => { m.status = "template"; }, (m: Record<string, any>) => { m.extra = true; },
      (m: Record<string, any>) => { m.conditions = ["thinking-off", "thinking-off"]; }, (m: Record<string, any>) => { m.conditions = ["thinking-medium"]; },
      (m: Record<string, any>) => { m.corpus = "../e0-extractor-fixture-v1"; }, (m: Record<string, any>) => { m.sources[0].file = "/etc/hosts"; },
      (m: Record<string, any>) => { m.exposure = "synthetic"; }, (m: Record<string, any>) => { m.task = "E0 Extractor"; }, (m: Record<string, any>) => { delete m.task; }];
    for (const mutate of invalid) await expect(attempt(inputsWith(mutate))).rejects.toThrow("extractor_fixture_manifest_invalid");
    await expect(attempt(inputsWith(m => { m.brief.sha256 = "0".repeat(64); }))).rejects.toThrow("extractor_fixture_brief_mismatch");
    await expect(attempt(inputsWith(m => { m.plan.bytes += 1; }))).rejects.toThrow("extractor_fixture_plan_mismatch");
    await expect(attempt(inputsWith(m => { m.sources[2].sha256 = "0".repeat(64); }))).rejects.toThrow("extractor_fixture_source_mismatch");
    await expect(attempt(inputsWith(m => { m.sources[1].file = "sources/absent.md"; }))).rejects.toThrow("extractor_fixture_source_missing");
    await expect(attempt(inputsWith(m => { m.units = ["U1", "U2", "U3", "U4"]; }))).rejects.toThrow("extractor_fixture_units_mismatch");
    await expect(attempt(inputsWith(m => { m.sources[0].chunkId = "S2C1"; }))).rejects.toThrow("extractor_fixture_chunk_mismatch");
    // A plan the pipeline's plan assessor rejects (an unknown source id), pinned by its own hash.
    const plan = JSON.parse(readFileSync(join(CORPUS, "plan.json"), "utf8"));
    plan.questions[0].sourceIds = ["input/corpus/unlisted.md"];
    const badPlan = Buffer.from(JSON.stringify(plan));
    await expect(attempt(inputsWith(m => { m.plan = { file: "plan-bad.json", sha256: digest(badPlan), bytes: badPlan.length }; },
      { "e0-extractor-fixture-v1/plan-bad.json": badPlan }))).rejects.toThrow("extractor_fixture_plan_rejected");
    // A source longer than one chunk (65,536 bytes), pinned by its own hash, is not one chunk.
    const long = Buffer.concat([readFileSync(join(CORPUS, "sources", "board-notice.md")), Buffer.from("Synthetic filler line for the chunk test.\n".repeat(1700))]);
    expect(long.length).toBeGreaterThan(65536);
    await expect(attempt(inputsWith(m => { m.sources[0] = { ...m.sources[0], file: "sources/long.md", sha256: digest(long), bytes: long.length }; },
      { "e0-extractor-fixture-v1/sources/long.md": long }))).rejects.toThrow("extractor_fixture_chunk_mismatch");
    // An existing out directory is never reused.
    const existing = join(tempDir(), "existing"); mkdirSync(existing);
    await expect(attempt(committed(), existing)).rejects.toThrow("extractor_fixture_out_exists"); expect(readdirSync(existing)).toEqual([]);
    expect(server.requests).toHaveLength(0); expect(existsSync(out)).toBe(false);
  });

  it("names the deployed cell and builds every call's body through P10's builder, salted per (repeat, condition)", () => {
    // thinking-off is the stage's call as deployed: its extraction thinking is disabled at OUTPUT_TOKENS.extract; 16,384 is the Heavy ceiling.
    expect(THINKING.extract).toBe("disabled"); expect(DEPLOYED_CONDITION).toBe("thinking-off");
    expect(CONDITION_CALLS).toEqual({ "thinking-off": { thinking: "disabled", maxOutputTokens: OUTPUT_TOKENS.extract }, "thinking-on": { maxOutputTokens: 2048 },
      "thinking-on-8192": { maxOutputTokens: 8192 }, "thinking-on-16384": { maxOutputTokens: COORDINATOR_PROFILES.heavy.maxOutputTokens },
      "thinking-off-structured": { thinking: "disabled", maxOutputTokens: OUTPUT_TOKENS.extract, responseFormat: { ...RESEARCH_ROLE_SCHEMAS.extract, strict: true } } });
    const fixture = verifyExtractorInputs(committed()), requests = buildExtractorRequests(fixture, LEGACY);
    expect(requests).toHaveLength(120);
    expect(requests.slice(0, 7).map(r => `${r.repeat}/${r.condition}/${r.chunkId}`)).toEqual(["1/thinking-off/S1C1", "1/thinking-off/S2C1", "1/thinking-off/S3C1",
      "1/thinking-on/S1C1", "1/thinking-on/S2C1", "1/thinking-on/S3C1", "1/thinking-on-8192/S1C1"]);
    for (const request of requests) {
      const body = JSON.parse(request.body);
      expect(digest(request.body)).toBe(request.requestSha256); expect(body.cache_salt).toBe(vllmCacheSalt(fixtureJobId(request.repeat, request.condition)));
      expect(body.max_tokens).toBe(CONDITION_CALLS[request.condition].maxOutputTokens);
    }
    const body = (repeat: number, condition: string, chunkId: string) => JSON.parse(requests.find(r => r.repeat === repeat && r.condition === condition && r.chunkId === chunkId)!.body);
    const unsalted = ({ cache_salt: _salt, ...rest }: Record<string, unknown>) => rest;
    // Repeats differ only in their salt; a (repeat, condition)'s chunks share it, as one job's calls do.
    expect(unsalted(body(1, "thinking-off", "S2C1"))).toEqual(unsalted(body(10, "thinking-off", "S2C1")));
    expect(body(1, "thinking-off", "S1C1").cache_salt).toBe(body(1, "thinking-off", "S3C1").cache_salt);
    expect(body(1, "thinking-off", "S1C1").cache_salt).not.toBe(body(1, "thinking-on", "S1C1").cache_salt);
    expect(body(1, "thinking-off", "S2C1")).toMatchObject({ model: "Synthetic", stream: false, max_tokens: 2048, chat_template_kwargs: { enable_thinking: false } });
    expect(body(1, "thinking-off", "S2C1")).not.toHaveProperty("reasoning_effort");
    expect(body(1, "thinking-on", "S2C1")).toMatchObject({ max_tokens: 2048, reasoning_effort: "medium", temperature: 1, top_p: 0.95, top_k: 20 });
    expect(body(1, "thinking-on", "S2C1")).not.toHaveProperty("chat_template_kwargs");
    expect(body(1, "thinking-on-16384", "S2C1")).toMatchObject({ max_tokens: 16384, reasoning_effort: "medium" });
    expect(body(1, "thinking-off", "S2C1").messages).toEqual([{ role: "system", content: EXTRACT_SYSTEM }, { role: "user", content: fixture.chunks[1]!.userContent }]);
    const flash = buildExtractorRequests(fixture, FLASH).find(r => r.condition === "thinking-on")!;
    expect(JSON.parse(flash.body)).toMatchObject({ chat_template_kwargs: { enable_thinking: true, preserve_thinking: false }, reasoning_effort: "medium" });
  });

  it("sends, as thinking-off, the bodies the extraction stage itself sends on the committed corpus, byte for byte", async () => {
    const fixture = verifyExtractorInputs(committed()), plan = readFileSync(join(CORPUS, "plan.json"), "utf8");
    const sources = fixture.chunks.map(chunk => ({ id: chunk.sourceId, path: chunk.sourceId, bytes: Buffer.from(chunk.text) }));
    for (const settings of [LEGACY, STREAMED, FLASH]) {
      const sent: string[] = [];
      // The real pipeline on the committed brief and sources: a planner that returns plan.json, and the driver's model configuration
      // under the fixture's first job, so its extraction calls carry the same salt as repeat 1's thinking-off bodies.
      const request = async (input: { body: string }, settle: (bytes: Buffer) => number) => {
        const body = JSON.parse(input.body), system = body.messages[0].content as string; sent.push(input.body);
        const content = system.startsWith("You plan") ? plan : researchV4Reply(system, body.messages[1].content as string);
        const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
        return { bytes, receipt: { feeMicrousd: settle(bytes) } };
      };
      const config = buildLocalScreenModelConfig({ vllm: settings.vllm as never, streamingEnabled: settings.streamingEnabled }, COORDINATOR_PROFILES.heavy, true);
      const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, fixtureJobId(1, "thinking-off"), "reader");
      await runResearchPipeline({ brief: fixture.brief, sources, models: { reader: make(), planner: make(), synthesiser: make() }, signal: new AbortController().signal, record: () => {} });
      const extractions = sent.filter(body => JSON.parse(body).messages[0].content === EXTRACT_SYSTEM).slice(0, 3);
      expect(extractions).toHaveLength(3);
      expect(extractions).toEqual(buildExtractorRequests(fixture, settings).filter(r => r.repeat === 1 && r.condition === "thinking-off").map(r => r.body));
    }
  });
});

describe("E0 extractor fixture: a run against a loopback endpoint", () => {
  it("runs repeat, condition, chunk; judges each reply with the stage's own checks; retains raw replies 0600; and keeps codes, hashes and counts only", async () => {
    let out = "";
    const seen: number[] = [];
    // Order: repeat, then condition (off, on, 8192), then chunk (S1C1, S2C1, S3C1); ordinals 10 to 18 are the second repeat.
    const script = (ordinal: number): Reply => {
      seen.push((JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) as { calls: unknown[] }).calls.length);
      switch (ordinal) {
        case 1: return { json: completion(extraction({ Q1: "evidence_found", Q4: "evidence_found" }, [{ quote: NOTICE_BUILT, questionIds: ["Q1"] }, { quote: NOTICE_COST, questionIds: ["Q4"] }])) };
        case 2: return { json: completion(extraction({ Q5: "needs_followup" })) };
        case 3: return { json: completion(extraction({}).slice(0, 40), "length") };
        case 4: return { json: completion(extraction({ Q1: "evidence_found" }, [{ quote: NOTICE_BUILT, questionIds: ["Q1"] }, { quote: "The trial cost 3 million crowns.", questionIds: ["Q4"] }]),
          "stop", { reasoning_content: "hidden thoughts" }) };
        case 5: return { json: completion(extraction({}, [], ["Q1", "Q2", "Q3", "Q4"])) };
        case 6: return { status: 400, raw: "{\"error\":\"bad request\"}" };
        case 7: return { json: completion(extraction({ Q4: "evidence_found" }, [{ quote: "The trial cost 3 million crowns.", questionIds: ["Q4"] }])) };
        case 8: return { json: completion(extraction({ Q5: "evidence_found" }, [{ quote: LOG_CALIBRATION, questionIds: ["Q5"], note: "n".repeat(201) }])) };
        case 9: return { raw: "not json" };
        case 10: return { destroy: true };
        case 11: return { json: completion(undefined) };
        case 12: return { json: completion(extraction({}), "Stopped by user!") };
        case 18: return { json: completion(extraction({ Q4: "evidence_found" }, [{ quote: REPORT_COST, questionIds: ["Q4"] }])) };
        default: return { json: completion(extraction({})) };
      }
    };
    const server = await fakeServer(script);
    out = join(tempDir(), "e0-extractor-fixture-test");
    const inputs = inputsWith(m => { m.conditions = ["thinking-off", "thinking-on", "thinking-on-8192"]; m.repeats = 2; });
    const summary = await runExtractorFixture({ endpoint: { baseUrl: server.baseUrl, apiKey: "test-key" }, settings: LEGACY, inputs, out });
    const fixture = verifyExtractorInputs(inputs), conditions = ["thinking-off", "thinking-on", "thinking-on-8192"] as const;
    expect(server.requests).toHaveLength(18); expect(seen).toEqual(Array.from({ length: 18 }, (_, i) => i));
    expect(server.requests.every(r => r.url === "/v1/chat/completions" && r.headers.authorization === "Bearer test-key")).toBe(true);
    // Run order, each request's bytes exactly the call's request, each salted for its (repeat, condition).
    const order = [1, 2].flatMap(repeat => conditions.flatMap(condition => fixture.chunks.map(c => ({ repeat, condition, chunkId: c.chunkId }))));
    expect(summary.calls.map(c => ({ repeat: c.repeat, condition: c.condition, chunkId: c.chunkId }))).toEqual(order);
    server.requests.forEach((request, i) => {
      expect(digest(request.raw)).toBe(summary.calls[i]!.requestSha256); expect(Buffer.byteLength(request.raw)).toBe(summary.calls[i]!.requestBytes);
      expect(request.body.cache_salt).toBe(vllmCacheSalt(fixtureJobId(order[i]!.repeat, order[i]!.condition)));
    });
    // Exporting the stage's checks moved no prompt, schema, budget or policy: the default protocol hash is the shared pin.
    expect(researchProtocolSha256()).toBe(RESEARCH_PROTOCOL_SHA256);
    expect(summary).toMatchObject({ version: 1, model: "Synthetic", dryRun: false, protocolSha256: RESEARCH_PROTOCOL_SHA256, conditions: [...conditions], deployedCondition: "thinking-off",
      repeats: 2, order: "repeat_condition_chunk", requestSettings: { model: "Synthetic", streaming: false, localReplyContract: null, localContextTokens: null, profile: "heavy", cacheSalt: true },
      manifest: { sha256: digest(canonical(inputs.manifest)), name: "e0-extractor-fixture-v1", task: "e0-extractor-synthetic-v1", exposure: "fresh", unitCount: 5, sourceCount: 3 } });
    expect(Object.keys(summary.manifest)).toEqual([...EXTRACTOR_SUMMARY_MANIFEST_FIELDS]);
    for (const condition of conditions) {
      const own = summary.calls.filter(call => call.condition === condition);
      expect(summary.requests[condition]).toEqual({ requestSetSha256: digest(canonical(own.map(call => call.requestSha256))), requests: 6, requestBytes: own.reduce((n, call) => n + call.requestBytes, 0),
        maxTokens: CONDITION_CALLS[condition].maxOutputTokens, thinking: condition === "thinking-off" ? "disabled" : "model", streamed: false });
    }
    const call = (ordinal: number) => summary.calls[ordinal - 1]!;
    expect(call(1)).toMatchObject({ classification: "complete", keptWithDrops: false, reasons: [], quotes: { given: 2, located: 2, dropped: 0 }, finishReason: "stop", status: 200,
      contentBytes: Buffer.byteLength(extraction({ Q1: "evidence_found", Q4: "evidence_found" }, [{ quote: NOTICE_BUILT, questionIds: ["Q1"] }, { quote: NOTICE_COST, questionIds: ["Q4"] }])),
      usage: { prompt_tokens: 1500, completion_tokens: 90, prompt_tokens_details: { cached_tokens: 1024 }, completion_tokens_details: { reasoning_tokens: 0 } },
      reasoningField: "none", reasoningBytes: 0, replyFile: "r01-thinking-off-S1C1.json",
      outcomes: { Q1: "evidence_retained", Q2: "no_verified_evidence", Q3: "no_verified_evidence", Q4: "evidence_retained", Q5: "no_verified_evidence" } });
    expect(call(1).usage).not.toHaveProperty("server_note");
    expect(call(2)).toMatchObject({ classification: "needs_followup", reasons: [{ code: "needs_followup", path: ["questions", 4] }], outcomes: { Q5: "needs_followup" } });
    expect(call(3)).toMatchObject({ classification: "truncated", finishReason: "length", reasons: [{ code: "truncated", path: [] }], contentBytes: 40 });
    expect(call(4)).toMatchObject({ classification: "complete", keptWithDrops: true, reasons: [{ code: "quote_not_located", path: ["quotes", 1, "quote"] }], quotes: { given: 2, located: 1, dropped: 1 },
      reasoningField: "reasoning_content", reasoningBytes: Buffer.byteLength("hidden thoughts") });
    expect(call(5)).toMatchObject({ classification: "invalid", reasons: [{ code: "question_set_mismatch", path: ["questions"] }] });
    expect(call(6)).toMatchObject({ classification: "request_rejected", status: 400, replyFile: "r01-thinking-on-S3C1.json" }); expect(call(6)).not.toHaveProperty("reasons");
    expect(call(7)).toMatchObject({ classification: "held", keptWithDrops: false, questionsDowngraded: 1, outcomes: { Q4: "no_verified_evidence" },
      reasons: [{ code: "quote_not_located", path: ["quotes", 0, "quote"] }, { code: "evidence_found_without_quote", path: ["questions", 3] }] });
    expect(call(8)).toMatchObject({ classification: "invalid", reasons: [{ code: "schema_too_big", path: ["quotes", 0, "note"] }], quotes: { given: 0, located: 0, dropped: 0 }, outcomes: {} });
    expect(call(9)).toMatchObject({ classification: "malformed_reply", status: 200 }); expect(call(9)).not.toHaveProperty("reasons");
    // A lost connection: the class and the error's name only, no reply file, and nothing of the address in the summary.
    expect(call(10)).toMatchObject({ classification: "transport_failed", status: null, replyFile: null, bodySha256: null, bodyBytes: 0, transportError: "TypeError" });
    // A reply without content reads as empty, as the model layer's decoder reads it, so the stage's checks give invalid_json.
    expect(call(11)).toMatchObject({ classification: "invalid", contentBytes: 0, reasons: [{ code: "invalid_json", path: [] }] });
    expect(call(12)).toMatchObject({ classification: "complete", finishReason: "other" });
    expect(call(18)).toMatchObject({ chunkId: "S3C1", condition: "thinking-on-8192", quotes: { given: 1, located: 1, dropped: 0 }, outcomes: { Q4: "evidence_retained" } });
    expect(summary.counts).toEqual({ "thinking-off": { complete: 2, needs_followup: 1, truncated: 1, transport_failed: 1, invalid: 1 },
      "thinking-on": { complete: 4, invalid: 1, request_rejected: 1 }, "thinking-on-8192": { held: 1, invalid: 1, malformed_reply: 1, complete: 3 } });
    expect(summary.cells.S1C1).toEqual({ "thinking-off": { calls: 2, classes: { complete: 1, transport_failed: 1 }, keptWithDrops: 0, reasons: {} },
      "thinking-on": { calls: 2, classes: { complete: 2 }, keptWithDrops: 1, reasons: { quote_not_located: 1 } },
      "thinking-on-8192": { calls: 2, classes: { held: 1, complete: 1 }, keptWithDrops: 0, reasons: { quote_not_located: 1, evidence_found_without_quote: 1 } } });
    // Raw replies are retained whole and owner-readable only; the summary binds each by digest and is rewritten whole after every call.
    expect(readdirSync(join(out, "replies"))).toHaveLength(17); expect(readdirSync(out).sort()).toEqual(["replies", "summary.json"]);
    for (const record of summary.calls.filter(c => c.replyFile)) {
      const path = join(out, "replies", record.replyFile!);
      expect(statSync(path).mode & 0o777).toBe(0o600); expect(digest(readFileSync(path))).toBe(record.bodySha256); expect(readFileSync(path).length).toBe(record.bodyBytes);
    }
    expect(statSync(join(out, "summary.json")).mode & 0o777).toBe(0o600); expect(statSync(join(out, "replies")).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(join(out, "summary.json"), "utf8"))).toEqual(JSON.parse(JSON.stringify(summary)));
    const serialized = JSON.stringify(summary);
    for (const secret of ["127.0.0.1", `:${server.port}`, "test-key", "hidden thoughts", "hidden usage text", "Halverstrand", "2.6 million crowns", "stepped concrete", "bad request",
      "fetch failed", "socket", "Stopped by user"]) expect(serialized).not.toContain(secret);
  });

  it("reads a streamed reply through the broker's assembler, and records a cut stream as malformed", async () => {
    const server = await fakeServer(ordinal => ({ sse: ordinal === 1 ? sse(extraction({ Q1: "evidence_found" }, [{ quote: NOTICE_BUILT, questionIds: ["Q1"] }]))
      : ordinal === 2 ? sse(extraction({}), "stop", true) : sse(extraction({}).slice(0, 30), "length") }));
    const out = join(tempDir(), "streamed");
    const summary = await runExtractorFixture({ endpoint: { baseUrl: server.baseUrl }, settings: STREAMED, inputs: inputsWith(m => { m.conditions = ["thinking-off"]; m.repeats = 1; }), out });
    expect(server.requests.map(r => r.body.stream)).toEqual([true, true, true]);
    expect(server.requests.every(r => r.headers.authorization === undefined)).toBe(true);
    expect(summary.calls.map(c => c.classification)).toEqual(["complete", "malformed_reply", "truncated"]);
    expect(summary.calls[0]).toMatchObject({ replyFile: "r01-thinking-off-S1C1.sse", quotes: { located: 1 }, usage: { prompt_tokens: 1500, completion_tokens: 90 } });
    expect(summary.calls[0]).not.toHaveProperty("reasoningField");
    expect(summary.calls[1]).toMatchObject({ streamError: "sse_truncated" }); expect(summary.calls[2]).toMatchObject({ finishReason: "length", contentBytes: 30 });
    expect(summary.requests["thinking-off"]).toMatchObject({ requests: 3, streamed: true });
    expect(readFileSync(join(out, "replies", "r01-thinking-off-S1C1.sse"), "utf8")).toContain("data: [DONE]");
  });

  it("classes a reply whose thinking spent the cap with no content as truncated, as the stage does, and a reply the model layer rejects as malformed", async () => {
    // The shape E0's planner fixture recorded on the r3 index: content null and finish_reason "length", the reasoning having used the whole cap.
    const spent = (finish: string) => ({ json: completion(undefined, finish, { content: null, reasoning_content: "r".repeat(9000) }) });
    // Rejected by the model layer's reply schema (scripts/chat-reply.ts): a reply without a message, and one whose message is an array.
    const usage = { prompt_tokens: 1500, completion_tokens: 2048 };
    const server = await fakeServer(ordinal => ordinal === 2 ? spent("stop") : ordinal === 4 ? { json: { id: "x", choices: [{ index: 0, finish_reason: "stop" }], usage } }
      : ordinal === 5 ? { json: { id: "x", choices: [{ index: 0, message: [], finish_reason: "length" }], usage } } : spent("length"));
    const summary = await runExtractorFixture({ endpoint: { baseUrl: server.baseUrl }, settings: LEGACY, inputs: inputsWith(m => { m.conditions = ["thinking-on"]; m.repeats = 2; }),
      out: join(tempDir(), "spent") });
    const truncated = ["truncated", "length", 0, "reasoning_content", 9000];
    expect(summary.calls.map(c => c.classification === "malformed_reply" ? [c.classification] : [c.classification, c.finishReason, c.contentBytes, c.reasoningField, c.reasoningBytes]))
      .toEqual([truncated, ["invalid", "stop", 0, "reasoning_content", 9000], truncated, ["malformed_reply"], ["malformed_reply"], truncated]);
    expect(summary.calls[0]!.reasons).toEqual([{ code: "truncated", path: [] }]); expect(summary.counts["thinking-on"]).toEqual({ truncated: 3, invalid: 1, malformed_reply: 2 });
  });
  it("dry-runs: builds and hashes all 120 bodies, sends nothing and writes nothing", async () => {
    const server = await fakeServer(() => ({ json: completion(extraction({})) })), out = join(tempDir(), "dry");
    const summary = await runExtractorFixture({ endpoint: { baseUrl: server.baseUrl }, settings: LEGACY, inputs: committed(), out, dryRun: true });
    expect(summary).toMatchObject({ dryRun: true, calls: [], cells: {}, repeats: 10, deployedCondition: "thinking-off" });
    expect(summary.counts).toEqual({ "thinking-off": {}, "thinking-on": {}, "thinking-on-8192": {}, "thinking-on-16384": {} });
    expect(Object.keys(summary.requests)).toEqual(V1_CONDITIONS);
    expect(summary.requests["thinking-off"]).toMatchObject({ requests: 30, maxTokens: 2048, thinking: "disabled", streamed: false });
    expect(summary.requests["thinking-on-16384"]).toMatchObject({ requests: 30, maxTokens: 16384, thinking: "model" });
    expect(server.requests).toHaveLength(0); expect(existsSync(out)).toBe(false);
  });

  it("parses its command line strictly and keeps only the numeric fields of a reply's usage", () => {
    expect(parseExtractorArguments([])).toEqual({ dryRun: false });
    expect(parseExtractorArguments(["--dry-run", "--manifest", "m.json", "--out", ".soar/experiments/x"])).toEqual({ dryRun: true, manifest: "m.json", out: ".soar/experiments/x" });
    for (const argv of [["--dry-runn"], ["--out"], ["--out", "--dry-run"], ["--dry-run", "--dry-run"], ["extra"], ["--manifest", "a", "--manifest", "b"]])
      expect(parseExtractorArguments(argv)).toBeUndefined();
    // Two levels of nesting, as vLLM's usage has (usage, then *_details), and numbers one level below; deeper objects are dropped.
    expect(numericUsage({ prompt_tokens: 7, note: "text", prompt_tokens_details: { cached_tokens: 3, kind: "x" }, list: [1], "Bad Key": 2, deep: { a: { b: 1, c: { d: 1 } } } }))
      .toEqual({ prompt_tokens: 7, prompt_tokens_details: { cached_tokens: 3 }, deep: { a: { b: 1 } } });
    expect(numericUsage("text")).toBeUndefined(); expect(numericUsage(null)).toBeUndefined();
  });

  it("runs from the command line through loadConfig, prints no address, and refuses a stray flag or an out directory Git does not ignore", () => {
    const root = tempDir();
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1", SOAR_VLLM_MODEL: "Synthetic", SOAR_ENV_FILE: join(root, "none.env") };
    const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/extractor-fixture.ts", ...args], { cwd: ROOT, encoding: "utf8", env });
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "scripts/extractor-fixture.ts", "--dry-run"], { cwd: ROOT, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    const printed = JSON.parse(stdout);
    expect(printed).toMatchObject({ dryRun: true, conditions: V1_CONDITIONS, deployedCondition: "thinking-off", repeats: 10, chunks: ["S1C1", "S2C1", "S3C1"], calls: 120, retained: null,
      manifest: { task: "e0-extractor-synthetic-v1", exposure: "fresh", unitCount: 5, sourceCount: 3 } });
    expect(stdout).not.toContain("127.0.0.1");
    const typo = run("--dry-runn");
    expect(typo.status).toBe(2); expect(typo.stderr).toContain("usage: pnpm fixture:extractor"); expect(typo.stdout).toBe("");
    const refused = run("--out", join(root, "run"));
    expect(refused.status).toBe(2); expect(refused.stderr.trim()).toBe("extractor_fixture_out_not_ignored"); expect(refused.stdout).toBe(""); expect(existsSync(join(root, "run"))).toBe(false);
  });
});

describe("E0 extractor fixture: the serving card's extract call (manifest v2, BL-20261116-1256-e0-extractor-structured-condition-design)", () => {
  const committedV2 = (): ExtractorFixtureInputs => ({ manifest: JSON.parse(readFileSync(join(EXPERIMENTS, "e0-extractor-fixture-v2.json"), "utf8")), read: path => readFileSync(join(EXPERIMENTS, path)) });
  /** The committed serving card's roles (docs/experiments/serving-card-2026-11-16.json), as the reader would return them once adopted; its decision is still proposed. */
  const cardRoles = () => JSON.parse(readFileSync(join(EXPERIMENTS, "serving-card-2026-11-16.json"), "utf8")).roles;

  it("pins v1's corpus with the deployed call and the card's call beside it, and sends the deployed call's bodies exactly as v1 does", () => {
    const v1 = verifyExtractorInputs(committed()), v2 = verifyExtractorInputs(committedV2());
    const pins = (m: Record<string, any>) => { const { name: _n, note: _o, exposure: _e, conditions: _c, ...rest } = m; return rest; };
    expect(pins(v2.manifest)).toEqual(pins(v1.manifest));
    expect(v2.manifest).toMatchObject({ name: "e0-extractor-fixture-v2", exposure: "exposed", conditions: ["thinking-off", "thinking-off-structured"], repeats: 10 });
    for (const settings of [LEGACY, STREAMED]) {
      const requests = buildExtractorRequests(v2, settings), first = requests.find(r => r.condition === "thinking-off-structured")!;
      expect(requests).toHaveLength(60);
      // The control: each (repeat, chunk) sends v1's thinking-off body byte for byte, salt included.
      const control = (list: typeof requests) => list.filter(r => r.condition === "thinking-off").map(r => r.body);
      expect(control(requests)).toEqual(control(buildExtractorRequests(v1, settings)));
      expect(JSON.parse(first.body)).toMatchObject({ max_tokens: 2048, chat_template_kwargs: { enable_thinking: false },
        response_format: jsonSchemaResponseFormat({ ...RESEARCH_ROLE_SCHEMAS.extract, strict: true }) });
      expect(first.body.includes('"response_format"')).toBe(true); expect(requests.filter(r => r.condition === "thinking-off").every(r => !r.body.includes("response_format"))).toBe(true);
    }
  });

  it("sends, as thinking-off-structured, the extraction bodies the pipeline itself sends under the committed card, byte for byte", async () => {
    const fixture = verifyExtractorInputs(committedV2()), plan = readFileSync(join(CORPUS, "plan.json"), "utf8");
    const sources = fixture.chunks.map(chunk => ({ id: chunk.sourceId, path: chunk.sourceId, bytes: Buffer.from(chunk.text) }));
    for (const settings of [LEGACY, STREAMED]) {
      const sent: string[] = [];
      const request = async (input: { body: string }, settle: (bytes: Buffer) => number) => {
        const body = JSON.parse(input.body), system = body.messages[0].content as string; sent.push(input.body);
        const content = system.startsWith("You plan") ? plan : researchV4Reply(system, body.messages[1].content as string);
        const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
        return { bytes, receipt: { feeMicrousd: settle(bytes) } };
      };
      const config = buildLocalScreenModelConfig({ vllm: settings.vllm as never, streamingEnabled: settings.streamingEnabled }, COORDINATOR_PROFILES.heavy, true);
      const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, fixtureJobId(1, "thinking-off-structured"), "reader");
      const outcome = await runResearchPipeline({ brief: fixture.brief, sources, models: { reader: make(), planner: make(), synthesiser: make() }, signal: new AbortController().signal,
        record: () => {}, roles: cardRoles() });
      expect(outcome.reason).not.toBe("research_role_policy_invalid");
      const extractions = sent.filter(body => JSON.parse(body).messages[0].content === EXTRACT_SYSTEM).slice(0, 3);
      expect(extractions).toHaveLength(3);
      expect(extractions).toEqual(buildExtractorRequests(fixture, settings).filter(r => r.repeat === 1 && r.condition === "thinking-off-structured").map(r => r.body));
    }
  });
});

describe("assessResearchExtractionReply: the extraction stage's checks of one reply", () => {
  const text = "# Synthetic\nThe orchard recorded twelve healthy trees during the autumn survey.\nThe survey ran for three days in October.\n";
  const assess = (content: string, truncated = false) => assessResearchExtractionReply({ content, truncated, questions: new Set(["Q1", "Q2"]),
    source: { id: "input/corpus/alpha.md" }, chunk: { id: "S1C1", sourceSha256: "a".repeat(64), startLine: 10 }, chunkText: text });
  const reply = (questions: [string, string][], quotes: unknown[] = [], conflicts: unknown[] = []) =>
    JSON.stringify({ questions: questions.map(([questionId, status]) => ({ questionId, status })), quotes, conflicts });
  const ORCHARD = "The orchard recorded twelve healthy trees during the autumn survey.";

  it("keeps located quotes with the source line, and lets each outcome follow them", () => {
    const result = assess(reply([["Q1", "evidence_found"], ["Q2", "no_verified_evidence"]], [{ quote: `  ${ORCHARD}  `, questionIds: ["Q2", "Q1"], note: "both" }],
      [{ questionIds: ["Q1"], note: "none" }]));
    expect(result).toEqual({ state: "complete", reasons: [{ code: "no_verified_evidence_with_quote", path: ["questions", 1] }],
      quotes: [{ id: "", questionIds: ["Q1", "Q2"], sourceId: "input/corpus/alpha.md", sourceSha256: "a".repeat(64), chunkIds: ["S1C1"], locator: "line 11", quote: ORCHARD, note: "both" }],
      conflicts: [{ questionIds: ["Q1"], note: "none" }], outcomes: [{ questionId: "Q1", status: "evidence_retained" }, { questionId: "Q2", status: "evidence_retained" }],
      quotesDropped: 0, conflictsDropped: 0, notesCleared: 0, questionsDowngraded: 0, questionsUpgraded: 1, lostEvidence: false });
  });

  it("drops what it cannot verify, clears unencodable notes, and flags a question that lost every quote", () => {
    const lone = String.fromCharCode(0xd800);
    const result = assess(reply([["Q1", "evidence_found"], ["Q2", "evidence_found"]], [
      { quote: "orchard", questionIds: ["Q1"] }, { quote: "The orchard recorded thirteen healthy trees.", questionIds: ["Q1"] },
      { quote: ORCHARD, questionIds: ["Q2", "Q2"] }, { quote: "The survey ran for three days in October.", questionIds: ["Q3"] },
      { quote: "The survey ran for three days in October.", questionIds: ["Q2"], note: `bad ${lone}` }], [{ questionIds: ["Q9"], note: "x" }, { questionIds: ["Q1"], note: `bad ${lone}` }]));
    expect(result.state).toBe("complete"); expect(result.lostEvidence).toBe(true);
    expect(result.reasons.map(r => r.code)).toEqual(["quote_length", "quote_not_located", "duplicate_question_id", "unknown_question_id", "note_unencodable",
      "unknown_question_id", "note_unencodable", "evidence_found_without_quote"]);
    expect(result.reasons[0]).toEqual({ code: "quote_length", path: ["quotes", 0, "quote"], minimum: 12, maximum: 300 });
    expect(result).toMatchObject({ quotesDropped: 4, conflictsDropped: 2, notesCleared: 1, questionsDowngraded: 1, conflicts: [],
      outcomes: [{ questionId: "Q1", status: "no_verified_evidence" }, { questionId: "Q2", status: "evidence_retained" }] });
    expect(result.quotes).toHaveLength(1); expect(result.quotes[0]).toMatchObject({ questionIds: ["Q2"], note: "", locator: "line 12" });
  });

  it("gives truncated, invalid and needs_followup states, and judges quotes in any parsed reply", () => {
    expect(assess(reply([["Q1", "evidence_found"], ["Q2", "evidence_found"]]), true)).toMatchObject({ state: "truncated", reasons: [{ code: "truncated", path: [] }], outcomes: [] });
    expect(assess("not json")).toMatchObject({ state: "invalid", reasons: [{ code: "invalid_json", path: [] }], quotes: [] });
    expect(assess(JSON.stringify({ questions: [], quotes: [], conflicts: [] }))).toMatchObject({ state: "invalid", reasons: [{ code: "schema_too_small", path: ["questions"] }] });
    const wrongSet = assess(reply([["Q1", "evidence_found"]], [{ quote: "The orchard recorded nine trees.", questionIds: ["Q1"] }]));
    expect(wrongSet).toMatchObject({ state: "invalid", quotesDropped: 1, lostEvidence: false });
    expect(wrongSet.reasons.map(r => r.code)).toEqual(["question_set_mismatch", "quote_not_located", "evidence_found_without_quote"]);
    const followup = assess(reply([["Q1", "needs_followup"], ["Q2", "no_verified_evidence"]], [{ quote: ORCHARD, questionIds: ["Q1"] }]));
    expect(followup).toMatchObject({ state: "needs_followup", lostEvidence: false, outcomes: [{ questionId: "Q1", status: "needs_followup" }, { questionId: "Q2", status: "no_verified_evidence" }] });
    expect(followup.reasons).toEqual([{ code: "needs_followup", path: ["questions", 0] }]);
    expect(assess(reply([["Q1", "evidence_found"], ["Q1", "evidence_found"]]))).toMatchObject({ state: "invalid", reasons: [{ code: "question_set_mismatch", path: ["questions"] },
      { code: "evidence_found_without_quote", path: ["questions", 0] }, { code: "evidence_found_without_quote", path: ["questions", 1] }] });
  });
});

describe("E0 extractor fixture: the registry's fixture mode (scripts/registry-row.py --fixture extractor)", () => {
  const SCRIPT = join(ROOT, "scripts", "registry-row.py");
  // The writer's other required flags, as tests/unit/registry-row-e0.test.ts gives them; --task and --exposure are the committed manifest's.
  const FLAGS: Record<string, string> = { "--id": "e0-extractor-x", "--batch": "e0-2026-11", "--task": "e0-extractor-synthetic-v1", "--family": "research", "--exposure": "fresh",
    "--arm": "local", "--verdict-by": "agent_diagnostic", "--lesson": "l" };
  const writeRow = (dir: string, outcome: string, flags: Record<string, string> = {}) => execFileSync("python3", ["-I", SCRIPT, "--fixture-dir", dir, "--fixture", "extractor",
    ...Object.entries({ ...FLAGS, ...flags, "--outcome": outcome }).flat()], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  function refusedRow(dir: string, outcome: string, flags: Record<string, string> = {}): string {
    try { writeRow(dir, outcome, flags); } catch (error) { return String((error as { stderr?: unknown }).stderr ?? error); }
    throw new Error("the row was written");
  }

  it("pins the writer's copies of the conditions and classes to this script's exports", () => {
    const python = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('registry_row', sys.argv[1]); row = importlib.util.module_from_spec(spec); spec.loader.exec_module(row)",
      "print(json.dumps({'conditions': list(row.EXTRACTOR_CONDITIONS), 'classes': list(row.EXTRACTOR_CLASSES)}))"].join("\n");
    expect(JSON.parse(execFileSync("python3", ["-I", "-c", python, SCRIPT], { encoding: "utf8" }))).toEqual({ conditions: [...EXTRACTOR_CONDITIONS], classes: [...EXTRACTOR_CLASSES] });
  });

  it("rows the summaries this script writes: a finished run, and the summary it had written when its fifth request went out", async () => {
    let out = "", interim = "";
    // Per (repeat, condition), three chunks: a rejected request, a dropped connection and a truncated reply in the first repeat; every other reply is complete.
    const server = await fakeServer(ordinal => {
      if (ordinal === 5) { mkdirSync(interim); copyFileSync(join(out, "summary.json"), join(interim, "summary.json")); }
      return ordinal === 2 ? { status: 400, raw: "{\"error\":\"bad request\"}" } : ordinal === 3 ? { destroy: true }
        : ordinal === 4 ? { json: completion(extraction({}).slice(0, 40), "length") } : { json: completion(extraction({})) };
    });
    const root = tempDir(); out = join(root, "e0-extractor-fixture-20261116T120000000Z"); interim = join(root, "interim");
    const inputs = inputsWith(m => { m.conditions = ["thinking-off", "thinking-on"]; m.repeats = 2; }), fixture = verifyExtractorInputs(inputs);
    const summary = await runExtractorFixture({ endpoint: { baseUrl: server.baseUrl }, settings: { vllm: { model: "Registry-Alias" }, streamingEnabled: false }, inputs, out });
    const bytes = readFileSync(join(out, "summary.json")), line = writeRow(out, "accepted"), result = JSON.parse(line);
    // Ten of the twelve calls were answered with usage; the rejected request and the dropped connection report none.
    expect(result).toMatchObject({ modelCalls: 12, inputTokens: 10 * 1500, outputTokens: 10 * 90, cachedTokens: 10 * 1024, usd: 0, disclosedBytes: 0, terminalCause: "fixture_finished",
      outcome: "accepted", task: "e0-extractor-synthetic-v1", exposure: "fresh", date: summary.startedUtc.slice(0, 10) });
    expect(result.fixture).toEqual({ kind: "extractor", finished: true, version: 1, sha256: digest(bytes), conditions: ["thinking-off", "thinking-on"], repeats: 2,
      manifest: { sha256: fixture.manifestSha256, briefSha256: fixture.manifest.brief.sha256, planSha256: fixture.manifest.plan.sha256, unitCount: 5, sourceCount: 3 },
      protocolSha256: researchProtocolSha256(), deployedCondition: DEPLOYED_CONDITION, usageMissing: 0, cachedMissing: 0, usage: { calls: 10, inputTokens: 10 * 1500, outputTokens: 10 * 90 },
      classes: { "thinking-off": { complete: 4, request_rejected: 1, transport_failed: 1 }, "thinking-on": { complete: 5, truncated: 1 } } });
    expect(result.fixture.classes).toEqual(summary.counts);
    expect(result.inputSha256).toBe(digest(canonical({ "thinking-off": summary.requests["thinking-off"]!.requestSetSha256, "thinking-on": summary.requests["thinking-on"]!.requestSetSha256 })));
    for (const absent of ["Registry-Alias", "127.0.0.1", `:${server.port}`, "input/corpus", "e0-extractor-fixture-v1", "e0-extractor-fixture-2026", "S1C1", "bad request", "hidden usage text",
      "Halverstrand", "repeat_condition_chunk"]) expect(line).not.toContain(absent);
    expect(refusedRow(out, "accepted", { "--task": "e0-synthetic-extraction" })).toContain("--task must equal the fixture manifest's task");
    expect(refusedRow(out, "accepted", { "--exposure": "exposed" })).toContain("--exposure must equal the fixture manifest's exposure");
    // What an interrupted run leaves: the summary as rewritten after the fourth call, without finishedUtc.
    const left = JSON.parse(readFileSync(join(interim, "summary.json"), "utf8")) as { finishedUtc?: string; calls: unknown[]; counts: unknown };
    expect([left.finishedUtc, left.calls.length]).toEqual([undefined, 4]);
    expect(JSON.parse(writeRow(interim, "incomplete"))).toMatchObject({ modelCalls: 4, inputTokens: 2 * 1500, wallSeconds: null, terminalCause: "fixture_unfinished",
      fixture: { finished: false, classes: left.counts } });
    expect(refusedRow(interim, "accepted")).toContain("did not finish");
  });
});
