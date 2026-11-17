import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET, RESEARCH_PIPELINE_VERSION, researchProtocolSha256, runResearchPipeline } from "../../src/main/private-agent/research-pipeline";
import { createResearchInput, createResearchProducer } from "../../src/main/private-agent/research-producer";
import { nonDefaultRoleParameters, type ResearchRolePolicy } from "../../src/main/private-agent/research-roles";
import { sessionFileManifest } from "../../src/main/private-agent/session";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { researchV4Reply } from "./research-v4-fixture";

/**
 * A finished research run directory the seed loader accepts (research-seed.ts, the session producer kind), for tests that seed a run
 * from it (the driver's --research-from): freeze.json, the ledger and the checkpoints of a stage that read `sources` for `brief` under
 * `roles` (absent: the default policy), with fixture receipts. The same shapes as the seed test's own source runs.
 */
export async function writeResearchSeedSource(directory: string, input: { taskBinding: { jobSha256: string; briefSha256: string }; brief: string;
  sources: { id: string; path: string; bytes: Buffer }[]; roles?: ResearchRolePolicy; jobId?: string }): Promise<void> {
  const jobId = input.jobId ?? "seed-source", contextId = "reader", h = (n: string) => n.repeat(64), receipts: Record<string, unknown>[] = [];
  const request = async (call: { body: string; purpose: string }, settle: (bytes: Buffer) => number) => {
    const body = JSON.parse(call.body) as { messages: { content: string }[] }, content = researchV4Reply(body.messages[0]!.content, body.messages[1]!.content);
    const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    receipts.push({ id: `receipt-${receipts.length}`, jobId, contextId, contextSha256: h("3"), packetSha256: digest(call.body), destinationId: "fixture", destinationSha256: h("4"),
      purpose: call.purpose, policyRevision: 0, committedAt: receipts.length + 1, reservedFeeMicrousd: 0, status: "settled", feeMicrousd: settle(bytes), responseSha256: digest(bytes),
      scan: { status: "not_required_for_synthetic_local_test" } });
    return { bytes, receipt: receipts.at(-1) };
  };
  const model = new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, { destinationId: "fixture", model: "cpu-fixture", maxOutputTokens: 16384, thinking: "medium",
    inputUsdPerMillion: 0, outputUsdPerMillion: 0 }, jobId, contextId);
  const outcome = await runResearchPipeline({ brief: input.brief, sources: input.sources, models: { reader: model, planner: model, synthesiser: model }, signal: new AbortController().signal,
    record() {}, ...(input.roles ? { roles: input.roles } : {}) });
  if (outcome.status !== "completed") throw new Error(`research_seed_source_${outcome.reason}`);
  const researchInput = createResearchInput(input.brief, input.sources), rolesSet = input.roles !== undefined && nonDefaultRoleParameters(input.roles).length > 0;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "freeze.json"), `${canonical({ version: 1, jobId, taskBinding: input.taskBinding, deployment: "synthetic_only_unverified_for_private_data",
    pipeline: { name: "research", version: RESEARCH_PIPELINE_VERSION, protocolSha256: researchProtocolSha256(RESEARCH_PIPELINE_BUDGET, input.roles), budget: { ...RESEARCH_PIPELINE_BUDGET },
      planner: "local", writer: "local", ...(rolesSet ? { roles: input.roles } : {}) },
    researchInput, researchProducerKind: "session", startedAt: new Date(1).toISOString() })}\n`);
  const producer = createResearchProducer({ kind: "session", jobId, contextId, brief: input.brief, sources: input.sources, files: outcome.files, receipts });
  const db = new Database(join(directory, "state.sqlite")), store = new PrivateAgentStore(db);
  try {
    store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["fixture"], maxRequests: 80, maxFeeMicrousd: 0 });
    for (const row of receipts) db.prepare("INSERT INTO private_agent_dispatches (id, job_id, value) VALUES (?, ?, ?)").run(row.id, jobId, canonical(row));
    const checkpoints = new PrivateCheckpointStore(join(directory, "checkpoints"), jobId), snapshot = checkpoints.save(outcome.files);
    const summary = JSON.parse(outcome.files.find(file => file.path === RESEARCH_FILES.summary)!.bytes.toString()) as { stages: Record<string, unknown>[] };
    store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q", readerContextId: contextId });
    store.append(jobId, { type: "research_input", contextId, recordedAt: 1, input: researchInput });
    for (const counts of summary.stages) store.append(jobId, { type: "research_stage", contextId, ...counts });
    store.append(jobId, { type: "research_transfer", contextId, binding: { snapshot, snapshotSha256: checkpoints.fingerprint(snapshot), files: sessionFileManifest(outcome.files), summary, producer } });
  } finally { db.close(); }
}
