import { describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { RESEARCH_FILES } from "../../src/main/private-agent/research-contract";
import { deriveBriefUnits, inventoryResearchSources, renderResearchEvidence, validateReadyResearchPacket } from "../../src/main/private-agent/research-coverage";
import { runResearchPipeline } from "../../src/main/private-agent/research-pipeline";
import type { PrivateAgentModel } from "../../src/main/private-agent/model";
import { parseResearchUserContent, researchV4Reply, researchV4Sources, RESEARCH_V4_TEST_BRIEF } from "../helpers/research-v4-fixture";

async function packet() {
  const model = { complete: async (messages: { content: string }[]) => ({ content: researchV4Reply(messages[0]!.content, messages[1]!.content), finishReason: "stop" }) } as unknown as PrivateAgentModel;
  const result = await runResearchPipeline({ brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), models: { reader: model, planner: model, synthesiser: model }, signal: new AbortController().signal, record: () => {} });
  expect(result.status).toBe("completed"); return result.files.map(file => ({ path: file.path, bytes: Buffer.from(file.bytes) }));
}
const expectation = () => ({ brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources() });
function edit(files: { path: string; bytes: Buffer }[], path: string, mutate: (value: any) => void) { const file = files.find(f => f.path === path)!, value = JSON.parse(file.bytes.toString()); mutate(value); file.bytes = Buffer.from(`${canonical(value)}\n`); }

describe("host-owned brief and source inventory", () => {
  it("round trips every byte across exact numbered spans, including preamble and Unicode", () => {
    const brief = "背景\n1. Explain α.\n  Notes stay here.\n2) Explain β and limits.\n";
    const units = deriveBriefUnits(brief); expect(units.map(u => u.text).join("")).toBe(brief); expect(units).toHaveLength(3);
    for (const unit of units) { const actual = Buffer.from(brief).subarray(unit.startByte, unit.endByte); expect(actual.toString()).toBe(unit.text); expect(digest(actual)).toBe(unit.sha256); }
    expect(deriveBriefUnits("An unstructured request. Another sentence.")).toHaveLength(1);
  });
  it("falls back to one whole span rather than dropping an excessive brief tail", () => {
    const brief = Array.from({ length: 130 }, (_, i) => `${i + 1}. Item ${i}\n`).join(""); expect(deriveBriefUnits(brief)).toMatchObject([{ text: brief }]);
  });
  it("covers a multibyte large source completely with bounded overlapping chunks", () => {
    const bytes = Buffer.from(("One complete 中文 source line.\n").repeat(4000)), source = { id: "input/large.md", path: "input/large.md", bytes };
    const inventory = inventoryResearchSources([source]); expect(inventory.chunks.length).toBeGreaterThan(1);
    const visited = new Uint8Array(bytes.length);
    for (const c of inventory.chunks) { const part = bytes.subarray(c.startByte, c.endByte); expect(part.length).toBeLessThanOrEqual(65536); expect(part.toString()).not.toContain("�"); expect(digest(part)).toBe(c.sha256); visited.fill(1, c.startByte, c.endByte); }
    expect(visited.every(n => n === 1)).toBe(true); expect(inventory.chunks.at(-1)!.endByte).toBe(bytes.length);
  });
  it("does not remap duplicate source IDs or label binary input readable", () => {
    const a = researchV4Sources()[0]!; expect(() => inventoryResearchSources([a, a])).toThrow("inventory");
    expect(inventoryResearchSources([{ id: "input/bad", path: "input/bad", bytes: Buffer.from([0, 1]) }]).sources[0]!.readable).toBe(false);
  });
});

