/** Synthetic DOCX sources for the document-review tests, generated with python-docx inside the qualified image. */
export const DOCUMENT_FIXTURE_PY = String.raw`"""Synthetic DOCX fixtures for the document-review tests (python-docx inside the qualified image)."""
import io, sys
import docx
from docx.oxml.ns import qn
from lxml import etree


def nda():
    d = docx.Document()
    d.core_properties.author = "Synthetic Author"
    d.add_heading("Mutual Non-Disclosure Agreement", level=1)
    p = d.add_paragraph("1. The Recipient shall keep the ")
    r = p.add_run("Confidential Information"); r.bold = True
    p.add_run(" secret for a period of two (2) years from disclosure.")
    d.add_paragraph("2. This Agreement is governed by the laws of the State of Nowhere.")
    p = d.add_paragraph("3. Notices go to the address at ")
    link = etree.SubElement(p._p, qn("w:hyperlink")); lr = etree.SubElement(link, qn("w:r")); lt = etree.SubElement(lr, qn("w:t")); lt.text = "example.invalid/notices"
    p.add_run(" within five days.")
    p = d.add_paragraph("4. Page ")
    for kind, value in (("begin", None), ("instr", " PAGE "), ("separate", None), ("result", "1"), ("end", None)):
        run = etree.SubElement(p._p, qn("w:r"))
        if kind == "instr":
            t = etree.SubElement(run, qn("w:instrText")); t.text = value
        elif kind == "result":
            t = etree.SubElement(run, qn("w:t")); t.text = value
        else:
            etree.SubElement(run, qn("w:fldChar"), {qn("w:fldCharType"): kind})
    p.add_run(" of the agreement.")
    p = d.add_paragraph("5. 双方同意保密。 Édition annuelle applies. ")
    hidden = p.add_run("Hidden drafting note."); hidden.font.hidden = True
    t = d.add_table(rows=1, cols=2); t.cell(0, 0).text = "Term"; t.cell(0, 1).text = "Twenty-four months"
    p = d.add_paragraph("6. Bookmarked ")
    etree.SubElement(p._p, qn("w:bookmarkStart"), {qn("w:id"): "7", qn("w:name"): "clause6"})
    p.add_run("clause text"); etree.SubElement(p._p, qn("w:bookmarkEnd"), {qn("w:id"): "7"})
    p.add_run(" ends here.")
    b = io.BytesIO(); d.save(b); return b.getvalue()


def tracked():
    d = docx.Document(); p = d.add_paragraph("Already ")
    ins = etree.SubElement(p._p, qn("w:ins"), {qn("w:id"): "1", qn("w:author"): "Someone"}); r = etree.SubElement(ins, qn("w:r")); t = etree.SubElement(r, qn("w:t")); t.text = "revised"
    b = io.BytesIO(); d.save(b); return b.getvalue()


def commented():
    d = docx.Document(); p = d.add_paragraph("The fee is one hundred dollars per month."); d.add_comment(p.runs, text="Existing note", author="Counsel", initials="C")
    b = io.BytesIO(); d.save(b); return b.getvalue()



def objects():
    d = docx.Document()
    p = d.add_paragraph("The fee is one")
    etree.SubElement(etree.SubElement(p._p, qn("w:r")), qn("w:sym"), {qn("w:font"): "Wingdings", qn("w:char"): "F0FC"})
    p.add_run(" hundred pounds.")
    p = d.add_paragraph("Counsel noted that ")
    marked = p.add_run("the cap is low")
    p.add_run(" in this draft.")
    d.add_comment([marked], text="Raise the cap", author="Counsel", initials="C")
    b = io.BytesIO(); d.save(b); return b.getvalue()


def header_tracked():
    d = docx.Document(); d.add_paragraph("Body text for review.")
    header = d.sections[0].header.paragraphs[0]
    header.text = "Draft "
    ins = etree.SubElement(header._p, qn("w:ins"), {qn("w:id"): "1", qn("w:author"): "Opposing Counsel"})
    etree.SubElement(etree.SubElement(ins, qn("w:r")), qn("w:t")).text = "v7"
    b = io.BytesIO(); d.save(b); return b.getvalue()


def hidden():
    from docx.enum.style import WD_STYLE_TYPE
    d = docx.Document()
    p = d.add_paragraph("The parties agree as follows.")
    note = p.add_run(" [internal note]"); note.font.hidden = True
    style = d.styles.add_style("DraftNote", WD_STYLE_TYPE.PARAGRAPH); style.font.hidden = True
    d.add_paragraph("Drafting note for the partner only.", style="DraftNote")
    b = io.BytesIO(); d.save(b); return b.getvalue()


def field_run(p, kind, value=None):
    run = etree.SubElement(p._p, qn("w:r"))
    if kind == "instr":
        etree.SubElement(run, qn("w:instrText")).text = value
    elif kind == "text":
        etree.SubElement(run, qn("w:t")).text = value
    else:
        etree.SubElement(run, qn("w:fldChar"), {qn("w:fldCharType"): kind})


def word_like():
    """What Word writes: a table of contents repeating a heading, a tab inside a run, a page-break cache, a curly apostrophe."""
    d = docx.Document()
    toc = d.add_paragraph()
    for kind, value in (("begin", None), ("instr", " TOC \\o \"1-3\" "), ("separate", None), ("text", "Contents entry: Term and Termination"), ("end", None)):
        field_run(toc, kind, value)
    d.add_heading("Term and Termination", level=1)
    d.add_paragraph().add_run("1.1\tPayment is due within thirty days.")
    p = d.add_paragraph("2. The Supplier shall ")
    cached = p.add_run("indemnify")
    cached._r.insert(0, etree.Element(qn("w:lastRenderedPageBreak")))
    p.add_run(" the Client against claims.")
    d.add_paragraph("3. The Recipient\u2019s obligations survive termination.")
    b = io.BytesIO(); d.save(b); return b.getvalue()


def long():
    d = docx.Document()
    for n in range(1, 901):
        d.add_paragraph("Clause %d. The Supplier shall perform obligation number %d with due care and skill, and report progress monthly." % (n, n))
    b = io.BytesIO(); d.save(b); return b.getvalue()


def text_box(p, table):
    """Moves a table into a VML text box anchored in paragraph p: its paragraphs are not body paragraphs and its table is not numbered."""
    vml = "urn:schemas-microsoft-com:vml"
    shape = etree.SubElement(etree.SubElement(etree.SubElement(p._p, qn("w:r")), qn("w:pict")), "{%s}shape" % vml, {"style": "width:240pt;height:60pt"}, nsmap={"v": vml})
    content = etree.SubElement(etree.SubElement(shape, "{%s}textbox" % vml), qn("w:txbxContent"))
    content.append(table._tbl)
    etree.SubElement(content, qn("w:p"))


def flags():
    """Backlog item 7(d): a fee table its prose contradicts, and two clauses that differ by a negation; then a table in a text box, a table
    nested in another table's cell, a figure in hidden text and a REF field whose result contradicts the fee table."""
    d = docx.Document()
    d.add_paragraph("1. Fees are payable as set out in the table below.")
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text = "Item"; t.cell(0, 1).text = "Fee (USD)"
    t.cell(1, 0).text = "Late payment fee"; t.cell(1, 1).text = "50"
    d.add_paragraph("2. The late payment fee is USD 75 per invoice.")
    d.add_paragraph("3. The Supplier shall be liable for loss of data caused by its negligence.")
    d.add_paragraph("4. The Supplier shall not be liable for loss of data caused by its negligence.")
    p = d.add_paragraph("5. A draft fee table is kept in this box: ")
    boxed = d.add_table(rows=2, cols=2)
    boxed.cell(0, 0).text = "Item"; boxed.cell(0, 1).text = "Fee (USD)"
    boxed.cell(1, 0).text = "Late payment fee"; boxed.cell(1, 1).text = "99"
    text_box(p, boxed)
    outer = d.add_table(rows=3, cols=2)
    outer.cell(0, 0).text = "Item"; outer.cell(0, 1).text = "Notice (days)"
    nested = outer.cell(1, 0).add_table(rows=2, cols=2)
    nested.cell(0, 0).text = "Item"; nested.cell(0, 1).text = "Fee (USD)"
    nested.cell(1, 0).text = "Deposit amount"; nested.cell(1, 1).text = "10"
    outer.cell(2, 0).text = "Notice period"; outer.cell(2, 1).text = "30"
    p = d.add_paragraph("6. The deposit amount is ")
    p.add_run("USD 20").font.hidden = True
    p.add_run(".")
    d.add_paragraph("7. The notice period is 45 days.")
    p = d.add_paragraph("8. The late payment fee is set in ")
    for kind, value in (("begin", None), ("instr", " REF fee_clause \\h "), ("separate", None), ("text", "USD 90"), ("end", None)):
        field_run(p, kind, value)
    p.add_run(".")
    b = io.BytesIO(); d.save(b); return b.getvalue()


kind, path = sys.argv[1], sys.argv[2]
with open(path, "wb") as handle:
    handle.write({"nda": nda, "tracked": tracked, "commented": commented, "objects": objects, "header_tracked": header_tracked, "hidden": hidden,
                  "word_like": word_like, "long": long, "flags": flags}[kind]())
`;

