import { z } from "zod";

/**
 * Backlog item 7(d) (BL-20261109-0354-document-review-flags-design): the document-review applier's host flags for the owner's attention,
 * `output/review-flags.json`. A leaf module (zod only), so the host-flags pass (7d.B) and the surfaces (7d.C) read the file without the
 * applier. Rules v1: N1, a table against the prose; C1, an edit that turns its clause around; C2, clauses of one document that
 * contradict each other. A flag never passes or fails a check, decides a status, feeds selection or acceptance, calls a model or writes
 * a ledger row. The file holds document figures (normalized values) but no document words; the event, the registry row and reported
 * issues carry its counts, positions and ids only.
 */
export const DOCUMENT_REVIEW_FLAGS_PATH = "output/review-flags.json";
export const DOCUMENT_REVIEW_FLAGS_VERSION = 1;
export const DOCUMENT_REVIEW_FLAG_RULES = Object.freeze({ inversion: 1, numeric: 1 } as const);
/** Every list holds at most this many entries; the counts cover every flag found within the read caps. */
export const DOCUMENT_REVIEW_FLAG_LIST_MAX = 40;
/** Each side of a numeric flag holds at most this many row values and as many sentence values. */
export const DOCUMENT_REVIEW_FLAG_VALUES_MAX = 4;
export const DOCUMENT_REVIEW_FLAG_UNITS = Object.freeze(["CNY", "EUR", "GBP", "JPY", "USD", "%", "business day", "day", "week", "month", "year",
  "hour", "minute", "mg", "mcg", "g", "kg", "ml", "l", "IU", "unit"] as const);
export const DOCUMENT_REVIEW_FLAG_CODES = Object.freeze(["negation_flipped", "polarity_swapped", "parties_swapped", "modality_changed"] as const);
export const DOCUMENT_REVIEW_FLAG_COUNTS = Object.freeze(["inversionEdits", "inversionIntroduced", "inversionSource", "inversionUnaddressed",
  "numericIntroduced", "numericResolved", "numericSource", "numericUnaddressed"] as const);
/** Which read cap was reached: `paragraphsClipped` counts clipped paragraphs; every other cap is a flag. */
export const DOCUMENT_REVIEW_FLAG_READ_CAPS = Object.freeze(["comparisonsCapped", "figuresCapped", "labelsCapped", "paragraphsClipped", "rowsCapped",
  "sentencesCapped", "termsCapped"] as const);

/** A normalized amount and its unit, "50 USD": at most 15 integer digits and 6 decimals, no trailing zeros. */
export const DOCUMENT_REVIEW_FLAG_VALUE = new RegExp(`^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{0,5}[1-9])? (?:${DOCUMENT_REVIEW_FLAG_UNITS.join("|")})$`, "u");
const position = z.number().int().min(1).max(10_000_000);
const editId = z.string().regex(/^E[0-9]{1,3}$/u);
const editIds = z.array(editId).max(200);
const values = z.array(z.string().regex(DOCUMENT_REVIEW_FLAG_VALUE)).max(DOCUMENT_REVIEW_FLAG_VALUES_MAX);
const side = z.object({ row: values, prose: values }).strict();
const errorName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u);
/** A list of one rule's flags: a rule that failed holds none, and a truncated list holds exactly the maximum. */
const list = <T extends z.ZodType>(entry: T) => z.object({ flags: z.array(entry).max(DOCUMENT_REVIEW_FLAG_LIST_MAX), truncated: z.boolean(),
  error: errorName.optional() }).strict()
  .refine(value => (value.error === undefined || value.flags.length === 0 && !value.truncated) && (!value.truncated || value.flags.length === DOCUMENT_REVIEW_FLAG_LIST_MAX),
    "A failed rule holds no flags, and a truncated list holds exactly the maximum.");
const count = z.number().int().min(0).max(100_000_000);
export const DocumentReviewFlagsSchema = z.object({
  version: z.literal(DOCUMENT_REVIEW_FLAGS_VERSION),
  rules: z.object({ inversion: z.literal(1), numeric: z.literal(1) }).strict(),
  counts: z.object({ inversionEdits: count, inversionIntroduced: count, inversionSource: count, inversionUnaddressed: count,
    numericIntroduced: count, numericResolved: count, numericSource: count, numericUnaddressed: count }).strict(),
  read: z.object({ comparisonsCapped: z.boolean(), figuresCapped: z.boolean(), labelsCapped: z.boolean(), paragraphsClipped: count, rowsCapped: z.boolean(),
    sentencesCapped: z.boolean(), termsCapped: z.boolean() }).strict(),
  // A flag holds in the source, the clean text or both, and carries a side exactly where it holds.
  numeric: list(z.object({ table: position, row: position, paragraph: position, inSource: z.boolean(), inClean: z.boolean(), addressedBy: editIds,
    source: side.nullable(), clean: side.nullable() }).strict()
    .refine(value => (value.inSource || value.inClean) && (value.source === null) === !value.inSource && (value.clean === null) === !value.inClean,
      "A numeric flag carries a side exactly where it holds.")),
  edits: list(z.object({ id: editId, codes: z.array(z.enum(DOCUMENT_REVIEW_FLAG_CODES)).min(1).max(4) }).strict()),
  clauses: list(z.object({ paragraphs: z.tuple([position, position]), inSource: z.boolean(), inClean: z.boolean(), addressedBy: editIds }).strict()
    .refine(value => (value.inSource || value.inClean) && value.paragraphs[0] <= value.paragraphs[1], "A clause flag holds somewhere, its lower paragraph first.")),
  /** Present only when the whole step failed: the exception's class name; every list is then empty, every count zero and nothing read. */
  error: errorName.optional(),
}).strict().superRefine((value, context) => {
  if (value.error !== undefined && (Object.values(value.counts).some(n => n !== 0) || Object.values(value.read).some(Boolean) ||
    [value.numeric, value.edits, value.clauses].some(rule => rule.flags.length > 0 || rule.truncated || rule.error !== undefined))) {
    context.addIssue({ code: "custom", message: "A failed step records no flags, counts or reads." });
  }
});
export type DocumentReviewFlags = z.infer<typeof DocumentReviewFlagsSchema>;
