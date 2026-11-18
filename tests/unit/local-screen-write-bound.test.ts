import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../src/main/config";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { withDeckValidity } from "../../src/main/private-agent/ooxml";
import { COORDINATOR_PROFILES, GENERAL_TASK_BUDGETS } from "../../src/main/private-agent/profiles";
import { researchPresentationIdentity } from "../../src/main/private-agent/research-presentation";
import { loadResearchSeed } from "../../src/main/private-agent/research-seed";
import { researchTransferPhase, sessionPhaseIdentity } from "../../src/main/private-agent/session";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { parseLoopArguments, runSelectionLoop, type LoopDependencies } from "../../scripts/phase4-loop";
import { LOCAL_SCREEN_WRITE_BOUNDS, buildLocalScreenModelConfig, localScreenExitCode, localScreenFailureLine, localScreenSourceFreeze, parseLocalArtifactScreenArguments,
  runLocalArtifactScreen, withClaimsLedger, type LocalScreenInput } from "../../scripts/private-agent-local-screen";
import { loadPreparedOperatorTask } from "../../scripts/private-agent-run";
import { RESEARCH_PROTOCOL_SHA256 } from "../helpers/research-protocol-pin";
import { writeResearchSeedSource } from "../helpers/research-seed-source";

/**
 * E2 (BL-20261117-1049-e2-write-bound-and-dry-run-design): the driver's named write bound, its dry run, and the offline proof that
 * `registry-row.py --run-dir` rows a seeded single run. Nothing here starts a session, sends a request or needs Docker.
 */
const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const step of cleanups.splice(0).reverse()) step(); });
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "registry-row.py");
const h = (n: string) => n.repeat(64);
function workspace(): string { const root = realpathSync(mkdtempSync(join(tmpdir(), "soar-write-bound-"))); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; }

/**
 * Writer-1's seeded Heavy write phase on this file's task and seed, as the unmodified driver built it at main 60aebc9, whose frozen files
 * equal c02366a's: read on 2026-11-17 by stopping that driver right after it builds `privatePhase`, in two runs on fresh fixtures
 * (decision (6)). The write phase must stay byte-identical, so this value never moves without an entry that says why.
 * Item (ii) moved it (BL-20261117-1145-research-second-repair-implemented, and its Correction): the phase holds the seed packet's
 * coverage.json, whose version 4 and new protocol hash change its bytes. It was 047f181ce77830e47681b94ed33c7ec454f13e0740d5201c98ce967b69a1e05f.
 * The owner's answer of 2026-11-18 (#166) moved it again: the seed's coverage.json is version 5 and records the new protocol hash (the seed
 * has no gap), and the writer's instructions gain a sentence on gaps. It was df3b387d51f3627a39690506682a9c2e86909cf4d5b96eae0eefe18f9a9d0c5a.
 */
const WRITER_1_PHASE_SHA256 = "7c0193d47f2b0ddb5b8f912c04e952a934b2181089734f30d43ebd4330862841";
/** Heavy's limits as freeze.json records them for a seeded local writer. */
const HEAVY_LIMITS = { requests: 200, modelCalls: 80, toolCalls: 120, outputTokens: 16_384, inputBytes: 640 * 1024, requestTimeoutMs: 900_000, elapsedMs: 5_400_000, feeMicrousd: 0 };
const environment = (baseUrl: string) => ({ SOAR_PROVIDER_MODE: "local", SOAR_VLLM_BASE_URL: baseUrl, SOAR_VLLM_COST_POLICY: "local_zero_cost", SOAR_VLLM_MODEL: "RM-01 VLM" });

