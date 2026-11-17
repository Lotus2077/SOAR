/**
 * Synthetic inputs for E6's planted-defect scorer (BL-20261117-1005-e6-planted-defect-scorer-design): an agreement, a gold file in format
 * version 1 for it, and edit plans over it. None of it is an E6 task, document or gold file.
 */

/** A services agreement of 18 body paragraphs; paragraphs 3 to 10 are the cells of its four-row, two-column table. */
export const E6_AGREEMENT_TEXTS: readonly string[] = Object.freeze([
  "Services Agreement",
  "1. Fees. The Client shall pay a fee of 12,500 per month.",
  "Item", "Amount", "Monthly fee", "11,500", "Setup", "2,000", "Total", "14,500",
  "2. Liability. The Supplier shall not be liable for indirect losses.",
  "3. Termination. Either party may terminate on 30 days notice, as set out in Section 7.",
  "4. Payment. Invoices are due within 30 days.",
  "5. Confidentiality. The Supplier shall keep the Client's data confidential.",
  "6. Warranty. The Supplier warrants the services will be performed with care.",
  "7. Disclaimer. The Supplier does not warrant the services will be performed with care.",
  "8. Notices. Notices are given in writing.",
  "9. Signatures.",
]);

/** The agreement with python-docx, as E6's files are built: run as python3 -I with the output path. No field and no tracked change. */
export const E6_AGREEMENT_PY = String.raw`import sys
import docx
texts = ${JSON.stringify(E6_AGREEMENT_TEXTS)}
d = docx.Document()
for text in texts[:2]:
    d.add_paragraph(text)
table = d.add_table(rows=4, cols=2)
for index, text in enumerate(texts[2:10]):
    table.cell(index // 2, index % 2).text = text
for text in texts[10:]:
    d.add_paragraph(text)
d.save(sys.argv[1])
`;

/** A gold file for the agreement: one planted defect of each class and two controls. */
export function e6AgreementGold(sourceSha256: string): Record<string, any> {
  return {
    format: "soar-e6-gold", version: 1, source: { sha256: sourceSha256, paragraphs: 18 },
    defects: [
      { id: "D1", class: "numeric", spans: [{ paragraph: 2, quote: "a fee of 12,500" }, { paragraph: 6, quote: "11,500" }], commentOnly: false,
        clean: { any: [
          { all: [{ paragraphs: [2, 2], contains: "11,500", word: true }, { paragraphs: [2, 2], lacks: "12,500", word: true }] },
          { all: [{ paragraphs: [6, 6], contains: "12,500", word: true }, { paragraphs: [6, 6], lacks: "11,500", word: true }] }] } },
      { id: "D2", class: "table_arithmetic", spans: [{ paragraph: 10, quote: "14,500" }], commentOnly: false,
        clean: { paragraphs: [10, 10], contains: "13,500", word: true } },
      { id: "D3", class: "reference_definition", spans: [{ paragraph: 12, quote: "Section 7" }], commentOnly: true },
      { id: "D4", class: "clause_contradiction", spans: [{ paragraph: 15, quote: "warrants the services" }, { paragraph: 16, quote: "does not warrant" }],
        commentOnly: false, clean: { any: [{ paragraphs: [16, 16], lacks: "not", word: true }, { paragraphs: [15, 15], contains: "does not", word: true }] } },
      { id: "D5", class: "missing_section", region: { first: 17, last: 18 },
        edit: { any: [{ contains: "governing law", word: true }, { contains: "jurisdiction", word: true }] } },
    ],
    controls: [
      { id: "K1", spans: [{ paragraph: 11, quote: "shall not be liable for indirect" }], clean: { paragraphs: [11, 11], contains: "shall not be liable", word: true } },
      { id: "K2", spans: [{ paragraph: 13, quote: "due within 30 days" }], clean: { paragraphs: [13, 13], contains: "30 days", word: true } },
    ],
  };
}

/** One edit of an applier plan. */
export function e6Edit(id: string, action: string, anchor: string, rationale: string, newText?: string): Record<string, string> {
  return { id, anchor, action, rationale, severity: "medium", ...(newText === undefined ? {} : { newText }) };
}

/** A plan that addresses all five plants and changes no control; the agreement's clean text after it, by paragraph. */
export const E6_GOOD_EDITS = Object.freeze([
  e6Edit("E1", "replace", "a fee of 12,500", "The table gives 11,500.", "a fee of 11,500"),
  e6Edit("E2", "comment", "Section 7", "Termination is clause 3."),
  e6Edit("E3", "replace", "14,500", "The rows sum to 13,500.", "13,500"),
  e6Edit("E4", "replace", "does not warrant", "The disclaimer contradicts clause 6.", "warrants"),
  e6Edit("E5", "insert_after", "Notices are given in writing.", "No clause on the law that applies.", " 10. Governing law. English law governs this agreement."),
]);
export const E6_GOOD_CLEAN: Readonly<Record<number, string>> = Object.freeze({
  2: "1. Fees. The Client shall pay a fee of 11,500 per month.", 10: "13,500",
  16: "7. Disclaimer. The Supplier warrants the services will be performed with care.",
  17: "8. Notices. Notices are given in writing. 10. Governing law. English law governs this agreement.",
});

/**
 * A plan that marks one plant without fixing it, misses others, meets the missing section only through its rationale, keeps one control
 * and changes the other. Its first five edits are a plan the applier accepts; the last two have anchors it would refuse, once missing
 * and once repeated, so the scorer cannot place them.
 */
export const E6_HARM_EDITS = Object.freeze([
  e6Edit("E1", "comment", "a fee of 12,500", "Check this figure."),
  e6Edit("E2", "replace", "shall not be liable", "Simpler.", "shall be liable"),
  e6Edit("E3", "replace", "Invoices are due", "Wording.", "Invoices fall due"),
  e6Edit("E4", "insert_after", "9. Signatures.", "Governing law is missing; add it.", " Signed in two copies."),
  e6Edit("E5", "replace", "Total", "Label.", "Sum"),
  e6Edit("E6", "comment", "Nowhere in the text", "Unplaced: not in the source."),
  e6Edit("E7", "comment", "The Supplier", "Unplaced: in four paragraphs."),
]);
export const E6_HARM_CLEAN: Readonly<Record<number, string>> = Object.freeze({
  9: "Sum", 11: "2. Liability. The Supplier shall be liable for indirect losses.", 13: "4. Payment. Invoices fall due within 30 days.",
  18: "9. Signatures. Signed in two copies.",
});
