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
/** Invented CPU model replies derived from the actual v4 request. No development/H5 answers. */
export function researchV4Reply(system: string, user: string): string {
  const input = parseResearchUserContent(user);
  if (system.startsWith("You index")) return JSON.stringify({ sources: input.sources.map((s: any) => ({ sourceId: s.id, title: "Synthetic source", gist: "A source for the supplied questions.", date: "", figures: [] })) });
  if (system.startsWith("You plan")) return JSON.stringify({ version: 2, questions: [{ id: "Q1", text: "What does the supplied evidence establish?", requirementIds: input.units.map((u: any) => u.id), sourceIds: input.sourceIndex.sources.slice(0, 8).map((s: any) => s.sourceId), lookFor: [] }], conflictsToCheck: [], deliverableNotes: "Distinguish evidence from uncertainty." });
  if (system.startsWith("You extract")) {
    const quote = String(input.chunk.text).split("\n").map((s: string) => s.trim()).find((s: string) => !s.startsWith("#") && s.length >= 12 && s.length <= 300);
    const questionIds = input.plan.questions.map((q: any) => q.id);
    return JSON.stringify({ questions: questionIds.map((questionId: string) => ({ questionId, status: quote ? "evidence_found" : "no_verified_evidence" })), quotes: quote ? [{ quote, questionIds, note: "Synthetic source statement; relevance requires review." }] : [], conflicts: [] });
  }
  if (system.startsWith("You write")) {
    const quotes = input.evidence.quotes as { id: string; questionIds: string[] }[];
    return JSON.stringify({ version: 1, argument: `The supplied source states a bounded synthetic finding [${quotes[0]?.id ?? "E1"}].\n\n## Conflicting evidence\nNo conflict was extracted.\n\n## Unanswered questions\nA lack of extracted evidence does not establish absence in the corpus.`,
      questions: input.plan.questions.map((q: any) => { const evidenceIds = quotes.filter(e => e.questionIds.includes(q.id)).map(e => e.id); return { questionId: q.id, disposition: evidenceIds.length ? "findings" : "unresolved", evidenceIds }; }) });
  }
  throw new Error("research_v4_fixture_unknown_stage");
}
export const RESEARCH_V4_TEST_BRIEF = "Describe the supplied synthetic observations and their limitations.";
export function researchV4Sources() { return [{ id: "input/corpus/alpha.md", path: "input/corpus/alpha.md", bytes: Buffer.from("# Synthetic alpha\nThe orchard recorded twelve healthy trees during the autumn survey.\n") },
  { id: "input/corpus/beta.md", path: "input/corpus/beta.md", bytes: Buffer.from("# Synthetic beta\nThe meadow recorded seven healthy trees during the spring survey.\n") }]; }
