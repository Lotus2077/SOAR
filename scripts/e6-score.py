"""E6's planted-defect scorer, version 1.

Design: #135. Gold format: docs/experiments/e6-gold-format.md.

usage: python3 -I scripts/e6-score.py --version
       python3 -I scripts/e6-score.py --list SOURCE.docx
       python3 -I scripts/e6-score.py --check-gold GOLD.json SOURCE.docx
       python3 -I scripts/e6-score.py --gold GOLD.json LABEL=RUN_DIR [LABEL=RUN_DIR ...]

--gold reads each run directory's candidate/, the driver's final snapshot: review/edits.json, output/clean.docx, the source
input/*.docx and output/review-flags.json. It prints counts and codes only, never a word of any file. --list prints a source's
paragraphs, for the authoring session. Standard library only, Python 3.9 or later. No clock, randomness or environment is read, so
the same inputs give the same bytes. Exit 0 on success; 2 on a refusal, with {"ok": false, "errors": [...]}; 1 on an internal error.
"""
import hashlib
import json
import os
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

NAME = "e6-score"
VERSION = 1
GOLD_FORMAT = "soar-e6-gold"
GOLD_VERSION = 1

# ---------- ported from the applier (src/main/private-agent/document-review.ts); tests/unit/e6-score.test.ts pins them equal ----------
OBJECTS = ("sym", "footnoteReference", "endnoteReference", "drawing", "pict", "object")
LOOKALIKES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', " ": " ", "‑": "-", "‐": "-",
                            "–": "-", "—": "-", "­": ""})
ACTIONS = ("replace", "delete", "insert_after", "comment")
SEVERITIES = ("high", "medium", "low")
REVISION_TAGS = ("ins", "del", "moveFrom", "moveTo", "moveFromRangeStart", "moveToRangeStart", "rPrChange", "pPrChange",
                 "sectPrChange", "tblPrChange", "tblGridChange", "trPrChange", "tcPrChange", "numberingChange", "cellIns", "cellDel", "cellMerge")
ID_RE = re.compile(r"^E[0-9]{1,3}$")
INVALID_RE = re.compile("[\x00-\x1f\x7f\ud800-\udfff￾￿￼]")
MAX_EDITS = 200
MAX_SOURCE_BYTES = 24 * 1024 * 1024
MAX_PART_BYTES = 16 * 1024 * 1024
MAX_PLAN_BYTES = 1024 * 1024

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DOCUMENT = "word/document.xml"
FIELD_TAGS = ("fldSimple", "fldChar", "instrText")
SOURCE_NAME_RE = re.compile(r"^[^\x00-\x1f/\\]{1,200}\.docx$", re.IGNORECASE)

# ---------- the gold's format, version 1 ----------
CLASSES = ("clause_contradiction", "missing_section", "numeric", "reference_definition", "table_arithmetic")
SPAN_CLASSES = ("clause_contradiction", "numeric", "reference_definition", "table_arithmetic")
CHANGING_ACTIONS = ("replace", "delete", "insert_after")
# Opaque ids, so that no refusal can carry a word of the gold: D1, D2, ... for defects and K1, K2, ... for controls.
DEFECT_ID_RE = re.compile(r"^D[1-9][0-9]?$")
CONTROL_ID_RE = re.compile(r"^K[1-9][0-9]?$")
LABEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_GOLD_BYTES = 1024 * 1024
MAX_FLAGS_BYTES = 4 * 1024 * 1024
MAX_PARAGRAPHS = 100000
MAX_DEFECTS, MAX_CONTROLS, MAX_SPANS, MAX_MEMBERS, MAX_DEPTH = 32, 16, 8, 8, 4
MAX_QUOTE, MAX_LITERAL = 1000, 200
WHITESPACE_RE = re.compile(r"\s+")


class Refusal(Exception):
    """Refuses the whole invocation: the output is the error list, and no count is printed."""
    def __init__(self, errors):
        super().__init__("refused")
        self.errors = errors


class Unusable(Exception):
    """A file of one run that cannot be read; the run gets a status without counts."""
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def refuse(code, **fields):
    error = {"code": code}
    error.update(fields)
    raise Refusal([error])


# ---------- reading a .docx as the applier reads it ----------

