### BL-20261119-1705-e6-grader-start -- 2026-11-19 -- E6's grader start: a headless Claude Code process with a sandboxed shell, confined to its copy for user data and with no network

Status: `Approved`

Scope or hypothesis: E6's grading brief (docs/experiments/e6-grading-brief.md, Part A, "Graders") sets the requirements for starting a grader and leaves the mechanism to the coordinating session. E6's graders read .docx and .xlsx files with `unzip -p` or Python (Part B), so E2's shell-free grader (BL-20261119-0552-e2-grading-brief) does not fit as it stands. This entry records the session's choice before any E6 run. Part B is unchanged.

Decisions:
1. **The process.** A fresh headless `claude -p` with the brief's one prompt and `--model opus`.
   - Flags: `--safe-mode --restricted --strict-mcp-config --disable-slash-commands`, the tools Read, Glob, Grep, Edit, Write and Bash, writes only by `Edit(./verdicts.csv)`, `--permission-mode dontAsk --permission-prompts none` and its own `--session-id`.
   - Environment: a clean one (`env -i`), stdin from /dev/null, `TMPDIR` and `CLAUDE_CODE_TMPDIR` set to a private temp folder, and Xcode's python3 (3.9.6) first on PATH, since /usr/bin/python3 is a shim the sandbox blocks.
2. **The sandbox,** given by `--settings` with absolute paths.
   - The shell sandbox must be available, and unsandboxed commands are refused. The network allow list is empty and strict.
   - Shell reads are denied in the home folder, /tmp, /private/tmp, /private/var/folders and /Volumes, except the copy and the private temp folder. Shell writes in the copy are denied except verdicts.csv.
   - The file tools are blocked outside the working directory by a permission rule.
3. **The copies** live in a random folder under a hidden folder in the owner's home, never under the CLI's /tmp root. Each is deleted after its sheet is sealed.
4. **The gate.** Before the first grader, the full command runs on dummy files. No grader starts unless:
   - the tools are exactly those six and no instructions or memory appear;
   - a .docx reads with `zipfile` and `unzip`;
   - a sibling file, /tmp, the network and a Read-tool read outside the copy are all denied;
   - a new file is refused by both the shell and the Write tool;
   - verdicts.csv is written.

Changes: this file.

Evidence: Five dummy-folder runs with Claude Code 2.1.327.
- The fifth, with every setting above, read a .docx with `zipfile` and `unzip`, listed exactly the six tools, and denied a sibling file, /private/tmp, the network and a shell `touch`. Its Edit of verdicts.csv worked.
- Earlier runs showed that the Read tool is refused outside the copy, and that no instructions or memory are given.
- They also showed that relative sandbox paths do not anchor at the copy, and that a copy under the CLI's /tmp root stays readable from a sibling.
- The Write tool, the prompt's git check and a run of the full prompt are first tried by the gate.

Failures or blockers: None blocking; see Limitations.

Limitations and non-claims:
- Access is confined for user data, not system paths: /etc, /usr, /Applications, /Library and /System stay readable.
- Every shell call reports a blocked write of its working-directory file under /tmp, so its overall status reads 1, while each command's own output and status are intact.
- Each run leaves a `.claude/` folder in the copy.
- Part B names python-docx and openpyxl as options, and neither is installed, so graders use zipfile or unzip.

Paid exposure: None. The graders run on the owner's Claude subscription.

Next gate: E6's runs, then the gate in decision 4 before the first grader.

References: docs/experiments/e6-grading-brief.md; docs/experiments/e6-card-2026-11-17.md; BL-20261118-0923-e6-grading-brief; BL-20261119-0552-e2-grading-brief; BL-20261117-0940-owner-direction-decisions-delegated.
