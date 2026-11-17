import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, vllmCacheSalt } from "../../src/main/private-agent/model";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { deriveBriefUnits, inventoryResearchSources } from "../../src/main/private-agent/research-coverage";
import { assembleIndexEntry, buildLiteralSourceCard } from "../../src/main/private-agent/research-index";
import { RESEARCH_PLAN_JSON_SCHEMA } from "../../src/main/private-agent/research-plan";
import { OUTPUT_TOKENS, PLAN_SYSTEM, researchProtocolSha256, runResearchPipeline } from "../../src/main/private-agent/research-pipeline";
import { DEFAULT_CONDITIONS, FIXTURE_CONDITIONS, FIXTURE_JOB_ID, PLAN_RESPONSE_FORMAT, PlannerFixtureManifestSchema, buildPlannerBody, buildPlannerMessages, plannerConditionCap, runPlannerFixture, verifyFixtureInputs,
  type FixtureCondition } from "../../scripts/planner-fixture";
import { buildLocalScreenModelConfig } from "../../scripts/private-agent-local-screen";
import { RESEARCH_V4_TEST_BRIEF, researchV4Reply, researchV4Sources } from "../helpers/research-v4-fixture";

const cleanups: (() => void)[] = [];
afterEach(async () => { for (const step of cleanups.splice(0).reverse()) await step(); });
const ROOT = resolve(__dirname, "..", "..");

/** A pinned index the way a run leaves one: host-literal entries built by the real index functions, hashed into a manifest. */
function fixtureInputs() {
  const brief = "1. Describe the supplied synthetic observations.\n2. Name every conflict between the two surveys.\n";
  const sources = [{ id: "input/corpus/alpha.md", path: "input/corpus/alpha.md", bytes: Buffer.from("# Synthetic alpha\nThe orchard recorded twelve healthy trees during the autumn survey.\n") },
    { id: "input/corpus/beta.md", path: "input/corpus/beta.md", bytes: Buffer.from("# Synthetic beta\nThe meadow recorded seven healthy trees during the spring survey.\n") }];
  const inventory = inventoryResearchSources(sources);
  const indexDocument = { version: 2, sources: inventory.sources.map(s => assembleIndexEntry(buildLiteralSourceCard({ sourceId: s.id, bytes: sources.find(x => x.id === s.id)!.bytes }), undefined, 0)) };
  const index = Buffer.from(`${canonical(indexDocument)}\n`), briefBytes = Buffer.from(brief);
  const manifest = { schemaVersion: 1, name: "e0-planner-fixture-test", status: "pinned", task: "synthetic", exposure: "exposed", indexVersion: 2, indexSha256: digest(index), briefSha256: digest(briefBytes),
    sourceIdsSha256: digest(canonical(inventory.sources.map(s => s.id).sort())), sourceCount: 2, mandatorySourceChunks: inventory.chunks.length, extractionCallBudget: 40, conditions: [...DEFAULT_CONDITIONS], repeats: 10 };
  return { brief, sources, inventory, indexDocument, index, briefBytes, manifest };
}
const plan = (sourceIds: string[]) => JSON.stringify({ version: 2, questions: [{ id: "Q1", text: "What do the surveys establish?", requirementIds: ["U1", "U2"], sourceIds, lookFor: [] }], conflictsToCheck: [], deliverableNotes: "" });

