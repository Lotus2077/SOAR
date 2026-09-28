import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { sessionPhaseIdentity } from "../../src/main/private-agent/session";
import { loadPreparedOperatorTask } from "../../scripts/private-agent-run";
import { buildExplicitPublicSnapshotPhase, parseLocalArtifactScreenArguments, preparePublicSnapshot, startExplicitPublicSnapshotReceiver } from "../../scripts/private-agent-local-screen";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(privateText = "PRIVATE-ONLY-CANARY") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "soar-public-snapshot-"))); roots.push(root);
  const taskDir = join(root, "task"), directory = join(root, "public");
  mkdirSync(join(taskDir, "input/sources"), { recursive: true }); mkdirSync(directory);
  const source = Buffer.from('<a href="https://public.example.invalid/sources/details.html">original link</a>');
  const details = Buffer.from("Exact public source bytes. Price: 12.");
  const privateBytes = Buffer.from(privateText), privateBrief = Buffer.from(`Make a private recommendation: ${privateText}`);
  const inputs = [{ path: "sources/index.html", bytes: source, confidentiality: "public" },
    { path: "sources/details.html", bytes: details, confidentiality: "public" },
    { path: "private.txt", bytes: privateBytes, confidentiality: "private" }];
  const job = { schemaVersion: 1, jobId: "public-snapshot-fixture", goalFile: "brief.md",
    inputs: inputs.map(row => ({ path: row.path, sha256: digest(row.bytes), bytes: row.bytes.length, confidentiality: row.confidentiality })),
    requiredArtifacts: ["output/report.md"], requiredCapabilities: [],
    permissions: { externalModelDisclosure: "none", publicWeb: "separately approved fixture", publish: false, send: false, mutateInputs: false },
    verification: { deterministic: "structural", humanCriteria: ["semantic acceptance separate"], runtimeAndPrivacyReceiptRequired: true }, labelIsMetadataOnly: true, synthetic: true };
  const jobBytes = Buffer.from(canonical(job));
  writeFileSync(join(taskDir, "job.json"), jobBytes); writeFileSync(join(taskDir, "brief.md"), privateBrief);
  for (const row of inputs) writeFileSync(join(taskDir, "input", row.path), row.bytes);
  const brief = Buffer.from("Research the linked public snapshot; cite exact public claims.");
  const map = { schemaVersion: 1, origin: "https://public.example.invalid", routes: [
    { path: "/sources/index.html", inputPath: "sources/index.html", sourceId: "index" },
    { path: "/sources/details.html", inputPath: "sources/details.html", sourceId: "details" },
  ], privateDerivedRequestsPermitted: false };
  writeFileSync(join(directory, "brief.md"), brief);
  const saveMap = () => { const bytes = Buffer.from(canonical(map)); writeFileSync(join(directory, "receiver-map.json"), bytes); return digest(bytes); };
  const expectedMapSha256 = saveMap();
  const task = loadPreparedOperatorTask(taskDir, { jobSha256: digest(jobBytes), briefSha256: digest(privateBrief) });
  const options = { directory, expectedBriefSha256: digest(brief), expectedMapSha256, indexPath: "/sources/index.html" };
  return { root, task, options, map, saveMap, source, details, brief };
}

