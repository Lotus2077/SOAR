/**
 * Research admission (backlog item 7(b); review section 5.2, stage S1): what the host decides from the inputs before the
 * first research request. Part 1 (BL-20261109-0334-research-request-shapes-design) holds the index batches by preview size
 * (finding D8's batching), the mandatory-work ceilings and the synthesis length cap taken from the brief (finding D13); part 3
 * (7b.3) adds the card-derived ceilings, the reserved repair budget and the wall-clock feasibility estimate.
 * Pure: no I/O, no clock, no model text. Every policy here is bound into researchProtocolSha256 (research-pipeline.ts), so a
 * changed value or pattern is a protocol change. This module must not import research-pipeline.ts, which imports it, and may
 * import serving-card.ts for types only (serving-card.ts imports research-pipeline.ts); role values are passed in as arguments.
 */
import type { ResearchBudget } from "./research-contract";
import { INDEX_LIMITS } from "./research-index";

/**
 * Index batches by preview size (D8). A source adds its preview, never its full bytes, to a batch: its first `previewBytes`
 * bytes cut back to a UTF-8 boundary, the text the index request carries. A batch holds at most `batchSources` sources
 * (INDEX_LIMITS.batchSources, which assessIndexBatch enforces) and at most `batchPreviewBytes` of previews. Under these values
 * the byte bound never binds before the source bound, so batches are consecutive triples in inventory order; the byte bound is
 * the explicit limit on one index request's source text.
 */
export const RESEARCH_INDEX_BATCH_POLICY = Object.freeze({ version: 1, basis: "preview_bytes", order: "inventory",
  previewBytes: 20 * 1024, batchPreviewBytes: 3 * 20 * 1024, batchSources: INDEX_LIMITS.batchSources });
export interface ResearchIndexBatchLimits { previewBytes: number; batchPreviewBytes: number; batchSources: number }

