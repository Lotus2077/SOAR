import { describe, expect, it, vi } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, jsonSchemaResponseFormat, type GeneralToolDefinition, type ModelCallOverrides, type ModelResponseFormat, type PrivateModelConfig } from "../../src/main/private-agent/model";
import { RESEARCH_ROLE_SCHEMAS } from "../../src/main/private-agent/research-pipeline";
import { REVIEW_RESULT_V1_JSON_SCHEMA, REVIEW_RESULT_V1_JSON_SCHEMA_NAME, reviewResultV1ResponseFormat } from "../../src/shared/review-result-contract";

// Item 9 (BL-20261114-1650-research-structured-output-design): the model layer's reply-format override. It adds `response_format` to the
// owned vLLM body and nothing else, and every other shape, a call with tools and a malformed format are refused before any broker call.
const messages = [{ role: "system" as const, content: "You return one JSON object." }, { role: "user" as const, content: "{\"brief\":\"synthetic\"}" }];
const BASE: PrivateModelConfig = { destinationId: "owned", model: "Synthetic", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium" };
function model(change: Partial<PrivateModelConfig> = {}) {
  const request = vi.fn(async (_input: { body: string }, settle: (bytes: Buffer) => number) => {
    const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    return { bytes, receipt: { feeMicrousd: settle(bytes) } };
  });
  return { model: new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, { ...BASE, ...change }, "job", "reader"), request };
}
const STRICT: ModelResponseFormat = { ...RESEARCH_ROLE_SCHEMAS.extract, strict: true };
const LOOSE: ModelResponseFormat = { ...RESEARCH_ROLE_SCHEMAS.plan, strict: false };
const body = (m: PrivateAgentModel, overrides?: ModelCallOverrides, tools: GeneralToolDefinition[] = []) => JSON.parse(m.requestBody(messages, tools, overrides).body) as Record<string, unknown>;
const TOOL: GeneralToolDefinition = { type: "function", function: { name: "read_file", description: "Read a file.", parameters: { type: "object", properties: {} } } };

describe("item 9: the model layer's response_format override (BL-20261114-1650-research-structured-output-design)", () => {
  it("adds only response_format to the owned vLLM body, for both variants, both thinking modes and every setting that shapes the body", () => {
    const settings: Partial<PrivateModelConfig>[] = [{}, { api: "vllm" }, { streaming: true }, { promptCaching: "vllm_job_salt_v1" },
      { localReplyContract: "flash_next_v1", localContextTokens: 65_536 }, { sampling: { temperature: 0.6, top_p: 0.95, top_k: 20 } }, { thinking: "disabled" }];
    for (const change of settings) {
      const { model: m } = model(change);
      for (const overrides of [{ maxOutputTokens: 2048 }, { maxOutputTokens: 1024, thinking: "disabled" as const }]) {
        const plain = body(m, overrides);
        expect(plain).not.toHaveProperty("response_format");
        expect(body(m, { ...overrides, responseFormat: STRICT })).toEqual({ ...plain,
          response_format: { type: "json_schema", json_schema: { name: "research_extraction", schema: RESEARCH_ROLE_SCHEMAS.extract.schema, strict: true } } });
        // The non-strict variant omits the key, as probe P10's non-strict variant does; it never sends `strict: false`.
        const loose = body(m, { ...overrides, responseFormat: LOOSE });
        expect(loose).toEqual({ ...plain, response_format: { type: "json_schema", json_schema: { name: "research_plan", schema: RESEARCH_ROLE_SCHEMAS.plan.schema } } });
        expect(Object.keys((loose.response_format as { json_schema: object }).json_schema).sort()).toEqual(["name", "schema"]);
      }
    }
  });

  it("dispatches the format through complete(), and its refusals reach the broker never", async () => {
    const { model: m, request } = model();
    await m.complete(messages, [], new AbortController().signal, { maxOutputTokens: 2048, responseFormat: STRICT });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0]![0].body).response_format).toEqual(jsonSchemaResponseFormat(STRICT));
    const refused: [Partial<PrivateModelConfig>, ModelResponseFormat, GeneralToolDefinition[], string][] = [
      [{ api: "openai" }, STRICT, [], "private_model_response_format_unsupported"],
      [{ api: "openai_responses" }, STRICT, [], "private_model_response_format_unsupported"],
      [{ api: "anthropic_messages" }, STRICT, [], "private_model_response_format_unsupported"],
      [{}, STRICT, [TOOL], "private_model_response_format_unsupported"],
      [{}, { ...STRICT, name: "research extraction" }, [], "private_model_response_format_invalid"],
      [{}, { ...STRICT, name: "" }, [], "private_model_response_format_invalid"],
      [{}, { ...STRICT, name: "r".repeat(65) }, [], "private_model_response_format_invalid"],
      [{}, { ...STRICT, schema: [] as unknown as Record<string, unknown> }, [], "private_model_response_format_invalid"],
      [{}, { ...STRICT, schema: null as unknown as Record<string, unknown> }, [], "private_model_response_format_invalid"],
      [{}, { ...STRICT, strict: "yes" as unknown as boolean }, [], "private_model_response_format_invalid"],
    ];
    for (const [change, format, tools, code] of refused) {
      const { model: refusing, request: never } = model(change);
      expect(() => refusing.requestBody(messages, tools, { responseFormat: format })).toThrow(code);
      await expect(refusing.complete(messages, tools, new AbortController().signal, { responseFormat: format })).rejects.toThrow(code);
      expect(never).not.toHaveBeenCalled();
    }
    // The same shapes and the tool call without a format build their bodies as before.
    for (const change of [{ api: "openai" as const }, { api: "openai_responses" as const }, { api: "anthropic_messages" as const }]) expect(() => model(change).model.requestBody(messages, [], {})).not.toThrow();
    expect(body(model().model, {}, [TOOL])).toHaveProperty("tools");
  });

  it("builds the ReviewResultV1 shape: the review result's own format is jsonSchemaResponseFormat of its schema, strict", () => {
    const review = jsonSchemaResponseFormat({ name: REVIEW_RESULT_V1_JSON_SCHEMA_NAME, schema: REVIEW_RESULT_V1_JSON_SCHEMA as unknown as Record<string, unknown>, strict: true });
    expect(review).toEqual(reviewResultV1ResponseFormat());
    expect(canonical(review)).toBe(canonical(reviewResultV1ResponseFormat()));
  });
});
