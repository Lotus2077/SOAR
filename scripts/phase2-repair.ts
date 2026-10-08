/**
 * Phase 2 repair pair, step 1 (design BL-20261007-1451): freeze a failed run's draft into one packet and get one critique
 * from the cloud critic (H) or the local critic (L′). Step 2 is the headless driver with --repair-from <this output>.
 *
 *   node --import tsx scripts/phase2-repair.ts --critique --run-directory RUN --task-directory TASK --job-sha256 H --brief-sha256 H \
 *     --image-id sha256:... --output-directory OUT --critic local|cloud [--cloud-model M --cloud-endpoint https://... --cloud-prices in,out,cached --max-fee-usd 1 [--proxy-fake-ip true]]
 *
 * The cloud key is read from the launching shell only (as for --arm cloud); nothing records it.
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "../src/main/config";
import { localStreamSettings } from "../src/main/liveness";
import { PrivateAgentBroker, type BrokerDestination } from "../src/main/private-agent/broker";
import { canonical, digest } from "../src/main/private-agent/contracts";
import { PrivateAgentModel, type PrivateModelConfig } from "../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../src/main/private-agent/profiles";
import { CRITIC_MAX_FEE_USD, CRITIC_MAX_OUTPUT_TOKENS, CRITIC_PROMPT_VERSION, CRITIC_PURPOSE, RENDERED_EXTENSIONS, RENDER_PY, RepairBindingSchema,
  buildRepairPacket, criticMessages, repairDraftPaths, selfCheckFromEvents, type RepairArtifactText, type RepairBinding } from "../src/main/private-agent/repair";
import { DockerSandbox } from "../src/main/private-agent/sandbox";
import { RulePacketScanner } from "../src/main/private-agent/scanner";
import { PrivateAgentStore } from "../src/main/private-agent/store";
import type { SessionFile } from "../src/main/private-agent/session";
import { buildCloudArm, parseCloudPrices, type CloudArmInput } from "./private-agent-local-screen";
import { loadPreparedOperatorTask } from "./private-agent-run";

const SAFE_DRAFT_PATH = /^(output|review)\/[A-Za-z0-9._\- /]{1,230}$/u;

export interface FailedRun {
  freeze: { taskBinding: { jobSha256: string; briefSha256: string }; deployment: string; profile?: string; claimsLedger?: boolean; documentReview?: boolean;
    arm?: { arm?: string }; repair?: unknown; publicPhaseSha256?: string | null };
  freezeSha256: string; resultSha256: string; events: Record<string, unknown>[]; draft: SessionFile[];
}

/** Reads a finished L-Heavy run of the same task (job and brief); refuses anything else: another task, a cloud or Standard run,
 * an earlier repair, a run with a public phase, or anything not synthetic-only. */
export function loadFailedRun(runDirectory: string, expected: { jobSha256: string; briefSha256: string }, requiredArtifacts: string[]): FailedRun {
  const freezeBytes = readFileSync(join(runDirectory, "freeze.json")), resultBytes = readFileSync(join(runDirectory, "result.json"));
  const freeze = JSON.parse(freezeBytes.toString("utf8")) as FailedRun["freeze"];
  if (freeze.taskBinding?.jobSha256 !== expected.jobSha256 || freeze.taskBinding?.briefSha256 !== expected.briefSha256) throw new Error("repair_source_task_mismatch");
  if (freeze.deployment !== "synthetic_only_unverified_for_private_data") throw new Error("repair_source_not_synthetic");
  if ((freeze.arm?.arm ?? "local") !== "local" || freeze.profile !== "heavy" || freeze.repair !== undefined) throw new Error("repair_source_not_l_heavy");
  if (freeze.publicPhaseSha256) throw new Error("repair_source_public_phase_unsupported");
  const database = new Database(join(runDirectory, "state.sqlite"), { readonly: true, fileMustExist: true });
  let events: Record<string, unknown>[];
  try { events = (database.prepare("SELECT value FROM private_agent_events ORDER BY job_id, sequence").all() as { value: string }[]).map(row => JSON.parse(row.value)); }
  finally { database.close(); }
  const paths = repairDraftPaths({ requiredArtifacts, claimsLedger: freeze.claimsLedger === true, documentReview: freeze.documentReview === true });
  const draft = paths.filter(path => SAFE_DRAFT_PATH.test(path) && existsSync(join(runDirectory, "candidate", path)))
    .map(path => ({ path, bytes: readFileSync(join(runDirectory, "candidate", path)) }));
  if (!draft.length) throw new Error("repair_source_has_no_draft");
  return { freeze, freezeSha256: digest(freezeBytes), resultSha256: digest(resultBytes), events, draft };
}

