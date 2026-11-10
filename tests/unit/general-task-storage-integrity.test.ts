import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateCheckpointStore, type WorkspaceSnapshot } from "../../src/main/private-agent/checkpoints";
import { digest } from "../../src/main/private-agent/contracts";
import { storageIntegrityFailed } from "../../src/main/general-tasks/storage-integrity";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const done of cleanups.splice(0).reverse()) done(); });

/** A task's checkpoint store and the private context's records that reference every kind of blob the runner loads. */
function storage() {
  const root = mkdtempSync(join(tmpdir(), "soar-storage-integrity-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const checkpoints = new PrivateCheckpointStore(join(root, "checkpoints"), "job-1"), blob = (sha256: string) => join(root, "checkpoints", "job-1", sha256);
  const save = (path: string, text: string) => checkpoints.save([{ path, bytes: Buffer.from(text) }]);
  const workspace = checkpoints.save([{ path: "input/source.csv", bytes: Buffer.from("a,b") }, { path: "output/report.md", bytes: Buffer.from("report body") }]);
  const observation = save("execution-observations/op-1.json", "{\"stdout\":\"hi\"}"), source = save("public-sources/d-1.bin", "public bytes");
  const proposal = save("output/proposal-view.md", "proposal checkpoint"), response = save("consultation/p-1.txt", "advice text");
  const events: Record<string, unknown>[] = [
    { type: "checkpoint", contextId: "private", snapshot: workspace, sha256: checkpoints.fingerprint(workspace) },
    { type: "tool_finished", contextId: "private", executionCapture: "retained", executionObservation: { sha256: observation[0]!.sha256, snapshot: observation } },
    { type: "public_source_retained", contextId: "private", snapshot: source },
    { type: "consultation_proposed", contextId: "private", proposal: { checkpoint: proposal } },
    { type: "consultation_response", contextId: "private", response, contentSha256: digest("advice text") },
  ];
  return { root, checkpoints, blob, events, workspace, observation, source, proposal, response,
    failed: (records = events) => storageIntegrityFailed(records, "private", checkpoints, root) };
}

describe("backlog item 6, plan 6.3: the blobs a private context's records reference (BL-20261110-0715)", () => {
  it("passes intact storage and reads each distinct blob once, writing nothing", () => {
    const s = storage(), before = readdirSync(join(s.root, "checkpoints", "job-1")).sort(), load = vi.spyOn(s.checkpoints, "load");
    // A second checkpoint naming the same blobs adds no read.
    expect(s.failed([...s.events, { type: "checkpoint", contextId: "private", snapshot: s.workspace }])).toBe(false);
    const read = load.mock.calls.flatMap(([snapshot]) => (snapshot as WorkspaceSnapshot).map(row => row.sha256));
    expect(read.filter(sha256 => sha256 === s.workspace[1]!.sha256)).toHaveLength(1);
    expect(readdirSync(join(s.root, "checkpoints", "job-1")).sort()).toEqual(before);
  });

  it.each([["a checkpoint's", "workspace", 1], ["a retained observation's", "observation", 0], ["a retained public source's", "source", 0],
    ["a consultation proposal's checkpoint", "proposal", 0], ["a consultation response's", "response", 0]] as const)("ends at %s missing blob", (_, key, row) => {
    const s = storage();
    rmSync(s.blob(s[key][row]!.sha256));
    expect(s.failed()).toBe(true);
  });

  it("ends at a blob of the same size with other bytes, and at a resized blob", () => {
    const s = storage(), path = s.blob(s.workspace[1]!.sha256);
    writeFileSync(path, "report bodx");
    expect(s.failed()).toBe(true);
    writeFileSync(path, "report body, longer");
    expect(s.failed()).toBe(true);
  });

  it("ends when a consultation response no longer matches its recorded content digest, and leaves a response it cannot read alone", () => {
    const s = storage(), response = s.events.at(-1)!;
    expect(s.failed([...s.events.slice(0, -1), { ...response, contentSha256: digest("other advice") }])).toBe(true);
    // No file, or no digest: the runner never loads such a response (it reads as uncertain), so the scan skips it.
    expect(s.failed([...s.events.slice(0, -1), { ...response, response: [] }])).toBe(false);
    const { contentSha256: _digest, ...undigested } = response;
    expect(s.failed([...s.events.slice(0, -1), undigested])).toBe(false);
  });

  it("finds a missing blob behind an unreadable one in the same snapshot, in either order, and reads each blob once even then", () => {
    const s = storage(), unreadable = s.blob(s.workspace[0]!.sha256), shared = s.workspace[1]!;
    chmodSync(unreadable, 0o000); cleanups.push(() => chmodSync(unreadable, 0o600));
    const lost = s.checkpoints.save([{ path: "output/lost.md", bytes: Buffer.from("lost bytes") }])[0]!;
    rmSync(s.blob(lost.sha256));
    for (const rows of [[s.workspace[0]!, lost], [lost, s.workspace[0]!]]) expect(s.failed([{ type: "checkpoint", contextId: "private", snapshot: rows }])).toBe(true);
    // Five snapshots share a blob that sits behind the unreadable one: it is still read once.
    const load = vi.spyOn(s.checkpoints, "load");
    expect(s.failed(Array.from({ length: 5 }, () => ({ type: "checkpoint", contextId: "private", snapshot: [s.workspace[0]!, shared] })))).toBe(false);
    expect(load.mock.calls.filter(([rows]) => (rows as WorkspaceSnapshot).some(row => row.sha256 === shared.sha256))).toHaveLength(1);
  });

  it("leaves an environmental error, an unreadable record and another context's records alone", () => {
    const s = storage(), path = s.blob(s.observation[0]!.sha256);
    chmodSync(path, 0o000); cleanups.push(() => chmodSync(path, 0o600));
    expect(s.failed()).toBe(false);
    chmodSync(path, 0o600);
    // A record it cannot read, and a lost blob only another context references.
    const other = s.checkpoints.save([{ path: "notes/other.md", bytes: Buffer.from("other context") }]);
    rmSync(s.blob(other[0]!.sha256));
    expect(s.failed([...s.events, { type: "checkpoint", contextId: "private", snapshot: "not a snapshot" },
      { type: "checkpoint", contextId: "private", snapshot: [{ path: "x", sha256: "nope", bytes: 1 }] },
      { type: "tool_finished", contextId: "private", executionCapture: "retained" }, { type: "consultation_proposed", contextId: "private" },
      { type: "checkpoint", contextId: "public", snapshot: other }, { type: "tool_finished", contextId: "private", executionCapture: "unavailable", executionObservation: { snapshot: other } }])).toBe(false);
  });

  it("lets any integrity verdict win over an environmental error read first", () => {
    const s = storage(), unreadable = s.blob(s.workspace[1]!.sha256);
    chmodSync(unreadable, 0o000); cleanups.push(() => chmodSync(unreadable, 0o600));
    rmSync(s.blob(s.source[0]!.sha256));
    expect(s.failed()).toBe(true);
  });
});
