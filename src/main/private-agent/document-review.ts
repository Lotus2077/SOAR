import { deflateSync } from "node:zlib";

import { canonical, digest } from "./contracts";
import { GeneralJobContractSchema, type ArtifactCheck } from "./runner";
import type { SessionFile, SessionPhase } from "./session";

/**
 * PR-I: document review on the qualified image (design section 4). The model writes an edit plan and never markup;
 * the host-owned applier below turns it into native tracked changes, a comment per edit, an issues list, a clean
 * amended copy and a hygiene report; the finish check re-runs the pinned applier and proves the result independently.
 * Both Python sources are raw literals: they must stay free of backticks and dollar-brace sequences.
 */
export const DOCUMENT_REVIEW_CHECK_ID = "document_review_fidelity";
export const DOCUMENT_REVIEW_APPLIER_PATH = "review/soar_redline.py";
export const DOCUMENT_REVIEW_EDITS_PATH = "review/edits.json";
export const DOCUMENT_REVIEW_ARTIFACTS: readonly { path: string; description: string }[] = Object.freeze([
  { path: DOCUMENT_REVIEW_EDITS_PATH, description: "Edit plan: one entry per proposed change or comment, anchored on a verbatim quote." },
  { path: "output/redline.docx", description: "The source with every edit as a tracked change by \"SOAR draft\" and a comment per edit." },
  { path: "output/clean.docx", description: "The source with every edit accepted and no revisions." },
  { path: "output/issues.xlsx", description: "Issues list: one row per edit." },
  { path: "output/hygiene.json", description: "Author metadata, comment authors, revisions and hidden text that would leave with the files." },
]);
/** The one .docx under input/ (top level only; any .docx deeper makes the source ambiguous). */
const SOURCE_PATH = /^input\/[^\u0000-\u001f/\\]{1,200}\.docx$/iu;
const ANY_DOCX = /^input\/.*\.docx$/iu;