/** Text files as they are; office files and PDFs rendered to text by the host-owned renderer in the qualified image. */
export async function renderDraft(draft: SessionFile[], imageId: string): Promise<RepairArtifactText[]> {
  const rendered = draft.filter(file => RENDERED_EXTENSIONS.includes(extname(file.path).toLowerCase()));
  // NUL never reaches a request (exactText refuses it).
  const texts = new Map(draft.filter(file => !rendered.includes(file)).map(file => [file.path, file.bytes.toString("utf8").replaceAll("\u0000", "")]));
  if (rendered.length) {
    const sandbox = await DockerSandbox.create({ imageId, jobId: `repair-${randomUUID().slice(0, 8)}`, contextId: randomUUID(), files: rendered });
    try {
      const quoted = rendered.map(file => `'${file.path.replace(/'/gu, "'\\''")}'`).join(" ");
      const result = await sandbox.execute(`python3 -I -c '${RENDER_PY.replace(/'/gu, "'\\''")}' ${quoted}`, { timeoutMs: 120_000 });
      if (result.exitCode !== 0) throw new Error("repair_render_failed");
      for (const [path, text] of Object.entries(JSON.parse(result.stdout) as Record<string, string>)) texts.set(path, text.replaceAll("\u0000", ""));
    } finally { await sandbox.close(); }
  }
  return draft.map(file => ({ path: file.path, text: texts.get(file.path) ?? "" }));
}

/** One tool-less critic request through the broker; the job admits only this destination and the synthetic packet. */
export async function runCritique(input: { store: PrivateAgentStore; broker: PrivateAgentBroker; destination: BrokerDestination; modelConfig: PrivateModelConfig;
  packet: { text: string; sha256: string }; maxFeeMicrousd: number; signal: AbortSignal }) {
  const jobId = randomUUID(), contextId = randomUUID();
  input.store.createJob({ version: 1, id: jobId, mode: "cloud_help", revision: 0, cancelled: false, destinations: [input.destination.id], maxRequests: 3, maxFeeMicrousd: input.maxFeeMicrousd });
  input.store.createContext({ id: contextId, jobId, sources: [{ id: "repair_packet", version: input.packet.sha256, classification: "private", synthetic: true }] });
  const model = new PrivateAgentModel(input.broker, input.modelConfig, jobId, contextId);
  const reply = await model.complete(criticMessages(input.packet.text), [], input.signal, { maxOutputTokens: CRITIC_MAX_OUTPUT_TOKENS, purpose: CRITIC_PURPOSE });
  const feeMicrousd = input.store.dispatches(jobId).reduce((sum, row) => sum + (row.feeMicrousd ?? 0), 0);
  if (!reply.content.trim()) throw Object.assign(new Error("repair_critique_empty"), { finishReason: reply.finishReason, usage: reply.usage ?? null, feeMicrousd });
  return { jobId, text: reply.content.trim() + "\n", finishReason: reply.finishReason, usage: reply.usage ?? null, servedModel: reply.servedModel ?? null, feeMicrousd };
}

export interface CritiqueArguments {
  runDirectory: string; taskDirectory: string; expectedJobSha256: string; expectedBriefSha256: string; imageId: string; outputDirectory: string;
  critic: "local" | "cloud"; cloudArm?: CloudArmInput;
}