/** The role-config test's synthetic operator task, whose one input holds a quotable line, and a packet run that read it (the seed source). */
async function seededTask(root: string) {
  const task = join(root, "operator-task"); mkdirSync(join(task, "input"), { recursive: true }); mkdirSync(join(root, "runs")); mkdirSync(join(root, "cwd"));
  const data = Buffer.from("The synthetic survey recorded twelve healthy trees in the orchard.\n"), brief = "Summarise input/input.txt in output/result.txt with its claims ledger.";
  const job = canonical({ schemaVersion: 1, jobId: "synthetic_operator_fixture", goalFile: "brief.md",
    inputs: [{ path: "input.txt", sha256: digest(data), bytes: data.length, confidentiality: "private" }],
    requiredArtifacts: ["output/result.txt"], requiredCapabilities: ["local_calculation"],
    permissions: { externalModelDisclosure: "none", publicWeb: "none", publish: false, send: false, mutateInputs: false },
    verification: { deterministic: "independent arithmetic", humanCriteria: ["computed result"], runtimeAndPrivacyReceiptRequired: true },
    labelIsMetadataOnly: true, synthetic: true });
  writeFileSync(join(task, "job.json"), job); writeFileSync(join(task, "brief.md"), brief); writeFileSync(join(task, "input/input.txt"), data);
  const plain = { taskDirectory: task, expectedJobSha256: digest(job), expectedBriefSha256: digest(brief), syntheticAuthoritySha256: digest("authored synthetic fixture"),
    expectedRuntimeSha256: localScreenSourceFreeze().sha256, imageId: `sha256:${"0".repeat(64)}`, outputDirectory: join(root, "runs", "writer"),
    profile: "heavy" as const, claimsLedger: true };
  const loaded = loadPreparedOperatorTask(task, { jobSha256: plain.expectedJobSha256, briefSha256: plain.expectedBriefSha256 });
  const source = join(root, "packet-run");
  await writeResearchSeedSource(source, { taskBinding: loaded.binding, brief: withClaimsLedger(loaded.phase, false).contract.goal,
    sources: loaded.phase.files.filter(file => file.path.startsWith("input/")).map(file => ({ id: file.path, path: file.path, bytes: file.bytes })) });
  return { plain, seeded: { ...plain, researchFrom: source }, loaded, source, cwd: join(root, "cwd") };
}

/** A loopback endpoint that counts every request that reaches it: a dry run must leave it at zero. */
async function counter() {
  let count = 0;
  const server = http.createServer((_request, response) => { count++; response.statusCode = 503; response.end(); });
  await new Promise<void>(yes => server.listen(0, "127.0.0.1", yes));
  cleanups.push(() => { server.closeAllConnections(); server.close(); });
  return { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, count: () => count };
}

/** Every entry under `root` with its kind, mode and, for a file, its bytes' sha256: a dry run must leave the set unchanged. */
function tree(root: string, at = ""): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const name of readdirSync(join(root, at)).sort()) {
    const path = join(at, name), stat = lstatSync(join(root, path));
    entries[path] = stat.isDirectory() ? `dir:${stat.mode}` : stat.isSymbolicLink() ? `link:${stat.mode}` : `file:${stat.mode}:${digest(readFileSync(join(root, path)))}`;
    if (stat.isDirectory()) Object.assign(entries, tree(root, path));
  }
  return entries;
}

/** The driver's dry run: its result, and its one printed line parsed. */
async function dryRun(input: LocalScreenInput, baseUrl: string, cwd: string): Promise<Record<string, any>> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; }) as typeof process.stdout.write);
  try { expect(await runLocalArtifactScreen({ ...input, dryRun: true }, { environment: environment(baseUrl), cwd })).toEqual({ status: "dry_run" }); }
  finally { spy.mockRestore(); }
  expect(lines).toHaveLength(1); expect(lines[0]!.endsWith("\n")).toBe(true);
  const line = JSON.parse(lines[0]!) as Record<string, any>;
  expect(lines[0]).toBe(`${canonical(line)}\n`);
  return line;
}

