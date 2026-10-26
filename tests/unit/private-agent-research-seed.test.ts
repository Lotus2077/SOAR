import Database from "better-sqlite3";
import { existsSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET, RESEARCH_PIPELINE_VERSION, researchProtocolSha256 } from "../../src/main/private-agent/research-pipeline";
import { loadResearchSeed, researchTransferPresent, researchTransferSnapshot, seededPipelineFreeze } from "../../src/main/private-agent/research-seed";
import { RESEARCH_TRANSFER_CHECK_ID, researchTransferPhase, sessionFileManifest, sessionPhaseIdentity, type SessionPhase } from "../../src/main/private-agent/session";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const h = (n: string) => n.repeat(64);
const task = { jobSha256: h("1"), briefSha256: h("2") };
const produced = [{ path: RESEARCH_FILES.evidence, bytes: Buffer.from('{"version":1,"quotes":[]}') }, { path: RESEARCH_FILES.summary, bytes: Buffer.from("{}\n") }];
const pipeline = () => ({ name: "research", version: RESEARCH_PIPELINE_VERSION, protocolSha256: researchProtocolSha256(RESEARCH_PIPELINE_BUDGET), budget: { ...RESEARCH_PIPELINE_BUDGET }, planner: "cloud", writer: "local" });
/** A source run directory the way the driver leaves one: freeze.json, state.sqlite with the session's events, content-addressed checkpoints. */
function sourceRun(input: { freeze?: Record<string, unknown>; transfer?: boolean; corrupt?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "soar-seed-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const jobId = "job-a";
  const freeze = Object.fromEntries(Object.entries({ version: 1, jobId, taskBinding: task, deployment: "synthetic_only_unverified_for_private_data", pipeline: pipeline(), ...input.freeze }).filter(([, value]) => value !== undefined));
  writeFileSync(join(dir, "freeze.json"), `${canonical(freeze)}\n`);
  const db = new Database(join(dir, "state.sqlite")); const store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["m"], maxRequests: 10, maxFeeMicrousd: 0 });
  const checkpoints = new PrivateCheckpointStore(join(dir, "checkpoints"), jobId);
  const snapshot = checkpoints.save(produced);
  store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q", readerContextId: "r" });
  if (input.transfer !== false) store.append(jobId, { type: "research_transfer", contextId: "r", binding: { snapshot, snapshotSha256: checkpoints.fingerprint(snapshot), files: sessionFileManifest(produced), summary: {} } });
  db.close();
  if (input.corrupt) writeFileSync(join(dir, "checkpoints", jobId, snapshot[0]!.sha256), "tampered");
  return dir;
}

