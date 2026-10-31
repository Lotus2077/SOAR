import { describe, expect, it } from "vitest";
import { PROBE_MODEL, probeMain, runProbe, summarizeProbe } from "../../scripts/anthropic-probe";
import type { BrokerRequest, PrivateAgentBroker } from "../../src/main/private-agent/broker";
import type { PrivateModelConfig } from "../../src/main/private-agent/model";

const config: PrivateModelConfig = { destinationId: "cloud_coordinator", model: PROBE_MODEL, api: "anthropic_messages", maxOutputTokens: 16_384, inputUsdPerMillion: 2,
  outputUsdPerMillion: 10, cachedInputUsdPerMillion: 0.1, cacheWriteUsdPerMillion: 2.5, thinking: "medium", promptCaching: "anthropic_explicit_5m_v1" };
const usage = (extra: Record<string, unknown>) => ({ input_tokens: 40, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, service_tier: "standard",
  inference_geo: "global", output_tokens_details: { thinking_tokens: 12 }, ...extra });
const message = (content: unknown[], stop: string, extra: Record<string, unknown>) => ({ type: "message", role: "assistant", model: PROBE_MODEL, content, stop_reason: stop, usage: usage(extra) });
function broker(thinking = true, mutate?: (reply: ReturnType<typeof message>, index: number) => ReturnType<typeof message>) {
  const bodies: Record<string, unknown>[] = [];
  const request = async (input: BrokerRequest, settle: (bytes: Buffer) => number) => {
    const body = JSON.parse(input.body!) as Record<string, unknown>; bodies.push(body);
    const index = bodies.length - 1, think = thinking ? [{ type: "thinking", thinking: "", signature: "c2ln" }] : [];
    let reply = index === 0 ? message([{ type: "text", text: "ready" }], "end_turn", {})
      : index < 3 ? message([...think, { type: "tool_use", id: `toolu_${index}`, name: "calculate", input: { op: "multiply", a: 34, b: index === 1 ? 37 : 1 } }], "tool_use",
        index === 1 ? { cache_creation_input_tokens: 900 } : { cache_read_input_tokens: 900, cache_creation_input_tokens: 60 })
      : message([...think, { type: "text", text: "13716" }], "end_turn", { cache_read_input_tokens: 950, ...(thinking ? {} : { output_tokens_details: { thinking_tokens: 0 } }) });
    if (mutate) reply = mutate(reply, index);
    const bytes = Buffer.from(JSON.stringify(reply));
    return { bytes, receipt: { feeMicrousd: settle(bytes) } };
  };
  return { broker: { request } as unknown as Pick<PrivateAgentBroker, "request">, bodies };
}

