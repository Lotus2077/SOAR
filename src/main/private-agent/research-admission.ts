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

/**
 * A limit in digits with optional comma thousands separators. It is never part of a longer or grouped number: no digit, "."
 * or "," touches it, and no space-separated digit group ("2 500") sits beside it.
 */
const NUMBER = String.raw`(?<![\d.,]|\d )(\d{1,3}(?:,\d{3})+|\d+)(?![.,]?\d| \d)`;
const DASH = String.raw`[\-\u2010-\u2015]`;
/**
 * The phrasings of an explicit upper word limit, matched on the brief after NFKC, lower-casing and collapsing every whitespace
 * run to one space. Each captures the limit, a range its two ends. Every one needs the plural "words" after its number, so a
 * compound adjective ("a 2-3 word label", "a 500-word abstract") and a bare or approximate count ("N words", "about N words")
 * match none. A minimum or a negated limit is removed by the clause guards below, not by these patterns.
 */
const LIMIT_PATTERNS = Object.freeze([
  String.raw`\b(?:at most|no more than|not more than|up to|under|fewer than|less than|(?:a )?maximum(?: of)?|max\.?(?: of)?|not to exceed|not exceeding|limited to|capped at|(?:do|does|must|should|shall|may|can|will)(?: not|n't) exceed|never exceed|cannot exceed) ${NUMBER} words\b`,
  String.raw`\b${NUMBER} words (?:maximum|max\b|at most|or fewer|or less)`,
  String.raw`\bword (?:count )?limit(?: of| is|:)? ${NUMBER}(?: ?(?:${DASH}|to) ?${NUMBER})?`,
  String.raw`\b${NUMBER} ?(?:${DASH}|to) ?${NUMBER} words\b`,
  String.raw`\bbetween ${NUMBER} and ${NUMBER} words\b`,
]);
/**
 * A candidate is dropped when its clause says it is no upper limit on the report. Clauses end at the delimiters. A negator
 * among the four words before the phrase or the four after it ("must not be under", "fewer than N words is not acceptable"),
 * or a rejection after it, marks a minimum or a negated limit. A part of the report anywhere earlier in the clause or among
 * the four words after it ("an abstract of at most 150 words", "500 words per section") marks a part's limit.
 *
 * Correction BL-20261110-0625 (the merge-train review of PR #69, finding F1, and its code review):
 * - A clause that opens at a heading opener (":" or "(") belongs to the heading before it ("Abstract: at most 150 words",
 *   "Executive summary (max. 200 words)"). The parts check also reads that heading: every word back to the end of the previous
 *   sentence (".", ";", "!" or "?") or the previous line break, commas included ("Abstract, keywords and highlights: ...").
 * - `headingParts` name a part only in a heading ("Background: up to 600 words", "Results (max 800 words)"); in a clause they
 *   often name the report itself ("an overview of the evidence in at most 1,500 words").
 * - In each span (the clause before, the heading, the words after), a part noun after an exclusion word counts for nothing
 *   ("3,000 words excluding appendices", "Word limit (excluding the abstract): at most 2,000 words"). A distributive ("each",
 *   "per", "every") always counts: "300 words including references per chapter" is still a part's limit.
 * - Question, reference and footnote are no part nouns: "Answer the research question in at most 1,000 words" and "under 900
 *   words excluding references" limit the report, and "each" and "every" already mark a per-question limit.
 */
const CLAUSE_GUARDS = Object.freeze({ delimiters: ",;.!?:()", headingOpeners: ":(", headingEnds: ".;!?", headingEndsAtLineBreaks: true, windowWords: 4,
  negators: Object.freeze(["no", "not", "never", "nothing", "nor", "cannot"]), negatorSuffix: "n't",
  rejections: Object.freeze(["unacceptable", "rejected", "insufficient", "too short", "too brief"]),
  distributives: Object.freeze(["each", "per", "every"]),
  parts: Object.freeze(["abstract", "abstracts", "summary", "summaries", "synopsis", "title", "titles", "heading", "headings", "headline", "headlines",
    "label", "labels", "caption", "captions", "tag", "tags", "sentence", "sentences", "paragraph", "paragraphs", "bullet", "bullets",
    "section", "sections", "introduction", "introductions", "conclusion", "conclusions", "appendix", "appendices", "method", "methods",
    "quote", "quotes", "quotation", "quotations"]),
  headingParts: Object.freeze(["overview", "overviews", "background", "results", "discussion", "findings", "recommendations", "limitations"]),
  exclusions: Object.freeze(["excluding", "including", "except", "without", "excl", "incl"]) });

