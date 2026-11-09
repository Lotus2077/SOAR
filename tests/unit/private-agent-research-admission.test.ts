import { describe, expect, it } from "vitest";
import { RESEARCH_INDEX_BATCH_POLICY, RESEARCH_SYNTHESIS_LENGTH_POLICY, briefWordLimit, planResearchIndexBatches, researchIndexPreviewEnd, researchMandatoryWorkFits,
  researchSynthesisLengthCap, researchWordCount } from "../../src/main/private-agent/research-admission";
import { RESEARCH_PIPELINE_BUDGET } from "../../src/main/private-agent/research-contract";
import { INDEX_LIMITS } from "../../src/main/private-agent/research-index";
import { OUTPUT_TOKENS, THINKING, synthesisLengthCap } from "../../src/main/private-agent/research-pipeline";

const source = (label: string, bytes: number) => ({ id: label, bytes: Buffer.alloc(bytes, 0x61) });
const ids = (batches: { id: string }[][]) => batches.map(batch => batch.map(s => s.id));

describe("7b.1: index batches by preview size (finding D8)", () => {
  it("holds three sources per batch whatever their full size, each contributing at most its 20 KiB preview", () => {
    expect(RESEARCH_INDEX_BATCH_POLICY).toMatchObject({ previewBytes: 20480, batchPreviewBytes: 61440, batchSources: 3 });
    expect(RESEARCH_INDEX_BATCH_POLICY.batchSources).toBe(INDEX_LIMITS.batchSources);
    const large = Array.from({ length: 60 }, (_, i) => source(`s${String(i).padStart(2, "0")}`, 100 * 1024));
    const batches = planResearchIndexBatches(large);
    expect(batches).toHaveLength(20); expect(batches.every(batch => batch.length === 3)).toBe(true);
    expect(batches.flat().map(s => s.id)).toEqual(large.map(s => s.id));
    for (const item of large) expect(researchIndexPreviewEnd(item.bytes)).toBe(20 * 1024);
    // Every readable source yields a chunk, so the 40-chunk ceiling admits at most 40 sources: 14 batches, so the 24-call index
    // ceiling no longer binds under the default budget and leaves at least 10 calls for repairs.
    expect(planResearchIndexBatches(Array.from({ length: 40 }, (_, i) => source(`m${i}`, 30 * 1024)))).toHaveLength(14);
    // Alignment moves with the rule: once a source exceeds 20 KiB, later triples differ from today's too (today: [a][b][c,d,e]).
    expect(ids(planResearchIndexBatches([source("a", 5 * 1024), source("b", 25 * 1024), source("c", 5 * 1024), source("d", 5 * 1024), source("e", 5 * 1024)]))).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(ids(planResearchIndexBatches([source("a", 15 * 1024), source("b", 15 * 1024), source("c", 15 * 1024)]))).toEqual([["a", "b", "c"]]);
  });
  it("keeps today's grouping for small sources and an empty corpus", () => {
    expect(ids(planResearchIndexBatches(["0", "1", "2", "3"].map(id => source(id, 80))))).toEqual([["0", "1", "2"], ["3"]]);
    expect(planResearchIndexBatches([])).toEqual([]);
  });
  it("closes a batch when the next preview would pass the byte bound, which binds only under smaller limits", () => {
    const limits = { previewBytes: 20 * 1024, batchPreviewBytes: 30 * 1024, batchSources: 3 };
    expect(ids(planResearchIndexBatches([source("a", 15 * 1024), source("b", 15 * 1024), source("c", 15 * 1024), source("d", 1)], limits))).toEqual([["a", "b"], ["c", "d"]]);
    // A preview larger than the whole bound still gets a batch of its own rather than being dropped.
    expect(ids(planResearchIndexBatches([source("a", 40 * 1024), source("b", 1)], { ...limits, previewBytes: 40 * 1024 }))).toEqual([["a"], ["b"]]);
  });
  it("cuts a preview back to a UTF-8 boundary, as the index request's text does", () => {
    // "é" is two bytes; with its lead byte at 20479 the boundary moves back one byte.
    const bytes = Buffer.concat([Buffer.alloc(20 * 1024 - 1, 0x61), Buffer.from("é"), Buffer.alloc(10, 0x61)]);
    expect(researchIndexPreviewEnd(bytes)).toBe(20 * 1024 - 1);
    expect(bytes.subarray(0, researchIndexPreviewEnd(bytes)).toString("utf8")).not.toContain("�");
    expect(researchIndexPreviewEnd(Buffer.from("short"))).toBe(5); expect(researchIndexPreviewEnd(Buffer.alloc(0))).toBe(0);
  });
  it("admits the mandatory work only within the budget's index and extraction calls", () => {
    expect(researchMandatoryWorkFits({ batches: 24, chunks: 40 }, RESEARCH_PIPELINE_BUDGET)).toBe(true);
    expect(researchMandatoryWorkFits({ batches: 25, chunks: 1 }, RESEARCH_PIPELINE_BUDGET)).toBe(false);
    expect(researchMandatoryWorkFits({ batches: 1, chunks: 41 }, RESEARCH_PIPELINE_BUDGET)).toBe(false);
    expect(researchMandatoryWorkFits({ batches: 20, chunks: 120 }, RESEARCH_PIPELINE_BUDGET)).toBe(false);
  });
});