const APPLIER = String.raw`"""SOAR redline applier (host-owned and pinned; do not edit).

usage: python3 -I review/soar_redline.py SOURCE.docx EDITS.json OUTDIR
       python3 -I review/soar_redline.py --list SOURCE.docx [FIRST]

Applies a JSON edit plan to a DOCX without the model writing any markup. Writes:
  OUTDIR/redline.docx  native tracked changes by "SOAR draft", one comment per edit
  OUTDIR/clean.docx    every edit accepted, no revisions
  OUTDIR/issues.xlsx   one row per edit
  OUTDIR/hygiene.json  metadata that would leave with the files
Only word/document.xml changes (plus the comments part and its registration in the
redline); every other part is copied byte for byte, with fixed zip timestamps, so the
same inputs always give the same bytes. In the text it shows, U+FFFC marks an object
(footnote or endnote mark, image, symbol) that no anchor may cross; --list prints at most
48 KB from paragraph FIRST and ends with {"next": N} when more remain. Exit 0 on success.
Exit 2, with {"ok": false, "errors": [...]} on stdout, when the plan cannot be applied
exactly; exit 1 with the same shape on an internal error.
"""
import copy
import hashlib
import io
import json
import os
import re
import sys
import time
import zipfile

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W15 = "http://schemas.microsoft.com/office/word/2012/wordml"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
COMMENTS_REL = R + "/comments"
COMMENTS_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
XML_NS = "http://www.w3.org/XML/1998/namespace"
AUTHOR = "SOAR draft"
INITIALS = "SD"
DOCUMENT = "word/document.xml"
COMMENTS = "word/comments.xml"
CONTENT_TYPES = "[Content_Types].xml"
DOCUMENT_RELS = "word/_rels/document.xml.rels"
STORY_PART = re.compile(r"^word/(header[0-9]*|footer[0-9]*|footnotes|endnotes|comments|glossary/document)\.xml$")
MAX_EDITS = 200
MAX_ENTRIES = 2000
MAX_SOURCE_BYTES = 24 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_PART_BYTES = 16 * 1024 * 1024
MAX_PLAN_BYTES = 1024 * 1024
DEADLINE_SECONDS = 30
LIST_BYTES = 48 * 1024
# Content a run may hold beside text; a run mixing them is split into one run per piece before anchoring.
RUN_PIECES = ("t", "tab", "ptab", "br", "cr", "noBreakHyphen", "softHyphen")
# Schema order of run properties: an explicit "not hidden" goes after these and before the rest.
RPR_BEFORE_VANISH = ("rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow",
                     "emboss", "imprint", "noProof", "snapToGrid")
LOOKALIKES = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u00a0": " ", "\u2011": "-", "\u2010": "-",
                            "\u2013": "-", "\u2014": "-", "\u00ad": ""})
ACTIONS = ("replace", "delete", "insert_after", "comment")
SEVERITIES = ("high", "medium", "low")
REVISION_TAGS = ("ins", "del", "moveFrom", "moveTo", "moveFromRangeStart", "moveToRangeStart", "rPrChange", "pPrChange",
                 "sectPrChange", "tblPrChange", "tblGridChange", "trPrChange", "tcPrChange", "numberingChange", "cellIns", "cellDel", "cellMerge")
# Zero-length markup that may sit inside an anchor and moves with a deletion; anything else between the cut runs refuses the anchor.
MARKERS = ("bookmarkStart", "bookmarkEnd", "proofErr", "permStart", "permEnd")
OBJECTS = ("sym", "footnoteReference", "endnoteReference", "drawing", "pict", "object")
HIDDEN = ("vanish", "specVanish", "webHidden")
FIXED_TIME = (1980, 1, 1, 0, 0, 0)
ID_RE = re.compile(r"^E[0-9]{1,3}$")
INVALID_RE = re.compile("[\x00-\x1f\x7f\ud800-\udfff￾￿￼]")
NUMBER_RE = re.compile(r"^[0-9]{1,9}$")
ISSUE_HEADERS = ("Edit", "Severity", "Action", "Paragraph", "Anchor", "New text", "Rationale", "Revision ids", "Comment id")
CORE_XML = (b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            b'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            b'<dc:creator>SOAR draft</dc:creator></cp:coreProperties>')
STARTED = time.monotonic()


class PlanError(Exception):
    def __init__(self, errors):
        super().__init__("plan_error")
        self.errors = errors


def w(name):
    return "{%s}%s" % (W, name)


def local(element):
    return etree.QName(element).localname if isinstance(element.tag, str) else ""


def parse_xml(data):
    parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False, remove_blank_text=False)
    return etree.fromstring(data, parser)


def serialize(root):
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def on_time():
    # The host check re-derives the outputs with its own process timeout instead, so its verdict depends only on the inputs.
    if os.environ.get("SOAR_REDLINE_NO_DEADLINE") != "1" and time.monotonic() - STARTED > DEADLINE_SECONDS:
        raise PlanError([{"code": "source_too_complex", "note": "the document or plan takes too long to apply; split the review"}])


def off(value):
    return value in ("0", "false", "off")


# ---------- the edit plan ----------

def load_plan(raw):
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise PlanError([{"code": "plan_not_json"}])
    if not isinstance(data, dict) or data.get("version") != 1 or set(data) != {"version", "edits"} or not isinstance(data["edits"], list):
        raise PlanError([{"code": "plan_shape_invalid", "expected": "{\"version\": 1, \"edits\": [...]}"}])
    edits, errors, seen = data["edits"], [], set()
    if not 1 <= len(edits) <= MAX_EDITS:
        raise PlanError([{"code": "edit_count_invalid", "max": MAX_EDITS}])
    for index, edit in enumerate(edits):
        label = edit.get("id") if isinstance(edit, dict) and isinstance(edit.get("id"), str) else "#%d" % (index + 1)
        if not isinstance(edit, dict):
            errors.append({"id": label, "code": "edit_not_object"})
            continue
        action = edit.get("action")
        if action not in ACTIONS:
            errors.append({"id": label, "code": "action_invalid", "allowed": list(ACTIONS)})
            continue
        allowed = {"id", "anchor", "action", "rationale", "severity"} | ({"newText"} if action in ("replace", "insert_after") else set())
        if set(edit) != allowed:
            errors.append({"id": label, "code": "fields_invalid", "expected": sorted(allowed)})
            continue
        if not isinstance(edit["id"], str) or not ID_RE.match(edit["id"]) or edit["id"] in seen:
            errors.append({"id": label, "code": "id_invalid_or_duplicate", "note": "ids are E1, E2, ... and unique"})
        else:
            seen.add(edit["id"])
        for field, limit in (("anchor", 1000), ("rationale", 1000)) + ((("newText", 4000),) if "newText" in allowed else ()):
            value = edit[field]
            if not isinstance(value, str) or not 1 <= len(value) <= limit or INVALID_RE.search(value):
                errors.append({"id": label, "code": field + "_invalid", "maxChars": limit, "note": "non-empty, one line, no control characters"})
        if edit["severity"] not in SEVERITIES:
            errors.append({"id": label, "code": "severity_invalid", "allowed": list(SEVERITIES)})
    if errors:
        raise PlanError(errors)
    return edits


# ---------- the document model ----------

def body_paragraphs(root):
    body = root.find(w("body"))
    if body is None:
        raise PlanError([{"code": "source_body_missing"}])
    return [p for p in body.iter(w("p")) if not any(local(a) == "txbxContent" for a in p.iterancestors())]


def view_text(element, mode, inside_ins=False, inside_del=False):
    """Text of an element: "accept" drops deletions, "reject" drops insertions, "plain" keeps everything. Objects show as U+FFFC."""
    out = []
    for child in element:
        name = local(child)
        if name in ("", "pPr", "rPr", "txbxContent"):
            continue
        shown = not (mode == "reject" and inside_ins) and not (mode == "accept" and inside_del)
        if name == "t":
            out.append((child.text or "") if shown else "")
        elif name == "delText":
            out.append((child.text or "") if mode in ("reject", "plain") and not inside_ins else "")
        elif name in ("tab", "ptab"):
            out.append("\t" if shown else "")
        elif name in ("br", "cr"):
            out.append("\n" if shown else "")
        elif name == "noBreakHyphen":
            out.append("‑" if shown else "")
        elif name == "softHyphen":
            out.append("­" if shown else "")
        elif name in OBJECTS:
            out.append("￼" if shown else "")
        else:
            out.append(view_text(child, mode, inside_ins or name == "ins", inside_del or name == "del"))
    return "".join(out)


def simple_run(element):
    """A run whose content is only text: the only kind of run an anchor may cut."""
    if local(element) != "r":
        return False
    kids = [k for k in element if isinstance(k.tag, str)]
    return all(local(k) in ("rPr", "t", "lastRenderedPageBreak") for k in kids) and any(local(k) == "t" for k in kids)


def explode_runs(paragraph):
    """Split every run that mixes text with tabs, breaks or special hyphens into one run per piece (formatting copied), so
    text beside a tab can be anchored while the tab itself cannot. Layout caches are dropped. Text is unchanged."""
    for run in [c for c in paragraph if local(c) == "r"]:
        kids = [k for k in run if isinstance(k.tag, str) and local(k) not in ("rPr", "lastRenderedPageBreak")]
        if len(kids) < 2 or not all(local(k) in RUN_PIECES for k in kids) or all(local(k) == "t" for k in kids):
            continue
        properties = run.find(w("rPr"))
        for kid in kids:
            piece = etree.Element(w("r"))
            if properties is not None:
                piece.append(copy.deepcopy(properties))
            piece.append(copy.deepcopy(kid))
            run.addprevious(piece)
        paragraph.remove(run)


def field_depths(paragraphs):
    """The complex-field nesting depth at the start of every paragraph: a field may open in one paragraph and close in a later one."""
    depths, depth = [], 0
    for paragraph in paragraphs:
        depths.append(depth)
        for char in paragraph.iter(w("fldChar")):
            kind = char.get(w("fldCharType"))
            depth = depth + 1 if kind == "begin" else depth - 1 if kind == "end" and depth > 0 else depth
    return depths


def segments(paragraph, depth):
    """(child, start, end, editable, field) for every direct child, in text order. Content inside a complex field (its
    instruction or its result, which a field update would overwrite) or a simple field is not editable."""
    out, offset = [], 0
    for child in paragraph:
        if not isinstance(child.tag, str) or local(child) == "pPr":
            continue
        length = len(view_text(child, "plain"))
        chars = [c.get(w("fldCharType")) for c in child.iter(w("fldChar"))]
        field = depth > 0 or bool(chars) or local(child) == "fldSimple"
        for kind in chars:
            depth = depth + 1 if kind == "begin" else depth - 1 if kind == "end" and depth > 0 else depth
        out.append((child, offset, offset + length, simple_run(child) and not field, field))
        offset += length
    return out


def search_text(paragraph, depth):
    """The plain text with field content masked, the same length as the plain text: a match lying wholly inside a field
    (a table of contents entry, a cross-reference) never counts, so it cannot make an anchor ambiguous."""
    return "".join("\x00" * (e - s) if field else view_text(child, "plain") for child, s, e, _, field in segments(paragraph, depth))


def blocker(child, field):
    if field:
        return "field"
    name = local(child)
    if name == "r":
        inner = [local(k) for k in child if isinstance(k.tag, str) and local(k) not in ("rPr", "t", "lastRenderedPageBreak")]
        return inner[0] if inner else "run"
    return name


def span_runs(segs, start, end):
    """(runs, None) for the runs that make up [start, end), or (None, blocker). Every text-bearing child overlapping the span
    must be an editable run, and everything between the first and last of them such a run or harmless markup (bookmarks,
    proofing marks): a deletion moves that whole range."""
    hits = [i for i, seg in enumerate(segs) if seg[1] < end and seg[2] > start and seg[2] > seg[1]]
    if not hits:
        return None, "empty"
    for child, s, e, editable, field in segs[hits[0]:hits[-1] + 1]:
        if not (editable or (local(child) in MARKERS and not field)):
            return None, blocker(child, field)
    return [segs[i][0] for i in hits], None


def boundary_ok(segs, position):
    """A comment may start or end here: inside an editable run, or between two children outside any field."""
    for child, s, e, editable, field in segs:
        if s < position < e:
            return editable, None if editable else blocker(child, field)
    before = [seg for seg in segs if seg[2] == position and seg[2] > seg[1]]
    after = [seg for seg in segs if seg[1] == position and seg[2] > seg[1]]
    if (before and before[-1][4] and after and after[0][4]):
        return False, "field"
    return True, None


def comment_span(segs, start, end):
    """A comment changes no text: it may cover links, fields or marks, as long as both ends are at clean boundaries."""
    for position in (start, end):
        ok, why = boundary_ok(segs, position)
        if not ok:
            return None, why
    nodes = [seg[0] for seg in segs if seg[1] < end and seg[2] > start and seg[2] > seg[1]]
    return (nodes, None) if nodes else (None, "empty")


def insert_span(segs, start, end):
    """An insertion moves nothing: like a comment it may cover other content, but it needs plain text at its end to sit after."""
    nodes, why = comment_span(segs, start, end)
    if nodes is None:
        return None, why
    last = [seg for seg in segs if seg[0] is nodes[-1]][0]
    return (nodes, None) if last[3] else (None, blocker(last[0], last[4]))


SPANS = {"replace": span_runs, "delete": span_runs, "insert_after": insert_span, "comment": comment_span}


def normalize_run(run):
    """Merge a simple run's text into one element, keeping spaces; drop layout caches."""
    for cache in [k for k in run if local(k) == "lastRenderedPageBreak"]:
        run.remove(cache)
    texts = [k for k in run if local(k) == "t"]
    value = "".join(t.text or "" for t in texts)
    for t in texts[1:]:
        run.remove(t)
    texts[0].text = value
    texts[0].set("{%s}space" % XML_NS, "preserve")


def split_at(paragraph, depth, position):
    for child, start, end, editable, _ in segments(paragraph, depth):
        if start < position < end:
            if not editable:
                return False
            normalize_run(child)
            text = [t for t in child if local(t) == "t"][0].text or ""
            twin = copy.deepcopy(child)
            [t for t in child if local(t) == "t"][0].text = text[:position - start]
            [t for t in twin if local(t) == "t"][0].text = text[position - start:]
            child.addnext(twin)
            return True
    return True


def sibling_range(first, last):
    out, node = [first], first
    while node is not last:
        node = node.getnext()
        out.append(node)
    return out


def new_run(template, text):
    """A run carrying the template's formatting and an explicit "not hidden": direct formatting beats any hidden paragraph or
    character style, so new text always shows."""
    run = etree.Element(w("r"))
    properties = template.find(w("rPr")) if template is not None else None
    properties = copy.deepcopy(properties) if properties is not None else etree.Element(w("rPr"))
    for element in [e for e in properties if local(e) in HIDDEN]:
        properties.remove(element)
    visible = etree.Element(w("vanish"), {w("val"): "0"})
    earlier = [e for e in properties if local(e) in RPR_BEFORE_VANISH]
    if earlier:
        earlier[-1].addnext(visible)
    else:
        properties.insert(0, visible)
    run.append(properties)
    t = etree.SubElement(run, w("t"))
    t.text = text
    t.set("{%s}space" % XML_NS, "preserve")
    return run


def numeric_ids(root):
    return [int(e.get(w("id"))) for e in root.iter() if isinstance(e.tag, str) and NUMBER_RE.match(e.get(w("id")) or "")]


# ---------- locating the plan in the source ----------

def find_all(texts, anchor, masks=None):
    hits = []
    for index, text in enumerate(texts):
        start = text.find(anchor)
        while start != -1:
            if masks is None or masks[index][start:start + len(anchor)].strip("\x00"):
                hits.append((index, start))
            start = text.find(anchor, start + 1)
    return hits


def locate(edits, paragraphs, depths):
    texts = [view_text(p, "plain") for p in paragraphs]
    searchable = [search_text(p, d) for p, d in zip(paragraphs, depths)]
    errors, located = [], []
    for position, edit in enumerate(edits):
        on_time()
        hits = find_all(texts, edit["anchor"], searchable)
        if not hits and find_all(texts, edit["anchor"]):
            errors.append({"id": edit["id"], "code": "anchor_inside_field",
                           "note": "this text is only inside a field (a table of contents entry, cross-reference or similar), which cannot be changed; anchor the text it refers to"})
            continue
        if not hits:
            error = {"id": edit["id"], "code": "anchor_not_found", "note": "quote the text of one paragraph exactly, as --list shows it"}
            lookalike = [t.translate(LOOKALIKES) for t in texts]
            near = find_all(lookalike, edit["anchor"].translate(LOOKALIKES), searchable) \
                if all(len(x) == len(t) for x, t in zip(lookalike, texts)) else []
            if len(near) == 1:
                index, start = near[0]
                error.update({"paragraph": index + 1, "documentText": texts[index][start:start + len(edit["anchor"])],
                              "note": "the document uses different quote, dash or space characters here; copy documentText exactly"})
            errors.append(error)
            continue
        if len(hits) > 1:
            errors.append({"id": edit["id"], "code": "anchor_not_unique", "count": len(hits), "note": "lengthen the anchor until it occurs once"})
            continue
        index, start = hits[0]
        located.append({"edit": edit, "index": position, "paragraph": index, "start": start, "end": start + len(edit["anchor"])})
    by_paragraph = {}
    for item in located:
        by_paragraph.setdefault(item["paragraph"], []).append(item)
    for number, items in by_paragraph.items():
        on_time()
        items.sort(key=lambda item: (item["start"], item["end"]))
        for left, right in zip(items, items[1:]):
            if right["start"] < left["end"]:
                errors.append({"id": right["edit"]["id"], "code": "edits_overlap", "with": left["edit"]["id"]})
        probe = copy.deepcopy(paragraphs[number])
        explode_runs(probe)
        segs = segments(probe, depths[number])
        for item in items:
            runs, why = SPANS[item["edit"]["action"]](segs, item["start"], item["end"])
            if runs is None:
                errors.append({"id": item["edit"]["id"], "code": "anchor_not_editable", "blocker": why,
                               "note": "only plain text can be changed: the anchor touches the blocker named here (a field, hyperlink, "
                                       "content control, someone's comment, a tab or break, a footnote mark or an image); shorten it to the plain text"})
    if errors:
        raise PlanError(errors)
    return located, texts


def expected_texts(located, texts):
    """The accept-all text of every paragraph, computed on strings alone."""
    result = list(texts)
    for item in sorted(located, key=lambda item: (item["paragraph"], -item["start"])):
        edit, text, s, e = item["edit"], result[item["paragraph"]], item["start"], item["end"]
        if edit["action"] == "replace":
            text = text[:s] + edit["newText"] + text[e:]
        elif edit["action"] == "delete":
            text = text[:s] + text[e:]
        elif edit["action"] == "insert_after":
            text = text[:e] + edit["newText"] + text[e:]
        result[item["paragraph"]] = text
    return result


# ---------- applying ----------

def assign_ids(located, roots):
    counter = max([n for root in roots for n in numeric_ids(root)] + [0]) + 1
    for item in sorted(located, key=lambda item: item["index"]):
        action = item["edit"]["action"]
        item["delId"] = counter if action in ("replace", "delete") else None
        counter += 1 if item["delId"] is not None else 0
        item["insId"] = counter if action in ("replace", "insert_after") else None
        counter += 1 if item["insId"] is not None else 0
        item["commentId"] = counter
        counter += 1


def cut(paragraph, depth, item):
    split_at(paragraph, depth, item["start"])
    split_at(paragraph, depth, item["end"])
    return SPANS[item["edit"]["action"]](segments(paragraph, depth), item["start"], item["end"])[0]


def apply_redline(paragraphs, depths, located):
    for item in sorted(located, key=lambda item: (item["paragraph"], -item["start"])):
        on_time()
        paragraph, depth, edit = paragraphs[item["paragraph"]], depths[item["paragraph"]], item["edit"]
        runs = cut(paragraph, depth, item)
        first, last = runs[0], runs[-1]
        if edit["action"] in ("replace", "delete"):
            deletion = etree.Element(w("del"), {w("id"): str(item["delId"]), w("author"): AUTHOR})
            first.addprevious(deletion)
            for node in sibling_range(runs[0], runs[-1]):
                if local(node) == "r":
                    normalize_run(node)
                deletion.append(node)
                for t in node.iter(w("t")):
                    t.tag = w("delText")
            first = last = deletion
        if edit["action"] in ("replace", "insert_after"):
            insertion = etree.Element(w("ins"), {w("id"): str(item["insId"]), w("author"): AUTHOR})
            insertion.append(new_run(runs[0] if edit["action"] == "replace" else runs[-1], edit["newText"]))
            last.addnext(insertion)
            last = insertion
        first.addprevious(etree.Element(w("commentRangeStart"), {w("id"): str(item["commentId"])}))
        end = etree.Element(w("commentRangeEnd"), {w("id"): str(item["commentId"])})
        last.addnext(end)
        reference = etree.Element(w("r"))
        etree.SubElement(reference, w("commentReference"), {w("id"): str(item["commentId"])})
        end.addnext(reference)


def apply_clean(paragraphs, depths, located):
    for item in sorted(located, key=lambda item: (item["paragraph"], -item["start"])):
        on_time()
        paragraph, depth, edit = paragraphs[item["paragraph"]], depths[item["paragraph"]], item["edit"]
        if edit["action"] == "comment":
            continue
        runs = cut(paragraph, depth, item)
        if edit["action"] == "insert_after":
            runs[-1].addnext(new_run(runs[-1], edit["newText"]))
            continue
        if edit["action"] == "replace":
            runs[0].addprevious(new_run(runs[0], edit["newText"]))
        for run in runs:
            paragraph.remove(run)


def comment_element(item):
    edit = item["edit"]
    comment = etree.Element(w("comment"), {w("id"): str(item["commentId"]), w("author"): AUTHOR, w("initials"): INITIALS})
    run = etree.SubElement(etree.SubElement(comment, w("p")), w("r"))
    t = etree.SubElement(run, w("t"))
    t.text = "%s [%s, %s]: %s" % (edit["id"], edit["severity"], edit["action"], edit["rationale"])
    t.set("{%s}space" % XML_NS, "preserve")
    return comment


def register_comments(content_types, relationships):
    """The content-type override and the relationship the comments need, added only where missing (None: unchanged)."""
    types, rels = parse_xml(content_types), parse_xml(relationships)
    new_types = new_rels = None
    if not any(o.get("PartName") == "/" + COMMENTS for o in types.iter("{%s}Override" % CT)):
        etree.SubElement(types, "{%s}Override" % CT, {"PartName": "/" + COMMENTS, "ContentType": COMMENTS_TYPE})
        new_types = serialize(types)
    if not any(r.get("Type") == COMMENTS_REL for r in rels.iter("{%s}Relationship" % PKG_REL)):
        existing = {r.get("Id") for r in rels.iter("{%s}Relationship" % PKG_REL)}
        rid, n = "rIdSoarComments", 1
        while rid in existing:
            n += 1
            rid = "rIdSoarComments%d" % n
        etree.SubElement(rels, "{%s}Relationship" % PKG_REL, {"Id": rid, "Type": COMMENTS_REL, "Target": "comments.xml"})
        new_rels = serialize(rels)
    return new_types, new_rels


def package(names, parts, replaced):
    """A zip with fixed timestamps and order: the same parts always give the same bytes."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as out:
        for name in names:
            info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            out.writestr(info, replaced.get(name, parts.get(name)))
    return buffer.getvalue()


def read_source(path):
    if os.path.getsize(path) > MAX_SOURCE_BYTES:
        raise PlanError([{"code": "source_too_large", "maxBytes": MAX_SOURCE_BYTES}])
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile):
        raise PlanError([{"code": "source_not_docx"}])
    infos = archive.infolist()
    if len(infos) > MAX_ENTRIES or sum(i.file_size for i in infos) > MAX_TOTAL_BYTES or any(i.file_size > MAX_PART_BYTES for i in infos):
        raise PlanError([{"code": "source_too_large", "maxBytes": MAX_TOTAL_BYTES}])
    names = [i.filename for i in infos]
    if len(set(names)) != len(names) or DOCUMENT not in names or CONTENT_TYPES not in names or DOCUMENT_RELS not in names:
        raise PlanError([{"code": "source_not_docx"}])
    if "word/vbaProject.bin" in names:
        raise PlanError([{"code": "source_macro_enabled"}])
    parts = {name: archive.read(name) for name in names}
    rels = parse_xml(parts[DOCUMENT_RELS])
    if COMMENTS not in parts and any(r.get("Type") == COMMENTS_REL for r in rels.iter("{%s}Relationship" % PKG_REL)):
        raise PlanError([{"code": "source_comments_inconsistent"}])
    return names, parts


# ---------- reporting ----------

def hidden_styles(parts):
    """Style ids whose resolved run properties hide text, following basedOn chains."""
    if "word/styles.xml" not in parts:
        return set()
    own, parent = {}, {}
    for style in parse_xml(parts["word/styles.xml"]).iter(w("style")):
        sid = style.get(w("styleId"))
        vanish = [v for v in style.iter(w("vanish"))]
        own[sid] = None if not vanish else not off(vanish[-1].get(w("val")))
        based = style.find(w("basedOn"))
        parent[sid] = based.get(w("val")) if based is not None else None
    hidden = set()
    for sid in own:
        seen, current = set(), sid
        while current in own and current not in seen and own[current] is None:
            seen.add(current)
            current = parent.get(current)
        if own.get(current):
            hidden.add(sid)
    return hidden


def run_hidden(run, paragraph_hidden, styles):
    properties = run.find(w("rPr"))
    direct = properties.find(w("vanish")) if properties is not None else None
    if direct is not None:
        return not off(direct.get(w("val")))
    style = properties.find(w("rStyle")) if properties is not None else None
    return paragraph_hidden or (style is not None and style.get(w("val")) in styles)


def paragraph_hidden_runs(paragraph, styles):
    style = paragraph.find(w("pPr") + "/" + w("pStyle"))
    hidden = style is not None and style.get(w("val")) in styles
    return sum(1 for run in paragraph.iter(w("r")) if run.find(w("t")) is not None and run_hidden(run, hidden, styles))


def hidden_runs(roots, styles):
    """Text runs that do not show: direct hidden formatting, or a hidden character or paragraph style."""
    return sum(paragraph_hidden_runs(p, styles) for root in roots for p in root.iter(w("p")))


def text_of(parts, name, wanted):
    if name not in parts:
        return {}
    return {local(e): e.text for e in parse_xml(parts[name]).iter() if local(e) in wanted and e.text}


def metadata(parts):
    """Who and what the files name outside the text: what would leave with them."""
    report = {"core": text_of(parts, "docProps/core.xml", ("creator", "lastModifiedBy", "title", "subject", "keywords", "description", "category")),
              "app": text_of(parts, "docProps/app.xml", ("Company", "Manager", "Template")),
              "customProperties": sorted(p.get("name") for p in parse_xml(parts["docProps/custom.xml"]).iter() if local(p) == "property" and p.get("name"))
              if "docProps/custom.xml" in parts else [],
              "people": sorted({p.get("{%s}author" % W15) for p in parse_xml(parts["word/people.xml"]).iter("{%s}person" % W15) if p.get("{%s}author" % W15)})
              if "word/people.xml" in parts else [],
              "attachedTemplate": None,
              "documentVariables": sorted(v.get(w("name")) for v in parse_xml(parts["word/settings.xml"]).iter(w("docVar")) if v.get(w("name")))
              if "word/settings.xml" in parts else []}
    if "word/_rels/settings.xml.rels" in parts:
        targets = [r.get("Target") for r in parse_xml(parts["word/_rels/settings.xml.rels"]).iter("{%s}Relationship" % PKG_REL)
                   if (r.get("Type") or "").endswith("/attachedTemplate")]
        report["attachedTemplate"] = targets[0] if targets else None
    return report


def revision_summary(root):
    revisions = [e for e in root.iter() if local(e) in REVISION_TAGS]
    return len(revisions), sorted({e.get(w("author")) for e in revisions if e.get(w("author"))})


def comment_summary(root):
    if root is None:
        return 0, []
    comments = root.findall(w("comment"))
    return len(comments), sorted({c.get(w("author")) for c in comments if c.get(w("author"))})


def write_issues(located):
    from openpyxl import Workbook
    book = Workbook()
    sheet = book.active
    sheet.title = "Issues"
    sheet.append(list(ISSUE_HEADERS))
    for item in sorted(located, key=lambda item: item["index"]):
        edit = item["edit"]
        revisions = ",".join(str(i) for i in (item["delId"], item["insId"]) if i is not None)
        values = (edit["id"], edit["severity"], edit["action"], item["paragraph"] + 1, edit["anchor"], edit.get("newText", ""),
                  edit["rationale"], revisions, item["commentId"])
        row = sheet.max_row + 1
        for column, value in enumerate(values, start=1):
            cell = sheet.cell(row=row, column=column)
            cell.value = value
            if isinstance(value, str):
                cell.data_type = "s"  # model text is never a formula
    raw = io.BytesIO()
    book.save(raw)
    written = zipfile.ZipFile(io.BytesIO(raw.getvalue()))
    names = [i.filename for i in written.infolist()]
    parts = {name: written.read(name) for name in names}
    return package(names, parts, {"docProps/core.xml": CORE_XML})


def run(source_path, plan_path, outdir):
    names, parts = read_source(source_path)
    with open(source_path, "rb") as handle:
        source_sha256 = hashlib.sha256(handle.read()).hexdigest()
    with open(plan_path, "rb") as handle:
        raw = handle.read(MAX_PLAN_BYTES + 1)
    if len(raw) > MAX_PLAN_BYTES:
        raise PlanError([{"code": "plan_too_large", "maxBytes": MAX_PLAN_BYTES}])
    edits = load_plan(raw)
    document = parse_xml(parts[DOCUMENT])
    stories = {name: parse_xml(parts[name]) for name in names if STORY_PART.match(name)}
    found = sorted({"%s:%s" % (name, local(e)) for name, root in [(DOCUMENT, document)] + sorted(stories.items()) for e in root.iter() if local(e) in REVISION_TAGS})
    if found:
        raise PlanError([{"code": "source_has_tracked_changes", "found": found[:20], "note": "accept or reject them before review"}])
    comments_root = stories.get(COMMENTS)
    styles = hidden_styles(parts)
    paragraphs = body_paragraphs(document)
    located, texts = locate(edits, paragraphs, field_depths(paragraphs))
    assign_ids(located, [document] + list(stories.values()))

    redline_doc, clean_doc = copy.deepcopy(document), copy.deepcopy(document)
    redline_paragraphs, clean_paragraphs = body_paragraphs(redline_doc), body_paragraphs(clean_doc)
    for number in sorted({item["paragraph"] for item in located}):
        explode_runs(redline_paragraphs[number])
        explode_runs(clean_paragraphs[number])
    apply_redline(redline_paragraphs, field_depths(redline_paragraphs), located)
    apply_clean(clean_paragraphs, field_depths(clean_paragraphs), located)
    expected = expected_texts(located, texts)
    if [view_text(p, "accept") for p in body_paragraphs(redline_doc)] != expected or \
       [view_text(p, "reject") for p in body_paragraphs(redline_doc)] != texts or \
       [view_text(p, "plain") for p in body_paragraphs(clean_doc)] != expected:
        raise PlanError([{"code": "internal_fidelity_failure"}])

    comments = copy.deepcopy(comments_root) if comments_root is not None else etree.Element(w("comments"), nsmap={"w": W})
    for item in sorted(located, key=lambda item: item["index"]):
        comments.append(comment_element(item))
    redline_parts = {DOCUMENT: serialize(redline_doc), COMMENTS: serialize(comments)}
    redline_names = list(names) + ([COMMENTS] if COMMENTS not in parts else [])
    new_types, new_rels = register_comments(parts[CONTENT_TYPES], parts[DOCUMENT_RELS])
    if new_types is not None:
        redline_parts[CONTENT_TYPES] = new_types
    if new_rels is not None:
        redline_parts[DOCUMENT_RELS] = new_rels
    other_stories = [root for name, root in stories.items() if name != COMMENTS]
    redline_revisions, redline_authors = revision_summary(redline_doc)
    source_comments, source_comment_authors = comment_summary(comments_root)
    redline_comments, redline_comment_authors = comment_summary(comments)
    hygiene = {
        "version": 1,
        "source": {"sha256": source_sha256, "metadata": metadata(parts), "comments": source_comments, "commentAuthors": source_comment_authors,
                   "hiddenRuns": hidden_runs([document] + other_stories, styles), "hiddenStyles": sorted(styles)},
        "redline": {"revisions": redline_revisions, "revisionAuthors": redline_authors, "comments": redline_comments,
                    "commentAuthors": redline_comment_authors, "hiddenRuns": hidden_runs([redline_doc] + other_stories, styles)},
        "clean": {"revisions": revision_summary(clean_doc)[0], "comments": source_comments, "commentAuthors": source_comment_authors,
                  "hiddenRuns": hidden_runs([clean_doc] + other_stories, styles)},
        "note": "Metadata, comment authors and hidden text are reported, not removed. Remove them before the files leave the machine if they must not be shared.",
    }
    outputs = {"redline.docx": package(redline_names, parts, redline_parts), "clean.docx": package(names, parts, {DOCUMENT: serialize(clean_doc)}),
               "issues.xlsx": write_issues(located),
               "hygiene.json": (json.dumps(hygiene, indent=1, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")}
    on_time()
    os.makedirs(outdir, exist_ok=True)
    for name, data in outputs.items():
        with open(os.path.join(outdir, name), "wb") as handle:
            handle.write(data)
    return {"ok": True, "edits": len(located), "revisions": redline_revisions, "comments": len(located),
            "outputs": [os.path.join(outdir, name) for name in outputs]}


def list_paragraphs(source_path, first):
    """One JSON line per body paragraph from the first one asked for, numbered as the issues list numbers them (table cells included), at most
    LIST_BYTES in all; a final {"next": N} says where to continue."""
    names, parts = read_source(source_path)
    styles = hidden_styles(parts)
    paragraphs = body_paragraphs(parse_xml(parts[DOCUMENT]))
    used = 0
    for number in range(first, len(paragraphs) + 1):
        paragraph = paragraphs[number - 1]
        line = {"paragraph": number, "text": view_text(paragraph, "plain")}
        if paragraph_hidden_runs(paragraph, styles):
            line["hiddenText"] = True
        encoded = json.dumps(line, ensure_ascii=False)
        if used and used + len(encoded.encode("utf-8")) > LIST_BYTES:
            print(json.dumps({"next": number, "of": len(paragraphs)}))
            return
        if not used and len(encoded.encode("utf-8")) > LIST_BYTES:
            encoded = json.dumps({"paragraph": number, "text": line["text"][:8000], "truncated": True}, ensure_ascii=False)
        print(encoded)
        used += len(encoded.encode("utf-8")) + 1


def main(argv):
    try:
        if len(argv) in (3, 4) and argv[1] == "--list":
            first = argv[3] if len(argv) == 4 else "1"
            if not NUMBER_RE.match(first) or int(first) < 1:
                raise PlanError([{"code": "list_start_invalid"}])
            list_paragraphs(argv[2], int(first))
            return 0
        if len(argv) != 4:
            print("\n".join(__doc__.strip().splitlines()[2:4]))
            return 2
        print(json.dumps(run(argv[1], argv[2], argv[3]), ensure_ascii=False))
        return 0
    except PlanError as error:
        print(json.dumps({"ok": False, "errors": error.errors[:50]}, ensure_ascii=False))
        return 2
    except OSError as error:
        print(json.dumps({"ok": False, "errors": [{"code": "file_error", "detail": type(error).__name__}]}))
        return 2
    except etree.XMLSyntaxError:
        print(json.dumps({"ok": False, "errors": [{"code": "source_xml_invalid"}]}))
        return 2
    except Exception as error:  # never a traceback: the agent gets a structured answer
        print(json.dumps({"ok": False, "errors": [{"code": "internal_error", "detail": type(error).__name__}]}))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
`;

