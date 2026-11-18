# E6 grading brief

Status: `Approved`, the coordinating session's procedural choice under the owner's items 4, 5 and 16; the owner may replace it.
It is item 6 of "What the card needs that does not exist yet" in docs/experiments/e6-card-2026-11-17.md, written from the
owner's items 4 and 5, "Inputs and exposure" and Amendment 1. Its model is Phase 2's package (BL-20261013-1630,
BL-20261013-1650, BL-20261019-0410). "S-harn" below is lane S-harn's check of scripts/phase2-blind.py on a simulated review-2
loop, at `main` aa61e94 on 2026-11-18. How a grader is started is left to the coordinating session and is not chosen yet.

## Part A: the grading session's procedure

**When.** After the batch's last run, and after any `infra_invalid` re-run has replaced its run. That is before the scorer's
first pass (Amendment 1, item 6). The grading session holds no gold and never opens `.soar/experiments/e6-v1/gold/`. It opens
no key until every sheet's sha256 is recorded, except the decoy's key (below): used for the decoy only, its opening recorded.

**Candidates.** Every candidate is graded, not only the delivered one (the owner's item 5). For each of the three files
(`e6-pd1-maintenance-contract`, `e6-pd2-expenses-policy`, `e6-pd3-programme-report`):
- **The drafts' bundle** holds the two review-1 runs and each loop's `<loop>/a` and `<loop>/b`: at most six.
- **The repairs' bundle** holds each loop's `<loop>/repair`: at most two.
  - A loop that ended at `no_draft`, `critique_failed` or `repair_failed` has "no finished repair to grade or score" ("Arms
    and tasks"), so none is bundled for it.
  - A run that a resume moved aside (`<stage>.infra-1`, `<stage>.void-<n>`) is not a candidate.
- **Build both exactly as listed.** The tool's pair refusal is narrow: it refuses a repair beside its own draft, not beside its
  loop's other sample (S-harn).
- **A candidate whose run did not submit** is bundled and graded like any other. The tool lists its absent files in
  `MISSING.txt`. It counts as rejected whatever its verdict (the acceptance rule).

**Build.** For each file, run `scripts/phase2-blind.py` twice, once for each bundle.
- **Check each stage first.** Each needs `freeze.json` and `result.json`. Given a stage without a result, the tool stops with a
  traceback and writes nothing (S-harn).
- **Roots.** Each bundle gets its own pair of roots under the ignored `.soar/`, with neutral random names, for example
  `.soar/experiments/e6-v1/blind/<16 random hex>/{bundles,keys}/`. No name says which kind of bundle a root holds. The tool
  names a bundle by job id and refuses to overwrite one.
- **What goes in.** Six deliverables: `output/review-summary.md`, `review/edits.json`, `output/redline.docx`, `output/clean.docx`,
  `output/issues.xlsx` and `output/hygiene.json`. Never `output/review-flags.json`, an input, a context file or a run record.
- **Run names.** The `ARM=` names given with `--run` go only into the key. Record each key's sha256 from the tool's print.

**Completeness, before release.** The tool copies a fixed list, which was BL-20261019-0410's fault. For each candidate, compare
its run's `candidate/` file names with the files BRIEF.md asks for. Copy any missing one in under the same label, never the
flags file or anything under `input/` or `context/`, and record each top-up.

**Package each bundle.** These steps are the grading session's, not the tool's (S-harn):
1. Copy the task's `brief.md` in as `BRIEF.md`.
2. Write Part B, verbatim, as `GRADING.md`.
3. Replace the tool's `verdicts.csv` with Part B's header line and one empty row for each label.
4. Set every file and directory to one timestamp. Do this after the decoy, and after any top-up.

**One decoy in the batch,** not counted for any arm.
- **Choosing it.** Use `secrets` to choose one file that has a repairs' bundle, and one of that file's review-1 runs that
  submitted.
- **Planting it.** Copy that run's six deliverables byte for byte into the file's repairs' bundle, under a new label. Then change
  one figure in that copy's `output/review-summary.md` only.
  - Its `.docx` and `.xlsx` stay byte-identical. Re-saving them would lose the applier's fixed zip dates and properties.
  - Its original stays in the drafts' bundle, which another grader holds, so no grader sees both.
- **Afterwards.** Re-shuffle that bundle's labels with `secrets`, and mark the decoy in its key (the opening allowed above). Print
  no label mapping. Record the key's sha256 before and after, as Phase 2's decoy did (BL-20261013-1630).
- **Exposure.** Changing the figure means reading one summary. The session grades nothing, so this is recorded and not counted.

**Graders.** Six independent agents, one for each bundle. A repair and its draft never reach the same grader.
- **The copy.** Each grader gets a copy of its bundle alone: `BRIEF.md`, `GRADING.md`, the label directories and
  `verdicts.csv`, with no key. The copy sits in a randomly named directory outside this repository and outside `.soar/`.
- **How a grader is started** (a requirement; the coordinating session chooses the mechanism): as a fresh agent whose working
  directory is the copy, with no project instructions (no AGENTS.md or CLAUDE.md from this repository or any parent), no
  project or user memory, no skill, plugin or tool that carries project context, no network, and file access limited to the
  copy. Its one prompt: read `GRADING.md` and do what it says. First check that the directory is in no git repository.
- **Not given:** the source file, any other bundle, a key, the gold, the manifest, a run or loop directory, the registry or this
  repository.

**Collect.** Check each returned `verdicts.csv` against Part B: every label once and no other row, allowed values, a one-line
reason. A sheet whose shape is wrong goes back to the same grader once. Then record each sheet's sha256 and seal it (mode 0600). A
sheet is never edited after its hash is recorded.

**A bundling fault** is a file the brief asks for that a bundle lacks, however it comes to light, a grader's reason included.
Top it up under the same labels, set one timestamp again, and have a fresh grader re-grade the bundle. The first sheet stays
sealed beside the new one, and both hashes are recorded. No sheet is re-graded because of its verdicts.

**Unblind,** only after all six sheets' hashes are recorded:
1. **Map the labels.** Open the keys and map the labels. Drop the decoy from every count, and report whether its grader
   rejected it.
2. **Read each loop's `loop.json`.** `selected.stage1.candidate` names the draft its repair started from (question 4's
   pairs). `selected.final.candidate` names the candidate the loop delivered (question 1). The keys show neither.
3. **Apply the acceptance rule** (the owner's item 4).
   - A candidate is accepted only if its run submitted and its grader accepted it.
   - The scorer records the planted-defect count beside the verdict. A grader never does, and the count decides no acceptance.
4. **Count the guesses.** A guess is correct when it names the kind: `single` for a review-1 run or a loop's `a` or `b`, `repair`
   for a repair. `unsure` counts as not correct. Over all labels but the decoy, 80% or more correct labels the result weakly
   blinded. The result entry also gives each bundle kind's counts of `single`, `repair` and `unsure`.
5. **Score.** The session that holds the gold runs the scorer's three passes, one for each file (Amendment 1, item 6). A
   candidate whose run did not submit is not given to the scorer (Amendment 1, item 8).
6. **Write the rows.** Rows carry `verdictBy` `agent_diagnostic`. They are written once the grades and the counts both exist
   ("Records").

**Never committed:** the bundles, the copies, the keys and the sheets. The result entry gives each sheet's and each key's
sha256, and counts only.

## Part B: GRADING.md (given to each grader, verbatim)

You are grading reviews of one document. Grade each one as the professional who commissioned it would. `BRIEF.md` is their
request.

**What is here.** Each directory with a letter for a name (`A`, `B`, ...) is one review, delivered as these files:
- `output/review-summary.md`: the reviewer's summary;
- `review/edits.json`: the edit plan. It has one entry for each proposed change or comment, anchored on a quote of the source;
- `output/redline.docx`: the source with every edit as a tracked change by "SOAR draft", and a comment on each edit;
- `output/clean.docx`: the source with every edit accepted;
- `output/issues.xlsx`: one row for each edit;
- `output/hygiene.json`: the metadata that would leave with the files.

`MISSING.txt`, where present, lists files that a review did not deliver. The source document itself is not provided. The
redline shows its text, with the review's changes marked.

**Reading the files.** Read everything in memory only, with `unzip -p`, Python's `zipfile`, `python-docx` or `openpyxl`. Use
no office application, viewer or converter. Execute nothing from this folder. Write nothing but `verdicts.csv`.

**Your verdict for each review.**
- **Accept:** usable as delivered, or with at most 10 minutes of edits.
- **Reject:** otherwise.

A review missing a file the brief asks for is judged on what it delivered. One review in this batch has been deliberately
altered, and it is not named. Grade every review on its own merits; do not hunt for it. Your verdict decides acceptance.

**Your sheet.** Fill `verdicts.csv`. It is UTF-8 CSV, with the header line exactly `label,accepted,minutes,reason,guess`, and one
row for each review directory here, in label order:
- `label`: the directory's letter;
- `accepted`: `yes` or `no`;
- `minutes`: a whole number from 0 to 10 for a `yes`. For a `no`, give a whole number above 10, your estimate, or `unusable`;
- `reason`: one line of at most 200 characters, quoted if it holds a comma, giving the main reason for the verdict;
- `guess`: `single`, `repair` or `unsure`. Say whether you think the review is a first draft (`single`) or a revision of an
  earlier draft after a critique (`repair`). The guess does not affect the verdict.

Example row: `B,no,45,"Several edits introduce errors, and the summary does not describe them.",unsure`

**You must not:**
- open, search for or ask for anything outside this folder;
- use the network, a model or an API;
- try to tell the reviews apart by file metadata, sizes, hashes or timestamps;
- talk to or compare notes with another grader;
- change any file but `verdicts.csv`, or change that file after you hand it in;
- record anything else as your answer, such as a list or a count of problems. Your answer is the sheet.
