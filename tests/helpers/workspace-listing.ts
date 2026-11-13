import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LIST_FILES, parseWorkspaceListing, pinnedListingHeader, type WorkspaceListing } from "../../src/main/private-agent/sandbox";

/** A clean lister reply for a fixture sandbox (backlog item 3): every entry kept, nothing omitted, the walk complete. */
export function workspaceListing(contents: Map<string, Buffer>, extra: Partial<WorkspaceListing> = {}): WorkspaceListing {
  return { files: [...contents.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, size: bytes.length })),
    omitted: [], counts: { symlink: 0, hard_link: 0, special: 0, oversize: 0, name_invalid: 0, cap: 0 }, complete: true, ...extra };
}

/**
 * What the container's own lister reports for these contents (E1, scenario S6): the contents are written to a temporary mirror and
 * LIST_FILES runs under the machine's python3 with that mirror in place of /workspace, as tests/unit/private-agent-sandbox-capture.test.ts
 * runs it, so the 1,024-file cap, the 4,096-entry walk limit and the depth-first name order are the real script's, never a copy of its
 * rules. The host's pinned paths go on stdin exactly as `DockerSandbox.listFiles` sends them (E1-L), and the reply goes through the host's
 * own parser. The mirror is removed before returning.
 */
export function listedByLister(contents: Map<string, Buffer>, pinned: readonly string[] = []): WorkspaceListing {
  const root = mkdtempSync(join(tmpdir(), "soar-listed-"));
  try {
    for (const [path, bytes] of contents) { const target = join(root, ...path.split("/")); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
    const script = LIST_FILES.replace("os.open('/workspace',", `os.open(${JSON.stringify(root)},`);
    if (script === LIST_FILES) throw new Error("listedByLister: the lister's workspace root moved");
    return parseWorkspaceListing(execFileSync("python3", ["-I", "-c", script], { encoding: "utf8", stdio: "pipe", input: pinnedListingHeader(pinned) }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
