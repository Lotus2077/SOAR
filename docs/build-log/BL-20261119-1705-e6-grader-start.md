### BL-20261119-1705-e6-grader-start -- 2026-11-19 -- E6's grader start: a headless Claude Code process with a sandboxed shell, confined to its copy and with no network

Status: `Approved`

Scope or hypothesis: E6's grading brief (docs/experiments/e6-grading-brief.md, Part A, "Graders") sets the requirements for starting a grader and leaves the mechanism to the coordinating session. E6's graders must read .docx and .xlsx files, which Part B says to do with `unzip -p` or Python. So E2's shell-free grader (BL-20261119-0552-e2-grading-brief) does not fit as it stands. This entry records the session's choice of mechanism, before any E6 run. Part B is unchanged.

Decisions:
1. **The process.** Each grader is a fresh headless `claude -p "Read GRADING.md and do what it says. First check that the directory is in no git repository."` with:
   - flags: `--safe-mode --restricted --strict-mcp-config --disable-slash-commands`, the tools Read, Glob, Grep, Edit, Write and Bash, writes allowed only by `Edit(./verdicts.csv)`, `--permission-mode dontAsk --permission-prompts none`, and its own `--session-id`;
   - environment: a clean one (`env -i`), stdin from /dev/null, and the real python3 first on PATH;
   - temp folders: `TMPDIR` and `CLAUDE_CODE_TMPDIR` set to a private temp folder.
2. **The sandbox,** passed by `--settings` with absolute paths:
   - the shell sandbox on, failing if unavailable, with unsandboxed commands refused;
   - network: an empty allow list, strict;
   - reads: denied in the home folder, /tmp, /private/tmp, /private/var/folders and /Volumes, except the copy and the private temp folder;
   - writes: denied in the copy except verdicts.csv;
   - the file tools blocked outside the working directory.
3. **Where copies live:** a random folder under a hidden folder in the owner's home, never under the CLI's /tmp root. The coordinating session deletes it after the sheet is sealed.
4. **The gate:** before the first grader, the same command runs on dummy files. It passes only if all of these hold, or no grader starts:
   - the tools are exactly the six named above;
   - no instructions or memory appear;
   - a .docx is read with `zipfile` and with `unzip`;
   - a sibling file, /tmp and the network are denied;
   - a new file is refused;
   - verdicts.csv is written.

Changes: this file.

Evidence: Five dummy-folder runs on 2026-11-19/20 with Claude Code 2.1.327, the last meeting every item of decision 4. Relative paths in the sandbox settings did not anchor at the copy. A copy under the CLI's /tmp root stayed readable from a sibling. /usr/bin/python3 is a shim the sandbox blocks.

Failures or blockers: None.

Limitations and non-claims: Every shell call reports a blocked write of the shell's working-directory file under /tmp, so its overall exit status reads 1; each command's own output and status are intact. The sandbox covers the shell only, and the file tools are confined by the permission rules. python-docx and openpyxl are not installed, so graders use zipfile or unzip.

Paid exposure: None. The graders run on the owner's Claude subscription.

Next gate: E6's runs, then the gate in decision 4 before the first grader.

References: docs/experiments/e6-grading-brief.md; docs/experiments/e6-card-2026-11-17.md; BL-20261118-0923-e6-grading-brief; BL-20261119-0552-e2-grading-brief; BL-20261117-0940-owner-direction-decisions-delegated.
