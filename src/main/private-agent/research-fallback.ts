/**
 * Research v5's host fallbacks (backlog item 7(c), BL-20261113-0817-research-v5-design; review section 5.2, principle 5):
 * the plan the host uses when no plan attempt is accepted, and the argument it uses when no synthesis attempt is accepted.
 * Both are built from host data alone (the brief's unit ids, the plan's question ids, the packet's evidence and conflict
 * ids), never from model, source or brief text, so the ready gate can recompute them byte for byte. Every template is bound
 * into researchProtocolSha256 through RESEARCH_FALLBACK_POLICY. This module imports types only from the modules that use it.
 */
import type { ResearchPlan } from "./research-plan";

export const RESEARCH_FALLBACK_POLICY = Object.freeze({ version: 1,
  plan: Object.freeze({ maxQuestions: 12, grouping: "contiguous_units_sizes_differ_by_at_most_one_larger_first", sourceIds: "none",
    questionText: "Host fallback question: what does the corpus establish for brief requirement {units}?",
    questionTextPlural: "Host fallback question: what does the corpus establish for brief requirements {units}?", unitSeparator: ", " }),
  skeleton: Object.freeze({
    opening: "The host built this argument because no model synthesis was accepted. It states no finding: each id below names a verified quote occurrence in evidence.md, whose relevance and truth remain unverified.",
    evidenceHeading: "## Evidence by question", evidenceLine: "- {question}: {ids}", noEvidenceLine: "- {question}: no verified evidence was extracted.",
    conflictsHeading: "## Conflicting evidence", conflictLine: "- {question}: conflicts noted by the extractor: {count}, listed in evidence.md.",
    noConflicts: "The extractor noted no conflict.",
    unansweredHeading: "## Unanswered questions", unansweredLine: "- {question}", noUnanswered: "None: every question has verified evidence ids above." }) });

/** The host fallback plan: min(n, 12) questions over contiguous groups of the brief's units, the larger groups first. */
export function hostFallbackPlan(units: readonly { readonly id: string }[]): ResearchPlan {
  const policy = RESEARCH_FALLBACK_POLICY.plan, count = Math.min(units.length, policy.maxQuestions);
  if (!count) throw new Error("research_fallback_plan_units");
  const base = Math.floor(units.length / count), extra = units.length % count, questions: ResearchPlan["questions"] = [];
  for (let i = 0, start = 0; i < count; i++) {
    const ids = units.slice(start, start + base + (i < extra ? 1 : 0)).map(unit => unit.id); start += ids.length;
    const template = ids.length > 1 ? policy.questionTextPlural : policy.questionText;
    questions.push({ id: `Q${i + 1}`, text: template.replace("{units}", ids.join(policy.unitSeparator)), requirementIds: ids, sourceIds: [] });
  }
  return { version: 2, questions };
}

export interface SkeletonQuestion { questionId: string; disposition: "findings" | "unresolved"; evidenceIds: string[] }
/**
 * The host skeleton argument and its synthesis questions. A question with packet evidence is `findings` with every evidence id
 * of the packet that names it, in packet order; any other question is `unresolved`. Conflicts appear as counts per question id.
 */
export function hostSkeletonSynthesis(plan: Pick<ResearchPlan, "questions">, evidence: { readonly quotes: readonly { readonly id: string; readonly questionIds: readonly string[] }[];
  readonly conflicts: readonly { readonly questionIds: readonly string[] }[] }): { argument: string; questions: SkeletonQuestion[] } {
  const policy = RESEARCH_FALLBACK_POLICY.skeleton;
  const questions: SkeletonQuestion[] = plan.questions.map(question => {
    const evidenceIds = evidence.quotes.filter(quote => quote.questionIds.includes(question.id)).map(quote => quote.id);
    return { questionId: question.id, disposition: evidenceIds.length ? "findings" : "unresolved", evidenceIds };
  });
  const fill = (template: string, values: Record<string, string>) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);
  const evidenceLines = questions.map(q => q.evidenceIds.length ? fill(policy.evidenceLine, { question: q.questionId, ids: q.evidenceIds.map(id => `[${id}]`).join("") })
    : fill(policy.noEvidenceLine, { question: q.questionId }));
  const conflictLines = plan.questions.map(question => [question.id, evidence.conflicts.filter(conflict => conflict.questionIds.includes(question.id)).length] as const)
    .filter(([, count]) => count > 0).map(([question, count]) => fill(policy.conflictLine, { question, count: String(count) }));
  const unanswered = questions.filter(q => !q.evidenceIds.length).map(q => fill(policy.unansweredLine, { question: q.questionId }));
  const argument = [policy.opening, "", policy.evidenceHeading, "", ...evidenceLines, "", policy.conflictsHeading, "", ...(conflictLines.length ? conflictLines : [policy.noConflicts]),
    "", policy.unansweredHeading, "", ...(unanswered.length ? unanswered : [policy.noUnanswered])].join("\n");
  return { argument: `${argument}\n`, questions };
}