describe("seven-file ready packet invariants", () => {
  it("accepts the actual complete pipeline output but leaves content acceptance unevaluated", async () => {
    const files = await packet(), ready = validateReadyResearchPacket(files, expectation()); expect(ready.filesManifest).toHaveLength(7);
    expect(ready.coverage.semanticAcceptance).toBe("not_evaluated"); expect(ready.coverage.corpusAbsenceEstablished).toBe(false);
    expect(files.find(f => f.path === RESEARCH_FILES.evidenceText)!.bytes.toString()).toBe(renderResearchEvidence(ready.evidence, ready.plan));
  });
  it("rejects old partial or duplicate manifests", async () => {
    const files = await packet(); expect(() => validateReadyResearchPacket(files.slice(1))).toThrow("files");
    expect(() => validateReadyResearchPacket([...files, files[0]!])).toThrow("files");
  });
  it("binds the composed original goal separately from a raw task brief", async () => {
    const files = await packet(); expect(() => validateReadyResearchPacket(files, { brief: "A different raw brief" })).toThrow("brief");
    edit(files, RESEARCH_FILES.coverage, c => { c.units[0].text += " altered"; }); expect(() => validateReadyResearchPacket(files)).toThrow("brief");
  });
  it("rejects a source tail gap even when no actual source bytes are supplied", async () => {
    const files = await packet(); edit(files, RESEARCH_FILES.coverage, c => { c.chunks[0].endByte--; }); expect(() => validateReadyResearchPacket(files)).toThrow("source_tail");
  });
  it("rejects a tampered complete chunk whose final real attempt failed", async () => {
    const files = await packet(); edit(files, RESEARCH_FILES.coverage, c => { c.chunks[0].attempts[0].status = "invalid"; }); expect(() => validateReadyResearchPacket(files)).toThrow("not_ready");
  });
  it("rejects unreadable inputs, and since 7b.2 an omission the evidence counts leave out, deterministically", async () => {
    const unreadable = await packet(); edit(unreadable, RESEARCH_FILES.coverage, c => { c.sources[0].readable = false; }); expect(() => validateReadyResearchPacket(unreadable)).toThrow("not_ready");
    const files = await packet();
    edit(files, RESEARCH_FILES.coverage, c => { c.omissions.push({ sourceId: c.sources[0].id, questionIds: ["Q1"], quoteSha256: "1".repeat(64), chunkIds: [c.chunks[0].id], locator: "line 2", reason: "packet_cap" }); });
    expect(() => validateReadyResearchPacket(files)).toThrow("evidence_counts");
  });
  it("rejects unknown and missing source/brief assignments", async () => {
    const files = await packet(); edit(files, RESEARCH_FILES.plan, p => { p.questions[0].requirementIds = ["U2"]; }); expect(() => validateReadyResearchPacket(files)).toThrow("plan_binding");
  });
  it("rechecks quote occurrence in actual chunk bytes, even with an internally consistent forged render", async () => {
    const files = await packet(); edit(files, RESEARCH_FILES.evidence, e => { e.quotes[0].quote = "An invented unsupported phrase outside the corpus."; });
    const evidence = JSON.parse(files.find(f => f.path === RESEARCH_FILES.evidence)!.bytes.toString()), plan = JSON.parse(files.find(f => f.path === RESEARCH_FILES.plan)!.bytes.toString());
    files.find(f => f.path === RESEARCH_FILES.evidenceText)!.bytes = Buffer.from(renderResearchEvidence(evidence, plan));
    expect(() => validateReadyResearchPacket(files, expectation())).toThrow("quote_occurrence");
  });
  it("binds the saved quote locator to its actual chunk occurrence", async () => {
    const files = await packet(); edit(files, RESEARCH_FILES.evidence, e => { e.quotes[0].locator = "line 999"; });
    const evidence = JSON.parse(files.find(f => f.path === RESEARCH_FILES.evidence)!.bytes.toString()), plan = JSON.parse(files.find(f => f.path === RESEARCH_FILES.plan)!.bytes.toString());
    files.find(f => f.path === RESEARCH_FILES.evidenceText)!.bytes = Buffer.from(renderResearchEvidence(evidence, plan));
    expect(() => validateReadyResearchPacket(files, expectation())).toThrow("quote_locator");
  });
  it("rejects changed source hash and index identity", async () => {
    const files = await packet(); edit(files, RESEARCH_FILES.index, index => { index.sources[0].sourceSha256 = "2".repeat(64); }); expect(() => validateReadyResearchPacket(files)).toThrow("index_source_hash");
    const actual = researchV4Sources(); actual[0]!.bytes = Buffer.from("changed source"); expect(() => validateReadyResearchPacket(files, { sources: actual })).toThrow();
  });
  it("rejects an altered evidence rendering and incomplete synthesis sections", async () => {
    const files = await packet(); files.find(f => f.path === RESEARCH_FILES.evidenceText)!.bytes = Buffer.from("A selective summary"); expect(() => validateReadyResearchPacket(files)).toThrow("evidence_render");
    const other = await packet(), argument = Buffer.from("A complete-looking claim [E1].\n"); other.find(f => f.path === RESEARCH_FILES.argument)!.bytes = argument;
    edit(other, RESEARCH_FILES.coverage, c => { c.synthesis.argumentSha256 = digest(argument); }); expect(() => validateReadyResearchPacket(other)).toThrow("argument_sections");
  });
  it("rejects contradictory successful planning/synthesis counts", async () => {
    for (const stage of ["plan", "synthesise"]) {
      const files = await packet(); edit(files, RESEARCH_FILES.summary, s => { const row = s.stages.find((r: any) => r.stage === stage); row.invalidReplies = row.calls; row.truncatedReplies = row.calls; });
      expect(() => validateReadyResearchPacket(files)).toThrow("stage_success_contradiction");
    }
    const files = await packet(); edit(files, RESEARCH_FILES.summary, s => { s.stages[2].invalidReplies = 1; }); expect(() => validateReadyResearchPacket(files)).toThrow("extraction_attempt_counts");
  });
  it("does not allow fabricated semantic acceptance or corpus absence flags", async () => {
    const files = await packet(); edit(files, RESEARCH_FILES.coverage, c => { c.semanticAcceptance = "passed"; c.corpusAbsenceEstablished = true; }); expect(() => validateReadyResearchPacket(files)).toThrow();
  });
});

