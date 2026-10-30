/**
 * Golden identities of every configuration that existed before the Anthropic adapter (BL-20261030-0620). The values in
 * private-agent-identity-golden.test.ts were computed by this module at commit 7fd67e1, before any adapter code; the test
 * recomputes them so an adapter change that touches an existing identity, fingerprint, packet or body fails.
 */
import Database from "better-sqlite3";
import { buildCloudArm } from "../../scripts/private-agent-local-screen";
import { PrivateAgentBroker, type BrokerDestination, type BrokerRequest } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, modelIdentity, type GeneralMessage, type GeneralToolDefinition, type PrivateModelConfig } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { promptProtocol, type GeneralJobContract } from "../../src/main/private-agent/runner";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

const heavy = COORDINATOR_PROFILES.heavy;
/** H5's pinned `gpt-6-sol` flags (BL-20261030-0445): Responses endpoint, prices, long-context tier and fake-IP opt-in. */
export const H5_GPT_ARM = { model: "gpt-6-sol", endpoint: "https://api.openai.com/v1/responses", prices: { input: 2, output: 10, cached: 0.2, write: 2.5 },
  maxFeeUsd: 2.5, longContext: { aboveTokens: 272000, input: 4, output: 15, cached: 0.4, write: 5 }, proxyFakeIp: true as const };
export const OPENAI_ENVIRONMENT = { SOAR_PHASE2_CLOUD_API_KEY: "sk-golden-key-0001" };
export const LOCAL_HEAVY: PrivateModelConfig = { destinationId: "owned_local_model", model: "synthetic-local-model", maxOutputTokens: heavy.maxOutputTokens,
  inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: heavy.thinking, maxRequestBytes: heavy.maxRequestBytes, promptCaching: "vllm_job_salt_v1",
  sampling: { ...heavy.sampling! }, streaming: true };
export const TOOL: GeneralToolDefinition = { type: "function", function: { name: "execute", description: "Run a command.",
  parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } };
/** A layout-2 runner request: static prompt, brief, one executed call and its result, then the trailing guidance and budget. */
export const LAYOUT2_REQUEST: GeneralMessage[] = [
  { role: "system", content: "You are a synthetic agent. Use one tool call per reply." },
  { role: "user", content: "Count the lines of input.txt and save the number." },
  { role: "assistant", content: "Counting.", tool_calls: [{ id: "call_1", type: "function", function: { name: "execute", arguments: "{\"command\":\"wc -l input.txt\"}" } }] },
  { role: "tool", tool_call_id: "call_1", content: "{\"exitCode\":0,\"stdout\":\"42 input.txt\"}" },
  { role: "user", content: "Progress: one command run.\nRemaining: 3 model calls, 4 tool calls." },
];
const ONE_SHOT: GeneralMessage[] = [{ role: "system", content: "Plan the research." }, { role: "user", content: "Brief: synthetic." }];

function captureBody(config: PrivateModelConfig, messages: GeneralMessage[], tools: GeneralToolDefinition[], overrides?: Parameters<PrivateAgentModel["complete"]>[3]): Promise<string> {
  let body = "";
  const broker = { request: async (input: BrokerRequest) => { body = input.body!; throw new Error("golden_capture_only"); } } as unknown as PrivateAgentBroker;
  return new PrivateAgentModel(broker, config, "00000000-0000-4000-8000-000000000001", "context").complete(messages, tools, new AbortController().signal, overrides)
    .then(() => body, () => body);
}

function previews(destinations: BrokerDestination[]) {
  const db = new Database(":memory:"), store = new PrivateAgentStore(db);
  store.createJob({ id: "job", version: 1, revision: 0, cancelled: false, mode: "cloud_help", destinations: destinations.map(item => item.id), maxRequests: 10, maxFeeMicrousd: 1000 });
  store.createContext({ id: "context", jobId: "job", sources: [{ id: "input", version: digest("synthetic input"), classification: "public", synthetic: true }] });
  const broker = new PrivateAgentBroker(store, destinations, { scan: async () => ({ complete: true, blocked: false, detector: "golden" }) });
  const result = Object.fromEntries(destinations.map(destination => {
    const preview = broker.preview({ jobId: "job", contextId: "context", destinationId: destination.id, purpose: "golden identity",
      method: destination.kind === "public_web" ? "GET" : "POST", ...(destination.kind === "public_web" ? {} : { body: "{\"golden\":true}" }), maxFeeMicrousd: 100 });
    return [destination.id, { destinationSha256: preview.destinationSha256, packetSha256: preview.packetSha256 }];
  }));
  db.close();
  return result;
}