def w(name):
    return "{%s}%s" % (W, name)


def local(element):
    tag = element.tag
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[1] if tag.startswith("{") else tag


def read_body(path):
    """The body of a .docx file's main document part, or Unusable."""
    try:
        if os.path.getsize(path) > MAX_SOURCE_BYTES:
            raise Unusable("docx_too_large")
        with zipfile.ZipFile(path) as archive:
            info = archive.getinfo(DOCUMENT)
            if info.file_size > MAX_PART_BYTES:
                raise Unusable("docx_too_large")
            data = archive.read(info)
    except Unusable:
        raise
    except (OSError, KeyError, EOFError, RuntimeError, ValueError, NotImplementedError, zipfile.BadZipFile, zipfile.LargeZipFile):
        raise Unusable("docx_unreadable")
    # No document type declaration, so no entity can expand: the applier's parser resolves none either.
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise Unusable("docx_xml_invalid")
    try:
        root = ET.fromstring(data)
    except (ET.ParseError, ValueError, RecursionError):
        raise Unusable("docx_xml_invalid")
    body = root.find(w("body")) if root.tag == w("document") else None
    if body is None:
        raise Unusable("docx_body_missing")
    return body


def body_paragraphs(body):
    """Every body paragraph in document order, table cells included and text boxes excluded: the applier's numbering."""
    found, stack = [], [iter(body)]
    while stack:
        child = next(stack[-1], None)
        if child is None:
            stack.pop()
            continue
        if local(child) == "txbxContent":
            continue
        if child.tag == w("p"):
            found.append(child)
        stack.append(iter(child))
    return found


def view_text(element, inside_ins=False):
    """The applier's plain view of an element: deletions kept, objects as U+FFFC (its view_text with mode "plain")."""
    out = []
    for child in element:
        name = local(child)
        if name in ("", "pPr", "rPr", "txbxContent"):
            continue
        if name == "t":
            out.append(child.text or "")
        elif name == "delText":
            out.append("" if inside_ins else (child.text or ""))
        elif name in ("tab", "ptab"):
            out.append("\t")
        elif name in ("br", "cr"):
            out.append("\n")
        elif name == "noBreakHyphen":
            out.append("‑")
        elif name == "softHyphen":
            out.append("­")
        elif name in OBJECTS:
            out.append("￼")
        else:
            out.append(view_text(child, inside_ins or name == "ins"))
    return "".join(out)


def paragraph_texts(body):
    try:
        return [view_text(paragraph) for paragraph in body_paragraphs(body)]
    except RecursionError:
        raise Unusable("docx_xml_invalid")


def has_markup(body, names):
    return any(local(element) in names for element in body.iter())


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_source(path):
    """A source's paragraph texts and sha256; refuses a source the gold cannot point into."""
    try:
        body = read_body(path)
        texts = paragraph_texts(body)
    except Unusable as error:
        refuse("source_" + error.code[len("docx_"):])
    if has_markup(body, FIELD_TAGS):
        refuse("source_has_fields", note="write cross-references as plain text")
    if has_markup(body, REVISION_TAGS):
        refuse("source_has_tracked_changes")
    return texts, file_sha256(path)


# ---------- the gold ----------

def strict_json(raw, code):
    def pairs(items):
        keys = [key for key, _ in items]
        if len(set(keys)) != len(keys):
            raise ValueError("duplicate key")
        return dict(items)
    def constant(name):
        raise ValueError("non-finite number")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeDecodeError, RecursionError):
        refuse(code)


def is_int(value):
    return type(value) is int


def exact_keys(value, keys, at):
    if not isinstance(value, dict) or set(value) != set(keys):
        refuse("gold_shape_invalid", at=at)


def text_value(value, limit, at):
    if not isinstance(value, str) or not 1 <= len(value) <= limit or INVALID_RE.search(value):
        refuse("gold_text_invalid", at=at, maxChars=limit, note="non-empty, one line, no control characters")


def paragraph_number(value, paragraphs, at):
    if not is_int(value) or not 1 <= value <= paragraphs:
        refuse("gold_paragraph_invalid", at=at, paragraphs=paragraphs)