export async function critique(input: CritiqueArguments) {
  const task = loadPreparedOperatorTask(input.taskDirectory, { jobSha256: input.expectedJobSha256, briefSha256: input.expectedBriefSha256 });
  const run = loadFailedRun(resolve(input.runDirectory), task.binding, task.phase.contract.requiredArtifacts.map(artifact => artifact.path));
  const brief = task.phase.files.find(file => file.path === "brief.md")!.bytes.toString("utf8");
  const packet = buildRepairPacket({ brief, artifacts: await renderDraft(run.draft, input.imageId), selfCheck: selfCheckFromEvents(run.events) });
  const config = loadConfig();
  if (config.providerMode !== "local" || config.vllm.costPolicy !== "local_zero_cost") throw new Error("repair_provider_not_admitted");
  const heavy = COORDINATOR_PROFILES.heavy, maxResponseBytes = 512 * 1024;
  const local: BrokerDestination = { id: "owned_local_model", kind: "local_model", endpoint: `${config.vllm.baseUrl}/chat/completions`,
    accountId: "operator_owned_local_server", credentialVersion: 1, apiKey: config.vllm.apiKey, privateDataAdmitted: false, syntheticOnly: true,
    maxResponseBytes, timeoutMs: heavy.requestTimeoutMs, maxRequestBytes: heavy.maxRequestBytes,
    ...(config.streamingEnabled ? { stream: localStreamSettings(heavy.requestTimeoutMs, maxResponseBytes, heavy.maxOutputTokens) } : {}) };
  const localConfig: PrivateModelConfig = { destinationId: local.id, model: config.vllm.model, maxOutputTokens: heavy.maxOutputTokens, inputUsdPerMillion: 0,
    outputUsdPerMillion: 0, thinking: heavy.thinking, maxRequestBytes: heavy.maxRequestBytes, ...(heavy.sampling ? { sampling: { ...heavy.sampling } } : {}),
    ...(config.streamingEnabled ? { streaming: true } : {}) };
  if (input.critic === "cloud" && (!input.cloudArm || !(input.cloudArm.maxFeeUsd > 0 && input.cloudArm.maxFeeUsd <= CRITIC_MAX_FEE_USD))) throw new Error("repair_cloud_critic_invalid");
  const cloud = input.critic === "cloud" ? buildCloudArm(input.cloudArm!, process.env, heavy) : undefined;
  const destination = cloud ? cloud.destination : local, modelConfig = cloud ? cloud.modelConfig : localConfig;
  // The network posture is recorded beside the binding, never in it, so the binding identity is unchanged.
  const proxyRecord = cloud?.destination.proxyFakeIp ? { proxyFakeIp: true as const } : {};
  const directory = resolve(input.outputDirectory);
  mkdirSync(directory, { mode: 0o700 });
  const database = new Database(join(directory, "state.sqlite"));
  try {
    const store = new PrivateAgentStore(database);
    const broker = new PrivateAgentBroker(store, [destination], new RulePacketScanner());
    const write = (name: string, bytes: string | Buffer) => { mkdirSync(dirname(join(directory, name)), { recursive: true, mode: 0o700 }); writeFileSync(join(directory, name), bytes, { flag: "wx", mode: 0o600 }); };
    write("packet.txt", packet.text);
    let answer: Awaited<ReturnType<typeof runCritique>>;
    try {
      answer = await runCritique({ store, broker, destination, modelConfig, packet, maxFeeMicrousd: cloud?.maxFeeMicrousd ?? 0, signal: AbortSignal.timeout(heavy.requestTimeoutMs + 60_000) });
    } catch (error) {
      // A refused critique is a recorded outcome too: what stopped it, and what it cost.
      const detail = error as { message?: string; finishReason?: unknown; usage?: unknown; feeMicrousd?: unknown };
      write("critique-failure.json", `${canonical({ critic: input.critic, packetSha256: packet.sha256, code: detail.message ?? "repair_critique_failed",
        finishReason: detail.finishReason ?? null, usage: detail.usage ?? null, feeMicrousd: detail.feeMicrousd ?? null, ...proxyRecord })}\n`);
      throw error;
    }
    const binding: RepairBinding = RepairBindingSchema.parse({ version: 1, critic: input.critic, criticModel: modelConfig.model, promptVersion: CRITIC_PROMPT_VERSION,
      criticMaxOutputTokens: CRITIC_MAX_OUTPUT_TOKENS, packetSha256: packet.sha256, critiqueSha256: digest(answer.text),
      source: { taskJobSha256: task.binding.jobSha256, taskBriefSha256: task.binding.briefSha256, resultSha256: run.resultSha256, freezeSha256: run.freezeSha256,
        profile: "heavy", claimsLedger: run.freeze.claimsLedger === true, documentReview: run.freeze.documentReview === true },
      draft: run.draft.map(file => ({ path: file.path, sha256: digest(file.bytes) })) });
    write("critique.md", answer.text);
    for (const file of run.draft) write(join("draft", file.path), file.bytes);
    write("critique.json", `${canonical({ ...binding, finishReason: answer.finishReason, usage: answer.usage, servedModel: answer.servedModel, feeMicrousd: answer.feeMicrousd, ...proxyRecord })}\n`);
    return { binding, feeMicrousd: answer.feeMicrousd, finishReason: answer.finishReason };
  } finally { database.close(); }
}