/** Backlog item 7(d): the plan over the flags fixture, and what the host flags must record for it. */
export const FLAGS_EDITS = Object.freeze([
  { id: "E1", anchor: "USD 75", action: "comment", rationale: "Check the fee against the table.", severity: "medium" },
  { id: "E2", anchor: "shall not be liable", action: "replace", newText: "shall be liable", rationale: "Match clause 3.", severity: "high" },
]);
/**
 * Paragraphs as --list numbers them: the first table's four cells are 2-5, the fee sentence 6 and the two clauses 7 and 8. Paragraph 9 anchors
 * a text box whose table is neither numbered nor read. Table 2's cells are 10-12 and 17-20, around table 3, nested in its second row (13-16).
 * The deposit's figure is hidden text, which is read (21); the notice sentence is 22; the REF field's result in 23 is masked.
 */
export const FLAGS_EXPECTED = Object.freeze({
  counts: { numericSource: 3, numericUnaddressed: 2, numericIntroduced: 0, numericResolved: 0, inversionEdits: 1, inversionSource: 1, inversionUnaddressed: 0, inversionIntroduced: 0 },
  numeric: [
    { table: 1, row: 2, paragraph: 6, inSource: true, inClean: true, addressedBy: ["E1"], source: { row: ["50 USD"], prose: ["75 USD"] }, clean: { row: ["50 USD"], prose: ["75 USD"] } },
    { table: 2, row: 3, paragraph: 22, inSource: true, inClean: true, addressedBy: [], source: { row: ["30 day"], prose: ["45 day"] }, clean: { row: ["30 day"], prose: ["45 day"] } },
    { table: 3, row: 2, paragraph: 21, inSource: true, inClean: true, addressedBy: [], source: { row: ["10 USD"], prose: ["20 USD"] }, clean: { row: ["10 USD"], prose: ["20 USD"] } }],
  edits: [{ id: "E2", codes: ["negation_flipped"] }],
  clauses: [{ paragraphs: [7, 8], inSource: true, inClean: false, addressedBy: ["E2"] }],
  read: { comparisonsCapped: false, figuresCapped: false, labelsCapped: false, paragraphsClipped: 0, rowsCapped: false, sentencesCapped: false, termsCapped: false },
});

