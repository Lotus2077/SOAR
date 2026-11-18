import { type PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { runResearchPipeline } from "../../src/main/private-agent/research-pipeline";
import { researchV4Reply, researchV4Sources, RESEARCH_V4_TEST_BRIEF } from "./research-v4-fixture";

/** Actual pipeline and serializer with invented replies; no network, persisted receipt or live-quality claim. `reply` may vary the replies. */
export async function researchV4Packet(brief = RESEARCH_V4_TEST_BRIEF, sources = researchV4Sources(), reply = researchV4Reply) {
  const broker = { request: async (input: { body: string }, settle: (bytes: Buffer) => number) => {
    const body = JSON.parse(input.body) as { messages: { content: string }[] };
    const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: reply(body.messages[0]!.content, body.messages[1]!.content) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 30 } }));
    return { bytes, receipt: { feeMicrousd: settle(bytes) } };
  } } as unknown as PrivateAgentBroker;
  const model = new PrivateAgentModel(broker, { destinationId: "fixture", model: "fixture", maxOutputTokens: 16_384, maxRequestBytes: 640 * 1024, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium" }, "fixture", "reader");
  const outcome = await runResearchPipeline({ brief, sources, models: { reader: model, planner: model, synthesiser: model }, signal: new AbortController().signal, record() {} });
  if (outcome.status !== "completed") throw new Error(`mock_packet_incomplete:${outcome.reason}`);
  return { files: outcome.files, brief, sources };
}
