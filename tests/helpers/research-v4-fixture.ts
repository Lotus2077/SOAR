import { canonical } from "../../src/main/private-agent/contracts";

/**
 * The raw message layout every research request must have since 7b.1, checked by the fixture brokers on every request: an
 * extraction message is exactly two canonical JSON lines whose keys are these literal lists (never read from the pipeline's
 * own descriptor, which would confirm itself); every other stage sends one canonical object. Throws a fixed code otherwise.
 */
export function assertResearchUserLayout(system: string, user: string): void {
  const lines = user.split("\n"), keys = (line: string) => canonical(Object.keys(JSON.parse(line) as object));
  if (system.startsWith("You extract")) {
    if (lines.length !== 2) throw new Error("research_fixture_layout_lines");
    if (keys(lines[0]!) !== canonical(["brief", "plan", "units"]) || keys(lines[1]!) !== canonical(["chunk", "repairReason", "source"])) throw new Error("research_fixture_layout_keys");
    if (lines.some(line => canonical(JSON.parse(line)) !== line)) throw new Error("research_fixture_layout_not_canonical");
  } else if (lines.length !== 1 || canonical(JSON.parse(user)) !== user) throw new Error("research_fixture_layout_single");
}
/**
 * A research request's user message as one object. Since 7b.1 the extraction message is two canonical JSON lines (the stable
 * packet, then the chunk part), merged here; every other stage sends one line. canonical() never emits a raw newline, so each
 * line is exactly one object, and a key in two lines is refused. Tests that pin the layout itself assert on the raw bytes.
 */
export function parseResearchUserContent(user: string): Record<string, any> {
  const merged: Record<string, any> = {};
  for (const line of user.split("\n")) for (const [key, value] of Object.entries(JSON.parse(line) as Record<string, unknown>)) {
    if (Object.hasOwn(merged, key)) throw new Error("research_user_content_duplicate_key");
    merged[key] = value;
  }
  return merged;
}
/** Invented CPU model replies derived from the actual v4 request, and since 10.b from a T1 or T2 assist packet. No development/H5 answers. */
export function researchV4Reply(system: string, user: string): string {
  const input = parseResearchUserContent(user);
  if (system.startsWith("You index")) return JSON.stringify({ sources: input.sources.map((s: any) => ({ sourceId: s.id, title: "Synthetic source", gist: "A source for the supplied questions.", date: "", figures: [] })) });
  if (system.startsWith("You plan")) return JSON.stringify({ version: 2, questions: [{ id: "Q1", text: "What does the supplied evidence establish?", requirementIds: input.units.map((u: any) => u.id), sourceIds: (input.sourceIndex ? input.sourceIndex.sources.map((s: any) => s.sourceId) : input.sources.map((s: any) => s.id)).slice(0, 8), lookFor: [] }], conflictsToCheck: [], deliverableNotes: "Distinguish evidence from uncertainty." });
  if (system.startsWith("You extract")) {
    const quote = String(input.chunk.text).split("\n").map((s: string) => s.trim()).find((s: string) => !s.startsWith("#") && s.length >= 12 && s.length <= 300);
    const questionIds = input.plan.questions.map((q: any) => q.id);
    return JSON.stringify({ questions: questionIds.map((questionId: string) => ({ questionId, status: quote ? "evidence_found" : "no_verified_evidence" })), quotes: quote ? [{ quote, questionIds, note: "Synthetic source statement; relevance requires review." }] : [], conflicts: [] });
  }
  if (system.startsWith("You write")) {
    // 10.b: a T2 assist packet carries its quotes rendered in `evidenceText` (research-assist.ts, renderAssistEvidence) rather than as `evidence`.
    const quotes = (input.evidence ? input.evidence.quotes : [...String(input.evidenceText).matchAll(/^- \[(E\d+)\] S\d+ \([^;]*; ([^)]*)\): /gmu)]
      .map(match => ({ id: match[1]!, questionIds: match[2]!.split(", ") }))) as { id: string; questionIds: string[] }[];
    return JSON.stringify({ version: 1, argument: `The supplied source states a bounded synthetic finding [${quotes[0]?.id ?? "E1"}].\n\n## Conflicting evidence\nNo conflict was extracted.\n\n## Unanswered questions\nA lack of extracted evidence does not establish absence in the corpus.`,
      questions: input.plan.questions.map((q: any) => { const evidenceIds = quotes.filter(e => e.questionIds.includes(q.id)).map(e => e.id); return { questionId: q.id, disposition: evidenceIds.length ? "findings" : "unresolved", evidenceIds }; }) });
  }
  throw new Error("research_v4_fixture_unknown_stage");
}
export const RESEARCH_V4_TEST_BRIEF = "Describe the supplied synthetic observations and their limitations.";
export function researchV4Sources() { return [{ id: "input/corpus/alpha.md", path: "input/corpus/alpha.md", bytes: Buffer.from("# Synthetic alpha\nThe orchard recorded twelve healthy trees during the autumn survey.\n") },
  { id: "input/corpus/beta.md", path: "input/corpus/beta.md", bytes: Buffer.from("# Synthetic beta\nThe meadow recorded seven healthy trees during the spring survey.\n") }]; }

/**
 * A packet 7b.2's priority trim cuts (#102), for researchV4TrimmedSources(): every extraction reply quotes each line of its chunk for
 * every question with a 200-character note, so the stage verifies 240 quotes that overflow the 64 KiB packet. Its ready packet then
 * holds `quotesLeftByCap` above 0, coverage omissions and `evidence_trimmed` outcomes. Every other stage answers as researchV4Reply.
 */
export function researchV4TrimmedReply(system: string, user: string): string {
  if (!system.startsWith("You extract")) return researchV4Reply(system, user);
  const input = parseResearchUserContent(user), questionIds = input.plan.questions.map((q: { id: string }) => q.id);
  return JSON.stringify({ questions: questionIds.map((questionId: string) => ({ questionId, status: "evidence_found" })), conflicts: [],
    quotes: String(input.chunk.text).split("\n").map((quote: string) => ({ quote, questionIds, note: "n".repeat(200) })) });
}
/** Twenty sources of twelve quotable lines each (one chunk a source), the corpus researchV4TrimmedReply overflows the packet with. */
export function researchV4TrimmedSources(): { id: string; path: string; bytes: Buffer }[] {
  return Array.from({ length: 20 }, (_, i) => {
    const path = `input/corpus/trim-${String(i).padStart(2, "0")}.md`;
    return { id: path, path, bytes: Buffer.from(Array.from({ length: 12 }, (_, j) => `Source ${i} row ${j} ${"records a synthetic observation with a bounded uncertainty. ".repeat(4)}`).join("\n")) };
  });
}