/**
 * The synthesis length cap (D13): an explicit word limit stated in the brief wins over the default; the largest stated limit
 * wins over smaller ones, and when the clause guards drop the largest no limit is read (correction BL-20261110-0625); either
 * is clamped to the ceiling the synthesis reply allows. Recorded in the stage row and sent to the
 * model, never enforced: no reply is rejected on its length. The parse prefers missing a limit, which leaves today's default,
 * to misreading one, which would shrink the argument.
 */
export const RESEARCH_SYNTHESIS_LENGTH_POLICY = Object.freeze({ version: 1, source: "raw_brief", normalization: "nfkc_lowercase_single_spaces_line_breaks_kept_for_headings",
  limitPatterns: LIMIT_PATTERNS, rangeEnd: "upper", clauseGuards: CLAUSE_GUARDS, selection: "largest_stated_limit_only_if_unguarded", limitRange: Object.freeze([1, 100_000]),
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
  /**
   * The smallest cap ever sent. 7a.2 refuses, before any request, a role policy whose ceiling falls below it; a stated limit
   * below it is a part's length (a heading, a label), never the argument's, and is ignored.
   */
  minimumWords: 100, enforcement: "recorded_not_enforced" });

const parseLimit = (text: string | undefined): number | undefined => {
  if (text === undefined) return undefined;
  const value = Number(text.replaceAll(",", "")), [low, high] = RESEARCH_SYNTHESIS_LENGTH_POLICY.limitRange;
  return Number.isSafeInteger(value) && value >= low! && value <= high! ? value : undefined;
};
/**
 * The brief as the patterns read it: NFKC, lower case, each whitespace run one space, the right single quote an apostrophe.
 * `lineBreaks` are the positions of the spaces that replaced a run holding a line break; only the heading rule reads them.
 */
function normalizeBrief(brief: string): { text: string; lineBreaks: number[] } {
  const source = brief.normalize("NFKC").toLowerCase(), lineBreaks: number[] = [];
  let text = "", last = 0;
  for (const run of source.matchAll(/\s+/gu)) {
    text += source.slice(last, run.index);
    if (/[\n\r\v\f\x85\p{Zl}\p{Zp}]/u.test(run[0])) lineBreaks.push(text.length);
    text += " "; last = run.index + run[0].length;
  }
  return { text: (text + source.slice(last)).replaceAll("\u2019", "'"), lineBreaks };
}
/**
 * A word stripped of the characters at its ends that are not letters, digits or apostrophes: the span from its first such
 * character to its last. One forward match, linear in the word (7b.1's two-sided replace backtracked quadratically on a long
 * run of punctuation, and every word of the brief is now stripped once).
 */
const strip = (token: string) => token.match(/[\p{L}\p{N}'](?:[^]*[\p{L}\p{N}'])?/u)?.[0] ?? "";
interface ClauseToken { start: number; end: number; word: string }
/**
 * The brief's words and delimiters, found once (correction BL-20261110-0625, finding F2: guarded() rescanned the whole clause for
 * every candidate, so a clause of many candidates parsed in quadratic time). A word is a run of characters that are neither a
 * space nor a delimiter, stripped (strip above); empty words are dropped. These are exactly the words the clause slices of
 * 7b.1's guard held. `distributivesBefore[k]`, `partsBefore[k]` and `headingPartsBefore[k]` count those words among the first
 * k words, so a span's count is one subtraction; `exclusions` lists the indexes of the exclusion words.
 */
interface ClauseIndex { text: string; delimiters: number[]; headingEnds: number[]; tokens: ClauseToken[]; tokenStarts: number[];
  distributivesBefore: number[]; partsBefore: number[]; headingPartsBefore: number[]; exclusions: number[] }
