import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENTAILMENT_OUTPUT_TOKENS, ENTAILMENT_PROMPT_VERSION, ENTAILMENT_PURPOSE, ENTAILMENT_SYSTEM_PROMPT, ENTAILMENT_VERDICTS, entailmentMessages, judgeClaims } from "../../src/main/private-agent/claims";
import { digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { buildJudgeBody, buildJudgeMessages, flipRate, harvestClaims, parseJudgeReply, reversedSystemPrompt, runJudgeFixture, scoreVerdicts, verifyJudgeFixtureInputs,
  type FixtureClaim, type JudgeCondition } from "../../scripts/judge-fixture";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const step of cleanups.splice(0).reverse()) await step(); });
const ROOT = resolve(__dirname, "..", "..");
function tempDir(prefix = "soar-judge-fixture-") { const root = mkdtempSync(join(tmpdir(), prefix)); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; }

/** Two synthetic claims per class; C5 and C7 are planted negatives built from real-looking passages. */
const PASSAGE_A = "The orchard recorded twelve healthy trees during the autumn survey, and the meadow recorded seven.";
const PASSAGE_B = "Water use fell by a fifth after the drip lines were installed in the spring of the second year.";
const CLAIMS: FixtureClaim[] = [
  { id: "C1", sentence: "The orchard had twelve healthy trees in autumn.", quote: "twelve healthy trees", context: PASSAGE_A },
  { id: "C2", sentence: "Water use fell after drip lines were installed.", quote: "Water use fell by a fifth", context: PASSAGE_B },
  { id: "C3", sentence: "Both sites were surveyed and both had healthy trees in large numbers.", quote: "the meadow recorded seven", context: PASSAGE_A },
  { id: "C4", sentence: "Water use fell by a fifth in the first year.", quote: "Water use fell by a fifth", context: PASSAGE_B },
  { id: "C5", sentence: "The orchard's trees were all over fifty years old.", quote: "twelve healthy trees", context: PASSAGE_A },
  { id: "C6", sentence: "Drip lines cost less than sprinklers.", quote: "drip lines were installed", context: PASSAGE_B },
  { id: "C7", sentence: "The meadow recorded twelve healthy trees.", quote: "the meadow recorded seven", context: PASSAGE_A },
  { id: "C8", sentence: "Water use rose after the drip lines went in.", quote: "Water use fell by a fifth", context: PASSAGE_B },
];
const LABELS = { C1: "supported", C2: "supported", C3: "partial", C4: "partial", C5: "unsupported", C6: "unsupported", C7: "contradicted", C8: "contradicted" } as const;
function inputs(overrides: Record<string, unknown> = {}, claims = CLAIMS, labels: Record<string, string> = LABELS) {
  const claimsBytes = Buffer.from(`${JSON.stringify({ version: 1, task: "synthetic", claims }, null, 1)}\n`);
  const labelsBytes = Buffer.from(`${JSON.stringify({ version: 1, protocol: "e0-judge-labelling-v1", labeller: "separate synthetic session",
    labels: Object.entries(labels).map(([id, label]) => ({ id, label, planted: id === "C5" || id === "C7", ...(id === "C5" ? { note: "PLANTED-NOTE" } : {}) })) }, null, 1)}\n`);
  const manifest = { schemaVersion: 1, name: "e0-judge-fixture-test", status: "pinned", task: "synthetic", exposure: "exposed", promptVersion: ENTAILMENT_PROMPT_VERSION,
    claimsSha256: digest(claimsBytes), labelsSha256: digest(labelsBytes), claimCount: 8, labelCounts: { supported: 2, partial: 2, unsupported: 2, contradicted: 2 }, plantedCount: 2,
    minimumPerClass: 2, agreement: { measure: "established", level: 0.7 }, conditions: ["j1-legacy"], repeats: 1, ...overrides };
  return { claims: claimsBytes, labels: labelsBytes, manifest };
}

