import Database from "better-sqlite3";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { RulePacketScanner } from "../../src/main/private-agent/scanner";
import { digest } from "../../src/main/private-agent/contracts";

describe("private checkpoint authenticity", () => {
  it("detects changed or linked content instead of restoring unchecked bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "soar-private-checkpoint-"));
    try {
      const store = new PrivateCheckpointStore(root, "job");
      const snapshot = store.save([{ path: "output/数据.txt", bytes: Buffer.from("private synthetic text") }]);
      expect(store.load(snapshot)[0]?.bytes.toString()).toBe("private synthetic text");
      const file = join(root, "job", snapshot[0]!.sha256);
      writeFileSync(file, "changed");
      expect(() => store.load(snapshot)).toThrow();
      rmSync(file); symlinkSync(join(root, "outside"), file);
      writeFileSync(join(root, "outside"), "private synthetic text");
      expect(() => store.load(snapshot)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps blob stores separate between jobs and rejects path traversal", () => {
    const root = mkdtempSync(join(tmpdir(), "soar-private-checkpoint-"));
    try {
      const first = new PrivateCheckpointStore(root, "first"), second = new PrivateCheckpointStore(root, "second");
      const snapshot = first.save([{ path: "report.txt", bytes: Buffer.from("synthetic") }]);
      expect(() => second.load(snapshot)).toThrow();
      expect(() => first.save([{ path: "../escape", bytes: Buffer.from("synthetic") }])).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("private source lineage", () => {
  it("cannot erase confidentiality by changing an existing source version or label", () => {
    const db = new Database(":memory:");
    try {
      const store = new PrivateAgentStore(db);
      store.createJob({ version: 1, id: "job", mode: "private", revision: 0, cancelled: false, destinations: [], maxRequests: 10, maxFeeMicrousd: 0 });
      const source = { id: "document", version: digest("synthetic private value"), classification: "private" as const, synthetic: true };
      store.createContext({ id: "context", jobId: "job", sources: [source] });
      expect(() => store.addSources("context", [{ ...source, classification: "public" }])).toThrow("private_agent_source_version_changed");
      expect(() => store.addSources("context", [{ ...source, version: digest("changed") }])).toThrow("private_agent_source_version_changed");
      expect(store.context("context").sources).toEqual([source]);
    } finally { db.close(); }
  });
});

describe("deterministic credential scan is only a detector", () => {
  it("flags a known-shaped synthetic credential without claiming business confidentiality coverage", async () => {
    const scanner = new RulePacketScanner();
    const synthetic = `sk-${"x".repeat(32)}`;
    expect(await scanner.scan(synthetic)).toMatchObject({ complete: true, blocked: true });
    expect(await scanner.scan("The confidential acquisition target is Example Company.")).toMatchObject({ complete: true, blocked: false });
    // The broker must still deny this source on provenance, irrespective of this result.
  });
});
