import type { WorkspaceListing } from "../../src/main/private-agent/sandbox";

/** A clean lister reply for a fixture sandbox (backlog item 3): every entry kept, nothing omitted, the walk complete. */
export function workspaceListing(contents: Map<string, Buffer>, extra: Partial<WorkspaceListing> = {}): WorkspaceListing {
  return { files: [...contents.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, size: bytes.length })),
    omitted: [], counts: { symlink: 0, hard_link: 0, special: 0, oversize: 0, name_invalid: 0, cap: 0 }, complete: true, ...extra };
}
