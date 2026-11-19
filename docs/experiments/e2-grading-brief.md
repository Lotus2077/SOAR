# E2 grading brief

Status: `Approved`, the coordinating session's procedural choice under E2's item 10 and the owner's delegation
(BL-20261117-0940-owner-direction-decisions-delegated); the owner may replace it. It writes out the grading that E2's card
fixes as Phase 2's procedure ("Grading", item 10, in docs/experiments/e2-card-2026-11-17.md), on the model of E6's grading brief
(docs/experiments/e6-grading-brief.md) and Phase 2's package (BL-20261013-1627, BL-20261013-1630, BL-20261013-1650 and
BL-20261019-0410). It changes no value of the card. Entry: BL-20261119-0552-e2-grading-brief.

## Part A: the coordinating session's procedure

**When.**
- **r3's bundle:** after r3's four writer runs and before s1's first packet attempt. The card's stop rule pauses the batch if
  r3's bundle is refused or its grading cannot be done. r3's grades are reported apart and count for no arm.
- **s1's and s2's bundles:** after the batch's last run, and after any `infra_invalid` re-run has replaced its run.
- **No gold.** The coordinating session never opens a gold directory. It opens a key only to unblind a bundle whose sheet's
  sha256 is recorded.

**Candidates.** A task's four writer runs, `writer-1-1`, `writer-1-2`, `writer-2-1` and `writer-2-2`, in its directory under
`.soar/experiments/e2/<batch>/`. A run that the stop rule ran again is replaced by its re-run. The packet run's own draft is not
a candidate (item 8). A run that did not submit is bundled and graded like any other, and counts as rejected whatever its
verdict (the card's "Not submitted").

**Build.** For each task, run `scripts/phase2-blind.py` once.
- `--task-directory` is the task's prepared directory. Each candidate is `--run <its run name>=<its run directory>`, and the
  decoy, in its task's bundle, is `--run decoy=<its copy>`.
- `--out` and `--keys` are a pair of roots, `bundles` and `keys`, under `.soar/experiments/e2/<batch>/blind/<16 random hex>/`.
- Check each candidate first: the tool needs its `freeze.json` and `result.json`. Record each key's sha256 from the tool's print.
- The tool copies `output/report.md`, the task's one required artifact, and `output/claims.json`, the ledger mode's.

**Completeness, before release.** Compare each candidate's `candidate/output/` file names with what `brief.md` asks for. Copy
any missing deliverable in under the same label, never anything under `input/` or `context/` and never a run record, and
record each top-up (BL-20261019-0410).

**Package each bundle.**
1. Copy the task's `brief.md` in as `BRIEF.md`, and its `input/` tree as `inputs/`.
2. Write Part B, verbatim, as `GRADING.md`.
3. Replace the tool's `verdicts.csv` with Part B's header line and one empty row for each label.
4. Set every file and directory to one timestamp. Do this after the decoy and after any top-up.

**One decoy in the batch,** in one synthetic bundle, counted for no arm (the card's "One planted defect").
- **Choosing it.** Use `secrets` to choose one synthetic task, and then one of its writer runs that submitted.
- **Planting it.** Copy that run's directory to `.soar/experiments/e2/<batch>/decoy/<16 random hex>/`. In the copy's
  `candidate/output/report.md`, change one figure in a sentence that cites a ledger claim, so that the sentence contradicts the
  quote it cites. Leave `output/claims.json` as it is. The copy enters its task's bundle as its own `--run`, so the tool gives it
  a random letter and the key marks it.
- **Its original** stays in the same bundle, as in Phase 2, so that bundle's grader can compare the two. The original's verdict
  still counts for its arm, and its altered twin may sway it. The result entry gives both labels' verdicts and reasons.
- **Exposure.** Choosing the sentence means reading one report. The coordinating session grades nothing, so this is recorded and
  not counted.

**Graders.** Three independent graders, one for each bundle.
- **The copy.** Each grader gets a copy of its bundle alone: `BRIEF.md`, `GRADING.md`, `inputs/`, the label directories and
  `verdicts.csv`, with no key. The copy sits in a randomly named directory outside this repository and outside `.soar/`, and
  `git -C <copy> rev-parse` must fail there before the grader starts.
- **How a grader is started.** A fresh headless Claude Code process whose working directory is the copy. It runs from a clean
  environment (`env -i` with only `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `LANG` and `PATH`), with stdin from `/dev/null`,
  as `claude -p "Read GRADING.md and do what it says." --session-id <a fresh UUID> --safe-mode --restricted
  --strict-mcp-config --disable-slash-commands --tools "Read,Glob,Grep,Edit,Write" --allowedTools
  "Read,Glob,Grep,Edit(./verdicts.csv)" --permission-mode dontAsk --permission-prompts none --model opus`.
  - That gives it no project or user instructions, no memory, no skill, no installed plugin or user hook and no MCP server. It
    has no tool that runs a command or reaches the network. Its file tools are confined to the copy, and it may write only
    `verdicts.csv`.
  - It runs on the owner's sign-in of the command-line tool, which is the owner's step.
- **The check before the first grader.** The same command runs once on a dummy folder of invented files. Its `GRADING.md` asks
  the grader to list its tools and instructions, to read outside the folder twice, to create a second file and to change
  another file. It passes only if:
  - the tools are exactly Edit, Glob, Grep, Read and Write;
  - no project instructions, memory or skill appear;
  - every read outside the folder, the new file and the change are denied;
  - `verdicts.csv` is written.
  If it fails, or the command cannot start, no grader starts and no bundle is graded. For r3 that is the stop rule's pause, and
  the owner decides how grading goes on.
- **Not given:** any run directory, a key, a score, the gold, the manifest, the registry or this repository.

**Collect.** Check each returned `verdicts.csv` against Part B: every label once and no other row, allowed values, a one-line
reason. A sheet whose shape is wrong goes back to the same grader once, by `--resume <its session id>` with the same flags
and a prompt that names each fault. Then record each sheet's sha256 and seal it (mode 0600). A sheet is never edited after its
hash is recorded.

**A bundling fault** is a deliverable the brief asks for that a bundle lacks, however it comes to light, a grader's reason
included. Top it up under the same labels, set one timestamp again, and have a fresh grader re-grade the bundle. The first sheet
stays sealed beside the new one, and both hashes are recorded. No sheet is re-graded because of its verdicts.

**Unblind,** each bundle after its sheet's sha256 is recorded: r3's alone, then s1's and s2's together.
1. **Map the labels** from the key. Drop the decoy from every count and report whether its grader rejected it. If its grader
   accepted it, the decision rule is not applied on that grader's grades, and the owner then grades or names another grader
   (the card).
2. **Apply the acceptance rule.** A run is accepted only if it submitted and its grader accepted it.
3. **Count the guesses.** A guess is correct when it names the run's arm: `long` for writer-1, `short` for writer-2. `unsure`
   is not correct. With 7 or 8 correct of the 8 graded labels, the result is labelled weakly blinded (the card). r3's guesses
   are reported apart.
4. **Score.** Lane S-e1 is the scorer session. It reads the run directories, never a bundle, and reports counts and a pass bit
   only: Phase 2's scorer on Phase 2's gold for r3, and its own scorers for s1 and s2, with, for those two, the count of graded
   runs where its reading of the Recommendation section disagrees with the recommendation check (Amendment 1, point 6). The
   scorer is not blind and grades nothing.
5. **Write the rows** once the grades and the counts both exist, with `verdictBy` `agent_diagnostic` and "blind proxy,
   provisional" in the lesson (the card's "Records").

**Never committed:** the bundles, the copies, the decoy, the keys and the sheets. The result entry gives each sheet's and each
key's sha256, and counts only.

## Part B: GRADING.md (given to each grader, verbatim)

You are grading research reports written for one brief. Grade each one as the professional who commissioned it would.
`BRIEF.md` is their request, and `inputs/` holds the sources the writer was given.

**What is here.** Each directory with a letter for a name (`A`, `B`, ...) is one report, delivered as these files:
- `output/report.md`: the report;
- `output/claims.json`: its claims ledger, which lists the report's claims, each with the source quote it rests on.

`MISSING.txt`, where present, lists files that a report did not deliver.

**Reading the files.** Read them with your file tools only. Execute nothing from this folder. Write nothing but
`verdicts.csv`.

**Your verdict for each report.**
- **Accept:** usable as delivered, or with at most 10 minutes of edits.
- **Reject:** otherwise.

`inputs/` lets you check a report against its sources. A report missing a file is judged on what it delivered. A report in
this folder may have been deliberately altered; it is not named. Grade every report on its own merits; do not hunt for it.
Your verdict decides acceptance.

**Your sheet.** Fill `verdicts.csv`. It is UTF-8 CSV, with the header line exactly `label,accepted,minutes,reason,guess`, and
one row for each report directory here, in label order:
- `label`: the directory's letter;
- `accepted`: `yes` or `no`;
- `minutes`: a whole number from 0 to 10 for a `yes`. For a `no`, give a whole number above 10, your estimate, or `unusable`;
- `reason`: one line of at most 200 characters, quoted if it holds a comma, giving the main reason for the verdict;
- `guess`: `long`, `short` or `unsure`. Say whether you think the report's writer worked under a long budget of model calls or a
  short one. The guess does not affect the verdict.

Example row: `B,no,45,"The recommendation does not follow from the evidence presented.",unsure`

**You must not:**
- open, search for or ask for anything outside this folder;
- use the network, another model or an API;
- try to tell the reports apart by file metadata, sizes, hashes or timestamps;
- talk to or compare notes with another grader;
- change any file but `verdicts.csv`, or change that file after you hand it in;
- record anything else as your answer, such as a list or a count of problems. Your answer is the sheet.