/** A loopback fake of the chat-completions route that answers a scripted reply per call and records every request. */
async function fakeServer(script: (ordinal: number) => { content?: unknown; finish?: string; status?: number; body?: unknown }) {
  const requests: { url: string; headers: Record<string, string | string[] | undefined>; body: any; raw: string }[] = [];
  const server: Server = createServer((request, response) => {
    let data = ""; request.on("data", chunk => { data += chunk; });
    request.on("end", () => {
      requests.push({ url: request.url ?? "", headers: request.headers, body: JSON.parse(data), raw: data });
      const reply = script(requests.length);
      response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      // A script's `body` replaces the whole reply, envelope included.
      response.end(JSON.stringify("body" in reply ? reply.body : { id: "x", model: "Synthetic", choices: [{ index: 0, message: { role: "assistant",
        ...(reply.content === undefined ? {} : { content: reply.content }), reasoning_content: "hidden thoughts" }, finish_reason: reply.finish ?? "stop" }],
        usage: { prompt_tokens: 1200, completion_tokens: 80, completion_tokens_details: { reasoning_tokens: 40 } } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { requests, baseUrl: `http://127.0.0.1:${port}/v1`, port };
}
function outDir() { const root = mkdtempSync(join(tmpdir(), "soar-planner-fixture-")); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; }

describe("planner fixture request builder", () => {
  it("sends PLAN_SYSTEM and the pipeline's user payload with the authoritative schema, and its bodies equal model.ts's byte for byte", async () => {
    const f = fixtureInputs(), fixture = verifyFixtureInputs({ index: f.index, brief: f.briefBytes, manifest: f.manifest });
    const messages = buildPlannerMessages(fixture);
    expect(messages[0]).toEqual({ role: "system", content: PLAN_SYSTEM });
    const payload = JSON.parse(messages[1]!.content);
    expect(payload.authoritativeSchema).toEqual(RESEARCH_PLAN_JSON_SCHEMA); expect(payload.repair).toBeNull(); expect(payload.brief).toBe(f.brief);
    expect(payload.units).toEqual(deriveBriefUnits(f.brief)); expect(payload.sourceIndex).toEqual(JSON.parse(canonical(f.indexDocument)));
    expect(payload.mandatorySourceChunks).toBe(f.inventory.chunks.length); expect(payload.extractionCallBudget).toBe(40);
    expect(Object.keys(payload).sort()).toEqual(["authoritativeSchema", "brief", "extractionCallBudget", "mandatorySourceChunks", "repair", "sourceIndex", "units"]);
    // The exact owned-destination body the pipeline sends, captured from PrivateAgentModel with a fake broker.
    const capture = async (config: Record<string, unknown>, thinking?: "disabled") => {
      let captured = "";
      const broker = { request: async (request: { body: string }, settle: (bytes: Buffer) => number) => { captured = request.body;
        const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } })); return { bytes, receipt: { feeMicrousd: settle(bytes) } }; } };
      const model = new PrivateAgentModel(broker as unknown as PrivateAgentBroker, { destinationId: "owned", model: "Synthetic", maxOutputTokens: 16384, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium", sampling: COORDINATOR_PROFILES.heavy.sampling, ...config } as never, "job", "context");
      await model.complete(messages, [], new AbortController().signal, { maxOutputTokens: OUTPUT_TOKENS.plan, purpose: "research plan", ...(thinking ? { thinking } : {}) });
      return captured;
    };
    expect(await capture({})).toBe(buildPlannerBody("legacy-thinking", "Synthetic", messages));
    expect(await capture({}, "disabled")).toBe(buildPlannerBody("thinking-off", "Synthetic", messages));
    expect(await capture({ localReplyContract: "flash_next_v1", localContextTokens: 262144 })).toBe(buildPlannerBody("flash-thinking", "Synthetic", messages));
    expect(await capture({ localReplyContract: "flash_next_v1", localContextTokens: 262144 }, "disabled")).toBe(buildPlannerBody("flash-thinking-off", "Synthetic", messages));
    const legacy = JSON.parse(buildPlannerBody("legacy-thinking", "Synthetic", messages)), flash = JSON.parse(buildPlannerBody("flash-thinking", "Synthetic", messages)), off = JSON.parse(buildPlannerBody("thinking-off", "Synthetic", messages));
    expect(legacy).toMatchObject({ max_tokens: 8192, reasoning_effort: "medium", temperature: 1, top_p: 0.95, top_k: 20, stream: false }); expect(legacy).not.toHaveProperty("chat_template_kwargs");
    expect(flash).toMatchObject({ max_tokens: 8192, reasoning_effort: "medium", chat_template_kwargs: { enable_thinking: true, preserve_thinking: false } });
    expect(off).toMatchObject({ max_tokens: 8192, chat_template_kwargs: { enable_thinking: false } }); expect(off).not.toHaveProperty("reasoning_effort"); expect(off).not.toHaveProperty("temperature");
    expect(JSON.parse(buildPlannerBody("legacy-thinking", "Synthetic", messages, { cacheSalt: "s".repeat(64) })).cache_salt).toBe("s".repeat(64));
  });

  it("refuses a template manifest or a hash mismatch before any request", async () => {
    const f = fixtureInputs(), server = await fakeServer(() => ({ content: plan([]), finish: "stop" })), out = outDir();
    // E0 card Amendment 1 pins the committed manifest, so the template is that manifest with its pinned fields cleared.
    const committed = JSON.parse(readFileSync(join(ROOT, "docs", "experiments", "e0-planner-fixture-v1.json"), "utf8"));
    expect(PlannerFixtureManifestSchema.parse(committed)).toMatchObject({ status: "pinned", sourceCount: expect.any(Number), mandatorySourceChunks: expect.any(Number), conditions: [...DEFAULT_CONDITIONS], repeats: 10 });
    for (const key of ["indexSha256", "briefSha256", "sourceIdsSha256"]) expect(committed[key]).toMatch(/^[a-f0-9]{64}$/u);
    const template = { ...committed, status: "template", indexSha256: null, briefSha256: null, sourceIdsSha256: null, sourceCount: null, mandatorySourceChunks: null };
    const attempt = (manifest: unknown, index = f.index) => runPlannerFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: { index, brief: f.briefBytes, manifest }, out, repeats: 1, conditions: DEFAULT_CONDITIONS });
    await expect(attempt(template)).rejects.toThrow("planner_fixture_manifest_template");
    await expect(attempt({ ...f.manifest, indexSha256: "0".repeat(64) })).rejects.toThrow("planner_fixture_index_mismatch");
    await expect(attempt({ ...f.manifest, briefSha256: "0".repeat(64) })).rejects.toThrow("planner_fixture_brief_mismatch");
    await expect(attempt({ ...f.manifest, sourceIdsSha256: "0".repeat(64) })).rejects.toThrow("planner_fixture_source_ids_mismatch");
    await expect(attempt({ ...f.manifest, sourceCount: 3 })).rejects.toThrow("planner_fixture_source_ids_mismatch");
    await expect(attempt({ ...f.manifest, extra: true })).rejects.toThrow();
    // Both occurrences (the entry's own sourceId and its literal card's) change, so the source-id digest no longer matches.
    const tampered = Buffer.from(f.index.toString("utf8").replaceAll('"sourceId":"input/corpus/alpha.md"', '"sourceId":"input/corpus/alpha2.md"'));
    expect(tampered.equals(f.index)).toBe(false);
    await expect(attempt({ ...f.manifest, indexSha256: digest(tampered) }, tampered)).rejects.toThrow("planner_fixture_source_ids_mismatch");
    expect(server.requests).toHaveLength(0); expect(readdirSync(out)).toEqual([]);
  });

  it("runs the conditions against a loopback endpoint, retains raw replies with mode 0600 and records attempt summaries without the address", async () => {
    const f = fixtureInputs();
    const server = await fakeServer(ordinal => ordinal === 1 ? { content: plan(["input/corpus/alpha.md"]), finish: "stop" } : ordinal === 2 ? { content: plan([]).slice(0, 40), finish: "length" }
      : ordinal === 3 ? { content: plan(["input/corpus/unlisted.md"]), finish: "stop" } : { content: "not json", finish: "stop", status: 400 });
    const out = join(outDir(), "e0-planner-fixture-test");
    const summary = await runPlannerFixture({ endpoint: { baseUrl: server.baseUrl, apiKey: "test-key", model: "Synthetic" }, inputs: { index: f.index, brief: f.briefBytes, manifest: f.manifest }, out, repeats: 1, conditions: [...DEFAULT_CONDITIONS, "flash-thinking-off"] });
    expect(server.requests).toHaveLength(4);
    expect(server.requests.every(r => r.url === "/v1/chat/completions" && r.headers.authorization === "Bearer test-key")).toBe(true);
    expect(server.requests.map(r => r.body.chat_template_kwargs ?? null)).toEqual([null, { enable_thinking: true, preserve_thinking: false }, { enable_thinking: false }, { enable_thinking: false, preserve_thinking: false }]);
    expect(server.requests[0]!.body.messages[0]).toEqual({ role: "system", content: PLAN_SYSTEM });
    expect(summary).toMatchObject({ version: 1, protocolSha256: researchProtocolSha256(), model: "Synthetic", repeats: 1, units: 2, dryRun: false,
      manifest: { indexSha256: f.manifest.indexSha256, briefSha256: f.manifest.briefSha256, sourceIdsSha256: f.manifest.sourceIdsSha256, sourceCount: 2, mandatorySourceChunks: f.inventory.chunks.length },
      counts: { "legacy-thinking": { valid: 1 }, "flash-thinking": { truncated: 1 }, "thinking-off": { binding_invalid: 1 }, "flash-thinking-off": { request_rejected: 1 } } });
    for (const condition of DEFAULT_CONDITIONS) expect(summary.requests[condition]).toEqual({ requestSha256: digest(buildPlannerBody(condition as FixtureCondition, "Synthetic", buildPlannerMessages(verifyFixtureInputs({ index: f.index, brief: f.briefBytes, manifest: f.manifest })))), requestBytes: expect.any(Number), maxTokens: 8192 });
    const [valid, truncated, binding, rejected] = summary.calls;
    expect(valid).toMatchObject({ condition: "legacy-thinking", ordinal: 1, status: 200, replyFile: "legacy-thinking-01.json", finishReason: "stop", reasoningField: "reasoning_content", reasoningBytes: Buffer.byteLength("hidden thoughts"), classification: "valid",
      attempt: { accepted: true, bindingInspection: "completed", errors: [], truncated: false } });
    expect(truncated).toMatchObject({ classification: "truncated", attempt: { accepted: false, truncated: true, bindingInspection: "not_run", errors: [{ code: "truncated", path: [] }] } });
    expect(binding).toMatchObject({ classification: "binding_invalid", attempt: { accepted: false, bindingInspection: "completed" } });
    expect(binding!.attempt!.errors.some(e => e.code === "unknown_source_id")).toBe(true);
    expect(rejected).toMatchObject({ classification: "request_rejected", status: 400, replyFile: "flash-thinking-off-01.json" }); expect(rejected).not.toHaveProperty("attempt");
    // Raw replies are retained whole under out/replies, owner-readable only; the summary binds each by digest and never holds the text.
    const replies = readdirSync(join(out, "replies")).sort();
    expect(replies).toEqual(["flash-thinking-01.json", "flash-thinking-off-01.json", "legacy-thinking-01.json", "thinking-off-01.json"]);
    for (const call of summary.calls) {
      const stored = readFileSync(join(out, "replies", call.replyFile!));
      expect(statSync(join(out, "replies", call.replyFile!)).mode & 0o777).toBe(0o600); expect(digest(stored)).toBe(call.bodySha256);
      if (call.attempt) expect(call.attempt.replyContentSha256).toBe(digest(JSON.parse(stored.toString("utf8")).choices[0].message.content));
    }
    expect(statSync(join(out, "summary.json")).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(out, "summary.json"), "utf8"))).toEqual(JSON.parse(JSON.stringify(summary)));
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("127.0.0.1"); expect(serialized).not.toContain(String(server.port)); expect(serialized).not.toContain("hidden thoughts"); expect(serialized).not.toContain("test-key"); expect(serialized).not.toContain("orchard");
    // A dry run builds and hashes the requests, sends nothing and writes nothing.
    const dry = await runPlannerFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: { index: f.index, brief: f.briefBytes, manifest: f.manifest }, out: join(out, "dry"), repeats: 3, conditions: DEFAULT_CONDITIONS, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, calls: [], counts: {} }); expect(Object.keys(dry.requests)).toEqual([...DEFAULT_CONDITIONS]); expect(server.requests).toHaveLength(4); expect(existsSync(join(out, "dry"))).toBe(false);
  });

  it("reads a reply as the model layer does: a cap spent on thinking with no content is truncated, and a reply the model layer rejects is malformed", async () => {
    // The shape E0's planner fixture recorded on the r3 index: content null and finish_reason "length", the reasoning having used the whole cap.
    const f = fixtureInputs(), usage = { prompt_tokens: 1200, completion_tokens: 80 };
    const envelope = (choices: unknown, rest: Record<string, unknown> = { usage }) => ({ body: { id: "x", model: "Synthetic", choices, ...rest } });
    const message = { role: "assistant", content: null };
    const replies = [{ content: null, finish: "length" }, { content: null, finish: "stop" }, { finish: "length" },
      // Rejected by the model layer's reply schema: a parts array, no message, an array or null message, two choices, no finish_reason, no usage, a null body.
      { content: [{ type: "text", text: "parts" }] }, envelope([{ index: 0, finish_reason: "length" }]), envelope([{ index: 0, message: [], finish_reason: "length" }]),
      envelope([{ index: 0, message: null, finish_reason: "stop" }]), envelope([{ index: 0, message, finish_reason: "length" }, { index: 1, message, finish_reason: "length" }]),
      envelope([{ index: 0, message }]), envelope([{ index: 0, message, finish_reason: "length" }], {}), { body: null }];
    const server = await fakeServer(ordinal => replies[ordinal - 1]!);
    const summary = await runPlannerFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: { index: f.index, brief: f.briefBytes, manifest: f.manifest },
      out: join(outDir(), "null-content"), repeats: replies.length, conditions: ["legacy-thinking"] });
    expect(summary.calls.map(c => c.classification)).toEqual(["truncated", "invalid_json", "truncated", ...Array(8).fill("malformed_reply")]);
    // The attempt records no reply bytes, which tells a cap spent on thinking from an answer cut off midway; the reasoning is counted, never kept in the summary.
    expect(summary.calls[0]).toMatchObject({ finishReason: "length", reasoningField: "reasoning_content", reasoningBytes: Buffer.byteLength("hidden thoughts"),
      usage: { completion_tokens: 80 }, attempt: { truncated: true, replyBytes: 0, accepted: false, errors: [{ code: "truncated", path: [] }] } });
    expect(summary.calls.slice(3).every(c => !("attempt" in c) && !("usage" in c))).toBe(true);
    expect(summary.counts).toEqual({ "legacy-thinking": { truncated: 2, invalid_json: 1, malformed_reply: 8 } });
  });
  it("runs from the command line through loadConfig with a dry run that prints no address", () => {
    const f = fixtureInputs(), root = outDir();
    writeFileSync(join(root, "index.json"), f.index); writeFileSync(join(root, "brief.md"), f.briefBytes); writeFileSync(join(root, "manifest.json"), JSON.stringify(f.manifest));
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1", SOAR_VLLM_MODEL: "Synthetic", SOAR_ENV_FILE: join(root, "none.env") };
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "scripts/planner-fixture.ts", "--index", join(root, "index.json"), "--brief", join(root, "brief.md"), "--manifest", join(root, "manifest.json"), "--repeats", "2", "--dry-run"],
      { cwd: root === ROOT ? root : ROOT, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    const printed = JSON.parse(stdout);
    expect(printed).toMatchObject({ dryRun: true, conditions: [...DEFAULT_CONDITIONS], repeats: 2, units: 2, retained: null });
    expect(Object.keys(printed.requests)).toEqual([...DEFAULT_CONDITIONS]); expect(stdout).not.toContain("127.0.0.1");
  });
});