def check_condition(value, kind, paragraphs, at, depth=1):
    """A condition's shape; kind is "clean" (tests over paragraphs of the clean copy) or "edit" (tests over an edit's own text)."""
    if depth > MAX_DEPTH:
        refuse("gold_condition_too_deep", at=at, maxDepth=MAX_DEPTH)
    if isinstance(value, dict) and len(value) == 1 and ("all" in value or "any" in value):
        key = "all" if "all" in value else "any"
        members = value[key]
        if not isinstance(members, list) or not 1 <= len(members) <= MAX_MEMBERS:
            refuse("gold_condition_invalid", at=at + "." + key, maxMembers=MAX_MEMBERS)
        for index, member in enumerate(members):
            check_condition(member, kind, paragraphs, "%s.%s[%d]" % (at, key, index), depth + 1)
        return
    test = "contains" if isinstance(value, dict) and "contains" in value else "lacks"
    exact_keys(value, (["paragraphs"] if kind == "clean" else []) + [test, "word"], at)
    text_value(value[test], MAX_LITERAL, at + "." + test)
    if not normalize(value[test]).strip():
        refuse("gold_text_invalid", at=at + "." + test, note="a literal needs more than whitespace")
    if not isinstance(value["word"], bool):
        refuse("gold_shape_invalid", at=at + ".word")
    if kind == "clean":
        bounds = value["paragraphs"]
        if not isinstance(bounds, list) or len(bounds) != 2:
            refuse("gold_shape_invalid", at=at + ".paragraphs")
        paragraph_number(bounds[0], paragraphs, at + ".paragraphs[0]")
        paragraph_number(bounds[1], paragraphs, at + ".paragraphs[1]")
        if bounds[0] > bounds[1]:
            refuse("gold_paragraph_invalid", at=at + ".paragraphs", note="first after last")


def check_spans(value, paragraphs, at):
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_SPANS:
        refuse("gold_shape_invalid", at=at, maxSpans=MAX_SPANS)
    for index, span in enumerate(value):
        where = "%s[%d]" % (at, index)
        exact_keys(span, ["paragraph", "quote"], where)
        paragraph_number(span["paragraph"], paragraphs, where + ".paragraph")
        text_value(span["quote"], MAX_QUOTE, where + ".quote")


def load_gold(path):
    """The gold file's content and sha256, its shape checked; checks against the source follow in bind_gold."""
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_GOLD_BYTES + 1)
    except OSError:
        refuse("gold_unreadable")
    if len(raw) > MAX_GOLD_BYTES:
        refuse("gold_too_large", maxBytes=MAX_GOLD_BYTES)
    gold = strict_json(raw, "gold_json_invalid")
    exact_keys(gold, ["format", "version", "source", "defects", "controls"], "gold")
    if gold["format"] != GOLD_FORMAT or not is_int(gold["version"]) or gold["version"] != GOLD_VERSION:
        refuse("gold_format_unsupported", expected={"format": GOLD_FORMAT, "version": GOLD_VERSION})
    exact_keys(gold["source"], ["sha256", "paragraphs"], "source")
    if not isinstance(gold["source"]["sha256"], str) or not SHA256_RE.match(gold["source"]["sha256"]):
        refuse("gold_shape_invalid", at="source.sha256")
    paragraphs = gold["source"]["paragraphs"]
    if not is_int(paragraphs) or not 1 <= paragraphs <= MAX_PARAGRAPHS:
        refuse("gold_shape_invalid", at="source.paragraphs")
    defects, controls = gold["defects"], gold["controls"]
    if not isinstance(defects, list) or not 1 <= len(defects) <= MAX_DEFECTS:
        refuse("gold_shape_invalid", at="defects", maxItems=MAX_DEFECTS)
    if not isinstance(controls, list) or not len(controls) <= MAX_CONTROLS:
        refuse("gold_shape_invalid", at="controls", maxItems=MAX_CONTROLS)
    seen = set()
    for kind, items in (("defects", defects), ("controls", controls)):
        id_re = DEFECT_ID_RE if kind == "defects" else CONTROL_ID_RE
        for index, item in enumerate(items):
            where = "%s[%d]" % (kind, index)
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not id_re.match(item["id"]):
                refuse("gold_id_invalid", at=where, expected=id_re.pattern)
            if item["id"] in seen:
                refuse("gold_id_duplicate", item=item["id"])
            seen.add(item["id"])
            if kind == "controls":
                exact_keys(item, ["id", "spans", "clean"], where)
                check_spans(item["spans"], paragraphs, where + ".spans")
                check_condition(item["clean"], "clean", paragraphs, where + ".clean")
            elif item.get("class") == "missing_section":
                exact_keys(item, ["id", "class", "region", "edit"], where)
                exact_keys(item["region"], ["first", "last"], where + ".region")
                paragraph_number(item["region"]["first"], paragraphs, where + ".region.first")
                paragraph_number(item["region"]["last"], paragraphs, where + ".region.last")
                if item["region"]["first"] > item["region"]["last"]:
                    refuse("gold_paragraph_invalid", at=where + ".region", note="first after last")
                check_condition(item["edit"], "edit", paragraphs, where + ".edit")
            elif item.get("class") in SPAN_CLASSES:
                comment_only = item.get("commentOnly")
                if not isinstance(comment_only, bool):
                    refuse("gold_shape_invalid", at=where + ".commentOnly")
                exact_keys(item, ["id", "class", "spans", "commentOnly"] + ([] if comment_only else ["clean"]), where)
                check_spans(item["spans"], paragraphs, where + ".spans")
                if not comment_only:
                    check_condition(item["clean"], "clean", paragraphs, where + ".clean")
            else:
                refuse("gold_class_invalid", at=where, allowed=list(CLASSES))
    return gold, hashlib.sha256(raw).hexdigest()