const CHECK = String.raw`import base64, hashlib, json, os, subprocess, sys, tempfile, zipfile, zlib
from lxml import etree

PARAMS = json.loads(base64.b64decode("__PARAMS__"))
SOURCE, SOURCE_SHA256, APPLIER_SHA256 = PARAMS["source"], PARAMS["sourceSha256"], PARAMS["applierSha256"]
APPLIER = zlib.decompress(base64.b64decode("__APPLIER_Z__"))
APPLIER_PATH = "review/soar_redline.py"
EDITS = "review/edits.json"
OUTPUTS = ("output/redline.docx", "output/clean.docx", "output/issues.xlsx", "output/hygiene.json")
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
AUTHOR = "SOAR draft"
DOCUMENT, COMMENTS, CONTENT_TYPES, DOCUMENT_RELS = "word/document.xml", "word/comments.xml", "[Content_Types].xml", "word/_rels/document.xml.rels"
MARKERS = ("bookmarkStart", "bookmarkEnd", "proofErr", "permStart", "permEnd")
OBJECTS = ("sym", "footnoteReference", "endnoteReference", "drawing", "pict", "object")
REVISION_TAGS = ("ins", "del", "moveFrom", "moveTo", "moveFromRangeStart", "moveToRangeStart", "rPrChange", "pPrChange", "sectPrChange",
                 "tblPrChange", "tblGridChange", "trPrChange", "tcPrChange", "numberingChange", "cellIns", "cellDel", "cellMerge")
failures = []


def fail(code, **detail):
    failures.append(dict(code=code, **detail))


def finish():
    print(json.dumps({"passed": not failures, "failures": failures[:40]}, sort_keys=True))
    sys.exit(0 if not failures else 1)


def w(name):
    return "{%s}%s" % (W, name)


def local(element):
    return etree.QName(element).localname if isinstance(element.tag, str) else ""


def xml(data):
    return etree.fromstring(data, etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    with open(path, "rb") as handle:
        return handle.read()


def text(element, mode, ins=False, dele=False):
    out = []
    for child in element:
        name = local(child)
        if name in ("", "pPr", "rPr", "txbxContent"):
            continue
        shown = not (mode == "reject" and ins) and not (mode == "accept" and dele)
        if name == "t":
            out.append((child.text or "") if shown else "")
        elif name == "delText":
            out.append((child.text or "") if mode in ("reject", "plain") and not ins else "")
        elif name in ("tab", "ptab"):
            out.append("\t" if shown else "")
        elif name in ("br", "cr"):
            out.append("\n" if shown else "")
        elif name == "noBreakHyphen":
            out.append("\u2011" if shown else "")
        elif name == "softHyphen":
            out.append("\u00ad" if shown else "")
        elif name in OBJECTS:
            out.append("\ufffc" if shown else "")
        else:
            out.append(text(child, mode, ins or name == "ins", dele or name == "del"))
    return "".join(out)


def paragraphs(root):
    return [p for p in root.find(w("body")).iter(w("p")) if not any(local(a) == "txbxContent" for a in p.iterancestors())]


def searchable(paras):
    """Plain text with field content masked, as the applier searches it: field results never make an anchor ambiguous."""
    depth, out = 0, []
    for p in paras:
        pieces = []
        for child in p:
            if not isinstance(child.tag, str) or local(child) == "pPr":
                continue
            value = text(child, "plain")
            chars = [c.get(w("fldCharType")) for c in child.iter(w("fldChar"))]
            field = depth > 0 or bool(chars) or local(child) == "fldSimple"
            for kind in chars:
                depth = depth + 1 if kind == "begin" else depth - 1 if kind == "end" and depth > 0 else depth
            pieces.append("\x00" * len(value) if field else value)
        out.append("".join(pieces))
    return out


# 1. The source and the applier are the host's.
if not os.path.isfile(SOURCE) or sha(read(SOURCE)) != SOURCE_SHA256:
    fail("source_changed")
if not os.path.isfile(APPLIER_PATH) or sha(read(APPLIER_PATH)) != APPLIER_SHA256 or sha(APPLIER) != APPLIER_SHA256:
    fail("applier_changed")
for path in (EDITS,) + OUTPUTS:
    if not os.path.isfile(path):
        fail("artifact_missing", path=path)
if failures:
    finish()

# 2. The outputs are exactly what the pinned applier makes of this plan.
# The verifier's /tmp is small; its workspace is a disposable copy with room for the derived files and the renders.
scratch = tempfile.mkdtemp(prefix=".soar-review-check-", dir=os.getcwd())
script = os.path.join(scratch, "soar_redline.py")
with open(script, "wb") as handle:
    handle.write(APPLIER)
derived = os.path.join(scratch, "out")
try:
    # The verdict must depend only on the inputs: the applier's own wall-clock deadline is off here; this timeout bounds it.
    result = subprocess.run([sys.executable, "-I", script, SOURCE, EDITS, derived], capture_output=True, timeout=40,
                            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": "/tmp", "SOAR_REDLINE_NO_DEADLINE": "1"})
except subprocess.TimeoutExpired:
    fail("applier_timeout")
    finish()
if result.returncode != 0:
    fail("applier_refused_plan", detail=result.stdout.decode("utf-8", "replace")[:2000])
    finish()
# Every output, the issues list and the hygiene report included, is byte for byte what the applier makes.
for name in ("redline.docx", "clean.docx", "issues.xlsx", "hygiene.json"):
    if read("output/" + name) != read(os.path.join(derived, name)):
        fail("output_differs", path="output/" + name)
if failures:
    finish()
from openpyxl import load_workbook
issue_rows = [[(cell.value, cell.data_type) for cell in row] for row in load_workbook("output/issues.xlsx").active.iter_rows()]

# 3. Independent fidelity: text views, untouched parts, revisions mapped to edits.
source, redline, clean = (zipfile.ZipFile(p) for p in (SOURCE, "output/redline.docx", "output/clean.docx"))
source_names = [i.filename for i in source.infolist()]
added_comments = COMMENTS not in source_names
if [i.filename for i in redline.infolist()] != source_names + ([COMMENTS] if added_comments else []):
    fail("redline_parts_changed")
if [i.filename for i in clean.infolist()] != source_names:
    fail("clean_parts_changed")
touched = {DOCUMENT, COMMENTS, CONTENT_TYPES, DOCUMENT_RELS}
for name in source_names:
    if name not in touched:
        if redline.read(name) != source.read(name):
            fail("redline_part_modified", part=name)
        if clean.read(name) != source.read(name):
            fail("clean_part_modified", part=name)
    if name in (CONTENT_TYPES, DOCUMENT_RELS, COMMENTS) and clean.read(name) != source.read(name):
        fail("clean_part_modified", part=name)
def entries(data, tag):
    return {tuple(sorted(e.attrib.items())) for e in xml(data) if local(e) == tag}


# The only change allowed to the package registry: the comments part's content type and relationship, where they were missing.
if redline.read(CONTENT_TYPES) != source.read(CONTENT_TYPES):
    before, after = (entries(z.read(CONTENT_TYPES), "Override") for z in (source, redline))
    if before - after or len(after - before) != 1 or dict(next(iter(after - before))).get("PartName") != "/" + COMMENTS or \
       entries(source.read(CONTENT_TYPES), "Default") != entries(redline.read(CONTENT_TYPES), "Default"):
        fail("content_types_changed_beyond_comments")
if redline.read(DOCUMENT_RELS) != source.read(DOCUMENT_RELS):
    before, after = (entries(z.read(DOCUMENT_RELS), "Relationship") for z in (source, redline))
    if before - after or len(after - before) != 1 or dict(next(iter(after - before))).get("Target") != "comments.xml":
        fail("relationships_changed_beyond_comments")
source_doc, redline_doc, clean_doc = (xml(z.read(DOCUMENT)) for z in (source, redline, clean))
original = [text(p, "plain") for p in paragraphs(source_doc)]
masked = searchable(paragraphs(source_doc))
plan = json.loads(read(EDITS))["edits"]
expected, spans = list(original), []
for edit in plan:
    hits = []
    for i, t in enumerate(original):
        s = t.find(edit["anchor"])
        while s != -1:
            if masked[i][s:s + len(edit["anchor"])].strip("\x00"):
                hits.append((i, s))
            s = t.find(edit["anchor"], s + 1)
    if len(hits) != 1:
        fail("anchor_not_unique_in_source", id=edit["id"])
        finish()
    spans.append((hits[0][0], hits[0][1], edit))
for index, start, edit in sorted(spans, key=lambda s: (s[0], -s[1])):
    end, value = start + len(edit["anchor"]), expected[index]
    if edit["action"] == "replace":
        value = value[:start] + edit["newText"] + value[end:]
    elif edit["action"] == "delete":
        value = value[:start] + value[end:]
    elif edit["action"] == "insert_after":
        value = value[:end] + edit["newText"] + value[end:]
    expected[index] = value
if [text(p, "reject") for p in paragraphs(redline_doc)] != original:
    fail("reject_all_differs_from_original")
if [text(p, "accept") for p in paragraphs(redline_doc)] != expected:
    fail("accept_all_differs_from_plan")
if [text(p, "plain") for p in paragraphs(clean_doc)] != expected:
    fail("clean_differs_from_plan")
if any(local(e) in REVISION_TAGS for e in clean_doc.iter()):
    fail("clean_has_revisions")
if any(local(e) in REVISION_TAGS and local(e) not in ("ins", "del") for e in redline_doc.iter()):
    fail("redline_has_other_revisions")
# A deletion holds only deleted text runs and harmless markup; an insertion holds only new text runs.
for e in redline_doc.iter(w("del")):
    if any(not (local(c) in MARKERS or (local(c) == "r" and all(local(k) in ("rPr", "delText") for k in c))) for c in e):
        fail("deletion_holds_other_content", id=e.get(w("id")))
for e in redline_doc.iter(w("ins")):
    if any(not (local(c) == "r" and all(local(k) in ("rPr", "t") for k in c)) for c in e):
        fail("insertion_holds_other_content", id=e.get(w("id")))
    # New text carries an explicit "not hidden", which beats any hidden paragraph or character style.
    for run in e:
        vanish = run.find(w("rPr") + "/" + w("vanish"))
        if vanish is None or vanish.get(w("val")) not in ("0", "false", "off"):
            fail("insertion_may_be_hidden", id=e.get(w("id")))
if any(e.getparent() is None or not any(local(a) == "del" for a in e.iterancestors()) for e in redline_doc.iter(w("delText"))):
    fail("deleted_text_outside_deletion")

revisions = [e for e in redline_doc.iter() if local(e) in ("ins", "del")]
ids = [e.get(w("id")) for e in revisions]
if len(ids) != len(set(ids)):
    fail("revision_ids_not_unique")
if any(e.get(w("author")) != AUTHOR for e in revisions):
    fail("revision_author_invalid")
by_id = {e.get(w("id")): e for e in revisions}
comments = {c.get(w("id")): c for c in xml(redline.read(COMMENTS)).iter(w("comment"))}
references = {r.get(w("id")) for r in redline_doc.iter(w("commentReference"))}
table = issue_rows[1:]
if len(table) != len(plan) or [row[0][0] for row in table] != [edit["id"] for edit in plan]:
    fail("issues_do_not_match_plan")
    finish()
mapped = []
for edit, row in zip(plan, table):
    listed = [part for part in str(row[7][0] or "").split(",") if part]
    mapped.extend(listed)
    kinds = {"replace": ["del", "ins"], "delete": ["del"], "insert_after": ["ins"], "comment": []}[edit["action"]]
    if len(listed) != len(kinds) or any(by_id.get(i) is None or local(by_id[i]) != kind for i, kind in zip(listed, kinds)):
        fail("revision_not_mapped", id=edit["id"])
        continue
    for i, kind in zip(listed, kinds):
        if kind == "del" and "".join(t.text or "" for t in by_id[i].iter(w("delText"))) != edit["anchor"]:
            fail("deletion_differs_from_anchor", id=edit["id"])
        if kind == "ins" and "".join(t.text or "" for t in by_id[i].iter(w("t"))) != edit["newText"]:
            fail("insertion_differs_from_plan", id=edit["id"])
    comment = str(row[8][0])
    if comment not in comments or comments[comment].get(w("author")) != AUTHOR or comment not in references or \
       edit["rationale"] not in "".join(t.text or "" for t in comments[comment].iter(w("t"))):
        fail("comment_not_mapped", id=edit["id"])
if sorted(mapped) != sorted(ids):
    fail("revisions_without_edit")
if failures:
    finish()

# 4. Both documents render.
pdf = os.path.join(scratch, "pdf")
environment = {"HOME": "/tmp", "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}
try:
    rendered = subprocess.run(["libreoffice", "--headless", "--norestore", "-env:UserInstallation=file:///tmp/soar-review-lo", "--convert-to", "pdf",
                               "--outdir", pdf, "output/redline.docx", "output/clean.docx"], capture_output=True, timeout=40, env=environment)
    from pypdf import PdfReader
    for name in ("redline.pdf", "clean.pdf"):
        if not os.path.isfile(os.path.join(pdf, name)) or len(PdfReader(os.path.join(pdf, name)).pages) < 1:
            fail("render_failed", path=name)
except subprocess.TimeoutExpired:
    fail("render_timeout")
finish()
`;