function indexClauses(text: string, lineBreaks: readonly number[]): ClauseIndex {
  const delimiters: number[] = [], headingEnds: number[] = [], tokens: ClauseToken[] = [];
  for (let i = 0, start = -1; i <= text.length; i++) {
    const delimiter = i < text.length && CLAUSE_GUARDS.delimiters.includes(text[i]!);
    if (i === text.length || delimiter || text[i] === " ") {
      if (start >= 0) { const word = strip(text.slice(start, i)); if (word) tokens.push({ start, end: i, word }); start = -1; }
      if (delimiter) { delimiters.push(i); if (CLAUSE_GUARDS.headingEnds.includes(text[i]!)) headingEnds.push(i); }
    } else if (start < 0) start = i;
  }
  const distributivesBefore = [0], partsBefore = [0], headingPartsBefore = [0], exclusions: number[] = [];
  for (const [k, token] of tokens.entries()) {
    const part = CLAUSE_GUARDS.parts.includes(token.word);
    distributivesBefore.push(distributivesBefore.at(-1)! + (CLAUSE_GUARDS.distributives.includes(token.word) ? 1 : 0));
    partsBefore.push(partsBefore.at(-1)! + (part ? 1 : 0));
    headingPartsBefore.push(headingPartsBefore.at(-1)! + (part || CLAUSE_GUARDS.headingParts.includes(token.word) ? 1 : 0));
    if (CLAUSE_GUARDS.exclusions.includes(token.word)) exclusions.push(k);
  }
  return { text, delimiters, headingEnds: [...headingEnds, ...lineBreaks].sort((a, b) => a - b), tokens, tokenStarts: tokens.map(token => token.start),
    distributivesBefore, partsBefore, headingPartsBefore, exclusions };
}
/** The number of sorted values below `value` (strict) or at most `value` (inclusive). */
function rank(sorted: readonly number[], value: number, inclusive: boolean): number {
  let low = 0, high = sorted.length;
  while (low < high) { const mid = (low + high) >> 1; if (sorted[mid]! < value || (inclusive && sorted[mid] === value)) low = mid + 1; else high = mid; }
  return low;
}
/**
 * Whether words lo..hi-1 mark a part: a distributive anywhere, or a part noun (counted by `prefix`) before the span's first
 * exclusion word; and whether an exclusion word occurs in the span.
 */
function spanParts(index: ClauseIndex, prefix: readonly number[], lo: number, hi: number): { part: boolean; excluded: boolean } {
  if (hi <= lo) return { part: false, excluded: false };
  const exclusion = index.exclusions[rank(index.exclusions, lo, false)], excluded = exclusion !== undefined && exclusion < hi, end = excluded ? exclusion : hi;
  return { part: index.distributivesBefore[hi]! - index.distributivesBefore[lo]! > 0 || prefix[end]! - prefix[lo]! > 0, excluded };
}
/** Whether a run of words marks a part: a distributive anywhere, or a part noun before the first exclusion word. */
const wordsMarkPart = (words: readonly string[]): boolean => {
  const exclusion = words.findIndex(word => CLAUSE_GUARDS.exclusions.includes(word));
  return words.some(word => CLAUSE_GUARDS.distributives.includes(word)) || (exclusion < 0 ? words : words.slice(0, exclusion)).some(word => CLAUSE_GUARDS.parts.includes(word));
};
/** True when the clause around a candidate says it is no upper limit on the report (CLAUSE_GUARDS). */
function guarded(index: ClauseIndex, start: number, end: number): boolean {
  const { text, delimiters, tokens, tokenStarts } = index, window = CLAUSE_GUARDS.windowWords;
  const opened = rank(delimiters, start - 1, true), open = opened ? delimiters[opened - 1]! : -1;
  const closed = rank(delimiters, end, false), close = closed < delimiters.length ? delimiters[closed]! : text.length;
  // Before: the clause's whole words, then the word the candidate's start cuts (as the clause slice ended there).
  const first = rank(tokenStarts, open, true), next = rank(tokenStarts, start, false), cutBefore = next > first && tokens[next - 1]!.end > start;
  const wholeBefore = cutBefore ? next - 1 : next, cutWord = cutBefore ? strip(text.slice(tokens[next - 1]!.start, start)) : "";
  const clauseBefore = [...tokens.slice(Math.max(first, wholeBefore - window), wholeBefore).map(token => token.word), ...(cutWord ? [cutWord] : [])].slice(-window);
  const before = spanParts(index, index.partsBefore, first, wholeBefore);
  // After: the word the candidate's end cuts, then the clause's whole words, at most the window.
  const afterStart = rank(tokenStarts, end, false), cutAfter = afterStart > 0 && tokens[afterStart - 1]!.end > end && tokens[afterStart - 1]!.start < end;
  const after: string[] = cutAfter ? [strip(text.slice(end, tokens[afterStart - 1]!.end))].filter(Boolean) : [];
  for (let i = afterStart; after.length < window && i < tokens.length && tokens[i]!.start < close; i++) after.push(tokens[i]!.word);
  const afterText = after.join(" ");
  // A heading: the clause opens at ":" or "(", and the heading is every word before the opener back to a sentence end or line break.
  let heading = false;
  if (open >= 0 && CLAUSE_GUARDS.headingOpeners.includes(text[open]!)) {
    const ended = rank(index.headingEnds, open, false), from = ended ? index.headingEnds[ended - 1]! : -1;
    heading = spanParts(index, index.headingPartsBefore, rank(tokenStarts, from, true), rank(tokenStarts, open, false)).part;
  }
  return [...clauseBefore, ...after].some(word => CLAUSE_GUARDS.negators.includes(word) || word.endsWith(CLAUSE_GUARDS.negatorSuffix))
    || CLAUSE_GUARDS.rejections.some(marker => ` ${afterText} `.includes(` ${marker} `))
    || before.part || CLAUSE_GUARDS.distributives.includes(cutWord) || (!before.excluded && CLAUSE_GUARDS.parts.includes(cutWord)) || heading
    || wordsMarkPart(after);
}