def find_all(texts, needle):
    """Every (paragraph index, start) of needle, overlapping occurrences included: the applier's find_all without its field masks."""
    hits = []
    for index, text in enumerate(texts):
        start = text.find(needle)
        while start != -1:
            hits.append((index, start))
            start = text.find(needle, start + 1)
    return hits


def occurrences(text, needle):
    return [start for _, start in find_all([text], needle)]


def bind_gold(gold, texts, sha256):
    """Checks the gold against its source's texts; returns its spans placed as (paragraph, start, end)."""
    if sha256 != gold["source"]["sha256"]:
        refuse("source_sha256_differs")
    if len(texts) != gold["source"]["paragraphs"]:
        refuse("source_paragraphs_differ", source=len(texts), gold=gold["source"]["paragraphs"])
    source = [normalize(text) for text in texts]
    placed = {}
    for item in gold["defects"] + gold["controls"]:
        spans = []
        for index, span in enumerate(item.get("spans", [])):
            hits = occurrences(texts[span["paragraph"] - 1], span["quote"])
            if len(hits) != 1:
                refuse("gold_quote_not_found" if not hits else "gold_quote_not_unique", item=item["id"], span=index, count=len(hits))
            spans.append((span["paragraph"], hits[0], hits[0] + len(span["quote"])))
        placed[item["id"]] = spans
    for item in gold["defects"]:
        if "clean" in item and holds(item["clean"], clean_test(source)):
            refuse("gold_defect_condition_holds_on_source", item=item["id"])
    for item in gold["controls"]:
        if not holds(item["clean"], clean_test(source)):
            refuse("gold_control_condition_fails_on_source", item=item["id"])
        for defect in gold["defects"]:
            if any(overlaps(a, b) for a in placed[item["id"]] for b in placed.get(defect["id"], [])):
                refuse("gold_control_overlaps_defect", item=item["id"], defect=defect["id"])
    return placed


def planted_counts(gold):
    counts = dict((name, 0) for name in CLASSES)
    for item in gold["defects"]:
        counts[item["class"]] += 1
    counts["total"] = len(gold["defects"])
    return counts


# ---------- conditions ----------

def normalize(text):
    """Composed (NFC), lookalikes folded as the applier folds them, each whitespace run one space, casefolded."""
    return WHITESPACE_RE.sub(" ", unicodedata.normalize("NFC", text).translate(LOOKALIKES)).casefold()


def found_in(text, needle, word):
    for start in occurrences(text, needle):
        end = start + len(needle)
        if not word or ((start == 0 or not text[start - 1].isalnum()) and (end == len(text) or not text[end].isalnum())):
            return True
    return False