/** The flags fixture's word/document.xml by hand, with the structure python-docx writes for it (paragraphs, runs, tables, the text box and the field). */
export function flagsDocumentXml(): string {
  const run = (text: string, hidden = false) => `<w:r>${hidden ? "<w:rPr><w:vanish/></w:rPr>" : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  const paragraph = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;
  const table = (...rows: string[][]) => `<w:tbl>${rows.map(row => `<w:tr>${row.map(cell => `<w:tc>${cell}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
  const text = (value: string) => paragraph(run(value));
  const field = (kind: string) => `<w:r><w:fldChar w:fldCharType="${kind}"/></w:r>`;
  const box = table([text("Item"), text("Fee (USD)")], [text("Late payment fee"), text("99")]);
  const nested = table([text("Item"), text("Fee (USD)")], [text("Deposit amount"), text("10")]);
  return `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${[
    text("1. Fees are payable as set out in the table below."),
    table([text("Item"), text("Fee (USD)")], [text("Late payment fee"), text("50")]),
    text("2. The late payment fee is USD 75 per invoice."),
    text("3. The Supplier shall be liable for loss of data caused by its negligence."),
    text("4. The Supplier shall not be liable for loss of data caused by its negligence."),
    paragraph(run("5. A draft fee table is kept in this box: "), `<w:r><w:pict><v:shape><v:textbox><w:txbxContent>${box}<w:p/></w:txbxContent></v:textbox></v:shape></w:pict></w:r>`),
    table([text("Item"), text("Notice (days)")], [`<w:p/>${nested}<w:p/>`, "<w:p/>"], [text("Notice period"), text("30")]),
    paragraph(run("6. The deposit amount is "), run("USD 20", true), run(".")),
    text("7. The notice period is 45 days."),
    paragraph(run("8. The late payment fee is set in "), field("begin"), '<w:r><w:instrText xml:space="preserve"> REF fee_clause \\h </w:instrText></w:r>', field("separate"),
      run("USD 90"), field("end"), run(".")),
  ].join("")}<w:sectPr/></w:body></w:document>`;
}

/** A plan over the synthetic agreement: a bold run inside an anchor, a table cell, Chinese text, a bookmark inside a deletion, text after a field. */
export const AGREEMENT_EDITS = Object.freeze([
  { id: "E1", anchor: "keep the Confidential Information secret", action: "replace", newText: "protect the Confidential Information", rationale: "Clearer duty.", severity: "medium" },
  { id: "E2", anchor: "two (2) years", action: "replace", newText: "five (5) years", rationale: "=HYPERLINK(\"http://example.invalid\")", severity: "high" },
  { id: "E3", anchor: "State of Nowhere", action: "comment", rationale: "Confirm governing law.", severity: "low" },
  { id: "E4", anchor: " within five days", action: "delete", rationale: "Deadline set elsewhere.", severity: "low" },
  { id: "E5", anchor: "双方同意保密。", action: "insert_after", newText: " 期限为五年。", rationale: "Add the term in Chinese.", severity: "medium" },
  { id: "E6", anchor: "Twenty-four months", action: "replace", newText: "Sixty months", rationale: "Match clause 1.", severity: "high" },
  { id: "E7", anchor: "Bookmarked clause text", action: "delete", rationale: "Spans a bookmark.", severity: "low" },
  { id: "E8", anchor: " of the agreement.", action: "replace", newText: " of this Agreement.", rationale: "Defined term.", severity: "low" },
]);