/**
 * Item 7b.2 (BL-20261114-1304-research-priority-trim-design): a real packet the trim cut. Two questions over twenty sources of twelve
 * rows: each source answers Q1 with rows 0 to 5 and Q2 with rows 6 to 11, except the last, which marks Q2 no_verified_evidence. The
 * 234 quotes overflow the 64 KiB packet, so the packet holds outcomes of every kind: retained, trimmed and no_verified_evidence.
 */
const TRIM_SOURCES = () => Array.from({ length: 20 }, (_, i) => ({ id: `input/trim-${String(i).padStart(2, "0")}.md`, path: `input/trim-${i}.md`,
  bytes: Buffer.from(Array.from({ length: 12 }, (_, j) => `Source ${i} row ${j} ${"records a synthetic observation with a bounded uncertainty. ".repeat(4)}`).join("\n")) }));
async function trimmedPacket() {
  const model = { complete: async (messages: { content: string }[]) => {
    const system = messages[0]!.content, user = messages[1]!.content, input = parseResearchUserContent(user);
    const question = (id: string) => ({ id, text: `Synthetic question ${id}`, requirementIds: input.units?.map((u: any) => u.id), sourceIds: [], lookFor: [] });
    if (system.startsWith("You plan")) return { content: JSON.stringify({ version: 2, questions: [question("Q1"), question("Q2")], conflictsToCheck: [], deliverableNotes: "" }), finishReason: "stop" };
    if (system.startsWith("You extract")) {
      const last = input.source.id === "input/trim-19.md", rows = String(input.chunk.text).split("\n");
      return { content: JSON.stringify({ questions: [{ questionId: "Q1", status: "evidence_found" }, { questionId: "Q2", status: last ? "no_verified_evidence" : "evidence_found" }],
        quotes: rows.flatMap((quote, j) => last && j >= 6 ? [] : [{ quote, questionIds: [j < 6 ? "Q1" : "Q2"], note: "n".repeat(200) }]), conflicts: [] }), finishReason: "stop" };
    }
    return { content: researchV4Reply(system, user), finishReason: "stop" };
  } } as unknown as PrivateAgentModel;
  const result = await runResearchPipeline({ brief: RESEARCH_V4_TEST_BRIEF, sources: TRIM_SOURCES(), models: { reader: model, planner: model, synthesiser: model }, signal: new AbortController().signal, record: () => {} });
  expect(result).toMatchObject({ status: "completed", reason: "research_packet_ready" }); return result.files.map(file => ({ path: file.path, bytes: Buffer.from(file.bytes) }));
}
const json = (files: { path: string; bytes: Buffer }[], path: string) => JSON.parse(files.find(f => f.path === path)!.bytes.toString());
/** Adds a quote's omission with its counts, as the pipeline would have, so that only the identity or binding rule can refuse it. */
const omit = (files: { path: string; bytes: Buffer }[], omission: Record<string, unknown>) => {
  edit(files, RESEARCH_FILES.coverage, c => { c.omissions.push(omission); }); edit(files, RESEARCH_FILES.evidence, e => { e.counts.verified++; e.counts.leftByCap++; });
};

