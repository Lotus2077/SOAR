# E6 gold format, version 1

The gold for one E6 task is one JSON file. The authoring session (lane S-e1) writes it,
and only `scripts/e6-score.py` reads it. It says where each planted defect and each
control clause sits in the task's source, and which literal test on the clean copy tells
a fix apart from a mark.

The E6 card asks for this format (docs/experiments/e6-card-2026-11-17.md, "What the card
needs that does not exist yet", item 3, under the owner's item 12). Its decisions are in
BL-20261117-1005-e6-planted-defect-scorer-design.

- **Who reads a gold file.** Only the scorer. The session that holds the gold runs it
  once, after the grades are filed, and returns counts only. Lane S-desk, which builds
  the scorer, never opens an E6 gold file, and neither does the session that runs E6.
- **Where it lives.** With its task, under the ignored `.soar/`. It is never committed.
- **What pins it.** Before the first run, the manifest `docs/experiments/e6-tasks-v1.json`
  pins each gold file by sha256. It pins the scorer by its version and by the sha256 of
  `scripts/e6-score.py`.

## The text a gold file points into

- **Paragraphs.** These are the source's body paragraphs, numbered from 1 in document
  order. Table cells are included and text boxes are excluded. This is the numbering of
  `python3 -I review/soar_redline.py --list SOURCE.docx` and of the issues list.
- **A paragraph's text.** It is the applier's plain view: the run text as written, a tab
  as `\t`, a line break as `\n`, and an object (a footnote or endnote mark, an image or a
  symbol) as U+FFFC.
- **Printing it.** `python3 -I scripts/e6-score.py --list SOURCE.docx` prints each
  paragraph's number and text as the scorer reads them, one JSON line each. It needs
  only the standard library.
- **The source has no Word fields and no tracked changes.**
  - Write every cross-reference as plain text ("see Section 8"), never as a field.
  - Why: the applier's anchor search skips text inside a field, and the scorer's
    standard-library reading does not.
  - So the scorer refuses a source that has a field (`w:fldSimple`, `w:fldChar` or
    `w:instrText`) or a tracked change. The applier itself refuses a source with tracked
    changes.

## The file

One JSON object with exactly these keys:

| Key | Value |
| --- | --- |
| `format` | `"soar-e6-gold"` |
| `version` | `1` |
| `source` | `{"sha256": …, "paragraphs": …}`: the lowercase hex sha256 of the task's `input/*.docx` bytes, and its number of body paragraphs |
| `defects` | 1 to 32 planted defects |
| `controls` | 0 to 16 control clauses |

Every object below also has exactly the keys shown. An unknown or missing key refuses
the file, so a misspelt key cannot pass unnoticed.

- **Ids.** Each defect and each control has an `id`: 1 to 32 characters, a letter first,
  then letters, digits, `_` or `-`. An id is unique in the file.
- **What E6 plants.** Each file has eight defects and two controls (card item 2):
  - two `numeric`, two `clause_contradiction`, two `table_arithmetic`;
  - one `reference_definition` and one `missing_section`.

  The scorer does not enforce these numbers. `--check-gold` prints them so you can
  confirm them.

### A defect with a span

Classes `numeric`, `clause_contradiction`, `table_arithmetic` and `reference_definition`.

```json
{"id": "D1", "class": "numeric", "spans": [{"paragraph": 7, "quote": "a fee of 12,500"}],
 "commentOnly": false,
 "clean": {"paragraphs": [7, 7], "lacks": "12,500", "word": true}}
```

- **`spans`.** 1 to 8 places where the defect sits, as `{"paragraph": N, "quote": "…"}`.
  - The quote is 1 to 1,000 characters of that paragraph's text: one line, with no
    control character.
  - It occurs exactly once in that paragraph, counting overlapping occurrences, as the
    applier counts an anchor's.
  - Give each place where a fix could land. A numeric defect can be fixed in the prose or
    in the table row, so give both.
- **`commentOnly`.**
  - `true`: any edit whose anchor overlaps a span addresses the defect, a comment
    included, and `clean` is absent.
  - `false`: `clean` is required.
- **`clean`.** A condition on the clean copy (see "Conditions" below).
  - The defect is addressed when an edit's anchor overlaps one of its spans and `clean`
    holds on the clean copy.
  - `clean` must not hold on the source. `--check-gold` refuses a defect whose condition
    already holds there, since the overlapping edit alone would then count as a fix.

### A missing section

```json
{"id": "D8", "class": "missing_section", "region": {"first": 18, "last": 20},
 "edit": {"any": [{"contains": "governing law", "word": true},
                  {"contains": "jurisdiction", "word": true}]}}
```

- **`region`.** The paragraphs where the section belongs, `first` to `last`, inclusive.
- **`edit`.** A condition on an edit's own text:
  - the text is the edit's `newText`, when it has one, and its `rationale`;
  - a literal matches within one of the two, never across them;
  - the rationale is the comment the applier writes for every edit.
- **When it is addressed.** Some edit addresses it when its anchor lies in a paragraph of
  the region and its text meets `edit`. The edit may be of any action: `insert_after`,
  `replace`, `delete` or `comment`.

### A control clause

```json
{"id": "K1", "spans": [{"paragraph": 22, "quote": "shall not be liable for indirect"}],
 "clean": {"paragraphs": [22, 22], "contains": "shall not be liable", "word": true}}
```

- **No `class`.** A control is correct as written.
- **When it counts as changed.** A `replace`, `delete` or `insert_after` edit overlaps one
  of its spans, and `clean` no longer holds on the clean copy. A comment never changes a
  control.
- **What `--check-gold` checks.**
  - `clean` must hold on the source.
  - A control's span must not overlap any defect's span, so a fix is never also counted
    as harm.

## Conditions

A condition is a literal test or a combination of tests, nested at most four deep:

| Form | Holds when |
| --- | --- |
| `{"paragraphs": [F, L], "contains": "…", "word": B}` | at least one clean paragraph from F to L contains the literal (a `clean` test) |
| `{"paragraphs": [F, L], "lacks": "…", "word": B}` | no clean paragraph from F to L contains it (a `clean` test) |
| `{"contains": "…", "word": B}` | the edit's text contains it (an `edit` test) |
| `{"lacks": "…", "word": B}` | the edit's text does not contain it (an `edit` test) |
| `{"all": [ … ]}` | every one of 1 to 8 conditions holds |
| `{"any": [ … ]}` | at least one of 1 to 8 conditions holds |

- **`clean` takes the forms with `paragraphs`; `edit` takes the ones without.** F and L are
  paragraph numbers, with F no greater than L. The clean copy keeps the source's
  paragraph numbers, because no edit adds or removes a paragraph. The scorer refuses a
  clean copy whose paragraph count differs.
- **A literal** is 1 to 200 characters: one line, with no control character. It matches
  within one paragraph, or within the edit's text, and never across a paragraph break.
- **The match is normalized on both sides.**
  - The applier's lookalikes are folded: curly quotes become straight, a no-break space
    becomes a space, the non-breaking hyphen, the hyphen and the en and em dashes become
    `-`, and a soft hyphen is dropped.
  - Every run of whitespace becomes one space.
  - The text is casefolded, so case never matters.
- **`word` is required.**
  - `true`: the characters just before and just after the match are not letters or
    digits, or the match is at the start or end of the text. So `"12,500"` does not match
    inside `"112,500"`, and `"not"` does not match inside `"notice"`.
  - `false`: the literal may sit inside a word, so `"indemnif"` matches
    `"indemnification"`.

## What the scorer reads from a run

It takes the run's directory, as the driver writes it, and reads its `candidate/`:

- `candidate/review/edits.json`: the edit plan, `{"version": 1, "edits": […]}`. A plan the
  applier would refuse for its shape scores nothing.
- `candidate/output/clean.docx`: the clean copy.
- `candidate/input/*.docx`: the source, the one top-level `.docx`. Its sha256 must equal
  the gold's `source.sha256`, or the scorer refuses the whole invocation and prints no
  count.
- `candidate/output/review-flags.json`: only `counts.inversionEdits`, rule C1's count.
  - It is reported as `null` when the file is missing or unreadable, or when the file
    records an `error`. In that case its counts are the applier's fallback zeros, not a
    measurement.

**Placing an edit.**
- An edit's anchor is placed where it occurs in the source's paragraph texts. It must occur
  exactly once in the whole document, as the applier requires.
- A placed anchor overlaps a span when both are in the same paragraph and their character
  ranges share at least one character.
- An anchor that occurs zero times or more than once is unplaced. It addresses nothing
  and changes nothing, and the scorer reports how many edits were unplaced.

## Commands

```bash
python3 -I scripts/e6-score.py --version
python3 -I scripts/e6-score.py --list SOURCE.docx
python3 -I scripts/e6-score.py --check-gold GOLD.json SOURCE.docx
python3 -I scripts/e6-score.py --gold GOLD.json LABEL=RUN_DIR [LABEL=RUN_DIR ...]
```

- **`--check-gold`** validates the file against its source. It checks the shape, the
  sha256 and the paragraph count, that the source has no field or tracked change, and
  that each quote occurs exactly once. It also checks each `clean` against the source, as
  above.
  - On success it prints the counts by class, the number of controls and the gold file's
    sha256, for the manifest.
  - On failure it prints error codes and item ids, never text.
  - Run it before freezing a gold file.
- **A label** is 1 to 64 characters: a letter or digit first, then letters, digits, `.`,
  `_` or `-`. Each label is unique in the invocation. Labels are the only names in the
  output.
- **The output** is one JSON object, for each label in the order given. It holds:
  - the status;
  - the planted defects addressed, by class and in total;
  - the controls changed;
  - the edits and the unplaced edits;
  - `inversionEdits`.

  It never holds a word from any file. The statuses:
  - `scored`;
  - `candidate_missing`, `plan_missing`, `plan_invalid`, `clean_missing` and `clean_invalid`.
    These carry no counts, because absent is not zero.
- **Exit codes:** 0 on success; 2 on a refusal, with `{"ok": false, "errors": […]}`; 1 on
  an internal error.

## Versions

- The scorer states its version: `--version`, and `scorer.version` in every output, beside
  the sha256 of its own file.
- Any change to these rules or to the scorer's output raises the scorer's version.
- A change to this format raises `version` here as well, and the gold is written again to
  the new version.
- The manifest pins one scorer version before the first run, and the batch keeps it.