export function parseCritiqueArguments(args: string[]): CritiqueArguments {
  const required = ["--run-directory", "--task-directory", "--job-sha256", "--brief-sha256", "--image-id", "--output-directory", "--critic"];
  const cloudNames = ["--cloud-model", "--cloud-endpoint", "--cloud-prices", "--max-fee-usd"];
  if (args[0] !== "--critique" || args.length % 2 !== 1) throw new Error("repair_cli_invalid");
  const values = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    if (![...required, ...cloudNames, "--proxy-fake-ip"].includes(args[i]!) || values.has(args[i]!)) throw new Error("repair_cli_invalid");
    values.set(args[i]!, args[i + 1]!);
  }
  const critic = values.get("--critic");
  const cloudCount = cloudNames.filter(name => values.has(name)).length;
  if (required.some(name => !values.has(name)) || (critic !== "local" && critic !== "cloud") || ![values.get("--job-sha256"), values.get("--brief-sha256")].every(h => /^[a-f0-9]{64}$/u.test(h!)) ||
      !/^sha256:[a-f0-9]{64}$/u.test(values.get("--image-id")!) || (critic === "cloud" ? cloudCount !== cloudNames.length : cloudCount !== 0) ||
      (values.has("--proxy-fake-ip") && (critic !== "cloud" || values.get("--proxy-fake-ip") !== "true"))) throw new Error("repair_cli_invalid");
  return { runDirectory: values.get("--run-directory")!, taskDirectory: values.get("--task-directory")!, expectedJobSha256: values.get("--job-sha256")!,
    expectedBriefSha256: values.get("--brief-sha256")!, imageId: values.get("--image-id")!, outputDirectory: values.get("--output-directory")!, critic,
    ...(critic === "cloud" ? { cloudArm: { model: values.get("--cloud-model")!, endpoint: values.get("--cloud-endpoint")!, prices: parseCloudPrices(values.get("--cloud-prices")!),
      maxFeeUsd: Number(values.get("--max-fee-usd")), ...(values.get("--proxy-fake-ip") === "true" ? { proxyFakeIp: true as const } : {}) } } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await critique(parseCritiqueArguments(process.argv.slice(2)));
    console.log(JSON.stringify({ critic: result.binding.critic, packetSha256: result.binding.packetSha256, critiqueSha256: result.binding.critiqueSha256,
      draftFiles: result.binding.draft.length, feeMicrousd: result.feeMicrousd, finishReason: result.finishReason }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "repair_failed");
    process.exitCode = 1;
  }
}