def holds(condition, test):
    if "all" in condition:
        return all(holds(member, test) for member in condition["all"])
    if "any" in condition:
        return any(holds(member, test) for member in condition["any"])
    return test(condition)


def literal_test(condition, texts):
    key = "contains" if "contains" in condition else "lacks"
    needle = normalize(condition[key])
    found = any(found_in(text, needle, condition["word"]) for text in texts)
    return found if key == "contains" else not found


def clean_test(paragraphs):
    """Tests over normalized paragraph texts: a literal matches within one paragraph of the range."""
    return lambda condition: literal_test(condition, paragraphs[condition["paragraphs"][0] - 1:condition["paragraphs"][1]])


def edit_test(edit):
    """Tests over an edit's own text: its newText, when it has one, and its rationale; a literal matches within one of them."""
    parts = [normalize(edit["newText"])] if "newText" in edit else []
    return lambda condition: literal_test(condition, parts + [normalize(edit["rationale"])])


# ---------- a run ----------

def load_plan(raw):
    """The applier's own shape rules for an edit plan (its load_plan); returns the edits, or Unusable with the first code."""
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise Unusable("plan_not_json")
    if not isinstance(data, dict) or data.get("version") != 1 or set(data) != {"version", "edits"} or not isinstance(data["edits"], list):
        raise Unusable("plan_shape_invalid")
    edits, seen = data["edits"], set()
    if not 1 <= len(edits) <= MAX_EDITS:
        raise Unusable("edit_count_invalid")
    for edit in edits:
        if not isinstance(edit, dict):
            raise Unusable("edit_not_object")
        action = edit.get("action")
        if action not in ACTIONS:
            raise Unusable("action_invalid")
        allowed = {"id", "anchor", "action", "rationale", "severity"} | ({"newText"} if action in ("replace", "insert_after") else set())
        if set(edit) != allowed:
            raise Unusable("fields_invalid")
        if not isinstance(edit["id"], str) or not ID_RE.fullmatch(edit["id"]) or edit["id"] in seen:
            raise Unusable("id_invalid_or_duplicate")
        seen.add(edit["id"])
        for field, limit in (("anchor", 1000), ("rationale", 1000)) + ((("newText", 4000),) if "newText" in allowed else ()):
            value = edit[field]
            if not isinstance(value, str) or not 1 <= len(value) <= limit or INVALID_RE.search(value):
                raise Unusable(field + "_invalid")
        if edit["severity"] not in SEVERITIES:
            raise Unusable("severity_invalid")
    return edits


def place_edits(edits, texts):
    """Each edit whose anchor occurs exactly once in the source, as (edit, (paragraph, start, end)); the rest are unplaced."""
    placed = []
    for edit in edits:
        hits = find_all(texts, edit["anchor"])
        if len(hits) == 1:
            index, start = hits[0]
            placed.append((edit, (index + 1, start, start + len(edit["anchor"]))))
    return placed


def overlaps(a, b):
    """Two (paragraph, start, end) ranges that share at least one character."""
    return a[0] == b[0] and a[1] < b[2] and b[1] < a[2]


def find_source(candidate):
    """The run's own source, the one .docx at the top of candidate/input as the review check requires, or the status that says why not."""
    found = []
    for root, directories, files in os.walk(os.path.join(candidate, "input")):
        directories.sort()
        found.extend(os.path.join(root, name) for name in sorted(files) if name.lower().endswith(".docx"))
    if not found:
        return None, "source_missing"
    top = os.path.join(candidate, "input")
    if len(found) != 1 or os.path.dirname(found[0]) != top or not SOURCE_NAME_RE.match(os.path.basename(found[0])):
        return None, "source_ambiguous"
    return found[0], None