export const DOCUMENT_REVIEW_APPLIER_SHA256 = digest(APPLIER);
/** The applier rides in the check once, compressed: the whole command must stay well under the sandbox's 64 KiB command cap. */
const APPLIER_COMPRESSED = deflateSync(Buffer.from(APPLIER, "utf8"), { level: 9 }).toString("base64");

/** The pinned applier as a workspace file. */
export function documentReviewApplierFile(): SessionFile {
  return { path: DOCUMENT_REVIEW_APPLIER_PATH, bytes: Buffer.from(APPLIER, "utf8") };
}

/** The finish check for one source document; its parameters travel as base64 JSON so no path can break the script. */
export function documentReviewCheck(input: { sourcePath: string; sourceSha256: string }): ArtifactCheck {
  if (!SOURCE_PATH.test(input.sourcePath) || !/^[a-f0-9]{64}$/u.test(input.sourceSha256)) throw new Error("document_review_source_invalid");
  const params = Buffer.from(canonical({ source: input.sourcePath, sourceSha256: input.sourceSha256, applierSha256: DOCUMENT_REVIEW_APPLIER_SHA256 })).toString("base64");
  return { id: DOCUMENT_REVIEW_CHECK_ID, python: CHECK.replace("__PARAMS__", params).replace("__APPLIER_Z__", APPLIER_COMPRESSED) };
}