export async function goldenValues() {
  const responsesArm = buildCloudArm(H5_GPT_ARM, OPENAI_ENVIRONMENT, heavy);
  const chatArm = buildCloudArm({ ...H5_GPT_ARM, endpoint: "https://api.openai.com/v1/chat/completions" }, OPENAI_ENVIRONMENT, heavy);
  const local = new PrivateAgentModel({} as PrivateAgentBroker, LOCAL_HEAVY, "job", "context").config;
  const contract: GeneralJobContract = { version: 1, goal: "Compute a synthetic result from the input and save it.",
    requiredArtifacts: [{ path: "output.txt", description: "Computed output" }], requiredChecks: ["fixture_check"], maxModelCalls: 4, maxToolCalls: 5, maxElapsedMs: 10000 };
  const protocol = promptProtocol({ contract, imageId: `sha256:${"a".repeat(64)}`, checks: [{ id: "fixture_check", python: "# fixed synthetic host check" }],
    model: { config: responsesArm.modelConfig as PrivateModelConfig } }, 2);
  return {
    modelIdentity: {
      localHeavy: digest(canonical(modelIdentity(local))),
      responses: digest(canonical(modelIdentity(responsesArm.modelConfig as PrivateModelConfig))),
      chat: digest(canonical(modelIdentity(chatArm.modelConfig as PrivateModelConfig))),
    },
    destinations: previews([
      { id: "owned_local_model", kind: "local_model", endpoint: "http://127.0.0.1:8000/v1/chat/completions", accountId: "operator_owned_local_server", credentialVersion: 1,
        apiKey: "synthetic-local-key", privateDataAdmitted: false, syntheticOnly: true, maxResponseBytes: 512 * 1024, timeoutMs: heavy.requestTimeoutMs, maxRequestBytes: heavy.maxRequestBytes },
      responsesArm.destination,
      { id: "approved_public_snapshots", kind: "public_web", endpoint: "http://127.0.0.1:9000/", accountId: "synthetic_snapshot_fixture", credentialVersion: 0,
        privateDataAdmitted: false, loopbackFixture: true, maxResponseBytes: 1024 * 1024, timeoutMs: 5000 },
    ]),
    bodies: {
      vllm: digest(await captureBody(LOCAL_HEAVY, LAYOUT2_REQUEST, [TOOL])),
      chat: digest(await captureBody(chatArm.modelConfig as PrivateModelConfig, LAYOUT2_REQUEST, [TOOL])),
      responses: digest(await captureBody(responsesArm.modelConfig as PrivateModelConfig, LAYOUT2_REQUEST, [TOOL])),
      responsesOneShot: digest(await captureBody(responsesArm.modelConfig as PrivateModelConfig, ONE_SHOT, [], { maxOutputTokens: 8192, purpose: "research plan" })),
    },
    freeze: { responses: digest(canonical(responsesArm.freeze)), chat: digest(canonical(chatArm.freeze)) },
    promptProtocol: { sha256: protocol.promptProtocolSha256, identity: protocol.identity },
  };
}

/** The layout-2 request as the runner now sends it, with `trailingTurnMessage`, on each shape that existed before the adapter. */
export async function layout2BodiesWithTrailingOption() {
  const responsesArm = buildCloudArm(H5_GPT_ARM, OPENAI_ENVIRONMENT, heavy);
  const chatArm = buildCloudArm({ ...H5_GPT_ARM, endpoint: "https://api.openai.com/v1/chat/completions" }, OPENAI_ENVIRONMENT, heavy);
  const option = { trailingTurnMessage: true };
  return {
    vllm: digest(await captureBody(LOCAL_HEAVY, LAYOUT2_REQUEST, [TOOL], option)),
    chat: digest(await captureBody(chatArm.modelConfig as PrivateModelConfig, LAYOUT2_REQUEST, [TOOL], option)),
    responses: digest(await captureBody(responsesArm.modelConfig as PrivateModelConfig, LAYOUT2_REQUEST, [TOOL], option)),
  };
}
