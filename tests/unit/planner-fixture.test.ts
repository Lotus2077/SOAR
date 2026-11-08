import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { deriveBriefUnits, inventoryResearchSources } from "../../src/main/private-agent/research-coverage";
import { assembleIndexEntry, buildLiteralSourceCard } from "../../src/main/private-agent/research-index";
import { RESEARCH_PLAN_JSON_SCHEMA } from "../../src/main/private-agent/research-plan";
import { OUTPUT_TOKENS, PLAN_SYSTEM, researchProtocolSha256 } from "../../src/main/private-agent/research-pipeline";
import { DEFAULT_CONDITIONS, buildPlannerBody, buildPlannerMessages, runPlannerFixture, verifyFixtureInputs, type FixtureCondition } from "../../scripts/planner-fixture";

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
async function fakeServer(script: (ordinal: number) => { content: string; finish: string; status?: number }) {
  const requests: { url: string; headers: Record<string, string | string[] | undefined>; body: any }[] = [];
  const server: Server = createServer((request, response) => {
    let data = ""; request.on("data", chunk => { data += chunk; });
    request.on("end", () => {
      requests.push({ url: request.url ?? "", headers: request.headers, body: JSON.parse(data) });
      const reply = script(requests.length);
      response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "x", model: "Synthetic", choices: [{ index: 0, message: { role: "assistant", content: reply.content, reasoning_content: "hidden thoughts" }, finish_reason: reply.finish }],
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
    const template = JSON.parse(readFileSync(join(ROOT, "docs", "experiments", "e0-planner-fixture-v1.json"), "utf8"));
    expect(template).toMatchObject({ status: "template", indexSha256: null, briefSha256: null, sourceIdsSha256: null, mandatorySourceChunks: null, conditions: [...DEFAULT_CONDITIONS], repeats: 10 });
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
