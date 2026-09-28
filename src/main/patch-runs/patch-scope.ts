import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const relativeFile = z.string().min(1).max(4096).refine((value) => !value.includes("\\") &&
  !/[\u0000-\u001f]/u.test(value) && value.split("/").every((part) => part && part !== "." && part !== ".."), "Expected an exact relative file path.");

export interface RoutingPatchScope {
  valid: boolean; changedPaths: string[];
  reason: "within_scope" | "outside_allowed_paths" | "unsupported_or_malformed_patch";
}
class RoutingScopeInfrastructureError extends Error {}

/** Restrict to ordinary Git text/mode/rename patches. Git parses identities in
 * both directions below; this structural pass rejects ignored preambles, binary
 * payloads, copies, submodules, symlinks, and trailing material instead of guessing.
 * Hunk counters ensure no extra text can be silently ignored by Git's parser. */
function textPatchSections(text: string): number {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let sections = 0, oldLeft = 0, newLeft = 0, inHunk = false, sawContent = false;
  for (const line of lines) {
    if (oldLeft || newLeft) {
      const marker = line[0];
      if (marker === " ") { oldLeft--; newLeft--; }
      else if (marker === "-") oldLeft--;
      else if (marker === "+") newLeft--;
      else if (line === "\\ No newline at end of file" && sawContent) continue;
      else throw new Error("Malformed patch hunk.");
      if (oldLeft < 0 || newLeft < 0) throw new Error("Malformed patch hunk count.");
      sawContent = true; continue;
    }
    if (line.startsWith("diff --git ")) { sections++; inHunk = false; sawContent = false; continue; }
    if (!sections) throw new Error("Patch must begin with a Git diff header.");
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?:.*)$/u.exec(line);
    if (hunk) {
      oldLeft = Number(hunk[1] ?? 1); newLeft = Number(hunk[2] ?? 1);
      if (!Number.isSafeInteger(oldLeft) || !Number.isSafeInteger(newLeft) || (!oldLeft && !newLeft)) throw new Error("Invalid hunk bounds.");
      inHunk = true; sawContent = false; continue;
    }
    if (line === "\\ No newline at end of file" && inHunk && sawContent) { sawContent = false; continue; }
    if (inHunk || !/^(?:(?:old mode|new mode|new file mode|deleted file mode) 100(?:644|755)|index [a-f0-9]+\.\.[a-f0-9]+(?: 100(?:644|755))?|(?:dis)?similarity index (?:100|\d{1,2})%|rename (?:from|to) .+|--- .+|\+\+\+ .+)$/u.test(line)) throw new Error("Unsupported patch structure.");
  }
  if (!sections || oldLeft || newLeft) throw new Error("Incomplete patch.");
  return sections;
}

function gitPatchNames(text: string, directory: string, reverse: boolean): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", ["apply", "--numstat", "-z", ...(reverse ? ["--reverse"] : []), "--"], {
      cwd: directory, timeout: 10_000, maxBuffer: 4 * 1024 * 1024, encoding: "buffer",
      env: { PATH: process.env.PATH, LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "0", GIT_CEILING_DIRECTORIES: directory },
    }, (error, stdout) => {
      if (error) {
        reject(typeof error.code === "number" && !error.killed ? new Error("Git rejected patch metadata.")
          : new RoutingScopeInfrastructureError("Git metadata inspection could not complete."));
        return;
      }
      try {
        const result = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
        if (!result.endsWith("\0")) throw new Error("Missing metadata terminator.");
        resolve(result.slice(0, -1).split("\0").map((row) => {
          const match = /^\d+\t\d+\t([\s\S]+)$/u.exec(row);
          if (!match) throw new Error("Unsupported Git metadata.");
          return relativeFile.parse(match[1]);
        }));
      } catch { reject(new Error("Invalid Git patch paths.")); }
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(text);
  });
}

/** Read-only Git metadata parsing; never applies the patch or executes source.
 * Forward numstat includes rename destinations, reverse includes origins. */
export async function inspectRoutingPatchScope(text: string, allowedFiles: readonly string[]): Promise<RoutingPatchScope> {
  let directory: string | undefined;
  try {
    const sections = textPatchSections(text);
    directory = await mkdtemp(path.join(tmpdir(), "soar-routing-scope-"));
    const forward = await gitPatchNames(text, directory, false), reverse = await gitPatchNames(text, directory, true);
    if (forward.length !== sections || reverse.length !== sections) throw new Error("Git ignored patch sections.");
    const changedPaths = [...new Set([...forward, ...reverse])].sort();
    const allowed = new Set(allowedFiles.map((file) => relativeFile.parse(file)));
    const valid = changedPaths.every((file) => allowed.has(file));
    return { valid, changedPaths, reason: valid ? "within_scope" : "outside_allowed_paths" };
  } catch (error) {
    if (error instanceof RoutingScopeInfrastructureError) throw error;
    return { valid: false, changedPaths: [], reason: "unsupported_or_malformed_patch" };
  }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}