/** A POSIX shell word: the instructions' commands must survive any file name. */
function shellWord(value: string): string { return `'${value.replace(/'/gu, "'\\''")}'`; }

/** What the agent is told; the checks, not this text, decide acceptance. */
export function documentReviewInstructions(sourcePath: string): string {
  const source = shellWord(sourcePath);
  return [
    `Document review (host-checked). Review ${sourcePath} as the task asks. Never edit the document, never write OOXML, and never change ${DOCUMENT_REVIEW_APPLIER_PATH}.`,
    `1. List the paragraphs as the host numbers them (table cells included): python3 -I ${DOCUMENT_REVIEW_APPLIER_PATH} --list ${source}. It prints about 48 KB at a time and ends with {"next": N} when more remain; continue with --list ${source} N. In that text U+FFFC marks a footnote mark, image or symbol, which no anchor may include; "hiddenText": true marks a paragraph with hidden text.`,
    `2. Write ${DOCUMENT_REVIEW_EDITS_PATH} as {"version":1,"edits":[...]} with at most 200 edits, ids E1, E2, ... in order. Each edit is {"id":"E1","anchor":"<text copied exactly from one paragraph>","action":"replace"|"delete"|"insert_after"|"comment","newText":"<replace and insert_after only>","rationale":"<why, one line>","severity":"high"|"medium"|"low"}. An anchor must occur exactly once in the document and must not overlap another anchor; lengthen it until it is unique. Text to replace or delete must be plain text: not a hyperlink, field, content control, tab, line break or someone's comment (a comment edit may cover those). Edits stay within a paragraph: a whole paragraph cannot be removed, so to drop a clause delete its text and say so in the rationale. newText and rationale are one line each.`,
    `3. Apply it: python3 -I ${DOCUMENT_REVIEW_APPLIER_PATH} ${source} ${DOCUMENT_REVIEW_EDITS_PATH} output. It writes output/redline.docx (tracked changes by "SOAR draft", your rationale as a comment on each edit), output/clean.docx (all edits accepted), output/issues.xlsx and output/hygiene.json, or prints errors to fix (anchor_not_found, which may give the exact documentText to copy; anchor_not_unique; anchor_not_editable, which names the blocker; anchor_inside_field; edits_overlap; and others). Re-run it after every change to the plan.`,
    `4. Do not modify those outputs by hand. At finish the host re-runs the applier on your plan and checks that rejecting every change restores the original text, accepting every change gives exactly your plan, nothing else in the file changed, every change maps to one edit, and both documents render.`,
  ].join("\n");
}

