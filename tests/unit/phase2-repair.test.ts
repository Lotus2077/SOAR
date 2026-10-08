import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateAgentBroker, type BrokerDestination } from "../../src/main/private-agent/broker";
import { digest } from "../../src/main/private-agent/contracts";
import { CRITIC_PURPOSE, CRITIC_SYSTEM_PROMPT, REPAIR_CRITIQUE_PATH, REPAIR_INSTRUCTIONS, REPAIR_PACKET_MAX_BYTES, boundedUtf8, buildRepairPacket,
  loadRepairDirectory, repairDraftPaths, repairMatchesRun, selfCheckFromEvents, withRepair, type RepairBinding } from "../../src/main/private-agent/repair";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import type { SessionPhase } from "../../src/main/private-agent/session";
import { loadFailedRun, parseCritiqueArguments, runCritique } from "../../scripts/phase2-repair";
import { parseLocalArtifactScreenArguments } from "../../scripts/private-agent-local-screen";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const step of cleanups.splice(0).reverse()) await step(); });
const h = (n: string) => n.repeat(64);

describe("Phase 2 repair pair: packet and seeding", () => {
  it("cuts text to a byte bound without splitting a character, and says how much was cut", () => {
    expect(boundedUtf8("short", 100)).toBe("short");
    const cut = boundedUtf8("双".repeat(1000), 200);
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(200); expect(cut).toMatch(/^双+\n\[truncated: \d+ bytes omitted\]$/u);
  });
  it("builds one deterministic packet of at most 64 KiB, files in path order, every part bounded", () => {
    const input = { brief: "Write the memo.", selfCheck: { finish: '{"complete":false}', checkClaims: '{"passed":true}' },
      artifacts: [{ path: "output/z.md", text: "z".repeat(200_000) }, { path: "output/a.md", text: "alpha" }] };
    const packet = buildRepairPacket(input);
    expect(Buffer.byteLength(packet.text)).toBeLessThanOrEqual(REPAIR_PACKET_MAX_BYTES);
    expect(packet.text.indexOf("output/a.md")).toBeLessThan(packet.text.indexOf("output/z.md"));
    expect(packet.text).toContain("[truncated:"); expect(packet.text).toContain('Last finish result:\n{"complete":false}');
    expect(buildRepairPacket({ ...input, artifacts: [...input.artifacts].reverse() })).toEqual(packet);
    expect(packet.sha256).toBe(digest(packet.text));
    // A small file keeps everything; the large one gets the room it leaves.
    const fair = buildRepairPacket({ brief: "b", selfCheck: {}, artifacts: [{ path: "output/claims.json", text: "c".repeat(4000) }, { path: "output/report.md", text: "r".repeat(200_000) }] });
    expect(fair.text).toContain("c".repeat(4000)); expect(fair.text.split("r".repeat(1000)).length).toBeGreaterThan(50);
  });
  it("reads the last finish and check_claims results the agent saw, and lists the draft files of the task's mode", () => {
    const events = [{ type: "tool_started", operationId: "a", name: "finish" }, { type: "tool_finished", operationId: "a", output: "first" },
      { type: "tool_started", operationId: "b", name: "check_claims" }, { type: "tool_finished", operationId: "b", output: "claims" },
      { type: "tool_started", operationId: "c", name: "finish" }, { type: "tool_finished", operationId: "c", output: "last" },
      { type: "tool_started", operationId: "d", name: "execute" }, { type: "tool_finished", operationId: "d", output: "not a check" }];
    expect(selfCheckFromEvents(events)).toEqual({ finish: "last", checkClaims: "claims" });
    // Only the private phase counts: a public phase's later finish is not what the drafting agent saw at the end.
    const phased = [{ type: "session_started", privateContextId: "p" }, { type: "tool_started", contextId: "p", operationId: "x", name: "finish" },
      { type: "tool_finished", contextId: "p", operationId: "x", output: "private" }, { type: "tool_started", contextId: "q", operationId: "y", name: "finish" },
      { type: "tool_finished", contextId: "q", operationId: "y", output: "public" }];
    expect(selfCheckFromEvents(phased)).toEqual({ finish: "private" });
    expect(repairDraftPaths({ requiredArtifacts: ["output/report.md"], claimsLedger: true, documentReview: false })).toEqual(["output/claims.json", "output/report.md"]);
    expect(repairDraftPaths({ requiredArtifacts: ["output/summary.md"], claimsLedger: false, documentReview: true })).toContain("review/edits.json");
  });
  const phase = (): SessionPhase => ({ files: [{ path: "brief.md", bytes: Buffer.from("brief") }, { path: "input/a.txt", bytes: Buffer.from("in") }],
    checks: [{ id: "c", python: "pass" }], contract: { version: 1, goal: "Do the task.", requiredArtifacts: [{ path: "output/report.md", description: "r" }],
      requiredChecks: ["c"], maxModelCalls: 5, maxToolCalls: 5, maxElapsedMs: 60_000 } });
  const draft = [{ path: "output/report.md", bytes: Buffer.from("draft report") }], critique = Buffer.from("1. Fix the example.\n");
  const binding = (): RepairBinding => ({ version: 1, critic: "local", criticModel: "m", promptVersion: 1, criticMaxOutputTokens: 16_384, packetSha256: h("a"), critiqueSha256: digest(critique),
    source: { taskJobSha256: h("b"), taskBriefSha256: h("f"), resultSha256: h("c"), freezeSha256: h("d"), profile: "heavy", claimsLedger: false, documentReview: false },
    draft: [{ path: "output/report.md", sha256: digest(Buffer.from("draft report")) }] });
  it("seeds the identical draft and the critique and appends the repair instruction, checking every byte", () => {
    const repaired = withRepair(phase(), { binding: binding(), draft, critique });
    expect(repaired.files.map(file => file.path)).toEqual(["brief.md", "input/a.txt", "output/report.md", REPAIR_CRITIQUE_PATH]);
    expect(repaired.contract.goal).toBe(`Do the task.\n${REPAIR_INSTRUCTIONS}`);
    expect(() => withRepair(phase(), { binding: binding(), draft, critique: Buffer.from("other") })).toThrow("repair_critique_changed");
    expect(() => withRepair(phase(), { binding: binding(), draft: [{ path: "output/report.md", bytes: Buffer.from("edited") }], critique })).toThrow("repair_draft_changed");
    const taken = phase(); taken.files.push({ path: "output/report.md", bytes: Buffer.from("x") });
    expect(() => withRepair(taken, { binding: binding(), draft, critique })).toThrow("repair_path_taken");
    for (const path of ["../escape", "output/../../etc/hosts", "output/./x", "review/a/../b"]) expect(() => withRepair(phase(), { binding: { ...binding(), draft: [{ path, sha256: h("e") }] }, draft, critique })).toThrow();
    // The same job, brief, profile and mode, or no repair.
    const run = { jobSha256: h("b"), briefSha256: h("f"), profile: "heavy", claimsLedger: false, documentReview: false };
    expect(repairMatchesRun(binding(), run)).toBe(true);
    for (const change of [{ briefSha256: h("9") }, { jobSha256: h("9") }, { profile: "standard" }, { claimsLedger: true }, { documentReview: true }]) expect(repairMatchesRun(binding(), { ...run, ...change })).toBe(false);
  });
  it("reads back a critique directory, and refuses a symlink that would point the repair outside it", () => {
    const dir = mkdtempSync(join(tmpdir(), "soar-repair-dir-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "draft", "output"), { recursive: true });
    writeFileSync(join(dir, "critique.json"), JSON.stringify({ ...binding(), finishReason: "stop", usage: null, servedModel: null, feeMicrousd: 0 }));
    writeFileSync(join(dir, "critique.md"), critique); writeFileSync(join(dir, "draft", "output", "report.md"), "draft report");
    const loaded = loadRepairDirectory(dir);
    expect(loaded.binding).toEqual(binding()); expect(loaded.draft[0]!.bytes.toString()).toBe("draft report");
    rmSync(join(dir, "draft", "output", "report.md")); writeFileSync(join(dir, "outside.md"), "draft report");
    symlinkSync(join(dir, "outside.md"), join(dir, "draft", "output", "report.md"));
    expect(() => loadRepairDirectory(dir)).toThrow("repair_directory_invalid");
  });
});

describe("Phase 2 repair pair: the failed run and the critic", () => {
  function failedRun(deployment = "synthetic_only_unverified_for_private_data", jobSha256 = h("1"), extra: Record<string, unknown> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "soar-repair-run-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "freeze.json"), JSON.stringify({ taskBinding: { jobSha256, briefSha256: h("7") }, deployment, profile: "heavy", claimsLedger: true,
      arm: { arm: "local" }, publicPhaseSha256: null, ...extra }));
    writeFileSync(join(dir, "result.json"), JSON.stringify({ status: "submitted" }));
    mkdirSync(join(dir, "candidate", "output"), { recursive: true });
    writeFileSync(join(dir, "candidate", "output", "report.md"), "draft"); writeFileSync(join(dir, "candidate", "output", "claims.json"), "{}");
    const db = new Database(join(dir, "state.sqlite"));
    db.exec("CREATE TABLE private_agent_events (job_id TEXT, sequence INTEGER, value TEXT)");
    db.prepare("INSERT INTO private_agent_events VALUES (?, ?, ?)").run("j", 1, JSON.stringify({ type: "tool_started", operationId: "o", name: "finish" }));
    db.prepare("INSERT INTO private_agent_events VALUES (?, ?, ?)").run("j", 2, JSON.stringify({ type: "tool_finished", operationId: "o", output: "{\"complete\":true}" }));
    db.close();
    return dir;
  }
  it("loads a synthetic failed run of the same task with its draft and events, and refuses anything else", () => {
    const task = { jobSha256: h("1"), briefSha256: h("7") };
    const run = loadFailedRun(failedRun(), task, ["output/report.md"]);
    expect(run.draft.map(file => file.path)).toEqual(["output/claims.json", "output/report.md"]);
    expect(selfCheckFromEvents(run.events)).toEqual({ finish: '{"complete":true}' });
    expect(() => loadFailedRun(failedRun(), { ...task, jobSha256: h("2") }, ["output/report.md"])).toThrow("repair_source_task_mismatch");
    expect(() => loadFailedRun(failedRun(), { ...task, briefSha256: h("2") }, ["output/report.md"])).toThrow("repair_source_task_mismatch");
    expect(() => loadFailedRun(failedRun("private"), task, ["output/report.md"])).toThrow("repair_source_not_synthetic");
    // Only an L-Heavy draft: never a cloud run, a Standard run or an earlier repair; never a run with a public phase.
    for (const extra of [{ arm: { arm: "cloud" } }, { profile: "standard" }, { repair: { version: 1 } }]) expect(() => loadFailedRun(failedRun(undefined, h("1"), extra), task, ["output/report.md"])).toThrow("repair_source_not_l_heavy");
    expect(() => loadFailedRun(failedRun(undefined, h("1"), { publicPhaseSha256: h("8") }), task, ["output/report.md"])).toThrow("repair_source_public_phase_unsupported");
  });
  it("sends one tool-less critic request with the fixed prompt and the packet, and returns the critique", async () => {
    const bodies: string[] = [];
    const server = http.createServer((request, response) => {
      let body = ""; request.on("data", chunk => { body += chunk; });
      request.on("end", () => { bodies.push(body); response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "1. The JSON example is invalid: fix the braces." }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 12 } })); });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
    const db = new Database(":memory:"); cleanups.push(() => { db.close(); });
    const store = new PrivateAgentStore(db);
    const destination: BrokerDestination = { id: "owned_local_model", kind: "local_model", endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`,
      accountId: "fixture", credentialVersion: 1, privateDataAdmitted: false, syntheticOnly: true, loopbackFixture: true, maxResponseBytes: 64 * 1024, timeoutMs: 5000 };
    const broker = new PrivateAgentBroker(store, [destination], { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) });
    const packet = buildRepairPacket({ brief: "Write a memo.", artifacts: [{ path: "output/report.md", text: "{{\"a\":1}}" }], selfCheck: {} });
    const answer = await runCritique({ store, broker, destination, packet, maxFeeMicrousd: 0, signal: AbortSignal.timeout(10_000),
      modelConfig: { destinationId: destination.id, model: "fixture", maxOutputTokens: 16_384, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" } });
    expect(answer).toMatchObject({ text: "1. The JSON example is invalid: fix the braces.\n", finishReason: "stop", feeMicrousd: 0 });
    const sent = JSON.parse(bodies[0]!) as { messages: { role: string; content: string }[]; tools?: unknown; max_tokens: number };
    expect(sent.messages).toEqual([{ role: "system", content: CRITIC_SYSTEM_PROMPT }, { role: "user", content: packet.text }]);
    expect(sent).not.toHaveProperty("tools"); expect(sent.max_tokens).toBe(16_384);
    expect(store.dispatches(answer.jobId)).toMatchObject([{ status: "settled", purpose: CRITIC_PURPOSE }]);
  });
  it("parses the critique command line, and the driver's --repair-from, which is local only", () => {
    const base = ["--critique", "--run-directory", "r", "--task-directory", "t", "--job-sha256", h("a"), "--brief-sha256", h("b"), "--image-id", `sha256:${h("c")}`, "--output-directory", "o"];
    expect(parseCritiqueArguments([...base, "--critic", "local"])).toMatchObject({ critic: "local" });
    expect(() => parseCritiqueArguments([...base, "--critic", "cloud"])).toThrow("repair_cli_invalid");
    expect(() => parseCritiqueArguments([...base, "--critic", "local", "--cloud-model", "m"])).toThrow("repair_cli_invalid");
    expect(parseCritiqueArguments([...base, "--critic", "cloud", "--cloud-model", "m", "--cloud-endpoint", "https://api.example.invalid/v1/chat/completions",
      "--cloud-prices", "2,8,0.5", "--max-fee-usd", "1"])).toMatchObject({ critic: "cloud", cloudArm: { maxFeeUsd: 1 } });
    const driver = ["--execute-synthetic-local", "--task-directory", "t", "--job-sha256", h("a"), "--brief-sha256", h("b"), "--authority-sha256", h("c"),
      "--image-id", `sha256:${h("d")}`, "--output-directory", "o", "--runtime-sha256", h("e")];
    expect(parseLocalArtifactScreenArguments([...driver, "--repair-from", "critique-dir"]).repairFrom).toBe("critique-dir");
    expect(() => parseLocalArtifactScreenArguments([...driver, "--repair-from", "x", "--arm", "cloud", "--cloud-model", "m", "--cloud-endpoint", "https://e.invalid/v1",
      "--cloud-prices", "1,1,1", "--max-fee-usd", "1"])).toThrow("local_screen_cli_invalid");
  });
});