describe("item 7b.2: the ready gate accepts disclosed omissions (BL-20261114-1304-research-priority-trim-design)", () => {
  it("accepts a trimmed packet whose omissions are counted, unique and bound, with retained, trimmed and no-evidence outcomes", async () => {
    const files = await trimmedPacket(), ready = validateReadyResearchPacket(files, { brief: RESEARCH_V4_TEST_BRIEF, sources: TRIM_SOURCES() });
    const statuses = new Set(ready.coverage.chunks.flatMap(c => c.questions.map(q => q.status)));
    expect([...statuses].sort()).toEqual(["evidence_retained", "evidence_trimmed", "no_verified_evidence"]);
    expect(ready.evidence.counts.verified).toBe(234); expect(ready.evidence.counts.inPacket + ready.evidence.counts.leftByCap).toBe(234);
    expect(ready.coverage.omissions).toHaveLength(ready.evidence.counts.leftByCap);
    // The round-robin keeps both questions in the packet: their packet quotes differ by at most one.
    const per = ["Q1", "Q2"].map(q => ready.evidence.quotes.filter(e => e.questionIds.includes(q)).length);
    expect(Math.abs(per[0]! - per[1]!)).toBeLessThanOrEqual(1);
  });
  it("refuses counts that do not add up: left-by-cap, verified, and noted conflicts", async () => {
    for (const change of [(e: any) => { e.counts.leftByCap--; }, (e: any) => { e.counts.verified++; }, (e: any) => { e.counts.conflictsNoted++; }]) {
      const files = await trimmedPacket(); edit(files, RESEARCH_FILES.evidence, change); expect(() => validateReadyResearchPacket(files)).toThrow("evidence_counts");
    }
  });
  it("refuses a duplicate omission, and an omission of a quote that is in the packet", async () => {
    const twice = await trimmedPacket(); omit(twice, json(twice, RESEARCH_FILES.coverage).omissions[0]); expect(() => validateReadyResearchPacket(twice)).toThrow("omission_identity");
    const kept = await trimmedPacket(), quote = json(kept, RESEARCH_FILES.evidence).quotes[0];
    omit(kept, { sourceId: quote.sourceId, questionIds: quote.questionIds, quoteSha256: digest(quote.quote), chunkIds: quote.chunkIds, locator: quote.locator, reason: "packet_cap" });
    expect(() => validateReadyResearchPacket(kept)).toThrow("omission_identity");
  });
  it("refuses an evidence_trimmed outcome that keeps evidence ids or that no omission names", async () => {
    const withIds = await trimmedPacket();
    edit(withIds, RESEARCH_FILES.coverage, c => { c.chunks.flatMap((chunk: any) => chunk.questions).find((q: any) => q.status === "evidence_retained").status = "evidence_trimmed"; });
    expect(() => validateReadyResearchPacket(withIds)).toThrow("question_outcome");
    const unbound = await trimmedPacket();
    edit(unbound, RESEARCH_FILES.coverage, c => { c.chunks.flatMap((chunk: any) => chunk.questions).find((q: any) => q.status === "no_verified_evidence").status = "evidence_trimmed"; });
    expect(() => validateReadyResearchPacket(unbound)).toThrow("question_outcome");
  });
  it("refuses an omission bound to another source's chunk, to an unknown question, or to a pair with no verified evidence", async () => {
    const coverage = json(await trimmedPacket(), RESEARCH_FILES.coverage), last = coverage.chunks.find((c: any) => c.sourceId === "input/trim-19.md");
    const fresh = (omission: Record<string, unknown>) => ({ sourceId: last.sourceId, questionIds: ["Q1"], quoteSha256: "3".repeat(64), chunkIds: [last.id], locator: "line 999", reason: "packet_cap", ...omission });
    for (const [omission, code] of [[fresh({ chunkIds: [coverage.chunks[0].id] }), "omission_binding"], [fresh({ questionIds: ["Q1", "Q3"] }), "omission_binding"],
      [fresh({ questionIds: ["Q2"] }), "omission_question"]] as const) {
      const files = await trimmedPacket(); omit(files, omission); expect(() => validateReadyResearchPacket(files)).toThrow(code);
    }
  });
  it("refuses a conflict omission from an unknown source", async () => {
    const files = await trimmedPacket();
    edit(files, RESEARCH_FILES.coverage, c => { c.conflictOmissions.push({ sourceId: "input/elsewhere.md", questionIds: ["Q1"], noteSha256: "4".repeat(64), reason: "conflict_cap" }); });
    edit(files, RESEARCH_FILES.evidence, e => { e.counts.conflictsNoted++; });
    expect(() => validateReadyResearchPacket(files)).toThrow("conflict_binding");
  });
});