/**
 * The largest explicit upper word limit the brief states for the report, or undefined. Heuristic: English phrasings with
 * digits only; a range gives its upper end; a limit below `minimumWords` is no candidate. When the clause guards drop the
 * largest candidate, no limit is read (correction BL-20261110-0625): the brief's own limit was dropped, and a smaller one that
 * remains may be a part's limit that no guard recognises ("Discussion: at most 800 words").
 */
export function briefWordLimit(brief: string): number | undefined {
  const policy = RESEARCH_SYNTHESIS_LENGTH_POLICY, { text, lineBreaks } = normalizeBrief(brief), index = indexClauses(text, lineBreaks);
  let largest: number | undefined, kept = false;
  for (const pattern of policy.limitPatterns) for (const match of text.matchAll(new RegExp(pattern, "gu"))) {
    const ends = match.slice(1).filter((group): group is string => group !== undefined).map(parseLimit);
    if (!ends.length || ends.some(end => end === undefined) || ends.some((end, i) => i > 0 && end! < ends[i - 1]!)) continue;
    const limit = ends.at(-1)!;
    if (limit < policy.minimumWords) continue;
    const unguarded = !guarded(index, match.index, match.index + match[0].length);
    if (largest === undefined || limit > largest) { largest = limit; kept = unguarded; } else if (limit === largest && unguarded) kept = true;
  }
  return kept ? largest : undefined;
}

export interface ResearchSynthesisLengthCap { words: number; ceilingWords: number; briefWordLimit?: number }
/**
 * The argument's word cap for one synthesis call with this output cap and thinking: min(the brief's limit, else the default,
 * and the ceiling raised to `minimumWords`). `ceilingWords` is the ceiling before that floor: what the reply holds besides its
 * structure, floor((cap - overhead) / tokens per word), and at most `thinkingCeilingWords` while the role thinks.
 */
export function researchSynthesisLengthCap(brief: string, role: { maxOutputTokens: number; thinking: "disabled" | "model" }): ResearchSynthesisLengthCap {
  const policy = RESEARCH_SYNTHESIS_LENGTH_POLICY, stated = briefWordLimit(brief);
  const fits = Math.max(0, Math.floor((role.maxOutputTokens - policy.replyOverheadTokens) / policy.tokensPerWord));
  const ceilingWords = role.thinking === "model" ? Math.min(policy.thinkingCeilingWords, fits) : fits;
  // The floor backs up a role-derived ceiling only; a limit the brief states, never below the floor, always holds below the ceiling.
  const words = Math.min(stated ?? policy.defaultMaxWords, Math.max(policy.minimumWords, ceilingWords));
  return { words, ceilingWords, ...(stated !== undefined ? { briefWordLimit: stated } : {}) };
}

/** A recorded word count: whitespace-separated tokens holding at least one letter or digit. */
export function researchWordCount(text: string): number {
  return text.split(/\s+/u).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}
