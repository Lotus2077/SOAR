import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { RESEARCH_PRESENTATION_POLICY } from "../../src/main/private-agent/research-contract";
import { runResearchPipeline, type ResearchDiagnostic } from "../../src/main/private-agent/research-pipeline";
import { DEFAULT_RESEARCH_ROLE_POLICY, type ResearchRolePolicy } from "../../src/main/private-agent/research-roles";
import { buildLocalScreenModelConfig } from "../../scripts/private-agent-local-screen";
import { CELL_CALLS, RUN_FILES, STAGE_CELL, SYNTHESIS_CELLS, SYNTHESIS_JUDGE, SYNTHESIS_REPAIR_REASON, buildSynthesisRequest, checkStageReceipts, judgeSynthesisReply, parseSynthesisArguments,
  runSynthesisFixture, stageCheckPassed, synthesisCellVoid, synthesisPacketSha256, verifySynthesisInputs, type RunFile, type SynthesisCell, type SynthesisPacket } from "../../scripts/synthesis-fixture";
import { RESEARCH_V4_TEST_BRIEF, researchV4Reply, researchV4Sources, researchV4TaggedReply, researchV4TaggedSources } from "../helpers/research-v4-fixture";

/**
 * The E0 synthesis fixture (scripts/synthesis-fixture.ts, the E0 card's Amendment 7). The stage itself is the reference: the research pipeline
 * runs with a scripted synthesiser under the driver's own model configuration, and the fixture must rebuild its synthesis bodies byte for byte
 * from the packet the run leaves, judge every reply as the stage did, and run its trials against a loopback endpoint without keeping text.
 * Nothing here reaches a real endpoint.
 */
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const step of cleanups.splice(0).reverse()) await step(); });
const SETTINGS = { vllm: { model: "Synthetic" }, streamingEnabled: true };
const OTHER_BASE = "http://127.0.0.1:9/v1";
function scratch() { const dir = mkdtempSync(join(tmpdir(), "soar-synthesis-fixture-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }

type Synth = (attempt: number) => string | { content: string; truncated: boolean };
/** A synthesis reply the stage refuses: it cites an evidence id the packet never had. */
const refused = () => JSON.stringify({ version: 1, argument: "The source states nothing [E999].\n\n## Conflicting evidence\nNone.\n\n## Unanswered questions\nNone.",
  questions: [{ questionId: "Q1", disposition: "findings", evidenceIds: ["E999"] }] });
/**
 * The research stage under the driver's local model configuration and a fake broker that records every body; `synth` answers the synthesis calls.
 * `tagged` reads researchV4TaggedSources() with researchV4TaggedReply: two questions, whose quotes are each tagged for one of them.
 */
async function stage(job: string, synth: Synth, roles?: ResearchRolePolicy, tagged = false) {
  const bodies: { purpose: string; body: string }[] = [], diagnostics: ResearchDiagnostic[] = [];
  let synthesisCalls = 0;
  const request = async (input: { body: string; purpose: string }, settle: (bytes: Buffer) => number) => {
    bodies.push({ purpose: input.purpose, body: input.body });
    const body = JSON.parse(input.body), system = body.messages[0].content as string, user = body.messages[1].content as string;
    const output = system.startsWith("You write") ? synth(synthesisCalls++) : (tagged ? researchV4TaggedReply : researchV4Reply)(system, user);
    const content = typeof output === "string" ? output : output.content, truncated = typeof output !== "string" && output.truncated;
    const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: truncated ? "length" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    return { bytes, receipt: { feeMicrousd: settle(bytes) } };
  };
  const config = buildLocalScreenModelConfig({ vllm: { model: "Synthetic" } as never, streamingEnabled: true }, COORDINATOR_PROFILES.heavy, true);
  const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, job, "reader");
  const outcome = await runResearchPipeline({ brief: RESEARCH_V4_TEST_BRIEF, sources: tagged ? researchV4TaggedSources() : researchV4Sources(), models: { reader: make(), planner: make(), synthesiser: make() },
    signal: new AbortController().signal, record: () => undefined, diagnostics: { retain: entry => { diagnostics.push(entry); } }, ...(roles ? { roles } : {}) });
  return { outcome, bodies, synthesisBodies: bodies.filter(b => b.purpose === "research synthesis").map(b => b.body), diagnostics };
}
/** A run directory as the driver leaves one: the packet under the candidate, and result.json's receipts over `baseUrl`. */
function runDirectory(root: string, run: string, job: string, s: Awaited<ReturnType<typeof stage>>, baseUrl: string) {
  for (const file of s.outcome.files) { const path = join(root, run, "candidate", file.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, file.bytes); }
  const dispatches = s.bodies.map((b, i) => ({ jobId: job, purpose: b.purpose, committedAt: 1_000 + i, bodyBytes: Buffer.byteLength(b.body), packetSha256: synthesisPacketSha256(baseUrl, b.body) }));
  writeFileSync(join(root, run, "result.json"), JSON.stringify({ status: "submitted", dispatches }));
  const read = (file: RunFile) => readFileSync(join(root, run, RUN_FILES[file]));
  return { run, jobIdSha256: digest(job), coverageSha256: digest(read("coverage")), evidenceSha256: digest(read("evidence")), planSha256: digest(read("plan")),
    stage: dispatches.filter(d => d.purpose === "research synthesis").map(d => ({ bodyBytes: d.bodyBytes, packetSha256: d.packetSha256 })) };
}
function manifestFor(packets: ReturnType<typeof runDirectory>[], over: Record<string, unknown> = {}) {
  return { schemaVersion: 1, name: "e0-synthesis-fixture-test", status: "pinned", task: "synthetic", exposure: "fresh", briefSha256: digest(Buffer.from(RESEARCH_V4_TEST_BRIEF)),
    packets, cells: [...SYNTHESIS_CELLS], trialsPerPacket: 2, ...over };
}
const inputsFor = (root: string, manifest: unknown, brief = Buffer.from(RESEARCH_V4_TEST_BRIEF)) =>
  ({ manifest, brief, read: (run: string, file: RunFile) => readFileSync(join(root, run, RUN_FILES[file])) });
const roleWith = (cell: SynthesisCell): ResearchRolePolicy => ({ ...DEFAULT_RESEARCH_ROLE_POLICY, synthesis: { maxOutputTokens: [CELL_CALLS[cell][0].maxOutputTokens, CELL_CALLS[cell][1].maxOutputTokens],
  thinking: [CELL_CALLS[cell][0].thinking, CELL_CALLS[cell][1].thinking], structuredOutput: null } });

describe("E0 synthesis fixture: the stage's own requests", () => {
  it("rebuilds the stage's two synthesis bodies byte for byte from the packet the run left, and checks them against its receipts", async () => {
    const root = scratch(), job = "e0-synthesis-job-a", s = await stage(job, refused);
    expect(s.outcome.status).toBe("completed");
    expect(s.synthesisBodies).toHaveLength(2);
    const packet = runDirectory(root, "run-2", job, s, OTHER_BASE), fixture = verifySynthesisInputs(inputsFor(root, manifestFor([packet])));
    const rebuilt = ([0, 1] as const).map(attempt => buildSynthesisRequest(SETTINGS, fixture.packets[0]!, attempt, CELL_CALLS[STAGE_CELL][attempt]));
    expect(rebuilt.map(r => r.body)).toEqual(s.synthesisBodies);
    // The repair attempt's context: the repair reason, and the coverage with its synthesis refused; the first attempt has neither.
    const users = rebuilt.map(r => JSON.parse((JSON.parse(r.body).messages as { content: string }[])[1]!.content));
    expect([users[0].repairReason, users[1].repairReason]).toEqual([null, SYNTHESIS_REPAIR_REASON]);
    expect([users[0].coverage.synthesis, users[1].coverage.synthesis]).toEqual([{ status: "pending", questions: [] }, { status: "invalid", questions: [] }]);
    expect([users[0].coverage.status, users[0].coverage.fallbacks.synthesis]).toEqual(["incomplete", "none"]);
    expect(checkStageReceipts(fixture, SETTINGS, OTHER_BASE)).toEqual([{ run: "run-2", bodyBytes: [true, true], packetSha256: [true, true] }]);
    // Another endpoint, another packet digest: the receipt binds the endpoint the run used.
    expect(checkStageReceipts(fixture, SETTINGS, "http://127.0.0.1:10/v1")).toEqual([{ run: "run-2", bodyBytes: [true, true], packetSha256: [false, false] }]);
    // Another model alias or streaming setting changes the body.
    expect(stageCheckPassed(checkStageReceipts(fixture, { vllm: { model: "Other" }, streamingEnabled: true }, OTHER_BASE))).toBe(false);
    expect(stageCheckPassed(checkStageReceipts(fixture, { vllm: { model: "Synthetic" }, streamingEnabled: false }, OTHER_BASE))).toBe(false);
  });

  it("sends each cell's pair exactly as the stage would under that card edit", async () => {
    for (const cell of SYNTHESIS_CELLS.filter(c => c !== STAGE_CELL)) {
      const root = scratch(), job = `e0-synthesis-job-${cell}`, s = await stage(job, refused, roleWith(cell));
      const fixture = verifySynthesisInputs(inputsFor(root, manifestFor([runDirectory(root, "run-2", job, s, OTHER_BASE)])));
      const built = ([0, 1] as const).map(attempt => buildSynthesisRequest(SETTINGS, fixture.packets[0]!, attempt, CELL_CALLS[cell][attempt]));
      expect(built.map(r => r.body)).toEqual(s.synthesisBodies);
      expect(built.map(r => [JSON.parse(r.body).max_tokens, JSON.parse(r.body).reasoning_effort ?? null, JSON.parse(r.body).chat_template_kwargs ?? null])).toEqual(
        CELL_CALLS[cell].map(call => [call.maxOutputTokens, call.thinking === "model" ? "medium" : null, call.thinking === "model" ? null : { enable_thinking: false }]));
    }
  }, 60_000);
});

describe("E0 synthesis fixture: the stage's judge", () => {
  it("returns the stage's own verdict and reasons for every reply, accepted or refused", async () => {
    const root = scratch(), base = await stage("e0-synthesis-job-base", refused);
    const fixture = verifySynthesisInputs(inputsFor(root, manifestFor([runDirectory(root, "run-2", "e0-synthesis-job-base", base, OTHER_BASE)])));
    const packet: SynthesisPacket = fixture.packets[0]!, questions = [...packet.questions], ids = [...packet.packetIds];
    const owned = (q: string) => packet.evidence.quotes.filter(quote => quote.questionIds.includes(q)).map(quote => quote.id);
    const answer = (argument: string, rows = questions.map(q => ({ questionId: q, disposition: owned(q).length ? "findings" : "unresolved", evidenceIds: owned(q) }))) =>
      JSON.stringify({ version: 1, argument, questions: rows });
    const sections = "\n\n## Conflicting evidence\nNo conflict was extracted.\n\n## Unanswered questions\nNone.";
    const replies: Record<string, { content: string; truncated: boolean }> = {
      accepted: { content: answer(`The supplied sources state a bounded finding [${ids[0]}].${sections}`), truncated: false },
      headingsNormalised: { content: answer(`The finding stands [${ids[0]}].\n\n### Conflicting Evidence:\nNone.\n\n**Unanswered questions**\nNone.`), truncated: false },
      unknownEvidenceId: { content: answer(`A finding [${ids[0]}].${sections}`, questions.map(q => ({ questionId: q, disposition: "findings", evidenceIds: ["E999"] }))), truncated: false },
      unknownCitation: { content: answer(`A finding [E77].${sections}`), truncated: false },
      headingMissing: { content: answer(`A finding [${ids[0]}].\n\n## Unanswered questions\nNone.`), truncated: false },
      unansweredHeadingMissing: { content: answer(`A finding [${ids[0]}].\n\n## Conflicting evidence\nNone.`), truncated: false },
      questionSetMismatch: { content: answer(`A finding [${ids[0]}].${sections}`, []), truncated: false },
      duplicateEvidenceId: { content: answer(`A finding [${ids[0]}].${sections}`, questions.map(q => ({ questionId: q, disposition: "findings", evidenceIds: [ids[0]!, ids[0]!] }))), truncated: false },
      dispositionWithoutEvidence: { content: answer(`A finding.${sections}`, questions.map(q => ({ questionId: q, disposition: "findings", evidenceIds: [] }))), truncated: false },
      unencodable: { content: answer(`A finding \ud800 [${ids[0]}].${sections}`), truncated: false },
      tooLarge: { content: answer(`${"A long finding of no substance. ".repeat(Math.ceil(RESEARCH_PRESENTATION_POLICY.maxBytes / 30))}[${ids[0]}]${sections}`), truncated: false },
      invalidJson: { content: "not a reply", truncated: false },
      schemaInvalid: { content: JSON.stringify({ version: 2, argument: "x", questions: [] }), truncated: false },
      truncated: { content: "", truncated: true },
    };
    const accepted: string[] = [];
    /** The stage on `reply` as its first attempt, against the fixture's verdict: acceptance, reasons, and for an accepted reply the questions and corrections it keeps. */
    const compare = async (name: string, reply: { content: string; truncated: boolean }, judged: SynthesisPacket, tagged = false) => {
      const run = await stage(`e0-synthesis-judge-${name}`, attempt => attempt === 0 ? reply : refused(), undefined, tagged);
      const file = (suffix: string) => JSON.parse(run.outcome.files.find(f => f.path.endsWith(suffix))!.bytes.toString());
      const summary = file("summary.json"), coverage = file("coverage.json");
      const attempts = summary.stages.find((row: { stage: string }) => row.stage === "synthesise").synthesisAttempts as { accepted: boolean }[];
      const stageReasons = run.diagnostics.find(d => d.stage === "synthesise" && d.ordinal === 1)?.reasons ?? [];
      const verdict = judgeSynthesisReply(reply, judged, 0);
      expect({ name, accepted: verdict.accepted, reasons: verdict.reasons }).toEqual({ name, accepted: attempts[0]!.accepted, reasons: stageReasons });
      if (verdict.accepted) {
        expect({ name, questions: verdict.questions, corrections: verdict.corrections }).toEqual({ name, questions: coverage.synthesis.questions, corrections: coverage.synthesis.corrections });
        accepted.push(name);
      }
      return verdict;
    };
    for (const [name, reply] of Object.entries(replies)) await compare(name, reply, packet);
    // Three kinds of reply reach acceptance, so the comparison covers both sides of every check. Under the evidence-id tolerance, a reply
    // whose only listed id is no packet quote keeps its argument, with each question's id dropped and the question downgraded to unresolved.
    expect(accepted).toEqual(["accepted", "headingsNormalised", "unknownEvidenceId"]);
    expect(judgeSynthesisReply(replies.unknownEvidenceId!, packet, 0).corrections).toEqual({ dropped: questions.map(q => ({ questionId: q, reason: "not_citable", evidenceIds: ["E999"] })),
      downgraded: questions.map(q => ({ questionId: q, from: "findings" })) });

    // The tolerance on a packet whose quotes are tagged for different questions: a quote listed under a question it is not tagged for (b), an id
    // no packet quote has (a), both, a findings and a conflict question the drop leaves with none, and an unresolved one that only loses ids.
    const taggedBase = await stage("e0-synthesis-job-tagged", refused, undefined, true);
    const tagged = verifySynthesisInputs(inputsFor(root, manifestFor([runDirectory(root, "run-3", "e0-synthesis-job-tagged", taggedBase, OTHER_BASE)]))).packets[0]!;
    const taggedFor = (q: string) => tagged.evidence.quotes.filter(quote => quote.questionIds.includes(q)).map(quote => quote.id);
    const [q1] = taggedFor("Q1"), [q2a, q2b] = taggedFor("Q2");
    expect([q1, q2a, q2b].every(Boolean)).toBe(true);
    const row = (questionId: string, disposition: string, evidenceIds: string[]) => ({ questionId, disposition, evidenceIds });
    const two = (first: object, second: object) => ({ content: JSON.stringify({ version: 1, argument: `A finding [${q1}].${sections}`, questions: [first, second] }), truncated: false });
    const taggedReplies: Record<string, { content: string; truncated: boolean }> = {
      caseB: two(row("Q1", "findings", [q1!, q2a!]), row("Q2", "findings", [q2a!, q2b!])),
      caseA: two(row("Q1", "findings", [q1!, "E999"]), row("Q2", "findings", [q2a!])),
      bothDowngraded: two(row("Q1", "findings", ["E999", q2a!]), row("Q2", "conflict", [q1!])),
      unresolvedKept: two(row("Q1", "conflict", [q2b!]), row("Q2", "unresolved", [q1!, q2a!])),
      duplicateOffending: two(row("Q1", "findings", ["E999", "E999"]), row("Q2", "findings", [q2a!])),
      offendingAndHeadingMissing: { content: JSON.stringify({ version: 1, argument: `A finding [${q1}].\n\n## Conflicting evidence\nNone.`,
        questions: [row("Q1", "findings", [q2a!]), row("Q2", "findings", [q2a!])] }), truncated: false },
    };
    const verdicts: Record<string, ReturnType<typeof judgeSynthesisReply>> = {};
    for (const [name, reply] of Object.entries(taggedReplies)) verdicts[name] = await compare(`tagged-${name}`, reply, tagged, true);
    expect(accepted.slice(3)).toEqual(["tagged-caseB", "tagged-caseA", "tagged-bothDowngraded", "tagged-unresolvedKept"]);
    const drop = (questionId: string, reason: string, evidenceIds: (string | undefined)[]) => ({ questionId, reason, evidenceIds });
    expect(verdicts.caseB!.corrections).toEqual({ dropped: [drop("Q1", "not_tagged_for_question", [q2a])], downgraded: [] });
    expect(verdicts.caseA!.corrections).toEqual({ dropped: [drop("Q1", "not_citable", ["E999"])], downgraded: [] });
    expect(verdicts.bothDowngraded).toMatchObject({ questions: [row("Q1", "unresolved", []), row("Q2", "unresolved", [])],
      corrections: { dropped: [drop("Q1", "not_citable", ["E999"]), drop("Q1", "not_tagged_for_question", [q2a]), drop("Q2", "not_tagged_for_question", [q1])],
        downgraded: [{ questionId: "Q1", from: "findings" }, { questionId: "Q2", from: "conflict" }] } });
    expect(verdicts.unresolvedKept).toMatchObject({ questions: [row("Q1", "unresolved", []), row("Q2", "unresolved", [q2a!])],
      corrections: { dropped: [drop("Q1", "not_tagged_for_question", [q2b]), drop("Q2", "not_tagged_for_question", [q1])], downgraded: [{ questionId: "Q1", from: "conflict" }] } });
    // What the tolerance does not cover is refused as before, and an offending id is never a reason.
    expect(verdicts.duplicateOffending!.reasons.map(r => r.code)).toEqual(["duplicate_evidence_id"]);
    expect(verdicts.offendingAndHeadingMissing!.reasons.map(r => r.code)).toEqual(["unanswered_questions_heading_missing"]);
  }, 180_000);
});

/** A streamed reply as vLLM sends it: content deltas, the finish reason, the usage chunk, then [DONE]. */
function sse(content: string, finish = "stop") {
  const half = Math.floor(content.length / 2), chunk = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  return [chunk({ id: "x", model: "Synthetic", choices: [{ index: 0, delta: { content: content.slice(0, half) }, finish_reason: null }] }),
    chunk({ id: "x", model: "Synthetic", choices: [{ index: 0, delta: { content: content.slice(half) }, finish_reason: finish }] }),
    chunk({ id: "x", model: "Synthetic", choices: [], usage: { prompt_tokens: 35_000, completion_tokens: finish === "length" ? 8192 : 4000 } }), "data: [DONE]\n\n"].join("");
}
type Reply = { status?: number; sse?: string; destroy?: boolean };
async function fakeServer(script: (ordinal: number) => Reply) {
  const requests: { raw: string; body: Record<string, any> }[] = [];
  const server: Server = createServer((request, response) => {
    let data = ""; request.setEncoding("utf8"); request.on("data", part => { data += part; });
    request.on("end", () => {
      requests.push({ raw: data, body: JSON.parse(data) as Record<string, any> });
      const reply = script(requests.length);
      if (reply.destroy) { request.socket.destroy(); return; }
      if (reply.sse) { response.writeHead(200, { "content-type": "text/event-stream" }); response.end(reply.sse); return; }
      response.writeHead(reply.status ?? 500, { "content-type": "application/json" }); response.end("{}");
    });
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  cleanups.push(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
  return { requests, baseUrl: `http://127.0.0.1:${port}/v1` };
}

describe("E0 synthesis fixture: trials against a loopback endpoint", () => {
  async function twoPackets(baseUrl: string) {
    const root = scratch(), packets = [];
    for (const [run, job] of [["run-2", "e0-synthesis-trial-job-2"], ["run-3", "e0-synthesis-trial-job-3"]] as const) packets.push(runDirectory(root, run, job, await stage(job, refused), baseUrl));
    return { root, packets };
  }
  const valid = (packet: SynthesisPacket) => JSON.stringify({ version: 1, argument: `A bounded finding [${[...packet.packetIds][0]}].\n\n## Conflicting evidence\nNone.\n\n## Unanswered questions\nNone.`,
    questions: [...packet.questions].map(q => ({ questionId: q, disposition: "findings", evidenceIds: [[...packet.packetIds][0]] })) });

  it("sends attempt 2 only after a refused attempt 1, alternates the packets, and records outcomes, codes and usage but no reply text", async () => {
    let packet: SynthesisPacket | undefined;
    const server = await fakeServer(ordinal => ({ 1: { sse: sse(valid(packet!)) }, 2: { sse: sse(refused()) }, 3: { sse: sse(valid(packet!)) }, 4: { sse: sse("", "length") },
      5: { sse: sse(refused()) }, 6: { status: 503 } } as Record<number, Reply>)[ordinal]!);
    const { root, packets } = await twoPackets(server.baseUrl), out = join(scratch(), "e0-synthesis-fixture-out");
    const inputs = inputsFor(root, manifestFor(packets));
    packet = verifySynthesisInputs(inputs).packets[0];
    const summary = await runSynthesisFixture({ endpoint: { baseUrl: server.baseUrl }, settings: SETTINGS, inputs, cell: STAGE_CELL, out });
    expect(summary.trials).toEqual([
      { trial: 1, packet: "run-2", outcome: "model_synthesis", acceptedAttempt: 1, calls: 1 },
      { trial: 2, packet: "run-3", outcome: "model_synthesis", acceptedAttempt: 2, calls: 2 },
      { trial: 3, packet: "run-2", outcome: "skeleton", acceptedAttempt: null, calls: 2 },
      { trial: 4, packet: "run-3", outcome: "no_outcome", acceptedAttempt: null, calls: 1 }]);
    expect(summary.outcomes).toEqual({ model_synthesis: 2, skeleton: 1, no_outcome: 1 });
    // A trial that settled no reply voids the cell (Amendment 7, item 5): it is run again whole once.
    expect(synthesisCellVoid(summary)).toBe(true);
    expect(summary.byPacket).toEqual({ "run-2": { model_synthesis: 1, skeleton: 1, no_outcome: 0 }, "run-3": { model_synthesis: 1, skeleton: 0, no_outcome: 1 } });
    expect(summary.counts).toEqual({ [STAGE_CELL]: { accepted: 2, invalid: 2, truncated: 1, request_rejected: 1 } });
    // The refused reply's E999 under Q1 is dropped by the evidence-id tolerance; its citation of E999 in the argument still refuses it.
    expect(summary.codes).toEqual({ 1: { truncated: 1, unknown_citation: 1 }, 2: { unknown_citation: 1 } });
    expect(summary.calls.map(c => [c.trial, c.attempt, c.classification, c.finishReason ?? null, (c.usage as { completion_tokens?: number } | null)?.completion_tokens ?? null])).toEqual([
      [1, 1, "accepted", "stop", 4000], [2, 1, "invalid", "stop", 4000], [2, 2, "accepted", "stop", 4000], [3, 1, "truncated", "length", 8192], [3, 2, "invalid", "stop", 4000],
      [4, 1, "request_rejected", null, null]]);
    // Every body sent is the one built for its packet and attempt, salted with that packet's own run job.
    const fixture = verifySynthesisInputs(inputs), order = [["run-2", 0], ["run-3", 0], ["run-3", 1], ["run-2", 0], ["run-2", 1], ["run-3", 0]] as const;
    expect(server.requests.map(r => r.raw)).toEqual(order.map(([run, attempt]) => buildSynthesisRequest(SETTINGS, fixture.packets.find(p => p.run === run)!, attempt, CELL_CALLS[STAGE_CELL][attempt]).body));
    expect(server.requests.every(r => r.body.stream === true && r.body.max_tokens === 8192)).toBe(true);
    // Raw replies stay under the out directory, private; the summary keeps no reply text and no address.
    const files = readdirSync(join(out, "replies")).sort();
    expect(files).toEqual(["t01-run-2-a1.sse", "t02-run-3-a1.sse", "t02-run-3-a2.sse", "t03-run-2-a1.sse", "t03-run-2-a2.sse", "t04-run-3-a1.sse"]);
    for (const file of files) expect(statSync(join(out, "replies", file)).mode & 0o777).toBe(0o600);
    const text = readFileSync(join(out, "summary.json"), "utf8");
    expect(statSync(join(out, "summary.json")).mode & 0o777).toBe(0o600);
    for (const needle of ["A bounded finding", "The source states nothing", server.baseUrl, "127.0.0.1", "e0-synthesis-trial-job"]) expect(text).not.toContain(needle);
    expect(JSON.parse(text)).toMatchObject({ version: 1, kind: "synthesis", dryRun: false, judge: SYNTHESIS_JUDGE, conditions: [STAGE_CELL], repeats: 4, order: "trial_alternating_packets",
      stageCheck: [{ run: "run-2", bodyBytes: [true, true], packetSha256: [true, true] }, { run: "run-3", bodyBytes: [true, true], packetSha256: [true, true] }] });
    expect(JSON.parse(text).finishedUtc).toEqual(expect.any(String));
    // The registry rows the summary this fixture wrote (scripts/registry-row.py --fixture synthesis), with no run name or reply file.
    const flags = { "--id": "e0-synthesis-x", "--batch": "e0-2026-11", "--task": "synthetic", "--family": "research", "--exposure": "fresh", "--arm": "local",
      "--verdict-by": "agent_diagnostic", "--lesson": "l", "--outcome": "accepted" };
    const line = execFileSync("python3", ["-I", join(__dirname, "..", "..", "scripts", "registry-row.py"), "--fixture-dir", out, "--fixture", "synthesis",
      ...Object.entries(flags).flat()], { cwd: join(__dirname, "..", ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(JSON.parse(line)).toMatchObject({ modelCalls: 6, terminalCause: "fixture_finished", fixture: { kind: "synthesis", finished: true, conditions: [STAGE_CELL], repeats: 4,
      outcomes: { model_synthesis: 2, skeleton: 1, no_outcome: 1 } } });
    for (const needle of ["run-2", "t01-run-2", "unknown_evidence_id", "Synthetic"]) expect(line).not.toContain(needle);
  }, 60_000);

  it("turns thinking off on the repair attempt only, in the cell that says so", async () => {
    const server = await fakeServer(() => ({ sse: sse(refused()) }));
    const { root, packets } = await twoPackets(server.baseUrl);
    const summary = await runSynthesisFixture({ endpoint: { baseUrl: server.baseUrl }, settings: SETTINGS, inputs: inputsFor(root, manifestFor(packets, { trialsPerPacket: 1 })),
      cell: "synthesis-8192-repair-thinking-off", out: join(scratch(), "out") });
    expect(summary.outcomes).toEqual({ model_synthesis: 0, skeleton: 2, no_outcome: 0 });
    expect(synthesisCellVoid(summary)).toBe(false);
    expect(server.requests.map(r => [r.body.reasoning_effort ?? null, r.body.chat_template_kwargs ?? null])).toEqual([["medium", null], [null, { enable_thinking: false }],
      ["medium", null], [null, { enable_thinking: false }]]);
  }, 60_000);

  it("records on an accepted call the ids the evidence-id tolerance dropped by kind, its downgrades and a reply the drops left all unresolved, and tallies them", async () => {
    let packet: SynthesisPacket | undefined;
    const id = () => [...packet!.packetIds][0]!, sections = "\n\n## Conflicting evidence\nNone.\n\n## Unanswered questions\nNone.";
    const reply = (evidenceIds: string[], disposition = "findings") => JSON.stringify({ version: 1, argument: `A bounded finding [${id()}].${sections}`,
      questions: [...packet!.questions].map(q => ({ questionId: q, disposition, evidenceIds })) });
    // 1: an id no packet quote has, beside one that stands; 2: the only id, so every question is downgraded and the reply is all unresolved by
    // the drops (the addendum counts it as no model synthesis); 3: unresolved throughout before the drop, which counts as the stage counts it.
    const server = await fakeServer(ordinal => ({ sse: sse(ordinal === 1 ? reply([id(), "E999"]) : ordinal === 2 ? reply(["E998"]) : ordinal === 3 ? reply(["E997"], "unresolved") : reply([id()])) }));
    const { root, packets } = await twoPackets(server.baseUrl), inputs = inputsFor(root, manifestFor(packets, { trialsPerPacket: 2 }));
    packet = verifySynthesisInputs(inputs).packets[0];
    const out = join(scratch(), "out");
    const summary = await runSynthesisFixture({ endpoint: { baseUrl: server.baseUrl }, settings: SETTINGS, inputs, cell: "synthesis-16384", out });
    expect(summary.outcomes).toEqual({ model_synthesis: 4, skeleton: 0, no_outcome: 0 });
    expect(summary.calls.map(c => [c.classification, c.evidenceIdsDroppedNotCitable ?? null, c.evidenceIdsDroppedNotTagged ?? null, c.questionsDowngraded ?? null,
      c.allUnresolvedByDrops ?? null])).toEqual([["accepted", 1, 0, 0, null], ["accepted", 1, 0, 1, true], ["accepted", 1, 0, 0, null], ["accepted", null, null, null, null]]);
    expect(summary.corrections).toEqual({ acceptedWithDrops: 3, evidenceIdsDroppedNotCitable: 3, evidenceIdsDroppedNotTagged: 0, questionsDowngraded: 1, allUnresolvedByDrops: 1 });
    expect(summary.judge).toBe(SYNTHESIS_JUDGE);
    // The registry row tallies the same from the calls.
    const flags = { "--id": "e0-synthesis-x", "--batch": "e0-2026-11", "--task": "synthetic", "--family": "research", "--exposure": "fresh", "--arm": "local",
      "--verdict-by": "agent_diagnostic", "--lesson": "l", "--outcome": "accepted" };
    const line = execFileSync("python3", ["-I", join(__dirname, "..", "..", "scripts", "registry-row.py"), "--fixture-dir", out, "--fixture", "synthesis",
      ...Object.entries(flags).flat()], { cwd: join(__dirname, "..", ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(JSON.parse(line).fixture).toMatchObject({ judge: SYNTHESIS_JUDGE, corrections: summary.corrections });
  }, 60_000);

  it("counts a transport failure or a reply the model layer would reject as no outcome, and never sends attempt 2 after one", async () => {
    const server = await fakeServer(ordinal => ordinal === 1 ? { destroy: true } : { sse: "data: {not json}\n\n" });
    const { root, packets } = await twoPackets(server.baseUrl);
    const summary = await runSynthesisFixture({ endpoint: { baseUrl: server.baseUrl }, settings: SETTINGS, inputs: inputsFor(root, manifestFor(packets, { trialsPerPacket: 1 })),
      cell: STAGE_CELL, out: join(scratch(), "out") });
    expect(summary.calls.map(c => c.classification)).toEqual(["transport_failed", "malformed_reply"]);
    expect(summary.outcomes).toEqual({ model_synthesis: 0, skeleton: 0, no_outcome: 2 });
    expect(server.requests).toHaveLength(2);
  }, 60_000);

  it("refuses before any request: another brief, packet, receipt or job, an unregistered cell, a stage it cannot rebuild, and an existing out directory", async () => {
    const server = await fakeServer(() => ({ sse: sse(refused()) }));
    const { root, packets } = await twoPackets(server.baseUrl), run = (manifest: unknown, over: Record<string, unknown> = {}) =>
      runSynthesisFixture({ endpoint: { baseUrl: server.baseUrl }, settings: SETTINGS, inputs: inputsFor(root, manifest), cell: STAGE_CELL, out: join(scratch(), "out"), ...over });
    const altered = (index: number, change: Record<string, unknown>) => manifestFor(packets.map((p, i) => i === index ? { ...p, ...change } : p));
    await expect(runSynthesisFixture({ endpoint: { baseUrl: server.baseUrl }, settings: SETTINGS, inputs: inputsFor(root, manifestFor(packets), Buffer.from("another brief")),
      cell: STAGE_CELL, out: join(scratch(), "out") })).rejects.toThrow("synthesis_fixture_brief_mismatch");
    await expect(run(altered(0, { coverageSha256: "0".repeat(64) }))).rejects.toThrow("synthesis_fixture_coverage_mismatch");
    await expect(run(altered(1, { evidenceSha256: "0".repeat(64) }))).rejects.toThrow("synthesis_fixture_evidence_mismatch");
    await expect(run(altered(0, { stage: [{ ...packets[0]!.stage[0]!, bodyBytes: 1 }, packets[0]!.stage[1]] }))).rejects.toThrow("synthesis_fixture_receipt_mismatch");
    await expect(run(altered(0, { jobIdSha256: digest("another job") }))).rejects.toThrow("synthesis_fixture_job_mismatch");
    await expect(run(manifestFor(packets, { cells: ["synthesis-16384"] }))).rejects.toThrow("synthesis_fixture_cell_not_registered");
    await expect(run(manifestFor(packets, { status: "template" }))).rejects.toThrow("synthesis_fixture_manifest_invalid");
    await expect(run(manifestFor([packets[0]!, packets[0]!]))).rejects.toThrow("synthesis_fixture_manifest_invalid");
    // Receipts over another endpoint: the dry run reports the mismatch, and the run refuses it.
    const elsewhere = manifestFor(packets.map(p => ({ ...p })));
    const dry = await runSynthesisFixture({ endpoint: { baseUrl: OTHER_BASE }, settings: SETTINGS, inputs: inputsFor(root, elsewhere), cell: STAGE_CELL, out: join(scratch(), "out"), dryRun: true });
    expect(stageCheckPassed(dry.stageCheck)).toBe(false);
    await expect(runSynthesisFixture({ endpoint: { baseUrl: OTHER_BASE }, settings: SETTINGS, inputs: inputsFor(root, elsewhere), cell: STAGE_CELL, out: join(scratch(), "out") }))
      .rejects.toThrow("synthesis_fixture_stage_mismatch");
    const existing = scratch();
    await expect(run(manifestFor(packets), { out: existing })).rejects.toThrow("synthesis_fixture_out_exists");
    expect(server.requests).toHaveLength(0);
  }, 60_000);

  it("dry-runs a cell without a request or a file: its stage check, its request digests and its design", async () => {
    const server = await fakeServer(() => ({ sse: sse(refused()) }));
    const { root, packets } = await twoPackets(server.baseUrl), out = join(scratch(), "never-written");
    const summary = await runSynthesisFixture({ endpoint: { baseUrl: server.baseUrl }, settings: SETTINGS, inputs: inputsFor(root, manifestFor(packets)), cell: "synthesis-16384", out, dryRun: true });
    expect(summary).toMatchObject({ dryRun: true, conditions: ["synthesis-16384"], repeats: 4, attempts: CELL_CALLS["synthesis-16384"], calls: [], trials: [] });
    expect(stageCheckPassed(summary.stageCheck)).toBe(true);
    expect(summary.requests["synthesis-16384"]!.packets["run-2"]!.map(r => [r.attempt, r.maxTokens, r.thinking, r.lengthCapWords, r.streamed])).toEqual([[1, 16384, "model", expect.any(Number), true],
      [2, 16384, "model", expect.any(Number), true]]);
    expect(summary.requests["synthesis-16384"]!.requestSetSha256).toBe(digest(canonical(Object.values(summary.requests["synthesis-16384"]!.packets).flat().map(r => r.requestSha256))));
    expect(() => statSync(out)).toThrow();
    expect(server.requests).toHaveLength(0);
  }, 60_000);
});

describe("E0 synthesis fixture: the command line and the committed manifest", () => {
  it("dry-runs from the command line through loadConfig: the stage check and each attempt's word cap, and no alias, run name or address", async () => {
    const root = scratch(), packets = [];
    for (const [run, job] of [["run-2", "e0-synthesis-cli-job-2"], ["run-3", "e0-synthesis-cli-job-3"]] as const) packets.push(runDirectory(root, run, job, await stage(job, refused), OTHER_BASE));
    writeFileSync(join(root, "brief.md"), RESEARCH_V4_TEST_BRIEF); writeFileSync(join(root, "manifest.json"), JSON.stringify(manifestFor(packets)));
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SOAR_VLLM_BASE_URL: OTHER_BASE, SOAR_VLLM_MODEL: "Synthetic", SOAR_ENV_FILE: join(root, "none.env") };
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "scripts/synthesis-fixture.ts", "--batch", root, "--brief", join(root, "brief.md"), "--manifest", join(root, "manifest.json"),
      "--cell", "synthesis-8192-repair-thinking-off", "--dry-run"], { cwd: join(__dirname, "..", ".."), encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    const line = JSON.parse(stdout);
    expect(line).toMatchObject({ dryRun: true, judge: "research_tolerance_v2", cell: "synthesis-8192-repair-thinking-off", trials: 4, packetCount: 2, stageCheckPassed: true, void: false,
      corrections: { acceptedWithDrops: 0, evidenceIdsDroppedNotCitable: 0, evidenceIdsDroppedNotTagged: 0, questionsDowngraded: 0, allUnresolvedByDrops: 0 },
      stageCheck: [{ bodyBytes: [true, true], packetSha256: [true, true] }, { bodyBytes: [true, true], packetSha256: [true, true] }] });
    // Attempt 2's word cap is printed beside attempt 1's: with thinking off its ceiling rises, unless the brief states a lower limit.
    expect(line.requests.packets.map((pair: { lengthCapWords: number; thinking: string }[]) => pair.map(r => [r.thinking, r.lengthCapWords])))
      .toEqual([0, 1].map(() => [["model", expect.any(Number)], ["disabled", expect.any(Number)]]));
    for (const needle of ["Synthetic", "run-2", "run-3", "127.0.0.1", root]) expect(stdout).not.toContain(needle);
  }, 60_000);

  it("reads its arguments strictly", () => {
    expect(parseSynthesisArguments(["--batch", "b", "--brief", "f", "--cell", "synthesis-16384", "--dry-run"])).toEqual({ batch: "b", brief: "f", cell: "synthesis-16384", dryRun: true });
    for (const argv of [[], ["--batch", "b", "--brief", "f"], ["--batch", "b", "--brief", "f", "--cell", "synthesis-32768"], ["--batch", "b", "--batch", "c", "--brief", "f", "--cell", STAGE_CELL],
      ["--batch", "--brief", "f", "--cell", STAGE_CELL], ["--batch", "b", "--brief", "f", "--cell", STAGE_CELL, "--repeats", "3"]]) expect(parseSynthesisArguments(argv)).toBeUndefined();
  });

  it("pins two packets, the three cells and five trials a packet in manifest v1", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "docs", "experiments", "e0-synthesis-fixture-v1.json"), "utf8"));
    expect(manifest).toMatchObject({ schemaVersion: 1, name: "e0-synthesis-fixture-v1", status: "pinned", task: "r3-grid-batteries", exposure: "exposed", cells: [...SYNTHESIS_CELLS],
      trialsPerPacket: 5 });
    expect(manifest.packets.map((p: { run: string }) => p.run)).toEqual(["run-2", "run-3"]);
    expect(manifest.packets.map((p: { stage: { bodyBytes: number }[] }) => p.stage.map(s => s.bodyBytes))).toEqual([[95334, 95428], [97185, 97279]]);
  });
});
