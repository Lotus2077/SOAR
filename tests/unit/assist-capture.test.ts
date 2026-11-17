import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrokerError } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { SYNTHESIS_ASSIST_PURPOSE } from "../../src/main/private-agent/dispatch-purposes";
import { ASSIST_CACHE_MODE } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { createResearchAssists, researchAssistProtocolSha256 } from "../../src/main/private-agent/research-assist";
import type { ResearchAssistFiring } from "../../src/main/private-agent/research-assist-contract";
import { RESEARCH_PIPELINE_BUDGET, runResearchPipeline } from "../../src/main/private-agent/research-pipeline";
import { ASSIST_CAPTURE_DIRECTORY, captureAssistPackets, parseAssistCaptureArguments, type AssistCaptureInput, type AssistCaptureTrigger } from "../../scripts/assist-capture";
import { buildCloudArm, cloudArmModelConfig } from "../../scripts/private-agent-local-screen";
import { cachingAssistModel, type AssistShape } from "../helpers/research-assist-fixture";
import { researchSeedSourceModel, writeResearchSeedSource } from "../helpers/research-seed-source";
import { researchV4Reply } from "../helpers/research-v4-fixture";

/**
 * 10.c (BL-20261117-1130-lane-decisions-second-repair-before-reprobe, decision 5): the capture mode builds item 10's T1, T2 and T2-retry
 * request bodies from a finished zero-fee local run and writes them into the run's git-ignored directory, dispatching nothing.
 */
const ROOT = resolve(__dirname, "..", "..");
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const ANTHROPIC = { model: "claude-sonnet-5-5", endpoint: "https://api.anthropic.com/v1/messages", prices: { input: 2, output: 10, cached: 0.1, write: 2.5 } };
const RESPONSES = { model: "gpt-6-sol", endpoint: "https://api.example.invalid/v1/responses", prices: { input: 2, output: 10, cached: 0.2, write: 2.5 } };
const AUTHORED = "Describe the synthetic orchard surveys and their limits, citing the field notes where they apply.\n1. How many healthy trees did each site record?\n";
const SUFFIX = "\nClaims ledger requirement: write output/claims.json citing input/corpus/alpha-notes.md and input/corpus/beta-ledger.md.";
// Six sources, so that half the first T2 packet's evidence still holds a quote and the retry is built too.
const SOURCES = { "alpha-notes.md": "# Alpha notes\nThe orchard recorded twelve healthy trees during the autumn survey of the north slope.\n",
  "beta-ledger.md": "# Beta ledger\nThe meadow recorded seven healthy trees during the spring survey of the south slope.\n",
  "gamma-log.md": "# Gamma log\nThe hedgerow recorded four young trees after the late frost of the synthetic year.\n",
  "delta-sheet.md": "# Delta sheet\nThe riverbank recorded nine healthy willows during the summer count of the east bank.\n",
  "epsilon-memo.md": "# Epsilon memo\nThe ridge recorded three healthy pines after the storm season of the synthetic year.\n",
  "zeta-notes.md": "# Zeta notes\nThe valley recorded eleven healthy oaks during the winter survey of the west field.\n" } as const;
/** The stage's own answers, with every local plan and synthesis rejected: the host plan and the host skeleton follow. */
const rejectingPlansAndSyntheses = (system: string, user: string) => system.startsWith("You plan") || system.startsWith("You write") ? "{}" : researchV4Reply(system, user);