def read_flags(path):
    """Rule C1's count and the ids of the edits it coded, from the run's own flags file.

    Returns (count, status, ids). The count is None, with the status saying why, when it is not a measurement. ids is None when the file
    cannot say which edits were coded: its list was cut at the applier's cap (truncated), or it does not agree with the count."""
    if not os.path.isfile(path):
        return None, "missing", None
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_FLAGS_BYTES + 1)
        data = json.loads(raw.decode("utf-8")) if len(raw) <= MAX_FLAGS_BYTES else None
    except (OSError, ValueError, UnicodeDecodeError, RecursionError):
        return None, "invalid", None
    if not isinstance(data, dict):
        return None, "invalid", None
    # The whole record failed (top-level error), or rule C1 alone did (the applier's flag_rule records it under "edits"): either way the
    # count is the applier's fallback zero, not a measurement.
    if "error" in data or (isinstance(data.get("edits"), dict) and "error" in data["edits"]):
        return None, "error", None
    counts = data.get("counts")
    value = counts.get("inversionEdits") if isinstance(counts, dict) else None
    if not is_int(value) or value < 0:
        return None, "invalid", None
    edits, ids = data.get("edits"), None
    if isinstance(edits, dict) and edits.get("truncated") is False and isinstance(edits.get("flags"), list):
        listed = [flag.get("id") if isinstance(flag, dict) else None for flag in edits["flags"]]
        if all(isinstance(edit_id, str) for edit_id in listed) and len(set(listed)) == len(listed) == value:
            ids = set(listed)
    return value, "recorded", ids


def score_run(label, directory, gold, bound):
    """One run's record, and the gold bound to its source as (texts, spans), which the first run whose source is the gold's sets."""
    candidate = os.path.join(directory, "candidate")
    record = {"label": label}
    if not os.path.isdir(candidate):
        record.update({"status": "candidate_missing", "flags": "missing", "inversionEdits": None})
        return record, bound
    record["inversionEdits"], record["flags"], coded = read_flags(os.path.join(candidate, "output", "review-flags.json"))
    # A run whose own source is missing, ambiguous or not the gold's gets a status without counts; the other runs are still scored.
    source, problem = find_source(candidate)
    if problem is None and file_sha256(source) != gold["source"]["sha256"]:
        problem = "source_mismatch"
    if problem is not None:
        record["status"] = problem
        return record, bound
    if bound is None:
        # The gold's own source cannot be read, or the gold does not fit it: the invocation is refused, as --check-gold refuses it.
        texts, sha256 = read_source(source)
        bound = (texts, bind_gold(gold, texts, sha256))
    texts, spans = bound
    plan_path = os.path.join(candidate, "review", "edits.json")
    if not os.path.isfile(plan_path):
        record["status"] = "plan_missing"
        return record, bound
    try:
        with open(plan_path, "rb") as handle:
            raw = handle.read(MAX_PLAN_BYTES + 1)
        if len(raw) > MAX_PLAN_BYTES:
            raise Unusable("plan_too_large")
        edits = load_plan(raw)
    except OSError:
        edits, record["status"], record["reason"] = None, "plan_invalid", "plan_unreadable"
    except Unusable as error:
        edits, record["status"], record["reason"] = None, "plan_invalid", error.code
    if edits is None:
        return record, bound
    clean_path = os.path.join(candidate, "output", "clean.docx")
    if not os.path.isfile(clean_path):
        record["status"] = "clean_missing"
        return record, bound
    try:
        clean = [normalize(text) for text in paragraph_texts(read_body(clean_path))]
    except Unusable as error:
        record.update({"status": "clean_invalid", "reason": error.code})
        return record, bound
    if len(clean) != len(texts):
        record.update({"status": "clean_invalid", "reason": "paragraphs_differ"})
        return record, bound
    placed = place_edits(edits, texts)
    addressed, addressed_ids = dict((name, 0) for name in CLASSES), set()
    for defect in gold["defects"]:
        if defect["class"] == "missing_section":
            region = defect["region"]
            hit = any(region["first"] <= where[0] <= region["last"] and holds(defect["edit"], edit_test(edit)) for edit, where in placed)
        else:
            hit = any(overlaps(where, span) for _, where in placed for span in spans[defect["id"]])
            hit = hit and (defect["commentOnly"] or holds(defect["clean"], clean_test(clean)))
        if hit:
            addressed[defect["class"]] += 1
            addressed_ids.add(defect["id"])
    addressed["total"] = sum(addressed.values())
    changed = 0
    for control in gold["controls"]:
        touched = any(edit["action"] in CHANGING_ACTIONS and overlaps(where, span) for edit, where in placed for span in spans[control["id"]])
        if touched and not holds(control["clean"], clean_test(clean)):
            changed += 1
    # Rule C1 codes a correct fix of a planted contradiction too, since it flips a negation or a polarity: count the coded edits that sit
    # on a planted defect this run addressed, beside the total. An edit sits on one when its anchor overlaps that defect's span, or when it
    # is placed in a missing section's region and meets that section's edit condition (an inserted clause can flip its sentence's negator
    # parity). A coded edit on a defect the run did not address, such as a wrong flip of a planted clause, stays in the remainder: harm.
    plant_spans = [span for defect in gold["defects"] if defect["id"] in addressed_ids for span in spans[defect["id"]]]
    sections = [defect for defect in gold["defects"] if defect["class"] == "missing_section" and defect["id"] in addressed_ids]
    def on_plant(edit, where):
        return any(overlaps(where, span) for span in plant_spans) or any(
            section["region"]["first"] <= where[0] <= section["region"]["last"] and holds(section["edit"], edit_test(edit)) for section in sections)
    # None when the flags file cannot say which edits were coded, or when it codes an id that is not one of this plan's placed edits: the
    # applier writes no flags for a plan it cannot place, so such a file is stale against the plan, and its remainder is not harm.
    placed_ids = set(edit["id"] for edit, _ in placed)
    on_plants = None if coded is None or not coded <= placed_ids else sum(
        1 for edit, where in placed if edit["id"] in coded and on_plant(edit, where))
    record.update({"status": "scored", "addressed": addressed, "controlsChanged": changed, "edits": len(edits),
                   "editsUnplaced": len(edits) - len(placed), "inversionEditsOnPlants": on_plants})
    return record, bound