describe("Anthropic shape probe (calibration step 0)", () => {
  it("sends a tool-less call then three loop turns with the guidance as the final system message, edits the first result before turn three, and passes", async () => {
    const f = broker();
    const result = await runProbe(f.broker, config, "job", "context");
    expect(f.bodies).toHaveLength(4);
    expect(f.bodies[0]).toMatchObject({ max_tokens: 1024 }); expect(f.bodies[0]).not.toHaveProperty("tools");
    for (const body of f.bodies.slice(1)) {
      expect(body).toMatchObject({ max_tokens: 16_384, tool_choice: { type: "auto", disable_parallel_tool_use: true } });
      expect((body.messages as unknown[]).at(-1)).toMatchObject({ role: "system" });
      expect(JSON.stringify(body)).not.toContain("\"thinking\":\"\"");
    }
    const results = (body: Record<string, unknown>) => (body.messages as { content: unknown }[]).flatMap(item => Array.isArray(item.content) ? item.content : [])
      .filter((block: { type?: string }) => block.type === "tool_result") as { content?: string }[];
    expect(results(f.bodies[2]!)[0]!.content).toBe("{\"result\":1258}");
    expect(results(f.bodies[3]!)[0]!.content).toBe("[observation demoted: see the workspace]");
    expect(result.checks).toEqual({ allAnswered: true, servedModelAndTier: true, geography: true, cacheWriteThenReads: true, toolLoopHistory: true });
    expect(result.thinking).toEqual({ droppedTurnsHadThinking: true, laterTurnsThought: true });
    expect(result).toMatchObject({ pass: true, rerunAdvised: false });
    expect(JSON.stringify(result.calls)).not.toContain("13716");
  });

  it("advises a rerun rather than failing the adapter when the model did not think", async () => {
    const result = await runProbe(broker(false).broker, config, "job", "context");
    expect(result.thinking).toMatchObject({ droppedTurnsHadThinking: false });
    expect(result).toMatchObject({ pass: true, rerunAdvised: true });
  });

  it("fails when thinking and cache evidence arrive without any actual tool loop", async () => {
    const f = broker(true, (reply, index) => index === 0 ? reply : { ...reply, stop_reason: "end_turn", content: [
      { type: "thinking", signature: "c2ln" }, { type: "text", text: "Use the calculate tool next." }] });
    const result = await runProbe(f.broker, config, "job", "context");
    expect(result.checks).toMatchObject({ allAnswered: true, servedModelAndTier: true, geography: true, cacheWriteThenReads: true, toolLoopHistory: false });
    expect(result.thinking).toEqual({ droppedTurnsHadThinking: true, laterTurnsThought: true });
    expect(JSON.stringify(f.bodies)).not.toContain("tool_result");
    const summary = summarizeProbe(result, Array.from({ length: 4 }, () => ({ status: "settled", feeMicrousd: 0 })));
    expect(summary).toMatchObject({ pass: false, rerunAdvised: false, exitCode: 2 });
  });

  it.each([
    { name: "wrong tool", tool: { name: "other", input: { op: "multiply", a: 34, b: 37 } } },
    { name: "wrong operation", tool: { name: "calculate", input: { op: "divide", a: 34, b: 37 } } },
    { name: "noninteger input", tool: { name: "calculate", input: { op: "multiply", a: 34.5, b: 37 } } },
    { name: "extra input field", tool: { name: "calculate", input: { op: "multiply", a: 34, b: 37, extra: true } } },
  ])("fails the tool-history gate for $name", async ({ tool }) => {
    const f = broker(true, (reply, index) => index !== 1 ? reply : { ...reply, content: [
      { type: "thinking", signature: "c2ln" }, { type: "tool_use", id: "toolu_1", ...tool }] });
    const result = await runProbe(f.broker, config, "job", "context");
    expect(result.checks.toolLoopHistory).toBe(false); expect(result).toMatchObject({ pass: false, rerunAdvised: false });
  });

  it("fails the tool-history gate for multiple calls or reused tool ids", async () => {
    for (const multiple of [false, true]) {
      const f = broker(true, (reply, index) => index !== 2 ? reply : { ...reply, content: [
        { type: "thinking", signature: "c2ln" },
        { type: "tool_use", id: "toolu_1", name: "calculate", input: { op: "multiply", a: 34, b: 37 } },
        ...(multiple ? [{ type: "tool_use", id: "toolu_extra", name: "calculate", input: { op: "add", a: 1, b: 2 } }] : []),
      ] });
      const result = await runProbe(f.broker, config, "job", "context");
      expect(result.checks.toolLoopHistory).toBe(false); expect(result).toMatchObject({ pass: false, rerunAdvised: false });
    }
  });

  it("refuses to run without the explicit flag, and without the Claude key never reaches the network", async () => {
    await expect(probeMain([])).rejects.toThrow("probe_cli_invalid");
    await expect(probeMain(["--execute-live-probe", "--proxy-fake-ip", "false"])).rejects.toThrow("probe_cli_invalid");
    const saved = process.env.SOAR_CLAUDE_CLOUD_API_KEY; delete process.env.SOAR_CLAUDE_CLOUD_API_KEY;
    try { await expect(probeMain(["--execute-live-probe"])).rejects.toThrow("local_screen_cloud_key_missing"); }
    finally { if (saved !== undefined) process.env.SOAR_CLAUDE_CLOUD_API_KEY = saved; }
  });
});