/** Adds the applier, the plan and outputs, the instructions and the fidelity check to a phase with exactly one source document. */
export function withDocumentReview(phase: SessionPhase): SessionPhase {
  const documents = phase.files.filter(file => ANY_DOCX.test(file.path));
  if (documents.length !== 1 || !SOURCE_PATH.test(documents[0]!.path)) throw new Error("document_review_source_invalid");
  const sources = documents;
  const reserved = new Set([DOCUMENT_REVIEW_APPLIER_PATH, ...DOCUMENT_REVIEW_ARTIFACTS.map(artifact => artifact.path)]);
  if (phase.files.some(file => reserved.has(file.path)) || phase.contract.requiredArtifacts.some(artifact => reserved.has(artifact.path)) ||
      phase.checks.some(check => check.id === DOCUMENT_REVIEW_CHECK_ID)) throw new Error("document_review_path_taken");
  const source = sources[0]!;
  const contract = { ...phase.contract, goal: `${phase.contract.goal}\n${documentReviewInstructions(source.path)}`,
    requiredArtifacts: [...phase.contract.requiredArtifacts, ...DOCUMENT_REVIEW_ARTIFACTS.map(artifact => ({ ...artifact }))],
    requiredChecks: [...phase.contract.requiredChecks, DOCUMENT_REVIEW_CHECK_ID] };
  // Refuse here, before any caller writes state, rather than when the session copies the phase.
  if (!GeneralJobContractSchema.safeParse(contract).success) throw new Error("document_review_contract_limits");
  return { ...phase, files: [...phase.files, documentReviewApplierFile()],
    checks: [...phase.checks, documentReviewCheck({ sourcePath: source.path, sourceSha256: digest(source.bytes) })], contract };
}
