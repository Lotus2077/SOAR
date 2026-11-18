/**
 * The conversion for a branch opened before the build log moved to one file per entry. The entries the branch appended to
 * docs/BUILD_LOG.md move to one file each under docs/build-log/, and the archive becomes the base's again.
 *
 *   git fetch origin && git merge origin/main    # resolve any conflict but docs/BUILD_LOG.md's, and leave that file as it is
 *   pnpm build-log:to-files
 *   git add docs/BUILD_LOG.md docs/build-log && git commit -m "Move this branch's log entries to docs/build-log/"
 *
 * During a merge (MERGE_HEAD), the branch's entries are what HEAD's archive appends to the merge base's, and the archive becomes
 * MERGE_HEAD's, whatever the work tree holds. Outside a merge, they are what the work tree's archive appends to the base's (default
 * origin/main). It refuses while another path is unmerged, an unmerged archive outside a merge (a rebase or a cherry-pick swaps the
 * sides), an ID the branch appends twice, an entry the validator's file checks refuse, and a file that already exists; then it moves
 * nothing. Nothing is staged or committed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { BUILD_LOG_ENTRY_DIRECTORY, BUILD_LOG_PATH, maskMarkdownBlocks, validateEntryFile } from "./validate-build-log";

export interface MovedEntry {
  id: string;
  text: string;
}

/** The entries `current` appends to `base`, each as an entry file's text; refused unless `current` is `base` plus whole entries. */
export function appendedEntries(base: string, current: string): MovedEntry[] {
  if (!current.startsWith(base)) {
    throw new Error(`${BUILD_LOG_PATH} is not the base's archive plus appended entries; merge the base in first`);
  }
  const appended = current.slice(base.length);
  if (appended.trim() === "") return [];
  const starts = [...maskMarkdownBlocks(appended).matchAll(/^### (BL-[a-zA-Z0-9-]+) -- /gmu)];
  const first = starts[0];
  if (first === undefined || appended.slice(0, first.index).trim() !== "") {
    throw new Error(`what the branch appended to ${BUILD_LOG_PATH} does not begin with an entry heading`);
  }
  return starts.map((match, index) => ({
    id: match[1],
    text: `${appended.slice(match.index, starts[index + 1]?.index ?? appended.length).trimEnd()}\n`,
  }));
}

function git(repositoryRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Writes the branch's appended entries as entry files and restores the archive; returns the entries moved. */
export function moveAppendedEntries(repositoryRoot: string, baseRef = "origin/main"): MovedEntry[] {
  if (baseRef.startsWith("-") || !/^[A-Za-z0-9_./^~-]+$/u.test(baseRef)) throw new Error(`unsafe or invalid Git base ref ${JSON.stringify(baseRef)}`);
  const unmerged = [...new Set(git(repositoryRoot, ["diff", "--name-only", "--diff-filter=U", "-z"]).split("\0").filter(Boolean))];
  const others = unmerged.filter((file) => file !== BUILD_LOG_PATH);
  if (others.length > 0) throw new Error(`resolve the other conflicts first, then run this again: ${others.join(", ")}`);
  let merging = true;
  try { git(repositoryRoot, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]); } catch { merging = false; }
  if (!merging && unmerged.length > 0) throw new Error(`${BUILD_LOG_PATH} is unmerged outside a merge (a rebase or a cherry-pick?); convert during a merge`);
  const show = (revision: string) => git(repositoryRoot, ["show", `${revision}:${BUILD_LOG_PATH}`]);
  const base = merging ? show(git(repositoryRoot, ["merge-base", "HEAD", "MERGE_HEAD"]).trim()) : show(baseRef);
  const current = merging ? show("HEAD") : readFileSync(path.join(repositoryRoot, BUILD_LOG_PATH), "utf8");
  const archive = merging ? show("MERGE_HEAD") : base;
  const entries = appendedEntries(base, current);
  const repeated = entries.map((entry) => entry.id).filter((id, index, ids) => ids.indexOf(id) !== index);
  const problems = [...new Set(repeated)].map((id) => `the branch appends ${id} more than once`).concat(entries.flatMap((entry) => [
    ...validateEntryFile(`${entry.id}.md`, entry.text).errors,
    ...(existsSync(path.join(repositoryRoot, BUILD_LOG_ENTRY_DIRECTORY, `${entry.id}.md`)) ? [`${BUILD_LOG_ENTRY_DIRECTORY}/${entry.id}.md already exists`] : []),
  ]));
  if (problems.length > 0) throw new Error(`nothing was moved:\n${problems.join("\n")}`);
  mkdirSync(path.join(repositoryRoot, BUILD_LOG_ENTRY_DIRECTORY), { recursive: true });
  for (const entry of entries) {
    writeFileSync(path.join(repositoryRoot, BUILD_LOG_ENTRY_DIRECTORY, `${entry.id}.md`), entry.text, { flag: "wx" });
  }
  writeFileSync(path.join(repositoryRoot, BUILD_LOG_PATH), archive);
  return entries;
}

function parseBaseRef(args: readonly string[]): string {
  const rest = args.filter((argument) => argument !== "--");
  if (rest.length === 0) return "origin/main";
  if (rest.length === 2 && rest[0] === "--base-ref" && rest[1] !== undefined && !rest[1].startsWith("--")) return rest[1];
  throw new Error("usage: pnpm build-log:to-files [-- --base-ref <ref>]");
}

const invokedPath = process.argv[1] === undefined ? undefined : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const moved = moveAppendedEntries(process.cwd(), parseBaseRef(process.argv.slice(2)));
    process.stdout.write(`moved ${moved.length} entr${moved.length === 1 ? "y" : "ies"} to ${BUILD_LOG_ENTRY_DIRECTORY}/${moved.map((entry) => `\n  ${entry.id}.md`).join("")}\n` +
      `${BUILD_LOG_PATH} is the base's archive again; stage both with: git add ${BUILD_LOG_PATH} ${BUILD_LOG_ENTRY_DIRECTORY}\n`);
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