describe("planner fixture: the serving card's plan call (manifest v2, BL-20261116-1253-e0-planner-structured-condition-design)", () => {
  const STRUCTURED = ["legacy-thinking-structured", "legacy-thinking-structured-16384"] as const;
  /** The owned-destination body PrivateAgentModel builds for one plan call, captured with a fake broker. */
  async function capture(messages: { role: "system" | "user"; content: string }[], maxOutputTokens: number) {
    let captured = "";
    const broker = { request: async (request: { body: string }, settle: (bytes: Buffer) => number) => { captured = request.body;
      const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } })); return { bytes, receipt: { feeMicrousd: settle(bytes) } }; } };
    const model = new PrivateAgentModel(broker as unknown as PrivateAgentBroker, { destinationId: "owned", model: "Synthetic", maxOutputTokens: 16384, inputUsdPerMillion: 0, outputUsdPerMillion: 0,
      thinking: "medium", sampling: COORDINATOR_PROFILES.heavy.sampling }, "job", "ctx");
    await model.complete(messages, [], new AbortController().signal, { maxOutputTokens, purpose: "research plan", responseFormat: PLAN_RESPONSE_FORMAT });
    return captured;
  }

  it("builds the card's plan call as model.ts does: item 9's strict research_plan format with thinking on, at 8,192 and at 16,384", async () => {
    const f = fixtureInputs(), messages = buildPlannerMessages(verifyFixtureInputs({ index: f.index, brief: f.briefBytes, manifest: f.manifest }));
    expect(await capture(messages, 8192)).toBe(buildPlannerBody("legacy-thinking-structured", "Synthetic", messages));
    expect(await capture(messages, 16384)).toBe(buildPlannerBody("legacy-thinking-structured-16384", "Synthetic", messages));
    expect(JSON.parse(buildPlannerBody("legacy-thinking-structured", "Synthetic", messages))).toMatchObject({ max_tokens: OUTPUT_TOKENS.plan, reasoning_effort: "medium", stream: false,
      response_format: { type: "json_schema", json_schema: { name: "research_plan", schema: RESEARCH_PLAN_JSON_SCHEMA, strict: true } } });
    expect([plannerConditionCap("legacy-thinking-structured"), plannerConditionCap("legacy-thinking-structured-16384")]).toEqual([OUTPUT_TOKENS.plan, COORDINATOR_PROFILES.heavy.maxOutputTokens]);
    for (const condition of ["legacy-thinking", "flash-thinking", "thinking-off", "flash-thinking-off"] as const) {
      expect(JSON.parse(buildPlannerBody(condition, "Synthetic", messages))).not.toHaveProperty("response_format"); expect(plannerConditionCap(condition)).toBe(OUTPUT_TOKENS.plan);
    }
  });

  it("sends, as legacy-thinking-structured, the first plan call the pipeline itself sends under the committed card, byte for byte", async () => {
    const sent: string[] = [];
    const request = async (input: { body: string }, settle: (bytes: Buffer) => number) => {
      const body = JSON.parse(input.body); sent.push(input.body);
      const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: researchV4Reply(body.messages[0].content, body.messages[1].content) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20 } }));
      return { bytes, receipt: { feeMicrousd: settle(bytes) } };
    };
    // The driver's model configuration, unstreamed as the fixture sends, under the fixture's job: the same salt as its --cache-salt bodies.
    const config = buildLocalScreenModelConfig({ vllm: { model: "Synthetic" } as never, streamingEnabled: false }, COORDINATOR_PROFILES.heavy, true);
    const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, FIXTURE_JOB_ID, "reader");
    // The committed card is still proposed: its roles go to the pipeline as the reader would return them once it is adopted.
    const roles = JSON.parse(readFileSync(join(ROOT, "docs", "experiments", "serving-card-2026-11-16.json"), "utf8")).roles;
    const outcome = await runResearchPipeline({ brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), models: { reader: make(), planner: make(), synthesiser: make() },
      signal: new AbortController().signal, record: () => {}, roles });
    expect(outcome.reason).not.toBe("research_role_policy_invalid");
    const planCall = sent.find(body => JSON.parse(body).messages[0].content === PLAN_SYSTEM)!, payload = JSON.parse(JSON.parse(planCall).messages[1].content);
    // The fixture pinned to that call's own index and brief rebuilds the same messages, and the card's call is the structured condition's body.
    const index = Buffer.from(`${canonical(payload.sourceIndex)}\n`), brief = Buffer.from(payload.brief), ids = payload.sourceIndex.sources.map((s: { sourceId: string }) => s.sourceId);
    const manifest = { schemaVersion: 1, name: "e0-planner-fixture-card-call", status: "pinned", task: "synthetic", exposure: "exposed", indexVersion: 2, indexSha256: digest(index),
      briefSha256: digest(brief), sourceIdsSha256: digest(canonical([...ids].sort())), sourceCount: ids.length, mandatorySourceChunks: payload.mandatorySourceChunks,
      extractionCallBudget: payload.extractionCallBudget, conditions: ["legacy-thinking-structured"], repeats: 1 };
    const messages = buildPlannerMessages(verifyFixtureInputs({ index, brief, manifest }));
    expect(planCall).toBe(buildPlannerBody("legacy-thinking-structured", "Synthetic", messages, { cacheSalt: vllmCacheSalt(FIXTURE_JOB_ID) }));
  });

  it("runs every condition in turn within each repeat, so drift at the endpoint falls on every condition alike", async () => {
    const f = fixtureInputs(), server = await fakeServer(() => ({ content: plan(["input/corpus/alpha.md"]), finish: "stop" }));
    const summary = await runPlannerFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: { index: f.index, brief: f.briefBytes, manifest: f.manifest },
      out: join(outDir(), "order"), repeats: 2, conditions: ["legacy-thinking", ...STRUCTURED] });
    expect(summary.calls.map(c => `${c.ordinal}/${c.condition}`)).toEqual(["1/legacy-thinking", "1/legacy-thinking-structured", "1/legacy-thinking-structured-16384",
      "2/legacy-thinking", "2/legacy-thinking-structured", "2/legacy-thinking-structured-16384"]);
    expect(server.requests.map(r => r.body.max_tokens)).toEqual([8192, 8192, 16384, 8192, 8192, 16384]);
    expect(server.requests.map(r => "response_format" in r.body)).toEqual([false, true, true, false, true, true]);
  });

  it("pins v1's index and brief with the card's call beside the call without a card, and the command line takes that design from the manifest", () => {
    const read = (name: string) => PlannerFixtureManifestSchema.parse(JSON.parse(readFileSync(join(ROOT, "docs", "experiments", name), "utf8")));
    const v1 = read("e0-planner-fixture-v1.json"), v2 = read("e0-planner-fixture-v2.json");
    const pins = (m: Record<string, any>) => { const { name: _n, note: _o, conditions: _c, ...rest } = m; return rest; };
    expect(pins(v2)).toEqual(pins(v1)); expect(v2).toMatchObject({ name: "e0-planner-fixture-v2", status: "pinned", conditions: ["legacy-thinking", ...STRUCTURED], repeats: 10 });
    // Without --conditions and --repeats the run is the manifest's design, and each condition records its own cap.
    const f = fixtureInputs(), root = outDir();
    writeFileSync(join(root, "index.json"), f.index); writeFileSync(join(root, "brief.md"), f.briefBytes);
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ ...f.manifest, conditions: ["legacy-thinking", ...STRUCTURED], repeats: 3 }));
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1", SOAR_VLLM_MODEL: "Synthetic", SOAR_ENV_FILE: join(root, "none.env") };
    const dry = (extra: string[]) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/planner-fixture.ts", "--index", join(root, "index.json"), "--brief", join(root, "brief.md"),
      "--manifest", join(root, "manifest.json"), "--dry-run", ...extra], { cwd: ROOT, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }));
    const printed = dry([]);
    expect(printed).toMatchObject({ dryRun: true, conditions: ["legacy-thinking", ...STRUCTURED], repeats: 3 });
    expect(Object.fromEntries(Object.entries(printed.requests).map(([condition, value]) => [condition, (value as { maxTokens: number }).maxTokens])))
      .toEqual({ "legacy-thinking": 8192, "legacy-thinking-structured": 8192, "legacy-thinking-structured-16384": 16384 });
    // Explicit flags still override the manifest's design, as before.
    expect(dry(["--conditions", "thinking-off", "--repeats", "2"])).toMatchObject({ conditions: ["thinking-off"], repeats: 2 });
  });

  it("salts every body with the fixture's one salt under --cache-salt and only then: the request digests a dry run records, and the bodies a run sends on every repeat", async () => {
    const f = fixtureInputs(), inputs = { index: f.index, brief: f.briefBytes, manifest: f.manifest }, messages = buildPlannerMessages(verifyFixtureInputs(inputs));
    const salt = vllmCacheSalt(FIXTURE_JOB_ID), conditions = [...FIXTURE_CONDITIONS];
    const plain = conditions.map(c => buildPlannerBody(c, "Synthetic", messages)), salted = conditions.map(c => buildPlannerBody(c, "Synthetic", messages, { cacheSalt: salt }));
    // Each salted body is the plain body with the one salt added, and nothing else changed.
    salted.forEach((body, i) => { const { cache_salt: added, ...rest } = JSON.parse(body); expect(added).toBe(salt); expect(canonical(rest)).toBe(plain[i]); });
    const recorded = (bodies: string[]) => Object.fromEntries(conditions.map((c, i) => [c, { requestSha256: digest(bodies[i]!), requestBytes: Buffer.byteLength(bodies[i]!), maxTokens: plannerConditionCap(c) }]));
    const run = (options: { cacheSalt?: boolean; dryRun?: boolean }, baseUrl = "http://127.0.0.1:9/v1") =>
      runPlannerFixture({ endpoint: { baseUrl, model: "Synthetic" }, inputs, out: join(outDir(), "salt"), repeats: 2, conditions, ...options });
    expect((await run({ dryRun: true })).requests).toEqual(recorded(plain)); expect((await run({ dryRun: true, cacheSalt: false })).requests).toEqual(recorded(plain));
    expect((await run({ dryRun: true, cacheSalt: true })).requests).toEqual(recorded(salted));
    // A run sends those bodies byte for byte: the same salt on every call of both repeats with the option, and none without it.
    const server = await fakeServer(() => ({ content: plan(["input/corpus/alpha.md"]), finish: "stop" }));
    expect((await run({ cacheSalt: true }, server.baseUrl)).requests).toEqual(recorded(salted)); expect((await run({}, server.baseUrl)).requests).toEqual(recorded(plain));
    expect(server.requests.map(r => r.raw)).toEqual([...salted, ...salted, ...plain, ...plain]);
  });

  it("takes --cache-salt from the command line: its dry run prints the salted request digests with the flag and the plain ones without it", () => {
    const f = fixtureInputs(), root = outDir(), conditions = ["legacy-thinking", ...STRUCTURED] as const;
    const messages = buildPlannerMessages(verifyFixtureInputs({ index: f.index, brief: f.briefBytes, manifest: f.manifest }));
    writeFileSync(join(root, "index.json"), f.index); writeFileSync(join(root, "brief.md"), f.briefBytes); writeFileSync(join(root, "manifest.json"), JSON.stringify({ ...f.manifest, conditions, repeats: 10 }));
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1", SOAR_VLLM_MODEL: "Synthetic", SOAR_ENV_FILE: join(root, "none.env") };
    const printed = (extra: string[]) => Object.fromEntries(Object.entries(JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/planner-fixture.ts", "--index", join(root, "index.json"),
      "--brief", join(root, "brief.md"), "--manifest", join(root, "manifest.json"), "--dry-run", ...extra], { cwd: ROOT, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] })).requests as Record<string, { requestSha256: string }>)
      .map(([condition, request]) => [condition, request.requestSha256]));
    const expected = (options: { cacheSalt?: string }) => Object.fromEntries(conditions.map(c => [c, digest(buildPlannerBody(c, "Synthetic", messages, options))]));
    expect(printed(["--cache-salt"])).toEqual(expected({ cacheSalt: vllmCacheSalt(FIXTURE_JOB_ID) })); expect(printed([])).toEqual(expected({}));
  });
});