describe("E2's write bound and the driver's dry run (BL-20261117-1049-e2-write-bound-and-dry-run-design)", () => {
  it("pins writer-1's seeded Heavy write phase byte for byte with the protocol hash, and prints the freeze's fixed fields with Heavy's limits", async () => {
    const root = workspace(), { seeded, loaded, source, cwd } = await seededTask(root), endpoint = await counter();
    const line = await dryRun(seeded, endpoint.baseUrl, cwd);
    expect(line.state).toBe("dry_run");
    expect(line.privatePhaseSha256).toBe(WRITER_1_PHASE_SHA256);
    expect(line.pipeline).toMatchObject({ name: "research", protocolSha256: RESEARCH_PROTOCOL_SHA256, planner: "local", writer: "local" });
    // The seed with its snapshot sha256, and the presentation's identity, are the ones the seed loader gives.
    const seed = loadResearchSeed(resolve(source), loaded.binding);
    expect(line.researchFrom).toEqual(JSON.parse(canonical(seed.seed)));
    expect(line.researchFrom.snapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
    const phase = researchTransferPhase(withDeckValidity(withClaimsLedger({ ...loaded.phase, contract: { ...loaded.phase.contract, maxModelCalls: 80, maxToolCalls: 120,
      maxElapsedMs: 5_400_000 } }, false)), seed.files);
    expect(line.initialEvidenceIdentity).toBe(researchPresentationIdentity(phase.initialEvidence!));
    // Heavy's limits, and no key a named bound adds.
    expect(line.limits).toEqual(HEAVY_LIMITS);
    // Heavy's model configuration under the run's settings (SOAR_STREAMING unset is streaming on, and the cache salt is the default's);
    // the endpoint appears only as its hash.
    const config = loadConfig({ environment: environment(endpoint.baseUrl), cwd });
    expect(config.streamingEnabled).toBe(true);
    expect(line.modelConfig).toEqual(JSON.parse(canonical(buildLocalScreenModelConfig(config, COORDINATOR_PROFILES.heavy))));
    expect(line.modelConfig).toMatchObject({ model: "RM-01 VLM", thinking: "medium", maxOutputTokens: 16_384, maxRequestBytes: 640 * 1024, streaming: true,
      promptCaching: "vllm_job_salt_v1", sampling: { temperature: 1, top_p: 0.95, top_k: 20 } });
    expect(line.endpointIdentitySha256).toBe(digest(`${endpoint.baseUrl}/chat/completions`));
    expect(JSON.stringify(line)).not.toContain(endpoint.baseUrl.replace("/v1", ""));
    // The freeze's fields fixed before a run, less the per-file source list: never the job id, the start or the acceptance.
    expect(line).toMatchObject({ version: 1, sourceFreezeSha256: localScreenSourceFreeze().sha256, profile: "heavy", claimsLedger: true, arm: { arm: "local" },
      taskBinding: loaded.binding, publicPhaseSha256: null, publicSnapshot: null });
    for (const key of ["jobId", "startedAt", "artifactAccepted", "sourceFreeze", "servingCard", "repair", "diagnosticsRetained", "researchInput"]) expect(line).not.toHaveProperty(key);
    expect(endpoint.count()).toBe(0);
  });

  it("writer-2's named bound changes the write phase's three limits and nothing else: Heavy's model profile and the session's pool and clock stay", async () => {
    const root = workspace(), { seeded, loaded, source, cwd } = await seededTask(root), endpoint = await counter();
    const writer1 = await dryRun(seeded, endpoint.baseUrl, cwd), writer2 = await dryRun({ ...seeded, writeBound: "twelve-call" }, endpoint.baseUrl, cwd);
    expect(writer2.limits).toEqual({ ...HEAVY_LIMITS, modelCalls: 12, toolCalls: 12, elapsedMs: 1_200_000, writeBound: "twelve-call", sessionElapsedMs: 5_400_000 });
    // Every other printed field is writer-1's: the model configuration, the seed, the presentation, the protocol, the commit.
    const { limits: _l1, privatePhaseSha256: phase1, ...rest1 } = writer1, { limits: _l2, privatePhaseSha256: phase2, ...rest2 } = writer2;
    expect(rest2).toEqual(rest1);
    expect(phase2).not.toBe(phase1);
    // Both phases are today's construction; the contract's three numbers are the one difference.
    const seed = loadResearchSeed(resolve(source), loaded.binding);
    const phase = (limits: { maxModelCalls: number; maxToolCalls: number; maxElapsedMs: number }) =>
      researchTransferPhase(withDeckValidity(withClaimsLedger({ ...loaded.phase, contract: { ...loaded.phase.contract, ...limits } }, false)), seed.files);
    expect(sessionPhaseIdentity(phase({ maxModelCalls: 80, maxToolCalls: 120, maxElapsedMs: 5_400_000 }))).toBe(WRITER_1_PHASE_SHA256);
    expect(sessionPhaseIdentity(phase(LOCAL_SCREEN_WRITE_BOUNDS["twelve-call"]))).toBe(phase2);
    // The values item 1 and item 2 fix, and the profile and budgets they leave alone.
    expect(LOCAL_SCREEN_WRITE_BOUNDS).toEqual({ "twelve-call": { maxModelCalls: 12, maxToolCalls: 12, maxElapsedMs: 1_200_000 } });
    expect(Object.isFrozen(LOCAL_SCREEN_WRITE_BOUNDS) && Object.isFrozen(LOCAL_SCREEN_WRITE_BOUNDS["twelve-call"])).toBe(true);
    expect(COORDINATOR_PROFILES.heavy).toEqual({ thinking: "medium", maxOutputTokens: 16_384, requestTimeoutMs: 900_000, maxRequestBytes: 640 * 1024,
      sampling: { temperature: 1, top_p: 0.95, top_k: 20 } });
    expect(GENERAL_TASK_BUDGETS.heavy).toEqual({ modelCalls: 80, toolCalls: 120, elapsedMs: 5_400_000, sessionRequests: 200 });
    expect(endpoint.count()).toBe(0);
  });

  it("creates and sends nothing: no output directory, no changed file in the task, the seed or the working directory, and no request", async () => {
    const root = workspace(), { plain, seeded, cwd } = await seededTask(root), endpoint = await counter();
    const before = tree(root);
    await dryRun(seeded, endpoint.baseUrl, cwd);
    await dryRun({ ...seeded, writeBound: "twelve-call" }, endpoint.baseUrl, cwd);
    // A packet run's dry run too: its pipeline block and research input, and still nothing created.
    const packet = await dryRun({ ...plain, outputDirectory: join(root, "runs", "packet"), pipeline: "research" }, endpoint.baseUrl, cwd);
    expect(packet.pipeline).toEqual({ name: "research", version: expect.any(Number), protocolSha256: RESEARCH_PROTOCOL_SHA256, budget: expect.any(Object), planner: "local", writer: "local" });
    expect(packet).toHaveProperty("researchInput"); expect(packet).not.toHaveProperty("researchFrom");
    expect(tree(root)).toEqual(before);
    expect(existsSync(seeded.outputDirectory)).toBe(false);
    expect(endpoint.count()).toBe(0);
  });

  it("refuses a bound outside a seeded writer, an unknown bound, a dry run with a cloud arm or public retrieval, and an output path a run could not create", async () => {
    const root = workspace(), { plain, seeded, cwd } = await seededTask(root), endpoint = await counter();
    // Each input is a dry run, so a check that let one through would print rather than start a session.
    const run = (input: LocalScreenInput) => runLocalArtifactScreen({ ...input, dryRun: true }, { environment: environment(endpoint.baseUrl), cwd });
    for (const input of [{ ...plain, writeBound: "twelve-call" as const }, { ...seeded, researchFrom: "", writeBound: "twelve-call" as const },
      { ...seeded, writeBound: "eighty-call" as never }, { ...seeded, writeBound: "__proto__" as never },
      { ...seeded, writeBound: "twelve-call" as const, repairFrom: join(root, "critique") }, { ...plain, publicRetrieval: true },
      { ...plain, cloudArm: { model: "gpt-6-sol", endpoint: "https://api.openai.com/v1/chat/completions", prices: { inputUsdPerMillion: 2, outputUsdPerMillion: 8 }, maxFeeUsd: 8 } as never }])
      await expect(run(input)).rejects.toThrow("local_screen_arguments_invalid");
    // CI never runs the driver's session (it needs Docker), so its source text pins the wiring the dry run cannot show: the session keeps
    // the profile's pool and clock, and only the write phase's contract takes the bound.
    const source = readFileSync(join(ROOT, "scripts", "private-agent-local-screen.ts"), "utf8");
    expect(source.split("privatePhase, publicPhase, limits: { maxRequests: budget.maxRequests, maxElapsedMs: budget.maxElapsedMs },")).toHaveLength(2);
    expect(source.split("maxModelCalls: phaseLimits.maxModelCalls, maxToolCalls: phaseLimits.maxToolCalls, maxElapsedMs: phaseLimits.maxElapsedMs } };")).toHaveLength(2);
    expect(source.match(/phaseLimits\.\w+/gu)?.length).toBe(6);
    // A run's mkdir needs a new path under an existing directory: an existing directory, a dangling link and a missing parent are refused.
    mkdirSync(join(root, "runs", "existing")); symlinkSync(join(root, "nowhere"), join(root, "runs", "dangling"));
    for (const outputDirectory of [join(root, "runs", "existing"), join(root, "runs", "dangling"), join(root, "missing", "writer")])
      await expect(run({ ...seeded, outputDirectory, dryRun: true })).rejects.toThrow("local_screen_output_directory_invalid");
    expect(existsSync(join(root, "missing"))).toBe(false);
    expect(endpoint.count()).toBe(0);
    // The command line: the bound only beside --research-from and never with --repair-from, a name from the table, and --dry-run true on the local arm.
    const base = ["--execute-synthetic-local", "--task-directory", "t", "--job-sha256", h("1"), "--brief-sha256", h("2"), "--authority-sha256", h("3"),
      "--image-id", `sha256:${h("4")}`, "--output-directory", "o", "--runtime-sha256", h("5")];
    const seededArgs = [...base, "--profile", "heavy", "--claims-ledger", "true", "--research-from", "p"];
    const cloud = ["--arm", "cloud", "--cloud-model", "gpt-6-sol", "--cloud-endpoint", "https://api.openai.com/v1/chat/completions", "--cloud-prices", "2,8,0.5", "--max-fee-usd", "8",
      "--cloud-long-context", "272000,4,15,0.4"];
    expect(parseLocalArtifactScreenArguments([...seededArgs, "--write-bound", "twelve-call"])).toMatchObject({ researchFrom: "p", writeBound: "twelve-call" });
    expect(parseLocalArtifactScreenArguments([...seededArgs, "--write-bound", "twelve-call", "--dry-run", "true"])).toMatchObject({ writeBound: "twelve-call", dryRun: true });
    expect(parseLocalArtifactScreenArguments([...base, "--dry-run", "true"])).toMatchObject({ dryRun: true });
    expect(parseLocalArtifactScreenArguments([...base, ...cloud])).not.toHaveProperty("dryRun");
    const parsed = parseLocalArtifactScreenArguments(seededArgs);
    expect(parsed).not.toHaveProperty("writeBound"); expect(parsed).not.toHaveProperty("dryRun");
    for (const bad of [[...base, "--profile", "heavy", "--claims-ledger", "true", "--write-bound", "twelve-call"], [...seededArgs, "--write-bound", "eighty-call"],
      [...seededArgs, "--write-bound", "__proto__"], [...seededArgs, "--write-bound", "toString"], [...seededArgs, "--write-bound", ""],
      [...seededArgs, "--repair-from", "c", "--write-bound", "twelve-call"], [...seededArgs, "--dry-run", "false"], [...seededArgs, "--dry-run", "yes"],
      [...base, "--public-retrieval", "true", "--dry-run", "true"], [...base, ...cloud, "--dry-run", "true"]])
      expect(() => parseLocalArtifactScreenArguments(bad), bad.slice(15).join(" ")).toThrow("local_screen_cli_invalid");
    // The loop refuses both flags (tests/unit/phase4-loop.test.ts has the rest of its command line).
    const driver = [...base.slice(1).filter((_, i, all) => all[i] !== "--output-directory" && all[i - 1] !== "--output-directory"), "--profile", "heavy", "--claims-ledger", "true"];
    expect(parseLoopArguments(["--select-and-repair", "--loop-directory", "L", ...driver]).base).toMatchObject({ profile: "heavy", claimsLedger: true });
    for (const extra of [["--write-bound", "twelve-call"], ["--dry-run", "true"]])
      expect(() => parseLoopArguments(["--select-and-repair", "--loop-directory", "L", ...driver, ...extra])).toThrow("loop_cli_invalid");
    const loopBase = parseLoopArguments(["--select-and-repair", "--loop-directory", "L", ...driver]).base;
    for (const over of [{ writeBound: "twelve-call" as const }, { dryRun: true }, { dryRun: false }])
      await expect(runSelectionLoop({ base: { ...loopBase, ...over }, loopDirectory: join(root, "loop") }, {} as LoopDependencies)).rejects.toThrow("loop_cli_invalid");
    expect(existsSync(join(root, "loop"))).toBe(false);
    // The CLI exits 0 on a dry run as on a submitted run, and 2 on any other end; a refused dry run names its check, and a run's line keeps its bytes.
    expect(["submitted", "dry_run", "incomplete", "paused", "cancelled"].map(localScreenExitCode)).toEqual([0, 0, 2, 2, 2]);
    const refusal = new Error("local_screen_output_directory_invalid");
    expect(localScreenFailureLine(refusal, true)).toBe(`${canonical({ state: "incomplete", error: "local_screen_failed_no_replay", code: "local_screen_output_directory_invalid" })}\n`);
    expect(localScreenFailureLine(refusal)).toBe(`${canonical({ state: "incomplete", error: "local_screen_failed_no_replay" })}\n`);
    expect(localScreenFailureLine(new Error("ENOENT: no such file or directory, open '/Users/someone/x'"), true)).toBe(localScreenFailureLine(refusal));
  });

  it("rows a seeded single run offline through --run-dir, from a freeze built of the dry run's line, for both writer arms (E2's card, 'The bound in the registry row')", async () => {
    const root = workspace(), { seeded, cwd } = await seededTask(root), endpoint = await counter();
    const rowOf = async (name: string, input: LocalScreenInput, arm: string) => {
      const { state: _state, ...fields } = await dryRun(input, endpoint.baseUrl, cwd), directory = join(root, "runs", name), jobId = `${name}-job`;
      mkdirSync(directory, { mode: 0o700 });
      // The fields the run adds at its start: the job id, the frozen files' list, the start and the acceptance.
      writeFileSync(join(directory, "freeze.json"), `${canonical({ ...fields, jobId, sourceFreeze: localScreenSourceFreeze().files, startedAt: "2026-11-17T10:00:00.000Z",
        artifactAccepted: null })}\n`, { mode: 0o600 });
      // A submitted write phase within either bound: four model calls, three tool actions and the claims judge's pass, all local and zero-fee.
      const db = new Database(join(directory, "state.sqlite")), store = new PrivateAgentStore(db);
      store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["owned_local_model"], maxRequests: 200, maxFeeMicrousd: 0 });
      store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q" });
      for (let i = 0; i < 4; i++) store.append(jobId, { type: "model_finished", contextId: "p", operationId: `m${i}`, finishReason: "stop", usage: { inputTokens: 900, outputTokens: 300 } });
      for (let i = 0; i < 3; i++) {
        store.append(jobId, { type: "tool_started", operationId: `t${i}`, toolCallId: `t${i}`, name: "write_file", contextId: "p" });
        store.append(jobId, { type: "tool_finished", operationId: `t${i}`, toolCallId: `t${i}`, output: "x", contextId: "p" });
      }
      store.append(jobId, { type: "claims_entailment", contextId: "p", version: 1, counts: { supported: 5, partial: 0, unsupported: 0, contradicted: 0, not_judged: 0 }, entailmentCalls: 2, truncated: false });
      const dispatches = Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, jobId, status: "settled", destinationId: "owned_local_model", destinationKind: "local_model",
        purpose: i < 4 ? "agent reasoning and tool selection" : "claims entailment", reservedFeeMicrousd: 0, feeMicrousd: 0, committedAt: 1_000 + i }));
      for (const row of dispatches) db.prepare("INSERT INTO private_agent_dispatches VALUES (?, ?, ?)").run(row.id, jobId, canonical(row));
      db.close();
      writeFileSync(join(directory, "result.json"), `${canonical({ status: "submitted", reason: "independent_acceptance_pending", finishedAt: "2026-11-17T10:12:00.000Z",
        snapshotSha256: h("7"), candidateFiles: [], dispatches })}\n`, { mode: 0o600 });
      return JSON.parse(execFileSync("python3", ["-I", SCRIPT, "--run-dir", directory, "--id", `e2-2026-11-17-${name}`, "--batch", "e2-2026-11-17", "--task", "synthetic-1",
        "--family", "research", "--exposure", "fresh", "--arm", arm, "--outcome", "accepted", "--critical-checks", "5/5", "--verdict-by", "agent_diagnostic",
        "--lesson", "blind proxy, provisional"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as Record<string, any>;
    };
    const writer1 = await rowOf("writer-1-a", seeded, "local-heavy-seeded-writer-1");
    const writer2 = await rowOf("writer-2-a", { ...seeded, writeBound: "twelve-call" }, "local-heavy-seeded-writer-2");
    const common = { date: "2026-11-17", taskJobSha256: seeded.expectedJobSha256, profile: "heavy", thinking: "medium", maxOutputTokens: 16_384, pipeline: "research",
      pipelinePlanner: "local", researchProtocolSha256: RESEARCH_PROTOCOL_SHA256, servingCard: null, localStreams: 1, runStatus: "submitted", modelCalls: 4, toolCalls: 3,
      outcome: "accepted", verdictBy: "agent_diagnostic" };
    expect(writer1).toMatchObject({ ...common, arm: "local-heavy-seeded-writer-1", writeLimits: { bound: null, modelCalls: 80, toolCalls: 120, elapsedMs: 5_400_000 } });
    expect(writer2).toMatchObject({ ...common, arm: "local-heavy-seeded-writer-2", writeLimits: { bound: "twelve-call", modelCalls: 12, toolCalls: 12, elapsedMs: 1_200_000 } });
    expect(endpoint.count()).toBe(0);
  }, 60_000);
});