/** A loopback chat-completions fake; `reply` sees the system prompt, the claim's sentence and the per-(prompt, sentence) call count. */
async function fakeServer(reply: (input: { reversed: boolean; sentence: string; call: number }) => { content?: string; status?: number }) {
  const requests: { url: string; headers: Record<string, string | string[] | undefined>; raw: string; body: any }[] = [], calls = new Map<string, number>();
  const server: Server = createServer((request, response) => {
    let data = ""; request.on("data", chunk => { data += chunk; });
    request.on("end", () => {
      const body = JSON.parse(data); requests.push({ url: request.url ?? "", headers: request.headers, raw: data, body });
      const reversed = body.messages[0].content !== ENTAILMENT_SYSTEM_PROMPT, sentence = JSON.parse(/^Sentence: (".*")$/mu.exec(body.messages[1].content)![1]!) as string;
      const key = `${reversed}|${sentence}`, call = (calls.get(key) ?? 0) + 1; calls.set(key, call);
      const scripted = reply({ reversed, sentence, call });
      response.writeHead(scripted.status ?? 200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "x", model: "Synthetic", choices: [{ index: 0, message: { role: "assistant", content: scripted.content ?? "", reasoning_content: "hidden thoughts" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 300, completion_tokens: 20 } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { requests, baseUrl: `http://127.0.0.1:${port}/v1`, port };
}
const verdictReply = (verdict: string) => ({ content: `{"verdict":"${verdict}","reason":"synthetic"}` });
const idOf = (sentence: string) => CLAIMS.find(claim => claim.sentence === sentence)!.id as keyof typeof LABELS;

describe("judge fixture requests", () => {
  it("sends the pass's own messages, and its bodies equal model.ts's byte for byte with the pass's overrides", async () => {
    const claim = CLAIMS[0]!, messages = buildJudgeMessages("j1-legacy", claim);
    expect(messages).toEqual(entailmentMessages({ id: claim.id, sentence: claim.sentence, quote: claim.quote, context: claim.context }));
    const capture = async (config: Record<string, unknown>) => {
      let captured = "";
      const broker = { request: async (request: { body: string }, settle: (bytes: Buffer) => number) => { captured = request.body;
        const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } })); return { bytes, receipt: { feeMicrousd: settle(bytes) } }; } };
      // The driver's judge is the local model config itself (heavy, thinking medium); the pass narrows it per call.
      const model = new PrivateAgentModel(broker as unknown as PrivateAgentBroker, { destinationId: "owned", model: "Synthetic", maxOutputTokens: 16384, inputUsdPerMillion: 0, outputUsdPerMillion: 0,
        thinking: "medium", sampling: COORDINATOR_PROFILES.heavy.sampling, ...config } as never, "job", "context");
      await model.complete(messages, [], new AbortController().signal, { thinking: "disabled", maxOutputTokens: ENTAILMENT_OUTPUT_TOKENS, purpose: ENTAILMENT_PURPOSE });
      return captured;
    };
    expect(await capture({})).toBe(buildJudgeBody("j1-legacy", "Synthetic", messages));
    expect(await capture({ localReplyContract: "flash_next_v1", localContextTokens: 262144 })).toBe(buildJudgeBody("j1-flash", "Synthetic", messages));
    const legacy = JSON.parse(buildJudgeBody("j1-legacy", "Synthetic", messages));
    expect(legacy).toMatchObject({ max_tokens: 256, stream: false, chat_template_kwargs: { enable_thinking: false } });
    expect(legacy).not.toHaveProperty("reasoning_effort"); expect(legacy).not.toHaveProperty("temperature"); expect(legacy).not.toHaveProperty("tools");
    expect(JSON.parse(buildJudgeBody("j1-legacy", "Synthetic", messages, { cacheSalt: "s".repeat(64) })).cache_salt).toBe("s".repeat(64));
  });
  it("reverses only the verdict order of the system prompt for the reversed conditions", () => {
    const reversed = reversedSystemPrompt(), sentences = (text: string) => text.split(/(?<=\.) /u).sort();
    expect(reversed).not.toBe(ENTAILMENT_SYSTEM_PROMPT); expect(reversed.length).toBe(ENTAILMENT_SYSTEM_PROMPT.length);
    expect(reversed).toContain('{"verdict":"contradicted"|"unsupported"|"partial"|"supported","reason"');
    expect(reversed.indexOf("contradicted: the passage says otherwise.")).toBeLessThan(reversed.indexOf("supported: the passage establishes the sentence."));
    // The same sentences apart from the one holding the JSON alternatives.
    const strip = (text: string) => sentences(text).filter(item => !item.includes('{"verdict"'));
    expect(strip(reversed)).toEqual(strip(ENTAILMENT_SYSTEM_PROMPT));
    const messages = buildJudgeMessages("j1-legacy-reversed", CLAIMS[0]!);
    expect(messages[0]).toEqual({ role: "system", content: reversed }); expect(messages[1]).toEqual(buildJudgeMessages("j1-legacy", CLAIMS[0]!)[1]);
  });
  it("parses each reply exactly as judgeClaims does", async () => {
    const replies = ['{"verdict":"supported"}', ' prefix {"verdict":"partial","reason":"r"} suffix', '{"verdict":"maybe"}', "no json", '{"verdict":"contradicted","extra":1}',
      '```json\n{"verdict":"unsupported","reason":"x"}\n```', ""];
    // Drive the real pass one reply at a time so each verdict lines up with its reply.
    const seen = new Set<string>();
    for (const [index, reply] of replies.entries()) {
      const single = await judgeClaims({ claims: [{ id: "C1", sentence: "s", quote: "q", context: "c" }], signal: new AbortController().signal, remainingMs: () => 600_000, complete: async () => ({ content: reply }) });
      expect(parseJudgeReply(reply), `reply ${index}`).toBe(single.verdicts[0]!.verdict); seen.add(single.verdicts[0]!.verdict);
    }
    // The strict reply schema refuses an extra key, so that reply is not judged in both places.
    expect([...seen].sort()).toEqual(["not_judged", "partial", "supported", "unsupported"]);
  });
});

describe("judge fixture inputs", () => {
  it("refuses the committed template and every mismatch before any request", async () => {
    const server = await fakeServer(() => verdictReply("supported")), out = tempDir();
    const template = JSON.parse(readFileSync(join(ROOT, "docs", "experiments", "e0-judge-fixture-v1.json"), "utf8"));
    expect(template).toMatchObject({ status: "template", promptVersion: ENTAILMENT_PROMPT_VERSION, claimsSha256: null, labelsSha256: null, agreement: null });
    const good = inputs();
    const attempt = (changes: { claims?: Buffer; labels?: Buffer; manifest?: unknown }) => runJudgeFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: { ...good, ...changes }, out });
    await expect(attempt({ manifest: template })).rejects.toThrow("judge_fixture_manifest_template");
    await expect(attempt({ manifest: { ...good.manifest, agreement: null } })).rejects.toThrow("judge_fixture_manifest_template");
    await expect(attempt({ manifest: { ...good.manifest, promptVersion: ENTAILMENT_PROMPT_VERSION + 1 } })).rejects.toThrow("judge_fixture_prompt_version_mismatch");
    await expect(attempt({ manifest: { ...good.manifest, claimsSha256: "0".repeat(64) } })).rejects.toThrow("judge_fixture_claims_mismatch");
    await expect(attempt({ manifest: { ...good.manifest, labelsSha256: "0".repeat(64) } })).rejects.toThrow("judge_fixture_labels_mismatch");
    await expect(attempt({ manifest: { ...good.manifest, plantedCount: 3 } })).rejects.toThrow("judge_fixture_counts_mismatch");
    await expect(attempt({ manifest: { ...good.manifest, minimumPerClass: 3 } })).rejects.toThrow("judge_fixture_class_below_minimum");
    await expect(attempt({ manifest: { ...good.manifest, extra: true } })).rejects.toThrow();
    const { C8: _dropped, ...sevenLabels } = LABELS, missing = inputs({}, CLAIMS, sevenLabels);
    await expect(attempt(missing)).rejects.toThrow("judge_fixture_labels_incomplete");
    const empty = inputs({}, CLAIMS.map(claim => claim.id === "C1" ? { ...claim, context: "" } : claim));
    await expect(attempt(empty)).rejects.toThrow("judge_fixture_claims_invalid");
    expect(server.requests).toHaveLength(0); expect(readdirSync(out)).toEqual([]);
    expect(verifyJudgeFixtureInputs(good)).toMatchObject({ labelCounts: { supported: 2, partial: 2, unsupported: 2, contradicted: 2 }, plantedCount: 2 });
  });
});

describe("judge fixture scoring", () => {
  it("scores agreement, the established split, recall, kappa and AUROC on known verdicts", () => {
    const verdicts = { C1: "supported", C2: "supported", C3: "supported", C4: "partial", C5: "partial", C6: "unsupported", C7: "contradicted", C8: "not_judged" } as const;
    const metrics = scoreVerdicts(CLAIMS.map(claim => ({ label: LABELS[claim.id as keyof typeof LABELS], planted: claim.id === "C5" || claim.id === "C7", verdict: verdicts[claim.id as keyof typeof verdicts] })));
    expect(metrics).toMatchObject({ claims: 8, judged: 7, exactAgreement: 0.625, establishedAgreement: 0.75, judgedExactAgreement: 0.7143, kappa: 0.6111,
      establishedRecall: 1, notEstablishedRecall: 0.5, contradictedRecall: 0.5, plantedNotEstablished: 0.5, aurocNotEstablished: 0.9583 });
    expect(metrics.verdictCounts).toEqual({ supported: 3, partial: 2, unsupported: 1, contradicted: 1, not_judged: 1 });
    expect(metrics.confusion.contradicted).toEqual({ supported: 0, partial: 0, unsupported: 0, contradicted: 1, not_judged: 1 });
    expect(scoreVerdicts([{ label: "supported", planted: false, verdict: "not_judged" }])).toMatchObject({ judged: 0, exactAgreement: 0, kappa: null, aurocNotEstablished: null, plantedNotEstablished: null });
    expect(flipRate(["supported", "unsupported", "not_judged"], ["partial", "unsupported", "supported"])).toEqual({ judgedInBoth: 2, verdictFlips: 0.5, establishedFlips: 0 });
  });
});

describe("judge fixture runs", () => {
  it("judges every claim per condition and repeat, retains replies with mode 0600, and never sends a label or prints the address", async () => {
    const legacy = { C1: "supported", C2: "supported", C3: "supported", C4: "partial", C5: "partial", C6: "unsupported", C7: "contradicted" } as Record<string, string>;
    const server = await fakeServer(({ reversed, sentence, call }) => {
      const id = idOf(sentence);
      if (reversed) return verdictReply(id === "C6" ? "contradicted" : id === "C8" ? "contradicted" : legacy[id]!);
      if (id === "C8") return { content: "not json" };
      return verdictReply(id === "C3" && call === 2 ? "partial" : legacy[id]!);
    });
    const f = inputs({ conditions: ["j1-legacy", "j1-legacy-reversed"], repeats: 2 }), out = join(tempDir(), "e0-judge-fixture-test");
    const summary = await runJudgeFixture({ endpoint: { baseUrl: server.baseUrl, apiKey: "test-key", model: "Synthetic" }, inputs: f, out });
    expect(server.requests).toHaveLength(32);
    expect(server.requests.every(r => r.url === "/v1/chat/completions" && r.headers.authorization === "Bearer test-key")).toBe(true);
    // Labels, planted flags and labeller notes never reach a request.
    for (const request of server.requests) { expect(request.raw).not.toContain("PLANTED-NOTE"); expect(request.raw).not.toContain("planted"); expect(request.raw).not.toContain("separate synthetic session"); }
    expect(server.requests[0]!.raw).toBe(buildJudgeBody("j1-legacy", "Synthetic", buildJudgeMessages("j1-legacy", CLAIMS[0]!)));
    expect(summary.requests["j1-legacy"]).toMatchObject({ requests: 16, maxTokens: 256, systemPromptSha256: digest(ENTAILMENT_SYSTEM_PROMPT) });
    expect(summary.requests["j1-legacy-reversed"]!.systemPromptSha256).toBe(digest(reversedSystemPrompt()));
    expect(summary.metrics["j1-legacy"]!.r1).toMatchObject({ exactAgreement: 0.625, establishedAgreement: 0.75, kappa: 0.6111, aurocNotEstablished: 0.9583, meetsLevel: true });
    expect(summary.metrics["j1-legacy"]!.r2).toMatchObject({ exactAgreement: 0.75, establishedAgreement: 0.75, meetsLevel: true });
    expect(summary.flips["j1-legacy|j1-legacy-reversed"]).toEqual({ r1: { judgedInBoth: 7, verdictFlips: 0.1429, establishedFlips: 0 }, r2: { judgedInBoth: 7, verdictFlips: 0.2857, establishedFlips: 0 } });
    expect(summary.consistency).toEqual({ "j1-legacy": 0.875, "j1-legacy-reversed": 1 });
    const invalid = summary.calls.find(call => call.condition === "j1-legacy" && call.claimId === "C8")!;
    expect(invalid).toMatchObject({ verdict: "not_judged", failure: "judge_reply_invalid", status: 200, reasoningBytes: Buffer.byteLength("hidden thoughts") });
    const replies = readdirSync(join(out, "replies")); expect(replies).toHaveLength(32); expect(replies).toContain("j1-legacy-r2-C3.json");
    for (const call of summary.calls) {
      expect(statSync(join(out, "replies", call.replyFile!)).mode & 0o777).toBe(0o600); expect(digest(readFileSync(join(out, "replies", call.replyFile!)))).toBe(call.bodySha256);
    }
    expect(statSync(join(out, "summary.json")).mode & 0o777).toBe(0o600);
    const serialized = JSON.stringify(summary);
    for (const secret of ["127.0.0.1", String(server.port), "test-key", "hidden thoughts", "orchard", "drip"]) expect(serialized).not.toContain(secret);
    // A dry run builds and hashes every request, sends nothing and writes nothing.
    const dry = await runJudgeFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: f, out: join(out, "dry"), dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, calls: [], metrics: {} }); expect(dry.requests).toEqual(summary.requests); expect(server.requests).toHaveLength(32); expect(existsSync(join(out, "dry"))).toBe(false);
  });
  it("records a rejected or unreachable endpoint as not judged without stopping the other claims", async () => {
    const server = await fakeServer(({ sentence }) => idOf(sentence) === "C2" ? verdictReply("supported") : { status: 503 });
    const summary = await runJudgeFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: inputs(), out: join(tempDir(), "out") });
    expect(server.requests).toHaveLength(8);
    expect(summary.calls.filter(call => call.failure === "request_rejected")).toHaveLength(7);
    expect(summary.metrics["j1-legacy"]!.r1).toMatchObject({ judged: 1, exactAgreement: 0.125, meetsLevel: false });
    const unreachable = await runJudgeFixture({ endpoint: { baseUrl: "http://127.0.0.1:9/v1", model: "Synthetic", timeoutMs: 2_000 }, inputs: inputs(), out: join(tempDir(), "out") });
    expect(unreachable.calls.every(call => call.failure === "transport_failed" && call.status === null)).toBe(true);
    expect(unreachable.metrics["j1-legacy"]!.r1).toMatchObject({ judged: 0, kappa: null, meetsLevel: false });
  });
});

