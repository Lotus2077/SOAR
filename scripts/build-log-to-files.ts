/**
 * The conversion for a branch opened before the build log moved to one file per entry. The entries the branch appended to
 * docs/BUILD_LOG.md move to one file each under docs/build-log/, and the archive becomes the base's again.
 *
 *   git merge origin/main                        # if it stops on docs/BUILD_LOG.md, leave that file as it is
 *   pnpm build-log:to-files                      # the base defaults to origin/main; or: pnpm build-log:to-files -- --base-ref <ref>
 *   git add -A docs && git commit --no-edit
 *
 * Mid-merge, with docs/BUILD_LOG.md unmerged, the branch's entries are what its side ("ours") appended to the merge base, and the
 * archive becomes the merged-in side's ("theirs"). Otherwise they are what the work tree's archive appends to the base's. Each new
 * file must pass the validator's file checks, and no file is overwritten. Nothing is staged or committed.
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
  const unmerged = git(repositoryRoot, ["ls-files", "-u", "-z", "--", BUILD_LOG_PATH]).length > 0;
  const base = git(repositoryRoot, ["show", unmerged ? `:1:${BUILD_LOG_PATH}` : `${baseRef}:${BUILD_LOG_PATH}`]);
  const current = unmerged ? git(repositoryRoot, ["show", `:2:${BUILD_LOG_PATH}`]) : readFileSync(path.join(repositoryRoot, BUILD_LOG_PATH), "utf8");
  const archive = unmerged ? git(repositoryRoot, ["show", `:3:${BUILD_LOG_PATH}`]) : base;
  const entries = appendedEntries(base, current);
  const problems = entries.flatMap((entry) => [
    ...validateEntryFile(`${entry.id}.md`, entry.text).errors,
    ...(existsSync(path.join(repositoryRoot, BUILD_LOG_ENTRY_DIRECTORY, `${entry.id}.md`)) ? [`${BUILD_LOG_ENTRY_DIRECTORY}/${entry.id}.md already exists`] : []),
  ]);
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
      `${BUILD_LOG_PATH} is the base's archive again; stage both with: git add -A docs\n`);
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