describe("H4: a second sample and a repair write from a first sample's evidence packet", () => {
  it("loads the transfer from the source run's ledger and checkpoints, verified, and records a one-hop lineage", () => {
    const dir = sourceRun();
    const loaded = loadResearchSeed(dir, task);
    expect(loaded.files.map(file => [file.path, file.bytes.toString()])).toEqual(produced.map(file => [file.path, file.bytes.toString()]));
    expect(loaded.seed).toEqual({ version: 1, sourceJobId: "job-a", sourceFreezeSha256: digest(Buffer.from(`${canonical({ version: 1, jobId: "job-a", taskBinding: task, deployment: "synthetic_only_unverified_for_private_data", pipeline: pipeline() })}\n`)),
      snapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/u), files: sessionFileManifest(produced) });
    expect(loaded.pipeline).toEqual(pipeline());
    expect(seededPipelineFreeze(loaded.pipeline, loaded.seed)).toEqual({ ...pipeline(), seededFrom: "job-a" });
    // The loop asks only for the packet's fingerprint; a seeded run or a run without a transfer offers none.
    expect(researchTransferSnapshot(dir)).toBe(loaded.seed.snapshotSha256); expect(researchTransferPresent(dir)).toBe(true);
    expect(researchTransferSnapshot(sourceRun({ transfer: false }))).toBeNull(); expect(researchTransferSnapshot(sourceRun({ freeze: { researchFrom: { version: 1 } } }))).toBeNull();
  });
  it("refuses another task, a non-synthetic run, a seeded source, a run without the stage or its transfer, a protocol that differs from the current code, and bytes that drifted", () => {
    expect(() => loadResearchSeed(sourceRun(), { ...task, briefSha256: h("9") })).toThrow("research_seed_task_mismatch");
    expect(() => loadResearchSeed(sourceRun({ freeze: { deployment: "private" } }), task)).toThrow("research_seed_not_synthetic");
    expect(() => loadResearchSeed(sourceRun({ freeze: { researchFrom: { version: 1 } } }), task)).toThrow("research_seed_source_seeded");
    expect(() => loadResearchSeed(sourceRun({ freeze: { pipeline: undefined } }), task)).toThrow("research_seed_no_pipeline");
    expect(() => loadResearchSeed(sourceRun({ transfer: false }), task)).toThrow("research_seed_no_transfer");
    expect(() => loadResearchSeed(sourceRun({ freeze: { pipeline: { ...pipeline(), version: RESEARCH_PIPELINE_VERSION + 1 } } }), task)).toThrow("research_seed_protocol_mismatch");
    expect(() => loadResearchSeed(sourceRun({ freeze: { pipeline: { ...pipeline(), protocolSha256: h("4") } } }), task)).toThrow("research_seed_protocol_mismatch");
    expect(() => loadResearchSeed(sourceRun({ freeze: { pipeline: { ...pipeline(), budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 3 } } } }), task)).toThrow("research_seed_protocol_mismatch");
    expect(() => loadResearchSeed(sourceRun({ corrupt: true }), task)).toThrow(/checkpoint_(file_invalid|digest_mismatch)/u);
    // Nothing is created in a source run: a run without its checkpoints is refused, and a symlinked ledger is refused.
    const pruned = sourceRun(); rmSync(join(pruned, "checkpoints"), { recursive: true, force: true });
    expect(() => loadResearchSeed(pruned, task)).toThrow("research_seed_checkpoints_missing"); expect(existsSync(join(pruned, "checkpoints"))).toBe(false);
    const linked = sourceRun(), elsewhere = mkdtempSync(join(tmpdir(), "soar-seed-elsewhere-")); cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }));
    renameSync(join(linked, "state.sqlite"), join(elsewhere, "state.sqlite")); symlinkSync(join(elsewhere, "state.sqlite"), join(linked, "state.sqlite"));
    expect(() => loadResearchSeed(linked, task)).toThrow("research_seed_directory_invalid"); expect(() => researchTransferSnapshot(linked)).toThrow("research_seed_directory_invalid");
  });
  it("builds the seeded write phase exactly as the session builds it after its own stage", () => {
    const base: SessionPhase = { files: [{ path: "brief.md", bytes: Buffer.from("b") }, { path: "input/a.md", bytes: Buffer.from("a") }], checks: [{ id: "c", python: "pass" }],
      contract: { version: 1, goal: "Write it.", requiredArtifacts: [{ path: "output/report.md", description: "r" }], requiredChecks: ["c"], maxModelCalls: 5, maxToolCalls: 5, maxElapsedMs: 60_000 } };
    const seeded = researchTransferPhase(base, loadResearchSeed(sourceRun(), task).files);
    expect(seeded.files.map(file => file.path)).toEqual(["brief.md", "input/a.md", RESEARCH_FILES.evidence, RESEARCH_FILES.summary]);
    expect(seeded.contract.requiredChecks).toEqual(["c", RESEARCH_TRANSFER_CHECK_ID]); expect(seeded.checks.map(check => check.id)).toEqual(["c", RESEARCH_TRANSFER_CHECK_ID]);
    expect(seeded.contract.goal).toContain("A host-run reading stage");
    // The same packet twice is the same phase; a packet file that collides with a phase file is refused.
    expect(sessionPhaseIdentity(researchTransferPhase(base, produced))).toBe(sessionPhaseIdentity(seeded));
    expect(() => researchTransferPhase({ ...base, files: [...base.files, { path: RESEARCH_FILES.summary, bytes: Buffer.from("x") }] }, produced)).toThrow("research_transfer_collision");
  });
});