describe("7b.1: the synthesis length cap from the brief (finding D13)", () => {
  it("reads an explicit upper word limit in the phrasings the policy names", () => {
    const cases: [string, number][] = [
      ["Write the report in at most 1,000 words.", 1000], ["No more than 750 words, please.", 750], ["not more than 640 words", 640], ["Use up to 2000 words.", 2000],
      ["Keep it under 900 words.", 900], ["fewer than 300 words", 300], ["less than 1,250 words", 1250], ["A maximum of 1,200 words.", 1200], ["maximum 450 words", 450],
      ["Max. 800 words", 800], ["max of 650 words", 650], ["not to exceed 3,000 words", 3000], ["Not exceeding 2,200 words.", 2200], ["limited to 1500 words", 1500],
      ["capped at 4,000 words", 4000], ["1,200 words maximum", 1200], ["800 words max", 800], ["1000 words at most", 1000], ["600 words or fewer", 600],
      ["500 words or less", 500], ["Word limit: 1,500.", 1500], ["word limit of 2000", 2000], ["Word count limit is 2,400.", 2400], ["word limit 900", 900],
      ["2,500-6,000 words", 6000], ["2,500–6,000 words", 6000], ["1000 to 1500 words", 1500], ["between 800 and 1,200 words", 1200], ["at most 1 word", 1],
      ["AT MOST 1,000 WORDS", 1000], ["at\nmost\t1,000   words", 1000], ["at most １，０００ words", 1000],
    ];
    for (const [brief, limit] of cases) expect([brief, briefWordLimit(brief)]).toEqual([brief, limit]);
  });
  it("lets the largest stated limit win, so a component's limit never shrinks the report's", () => {
    expect(briefWordLimit("Write at most 3,000 words, with an abstract of at most 200 words.")).toBe(3000);
    expect(briefWordLimit("An abstract of up to 150 words, then a report of 1,200-1,800 words.")).toBe(1800);
  });
  it("reads no limit from minimums, hyphenated adjectives, bare counts, other units or out-of-range numbers", () => {
    for (const brief of ["Write at least 2,000 words.", "A minimum of 1,000 words.", "more than 500 words", "over 900 words", "Include a 500-word abstract.", "a 3,000-word report",
      "The corpus holds 40,000 words.", "Write about 1,000 words.", "around 800 words", "at most 12 sources", "up to 10 pages", "at most 0 words", "at most 100,001 words", "",
      "Describe the supplied synthetic observations and their limitations.", "6,000-2,500 words", "between 900 and 400 words", "1,00 words at most",
      "No fewer than 800 words.", "not fewer than 300 words", "no less than 1,000 words", "Not less than 500 words.", "not under 900 words"]) expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
  });
  it("keeps today's 1,200 words while the role thinks, fits the reply when it does not, and defaults to 6,000 words", () => {
    expect(RESEARCH_SYNTHESIS_LENGTH_POLICY).toMatchObject({ defaultMaxWords: 6000, tokensPerWord: 1.245, replyOverheadTokens: 1024, thinkingCeilingWords: 1200, minimumWords: 100, enforcement: "recorded_not_enforced" });
    // Today's synthesis role thinks under 8,192 tokens, so the ceiling is today's request, 1,200 words: the request length is unchanged.
    expect([OUTPUT_TOKENS.synthesis, THINKING.synthesis]).toEqual([8192, "model"]);
    expect(researchSynthesisLengthCap("No limit is stated.", { maxOutputTokens: 8192, thinking: "model" })).toEqual({ words: 1200, ceilingWords: 1200 });
    expect(synthesisLengthCap("No limit is stated.")).toEqual({ words: 1200, ceilingWords: 1200 });
    // Without thinking the reply holds floor((cap - 1,024) / 1.245) words: 5,757 at 8,192 and 12,337 at 16,384, where the default 6,000 binds.
    expect(researchSynthesisLengthCap("No limit is stated.", { maxOutputTokens: 8192, thinking: "disabled" })).toEqual({ words: 5757, ceilingWords: 5757 });
    expect(researchSynthesisLengthCap("No limit is stated.", { maxOutputTokens: 16384, thinking: "disabled" })).toEqual({ words: 6000, ceilingWords: 12337 });
    expect(researchSynthesisLengthCap("No limit is stated.", { maxOutputTokens: 16384, thinking: "model" })).toEqual({ words: 1200, ceilingWords: 1200 });
    // A stated limit wins below the ceiling and is clamped above it; criterion 6's minimum in a range is not used (the cap is an upper bound).
    expect(researchSynthesisLengthCap("Write at most 1,000 words.", { maxOutputTokens: 8192, thinking: "model" })).toEqual({ words: 1000, ceilingWords: 1200, briefWordLimit: 1000 });
    expect(researchSynthesisLengthCap("Write at most 12 words.", { maxOutputTokens: 8192, thinking: "model" })).toEqual({ words: 12, ceilingWords: 1200, briefWordLimit: 12 });
    expect(researchSynthesisLengthCap("Write 2,500-6,000 words.", { maxOutputTokens: 8192, thinking: "model" })).toEqual({ words: 1200, ceilingWords: 1200, briefWordLimit: 6000 });
    expect(researchSynthesisLengthCap("Write at most 8,000 words.", { maxOutputTokens: 16384, thinking: "disabled" })).toEqual({ words: 8000, ceilingWords: 12337, briefWordLimit: 8000 });
    // A role cap too small for the floor still names the floor; 7a.2 refuses such a role policy before any request.
    expect(researchSynthesisLengthCap("No limit.", { maxOutputTokens: 1024, thinking: "disabled" })).toEqual({ words: 100, ceilingWords: 0 });
    expect(researchSynthesisLengthCap("No limit.", { maxOutputTokens: 1100, thinking: "model" })).toEqual({ words: 100, ceilingWords: 61 });
  });
  it("counts recorded words as whitespace-separated tokens that hold a letter or a digit", () => {
    expect(researchWordCount("## Heading\nTwo words [E1].\n\n- item 42 — done")).toBe(7);
    expect(researchWordCount("")).toBe(0); expect(researchWordCount(" \n ## -- ")).toBe(0); expect(researchWordCount("Ünïcode wörds 数据")).toBe(3);
  });
});