describe("explicit public snapshot preparation", () => {
  it.skipIf(process.env.SOAR_RUN_PRIVATE_AGENT_RUNTIME !== "true")("serves exact public bytes over HTTP while refusing private paths and mutations", async () => {
    const f = fixture(), snapshot = preparePublicSnapshot(f.task, f.options);
    const receiver = await startExplicitPublicSnapshotReceiver(snapshot);
    try {
      snapshot.routes[0]!.bytes.fill(88);
      const response = await fetch(`${receiver.endpoint}sources/index.html`, { signal: AbortSignal.timeout(3000) });
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(f.source);
      for (const path of ["private.txt", "sources/index.html?extra=PRIVATE-ONLY-CANARY", "not-mapped"]) {
        const denied = await fetch(`${receiver.endpoint}${path}`, { signal: AbortSignal.timeout(3000) });
        expect(denied.status).toBe(404); expect(await denied.text()).toBe("");
      }
      expect((await fetch(`${receiver.endpoint}sources/index.html`, { method: "POST", signal: AbortSignal.timeout(3000) })).status).toBe(404);
      expect(receiver.requestCount()).toBe(1);
    } finally { await receiver.close(); }
    await expect(fetch(`${receiver.endpoint}sources/index.html`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
  });
  it("binds exact public originals and keeps the private context out of the public phase", () => {
    const f = fixture(), snapshot = preparePublicSnapshot(f.task, f.options);
    expect(snapshot.routes[0]!.bytes.equals(f.source)).toBe(true);
    expect(snapshot.routes[1]!.bytes.equals(f.details)).toBe(true);
    const phase = buildExplicitPublicSnapshotPhase(snapshot, "http://127.0.0.1:43129/");
    expect(phase.files).toEqual([{ path: "public/brief.md", bytes: f.brief }]);
    expect(phase.contract.goal).toContain("https://public.example.invalid");
    expect(phase.contract.goal).toContain("http://127.0.0.1:43129/sources/index.html");
    expect(phase.contract.goal).not.toContain("PRIVATE-ONLY-CANARY");
    expect(phase.contract.goal).not.toContain("private.txt");
    expect(phase.files.every(file => !file.bytes.includes("PRIVATE-ONLY-CANARY") && file.path !== "input/private.txt")).toBe(true);
    expect(phase.approval.phaseSha256).toBe(sessionPhaseIdentity(phase));
    expect(phase.approval.goalSha256).toBe(digest(phase.contract.goal));
    expect(snapshot.binding.routes[0]).toMatchObject({ path: "/sources/index.html", sha256: digest(f.source), bytes: f.source.length });
    expect(snapshot.routes[0]!.bytes.toString()).toContain("https://public.example.invalid/sources/details.html");
  });

  it("changing only the private inputs leaves public phase bytes and instructions identical", () => {
    const a = fixture("PRIVATE-FIRST"), b = fixture("PRIVATE-SECOND");
    const phaseA = buildExplicitPublicSnapshotPhase(preparePublicSnapshot(a.task, a.options), "http://127.0.0.1:43129/");
    const phaseB = buildExplicitPublicSnapshotPhase(preparePublicSnapshot(b.task, b.options), "http://127.0.0.1:43129/");
    expect(phaseA).toEqual(phaseB);
  });

  it("rejects a mapping to a private original even when metadata hashes match", () => {
    const f = fixture(); f.map.routes[1]!.inputPath = "private.txt";
    expect(() => preparePublicSnapshot(f.task, { ...f.options, expectedMapSha256: f.saveMap() })).toThrow("operator_private_selection_denied");
  });

  it.each(["brief.md", "receiver-map.json"])("rejects changed %s bytes under the original expected hash", name => {
    const f = fixture(); writeFileSync(join(f.options.directory, name), "changed");
    expect(() => preparePublicSnapshot(f.task, f.options)).toThrow("public_snapshot_metadata_binding");
  });

  it("rejects changed original task files and ignores the mutable convenience copy", () => {
    const f = fixture(); f.task.publicInputs[0]!.bytes.fill(120);
    expect(preparePublicSnapshot(f.task, f.options).routes[0]!.bytes.equals(f.source)).toBe(true);
    f.task.phase.files.find(row => row.path === "input/sources/index.html")!.bytes.fill(121);
    expect(() => preparePublicSnapshot(f.task, f.options)).toThrow("operator_public_selection_binding");
  });

  it("copies bytes and detects prepared-buffer drift before phase construction", () => {
    const f = fixture(), snapshot = preparePublicSnapshot(f.task, f.options);
    f.task.phase.files.find(row => row.path === "input/sources/index.html")!.bytes.fill(120);
    expect(snapshot.routes[0]!.bytes.equals(f.source)).toBe(true);
    snapshot.routes[0]!.bytes.fill(121);
    expect(() => buildExplicitPublicSnapshotPhase(snapshot, "http://127.0.0.1:43129/")).toThrow("public_snapshot_prepared_drift");
  });

  it.each(["path", "inputPath", "sourceId"] as const)("rejects duplicate %s mappings", key => {
    const f = fixture(); f.map.routes[1]![key] = f.map.routes[0]![key];
    expect(() => preparePublicSnapshot(f.task, { ...f.options, expectedMapSha256: f.saveMap() })).toThrow("public_snapshot_routes_invalid");
  });

  it.each(["/../private.txt", "/sources/%2e%2e/private.txt", "/sources/%2fprivate.txt", "//other.invalid/index", "/sources/index.html?private=yes"])("rejects unsafe route %s", route => {
    const f = fixture(); f.map.routes[1]!.path = route;
    expect(() => preparePublicSnapshot(f.task, { ...f.options, expectedMapSha256: f.saveMap() })).toThrow();
  });

  it("rejects input traversal, missing index, non-origin URL and private-derived permission", () => {
    const f = fixture(); f.map.routes[1]!.inputPath = "../private.txt";
    expect(() => preparePublicSnapshot(f.task, { ...f.options, expectedMapSha256: f.saveMap() })).toThrow();
    f.map.routes[1]!.inputPath = "sources/details.html"; f.options.expectedMapSha256 = f.saveMap();
    expect(() => preparePublicSnapshot(f.task, { ...f.options, indexPath: "/missing" })).toThrow("public_snapshot_routes_invalid");
    f.map.origin = "https://user:password@public.example.invalid";
    expect(() => preparePublicSnapshot(f.task, { ...f.options, expectedMapSha256: f.saveMap() })).toThrow();
    f.map.origin = "https://public.example.invalid"; f.map.privateDerivedRequestsPermitted = true;
    expect(() => preparePublicSnapshot(f.task, { ...f.options, expectedMapSha256: f.saveMap() })).toThrow();
  });

  it("rejects symlink metadata and oversized briefs", () => {
    const f = fixture(), briefPath = join(f.options.directory, "brief.md");
    unlinkSync(briefPath); symlinkSync(join(f.root, "task/brief.md"), briefPath);
    expect(() => preparePublicSnapshot(f.task, f.options)).toThrow("public_snapshot_file_invalid");
    unlinkSync(briefPath); writeFileSync(briefPath, Buffer.alloc(32769, 97));
    expect(() => preparePublicSnapshot(f.task, f.options)).toThrow("public_snapshot_file_invalid");
  });

  it("permits an explicit root route without rewriting its source", () => {
    const f = fixture(); f.map.routes[0]!.path = "/";
    const snapshot = preparePublicSnapshot(f.task, { ...f.options, indexPath: "/", expectedMapSha256: f.saveMap() });
    expect(buildExplicitPublicSnapshotPhase(snapshot, "http://127.0.0.1:43129/").contract.goal).toContain("beginning at http://127.0.0.1:43129/");
  });
});

describe("public snapshot CLI", () => {
  const base = ["--execute-synthetic-local", "--task-directory", "synthetic-task", "--job-sha256", "a".repeat(64), "--brief-sha256", "b".repeat(64),
    "--authority-sha256", "c".repeat(64), "--image-id", `sha256:${"d".repeat(64)}`, "--output-directory", "synthetic-output", "--runtime-sha256", "e".repeat(64)];
  const extra = ["--public-snapshot-directory", "synthetic-public", "--public-snapshot-brief-sha256", "f".repeat(64),
    "--public-snapshot-map-sha256", "1".repeat(64), "--public-snapshot-index-path", "/sources/index.html"];
  it("preserves legacy public retrieval and parses the complete explicit option", () => {
    expect(parseLocalArtifactScreenArguments([...base, "--public-retrieval", "true"])).toMatchObject({ publicRetrieval: true });
    expect(parseLocalArtifactScreenArguments([...base, "--public-retrieval", "true"])).not.toHaveProperty("publicSnapshot");
    expect(parseLocalArtifactScreenArguments([...base, "--public-retrieval", "true", ...extra]).publicSnapshot).toEqual({ directory: "synthetic-public",
      expectedBriefSha256: "f".repeat(64), expectedMapSha256: "1".repeat(64), indexPath: "/sources/index.html" });
  });
  it("rejects partial, duplicate or disabled adapter arguments", () => {
    expect(() => parseLocalArtifactScreenArguments([...base, ...extra])).toThrow("local_screen_cli_invalid");
    expect(() => parseLocalArtifactScreenArguments([...base, "--public-retrieval", "true", ...extra.slice(0, 6)])).toThrow("local_screen_cli_invalid");
    expect(() => parseLocalArtifactScreenArguments([...base, "--public-retrieval", "true", ...extra, ...extra.slice(0, 2)])).toThrow("local_screen_cli_invalid");
  });
});
