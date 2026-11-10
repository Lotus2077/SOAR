import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEW_FLAGS_PY, documentReviewApplierFile } from "../../src/main/private-agent/document-review";
import { DOCUMENT_REVIEW_FLAG_CODES, DOCUMENT_REVIEW_FLAG_COUNTS, DOCUMENT_REVIEW_FLAG_LIST_MAX, DOCUMENT_REVIEW_FLAG_READ_CAPS, DOCUMENT_REVIEW_FLAG_RULES,
  DOCUMENT_REVIEW_FLAG_UNITS, DOCUMENT_REVIEW_FLAG_VALUES_MAX, DOCUMENT_REVIEW_FLAGS_VERSION, DocumentReviewFlagsSchema } from "../../src/main/private-agent/document-review-flags";

type Unit = { kind: "prose" } | { kind: "cell"; table: number; row: number; col: number };
type Edit = { id: string; action: "replace" | "delete" | "insert_after" | "comment"; paragraph: number; start: number; end: number; newText?: string };
type Options = { args?: string[]; env?: NodeJS.ProcessEnv; cwd?: string; prelude?: string };
/** The rules exactly as the applier calls them and with the bytes it writes; a prelude may replace one of the literal's functions first. */
const driver = (prelude = "") => `${REVIEW_FLAGS_PY}\nimport sys\n${prelude}\nargs = json.loads(sys.stdin.buffer.read().decode("utf-8"))\n` +
  `sys.stdout.buffer.write(review_flags_json(review_flags_or_error(lambda: (args["units"], args["source"], args["clean"], args["edits"]))))\n`;
const sortKeysDeep = (value: unknown): unknown => Array.isArray(value) ? value.map(sortKeysDeep) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeysDeep((value as Record<string, unknown>)[key])])) : value;
/** The rules under python3 -I on synthetic paragraphs; every record must be the exact bytes JSON.stringify writes and must pass the schema. */
function flags(units: Unit[], source: string[], clean: string[] = source, edits: Edit[] = [], options: Options = {}) {
  const bytes = execFileSync("python3", [...(options.args ?? ["-I"]), "-c", driver(options.prelude)], { input: Buffer.from(JSON.stringify({ units, source, clean, edits }), "utf8"),
    ...(options.env ? { env: options.env } : {}), ...(options.cwd ? { cwd: options.cwd } : {}), timeout: 60_000 });
  const raw: unknown = JSON.parse(bytes.toString("utf8"));
  // Sorted keys, indent 1 and a trailing newline: the bytes are exactly what JSON.stringify writes for the same value.
  expect(bytes.toString("utf8")).toBe(`${JSON.stringify(sortKeysDeep(raw), null, 1)}\n`);
  return { bytes, value: DocumentReviewFlagsSchema.parse(raw) };
}
const python = (code: string, input = "") => execFileSync("python3", ["-I", "-c", code], { input, timeout: 60_000 }).toString("utf8").trim();
const prose = (n: number): Unit[] => Array.from({ length: n }, () => ({ kind: "prose" as const }));
const cell = (table: number, row: number, col: number): Unit => ({ kind: "cell", table, row, col });
/** Three letters for i, so labels stay letter-only ("aaa", "baa", ...). */
const word = (i: number) => Array.from({ length: 3 }, (_, k) => String.fromCharCode(97 + Math.floor(i / 26 ** k) % 26)).join("");
/** A header row and one fee row, then the given prose paragraphs (numbered from 5). */
const feeTable = (label: string, value: string, header = "Fee (USD)") => ({ units: [cell(1, 1, 1), cell(1, 1, 2), cell(1, 2, 1), cell(1, 2, 2)], texts: ["Item", header, label, value] });
/** A header row and the given rows of one two-column table; the first prose paragraph is numbered 2 * rows + 3. */
const table = (rows: [string, string][], header = "Fee (USD)", number = 1) => ({
  units: [cell(number, 1, 1), cell(number, 1, 2), ...rows.flatMap((_, i) => [cell(number, i + 2, 1), cell(number, i + 2, 2)])], texts: ["Item", header, ...rows.flat()] });
/** N1 on one sentence against the base row "Late payment fee" | 50 under "Fee (USD)", unless the row says otherwise. */
const n1 = (sentence: string, row: { label?: string; value?: string; header?: string } = {}) => {
  const t = feeTable(row.label ?? "Late payment fee", row.value ?? "50", row.header);
  return flags([...t.units, ...prose(1)], [...t.texts, sentence]).value.numeric;
};
/** C1 on one edit of paragraph 1, its offsets found by its anchor (the occurrence-th one); the clean text applies it. */
const c1 = (text: string, anchor: string, newText: string, action: Edit["action"] = "replace", extra: string[] = [], occurrence = 0) => {
  let start = -1;
  for (let k = 0; k <= occurrence; k++) start = text.indexOf(anchor, start + 1);
  if (start < 0) throw new Error(`no anchor ${anchor}`);
  const end = start + anchor.length;
  const after = action === "replace" ? text.slice(0, start) + newText + text.slice(end) : action === "delete" ? text.slice(0, start) + text.slice(end)
    : action === "insert_after" ? text.slice(0, end) + newText + text.slice(end) : text;
  return flags(prose(1 + extra.length), [text, ...extra], [after, ...extra], [{ id: "E1", action, paragraph: 1, start, end, newText: action === "replace" || action === "insert_after" ? newText : "" }]).value;
};
const comment = (id: string, paragraph: number): Edit => ({ id, action: "comment", paragraph, start: 0, end: 3, newText: "" });
const c2 = (sentences: string[]) => flags(prose(sentences.length), sentences).value;
/** Two clauses a negation apart, distinguished by their last word. */
const contradiction = (name: string) => [`The Supplier shall deliver the goods to depot ${name}.`, `The Supplier shall not deliver the goods to depot ${name}.`];
const LIABLE = "The Supplier shall be liable for loss of data caused by negligence.", NOT_LIABLE = "The Supplier shall not be liable for loss of data caused by negligence.";