interface SetupOptions {
  /** Other bytes for some sources of the run, which then no longer match the task's. */
  sources?: Partial<Record<keyof typeof SOURCES, string>>;
  /** false: the run's repository does not ignore `runs/`. "nested": an outer repository ignores the inner one, which holds the run and does not. */
  ignored?: false | "nested";
  count?: number; authored?: string; reply?: (system: string, user: string) => string;
  /** null: a freeze with no arm block. */
  arm?: null;
}
/** A git repository that ignores `runs/`, a prepared task, and a local research run of it under `runs/` whose freeze names the local arm. */
async function setup(options: SetupOptions = {}) {
  // The real path, as the capture resolves the run directory before git matches its ignore rules against it.
  const outer = realpathSync(mkdtempSync(join(tmpdir(), "soar-assist-capture-"))); cleanups.push(() => rmSync(outer, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", outer]);
  const root = options.ignored === "nested" ? join(outer, "inner") : outer;
  if (options.ignored === "nested") { writeFileSync(join(outer, ".gitignore"), "inner/\n"); mkdirSync(root); execFileSync("git", ["init", "-q", root]); }
  writeFileSync(join(root, ".gitignore"), options.ignored === undefined ? "runs/\n" : "nothing/\n");
  const authored = options.authored ?? AUTHORED, task = join(root, "task"); mkdirSync(join(task, "input", "corpus"), { recursive: true });
  const inputs = Object.entries(SOURCES).slice(0, options.count ?? 6).map(([name, text]) => ({ path: `corpus/${name}`, bytes: Buffer.from(text) }));
  for (const input of inputs) writeFileSync(join(task, "input", input.path), input.bytes);
  const job = canonical({ schemaVersion: 1, jobId: "synthetic_capture_fixture", goalFile: "brief.md",
    inputs: inputs.map(input => ({ path: input.path, sha256: digest(input.bytes), bytes: input.bytes.length, confidentiality: "private" })),
    requiredArtifacts: ["output/report.md"], requiredCapabilities: ["local_calculation"],
    permissions: { externalModelDisclosure: "none", publicWeb: "none", publish: false, send: false, mutateInputs: false },
    verification: { deterministic: "fixture", humanCriteria: ["fixture"], runtimeAndPrivacyReceiptRequired: true }, labelIsMetadataOnly: true, synthetic: true });
  writeFileSync(join(task, "job.json"), job); writeFileSync(join(task, "brief.md"), authored);
  const binding = { jobSha256: digest(job), briefSha256: digest(authored) };
  // The run read the task's sources (or, for a mismatch case, others of the same names) for the composed goal: the brief and a host suffix.
  const runSources = inputs.map(input => ({ id: `input/${input.path}`, path: `input/${input.path}`,
    bytes: Buffer.from(options.sources?.[input.path.slice("corpus/".length) as keyof typeof SOURCES] ?? input.bytes.toString()) }));
  const run = join(root, "runs", "local-run"), brief = `${authored}${SUFFIX}`;
  await writeResearchSeedSource(run, { taskBinding: binding, brief, sources: runSources, jobId: "capture-source", ...(options.arm === null ? {} : { arm: "local" as const }),
    ...(options.reply ? { reply: options.reply } : {}) });
  const input: AssistCaptureInput = { runDirectory: run, taskDirectory: task, expectedJobSha256: binding.jobSha256, expectedBriefSha256: binding.briefSha256, firing: "forced_split", cloud: ANTHROPIC };
  return { root, run, task, binding, input, runSources, brief, authored };
}
const flags = (f: Awaited<ReturnType<typeof setup>>) => ["--run-directory", f.run, "--task-directory", f.task, "--job-sha256", f.binding.jobSha256, "--brief-sha256", f.binding.briefSha256,
  "--firing", "forced_split", "--cloud-model", ANTHROPIC.model, "--cloud-endpoint", ANTHROPIC.endpoint, "--cloud-prices", "2,10,0.1,2.5"];

describe("10.c: the assist capture (BL-20261117-1130-lane-decisions-second-repair-before-reprobe, decision 5)", () => {
  it("writes T1, T2 and T2's retry as request bodies, with each touchpoint's trigger and a counts-only manifest, and dispatches nothing", async () => {
    const f = await setup();
    const manifest = captureAssistPackets(f.input);
    const directory = join(f.run, ASSIST_CAPTURE_DIRECTORY);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(manifest).toMatchObject({ version: 1, firing: "forced_split", assistProtocolSha256: researchAssistProtocolSha256("forced_split"), api: "anthropic_messages", model: "claude-sonnet-5-5",
      sourceRun: { jobId: "capture-source", freezeSha256: digest(readFileSync(join(f.run, "freeze.json"))) }, authoredBriefSha256: digest(Buffer.from(AUTHORED)) });
    expect(manifest.touchpoints.map(t => [t.touchpoint, t.retryAfterTruncation, t.trigger, t.built, t.file])).toEqual([["T1", false, "forced_split", true, "T1.body.json"],
      ["T2", false, "forced_split", true, "T2.body.json"], ["T2", true, "forced_split", true, "T2-retry.body.json"]]);
    const bodies = manifest.touchpoints.map(t => readFileSync(join(directory, t.file!), "utf8"));
    for (const [i, t] of manifest.touchpoints.entries()) {
      expect(statSync(join(directory, t.file!)).mode & 0o777).toBe(0o600);
      expect(t.bodySha256).toBe(digest(Buffer.from(bodies[i]!))); expect(t.bodyBytes).toBe(Buffer.byteLength(bodies[i]!));
    }
    expect(JSON.parse(readFileSync(join(directory, "capture.json"), "utf8"))).toEqual(JSON.parse(canonical(manifest)));
    // The manifest holds counts and digests only; the bodies hold no source name, path or digest, and none of the host suffix.
    const manifestText = readFileSync(join(directory, "capture.json"), "utf8");
    for (const leak of ["alpha-notes", "beta-ledger", "input/corpus", "Claims ledger requirement", ...f.runSources.map(source => digest(source.bytes))]) {
      expect(manifestText).not.toContain(leak);
      for (const body of bodies) expect(body).not.toContain(leak);
    }
    // The retry carries at most half the first packet's evidence, as the wrapper's retry does.
    expect(manifest.touchpoints[2]!.packet!.evidenceBytes).toBeLessThanOrEqual(Math.floor(manifest.touchpoints[1]!.packet!.evidenceBytes! / 2));
  });

  it("refuses a second capture, a run its own repository does not ignore, a source that is not a local run, and other sources, endpoints and briefs", async () => {
    const f = await setup();
    captureAssistPackets(f.input);
    const first = readFileSync(join(f.run, ASSIST_CAPTURE_DIRECTORY, "capture.json"));
    expect(() => captureAssistPackets(f.input)).toThrow("assist_capture_exists");
    expect(readFileSync(join(f.run, ASSIST_CAPTURE_DIRECTORY, "capture.json"))).toEqual(first);
    // A dangling link at the capture's path is refused too: the check looks at the path itself.
    const linked = await setup(); symlinkSync(join(linked.root, "absent"), join(linked.run, ASSIST_CAPTURE_DIRECTORY));
    expect(() => captureAssistPackets(linked.input)).toThrow("assist_capture_exists");
    // The repository that holds the run decides: its own rules, or an inner repository's under an outer one that ignores it whole.
    const unignored = await setup({ ignored: false }), nested = await setup({ ignored: "nested" });
    for (const refused of [unignored, nested]) expect(() => captureAssistPackets(refused.input)).toThrow("local_screen_retain_directory_not_ignored");
    const cloudRun = await setup(), freeze = JSON.parse(readFileSync(join(cloudRun.run, "freeze.json"), "utf8"));
    writeFileSync(join(cloudRun.run, "freeze.json"), `${canonical({ ...freeze, arm: { arm: "cloud" } })}\n`);
    const armless = await setup({ arm: null });
    for (const refused of [cloudRun, armless]) expect(() => captureAssistPackets(refused.input)).toThrow("assist_capture_source_not_local");
    const other = await setup({ sources: { "beta-ledger.md": "# Beta ledger\nThe meadow recorded eight healthy trees during the spring survey of the south slope.\n" } });
    expect(() => captureAssistPackets(other.input)).toThrow("assist_capture_source_mismatch");
    // The assist arm's endpoints only: chat completions is the all-cloud arm's shape, never an assist's.
    const chat = await setup();
    expect(() => captureAssistPackets({ ...chat.input, cloud: { ...ANTHROPIC, endpoint: "https://api.example.invalid/v1/chat/completions" } })).toThrow("assist_capture_endpoint_invalid");
    // The wrapper's own configuration checks: an authored brief holding a host marker is refused, as the wrapper refuses it.
    const marked = await setup({ authored: `${AUTHORED}Claims ledger requirement: none.\n` });
    expect(() => captureAssistPackets(marked.input)).toThrow("research_assist_config_invalid");
    for (const refused of [unignored, nested, cloudRun, armless, other, chat, marked]) expect(existsSync(join(refused.run, ASSIST_CAPTURE_DIRECTORY))).toBe(false);
    expect(() => captureAssistPackets({ ...chat.input, firing: "always" as never })).toThrow("assist_capture_firing_invalid");
  });

  it("parses its command line, drops the one leading `--` pnpm passes on, and refuses a missing, repeated or unknown flag", () => {
    const args = ["--run-directory", "runs/r", "--task-directory", "task", "--job-sha256", "a".repeat(64), "--brief-sha256", "b".repeat(64), "--firing", "local_first",
      "--cloud-model", "claude-sonnet-5-5", "--cloud-endpoint", "https://api.anthropic.com/v1/messages", "--cloud-prices", "2,10,0.1,2.5"];
    const parsed = parseAssistCaptureArguments(args);
    expect(parsed).toMatchObject({ runDirectory: "runs/r", firing: "local_first", cloud: { model: "claude-sonnet-5-5", prices: { input: 2, output: 10, cached: 0.1, write: 2.5 } } });
    expect(parseAssistCaptureArguments(["--", ...args])).toEqual(parsed);
    for (const bad of [args.slice(2), [...args, "--firing", "forced_split"], [...args, "--max-fee-usd", "1"], args.map(a => a === "local_first" ? "always" : a), ["--", "--", ...args]])
      expect(() => parseAssistCaptureArguments(bad)).toThrow("assist_capture_cli_invalid");
  });

  it("runs from the command line as `pnpm assist:capture -- ...` invokes it, outside the run's repository, and refuses a second capture with its code", { timeout: 120_000 }, async () => {
    const f = await setup();
    const cli = () => spawnSync(process.execPath, ["--import", "tsx", "scripts/assist-capture.ts", "--", ...flags(f)], { cwd: ROOT, encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
    const ran = cli();
    expect(ran.status).toBe(0);
    const reported = JSON.parse(ran.stdout) as { state: string; touchpoints: { trigger: AssistCaptureTrigger; bodySha256?: string }[] };
    expect(reported.state).toBe("captured");
    const manifest = JSON.parse(readFileSync(join(f.run, ASSIST_CAPTURE_DIRECTORY, "capture.json"), "utf8")) as { touchpoints: { trigger: AssistCaptureTrigger; bodySha256?: string }[] };
    expect(reported.touchpoints.map(t => [t.trigger, t.bodySha256])).toEqual(manifest.touchpoints.map(t => [t.trigger, t.bodySha256]));
    const again = cli();
    expect([again.status, again.stdout, JSON.parse(again.stderr)]).toEqual([1, "", { state: "refused", error: "assist_capture_exists" }]);
  });
});

describe("10.c: the cloud arm's configuration, extracted for the capture", () => {
  it("keeps buildCloudArm's order of checks: the endpoint's parse, then the configuration and the fee under one code, then the key (10.c's review, nit 4)", () => {
    const heavy = COORDINATOR_PROFILES.heavy, arm = { ...ANTHROPIC, maxFeeUsd: 0.5 };
    expect(() => buildCloudArm({ ...arm, endpoint: "not a url", maxFeeUsd: 0 }, {}, heavy)).toThrow(TypeError);
    for (const refused of [{ ...arm, maxFeeUsd: 0 }, { ...arm, endpoint: "https://api.example.invalid/v1/messages" }])
      expect(() => buildCloudArm(refused, {}, heavy)).toThrow("local_screen_cloud_arm_invalid");
    expect(() => buildCloudArm(arm, {}, heavy)).toThrow("local_screen_cloud_key_missing");
  });
});

describe("10.c: a touchpoint the wrapper would refuse is recorded with its code, never written", () => {
  it("records a retry whose evidence bound holds no quote as refused, with no body", async () => {
    // Two sources only: half of T2's evidence cannot hold one quote line, so the wrapper would refuse the retry, and so does the capture.
    const f = await setup({ count: 2 });
    const manifest = captureAssistPackets(f.input);
    expect(manifest.touchpoints.map(t => [t.touchpoint, t.retryAfterTruncation, t.built, t.code])).toEqual([["T1", false, true, undefined], ["T2", false, true, undefined],
      ["T2", true, false, "assist_packet_size_exceeded"]]);
    expect(existsSync(join(f.run, ASSIST_CAPTURE_DIRECTORY, "T2-retry.body.json"))).toBe(false);
  });
});

describe("10.c: the capture equals what the pipeline and item 10's wrapper send for the same run (10.c's review, finding 3)", () => {
  const cases: { name: string; firing: ResearchAssistFiring; shape: AssistShape; cloud: typeof ANTHROPIC; reply?: (system: string, user: string) => string;
    triggers: [AssistCaptureTrigger, AssistCaptureTrigger]; sent: number; priorAttempts: number | undefined }[] = [
    { name: "forced_split on Anthropic's Messages shape: T1 and T2 come first, with no prior attempt", firing: "forced_split", shape: "anthropic_messages", cloud: ANTHROPIC,
      triggers: ["forced_split", "forced_split"], sent: 3, priorAttempts: undefined },
    { name: "local_first on the Responses shape: T1 after every local plan was rejected, with them as its prior attempts, and T2 after every synthesis",
      firing: "local_first", shape: "openai_responses", cloud: RESPONSES, reply: rejectingPlansAndSyntheses, triggers: ["local_plans_rejected", "local_syntheses_refused"], sent: 3,
      priorAttempts: RESEARCH_PIPELINE_BUDGET.plannerCalls },
    { name: "local_first where the local plan and synthesis were accepted: nothing is sent, and the capture's triggers are null", firing: "local_first",
      shape: "anthropic_messages", cloud: ANTHROPIC, triggers: [null, null], sent: 0, priorAttempts: 0 },
  ];
  it.each(cases)("$name", async c => {
    const f = await setup(c.reply ? { reply: c.reply } : {});
    const manifest = captureAssistPackets({ ...f.input, firing: c.firing, cloud: c.cloud });
    expect(manifest.touchpoints.map(t => [t.touchpoint, t.retryAfterTruncation, t.trigger, t.built])).toEqual([["T1", false, c.triggers[0], true], ["T2", false, c.triggers[1], true],
      ["T2", true, c.triggers[1], true]]);
    // T1's prior attempts: none sent under forced_split; under local_first the rejected local attempts only, so a T1 this run would not
    // fire (its plan was accepted at once) carries none, and one it fires carries every attempt the stage made.
    expect(manifest.touchpoints[0]!.packet!.priorAttempts).toBe(c.priorAttempts);
    const bodies = manifest.touchpoints.map(t => readFileSync(join(f.run, ASSIST_CAPTURE_DIRECTORY, t.file!), "utf8"));
    // The run's assisted twin: the same local answers, and item 10's wrapper on a broker that refuses T1 and T2's retry (budget_denied)
    // and truncates T2's first reply, so every touchpoint that fires is sent once and the stage goes on as the local run did.
    let syntheses = 0;
    const config = { ...cloudArmModelConfig(c.cloud, COORDINATOR_PROFILES.heavy).modelConfig, promptCaching: ASSIST_CACHE_MODE };
    const assist = cachingAssistModel(c.shape, (_body, purpose) => purpose === SYNTHESIS_ASSIST_PURPOSE && syntheses++ === 0 ? { content: "{", truncated: true } : new BrokerError("budget_denied"), config);
    const local = researchSeedSourceModel({ jobId: "assisted-twin", ...(c.reply ? { reply: c.reply } : {}) });
    const outcome = await runResearchPipeline({ brief: f.brief, sources: f.runSources, models: { reader: local, planner: local, synthesiser: local }, signal: new AbortController().signal,
      record() {}, deadlineMs: performance.now() + 3_600_000, assists: createResearchAssists({ firing: c.firing, model: assist.model, authoredBrief: f.authored, maxFeeMicrousd: 600_000 }) });
    expect(outcome).toMatchObject({ status: "completed", reason: "research_packet_ready" });
    expect(assist.requests.map(request => request.body)).toEqual(bodies.slice(0, c.sent));
    // The stage records name the triggers the capture recorded.
    expect(outcome.summary.stages.find(row => row.stage === "plan")!.assist).toMatchObject({ trigger: c.triggers[0], fired: c.triggers[0] !== null });
    expect(outcome.summary.stages.find(row => row.stage === "synthesise")!.assist).toMatchObject({ trigger: c.triggers[1], fired: c.triggers[1] !== null });
  });
});
