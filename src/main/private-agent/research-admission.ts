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
 * Corrections BL-20261110-0625 and BL-20261110-0709 (the merge-train review of PR #69, finding F1, and two code reviews):
 * - A clause that opens at a heading opener (":" or "(") belongs to the heading before it ("Abstract: at most 150 words",
 *   "Executive summary (max. 200 words)"). The parts check also reads that heading: every word back to the end of the previous
 *   sentence (".", ";", "!" or "?") or the previous line break, commas included ("Abstract, keywords and highlights: ...").
 *   A line break between the heading's last word and its opener does not end it ("with an abstract\n(max. 150 words)").
 * - `headingParts` name a part only in a short heading, of at most `headingPartsMaxWords` words ("Background: up to 600 words",
 *   "Results (max 800 words)"); elsewhere they often name the report itself ("an overview of the evidence (at most 1,500 words)").
 * - An exclusion word cancels part nouns only where this correction added the reason to drop a limit: in the heading, up to
 *   the next delimiter or line break ("Word limit (excluding the abstract): at most 2,000 words"), with "including" and "incl"
 *   cancelling there only when they open a parenthesis; and among the four words after the limit, for `addedParts` only
 *   ("3,000 words excluding appendices"). In the clause before the limit nothing is cancelled ("a report including an abstract
 *   of under 200 words" is the abstract's limit), and 7b.1's own part nouns after the limit count as before. A distributive
 *   ("each", "per", "every") is never cancelled. So against 7b.1 the correction only drops limits: on every brief it reads
 *   7b.1's limit or none.
 * - Question, reference and footnote are no part nouns: "Answer the research question in at most 1,000 words" and "under 900
 *   words excluding references" limit the report; "each", "every" and "per" mark a per-question limit within the clause, its
 *   comma chain and the sentence before (below).
 *
 * Correction BL-20261110-0848 (the delta review of PR #69, rules A and B; each only adds a reason to drop a limit):
 * - A, `commaChain`: a clause opened by a comma belongs to its comma chain. Under a heading opener on the same line
 *   ("Abstract (required, max 150 words)", "Executive summary: one page, no more than 200 words") the heading is read as if the
 *   clause opened there; and a distributive anywhere in the chain on the same line ("For each source, write up to 150 words")
 *   marks a part's limit. Part nouns in the chain are not read: "An abstract of up to 150 words, then a report of 1,200-1,800
 *   words" keeps 1,800.
 * - B, `previousSentence`: when a limit opens its sentence, or a `referring` word stands before it in the sentence, the sentence
 *   before it is read (sentences end at ".", ";", "!", "?" or a line break), and a part noun or a distributive there marks a
 *   part's limit ("Include an abstract. Max 150 words.", "Start with an executive summary. Keep it under 200 words."). The
 *   "word limit N" phrasing is exempt: it names the document's limit.
 */
const CLAUSE_GUARDS = Object.freeze({ delimiters: ",;.!?:()", headingOpeners: ":(", headingEnds: ".;!?", headingEndsAtLineBreaks: true, windowWords: 4,
  negators: Object.freeze(["no", "not", "never", "nothing", "nor", "cannot"]), negatorSuffix: "n't",
  rejections: Object.freeze(["unacceptable", "rejected", "insufficient", "too short", "too brief"]),
  distributives: Object.freeze(["each", "per", "every"]),
  parts: Object.freeze(["abstract", "abstracts", "summary", "summaries", "synopsis", "title", "titles", "heading", "headings", "headline", "headlines",
    "label", "labels", "caption", "captions", "tag", "tags", "sentence", "sentences", "paragraph", "paragraphs", "bullet", "bullets"]),
  addedParts: Object.freeze(["section", "sections", "introduction", "introductions", "conclusion", "conclusions", "appendix", "appendices", "method", "methods",
    "quote", "quotes", "quotation", "quotations"]),
  headingParts: Object.freeze(["overview", "overviews", "background", "results", "discussion", "findings", "recommendations", "limitations"]), headingPartsMaxWords: 4,
  exclusions: Object.freeze(["excluding", "including", "except", "without", "excl", "incl"]), exclusionsOnlyOpeningParenthesis: Object.freeze(["including", "incl"]),
  commaChain: "heading_opener_and_distributives_same_line",
  referring: Object.freeze(["it", "its", "this", "that", "these", "those", "they", "them", "there"]),
  previousSentence: "parts_and_distributives_when_the_limit_opens_its_sentence_or_follows_a_referring_word_except_word_limit" });

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
    if (/[\n\r\v\f\p{Zl}\p{Zp}]/u.test(run[0])) lineBreaks.push(text.length);
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
/** A part noun: one of 7b.1's or one this correction added. */
const isPart = (word: string) => CLAUSE_GUARDS.parts.includes(word) || CLAUSE_GUARDS.addedParts.includes(word);
interface ClauseToken { start: number; end: number; word: string }
/**
 * The brief's words and delimiters, found once (correction BL-20261110-0625, finding F2: guarded() rescanned the whole clause for
 * every candidate, so a clause of many candidates parsed in quadratic time). A word is a run of characters that are neither a
 * space nor a delimiter, stripped (strip above); empty words are dropped. These are exactly the words the clause slices of
 * 7b.1's guard held. Each `...Before[k]` counts words among the first k, so a span's count is one subtraction:
 * `distributivesBefore` and `partsBefore` count every distributive and part noun; `liveParts` and `liveHeadingParts` count
 * only those no exclusion cancels (CLAUSE_GUARDS). `sentenceEnds` are the sentence-ending delimiters; `headingEnds` add the
 * line breaks.
 */
interface ClauseIndex { text: string; delimiters: number[]; sentenceEnds: number[]; headingEnds: number[]; tokens: ClauseToken[]; tokenStarts: number[];
  distributivesBefore: number[]; partsBefore: number[]; liveParts: number[]; liveHeadingParts: number[];
  /** Rule A: for each delimiter, the index of the delimiter that opened its comma chain (itself unless it is a comma), or -1. */
  anchors: number[]; lineBreaks: readonly number[];
  /** Rule B: the referring words among the first k words. */
  referringBefore: number[] }
function indexClauses(text: string, lineBreaks: readonly number[]): ClauseIndex {
  const delimiters: number[] = [], sentenceEnds: number[] = [], tokens: ClauseToken[] = [];
  for (let i = 0, start = -1; i <= text.length; i++) {
    const delimiter = i < text.length && CLAUSE_GUARDS.delimiters.includes(text[i]!);
    if (i === text.length || delimiter || text[i] === " ") {
      if (start >= 0) { const word = strip(text.slice(start, i)); if (word) tokens.push({ start, end: i, word }); start = -1; }
      if (delimiter) { delimiters.push(i); if (CLAUSE_GUARDS.headingEnds.includes(text[i]!)) sentenceEnds.push(i); }
    } else if (start < 0) start = i;
  }
  const merge = (a: readonly number[], b: readonly number[]) => [...a, ...b].sort((x, y) => x - y);
  // An exclusion's scope ends at the next delimiter or line break.
  const boundaries = merge(delimiters, lineBreaks), distributivesBefore = [0], partsBefore = [0], liveParts = [0], liveHeadingParts = [0], referringBefore = [0];
  let scopeEnd = -1;
  for (const token of tokens) {
    const live = token.start >= scopeEnd, part = isPart(token.word);
    distributivesBefore.push(distributivesBefore.at(-1)! + (CLAUSE_GUARDS.distributives.includes(token.word) ? 1 : 0));
    referringBefore.push(referringBefore.at(-1)! + (CLAUSE_GUARDS.referring.includes(token.word) ? 1 : 0));
    partsBefore.push(partsBefore.at(-1)! + (part ? 1 : 0));
    liveParts.push(liveParts.at(-1)! + (part && live ? 1 : 0));
    liveHeadingParts.push(liveHeadingParts.at(-1)! + (live && CLAUSE_GUARDS.headingParts.includes(token.word) ? 1 : 0));
    if (CLAUSE_GUARDS.exclusions.includes(token.word)) {
      let before = token.start - 1; while (before >= 0 && text[before] === " ") before--;
      if (!CLAUSE_GUARDS.exclusionsOnlyOpeningParenthesis.includes(token.word) || text[before] === "(") {
        const next = rank(boundaries, token.end, false); scopeEnd = next < boundaries.length ? boundaries[next]! : text.length;
      }
    }
  }
  // One pass: a comma continues the chain of the delimiter before it; any other delimiter opens a chain of its own.
  const anchors: number[] = [];
  for (let i = 0; i < delimiters.length; i++) anchors.push(text[delimiters[i]!] === "," ? (i ? anchors[i - 1]! : -1) : i);
  return { text, delimiters, sentenceEnds, headingEnds: merge(sentenceEnds, lineBreaks), tokens, tokenStarts: tokens.map(token => token.start),
    distributivesBefore, partsBefore, liveParts, liveHeadingParts, anchors, lineBreaks, referringBefore };
}
/** The number of sorted values below `value` (strict) or at most `value` (inclusive). */
function rank(sorted: readonly number[], value: number, inclusive: boolean): number {
  let low = 0, high = sorted.length;
  while (low < high) { const mid = (low + high) >> 1; if (sorted[mid]! < value || (inclusive && sorted[mid] === value)) low = mid + 1; else high = mid; }
  return low;
}
/** The count of words lo..hi-1 that `prefix` counts. */
const span = (prefix: readonly number[], lo: number, hi: number) => hi > lo ? prefix[hi]! - prefix[lo]! : 0;
/** Whether the words after a limit mark a part: a distributive or one of 7b.1's part nouns anywhere, or an added part noun before the first exclusion word. */
const afterMarksPart = (words: readonly string[]): boolean => {
  const exclusion = words.findIndex(word => CLAUSE_GUARDS.exclusions.includes(word));
  return words.some(word => CLAUSE_GUARDS.distributives.includes(word) || CLAUSE_GUARDS.parts.includes(word))
    || (exclusion < 0 ? words : words.slice(0, exclusion)).some(word => CLAUSE_GUARDS.addedParts.includes(word));
};
/** True when the clause around a candidate says it is no upper limit on the report (CLAUSE_GUARDS). */
function guarded(index: ClauseIndex, start: number, end: number, wordLimitPhrase: boolean): boolean {
  const { text, delimiters, tokens, tokenStarts } = index, window = CLAUSE_GUARDS.windowWords;
  const opened = rank(delimiters, start - 1, true), open = opened ? delimiters[opened - 1]! : -1;
  const closed = rank(delimiters, end, false), close = closed < delimiters.length ? delimiters[closed]! : text.length;
  // Before: the clause's whole words, then the word the candidate's start cuts (as the clause slice ended there).
  const first = rank(tokenStarts, open, true), next = rank(tokenStarts, start, false), cutBefore = next > first && tokens[next - 1]!.end > start;
  const wholeBefore = cutBefore ? next - 1 : next, cutWord = cutBefore ? strip(text.slice(tokens[next - 1]!.start, start)) : "";
  const clauseBefore = [...tokens.slice(Math.max(first, wholeBefore - window), wholeBefore).map(token => token.word), ...(cutWord ? [cutWord] : [])].slice(-window);
  // The clause before marks a part with any distributive or part noun: no exclusion cancels one there.
  const before = span(index.distributivesBefore, first, wholeBefore) + span(index.partsBefore, first, wholeBefore) > 0
    || CLAUSE_GUARDS.distributives.includes(cutWord) || isPart(cutWord);
  // After: the word the candidate's end cuts, then the clause's whole words, at most the window.
  const afterStart = rank(tokenStarts, end, false), cutAfter = afterStart > 0 && tokens[afterStart - 1]!.end > end && tokens[afterStart - 1]!.start < end;
  const after: string[] = cutAfter ? [strip(text.slice(end, tokens[afterStart - 1]!.end))].filter(Boolean) : [];
  for (let i = afterStart; after.length < window && i < tokens.length && tokens[i]!.start < close; i++) after.push(tokens[i]!.word);
  const afterText = after.join(" ");
  // Rule A: a clause a comma opens belongs to its comma chain; its heading opener (on the same line) stands in for the comma,
  // and a distributive in the chain (on the same line) marks a part's limit. The anchors were found once, so this stays linear.
  const comma = open >= 0 && text[open] === ",", anchor = comma ? index.anchors[opened - 1]! : -1, chainOpen = comma ? (anchor >= 0 ? delimiters[anchor]! : -1) : open;
  const broken = rank(index.lineBreaks, start, false), lineStart = broken ? index.lineBreaks[broken - 1]! : -1;
  const headOpen = comma ? (chainOpen > lineStart ? chainOpen : -1) : open;
  const chained = comma && span(index.distributivesBefore, rank(tokenStarts, Math.max(chainOpen, lineStart), true), first) > 0;
  // A heading: the clause opens at ":" or "(", and the heading is every word from the opener's last word back to a sentence end
  // or line break. A line break between that word and the opener is skipped; a sentence end there leaves no heading.
  let heading = false;
  const hi = headOpen >= 0 && CLAUSE_GUARDS.headingOpeners.includes(text[headOpen]!) ? rank(tokenStarts, headOpen, false) : 0;
  if (hi > 0 && rank(index.sentenceEnds, headOpen, false) === rank(index.sentenceEnds, tokens[hi - 1]!.end, false)) {
    const ended = rank(index.headingEnds, tokens[hi - 1]!.start, false), lo = rank(tokenStarts, ended ? index.headingEnds[ended - 1]! : -1, true);
    heading = span(index.distributivesBefore, lo, hi) + span(index.liveParts, lo, hi) + (hi - lo <= CLAUSE_GUARDS.headingPartsMaxWords ? span(index.liveHeadingParts, lo, hi) : 0) > 0;
  }
  // Rule B: a limit that opens its sentence, or follows a referring word in it, may belong to a part the sentence before names.
  let previous = false;
  const ends = wordLimitPhrase ? 0 : rank(index.headingEnds, start, false);
  if (ends > 0) {
    const sentenceFirst = rank(tokenStarts, index.headingEnds[ends - 1]!, true);
    // The sentence before is the one holding the last word before this sentence: an empty one between ("." then a line break) is skipped.
    if (sentenceFirst > 0 && ((sentenceFirst >= wholeBefore && !cutWord) || span(index.referringBefore, sentenceFirst, wholeBefore) > 0 || CLAUSE_GUARDS.referring.includes(cutWord))) {
      const earlier = rank(index.headingEnds, tokens[sentenceFirst - 1]!.start, false), previousFirst = rank(tokenStarts, earlier ? index.headingEnds[earlier - 1]! : -1, true);
      previous = span(index.distributivesBefore, previousFirst, sentenceFirst) + span(index.partsBefore, previousFirst, sentenceFirst) > 0;
    }
  }
  return [...clauseBefore, ...after].some(word => CLAUSE_GUARDS.negators.includes(word) || word.endsWith(CLAUSE_GUARDS.negatorSuffix))
    || CLAUSE_GUARDS.rejections.some(marker => ` ${afterText} `.includes(` ${marker} `))
    || before || heading || chained || previous || afterMarksPart(after);
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
  for (const [patternIndex, pattern] of policy.limitPatterns.entries()) for (const match of text.matchAll(new RegExp(pattern, "gu"))) {
    const ends = match.slice(1).filter((group): group is string => group !== undefined).map(parseLimit);
    if (!ends.length || ends.some(end => end === undefined) || ends.some((end, i) => i > 0 && end! < ends[i - 1]!)) continue;
    const limit = ends.at(-1)!;
    if (limit < policy.minimumWords) continue;
    // LIMIT_PATTERNS[2] is the "word limit N" phrasing, which names the document's own limit: rule B does not read before it.
    const unguarded = !guarded(index, match.index, match.index + match[0].length, patternIndex === 2);
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