# ---------- commands ----------

def scorer_identity():
    return {"name": NAME, "version": VERSION, "sha256": file_sha256(os.path.abspath(__file__))}


def emit(value):
    sys.stdout.buffer.write((json.dumps(value, indent=1, sort_keys=True, ensure_ascii=True) + "\n").encode("ascii"))


def command_list(source_path):
    try:
        texts = paragraph_texts(read_body(source_path))
    except Unusable as error:
        refuse("source_" + error.code[len("docx_"):])
    for number, text in enumerate(texts, 1):
        sys.stdout.buffer.write((json.dumps({"paragraph": number, "text": text}, ensure_ascii=False) + "\n").encode("utf-8"))


def command_check_gold(gold_path, source_path):
    gold, gold_sha256 = load_gold(gold_path)
    texts, sha256 = read_source(source_path)
    bind_gold(gold, texts, sha256)
    emit({"ok": True, "sha256": gold_sha256, "planted": planted_counts(gold), "controls": len(gold["controls"]),
          "scorer": scorer_identity()})


def command_score(gold_path, pairs):
    runs, labels = [], set()
    for pair in pairs:
        label, separator, directory = pair.partition("=")
        if not separator or not LABEL_RE.match(label) or not directory:
            refuse("run_argument_invalid", expected="LABEL=RUN_DIR", at=len(runs) + 1)
        if label in labels:
            refuse("label_duplicate", label=label)
        labels.add(label)
        runs.append((label, directory))
    gold, gold_sha256 = load_gold(gold_path)
    bound, records = None, []
    for label, directory in runs:
        record, bound = score_run(label, directory, gold, bound)
        records.append(record)
    emit({"candidates": records, "gold": {"sha256": gold_sha256, "planted": planted_counts(gold), "controls": len(gold["controls"])},
          "scorer": scorer_identity()})


def main(argv):
    try:
        if argv == ["--version"]:
            sys.stdout.write("%s %d\n" % (NAME, VERSION))
        elif len(argv) == 2 and argv[0] == "--list":
            command_list(argv[1])
        elif len(argv) == 3 and argv[0] == "--check-gold":
            command_check_gold(argv[1], argv[2])
        elif len(argv) >= 3 and argv[0] == "--gold":
            command_score(argv[1], argv[2:])
        else:
            refuse("usage_invalid", usage="--version | --list SOURCE | --check-gold GOLD SOURCE | --gold GOLD LABEL=RUN_DIR ...")
        return 0
    except Refusal as refusal:
        emit({"ok": False, "errors": refusal.errors})
        return 2
    except Exception as error:  # an internal error names its type only, never a value that could quote a file
        emit({"ok": False, "errors": [{"code": "internal_error", "type": type(error).__name__}]})
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
