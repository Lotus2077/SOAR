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


kind, path = sys.argv[1], sys.argv[2]
with open(path, "wb") as handle:
    handle.write({"nda": nda, "tracked": tracked, "commented": commented, "objects": objects, "header_tracked": header_tracked, "hidden": hidden,
                  "word_like": word_like, "long": long}[kind]())
`;

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
