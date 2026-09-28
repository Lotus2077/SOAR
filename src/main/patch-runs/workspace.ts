import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createIsolatedGitEnvironment, DEFAULT_GIT_EXECUTABLE } from "../tools/git-command-policy";
import { isIgnoredRelativePath } from "../tools/workspace-policy";
import { criticSourceIdentity } from "./critic-context";
import { canonicalRequest } from "./native-contract";

const run = promisify(execFile);
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const gitEnvironment = createIsolatedGitEnvironment();
export const AUTOMATIC_CRITIC_MAX_FILES = 64;
export const AUTOMATIC_CRITIC_MAX_BYTES = 98_304;
interface SourceEntry { mode: string; hash: string; size: number; name: string }
export interface PatchSourceSnapshot { revision: string; files: number; bytes: number; sourceTreeSha256: string }

async function git(root: string, args: string[], maxBuffer = MAX_SOURCE_BYTES, signal?: AbortSignal): Promise<Buffer> {
  const result = await run(DEFAULT_GIT_EXECUTABLE, ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never", ...args], {
    cwd: root, env: gitEnvironment, encoding: "buffer", timeout: 30_000, maxBuffer, signal,
  });
  return result.stdout;
}

export async function inspectPatchWorkspace(root: string, signal?: AbortSignal): Promise<{ root: string; revision: string }> {
  signal?.throwIfAborted();
  const canonical = await realpath(root);
  const top = (await git(canonical, ["rev-parse", "--show-toplevel"], 8192, signal)).toString().trim();
  if (await realpath(top) !== canonical) throw new Error("Choose the repository root.");
  const revision = (await git(canonical, ["rev-parse", "--verify", "HEAD^{commit}"], 8192, signal)).toString().trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision)) throw new Error("The repository needs a committed snapshot.");
  return { root: canonical, revision };
}

async function readSourceTree(root: string, revision: string, signal?: AbortSignal): Promise<{ entries: SourceEntry[]; source: PatchSourceSnapshot }> {
  signal?.throwIfAborted();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision)) throw new Error("Invalid snapshot revision.");
  const tree = new TextDecoder("utf-8", { fatal: true }).decode(await git(root, ["ls-tree", "-r", "-l", "-z", revision], MAX_SOURCE_BYTES, signal));
  const entries: SourceEntry[] = [];
  let bytes = 0;
  for (const row of tree.split("\0").filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]+) +([\d-]+)\t([\s\S]+)$/u.exec(row);
    if (!match) throw new Error("The snapshot tree could not be read.");
    const [, mode, kind, hash, sizeText, name] = match;
    if (kind !== "blob" || !["100644", "100755"].includes(mode)) throw new Error("Pilot snapshots cannot contain submodules or symlinks.");
    if (path.posix.isAbsolute(name) || path.win32.isAbsolute(name) || name.split("/").some((part) => part === ".." || part === ".") || /[\\\r\n\0]/u.test(name)) throw new Error("Unsupported snapshot path.");
    if (isIgnoredRelativePath(name, "file")) {
      throw new Error("This snapshot contains an excluded or possible credential path. Use an admitted public snapshot without credential files.");
    }
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new Error("Pilot snapshots allow files up to 1 MiB.");
    bytes += size;
    if (bytes > MAX_SOURCE_BYTES || entries.length >= 2000) throw new Error("Pilot snapshots allow at most 2,000 files and 32 MiB.");
    entries.push({ mode, hash, size, name });
  }
  if (!entries.length) throw new Error("The snapshot has no files.");
  const rows = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))
    .map(entry => ({ path: entry.name, mode: entry.mode, bytes: entry.size, blobSha: entry.hash }));
  return { entries, source: { revision, files: entries.length, bytes,
    sourceTreeSha256: createHash("sha256").update(canonicalRequest(rows)).digest("hex") } };
}

async function readSourceBlob(root: string, entry: SourceEntry, signal?: AbortSignal): Promise<Buffer> {
  const content = await git(root, ["cat-file", "blob", entry.hash], MAX_FILE_BYTES + 1, signal);
  const objectHash = createHash(entry.hash.length === 64 ? "sha256" : "sha1")
    .update(`blob ${content.length}\0`).update(content).digest("hex");
  if (content.length !== entry.size || objectHash !== entry.hash) throw new Error("Snapshot blob identity changed.");
  return content;
}

/** Necessary baseline admission only: a future complete draft/body may still exceed critic limits. */
export async function inspectPatchSource(root: string, revision: string, signal?: AbortSignal): Promise<PatchSourceSnapshot> {
  const { entries, source } = await readSourceTree(root, revision, signal);
  if (source.files <= AUTOMATIC_CRITIC_MAX_FILES && source.bytes <= AUTOMATIC_CRITIC_MAX_BYTES) {
    const files = [];
    for (const entry of entries) {
      signal?.throwIfAborted();
      const bytes = await readSourceBlob(root, entry, signal);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\0")) throw new Error("Unsupported critic source text.");
      files.push({ path: entry.name, bytes, executable: entry.mode === "100755" });
    }
    // Use the production critic's exact path validation; invalid inputs stop selection.
    criticSourceIdentity(files);
  }
  signal?.throwIfAborted();
  return source;
}

/** Copy committed regular blobs only. No repository code, hooks, filters or setup execute on the host. */
export async function materializePatchWorkspace(root: string, revision: string, destination: string, signal?: AbortSignal): Promise<PatchSourceSnapshot> {
  const { entries, source } = await readSourceTree(root, revision, signal);
  signal?.throwIfAborted();
  // The host must supply a new destination under its private run directory.
  // Reusing an existing directory could follow attacker-controlled symlink parents.
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const entry of entries) {
    signal?.throwIfAborted();
    const content = await readSourceBlob(root, entry, signal);
    const file = path.join(destination, entry.name);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, content, { flag: "wx", mode: entry.mode === "100755" ? 0o700 : 0o600, signal });
  }
  return source;
}