/** The end of a source's index preview: its first `previewBytes` bytes, cut back so that the preview never splits a UTF-8 sequence. */
export function researchIndexPreviewEnd(bytes: Uint8Array, previewBytes: number = RESEARCH_INDEX_BATCH_POLICY.previewBytes): number {
  let end = Math.min(bytes.length, previewBytes);
  while (end < bytes.length && end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return end;
}

/** Consecutive batches in the given order: a batch takes the next source while it holds fewer than `batchSources` and the previews still fit. */
export function planResearchIndexBatches<T extends { bytes: Uint8Array }>(ordered: readonly T[], limits: ResearchIndexBatchLimits = RESEARCH_INDEX_BATCH_POLICY): T[][] {
  const batches: { sources: T[]; previewBytes: number }[] = [];
  for (const source of ordered) {
    const size = researchIndexPreviewEnd(source.bytes, limits.previewBytes), batch = batches.at(-1);
    if (batch && batch.sources.length < limits.batchSources && batch.previewBytes + size <= limits.batchPreviewBytes) { batch.sources.push(source); batch.previewBytes += size; }
    else batches.push({ sources: [source], previewBytes: size });
  }
  return batches.map(batch => batch.sources);
}

/** All mandatory work is known before the first request (S1): every batch and every chunk must fit the budget's index and extraction calls. */
export function researchMandatoryWorkFits(work: { batches: number; chunks: number }, budget: Pick<ResearchBudget, "indexCalls" | "extractionCalls">): boolean {
  return work.batches <= budget.indexCalls && work.chunks <= budget.extractionCalls;
}

const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`;
const DASH = String.raw`[-‐-―]`;
/**
 * An explicit upper word limit, matched on the brief after NFKC, lower-casing and collapsing every whitespace run to one space.
 * Each pattern captures the limit. None matches a minimum ("at least N words", "no fewer than", "not less than", "not under"),
 * a hyphenated adjective ("a 500-word abstract") or a bare "N words".
 */
const UPPER_LIMIT_PATTERNS = Object.freeze([
  String.raw`\b(?:at most|no more than|not more than|up to|(?<!\bnot )under|(?<!\bno )(?<!\bnot )(?:fewer|less) than|(?:a )?maximum(?: of)?|max\.?(?: of)?|not to exceed|not exceeding|limited to|capped at) ${NUMBER} words?\b`,
  String.raw`\b${NUMBER} words? (?:maximum|max\b|at most|or fewer|or less)`,
  String.raw`\bword (?:count )?limit(?: of| is|:)? ${NUMBER}\b`,
]);
/** A stated range gives its upper end: "N-M words", "N to M words", "between N and M words". */
const RANGE_PATTERNS = Object.freeze([
  String.raw`\b${NUMBER} ?(?:${DASH}|to) ?${NUMBER} words?\b`,
  String.raw`\bbetween ${NUMBER} and ${NUMBER} words?\b`,
]);

/**
 * The synthesis length cap (D13): an explicit word limit stated in the brief wins over the default; the largest stated limit
 * wins over smaller ones; either is clamped to the ceiling the synthesis reply allows. Recorded in the stage row and sent to the
 * model, never enforced: no reply is rejected on its length.
 */
export const RESEARCH_SYNTHESIS_LENGTH_POLICY = Object.freeze({ version: 1, source: "raw_brief", normalization: "nfkc_lowercase_single_spaces",
  upperLimitPatterns: UPPER_LIMIT_PATTERNS, rangePatterns: RANGE_PATTERNS, selection: "largest_stated_limit", limitRange: Object.freeze([1, 100_000]),
  /** The cap when the brief states none and the reply has room: criterion 6's upper band (review section 2.2), which binds the report. */
  defaultMaxWords: 6000,
  /** scripts/serving-probe.py TOKENS_PER_WORD, measured on 2026-09-28 (serving card P3); a test pins the two copies equal. */
  tokensPerWord: 1.245,
  /** The reply's JSON structure and question rows besides the argument. */
  replyOverheadTokens: 1024,
  /**
   * The ceiling while the role thinks ("model"): today's request. Three loops on 2026-11-01 had a thinking synthesis reply reach
   * the 8,192-token cap at this length (BL-20261101-0428, -1106, -2044), so nothing shows a longer argument fits beside reasoning.
   */
  thinkingCeilingWords: 1200,
  /** The smallest cap ever sent; 7a.2 refuses, before any request, a role policy whose ceiling falls below it. */
  minimumWords: 100, enforcement: "recorded_not_enforced" });

const parseLimit = (text: string | undefined): number | undefined => {
  if (text === undefined) return undefined;
  const value = Number(text.replaceAll(",", "")), [low, high] = RESEARCH_SYNTHESIS_LENGTH_POLICY.limitRange;
  return Number.isSafeInteger(value) && value >= low! && value <= high! ? value : undefined;
};

/** The largest explicit upper word limit the brief states, or undefined. Heuristic: English phrasings with digits only. */
export function briefWordLimit(brief: string): number | undefined {
  const text = brief.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
  const limits: number[] = [];
  for (const pattern of RESEARCH_SYNTHESIS_LENGTH_POLICY.upperLimitPatterns) for (const match of text.matchAll(new RegExp(pattern, "gu"))) {
    const limit = parseLimit(match[1]); if (limit !== undefined) limits.push(limit);
  }
  for (const pattern of RESEARCH_SYNTHESIS_LENGTH_POLICY.rangePatterns) for (const match of text.matchAll(new RegExp(pattern, "gu"))) {
    const low = parseLimit(match[1]), high = parseLimit(match[2]); if (low !== undefined && high !== undefined && low <= high) limits.push(high);
  }
  return limits.length ? Math.max(...limits) : undefined;
}

export interface ResearchSynthesisLengthCap { words: number; ceilingWords: number; briefWordLimit?: number }
/**
 * The argument's word cap for one synthesis call with this output cap and thinking: min(the brief's limit, else the default,
 * and the ceiling). The ceiling is what the reply holds besides its structure, floor((cap − overhead) ÷ tokens per word), at
 * most `thinkingCeilingWords` while the role thinks, and never below `minimumWords`.
 */
export function researchSynthesisLengthCap(brief: string, role: { maxOutputTokens: number; thinking: "disabled" | "model" }): ResearchSynthesisLengthCap {
  const policy = RESEARCH_SYNTHESIS_LENGTH_POLICY, stated = briefWordLimit(brief);
  const fits = Math.max(0, Math.floor((role.maxOutputTokens - policy.replyOverheadTokens) / policy.tokensPerWord));
  const ceilingWords = role.thinking === "model" ? Math.min(policy.thinkingCeilingWords, fits) : fits;
  // The floor backs up a role-derived ceiling only; a limit the brief itself states always holds below it.
  const words = Math.min(stated ?? policy.defaultMaxWords, Math.max(policy.minimumWords, ceilingWords));
  return { words, ceilingWords, ...(stated !== undefined ? { briefWordLimit: stated } : {}) };
}

/** A recorded word count: whitespace-separated tokens holding at least one letter or digit. */
export function researchWordCount(text: string): number {
  return text.split(/\s+/u).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}