describe("backlog item 7(d): the applier's host flags, rules v1 (BL-20261109-0354)", { timeout: 60_000 }, () => {
  describe("N1, a table against the prose", () => {
    it("flags a prose figure in the row's unit that equals none of the row's values, with the values on each side", () => {
      const t = feeTable("Late payment fee", "50");
      const { value } = flags([...t.units, ...prose(1)], [...t.texts, "The late payment fee is $75 per invoice."]);
      expect(value.numeric.flags).toEqual([{ table: 1, row: 2, paragraph: 5, inSource: true, inClean: true, addressedBy: [],
        source: { row: ["50 USD"], prose: ["75 USD"] }, clean: { row: ["50 USD"], prose: ["75 USD"] } }]);
      expect(value.counts).toMatchObject({ numericSource: 1, numericUnaddressed: 1, numericIntroduced: 0, numericResolved: 0 });
    });
    it("leaves equal values, another unit, an absent label, a plural label and a scale word alone", () => {
      for (const sentence of ["The late payment fee is USD 50.00 per invoice.", "The late payment fee applies after 30 days.", "A fee of $75 applies to returns.",
        "The late payment fees are $75.", "The late payment fee is USD 1.5 million."]) expect(n1(sentence).flags, sentence).toEqual([]);
    });
    it("never reads a label with a digit or with fewer than four letters", () => {
      expect(n1("The late fee 2 is $75.", { label: "Late fee 2" }).flags).toEqual([]);
      expect(n1("The fee is $75.", { label: "Fee" }).flags).toEqual([]);
      // The control: the same shapes with a qualifying label are flagged.
      expect(n1("The late fee is $75.", { label: "Late fee" }).flags).toHaveLength(1);
    });
    it("reads a bare cell number in its header's single unit, and ignores it under a header with none, two or a scale", () => {
      expect(n1("The notice period is 45 days.", { label: "Notice period", value: "30", header: "Days" }).flags).toHaveLength(1);
      for (const header of ["Value", "Fee (USD) or days", "Days (thousands)"]) {
        for (const sentence of ["The notice period is 45 days.", "The notice period is $45."]) {
          expect(n1(sentence, { label: "Notice period", value: "30", header }).flags, `${header}: ${sentence}`).toEqual([]);
        }
      }
    });
    it("never reads a reference, a dotted clause number, a list marker or a bare year as a quantity, but reads a year-like amount", () => {
      expect(n1("The notice period is set out in section 30 days after signing.", { label: "Notice period", value: "10", header: "Days" }).flags).toEqual([]);
      expect(n1("The notice period is set out in \u00a7 30 days after signing.", { label: "Notice period", value: "10", header: "Days" }).flags).toEqual([]);
      expect(n1("The interest rate in clause 4.2.5 % applies.", { label: "Interest rate", value: "5", header: "Rate (%)" }).flags).toEqual([]);
      // The cell's list marker "1." is not a value, so the prose's $1 contradicts the row's 50.
      expect(n1("The late payment fee is $1.", { value: "1. 50" }).flags.map(flag => flag.source)).toEqual([{ row: ["50 USD"], prose: ["1 USD"] }]);
      expect(n1("The renewal term is 2 years.", { label: "Renewal term", value: "2025", header: "Year" }).flags).toEqual([]);
      expect(n1("The late payment fee is $2,500.", { value: "2000" }).flags.map(flag => flag.source)).toEqual([{ row: ["2000 USD"], prose: ["2500 USD"] }]);
    });
    it("reads only the longest label a sentence names, as a whole token phrase, so rent is not hidden by a parent company guarantee", () => {
      const fees = table([["Late fee", "50"], ["Late fee cap", "500"]]);
      expect(flags([...fees.units, ...prose(1)], [...fees.texts, "The late fee cap is $500."]).value.numeric.flags).toEqual([]);
      const rent = table([["Rent", "1000"], ["Parent company guarantee", "500"]]);
      const { value } = flags([...rent.units, ...prose(1)], [...rent.texts, "The rent is $900 and the parent company guarantee is $500."]);
      expect(value.numeric.flags.map(flag => [flag.row, flag.source])).toEqual([[2, { row: ["1000 USD"], prose: ["500 USD", "900 USD"] }]]);
    });
    it("reads a label of at most 200 characters and 16 tokens", () => {
      const pad = (n: number) => `Late payment fee ${"x".repeat(n - 17)}`;
      expect(n1(`The ${pad(200).toLowerCase()} is $75.`, { label: pad(200) }).flags).toHaveLength(1);
      expect(n1(`The ${pad(201).toLowerCase()} is $75.`, { label: pad(201) }).flags).toEqual([]);
      const tokens = (n: number) => "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec".split(" ").slice(0, n).join(" ");
      expect(n1(`The ${tokens(16)} is $75.`, { label: tokens(16) }).flags).toHaveLength(1);
      expect(n1(`The ${tokens(17)} is $75.`, { label: tokens(17) }).flags).toEqual([]);
    });
    it("strips a label's surrounding colons, points, hyphens and asterisks", () => {
      expect(n1("The late payment fee is $75.", { label: "Late payment fee:" }).flags).toHaveLength(1);
      expect(n1("The late payment fee is $75.", { label: "* Late payment fee. -" }).flags).toHaveLength(1);
    });
    it("matches a label's word tokens whatever the spacing, but not across other punctuation", () => {
      expect(n1("The late  payment\tfee is $75.").flags).toHaveLength(1);
      expect(n1("The late-payment fee is $75.").flags).toEqual([]);
      expect(n1("The late-payment fee is $75.", { label: "Late-payment fee" }).flags).toHaveLength(1);
      expect(n1("The late payment fee is $75.", { label: "Late-payment fee" }).flags).toEqual([]);
    });
    it("clears a sentence when any of its figures in the row's unit equals a row value, even the fifth", () => {
      expect(n1("The late payment fee is $50 or $75.").flags).toEqual([]);
      expect(n1("The late payment fee is $10, $20, $30, $40 or $50.").flags).toEqual([]);
    });
    it("keeps the 4 smallest values on each side, by unit and then amount as Decimal, across the paragraph's sentences", () => {
      expect(n1("The late payment fee is $75 and $80.").flags[0]?.source?.prose).toEqual(["75 USD", "80 USD"]);
      expect(n1("The late payment fee is $10 or $9.").flags[0]?.source?.prose).toEqual(["9 USD", "10 USD"]);
      expect(n1("The late payment fee is $95, $90, $85, $80 or $65. The late payment fee is $70 or $60.").flags[0]?.source?.prose).toEqual(["60 USD", "65 USD", "70 USD", "80 USD"]);
      expect(n1("The late payment fee is $75.", { value: "40, 30, 20, 10, 5" }).flags[0]?.source?.row).toEqual(["5 USD", "10 USD", "20 USD", "30 USD"]);
      const units: Unit[] = [cell(1, 1, 1), cell(1, 1, 2), cell(1, 1, 3), cell(1, 2, 1), cell(1, 2, 2), cell(1, 2, 3), ...prose(2)];
      const { value } = flags(units, ["Item", "Fee (USD)", "Rate (%)", "Late payment fee", "50", "60", "The late payment fee is $75 and 7%.",
        "The late payment fee is $75, $76, $77, $78, 7% and 8%."]);
      expect(value.numeric.flags.map(flag => flag.source)).toEqual([{ row: ["60 %", "50 USD"], prose: ["7 %", "75 USD"] }, { row: ["60 %", "50 USD"], prose: ["7 %", "8 %", "75 USD", "76 USD"] }]);
    });
    it("never reads a number word in the label cell as one of the row's values", () => {
      expect(n1("The five day notice is $40.", { label: "Five day notice", value: "30" }).flags.map(flag => flag.source)).toEqual([{ row: ["30 USD"], prose: ["40 USD"] }]);
    });
    it("reads only prose paragraphs: a cell of a second table is not prose", () => {
      const t = feeTable("Late payment fee", "50");
      expect(flags([...t.units, cell(2, 1, 1)], [...t.texts, "The late payment fee is $75."]).value.numeric.flags).toEqual([]);
    });
    it("records a flag the plan resolved, one it introduced and the edits that touched each", () => {
      const t = feeTable("Late payment fee", "$50"), units = [...t.units, ...prose(2)];
      const source = [...t.texts, "The late payment fee is $75.", "The late payment fee is $50."];
      const clean = [...t.texts, "The late payment fee is $50.", "The late payment fee is $60."];
      const { value } = flags(units, source, clean, [{ id: "E1", action: "replace", paragraph: 5, start: 25, end: 27, newText: "50" },
        { id: "E2", action: "replace", paragraph: 6, start: 25, end: 27, newText: "60" }]);
      expect(value.numeric.flags.map(f => [f.paragraph, f.inSource, f.inClean, f.addressedBy])).toEqual([[5, true, false, ["E1"]], [6, false, true, ["E2"]]]);
      expect(value.counts).toMatchObject({ numericSource: 1, numericResolved: 1, numericIntroduced: 1, numericUnaddressed: 0 });
    });
    it("counts a comment on the row's value cell or label cell as addressing the flag", () => {
      const t = feeTable("Late payment fee", "50");
      for (const paragraph of [4, 3]) {
        const { value } = flags([...t.units, ...prose(1)], [...t.texts, "The late payment fee is $75."], undefined, [comment("E1", paragraph)]);
        expect(value.numeric.flags.map(flag => flag.addressedBy)).toEqual([["E1"]]);
        expect(value.counts).toMatchObject({ numericSource: 1, numericUnaddressed: 0 });
      }
    });
    it("reads the clean text against the clean table", () => {
      const t = feeTable("Late payment fee", "50"), sentences = ["The late payment fee is $75.", "The late payment fee is $60."];
      const { value } = flags([...t.units, ...prose(2)], [...t.texts, ...sentences], ["Item", "Fee (USD)", "Late payment fee", "75", ...sentences],
        [{ id: "E1", action: "replace", paragraph: 4, start: 0, end: 2, newText: "75" }]);
      expect(value.numeric.flags).toEqual([
        { table: 1, row: 2, paragraph: 5, inSource: true, inClean: false, addressedBy: ["E1"], source: { row: ["50 USD"], prose: ["75 USD"] }, clean: null },
        { table: 1, row: 2, paragraph: 6, inSource: true, inClean: true, addressedBy: ["E1"], source: { row: ["50 USD"], prose: ["60 USD"] }, clean: { row: ["75 USD"], prose: ["60 USD"] } }]);
      expect(value.counts).toMatchObject({ numericSource: 2, numericResolved: 1, numericIntroduced: 0, numericUnaddressed: 0 });
    });
  });

  describe("N1's number grammar (the base row is Late payment fee | 50 under Fee (USD), unless a case says otherwise)", () => {
    const days = { label: "Notice period", header: "Days" };
    const cases: [string, string, string[] | null, { label?: string; value?: string; header?: string }?][] = [
      ["a comma before a digit is not a thousands separator", "The late payment fee is EUR 1,50.", null, { header: "Fee (EUR)" }],
      ["a comma after a number ends it", "The late payment fee is USD 5,000, payable monthly.", ["5000 USD"]],
      ["16 digits are not read", "The late payment fee is $1234567890123456.", null],
      ["16 digits with thousands commas are not read", "The late payment fee is USD 1,000,000,000,000,000.", null],
      ["7 decimals are not read", "The late payment fee is $1.1234567.", null],
      ["thousands commas", "The late payment fee is USD 5,000.", ["5000 USD"]],
      ["a pound sign is GBP", "The late payment fee is \u00a375.", ["75 GBP"], { header: "Fee (GBP)" }],
      ["US$ is USD", "The late payment fee is US$75.", ["75 USD"]],
      ["a number right after a comma is not read", "The notice period is 1,50 days.", null, { ...days, value: "30" }],
      ["working days are business days", "The notice period is 15 working days.", ["15 business day"], { label: "Notice period", value: "10", header: "Notice (business days)" }],
      ["percent is %", "The interest rate is 7 percent.", ["7 %"], { label: "Interest rate", value: "5", header: "Rate (%)" }],
      ["a word restatement is skipped", "The notice period is 45 (forty-five) days.", ["45 day"], { ...days, value: "30" }],
      ["a parenthesized digit restatement is read", "The notice period is one hundred and twenty (120) days.", ["120 day"], { ...days, value: "90" }],
      ["a range gives its low end", "The notice period is 30-45 days.", null, { ...days, value: "30" }],
      ["a range gives its high end", "The notice period is 15-30 days.", null, { ...days, value: "30" }],
      ["a compound number word", "The notice period is forty-five days.", ["45 day"], { ...days, value: "30" }],
      ["no number word after 'and'", "The notice period is one hundred and twenty days.", null, { ...days, value: "120" }],
      ["no number word after 'hundred'", "The notice period is one hundred twenty days.", null, { ...days, value: "120" }],
      ["a number word's value", "The notice period is five days.", null, { ...days, value: "5" }],
      ["a scale letter after a figure", "The late payment fee is $5k.", null],
      ["a scale word after a range makes both ends unread", "The late payment fee is USD 5-10 million.", null],
      ["a header naming two units", "The notice period is $45.", null, { label: "Notice period", value: "30", header: "Fee (USD) or days" }],
      ["a currency sign in a header", "The late payment fee is $75.", ["75 USD"], { header: "Fee ($)" }],
      ["NFKC: fullwidth digits", "The late payment fee is $\uff17\uff15.", ["75 USD"]],
      ["whitespace inside a quantity collapses", "The late payment fee is USD  75.", ["75 USD"]],
      ["a sentence breaks before a digit", "The late payment fee is $75. 1 deposit of $50 applies.", ["75 USD"]],
      ["a sentence breaks after a question mark", "Is the late payment fee $75? The deposit is $50.", ["75 USD"]],
      ["a fraction character is not read", "The notice period is \u00bd day.", null, { ...days, value: "30" }],
      ["a slashed fraction is not read", "The notice period is 1/2 day.", null, { ...days, value: "30" }],
      ["a figure before a slash is not read", "The late payment fee is $1/2.", null],
      ["a figure before a fraction slash is not read", "The late payment fee is $\u00bd.", null],
      ["a currency right after a slash is not read", "The late payment fee is 1/$75.", null],
      ["a range's low end after a slash is not read", "The notice period is 1/2-3 days.", ["3 day"], { ...days, value: "2" }],
      ["a dotless i leaves a unit unread without an error", "The response time is 30 m\u0131nutes.", null, { label: "Response time", value: "20", header: "Minutes" }],
      ["a dotless i leaves a number word unread without an error", "The notice period is f\u0131ve days.", null, { ...days, value: "20" }],
    ];
    it.each(cases)("%s", (_, sentence, values, row) => {
      const numeric = n1(sentence, row);
      expect(numeric.error).toBeUndefined();
      expect(numeric.flags.map(flag => flag.source?.prose)).toEqual(values === null ? [] : [values]);
    });
    it("reads a range in a cell in its own unit, not again in the column's", () => {
      expect(n1("The notice period is $40.", { label: "Notice period", value: "30-45 days" }).flags).toEqual([]);
      expect(n1("The notice period is 60 days.", { label: "Notice period", value: "30-45 days" }).flags.map(flag => flag.source)).toEqual([{ row: ["30 day", "45 day"], prose: ["60 day"] }]);
    });
    it("reads no foreign-dollar amount in a USD column", () => {
      expect(n1("The late payment fee is $80.", { value: "HK$75" }).flags).toEqual([]);
      expect(n1("The late payment fee is $80.", { value: "75" }).flags).toHaveLength(1);
    });
  });

  describe("C1, an edit that turns its clause around", () => {
    it.each([
      ["The Supplier shall not disclose the data.", 13, 22, "shall", ["negation_flipped"]],
      ["Fees include all taxes.", 5, 12, "exclude", ["polarity_swapped"]],
      ["The Customer must give notice.", 13, 17, "may", ["modality_changed"]],
      ["The Buyer shall pay the Seller within 30 days.", 0, 30, "The Seller shall pay the Buyer", ["parties_swapped"]],
    ] as const)("flags %s", (text, start, end, newText, codes) => {
      expect(flags(prose(1), [text], [text.slice(0, start) + newText + text.slice(end)], [{ id: "E1", action: "replace", paragraph: 1, start, end, newText }]).value.edits.flags)
        .toEqual([{ id: "E1", codes }]);
    });
    const cases: [string, string, string, string, Edit["action"], string[]][] = [
      ["removing 'not ... without' together keeps the parity", "The Supplier shall not pay any fee without notice.", "not pay any fee without notice", "pay any fee", "replace", []],
      ["'without' to 'with'", "The Supplier may terminate without notice.", "without", "with", "replace", ["negation_flipped"]],
      ["'won't' to 'will'", "The Supplier won't disclose the data.", "won't", "will", "replace", ["negation_flipped"]],
      ["Word's curly 'won\u2019t' to 'will'", "The Supplier won\u2019t disclose the data.", "won\u2019t", "will", "replace", ["negation_flipped"]],
      ["'cannot' to 'can'", "The Supplier cannot assign the contract.", "cannot", "can", "replace", ["negation_flipped"]],
      ["'non-exclusive' to 'exclusive'", "The licence is non-exclusive and royalty free.", "non-exclusive", "exclusive", "replace", ["negation_flipped"]],
      ["deleting a fullwidth 'not' (NFKC)", "The Supplier shall \uff4e\uff4f\uff54 pay the fee.", "\uff4e\uff4f\uff54 ", "", "delete", ["negation_flipped"]],
      ["inserting ' not' after 'shall'", "The Supplier shall pay the fee.", "shall", " not", "insert_after", ["negation_flipped"]],
      ["'exclude' to 'include'", "Fees exclude all taxes.", "exclude", "include", "replace", ["polarity_swapped"]],
      ["'allowed' to 'prohibited'", "The Customer is allowed to sublicense.", "allowed", "prohibited", "replace", ["polarity_swapped"]],
      ["Buyer to Seller in a clause naming one party", "The Buyer shall pay.", "Buyer", "Seller", "replace", ["polarity_swapped"]],
      ["'Buyer ... Seller' to 'Seller ... Agent' names another set of parties", "The Buyer shall notify the Seller.", "Buyer shall notify the Seller", "Seller shall notify the Agent", "replace", []],
      ["a lowercase buyer and seller swapped are not party terms", "The buyer shall pay the seller.", "buyer shall pay the seller", "seller shall pay the buyer", "replace", []],
      ["'may' to 'shall'", "The Customer may give notice.", "may", "shall", "replace", ["modality_changed"]],
      ["'shall' to 'may'", "The Customer shall give notice.", "shall", "may", "replace", ["modality_changed"]],
      ["'must' to 'may'", "The Customer must give notice.", "must", "may", "replace", ["modality_changed"]],
      ["'shall pay and may audit' to 'shall pay and must audit' keeps a strong verb", "The Customer shall pay and may audit.", "may audit", "must audit", "replace", []],
      ["'shall pay and may audit' to 'must pay and may audit' keeps a strong verb", "The Customer shall pay and may audit.", "shall", "must", "replace", []],
      ["'may pay' to 'must pay or may defer'", "The Customer may pay.", "may pay", "must pay or may defer", "replace", ["modality_changed"]],
      ["deleting 'shall' with no 'may' after it", "The Customer shall pay.", "shall ", "", "delete", []],
      ["'pays' to 'shall pay' with no 'may' before it", "The Customer pays.", "pays", "shall pay", "replace", []],
      ["inserting ' or may' after 'must' keeps 'must'", "The Customer must give notice.", "must", " or may", "insert_after", []],
      ["a comment changes nothing", "The Supplier shall not pay.", "shall not", "", "comment", []],
    ];
    it.each(cases)("%s", (_, text, anchor, newText, action, codes) => {
      expect(c1(text, anchor, newText, action).edits.flags).toEqual(codes.length ? [{ id: "E1", codes }] : []);
    });
    it("reads defined terms, straight or curly-quoted, as parties, longest first", () => {
      const swap = (definition: string) => c1("The Provider shall pay the Customer within 30 days.", "Provider shall pay the Customer", "Customer shall pay the Provider", "replace", [definition]).edits.flags;
      expect(swap('The Company (the "Provider") and the Client (the "Customer") agree.')).toEqual([{ id: "E1", codes: ["parties_swapped"] }]);
      expect(swap("The Company (the \u201cProvider\u201d) and the Client (the \u201cCustomer\u201d) agree.")).toEqual([{ id: "E1", codes: ["parties_swapped"] }]);
      expect(swap("The Company and the Client agree.")).toEqual([]);
      expect(c1("The Member shall pay the Provider.", "Member shall pay the Provider", "Provider shall pay the Member", "replace",
        ["Acme and Beta (each a \"Member\") and Gamma (the 'Provider') agree."]).edits.flags).toEqual([{ id: "E1", codes: ["parties_swapped"] }]);
      // "Disclosing Party" is matched before the role word "Disclosing", so the two terms trade places.
      expect(c1("The Disclosing Party shall inform Disclosing staff.", "The Disclosing Party shall inform Disclosing staff", "Disclosing staff shall inform the Disclosing Party", "replace",
        ['The Company (the "Disclosing Party") agrees.']).edits.flags).toEqual([{ id: "E1", codes: ["parties_swapped"] }]);
    });
    it("keeps the role words when more than 64 terms are defined, and says the terms were capped", () => {
      const swap = (n: number) => c1("The Buyer shall pay the Seller.", "Buyer shall pay the Seller", "Seller shall pay the Buyer", "replace",
        [Array.from({ length: n }, (_, i) => `(the "Party${word(i)}Xyzzylongname")`).join(" ")]);
      const capped = swap(60);
      expect(capped.edits.flags).toEqual([{ id: "E1", codes: ["parties_swapped"] }]);
      expect(capped.read.termsCapped).toBe(true);
      // 16 role words and 48 defined terms are exactly 64; one more is capped.
      expect(swap(48).read.termsCapped).toBe(false);
      expect(swap(49).read.termsCapped).toBe(true);
    });
    it("compares only the sentences the edit overlaps, clipped to 2,000 characters either side", () => {
      expect(c1("Fees exclude duties. Fees include all taxes.", "include", "exclude").edits.flags).toEqual([{ id: "E1", codes: ["polarity_swapped"] }]);
      // An anchor that starts with the space after a sentence does not pull that sentence in.
      expect(c1("Fees exclude duties. Fees include all taxes.", " Fees include", " Fees exclude").edits.flags).toEqual([{ id: "E1", codes: ["polarity_swapped"] }]);
      expect(c1("Fees include all taxes and exclude duties.", "include", "exclude").edits.flags).toEqual([]);
      expect(c1(`Fees exclude ${"and ".repeat(600)}fees include all taxes.`, "include", "exclude").edits.flags).toEqual([{ id: "E1", codes: ["polarity_swapped"] }]);
      expect(c1(`Fees include all taxes and ${"and ".repeat(600)}exclude duties.`, "include", "exclude").edits.flags).toEqual([{ id: "E1", codes: ["polarity_swapped"] }]);
      // Exactly 2,000 characters: an "exclude" starting 2,000 before the anchor, or ending 2,000 after it, is inside; one character further is not.
      const before = (gap: number) => c1(`Fees exclude ${"w".repeat(gap - 14)} fees include all taxes.`, "include", "exclude").edits.flags.length;
      const after = (gap: number) => c1(`Fees include all taxes ${"w".repeat(gap - 19)} exclude duties.`, "include", "exclude").edits.flags.length;
      expect([before(2000), before(2001), after(2000), after(2001)]).toEqual([0, 1, 0, 1]);
    });
    it("leaves a neutral edit and a comment alone, and reads the sentence at its raw offsets past a double space", () => {
      const text = "Payment is due.  The Supplier shall pay within 30 days.";
      expect(flags(prose(1), [text], [text.replace("30", "45")], [{ id: "E1", action: "replace", paragraph: 1, start: 47, end: 49, newText: "45" },
        { id: "E2", action: "comment", paragraph: 1, start: 0, end: 15 }]).value.edits.flags).toEqual([]);
      const negated = "Payment is due.  The Supplier shall not pay within 30 days.";
      expect(flags(prose(1), [negated], [negated.replace(" not", "")], [{ id: "E3", action: "delete", paragraph: 1, start: 35, end: 39 }]).value.edits.flags)
        .toEqual([{ id: "E3", codes: ["negation_flipped"] }]);
      // [30, 35) is "shall" in the raw text; in the collapsed text it would be "hall " and give a negation instead.
      expect(negated.slice(30, 35)).toBe("shall");
      expect(flags(prose(1), [negated], [negated.replace("shall", "may")], [{ id: "E4", action: "replace", paragraph: 1, start: 30, end: 35, newText: "may" }]).value.edits.flags)
        .toEqual([{ id: "E4", codes: ["modality_changed"] }]);
    });
  });

  describe("C2, clauses of one document that contradict each other", () => {
    it("flags a negation or a polar class apart and never pairs a mutual clause named by its defined terms", () => {
      const { value } = flags(prose(9), [LIABLE, NOT_LIABLE,
        "The Buyer shall indemnify the Seller for claims arising under this agreement.", "The Seller shall indemnify the Buyer for claims arising under this agreement.",
        "Payments made before the due date are permitted under this agreement.", "Payments made after the due date are prohibited under this agreement.",
        'The Bank (the "Upper Lender") and the Fund (the "Lower Lender") agree.', "The Upper Lender shall fund the loan within ten days.",
        "The Lower Lender shall fund the loan within ten days."]);
      expect(value.clauses.flags.map(f => f.paragraphs)).toEqual([[1, 2], [5, 6]]);
      expect(value.counts).toMatchObject({ inversionSource: 2, inversionUnaddressed: 2, inversionIntroduced: 0 });
    });
    it("needs five content tokens", () => {
      expect(c2(["The Supplier pays fees monthly.", "The Supplier never pays fees monthly."]).clauses.flags).toEqual([]);
      expect(c2(["The Supplier pays the fees monthly in arrears.", "The Supplier never pays the fees monthly in arrears."]).clauses.flags.map(f => f.paragraphs)).toEqual([[1, 2]]);
    });
    it("pairs two sentences of one paragraph, and reads upper and higher against lower as one class", () => {
      expect(c2(["The Supplier shall be liable for loss of data. The Supplier shall not be liable for loss of data."]).clauses.flags.map(f => f.paragraphs)).toEqual([[1, 1]]);
      expect(c2(["The fee shall be higher than the market rate for services.", "The fee shall be lower than the market rate for services."]).clauses.flags.map(f => f.paragraphs))
        .toEqual([[1, 2]]);
      // The same polar words in another order are the same sides.
      expect(c2(["Deliveries before noon and returns after noon are accepted at the depot.", "Deliveries after noon and returns before noon are accepted at the depot."]).clauses.flags)
        .toEqual([]);
    });
    it("makes at most 50 comparisons per signature, the earliest pairs first", () => {
      const twelve = c2([...Array.from({ length: 11 }, () => "The Supplier shall pay the fee for every late delivery."), "The Supplier shall not pay the fee for every late delivery."]);
      expect(twelve.clauses.flags.map(f => f.paragraphs)).toEqual([[1, 12], [2, 12], [3, 12], [4, 12], [5, 12]]);
      expect(twelve.read.comparisonsCapped).toBe(true);
      // The 50th comparison, paragraphs (6, 11) here, is still made; the 51st, (6, 12) above, is not.
      const eleventh = c2([...Array.from({ length: 10 }, () => "The Supplier shall pay the fee for every late delivery."), "The Supplier shall not pay the fee for every late delivery.",
        "The Supplier shall pay the fee for every late delivery."]);
      expect(eleventh.clauses.flags.map(f => f.paragraphs)).toEqual([[1, 11], [2, 11], [3, 11], [4, 11], [5, 11], [6, 11]]);
      const three = c2(["The Supplier shall pay the fee for every late delivery.", "The Supplier shall pay the fee for every late delivery.", "The Supplier shall not pay the fee for every late delivery."]);
      expect(three.clauses.flags.map(f => f.paragraphs)).toEqual([[1, 3], [2, 3]]);
      expect(three.read.comparisonsCapped).toBe(false);
    });
    it("records where a contradiction holds and the edits in either paragraph", () => {
      const { value } = flags(prose(2), [LIABLE, NOT_LIABLE], [LIABLE, LIABLE], [{ id: "E1", action: "replace", paragraph: 2, start: 13, end: 22, newText: "shall" }]);
      expect(value.clauses.flags).toEqual([{ paragraphs: [1, 2], inSource: true, inClean: false, addressedBy: ["E1"] }]);
      expect(value.counts).toMatchObject({ inversionEdits: 1, inversionSource: 1, inversionIntroduced: 0, inversionUnaddressed: 0 });
    });
  });

  describe("the counts", () => {
    it("counts numeric flags in the source, introduced, resolved and unaddressed, where an edit in the paragraph or the row's cells addresses one", () => {
      const units = [...table([["Late payment fee", "50"], ["Deposit amount", "10"], ["Service charge", "TBD"]]).units, ...prose(7)];
      const cells = ["Item", "Fee (USD)", "Late payment fee", "50", "Deposit amount", "10", "Service charge"];
      const source = [...cells, "TBD", "The late payment fee is $75.", "The late payment fee is $80.", "The deposit amount is $20.", "The late payment fee is $50.",
        "The late payment fee is $90.", "The service charge is $30.", "The late payment fee is $95."];
      // Paragraph 15 changes without an edit, which only these synthetic inputs can do: a flag must hold in both texts to stay unaddressed.
      const clean = [...cells, "20", "The late payment fee is $75.", "The late payment fee is $80.", "The deposit amount is $20.", "The late payment fee is $60.",
        "The late payment fee is $50.", "The service charge is $30.", "The late payment fee is $50."];
      const { value } = flags(units, source, clean, [comment("E1", 9), comment("E2", 6), { id: "E3", action: "replace", paragraph: 12, start: 25, end: 27, newText: "60" },
        { id: "E4", action: "replace", paragraph: 13, start: 25, end: 27, newText: "50" }, { id: "E5", action: "replace", paragraph: 8, start: 0, end: 3, newText: "20" }]);
      expect(value.numeric.flags.map(f => [f.table, f.row, f.paragraph, f.inSource, f.inClean, f.addressedBy])).toEqual([
        [1, 2, 9, true, true, ["E1"]], [1, 2, 10, true, true, []], [1, 2, 12, false, true, ["E3"]], [1, 2, 13, true, false, ["E4"]], [1, 2, 15, true, false, []],
        [1, 3, 11, true, true, ["E2"]], [1, 4, 14, false, true, ["E5"]]]);
      expect(value.counts).toMatchObject({ numericSource: 5, numericIntroduced: 2, numericResolved: 2, numericUnaddressed: 1 });
    });
    it("counts clause flags in the source, introduced and unaddressed, with an edit in either paragraph addressing one, and the edit flags", () => {
      const source = ["alpha", "bravo", "charlie", "delta", "foxtrot"].flatMap(contradiction);
      source.splice(8, 0, "The Supplier shall deliver the goods to depot echo.", "The Supplier shall deliver the goods to depot echo.");
      const clean = [...source];
      clean[7] = "The Supplier shall deliver the goods to depot delta.";
      clean[9] = "The Supplier shall not deliver the goods to depot echo.";
      clean[11] = "The Supplier shall deliver the goods to depot foxtrot.";
      const { value } = flags(prose(12), source, clean, [comment("E1", 1), comment("E2", 4), { id: "E3", action: "replace", paragraph: 8, start: 13, end: 22, newText: "shall" },
        { id: "E4", action: "insert_after", paragraph: 10, start: 13, end: 18, newText: " not" }]);
      expect(value.clauses.flags.map(f => [f.paragraphs, f.inSource, f.inClean, f.addressedBy])).toEqual([[[1, 2], true, true, ["E1"]], [[3, 4], true, true, ["E2"]],
        [[5, 6], true, true, []], [[7, 8], true, false, ["E3"]], [[9, 10], false, true, ["E4"]], [[11, 12], true, false, []]]);
      expect(value.edits.flags).toEqual([{ id: "E3", codes: ["negation_flipped"] }, { id: "E4", codes: ["negation_flipped"] }]);
      expect(value.counts).toMatchObject({ inversionEdits: 2, inversionSource: 5, inversionIntroduced: 1, inversionUnaddressed: 1 });
    });
  });

  describe("lists, sort keys and read caps", () => {
    it("cuts every list at 40 with a truncated flag after sorting it, and counts every flag found", () => {
      const t = feeTable("Late payment fee", "$50");
      for (const n of [DOCUMENT_REVIEW_FLAG_LIST_MAX, 45]) {
        const { value } = flags([...t.units, ...prose(n)], [...t.texts, ...Array.from({ length: n }, () => "The late payment fee is $75.")]);
        expect(value.numeric.truncated).toBe(n > DOCUMENT_REVIEW_FLAG_LIST_MAX);
        expect(value.numeric.flags.map(flag => flag.paragraph)).toEqual(Array.from({ length: DOCUMENT_REVIEW_FLAG_LIST_MAX }, (_, i) => i + 5));
        expect(value.counts.numericSource).toBe(n);
        expect(value.read).toEqual({ comparisonsCapped: false, figuresCapped: false, labelsCapped: false, paragraphsClipped: 0, rowsCapped: false, sentencesCapped: false, termsCapped: false });
      }
      // 45 edit flags, planned last first: the list keeps E1 to E40.
      const sentence = "The Supplier shall pay.";
      const edits = Array.from({ length: 45 }, (_, i): Edit => ({ id: `E${45 - i}`, action: "insert_after", paragraph: 45 - i, start: 13, end: 18, newText: " not" }));
      const edited = flags(prose(45), Array.from({ length: 45 }, () => sentence), Array.from({ length: 45 }, () => "The Supplier shall not pay."), edits).value;
      expect(edited.edits.truncated).toBe(true);
      expect(edited.edits.flags.map(flag => flag.id)).toEqual(Array.from({ length: 40 }, (_, i) => `E${i + 1}`));
      expect(edited.counts.inversionEdits).toBe(45);
      // 45 clause flags: the list keeps the 40 lowest pairs.
      const clauses = c2(Array.from({ length: 45 }, (_, i) => contradiction(word(i))).flat());
      expect(clauses.clauses.truncated).toBe(true);
      expect(clauses.clauses.flags.map(flag => flag.paragraphs)).toEqual(Array.from({ length: 40 }, (_, i) => [2 * i + 1, 2 * i + 2]));
      expect(clauses.counts.inversionSource).toBe(45);
    });
    it("sorts numeric flags by table, row and paragraph, and reads each table under its own header", () => {
      const units = [...table([["Deposit amount", "10"], ["Late payment fee", "50"]]).units, ...table([["Notice period", "30"]], "Notice (days)", 2).units, ...prose(3)];
      const { value } = flags(units, ["Item", "Fee (USD)", "Deposit amount", "10", "Late payment fee", "50", "Item", "Notice (days)", "Notice period", "30",
        "The notice period is 45 days.", "The late payment fee is $75.", "The deposit amount is $20."]);
      expect(value.numeric.flags.map(flag => [flag.table, flag.row, flag.paragraph, flag.source?.prose])).toEqual([[1, 2, 13, ["20 USD"]], [1, 3, 12, ["75 USD"]], [2, 2, 11, ["45 day"]]]);
    });
    it("sorts edit ids by their number and then the id, whatever the plan's order", () => {
      const units = [...feeTable("Late payment fee", "50").units, ...prose(4)];
      const source = [...feeTable("Late payment fee", "50").texts, "The late payment fee is $75.", "The Supplier shall pay.", "The Buyer shall pay.", "The Lessee shall pay."];
      const clean = [...source.slice(0, 5), "The Supplier shall not pay.", "The Buyer shall not pay.", "The Lessee shall not pay."];
      const negate = (id: string, paragraph: number): Edit => ({ id, action: "insert_after", paragraph, start: source[paragraph - 1]!.indexOf("shall"), end: source[paragraph - 1]!.indexOf("shall") + 5, newText: " not" });
      for (const plan of [[comment("E10", 5), comment("E2", 5), comment("E1", 5), comment("E01", 5)], [comment("E01", 5), comment("E1", 5), comment("E2", 5), comment("E10", 5)]]) {
        const { value } = flags(units, source, clean, [...plan, negate("E3", 6), negate("E20", 7), negate("E03", 8)]);
        expect(value.numeric.flags.map(flag => flag.addressedBy)).toEqual([["E01", "E1", "E2", "E10"]]);
        expect(value.edits.flags.map(flag => flag.id)).toEqual(["E03", "E3", "E20"]);
      }
      const { value } = flags(units, source, clean, [negate("E10", 6), negate("E2", 7), negate("E1", 8), comment("E01", 5)]);
      expect(value.edits.flags.map(flag => flag.id)).toEqual(["E1", "E2", "E10"]);
    });
    it("reads at most 200 qualifying rows with values, counting only those", () => {
      const rows = (n: number) => {
        const entries: [string, string][] = [];
        for (let i = 0; i < n; i++) entries.push([`Charge ${word(i)}`, "50"], ...(i % 50 === 0 ? [["Notes", "TBD"], [`Fee ${i}`, "50"]] as [string, string][] : []));
        return table(entries);
      };
      const full = rows(201), first = full.texts.length + 1;
      const { value } = flags([...full.units, ...prose(2)], [...full.texts, `The charge ${word(199)} is $75.`, `The charge ${word(200)} is $75.`]);
      expect(value.numeric.flags.map(flag => flag.paragraph)).toEqual([first]);
      expect(value.read.rowsCapped).toBe(true);
      // 200 qualifying rows followed only by rows without values are not capped.
      const exact = rows(200), trailing = table([["Notes", "TBD"]], "Fee (USD)", 2);
      expect(flags([...exact.units, ...trailing.units, ...prose(1)], [...exact.texts, ...trailing.texts, `The charge ${word(199)} is $75.`]).value.read.rowsCapped).toBe(false);
    });
    it("reads at most 10 named labels per sentence, in table and row order", () => {
      const labels = (n: number) => table(Array.from({ length: n }, (_, i): [string, string] => [`Charge ${word(i)}`, "50"]));
      const sentence = (n: number) => `The ${Array.from({ length: n }, (_, i) => `charge ${word(n - 1 - i)}`).join(", ")} are $75.`;
      const eleven = labels(11), { value } = flags([...eleven.units, ...prose(1)], [...eleven.texts, sentence(11)]);
      expect(value.numeric.flags.map(flag => flag.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(value.read.labelsCapped).toBe(true);
      const ten = labels(10), tenFlags = flags([...ten.units, ...prose(1)], [...ten.texts, sentence(10)]).value;
      expect(tenFlags.numeric.flags).toHaveLength(10);
      expect(tenFlags.read.labelsCapped).toBe(false);
    });
    it("reads at most 50 distinct figures per sentence and per row", () => {
      const figures = (n: number) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(", ");
      // The 51st figure would clear the sentence, so the flag shows it was not read.
      const capped = flags([...feeTable("Late payment fee", "999").units, ...prose(1)], [...feeTable("Late payment fee", "999").texts, `The late payment fee is ${figures(50)} or $999.`]).value;
      expect(capped.numeric.flags.map(flag => flag.source?.prose)).toEqual([["1 USD", "2 USD", "3 USD", "4 USD"]]);
      expect(capped.read.figuresCapped).toBe(true);
      const read = flags([...feeTable("Late payment fee", "999").units, ...prose(1)], [...feeTable("Late payment fee", "999").texts, `The late payment fee is ${figures(49)} or $999.`]).value;
      expect(read.numeric.flags).toEqual([]);
      expect(read.read.figuresCapped).toBe(false);
      const repeated = flags([...feeTable("Late payment fee", "999").units, ...prose(1)], [...feeTable("Late payment fee", "999").texts, `The late payment fee is ${figures(49)}, $1 or $999.`]).value;
      expect(repeated.numeric.flags).toEqual([]);
      expect(repeated.read.figuresCapped).toBe(false);
      // A row's 51st distinct value is not one of its values; a repeated value counts once.
      const values = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1)).join(", ");
      const row = (cellText: string) => flags([...feeTable("Late payment fee", cellText).units, ...prose(1)], [...feeTable("Late payment fee", cellText).texts, "The late payment fee is $51."]).value;
      const fiftyOne = row(values(51));
      expect(fiftyOne.numeric.flags).toHaveLength(1);
      expect(fiftyOne.read.figuresCapped).toBe(true);
      const columns: Unit[] = [cell(1, 1, 1), cell(1, 1, 2), cell(1, 1, 3), cell(1, 2, 1), cell(1, 2, 2), cell(1, 2, 3), ...prose(1)];
      const spread = flags(columns, ["Item", "Fee (USD)", "Fee (USD)", "Late payment fee", values(50), "50", "The late payment fee is $51."]).value;
      expect(spread.numeric.flags).toHaveLength(1);
      expect(spread.read.figuresCapped).toBe(false);
      const fifty = row(`1, ${values(49)}, 51`);
      expect(fifty.numeric.flags).toEqual([]);
      expect(fifty.read.figuresCapped).toBe(false);
    });
    it("makes at most 200,000 label comparisons per pass", () => {
      const run = (comparisons: number) => {
        const paragraphs: string[] = [];
        for (let left = comparisons; left > 0; left -= 2000) paragraphs.push("service ".repeat(Math.min(2000, left)));
        const t = feeTable("Service charge", "50");
        return flags([...t.units, ...prose(paragraphs.length + 1)], [...t.texts, ...paragraphs, "The service charge is $75."]).value;
      };
      // Each pass (the source's and the clean text's) has its own budget.
      const within = run(199_999);
      expect(within.numeric.flags.map(flag => [flag.inSource, flag.inClean])).toEqual([[true, true]]);
      expect(within.read.labelsCapped).toBe(false);
      const over = run(200_000);
      expect(over.numeric.flags).toEqual([]);
      expect(over.read.labelsCapped).toBe(true);
    }, 120_000);
    it("reads at most 5,000 sentences per pass, prose for N1 and every paragraph for C2", () => {
      const filler = (n: number) => {
        const paragraphs: string[] = [];
        for (let left = n; left > 0; left -= 100) paragraphs.push(Array.from({ length: Math.min(100, left) }, () => "Filler text here.").join(" "));
        return paragraphs;
      };
      const numeric = (n: number) => {
        const t = feeTable("Late payment fee", "50"), paragraphs = filler(n);
        return flags([...t.units, ...prose(paragraphs.length + 1)], [...t.texts, ...paragraphs, "The late payment fee is $75."]).value;
      };
      expect(numeric(4999).numeric.flags).toHaveLength(1);
      const cut = numeric(5000);
      expect(cut.numeric.flags).toEqual([]);
      expect(cut.read.sentencesCapped).toBe(true);
      const clauses = (n: number) => { const paragraphs = filler(n); return c2([...paragraphs, LIABLE, NOT_LIABLE]); };
      const within = clauses(4998);
      expect(within.clauses.flags).toHaveLength(1);
      expect(within.read.sentencesCapped).toBe(false);
      const over = clauses(4999);
      expect(over.clauses.flags).toEqual([]);
      expect(over.read.sentencesCapped).toBe(true);
    }, 120_000);
    it("clips each NFKC paragraph to 20,000 characters and the document to 2,000,000, counting the paragraphs clipped in either view", () => {
      const sentence = "The late payment fee is $75.", t = feeTable("Late payment fee", "50");
      const sized = (n: number) => `${"x".repeat(n - sentence.length - 1)} ${sentence}`;
      const boundary = flags([...t.units, ...prose(2)], [...t.texts, sized(20_000), sized(20_001)]).value;
      expect(boundary.read.paragraphsClipped).toBe(1);
      expect(boundary.numeric.flags).toHaveLength(2);
      // Exactly 20,000 characters: a 20,001-character paragraph ending "$750" is read as "$75".
      const cut = "The late payment fee is $750";
      expect(flags([...t.units, ...prose(1)], [...t.texts, `${"x".repeat(20_000 - cut.length)} ${cut}`]).value.numeric.flags.map(flag => flag.source?.prose)).toEqual([["75 USD"]]);
      // Exactly 2,000,000 characters: the cells and the paragraphs before leave 27 for the last paragraph, so its "$750" is read as "$75".
      const filler = [...Array.from({ length: 99 }, () => "y".repeat(20_000)), "y".repeat(2_000_000 - 99 * 20_000 - t.texts.join("").length - 27)];
      expect(flags([...prose(100), ...t.units, ...prose(1)], [...filler, ...t.texts, cut]).value.numeric.flags.map(flag => flag.source?.prose)).toEqual([["75 USD"]]);
      // A paragraph clipped in both views counts once; one clipped only in the clean view counts too, so a flag that reads as resolved
      // because the clean sentence was cut is never reported without its cap.
      expect(flags([...t.units, ...prose(1)], [...t.texts, sized(20_001)], [...t.texts, sized(20_001)]).value.read.paragraphsClipped).toBe(1);
      const source = `${"x".repeat(19_950)} ${sentence}`, clean = `${source.slice(0, 10)}${"z".repeat(200)}${source.slice(10)}`;
      const cleanCut = flags([...t.units, ...prose(1)], [...t.texts, source], [...t.texts, clean]).value;
      expect(cleanCut.numeric.flags).toMatchObject([{ inSource: true, inClean: false }]);
      expect(cleanCut.read.paragraphsClipped).toBe(1);
      const lost = flags([...t.units, ...prose(1)], [...t.texts, `${"x".repeat(20_001)} ${sentence}`]).value;
      expect(lost.numeric.flags).toEqual([]);
      expect(lost.read.paragraphsClipped).toBe(1);
      // A ligature is three characters after NFKC: 7,000 of them pass the clip and push the sentence out.
      const ligatures = flags([...t.units, ...prose(1)], [...t.texts, `${"\ufb03".repeat(7000)}. ${sentence}`]).value;
      expect(ligatures.numeric.flags).toEqual([]);
      expect(ligatures.read.paragraphsClipped).toBe(1);
      // 101 paragraphs of 19,999 characters fill the document cap: the 101st and everything after it is clipped.
      const ahead = (paragraphs: string[]) => flags([...prose(paragraphs.length), ...t.units, ...prose(1)], [...paragraphs, ...t.texts, sentence]).value;
      const full = ahead(Array.from({ length: 101 }, () => "y".repeat(19_999)));
      expect(full.numeric.flags).toEqual([]);
      expect(full.read.paragraphsClipped).toBe(6);
      // A clipped paragraph counts its first 20,000 characters toward the document cap, not its length.
      const long = ahead(Array.from({ length: 50 }, () => "y".repeat(40_000)));
      expect(long.numeric.flags).toHaveLength(1);
      expect(long.read.paragraphsClipped).toBe(50);
    }, 120_000);
  });

  it("gives the same bytes in separate processes under any hash seed, from an empty working directory", () => {
    // A second table with two units, after the prose: more than 4 values in two units must be cut in the same order every time.
    const t = feeTable("Late payment fee", "$50"), units = [...t.units, ...prose(5), cell(2, 1, 1), cell(2, 1, 2), cell(2, 1, 3), cell(2, 2, 1), cell(2, 2, 2), cell(2, 2, 3), ...prose(1)];
    const second = ["Item", "Fee (USD)", "Rate (%)", "Service charge", "50", "60", "The service charge is $75, $76, $77, $78, 7% and 8%."];
    const source = [...t.texts, "The late payment fee is $75 and the deposit is $10.", 'The Company (the "Disclosing Party") and the Client (the "Receiving Party") agree.',
      "The Disclosing Party shall inform Disclosing staff.", LIABLE, NOT_LIABLE, ...second];
    const clean = [...source.slice(0, 6), "Disclosing staff shall inform the Disclosing Party.", LIABLE, LIABLE, ...second];
    const edits: Edit[] = [comment("E2", 5), { id: "E10", action: "replace", paragraph: 9, start: 13, end: 22, newText: "shall" }, comment("E1", 5), comment("E01", 5),
      { id: "E3", action: "replace", paragraph: 7, start: 0, end: 50, newText: "Disclosing staff shall inform the Disclosing Party" }];
    const cwd = mkdtempSync(join(tmpdir(), "soar-flags-seed-"));
    try {
      const { bytes, value } = flags(units, source, clean, edits);
      expect(value.numeric.flags.map(flag => [flag.addressedBy, flag.source?.prose])).toEqual([[["E01", "E1", "E2"], ["10 USD", "75 USD"]], [[], ["7 %", "8 %", "75 USD", "76 USD"]]]);
      expect(value.edits.flags).toEqual([{ id: "E3", codes: ["parties_swapped"] }, { id: "E10", codes: ["negation_flipped"] }]);
      expect(value.clauses.flags).toEqual([{ paragraphs: [8, 9], inSource: true, inClean: false, addressedBy: ["E10"] }]);
      const runs = ["0", "1", "2", "3", "7", "99", "4096", "65535"].map(seed =>
        flags(units, source, clean, edits, { args: ["-s"], env: { PATH: process.env.PATH, PYTHONHASHSEED: seed }, cwd }).bytes.toString("hex"));
      expect(new Set([...runs, bytes.toString("hex")]).size).toBe(1);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  describe("failure isolation", () => {
    it("isolates a failing rule to its own list, and returns the fixed record when the whole step fails, so the flags never fail a review", () => {
      // A malformed cell breaks N1 only: its list names the exception, and C1 and C2 still run.
      const isolated = flags([{ kind: "cell" } as unknown as Unit, ...prose(2)], ["x", LIABLE, NOT_LIABLE]).value;
      expect(isolated.numeric).toEqual({ flags: [], truncated: false, error: "KeyError" }); expect(isolated.error).toBeUndefined();
      expect(isolated.clauses.flags.map(f => f.paragraphs)).toEqual([[2, 3]]);
      // Inputs that do not line up fail the whole step: every list is empty and every count zero.
      const { value } = flags(prose(2), ["one paragraph"]);
      expect(value).toMatchObject({ error: "ValueError", numeric: { flags: [] }, edits: { flags: [] }, clauses: { flags: [] } });
      expect(Object.values(value.counts).every(count => count === 0)).toBe(true);
      expect(python(`${REVIEW_FLAGS_PY}\nimport sys\ndef boom():\n    raise RuntimeError("unit builder")\nsys.stdout.write(json.dumps(review_flags_or_error(boom)["error"]))`)).toBe('"RuntimeError"');
    });
    it("records only C1's error for an edit outside the document", () => {
      const text = "The Supplier shall be liable for loss of data. The Supplier shall not be liable for loss of data.";
      const { value } = flags(prose(1), [text], [text], [{ id: "E1", action: "replace", paragraph: 9, start: 0, end: 3, newText: "A" }]);
      expect(value.edits).toEqual({ flags: [], truncated: false, error: "IndexError" });
      expect(value.numeric).toEqual({ flags: [], truncated: false });
      expect(value.clauses.flags.map(flag => flag.paragraphs)).toEqual([[1, 1]]); expect(value.clauses.error).toBeUndefined();
      expect(value.error).toBeUndefined();
      expect(value.counts).toMatchObject({ inversionEdits: 0, inversionSource: 1 });
    });
    /** A numeric flag in paragraph 5 and two C1 flags (E1, E2) that each negate a clause. */
    const mixed = (): [Unit[], string[], string[], Edit[]] => {
      const t = feeTable("Late payment fee", "50");
      return [[...t.units, ...prose(3)], [...t.texts, "The late payment fee is $75.", LIABLE, "The Supplier shall pay."],
        [...t.texts, "The late payment fee is $75.", NOT_LIABLE, "The Supplier shall not pay."],
        [{ id: "E1", action: "replace", paragraph: 6, start: 13, end: 18, newText: "shall not" }, { id: "E2", action: "insert_after", paragraph: 7, start: 13, end: 18, newText: " not" }]];
    };
    it("records only C2's error when C2 fails", () => {
      const [units, source, clean, edits] = mixed();
      const { value } = flags(units, source, clean, edits, { prelude: "def flag_clause_contradictions(texts, terms, read):\n    raise ZeroDivisionError(\"clauses\")\n" });
      expect(value.clauses).toEqual({ flags: [], truncated: false, error: "ZeroDivisionError" });
      expect(value.numeric.flags).toHaveLength(1); expect(value.numeric.error).toBeUndefined();
      expect(value.edits.flags.map(flag => flag.id)).toEqual(["E1", "E2"]); expect(value.error).toBeUndefined();
      expect(value.counts).toMatchObject({ numericSource: 1, inversionEdits: 2, inversionSource: 0, inversionIntroduced: 0 });
    });
    it("records C1's and C2's errors, and still runs N1, when the party pattern fails", () => {
      const [units, source, clean, edits] = mixed();
      const { value } = flags(units, source, clean, edits, { prelude: "def flag_party_pattern(texts, read):\n    raise LookupError(\"terms\")\n" });
      expect(value.edits).toEqual({ flags: [], truncated: false, error: "LookupError" });
      expect(value.clauses).toEqual({ flags: [], truncated: false, error: "LookupError" });
      expect(value.numeric.flags).toHaveLength(1); expect(value.error).toBeUndefined();
    });
    it("returns the fixed record when the record cannot be written", () => {
      const [units, source, clean, edits] = mixed();
      const prelude = "flag_test_json = review_flags_json\ndef review_flags_json(record):\n    if \"error\" not in record:\n        raise TypeError(\"unwritable\")\n    return flag_test_json(record)\n";
      const { value } = flags(units, source, clean, edits, { prelude });
      expect(value).toEqual({ version: DOCUMENT_REVIEW_FLAGS_VERSION, rules: { ...DOCUMENT_REVIEW_FLAG_RULES }, error: "TypeError",
        counts: Object.fromEntries(DOCUMENT_REVIEW_FLAG_COUNTS.map(name => [name, 0])),
        read: { comparisonsCapped: false, figuresCapped: false, labelsCapped: false, paragraphsClipped: 0, rowsCapped: false, sentencesCapped: false, termsCapped: false },
        numeric: { flags: [], truncated: false }, edits: { flags: [], truncated: false }, clauses: { flags: [], truncated: false } });
    });
    it("lets a MemoryError and a PlanError through from the inputs, every rule and the writer, never recording them", () => {
      const code = `${REVIEW_FLAGS_PY}
class PlanError(Exception):
    pass
def attempt(make):
    try:
        review_flags_or_error(make)
        return None
    except BaseException as error:
        return type(error).__name__
out = []
for kind in (MemoryError, PlanError):
    def raising(*args, **kwargs):
        raise kind("machine")
    out.append(attempt(raising))
    for name in ("flag_table_rows", "flag_edit_inversions", "flag_clause_contradictions", "flag_party_pattern", "review_flags_json"):
        saved = globals()[name]
        globals()[name] = raising
        try:
            out.append(attempt(lambda: ([{"kind": "prose"}], ["The Supplier shall pay."], ["The Supplier shall pay."], [])))
        finally:
            globals()[name] = saved
print(json.dumps(out))`;
      expect(JSON.parse(python(code))).toEqual([...Array.from({ length: 6 }, () => "MemoryError"), ...Array.from({ length: 6 }, () => "PlanError")]);
    });
  });

  describe("bounded cost", () => {
    it("reaches the row, sentence and comparison caps on letter-only labels, still flags, and finishes in bounded time", () => {
      const units: Unit[] = [cell(1, 1, 1), cell(1, 1, 2)], texts = ["Item", "Fee (USD)"];
      for (let i = 0; i < 205; i++) { units.push(cell(1, i + 2, 1), cell(1, i + 2, 2)); texts.push(`Service charge ${word(i)}`, "50"); }
      for (let i = 0; i < 2600; i++) { units.push({ kind: "prose" }); texts.push(`The service charge ${word(i % 200)} is $75 for the month. Another sentence follows here with words.`); }
      const started = Date.now(), { value } = flags(units, texts);
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(value.read).toMatchObject({ rowsCapped: true, sentencesCapped: true, comparisonsCapped: true });
      // Two sentences per paragraph: the first 2,500 paragraphs fill the 5,000-sentence cap, each with one flag.
      expect(value.counts.numericSource).toBe(2500);
    }, 120_000);
    it("stays fast when every sentence names all 200 labels with hundreds of figures, reading 10 labels and the first 50 figures of each", () => {
      const units: Unit[] = [cell(1, 1, 1), cell(1, 1, 2)], texts = ["Item", "Fee (USD)"];
      for (let i = 0; i < 200; i++) { units.push(cell(1, i + 2, 1), cell(1, i + 2, 2)); texts.push(`Service charge ${word(i)}`, "50"); }
      const sentence = `The ${Array.from({ length: 200 }, (_, i) => `service charge ${word(i)}`).join(", ")} are ${Array.from({ length: 300 }, (_, k) => `$${399 - k}`).join(", ")}.`;
      const paragraph = `${sentence} ${sentence} ${sentence} `.padEnd(20_000, "x");
      for (let i = 0; i < 105; i++) { units.push({ kind: "prose" }); texts.push(paragraph); }
      const started = Date.now(), { value } = flags(units, texts);
      expect(Date.now() - started).toBeLessThan(15_000);
      // The cells take part of the 2,000,000 characters, so the 100th paragraph is clipped and the 5 after it are clipped to nothing.
      expect(value.read).toMatchObject({ labelsCapped: true, figuresCapped: true, paragraphsClipped: 6 });
      // Each of the 100 paragraphs read flags the first 10 rows, with the 4 smallest of a sentence's first 50 figures ($399 down to $350).
      expect(value.counts.numericSource).toBe(1000);
      expect(value.numeric.flags[0]?.source?.prose).toEqual(["350 USD", "351 USD", "352 USD", "353 USD"]);
    }, 120_000);
    it("splits only the 2,000-character window around each edit, so 200 edits in a 2,000,000-character paragraph stay fast", () => {
      const paragraph = "Pay. ".repeat(400_000);
      const edits = Array.from({ length: 200 }, (_, k): Edit => ({ id: `E${k + 1}`, action: "insert_after", paragraph: 1, start: (k * 1999 + 7) * 5, end: (k * 1999 + 7) * 5 + 3, newText: " not" }));
      const started = Date.now(), { value } = flags(prose(1), [paragraph], [paragraph], edits);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(value.counts.inversionEdits).toBe(200);
      expect(value.edits.flags[0]).toEqual({ id: "E1", codes: ["negation_flipped"] });
    }, 120_000);
  });

  describe("the literal and its schema", () => {
    it("is stdlib-only Python 3.9 without f-strings or global statements, and adds only its own names to the applier's", () => {
      const imports = JSON.parse(python(`import ast, json, sys\ntree = ast.parse(sys.stdin.read())\nprint(json.dumps(sorted({a.name for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names} | {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)} - {None})))`, REVIEW_FLAGS_PY));
      expect(imports).toEqual(["decimal", "json", "re", "unicodedata"]);
      // CI's python3 (3.12 or newer) parses PEP 701 f-strings even under feature_version=(3, 9), so f-strings are refused by node type.
      expect(JSON.parse(python(`import ast, json, sys\ntree = ast.parse(sys.stdin.read(), feature_version=(3, 9))\nprint(json.dumps(sorted({type(n).__name__ for n in ast.walk(tree) if isinstance(n, (ast.JoinedStr, ast.Global))})))`, REVIEW_FLAGS_PY))).toEqual([]);
      const applier = documentReviewApplierFile().bytes.toString("utf8"), at = applier.indexOf(REVIEW_FLAGS_PY);
      expect(at).toBeGreaterThan(0); expect(applier.slice(at + REVIEW_FLAGS_PY.length)).toMatch(/^\s*if __name__ == "__main__":/u);
      // With a stub lxml, the applier's body runs first; the literal then rebinds none of its names and adds only prefixed ones.
      const probe = `import json, sys, types\nlxml = types.ModuleType("lxml"); lxml.etree = types.SimpleNamespace(); sys.modules["lxml"] = lxml\ndata = json.loads(sys.stdin.read())\n` +
        `ns = {"__name__": "applier"}\nexec(compile(data["body"], "body", "exec"), ns)\nbefore = dict(ns)\nexec(compile(data["flags"], "flags", "exec"), ns)\n` +
        `print(json.dumps({"rebound": sorted(name for name in before if ns[name] is not before[name]), "added": sorted(set(ns) - set(before)), "run": callable(before["run"])}))`;
      const names = JSON.parse(python(probe, JSON.stringify({ body: applier.slice(0, at), flags: REVIEW_FLAGS_PY }))) as { rebound: string[]; added: string[]; run: boolean };
      expect(names.run).toBe(true); expect(names.rebound).toEqual([]);
      expect(names.added.filter(name => !/^(FLAG_|flag_|review_flags)/u.test(name))).toEqual(["decimal", "unicodedata"]);
      expect(names.added).toEqual(expect.arrayContaining(["review_flags", "review_flags_json", "review_flags_or_error", "flag_read"]));
      expect(REVIEW_FLAGS_PY).not.toMatch(/\(\?>|[*+?}]\+/u); expect(/^[\x00-\x7f]*$/u.test(REVIEW_FLAGS_PY)).toBe(true);
    });
    it("mirrors its versions, counts, read caps, codes, units and list caps in the TypeScript exports and the schema", () => {
      const code = "import ast, json, sys\nsource = sys.stdin.read()\nns = {}\nexec(compile(source, 'flags', 'exec'), ns)\n" +
        "codes = [c.args[0].value for c in ast.walk(ast.parse(source)) if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and c.func.attr == 'append' and isinstance(c.func.value, ast.Name) and c.func.value.id == 'codes']\n" +
        "print(json.dumps([ns['FLAG_VERSION'], ns['FLAG_RULES'], list(ns['FLAG_COUNTS']), list(ns['flag_read']()), codes, ns['FLAG_LIST_MAX'], ns['FLAG_VALUES_MAX'], sorted(set(ns['FLAG_UNITS'].values()) | set(ns['FLAG_CURRENCY'].values()))]))";
      expect(JSON.parse(python(code, REVIEW_FLAGS_PY))).toEqual([DOCUMENT_REVIEW_FLAGS_VERSION, { ...DOCUMENT_REVIEW_FLAG_RULES }, [...DOCUMENT_REVIEW_FLAG_COUNTS],
        [...DOCUMENT_REVIEW_FLAG_READ_CAPS], [...DOCUMENT_REVIEW_FLAG_CODES], DOCUMENT_REVIEW_FLAG_LIST_MAX, DOCUMENT_REVIEW_FLAG_VALUES_MAX, [...DOCUMENT_REVIEW_FLAG_UNITS].sort()]);
      expect(Object.keys(DocumentReviewFlagsSchema.shape.read.shape).sort()).toEqual([...DOCUMENT_REVIEW_FLAG_READ_CAPS].sort());
      expect(Object.keys(DocumentReviewFlagsSchema.shape.counts.shape).sort()).toEqual([...DOCUMENT_REVIEW_FLAG_COUNTS].sort());
    });
    describe("the schema refuses", () => {
      const numericFlag = { table: 1, row: 2, paragraph: 5, inSource: true, inClean: true, addressedBy: ["E1"], source: { row: ["50 USD"], prose: ["75 USD"] }, clean: { row: ["50 USD"], prose: ["75 USD"] } };
      const clauseFlag = { paragraphs: [7, 8], inSource: true, inClean: false, addressedBy: [] };
      const zero = Object.fromEntries(DOCUMENT_REVIEW_FLAG_COUNTS.map(name => [name, 0]));
      const nothingRead = { comparisonsCapped: false, figuresCapped: false, labelsCapped: false, paragraphsClipped: 0, rowsCapped: false, sentencesCapped: false, termsCapped: false };
      const valid = () => ({ version: 1, rules: { inversion: 1, numeric: 1 }, counts: { ...zero, numericSource: 1, inversionSource: 1, inversionEdits: 1 }, read: { ...nothingRead },
        numeric: { flags: [structuredClone(numericFlag)], truncated: false }, edits: { flags: [{ id: "E2", codes: ["negation_flipped"] }], truncated: false },
        clauses: { flags: [structuredClone(clauseFlag)], truncated: false } });
      const failed = () => ({ version: 1, rules: { inversion: 1, numeric: 1 }, counts: { ...zero }, read: { ...nothingRead }, numeric: { flags: [], truncated: false },
        edits: { flags: [], truncated: false }, clauses: { flags: [], truncated: false }, error: "ValueError" });
      it("nothing a valid record holds", () => {
        expect(DocumentReviewFlagsSchema.safeParse(valid()).success).toBe(true);
        expect(DocumentReviewFlagsSchema.safeParse(failed()).success).toBe(true);
        expect(DocumentReviewFlagsSchema.safeParse({ ...valid(), numeric: { flags: [], truncated: false, error: "KeyError" } }).success).toBe(true);
        expect(DocumentReviewFlagsSchema.safeParse({ ...valid(), clauses: { flags: [{ ...clauseFlag, paragraphs: [3, 3] }], truncated: false } }).success).toBe(true);
        expect(DocumentReviewFlagsSchema.safeParse({ ...valid(), numeric: { flags: Array.from({ length: 40 }, () => numericFlag), truncated: true } }).success).toBe(true);
        expect(DocumentReviewFlagsSchema.safeParse({ ...valid(), numeric: { flags: [{ ...numericFlag, inClean: false, clean: null }], truncated: false } }).success).toBe(true);
      });
      const refused: [string, (record: ReturnType<typeof valid>) => unknown][] = [
        ["an extra key at the root", record => ({ ...record, note: "x" })],
        ["an extra key in the rules", record => ({ ...record, rules: { ...record.rules, absence: 1 } })],
        ["another version", record => ({ ...record, version: 2 })],
        ["a negative count", record => ({ ...record, counts: { ...record.counts, numericSource: -1 } })],
        ["a table numbered 0", record => ({ ...record, numeric: { flags: [{ ...numericFlag, table: 0 }], truncated: false } })],
        ["an edit id that is not E and one to three digits", record => ({ ...record, clauses: { flags: [{ ...clauseFlag, addressedBy: ["E1\n"] }], truncated: false } })],
        ["an extra key in a side", record => { (record.numeric.flags[0]!.source as Record<string, unknown>).words = []; return record; }],
        ["a value with a word unit", record => { record.numeric.flags[0]!.source.prose = ["75 dollars"]; return record; }],
        ["a value with a trailing zero", record => { record.numeric.flags[0]!.source.prose = ["50.0 USD"]; return record; }],
        ["a 16-digit amount", record => { record.numeric.flags[0]!.source.prose = ["1234567890123456 USD"]; return record; }],
        ["41 entries", record => ({ ...record, numeric: { flags: Array.from({ length: 41 }, () => numericFlag), truncated: false } })],
        ["41 entries said to be truncated", record => ({ ...record, numeric: { flags: Array.from({ length: 41 }, () => numericFlag), truncated: true } })],
        ["an unknown code", record => { record.edits.flags[0]!.codes = ["negation_flipped", "scope_changed"]; return record; }],
        ["a failed rule that holds flags", record => ({ ...record, numeric: { ...record.numeric, error: "KeyError" } })],
        ["a failed rule that is truncated", record => ({ ...record, numeric: { flags: [], truncated: true, error: "KeyError" } })],
        ["a truncated list short of 40", record => ({ ...record, numeric: { flags: Array.from({ length: 39 }, () => numericFlag), truncated: true } })],
        ["a numeric flag in the source without its source side", record => ({ ...record, numeric: { flags: [{ ...numericFlag, source: null }], truncated: false } })],
        ["a numeric flag with a source side it does not hold in", record => ({ ...record, numeric: { flags: [{ ...numericFlag, inSource: false }], truncated: false } })],
        ["a numeric flag in the clean text without its clean side", record => ({ ...record, numeric: { flags: [{ ...numericFlag, clean: null }], truncated: false } })],
        ["a numeric flag with a clean side it does not hold in", record => ({ ...record, numeric: { flags: [{ ...numericFlag, inClean: false }], truncated: false } })],
        ["a numeric flag that holds nowhere", record => ({ ...record, numeric: { flags: [{ ...numericFlag, inSource: false, inClean: false, source: null, clean: null }], truncated: false } })],
        ["a clause flag that holds nowhere", record => ({ ...record, clauses: { flags: [{ ...clauseFlag, inSource: false }], truncated: false } })],
        ["a clause flag with its higher paragraph first", record => ({ ...record, clauses: { flags: [{ ...clauseFlag, paragraphs: [8, 7] }], truncated: false } })],
        ["a failed step with a count", () => ({ ...failed(), counts: { ...zero, inversionEdits: 1 } })],
        ["a failed step that read a cap", () => ({ ...failed(), read: { ...nothingRead, termsCapped: true } })],
        ["a failed step that clipped a paragraph", () => ({ ...failed(), read: { ...nothingRead, paragraphsClipped: 1 } })],
        ["a failed step with flags", () => ({ ...failed(), clauses: { flags: [clauseFlag], truncated: false } })],
        ["a failed step with a rule's error", () => ({ ...failed(), edits: { flags: [], truncated: false, error: "KeyError" } })],
      ];
      it.each(refused)("%s", (_, change) => {
        expect(DocumentReviewFlagsSchema.safeParse(change(valid())).success).toBe(false);
      });
    });
  });
});
