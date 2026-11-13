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
      ["capped at 4,000 words", 4000], ["Do not exceed 1,000 words.", 1000], ["It must not exceed 2,000 words.", 2000], ["The report shouldn't exceed 1,500 words.", 1500],
      ["never exceed 900 words", 900], ["1,200 words maximum", 1200], ["800 words max", 800], ["1000 words at most", 1000], ["600 words or fewer", 600],
      ["500 words or less", 500], ["Word limit: 1,500.", 1500], ["word limit of 2000", 2000], ["Word count limit is 2,400.", 2400], ["word limit 900", 900],
      ["Word limit: 2,000-2,500.", 2500], ["word limit 1000 to 1500", 1500],
      ["2,500-6,000 words", 6000], ["2,500\u20136,000 words", 6000], ["1000 to 1500 words", 1500], ["between 800 and 1,200 words", 1200],
      ["Give each question a 2-3 word label; keep the report under 2,000 words.", 2000], ["Keep it under 900 words, not counting references.", 900],
      ["AT MOST 1,000 WORDS", 1000], ["at\nmost\t1,000   words", 1000], ["at most \uff11\uff0c\uff10\uff10\uff10 words", 1000],
    ];
    for (const [brief, limit] of cases) expect([brief, briefWordLimit(brief)]).toEqual([brief, limit]);
  });
  it("lets the largest stated limit win, so a part's limit never shrinks the report's", () => {
    expect(briefWordLimit("Write at most 3,000 words, with an abstract of at most 200 words.")).toBe(3000);
    expect(briefWordLimit("An abstract of up to 150 words, then a report of 1,200-1,800 words.")).toBe(1800);
    expect(briefWordLimit("No more than 900 words. Keep it under 1,500 words.")).toBe(1500);
  });
  it("reads no limit from a minimum or a negated limit, wherever the negation sits in its clause", () => {
    for (const brief of ["Write at least 2,000 words.", "A minimum of 1,000 words.", "more than 500 words", "over 900 words",
      "No fewer than 800 words.", "not fewer than 300 words", "no less than 1,000 words", "Not less than 500 words.", "not under 900 words",
      "nothing less than 900 words", "never fewer than 800 words", "never under 700 words", "It must not be under 1,500 words.", "Do not write under 800 words.",
      "Don't go under 1,000 words.", "Don\u2019t go under 1,000 words.", "Under no circumstances fewer than 1,000 words.", "Fewer than 500 words is not acceptable.",
      "Less than 1,000 words will be rejected.", "Under 600 words is too short.", "You are not limited to 1,000 words.", "It is not capped at 900 words.",
      "You do not need to stay under 1,000 words."]) expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
  });
  it("reads no limit from a part of the report, a compound adjective, a bare or approximate count, or a value below 100 words", () => {
    for (const brief of ["Write 2,500 words; abstract at most 150 words.", "An executive summary of at most 300 words.", "Use headings of 3-5 words.",
      "at most 500 words per section", "Each section at most 400 words.", "a title of at most 120 words", "captions under 200 words",
      "Give each question a 2-3 word label.", "a 5-10 word heading", "a 3\u20135 word title", "2 to 3 word phrases", "at most 3 word tags", "at most 1 word",
      "Include a 500-word abstract.", "a 3,000-word report", "The corpus holds 40,000 words.", "Write about 1,000 words.", "around 800 words", "Write 2,500 words.",
      "at most 12 words", "between 10 and 90 words", "at most 99 words"]) expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
  });
  it("reads no limit from a part named by a heading or a parenthesis, or by a part noun 7b.1 missed (correction BL-20261110-0625, finding F1)", () => {
    // At 5401d0f most of these gave the component's limit as the report's cap; on main every one was asked for 1,200 words.
    for (const brief of ["Abstract: at most 150 words.", "Executive summary: no more than 200 words.", "1. Introduction (at most 200 words)",
      "Answer every question in no more than 200 words.", "Keep quotations to at most 300 words.", "Write a report; limitations section under 300 words.",
      "Abstract (max. 150 words)", "Describe the observations.\n3. Executive summary: no more than 200 words.", "Each section: no more than 300 words.",
      "Each section: at most 400 words.", "Abstract (optional): at most 150 words.", "Conclusion: under 400 words.", "Methods (no more than 500 words)",
      "Background: up to 600 words.", "Appendix (at most 1,000 words)", "Overview: at most 300 words.", "Quotes of at most 200 words each.",
      // The heading runs back to the previous sentence end, across commas and past four words.
      "Abstract, keywords and highlights: at most 150 words.", "Executive summary for the board of directors: no more than 200 words.",
      // An overall length the parser deliberately ignores beside a component's limit: the component's limit must not become the cap.
      "Write 2,500 words. Abstract: at most 150 words.", "Write a 3,000-word report. Executive summary: no more than 200 words.",
      "Write at least 2,500 words. Executive summary: at most 200 words.", "Write about 2,500 words on the topic. Abstract (max 150 words).",
      "Write a 10-page report with an executive summary (max. 250 words).", "Write roughly 4,000 words. Structure: - Summary (up to 300 words)",
      // Section names under a heading, and headings that run past four words or across a number's comma (the code review of c7b6093).
      "Results (max 800 words)", "Discussion: at most 500 words", "Executive summary of the key findings (max. 250 words)", "Summary of 1,000 interviews: at most 200 words"])
      expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
  });
  it("never lets a guard lower the cap: when the guards drop the largest stated limit, no limit is read (the code review of c7b6093)", () => {
    // Each smaller limit names a part no guard recognises; reading it would shrink the argument below the default.
    for (const brief of ["Abstract and summary: at most 3,000 words in total. The literature review should be under 800 words.",
      "You do not need to stay under 5,000 words. The literature review should be under 800 words.",
      "Write at most 3,000 words across all sections. The literature review should be under 800 words.",
      // An exclusion never cancels a distributive: these stay parts' limits.
      "A word limit of 300 including references per chapter.", "At most 400 words without tables for each section", "at most 300 words excluding quotes for every question"])
      expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
    // At c7b6093 these gave 800: the heading reached across lines, or an excluded part noun dropped the report's limit. At 5401d0f, 3,000.
    for (const brief of ["Sections:\n- Abstract\n- Results\nLength: at most 3,000 words\nDiscussion: at most 800 words",
      "The report must not exceed 3,000 words excluding appendices. The literature review should be under 800 words.",
      "Report (excluding the abstract): at most 3,000 words. Discussion: at most 800 words."]) expect([brief, briefWordLimit(brief)]).toEqual([brief, 3000]);
  });
  it("cancels a part noun only after the limit or inside a heading's own exclusion, never in the clause before (the code review of de3adea)", () => {
    // At de3adea an exclusion earlier in the clause cancelled the part the limit belongs to, and these read the part's limit.
    for (const brief of ["Write about 2,500 words on the topic, including a short abstract of under 200 words.",
      "Write a policy brief including an executive summary of no more than 200 words.", "Prepare a report of about 3,000 words, including an abstract of at most 250 words.",
      "Provide a report without appendices and a summary of no more than 300 words.", "Requirements\n- Use peer-reviewed sources, excluding preprints\n- Abstract under 250 words",
      "Executive summary\n(no more than 300 words excluding headings)",
      // An exclusion earlier in a heading ends at its delimiter, and "including" outside a parenthesis cancels nothing.
      "Write a 10-page report including an executive summary (max. 250 words).", "Use all studies except pilot trials, executive summary: no more than 200 words",
      // A line break between a heading and its opener does not empty the heading.
      "Please write a report on the attached observations, with an abstract\n(max. 150 words) and a discussion of the limitations.", "Executive summary\n(no more than 200 words)",
      // Quotes, and the heading-only section names in a short heading.
      "Keep the quotes under 300 words.", "Findings: at most 600 words", "Recommendations (no more than 400 words)", "Limitations: under 300 words"])
      expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
    // Each exclusion word, after the limit or opening a heading's parenthesis, leaves the report's limit; so does a long heading.
    const cases: [string, number][] = [["At most 3,000 words except the appendix.", 3000], ["At most 2,000 words without the methods section.", 2000],
      ["At most 2,500 words including quotations.", 2500], ["Length (including the abstract): at most 3,000 words", 3000], ["Length (incl the abstract): at most 3,000 words", 3000],
      ["Word count (excl references and appendices): 3,000 words max.", 3000], ["Excluding the abstract: at most 3,000 words", 3000],
      ["Provide an overview of the evidence (at most 1,500 words).", 1500],
      // When two candidates share the largest value, one kept candidate is enough.
      ["Abstract: at most 2,000 words. Report: at most 2,000 words.", 2000]];
    for (const [brief, limit] of cases) expect([brief, briefWordLimit(brief)]).toEqual([brief, limit]);
    // Every line break ends a heading: CR, CRLF, LF, the line and paragraph separators, vertical tab and form feed.
    for (const lineBreak of ["\r", "\r\n", "\n", String.fromCharCode(0x2028), String.fromCharCode(0x2029), "\v", "\f"])
      expect([lineBreak, briefWordLimit(`Sections: Abstract, Results${lineBreak}Length: at most 2,000 words`)]).toEqual([lineBreak, 2000]);
  });
  it("rule A: reads no limit from a part named before a comma chain, under a heading opener or after a distributive (BL-20261110-0848)", () => {
    for (const brief of ["Abstract (required, max 150 words)", "Abstract: concise, at most 150 words", "Executive summary: one page, no more than 200 words",
      "Executive summary (one page, no more than 200 words)", "Introduction: set the scene, at most 200 words.", "Conclusion: one paragraph, at most 150 words.",
      "Per source, at most 150 words.", "For each source, write up to 150 words.", "For every study, write at most 150 words.", "For each of the five papers, write no more than 200 words.",
      "Cover five papers; for each, at most 200 words.", "Each section (required, 300-400 words)", "Three sections; each, at most 300 words.",
      // BL-20261110-1100: under a chain's heading opener the heading ends at the opener, however long the chain, and a line break before the opener is skipped.
      "Findings: short, plain, clear, direct, at most 2,000 words", "Background: two or three pages, at most 600 words", "Abstract\n(required, max 150 words)"])
      expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
  });
  it("rule B: reads no limit from a part named in the sentence before a limit that opens its sentence or follows a referring word (BL-20261110-0848)", () => {
    for (const brief of ["Include an abstract. Max 150 words.", "Abstract. At most 150 words.", "Add an abstract.\nMax 150 words.", "Start with an abstract. Keep it under 150 words.",
      "Start with an executive summary. No more than 200 words.", "Include an executive summary. It should be no more than 200 words.",
      "Write a 3,000-word report. Include an executive summary. Keep it under 200 words.", "End with a conclusion. Keep it to at most 150 words.", "Include an abstract. (Max 150 words.)",
      "Each source gets a note. Max 120 words.", "Please include an abstract. It must not exceed 250 words.", "There should be a short introduction. No more than 150 words there. The rest is up to you.",
      "Add a methods note at the end.\nMaximum 300 words.\n\nThe main report has no length limit.",
      "Write me a report on the competitor pricing documents. Aim for about 1,500 words. Start with an executive summary; keep that to under 150 words.",
      "Write the full report. Then write the summary. Under 200 words for that.",
      "Deliverable 1, the evidence report. No word limit, but be concise.\nDeliverable 2, a summary for the newsletter. No more than 300 words.",
      "Compare the three vendors' pricing. Begin with an executive summary. It must not exceed 250 words. Then give a detailed analysis.",
      "Requirements:\n- Include an abstract. Maximum 200 words.\n- Cite every source.", "Abstract; at most 150 words", "Abstract (structured; max 150 words)",
      "Deliverable 1 \u2014 Evidence report. No word limit, but be concise.\nDeliverable 2 \u2014 Summary for the newsletter. No more than 300 words.",
      // BL-20261110-1100: a referring word cut into the limit's word, each of the nine referring words, a referring word before a comma or a parenthesis, a part
      // after an exclusion word (rule B counts it), and a limit that opens its line after a wrapped heading or distributive.
      "Include an abstract. Keep it\u2014at most 150 words.", "Include an abstract. Its length is at most 150 words.", "Start with an executive summary. Its length must not exceed 200 words.",
      "Add two captions. Keep these under 150 words.", "Write section summaries. These must not exceed 150 words.", "Write the section headings. Keep those to at most 120 words.",
      "Add captions. Keep those under 150 words.", "Add captions. They must not exceed 150 words.", "Add captions. Keep them under 150 words.", "Include captions. Keep them under 150 words.",
      "Open with an abstract. There, use at most 150 words.", "Include an abstract. There, use at most 150 words.", "Include an abstract. Keep it short, under 200 words",
      "Start with an executive summary. It is for the board (at most 200 words).", "Without delay write an abstract. Max 150 words.", "Per source,\nat most 150 words.",
      "Abstract (required,\nmax 150 words)"])
      expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
  });
  it("still reads the report's limit beside rules A and B: their positive controls", () => {
    const cases: [string, number][] = [["Write a report on X. Max 2,000 words.", 2000], ["Summarize the paper. Keep it under 500 words.", 500], ["Compare A and B. No more than 900 words.", 900],
      ["Write a report of at most 3,000 words. Include an executive summary. Keep it under 200 words.", 3000], ["An abstract of up to 150 words, then a report of 1,200-1,800 words.", 1800],
      ["Write a report on the attached sources. It must not exceed 1,000 words.", 1000], ["Include an abstract. The report must not exceed 2,000 words.", 2000],
      ["Write a report. Include an abstract. Word limit: 2,000.", 2000], ["Write a report. It must not exceed 2,000 words.", 2000], ["Report: concise, at most 2,000 words", 2000],
      ["Give each question a 2-3 word label; keep the report under 2,000 words.", 2000],
      // A comma chain's heading opener counts only on the limit's own line.
      ["Sections:\nbe concise, at most 2,000 words", 2000],
      // BL-20261110-1100: rule A reads distributives only from the chain's opener, on the limit's line; rule B reads only the one sentence before, which a line
      // break bounds too; a cut word that is not a referring word does not open the sentence; and a headed chain's words are not heading words.
      ["Cover each vendor,\nthen be brief, at most 2,000 words", 2000], ["Cite every source,\nbe concise, at most 2,000 words", 2000], ["Cite every source. Report: concise, at most 2,000 words", 2000],
      ["Cite every source; be concise, at most 2,000 words.", 2000], ["Answer each question. Overall, at most 2,000 words", 2000], ["Include an abstract. Report\u2014max 2,000 words.", 2000],
      ["Include an abstract\nin the report. Max 2,000 words.", 2000], ["Include an abstract. Cite the sources. Max 2,000 words.", 2000], ["Include an abstract. Write a report. Max 2,000 words.", 2000],
      ["Each source is a PDF\nWrite a report on them.\nMax 2,000 words.", 2000], ["Report: include an abstract, at most 2,000 words", 2000]];
    for (const [brief, limit] of cases) expect([brief, briefWordLimit(brief)]).toEqual([brief, limit]);
  });
  it("misses these report limits under rules A and B, as the parse prefers (new known misses)", () => {
    for (const brief of ["Cite every source, and keep the report under 2,000 words.", "Write a report with an abstract. Max 2,000 words.", "Write a summary of the paper. Max 300 words.",
      "Answer every question. Keep it under 900 words.", "Write the report. Do not include an abstract. Keep it under 800 words.", "I need a summary of the audit findings for the board. Max 500 words.",
      "Give each question a 2-3 word label, and keep the report under 2,000 words.", "Write the following sections: introduction, body, and a conclusion, at most 3,000 words in total.",
      "Include an abstract. This report must not exceed 2,000 words.", "Write the abstract first. (At most 2,000 words.)",
      // BL-20261110-1100: an exclusion cancels nothing in the sentence before; list words and distributives are read in any sense, a title line among them; and a
      // short heading-only noun opens a one-line comma chain. These are examples of what rules A and B miss, not the full set.
      "Write a report without an abstract. Max 2,000 words.", "Research report\nTitle: The economics of vertical farming.\nUnder 2,500 words.",
      "Background: the board meets on Friday, so I need a report on supplier risk, max 1,500 words.", "Read every source. Then write a report that is under 2,000 words."])
      expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
  });
  it("still misreads these part limits after rules A and B (known misreads, stated in BL-20261110-0848 and BL-20261110-1100)", () => {
    const cases: [string, number][] = [["Abstract, at most 150 words", 150], ["For the abstract, use at most 150 words.", 150], ["- Abstract, 150 words max", 150],
      ["Max 120 words. That is for the summary.", 120], ["Include an executive summary, and keep it under 200 words.", 200],
      // Heading-only nouns outside ":" or "(", nouns glued by "/" or an apostrophe, off-list nouns, and a part more than four words after the limit.
      ["## Results\nUp to 600 words.", 600], ["Keep the discussion under 400 words.", 400], ["Abstract/summary: at most 150 words", 150], ["The abstract's length: at most 150 words", 150], ["'Abstract' (max 150 words)", 150],
      ["Keep the intro under 300 words.", 300], ["TL;DR: at most 120 words.", 120], ["Methodology: at most 400 words", 400], ["Key takeaways: at most 200 words", 200],
      ["Keep the literature review under 800 words.", 800], ["At most 300 words in the very last conclusion.", 300],
      // A one-line comma list of parts, an exclusion that cancels every part noun in its heading, and the part in a parenthesis after the limit.
      ["Overview (max 200 words), findings (max 800 words), recommendations (max 400 words).", 800], ["Write a report without jargon and an abstract (max. 150 words).", 150],
      ["At most 150 words (abstract).", 150],
      // A floor stated by its consequence or as a range, a limit of another document, and a companion deliverable.
      ["Reports under 1,000 words will be penalised.", 1000], ["Write at least 800 to 1,000 words.", 1000],
      ["For context, the previous consultant's report was capped at 500 words and missed half the issues. Yours should be thorough.", 500],
      ["Full report please, plus a press release of no more than 400 words.", 400],
      // Before #69: a digit on the next line makes a range read as its lower end (NUMBER's lookahead); noted for a later PR.
      ["Word limit: 600-900\n3 sources minimum", 600],
      // BL-20261110-1100, the forms rules A and B leave. A distributive in a later clause of the chain, and the "word limit N" exemption after a part:
      ["At most 150 words, each.", 150], ["Notes: brief, at most 150 words, for each source.", 150],
      ["Include an abstract. Word limit: 150.", 150], ["Start with an executive summary. Its word limit is 200.", 200], ["Abstract (optional; word limit 150)", 150],
      // a wrapped line (rule A reads only the limit's line; rule B ends a sentence at a line break):
      ["For each source,\nwrite up to 150 words.", 150], ["Abstract:\nconcise, at most 150 words", 150], ["Start with an abstract. Keep it\nunder 150 words.", 150],
      // a limit that neither opens its sentence nor follows a referring word: a lead-in word, a quote glued to the limit, or a list marker, which is a sentence of its own:
      ["Include an abstract. Please stay under 150 words.", 150], ["Include an abstract. Aim for under 150 words.", 150], ["Include an abstract. Length: max 150 words.", 150],
      ["Include an abstract. \u2019Max 150 words\u2019", 150], ["1. Include an abstract.\n2. Max 150 words.", 150],
      // a part two or more sentences back:
      ["Include an abstract. Make it punchy. Max 150 words.", 150], ["Include an abstract. Please. Max 150 words.", 150], ["I'd like an executive summary as well. Nothing long; a maximum of 250 words.", 250],
      // an abbreviation's period or a parenthesis between the part and the limit, and a chain anchored at ")":
      ["Each source (approx. 1 page, 400 words max)", 400], ["Include an abstract (approx. half a page). Max 150 words.", 150], ["For each source (a paper), write up to 150 words.", 150],
      ["Abstract (required), max 150 words", 150]];
    for (const [brief, limit] of cases) expect([brief, briefWordLimit(brief)]).toEqual([brief, limit]);
    // Report limits still missed on line-structured briefs, with an exclusion off the list, and in phrasings no pattern matches.
    for (const brief of ["Sections: three\nAt most 900 words", "Word limit (not including the abstract): at most 900 words", "Maximum length: 1,500 words.", "No longer than 1,000 words."])
      expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
  });
  it("pins each rule no test isolated at 5e16e20 or 848524e (the delta reviews' surviving mutants)", () => {
    const cases: [string, number | undefined][] = [["Length (excluding limitations): at most 2,000 words", 2000], ["Write the abstract first. (Overall at most 2,000 words.)", 2000],
      ["Abstract/max 150 words", undefined], ["Each of the following (max 200 words)", undefined], ["Abstract-max 150 words", undefined], ["each\u2014at most 150 words", undefined],
      ["not-at most 500 words", undefined], ["At most 500 words/section", undefined], ["Each source: at most 150 words", undefined], ["Background and prior work: up to 600 words", undefined],
      ["Limit (excluding findings): at most 900 words", 900], ["The abstract should be written in at most 150 words", undefined],
      // Two rules only the protocol pin caught: the four-word bound on heading-only nouns, and "incl" cancelling only when it opens a parenthesis.
      ["Give the evidence an overview (at most 1,500 words)", 1500], ["Write a report incl an abstract: at most 150 words", undefined],
      // BL-20261110-1100: both cut-word halves of rule B's trigger, and no look-back when no word precedes the limit's sentence (the look-back would throw).
      ["Include an abstract. Total/max 2,000 words", 2000], ["Include an abstract. It/max 150 words", undefined], ["?\nMax 2,000 words", 2000], ["...Max 2,000 words", 2000],
      ["---\nKeep it under 2,000 words.", 2000]];
    for (const [brief, limit] of cases) expect([brief, briefWordLimit(brief)]).toEqual([brief, limit]);
  });
  it("misses, rather than misreads, a report limit that sits beside a part noun", () => {
    // Known misses: the default applies (and while the role thinks, 1,200 words binds below these limits anyway).
    for (const brief of ["The report should be at most 3,000 words across all sections.", "Write at most 2,000 words and cite every source.",
      // An abbreviation's dot ends the heading, and a line break inside the heading's parenthesis ends it there.
      "Word count (excl. references and appendices): 3,000 words max.", "Report (excluding the\nabstract): at most 3,000 words",
      // After the limit, 7b.1's own part nouns still drop it whatever precedes them, as at 5401d0f.
      "At most 2,500 words including the abstract.", "At most 2,000 words without the summary."])
      expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
  });
  it("still reads a heading or a parenthesis that names the report itself, and a report limit beside a part's", () => {
    const cases: [string, number][] = [["Report: at most 2,000 words.", 2000], ["Length: at most 2,000 words.", 2000], ["Requirements: no more than 1,000 words.", 1000],
      ["Report (2,000 words max)", 2000], ["Report (at most 800 words)", 800], ["2. Limit: at most 1,500 words.", 1500], ["At most 2,000 words (excluding the abstract).", 2000],
      ["An executive summary (max 200 words) and a full report of up to 3,000 words.", 3000], ["Summary (max 200 words); report: at most 3,000 words.", 3000],
      // Question, reference and footnote are no part nouns: these limits are the report's.
      ["Answer the research question in at most 1,000 words.", 1000], ["Keep it under 900 words excluding references.", 900], ["At most 1,500 words, footnotes included.", 1500],
      // Exclusions, line breaks and nouns that name a part only in a heading (the code review of c7b6093).
      ["Word count (excluding references and appendices): 3,000 words max.", 3000], ["Word limit (excluding the abstract): at most 2,000 words.", 2000],
      ["Format: a report with sections\nLength: at most 2,000 words", 2000], ["1) Background\n2) Report: at most 2,000 words", 2000], ["Keep it under 3,000 words excluding appendices.", 3000],
      ["Provide an overview of the evidence in at most 1,500 words.", 1500], ["Give a background briefing on the policy in no more than 1,000 words.", 1000]];
    for (const [brief, limit] of cases) expect([brief, briefWordLimit(brief)]).toEqual([brief, limit]);
  });
  it("reads no limit from other units, out-of-range, malformed, decimal or grouped numbers, or a reversed range", () => {
    for (const brief of ["at most 12 sources", "up to 10 pages", "at most 0 words", "at most 100,001 words", "", "Describe the supplied synthetic observations and their limitations.",
      "6,000-2,500 words", "between 900 and 400 words", "1,00 words at most", "Word limit: 1.500.", "word limit 2.000 words", "1.200 words max", "1,50 words at most",
      "word count limit is 3.5k", "up to 12.5 words", "Word limit: 2.500", "Word limit: 2.5k", "Word limit: 2 500", "Word limit: 2\u00a0500", "2 500 words max",
      "Section 3.200 words or fewer", "word limit: 2,500-2,000"]) expect([brief, briefWordLimit(brief)]).toEqual([brief, undefined]);
  });
  it("parses a 32 KiB adversarial brief in linear time, including one clause of thousands of candidates (correction BL-20261110-0625, finding F2)", () => {
    // The last three took 3.1 to 3.6 s at 5401d0f, which rescanned the clause for every candidate.
    const oneClause = ["150 words max ", "at most 150 words ", "no more than 150 words "].map(unit => unit.repeat(Math.floor(32760 / unit.length)));
    // One long word of punctuation or emoji: 7b.1's two-sided strip backtracked quadratically on it (1.8 to 6.5 s at c7b6093;
    // the one-clause inputs above took 1 to 4 s at 5401d0f).
    oneClause.push(`a${"-".repeat(32766)}b`, `a${String.fromCodePoint(0x1f600).repeat(16382)}b`);
    // Rules A and B: one long comma chain, thousands of sentences, and thousands of referring words before one limit.
    oneClause.push(`${"abstract, ".repeat(3276)}at most 150 words`, "Include an abstract. Max 150 words. ".repeat(910), `${"it ".repeat(10922)}max 150 words`, "For each source, at most 150 words. ".repeat(910));
    for (const brief of ["111,".repeat(8192), `between ${"111,".repeat(8190)}`, "\uff11\uff11\uff11\uff0c".repeat(8192), "at most ".repeat(4096), "words ".repeat(5461), ...oneClause]) {
      const started = performance.now(); briefWordLimit(brief); expect(performance.now() - started).toBeLessThan(1000);
    }
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
    // A stated limit wins below the ceiling and is clamped above it; a range's lower end is not used (the cap is an upper bound).
    expect(researchSynthesisLengthCap("Write at most 1,000 words.", { maxOutputTokens: 8192, thinking: "model" })).toEqual({ words: 1000, ceilingWords: 1200, briefWordLimit: 1000 });
    expect(researchSynthesisLengthCap("Write at most 150 words.", { maxOutputTokens: 8192, thinking: "model" })).toEqual({ words: 150, ceilingWords: 1200, briefWordLimit: 150 });
    expect(researchSynthesisLengthCap("Write 2,500-6,000 words.", { maxOutputTokens: 8192, thinking: "model" })).toEqual({ words: 1200, ceilingWords: 1200, briefWordLimit: 6000 });
    expect(researchSynthesisLengthCap("Write at most 8,000 words.", { maxOutputTokens: 16384, thinking: "disabled" })).toEqual({ words: 8000, ceilingWords: 12337, briefWordLimit: 8000 });
    // A value below the 100-word floor is a part's length, never the argument's: the default applies.
    expect(researchSynthesisLengthCap("Write at most 12 words.", { maxOutputTokens: 8192, thinking: "model" })).toEqual({ words: 1200, ceilingWords: 1200 });
    // A role cap too small for the floor still names the floor; 7a.2 refuses such a role policy before any request.
    expect(researchSynthesisLengthCap("No limit.", { maxOutputTokens: 1024, thinking: "disabled" })).toEqual({ words: 100, ceilingWords: 0 });
    expect(researchSynthesisLengthCap("No limit.", { maxOutputTokens: 1100, thinking: "model" })).toEqual({ words: 100, ceilingWords: 61 });
  });
  it("counts recorded words as whitespace-separated tokens that hold a letter or a digit", () => {
    expect(researchWordCount("## Heading\nTwo words [E1].\n\n- item 42 \u2014 done")).toBe(7);
    expect(researchWordCount("")).toBe(0); expect(researchWordCount(" \n ## -- ")).toBe(0); expect(researchWordCount("\u00dcn\u00efcode w\u00f6rds \u6570\u636e")).toBe(3);
  });
});