describe("judge fixture harvest and command line", () => {
  function runDirectory(root: string, name: string, events: Record<string, unknown>[]) {
    const directory = join(root, name); mkdirSync(directory);
    const db = new Database(join(directory, "state.sqlite"));
    db.exec("CREATE TABLE private_agent_events (job_id TEXT NOT NULL, sequence INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(job_id, sequence))");
    events.forEach((event, index) => db.prepare("INSERT INTO private_agent_events VALUES (?, ?, ?)").run("job", index + 1, JSON.stringify(event)));
    db.close(); return directory;
  }
  it("harvests the last verified claims per context, skips claims without a window and keeps repeated claims once", () => {
    const root = tempDir(), claim = (id: string, sentence: string, context = PASSAGE_A) => ({ id, sentence, quote: "twelve healthy trees", context });
    const first = runDirectory(root, "run-a", [
      { type: "claims_verified", version: 1, contextId: "ctx", claims: [claim("C1", "superseded")] },
      { type: "tool_finished", contextId: "ctx" },
      { type: "claims_verified", version: 1, contextId: "ctx", claims: [claim("C1", "kept one"), claim("C2", "no window", ""), claim("C3", "kept two")] }]);
    const second = runDirectory(root, "run-b", [{ type: "claims_verified", version: 1, contextId: "ctx", claims: [claim("C1", "kept one"), claim("C2", "kept three", PASSAGE_B)] }]);
    const empty = runDirectory(root, "run-c", [{ type: "completed", contextId: "ctx" }]);
    const harvested = harvestClaims([first, second, empty], "synthetic");
    expect(harvested.file.claims.map(item => [item.id, item.sentence, item.origin])).toEqual([["C1", "kept one", { run: "run-a", claimId: "C1" }], ["C2", "kept two", { run: "run-a", claimId: "C3" }],
      ["C3", "kept three", { run: "run-b", claimId: "C2" }]]);
    expect(harvested).toMatchObject({ skipped: 1, duplicates: 1, runsWithoutClaims: 1 });
    expect(() => harvestClaims([join(root, "missing")], "synthetic")).toThrow("judge_fixture_harvest_unreadable");
  });
  it("runs from the command line: harvest never overwrites a claim set, and a dry run prints no address", () => {
    const root = tempDir(), f = inputs();
    const run = runDirectory(root, "run-a", [{ type: "claims_verified", version: 1, contextId: "ctx", claims: [{ id: "C1", sentence: "kept", quote: "twelve healthy trees", context: PASSAGE_A }] }]);
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1", SOAR_VLLM_MODEL: "Synthetic", SOAR_ENV_FILE: join(root, "none.env") };
    const cli = (args: string[]) => execFileSync(process.execPath, ["--import", "tsx", "scripts/judge-fixture.ts", ...args], { cwd: ROOT, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    const harvested = JSON.parse(cli(["harvest", "--runs", run, "--task", "synthetic", "--out", join(root, "claims.json")]));
    expect(harvested).toMatchObject({ claims: 1, skipped: 0, duplicates: 0, runsWithoutClaims: 0, sha256: digest(readFileSync(join(root, "claims.json"))) });
    expect(statSync(join(root, "claims.json")).mode & 0o777).toBe(0o600);
    expect(() => cli(["harvest", "--runs", run, "--task", "synthetic", "--out", join(root, "claims.json")])).toThrow();
    writeFileSync(join(root, "c.json"), f.claims); writeFileSync(join(root, "l.json"), f.labels); writeFileSync(join(root, "m.json"), JSON.stringify(f.manifest));
    const stdout = cli(["--claims", join(root, "c.json"), "--labels", join(root, "l.json"), "--manifest", join(root, "m.json"), "--dry-run"]);
    expect(JSON.parse(stdout)).toMatchObject({ dryRun: true, conditions: ["j1-legacy"], repeats: 1, claims: 8, agreement: { measure: "established", level: 0.7 }, retained: null });
    expect(stdout).not.toContain("127.0.0.1"); expect(stdout).not.toContain("orchard");
  });
});

// Every condition name is covered by a body builder (a typo in the list would leave a condition with the legacy shape).
it("maps every judge condition to its shape and prompt", () => {
  const shapes = (["j1-legacy", "j1-flash", "j1-legacy-reversed", "j1-flash-reversed"] as JudgeCondition[]).map(condition => {
    const body = JSON.parse(buildJudgeBody(condition, "Synthetic", buildJudgeMessages(condition, CLAIMS[0]!)));
    return [condition, body.chat_template_kwargs.preserve_thinking ?? null, body.messages[0].content === ENTAILMENT_SYSTEM_PROMPT];
  });
  expect(shapes).toEqual([["j1-legacy", null, true], ["j1-flash", false, true], ["j1-legacy-reversed", null, false], ["j1-flash-reversed", false, false]]);
  expect(ENTAILMENT_VERDICTS).toEqual(["supported", "partial", "unsupported", "contradicted"]);
});
