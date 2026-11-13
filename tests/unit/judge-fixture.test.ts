import Database from "better-sqlite3";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENTAILMENT_OUTPUT_TOKENS, ENTAILMENT_PROMPT_VERSION, ENTAILMENT_PURPOSE, ENTAILMENT_SYSTEM_PROMPT, ENTAILMENT_VERDICTS, entailmentMessages, judgeClaims } from "../../src/main/private-agent/claims";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, vllmCacheSalt } from "../../src/main/private-agent/model";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { buildLocalScreenModelConfig } from "../../scripts/private-agent-local-screen";
import { FIXTURE_JOB_ID, buildJudgeBody, buildJudgeMessages, flipRate, harvestClaims, meetsAgreementLevel, originSidecarPath, parseJudgeReply, reversedSystemPrompt, runJudgeFixture,
  scoreVerdicts, verifyJudgeFixtureInputs, type FixtureClaim, type JudgeCondition } from "../../scripts/judge-fixture";

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
function inputs(overrides: Record<string, unknown> = {}, claims: unknown[] = CLAIMS, labels: Record<string, string> = LABELS, labelsBody?: unknown) {
  const claimsBytes = Buffer.from(`${JSON.stringify({ version: 1, task: "synthetic", claims }, null, 1)}\n`);
  const labelsBytes = Buffer.from(`${JSON.stringify(labelsBody ?? { version: 1, protocol: "e0-judge-labelling-v1", labeller: "separate synthetic session",
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
  it("sends the pass's own messages, and its bodies equal the driver judge's non-streaming request byte for byte", async () => {
    const claim = CLAIMS[0]!, messages = buildJudgeMessages("j1-legacy", claim);
    expect(messages).toEqual(entailmentMessages({ id: claim.id, sentence: claim.sentence, quote: claim.quote, context: claim.context }));
    // The driver's judge model is buildLocalScreenModelConfig itself; the pass narrows it per call. Streaming off; salt off or the fixture's own.
    const capture = async (vllm: Record<string, unknown>, salted: boolean) => {
      let captured = "";
      const broker = { request: async (request: { body: string }, settle: (bytes: Buffer) => number) => { captured = request.body;
        const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } })); return { bytes, receipt: { feeMicrousd: settle(bytes) } }; } };
      const config = buildLocalScreenModelConfig({ vllm: { model: "Synthetic", ...vllm }, streamingEnabled: false } as never, COORDINATOR_PROFILES.heavy, salted);
      const model = new PrivateAgentModel(broker as unknown as PrivateAgentBroker, config, FIXTURE_JOB_ID, "context");
      await model.complete(messages, [], new AbortController().signal, { thinking: "disabled", maxOutputTokens: ENTAILMENT_OUTPUT_TOKENS, purpose: ENTAILMENT_PURPOSE });
      return captured;
    };
    const flash = { localReplyContract: "flash_next_v1", localContextTokens: 262144 }, salt = vllmCacheSalt(FIXTURE_JOB_ID);
    expect(await capture({}, false)).toBe(buildJudgeBody("j1-legacy", "Synthetic", messages));
    expect(await capture(flash, false)).toBe(buildJudgeBody("j1-flash", "Synthetic", messages));
    expect(await capture({}, true)).toBe(buildJudgeBody("j1-legacy", "Synthetic", messages, { cacheSalt: salt }));
    expect(await capture(flash, true)).toBe(buildJudgeBody("j1-flash", "Synthetic", messages, { cacheSalt: salt }));
    const legacy = JSON.parse(buildJudgeBody("j1-legacy", "Synthetic", messages));
    expect(legacy).toMatchObject({ max_tokens: 256, stream: false, chat_template_kwargs: { enable_thinking: false } });
    expect(legacy).not.toHaveProperty("reasoning_effort"); expect(legacy).not.toHaveProperty("temperature"); expect(legacy).not.toHaveProperty("tools");
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
    expect(template).toMatchObject({ status: "template", promptVersion: ENTAILMENT_PROMPT_VERSION, claimsSha256: null, labelsSha256: null, agreement: null, conditions: ["j1-legacy"] });
    const good = inputs();
    const attempt = (changes: { claims?: Buffer; labels?: Buffer; manifest?: unknown }) => runJudgeFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: { ...good, ...changes }, out: join(out, "run") });
    await expect(attempt({ manifest: template })).rejects.toThrow("judge_fixture_manifest_template");
    await expect(attempt({ manifest: { ...good.manifest, agreement: null } })).rejects.toThrow("judge_fixture_manifest_template");
    await expect(attempt({ manifest: { ...good.manifest, promptVersion: ENTAILMENT_PROMPT_VERSION + 1 } })).rejects.toThrow("judge_fixture_prompt_version_mismatch");
    await expect(attempt({ manifest: { ...good.manifest, claimsSha256: "0".repeat(64) } })).rejects.toThrow("judge_fixture_claims_mismatch");
    await expect(attempt({ manifest: { ...good.manifest, labelsSha256: "0".repeat(64) } })).rejects.toThrow("judge_fixture_labels_mismatch");
    await expect(attempt({ manifest: { ...good.manifest, task: "another-task" } })).rejects.toThrow("judge_fixture_task_mismatch");
    for (const counts of [{ plantedCount: 3 }, { claimCount: 9 }, { labelCounts: { supported: 3, partial: 1, unsupported: 2, contradicted: 2 } }]) {
      await expect(attempt({ manifest: { ...good.manifest, ...counts } }), JSON.stringify(counts)).rejects.toThrow("judge_fixture_counts_mismatch");
    }
    await expect(attempt({ manifest: { ...good.manifest, minimumPerClass: 3 } })).rejects.toThrow("judge_fixture_class_below_minimum");
    await expect(attempt({ manifest: { ...good.manifest, extra: true } })).rejects.toThrow();
    const { C8: _dropped, ...sevenLabels } = LABELS;
    await expect(attempt(inputs({}, CLAIMS, sevenLabels))).rejects.toThrow("judge_fixture_labels_incomplete");
    await expect(attempt(inputs({}, CLAIMS.map(claim => claim.id === "C1" ? { ...claim, context: "" } : claim)))).rejects.toThrow("judge_fixture_claims_invalid");
    // Provenance never travels with the claims the labeller sees.
    await expect(attempt(inputs({}, CLAIMS.map(claim => ({ ...claim, origin: { run: "run-a", claimId: claim.id } }))))).rejects.toThrow("judge_fixture_claims_invalid");
    await expect(attempt(inputs({}, CLAIMS, LABELS, { version: 1, protocol: "another-protocol", labeller: "x", labels: [] }))).rejects.toThrow("judge_fixture_labels_invalid");
    // A design without the activation cell of the endpoint's contract measures a body today's judge never sends.
    await expect(runJudgeFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: good, out: join(out, "run"), replyContract: "flash_next_v1" }))
      .rejects.toThrow("judge_fixture_activation_condition_missing");
    await expect(runJudgeFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: inputs({ conditions: ["j1-legacy-reversed"] }), out: join(out, "run") }))
      .rejects.toThrow("judge_fixture_activation_condition_missing");
    expect(server.requests).toHaveLength(0); expect(readdirSync(out)).toEqual([]);
    expect(verifyJudgeFixtureInputs(good)).toMatchObject({ labelCounts: { supported: 2, partial: 2, unsupported: 2, contradicted: 2 }, plantedCount: 2 });
  });
});

describe("judge fixture scoring", () => {
  it("scores agreement, the established split, recall, kappa and AUROC on known verdicts", () => {
    const verdicts = { C1: "supported", C2: "supported", C3: "supported", C4: "partial", C5: "partial", C6: "unsupported", C7: "contradicted", C8: "not_judged" } as const;
    const metrics = scoreVerdicts(CLAIMS.map(claim => ({ label: LABELS[claim.id as keyof typeof LABELS], planted: claim.id === "C5" || claim.id === "C7", verdict: verdicts[claim.id as keyof typeof verdicts] })));
    expect(metrics).toMatchObject({ claims: 8, judged: 7, exactAgreement: 0.625, establishedAgreement: 0.75, judgedExactAgreement: 0.7143, kappa: 0.6111, exactCount: 5, establishedCount: 6,
      establishedRecall: 1, notEstablishedRecall: 0.5, contradictedRecall: 0.5, plantedNotEstablished: 0.5, plantedExactAgreement: 0.5, aurocNotEstablished: 0.9583 });
    expect(metrics.verdictCounts).toEqual({ supported: 3, partial: 2, unsupported: 1, contradicted: 1, not_judged: 1 });
    expect(metrics.confusion.contradicted).toEqual({ supported: 0, partial: 0, unsupported: 0, contradicted: 1, not_judged: 1 });
    expect(scoreVerdicts([{ label: "supported", planted: false, verdict: "not_judged" }])).toMatchObject({ judged: 0, exactAgreement: 0, kappa: null, aurocNotEstablished: null, plantedNotEstablished: null });
    expect(flipRate(["supported", "unsupported", "not_judged"], ["partial", "unsupported", "supported"])).toEqual({ judgedInBoth: 2, verdictFlips: 0.5, establishedFlips: 0 });
  });
  it("counts only planted negatives as planted detection, and planted partials in planted agreement", () => {
    const planted = (verdict: "partial" | "unsupported") => scoreVerdicts([{ label: "partial", planted: true, verdict }, { label: "unsupported", planted: true, verdict: "unsupported" },
      { label: "contradicted", planted: true, verdict: "contradicted" }, { label: "supported", planted: false, verdict: "supported" }]);
    // A perfect judge detects every planted negative; calling the planted partial "unsupported" earns no detection credit and costs agreement.
    expect(planted("partial")).toMatchObject({ plantedNotEstablished: 1, plantedExactAgreement: 1 });
    expect(planted("unsupported")).toMatchObject({ plantedNotEstablished: 1, plantedExactAgreement: 0.6667 });
  });
  it("tests the agreement level on the unrounded ratio", () => {
    // 205 of 247 is 0.82996, reported as 0.83 but below a level of 0.83.
    expect(meetsAgreementLevel({ claims: 247, exactCount: 205, establishedCount: 247 }, { measure: "exact", level: 0.83 })).toBe(false);
    expect(meetsAgreementLevel({ claims: 247, exactCount: 205, establishedCount: 247 }, { measure: "established", level: 0.83 })).toBe(true);
    expect(meetsAgreementLevel({ claims: 3, exactCount: 2, establishedCount: 2 }, { measure: "exact", level: 0.6667 })).toBe(false);
    expect(meetsAgreementLevel({ claims: 8, exactCount: 6, establishedCount: 6 }, { measure: "exact", level: 0.75 })).toBe(true);
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
    expect(summary).toMatchObject({ replyContract: "legacy", activationCondition: "j1-legacy", manifest: { sha256: digest(canonical(f.manifest)) } });
    expect(summary.requests["j1-legacy"]).toMatchObject({ requests: 16, maxTokens: 256, systemPromptSha256: digest(ENTAILMENT_SYSTEM_PROMPT) });
    expect(summary.requests["j1-legacy-reversed"]!.systemPromptSha256).toBe(digest(reversedSystemPrompt()));
    expect(summary.metrics["j1-legacy"]!.r1).toMatchObject({ exactAgreement: 0.625, establishedAgreement: 0.75, kappa: 0.6111, aurocNotEstablished: 0.9583, meetsLevel: true });
    expect(summary.metrics["j1-legacy"]!.r2).toMatchObject({ exactAgreement: 0.75, establishedAgreement: 0.75, meetsLevel: true });
    expect(summary.flips["j1-legacy|j1-legacy-reversed"]).toEqual({ r1: { judgedInBoth: 7, verdictFlips: 0.1429, establishedFlips: 0 }, r2: { judgedInBoth: 7, verdictFlips: 0.2857, establishedFlips: 0 } });
    // C8 is never judged under j1-legacy, so consistency counts the 7 claims judged in both repeats; C3 changed between them.
    expect(summary.consistency).toEqual({ "j1-legacy": { judgedInEveryRepeat: 7, agreement: 0.8571 }, "j1-legacy-reversed": { judgedInEveryRepeat: 8, agreement: 1 } });
    const invalid = summary.calls.find(call => call.condition === "j1-legacy" && call.claimId === "C8")!;
    expect(invalid).toMatchObject({ verdict: "not_judged", failure: "judge_reply_invalid", status: 200, reasoningBytes: Buffer.byteLength("hidden thoughts") });
    const replies = readdirSync(join(out, "replies")); expect(replies).toHaveLength(32); expect(replies).toContain("j1-legacy-r2-C3.json");
    for (const call of summary.calls) {
      expect(statSync(join(out, "replies", call.replyFile!)).mode & 0o777).toBe(0o600); expect(digest(readFileSync(join(out, "replies", call.replyFile!)))).toBe(call.bodySha256);
    }
    expect(statSync(join(out, "summary.json")).mode & 0o777).toBe(0o600);
    const serialized = JSON.stringify(summary);
    for (const secret of ["127.0.0.1", String(server.port), "test-key", "hidden thoughts", "orchard", "drip", "PLANTED-NOTE"]) expect(serialized).not.toContain(secret);
    // A second run into the same directory is refused before any request: the first result stays.
    const before = readFileSync(join(out, "summary.json"));
    await expect(runJudgeFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: f, out })).rejects.toThrow("judge_fixture_out_exists");
    expect(server.requests).toHaveLength(32); expect(readFileSync(join(out, "summary.json")).equals(before)).toBe(true);
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
    const unreachable = await runJudgeFixture({ endpoint: { baseUrl: "http://127.0.0.1:9/v1", model: "Synthetic", timeoutMs: 2_000 }, inputs: inputs({ repeats: 2 }), out: join(tempDir(), "out") });
    expect(unreachable.calls.every(call => call.failure === "transport_failed" && call.status === null)).toBe(true);
    expect(unreachable.metrics["j1-legacy"]!.r1).toMatchObject({ judged: 0, kappa: null, meetsLevel: false });
    // Claims never judged are not counted as consistent.
    expect(unreachable.consistency["j1-legacy"]).toEqual({ judgedInEveryRepeat: 0, agreement: null });
  });
  it("names the flash_next_v1 activation cell and runs its body", async () => {
    const server = await fakeServer(({ sentence }) => verdictReply(LABELS[idOf(sentence)]));
    const summary = await runJudgeFixture({ endpoint: { baseUrl: server.baseUrl, model: "Synthetic" }, inputs: inputs({ conditions: ["j1-flash"] }), out: join(tempDir(), "out"), replyContract: "flash_next_v1" });
    expect(summary).toMatchObject({ replyContract: "flash_next_v1", activationCondition: "j1-flash" });
    expect(server.requests.every(request => request.body.chat_template_kwargs.preserve_thinking === false)).toBe(true);
    expect(summary.metrics["j1-flash"]!.r1).toMatchObject({ exactAgreement: 1, meetsLevel: true });
  });
});

describe("judge fixture harvest and command line", () => {
  function runDirectory(root: string, name: string, events: { job?: string; event: Record<string, unknown> }[]) {
    const directory = join(root, name); mkdirSync(directory);
    const db = new Database(join(directory, "state.sqlite"));
    db.exec("CREATE TABLE private_agent_events (job_id TEXT NOT NULL, sequence INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(job_id, sequence))");
    events.forEach(({ job, event }, index) => db.prepare("INSERT INTO private_agent_events VALUES (?, ?, ?)").run(job ?? "job", index + 1, JSON.stringify(event)));
    db.close(); return directory;
  }
  const claim = (id: string, sentence: string, context = PASSAGE_A) => ({ id, sentence, quote: "twelve healthy trees", context });
  const verified = (contextId: string, claims: unknown[]) => ({ type: "claims_verified", version: 1, contextId, claims });
  it("harvests the last verified claims per job and context, skips claims without a window and keeps repeated claims once", () => {
    const root = tempDir();
    const first = runDirectory(root, "run-a", [
      { event: verified("ctx", [claim("C1", "superseded")]) }, { event: { type: "tool_finished", contextId: "ctx" } },
      { event: verified("ctx", [claim("C1", "kept one"), claim("C2", "no window", ""), claim("C3", "kept two")]) }]);
    const second = runDirectory(root, "run-b", [{ event: verified("ctx", [claim("C1", "kept one"), claim("C2", "kept three", PASSAGE_B)]) }]);
    const empty = runDirectory(root, "run-c", [{ event: { type: "completed", contextId: "ctx" } }]);
    const harvested = harvestClaims([first, second, empty], "synthetic");
    expect(harvested.file.claims.map(item => [item.id, item.sentence])).toEqual([["C1", "kept one"], ["C2", "kept two"], ["C3", "kept three"]]);
    expect(harvested.file.claims.every(item => !("origin" in item))).toBe(true);
    expect(harvested.origins).toEqual([{ id: "C1", run: "run-a", claimId: "C1" }, { id: "C2", run: "run-a", claimId: "C3" }, { id: "C3", run: "run-b", claimId: "C2" }]);
    expect(harvested).toMatchObject({ skipped: 1, duplicates: 1, runsWithoutClaims: 1 });
    // Two jobs and two contexts in one database: each (job, context) keeps its own last event; keying on either alone loses one.
    const multi = runDirectory(root, "run-d", [
      { job: "job-a", event: verified("ctx-1", [claim("C1", "a1 old")]) }, { job: "job-a", event: verified("ctx-2", [claim("C1", "a2")]) },
      { job: "job-a", event: verified("ctx-1", [claim("C1", "a1 new")]) }, { job: "job-b", event: verified("ctx-1", [claim("C1", "b1")]) }]);
    expect(harvestClaims([multi], "synthetic").file.claims.map(item => item.sentence).sort()).toEqual(["a1 new", "a2", "b1"]);
    expect(() => harvestClaims([join(root, "missing")], "synthetic")).toThrow("judge_fixture_harvest_unreadable");
  });
  it("runs from the command line: harvest creates its directory, writes a provenance sidecar, never overwrites, and a dry run prints no address", () => {
    const root = tempDir(), f = inputs();
    const run = runDirectory(root, "run-a", [{ event: verified("ctx", [{ id: "C1", sentence: "kept", quote: "twelve healthy trees", context: PASSAGE_A }]) }]);
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1", SOAR_VLLM_MODEL: "Synthetic", SOAR_ENV_FILE: join(root, "none.env") };
    const cli = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/judge-fixture.ts", ...args], { cwd: ROOT, encoding: "utf8", env });
    const target = join(root, "fresh", "e0-judge", "claims.json");
    const harvested = cli(["harvest", "--runs", run, "--task", "synthetic", "--out", target]);
    expect(harvested.status).toBe(0);
    expect(JSON.parse(harvested.stdout)).toMatchObject({ claims: 1, skipped: 0, duplicates: 0, runsWithoutClaims: 0, sha256: digest(readFileSync(target)) });
    expect(statSync(target).mode & 0o777).toBe(0o600); expect(readFileSync(target, "utf8")).not.toContain("run-a");
    expect(originSidecarPath(target)).toBe(join(root, "fresh", "e0-judge", "claims.origin.json"));
    expect(JSON.parse(readFileSync(originSidecarPath(target), "utf8"))).toEqual({ version: 1, task: "synthetic", origins: [{ id: "C1", run: "run-a", claimId: "C1" }] });
    const again = cli(["harvest", "--runs", run, "--task", "synthetic", "--out", target]);
    expect(again.status).toBe(2); expect(again.stderr.trim()).toBe("judge_fixture_claims_exist"); expect(again.stderr).not.toContain(root);
    writeFileSync(join(root, "c.json"), f.claims); writeFileSync(join(root, "l.json"), f.labels); writeFileSync(join(root, "m.json"), JSON.stringify(f.manifest));
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "scripts/judge-fixture.ts", "--claims", join(root, "c.json"), "--labels", join(root, "l.json"), "--manifest", join(root, "m.json"), "--dry-run"],
      { cwd: ROOT, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    expect(JSON.parse(stdout)).toMatchObject({ dryRun: true, manifestSha256: digest(canonical(f.manifest)), replyContract: "legacy", activationCondition: "j1-legacy", conditions: ["j1-legacy"],
      repeats: 1, claims: 8, agreement: { measure: "established", level: 0.7 }, retained: null });
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
