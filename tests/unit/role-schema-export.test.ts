import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, vllmCacheSalt } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { researchSynthesisLengthCap } from "../../src/main/private-agent/research-admission";
import { ResearchSynthesisSchema, deriveBriefUnits } from "../../src/main/private-agent/research-coverage";
import { RESEARCH_PLAN_JSON_SCHEMA } from "../../src/main/private-agent/research-plan";
import { EXTRACT_SYSTEM, ExtractReplySchema, OUTPUT_TOKENS, PLAN_SYSTEM, RESEARCH_EXTRACT_JSON_SCHEMA, SYNTHESIS_SYSTEM, THINKING, researchExtractionUserContent, researchProtocolSha256, runResearchPipeline, synthesisLengthCap } from "../../src/main/private-agent/research-pipeline";
import { P10_JOB_ID, P10_ROLES, P10_THINKING_MODES, buildRoleSchemaExport, syntheticRoleCorpus, type RequestSettings } from "../../scripts/export-role-schemas";
import { buildLocalScreenModelConfig } from "../../scripts/private-agent-local-screen";
import { RESEARCH_PROTOCOL_SHA256 } from "../helpers/research-protocol-pin";
import { parseResearchUserContent, researchV4Reply } from "../helpers/research-v4-fixture";

const ROOT = resolve(__dirname, "..", "..");
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });

describe("role schema export for probe P10", () => {
  it("exports exactly the plan, extract and synthesis schemas equal to the TypeScript values, with their prompts and caps", () => {
    const data = buildRoleSchemaExport("2026-11-08T00:00:00.000Z");
    expect([...P10_ROLES]).toEqual(["plan", "extract", "synthesis"]);
    expect(Object.keys(data.schemas)).toEqual(["plan", "extract", "synthesis"]);
    expect(data.schemas.plan).toEqual(RESEARCH_PLAN_JSON_SCHEMA);
    expect(data.schemas.extract).toEqual(RESEARCH_EXTRACT_JSON_SCHEMA); expect(data.schemas.extract).toEqual(z.toJSONSchema(ExtractReplySchema));
    expect(data.schemas.synthesis).toEqual(z.toJSONSchema(ResearchSynthesisSchema));
    expect(data.systems).toEqual({ plan: PLAN_SYSTEM, extract: EXTRACT_SYSTEM, synthesis: SYNTHESIS_SYSTEM });
    expect(data.outputTokens).toEqual({ index: 1536, plan: 8192, extract: 2048, synthesis: 8192 }); expect(data.outputTokens).toBe(OUTPUT_TOKENS);
    expect(data.thinking).toEqual({ index: "disabled", plan: "model", extract: "disabled", synthesis: "model" }); expect(data.thinking).toBe(THINKING);
    expect(data).toMatchObject({ version: 2, generatedUtc: "2026-11-08T00:00:00.000Z", protocolSha256: researchProtocolSha256() });
  });

  it("builds the planner payload the pipeline sends, bound to synthetic units and source ids, and valid extract and synthesis payloads", () => {
    const data = buildRoleSchemaExport(), { brief, sources } = syntheticRoleCorpus();
    const plan = JSON.parse(data.payloads.plan.userContent);
    expect(Object.keys(plan).sort()).toEqual(["authoritativeSchema", "brief", "extractionCallBudget", "mandatorySourceChunks", "repair", "sourceIndex", "units"]);
    expect(plan.authoritativeSchema).toEqual(RESEARCH_PLAN_JSON_SCHEMA); expect(plan.repair).toBeNull(); expect(plan.brief).toBe(brief);
    expect(plan.units).toEqual(deriveBriefUnits(brief)); expect(data.payloads.plan.units).toEqual(["U1", "U2", "U3"]);
    expect(data.payloads.plan.sourceIds).toEqual(sources.map(s => s.id)); expect(plan.sourceIndex.sources.map((s: { sourceId: string }) => s.sourceId)).toEqual(sources.map(s => s.id));
    expect(plan.mandatorySourceChunks).toBe(2); expect(plan.extractionCallBudget).toBe(40);
    expect(data.payloads.plan.userContent).toBe(canonical(plan));
    // 7b.1: the extract payload is the pipeline's two-line message, the stable packet line, a newline, then the chunk line.
    const lines = data.payloads.extract.userContent.split("\n"); expect(lines).toHaveLength(2);
    const stable = JSON.parse(lines[0]!), perChunk = JSON.parse(lines[1]!);
    expect(Object.keys(stable)).toEqual(["brief", "plan", "units"]); expect(Object.keys(perChunk)).toEqual(["chunk", "repairReason", "source"]);
    expect(perChunk.chunk.text).toContain("orchard"); expect(perChunk.repairReason).toBeNull(); expect(stable.brief).toBe(brief);
    expect(data.payloads.extract.userContent).toBe(researchExtractionUserContent({ ...stable, ...perChunk }));
    const synthesis = JSON.parse(data.payloads.synthesis.userContent);
    expect(Object.keys(synthesis).sort()).toEqual(["brief", "coverage", "evidence", "lengthCap", "plan", "repairReason", "units"]); expect(synthesis.coverage.chunks).toHaveLength(2);
    expect(synthesis.lengthCap).toEqual({ words: synthesisLengthCap(brief).words }); expect(synthesis.lengthCap).toEqual({ words: 1200 });
    // Invented text only: no owner data, no address; the only URL is the JSON-schema dialect zod names in `$schema`.
    const serialized = JSON.stringify(data);
    expect(new Set(serialized.match(/https?:\/\/[^"\\\s]+/gu))).toEqual(new Set(["https://json-schema.org/draft/2020-12/schema"]));
    expect(serialized).not.toMatch(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/u);
  });

  it("exports the request the pipeline sends: its first extraction message and its synthesis length cap, byte for byte", async () => {
    const data = buildRoleSchemaExport(), { brief, sources } = syntheticRoleCorpus(), exportedPlan = JSON.parse(data.payloads.extract.userContent.split("\n")[0]!).plan;
    const sent: { system: string; user: string }[] = [];
    // A fixture planner that returns the export's own plan, so the real pipeline's first extraction call carries the same packet and chunk.
    const request = vi.fn(async (input: { body: string }, settle: (bytes: Buffer) => number) => {
      const body = JSON.parse(input.body), system = body.messages[0].content as string, user = body.messages[1].content as string; sent.push({ system, user });
      const content = system.startsWith("You plan") ? JSON.stringify(exportedPlan) : researchV4Reply(system, user);
      const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
      return { bytes, receipt: { feeMicrousd: settle(bytes) } };
    });
    const config = { destinationId: "owned", model: "Synthetic", maxOutputTokens: 16384, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium" as const };
    const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, "job", "reader");
    const outcome = await runResearchPipeline({ brief, sources, models: { reader: make(), planner: make(), synthesiser: make() }, signal: new AbortController().signal, record: () => {} });
    expect(outcome.status).toBe("completed");
    const extract = sent.find(call => call.system === EXTRACT_SYSTEM)!, synthesis = sent.find(call => call.system === SYNTHESIS_SYSTEM)!;
    expect(extract.user).toBe(data.payloads.extract.userContent);
    expect(parseResearchUserContent(synthesis.user).lengthCap).toEqual(JSON.parse(data.payloads.synthesis.userContent).lengthCap);
  });

  it("builds each P10 body with the model layer's requestBody under the headless driver's local configuration, and the synthesis off cell with the thinking-off cap (P10-align)", () => {
    const { brief } = syntheticRoleCorpus();
    const variants: RequestSettings[] = [{ vllm: { model: "Synthetic" }, streamingEnabled: true }, { vllm: { model: "Synthetic" }, streamingEnabled: false },
      { vllm: { model: "Flash", localReplyContract: "flash_next_v1", localContextTokens: 262144 }, streamingEnabled: true }];
    for (const settings of variants) {
      const data = buildRoleSchemaExport("2026-11-13T00:00:00.000Z", settings);
      // The driver's configuration for every local research role, with the heavy profile (thinking on) and the cache salt, its default.
      const model = new PrivateAgentModel({} as PrivateAgentBroker, buildLocalScreenModelConfig(settings as never, COORDINATOR_PROFILES.heavy, true), P10_JOB_ID, "p10");
      for (const role of P10_ROLES) for (const mode of P10_THINKING_MODES) {
        const cell = data.requests[role][mode], messages = cell.body.messages as { role: "system" | "user"; content: string }[];
        const expected = model.requestBody(messages, [], { maxOutputTokens: OUTPUT_TOKENS[role], ...(mode === "off" ? { thinking: "disabled" as const } : {}) }).body;
        expect(canonical(cell.body)).toBe(expected); expect(cell.bodySha256).toBe(digest(expected));
        expect(messages.map(m => m.role)).toEqual(["system", "user"]); expect(messages[0]!.content).toBe(data.systems[role]);
        expect(cell.body).toMatchObject({ model: settings.vllm.model, max_tokens: OUTPUT_TOKENS[role], cache_salt: vllmCacheSalt(P10_JOB_ID), stream: settings.streamingEnabled });
        if (settings.streamingEnabled) expect(cell.body.stream_options).toEqual({ include_usage: true }); else expect(cell.body).not.toHaveProperty("stream_options");
        if (mode === "on") expect(cell.body).toMatchObject({ reasoning_effort: "medium", temperature: 1, top_p: 0.95, top_k: 20 });
        else for (const key of ["reasoning_effort", "temperature", "top_p", "top_k", "presence_penalty"]) expect(cell.body).not.toHaveProperty(key);
        expect(cell.body.chat_template_kwargs).toEqual(settings.vllm.localReplyContract ? { enable_thinking: mode === "on", preserve_thinking: false } : mode === "off" ? { enable_thinking: false } : undefined);
        expect(cell.body).not.toHaveProperty("response_format");
      }
      expect(data.requestSettings).toEqual({ model: settings.vllm.model, streaming: settings.streamingEnabled, localReplyContract: settings.vllm.localReplyContract ?? null,
        localContextTokens: settings.vllm.localContextTokens ?? null, profile: "heavy", cacheSalt: true });
    }
    // The synthesis off cell carries the cap a thinking-off synthesis role gets; the on cell keeps the 1,200-word ceiling, and nothing else differs.
    const data = buildRoleSchemaExport(), user = (mode: "on" | "off") => JSON.parse((data.requests.synthesis[mode].body.messages as { content: string }[])[1]!.content);
    const on = user("on"), off = user("off");
    expect(on.lengthCap).toEqual({ words: 1200 }); expect(canonical(on)).toBe(data.payloads.synthesis.userContent);
    expect(off.lengthCap).toEqual({ words: researchSynthesisLengthCap(brief, { maxOutputTokens: OUTPUT_TOKENS.synthesis, thinking: "disabled" }).words });
    expect(off.lengthCap.words).toBeGreaterThan(1200); expect({ ...off, lengthCap: on.lengthCap }).toEqual(on);
    for (const role of ["plan", "extract"] as const) expect(data.requests[role].off.body.messages).toEqual(data.requests[role].on.body.messages);
  });

  it("matches the bodies the pipeline itself sends for the modes its roles use: plan and synthesis on, extraction off (P10-align)", async () => {
    const settings: RequestSettings = { vllm: { model: "Synthetic" }, streamingEnabled: false };
    const data = buildRoleSchemaExport(undefined, settings), { brief, sources } = syntheticRoleCorpus(), exportedPlan = JSON.parse(data.payloads.extract.userContent.split("\n")[0]!).plan;
    const sent: Record<string, unknown>[] = [];
    const request = vi.fn(async (input: { body: string }, settle: (bytes: Buffer) => number) => {
      const body = JSON.parse(input.body), system = body.messages[0].content as string, user = body.messages[1].content as string; sent.push(body);
      const content = system.startsWith("You plan") ? JSON.stringify(exportedPlan) : researchV4Reply(system, user);
      const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
      return { bytes, receipt: { feeMicrousd: settle(bytes) } };
    });
    // The pipeline's own calls, on models with the export's configuration and job id.
    const config = buildLocalScreenModelConfig(settings as never, COORDINATOR_PROFILES.heavy, true);
    const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, P10_JOB_ID, "reader");
    const outcome = await runResearchPipeline({ brief, sources, models: { reader: make(), planner: make(), synthesiser: make() }, signal: new AbortController().signal, record: () => {} });
    expect(outcome.status).toBe("completed");
    const of = (system: string) => sent.find(body => (body.messages as { content: string }[])[0]!.content === system)!;
    const transport = (body: Record<string, unknown>) => { const { messages: _messages, ...rest } = body; return rest; };
    // The first extraction call (thinking disabled) is the export's off body, byte for byte.
    expect(canonical(of(EXTRACT_SYSTEM))).toBe(canonical(data.requests.extract.off.body));
    // Plan and synthesis (thinking "model"): every field but the user message, whose packet the run fills, and the synthesis cap.
    expect(transport(of(PLAN_SYSTEM))).toEqual(transport(data.requests.plan.on.body));
    expect(transport(of(SYNTHESIS_SYSTEM))).toEqual(transport(data.requests.synthesis.on.body));
    expect(parseResearchUserContent((of(SYNTHESIS_SYSTEM).messages as { content: string }[])[1]!.content).lengthCap)
      .toEqual(JSON.parse((data.requests.synthesis.on.body.messages as { content: string }[])[1]!.content).lengthCap);
  });

  it("pins the research protocol hash through the shared pin", () => {
    expect(researchProtocolSha256()).toBe(RESEARCH_PROTOCOL_SHA256);
  });

  it("writes the file from the command line with owner-only permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "soar-role-schemas-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const out = join(root, "nested", "role-schemas.json");
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "scripts/export-role-schemas.ts", "--out", out], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
    expect(JSON.parse(stdout)).toMatchObject({ written: true, roles: ["plan", "extract", "synthesis"], protocolSha256: RESEARCH_PROTOCOL_SHA256 });
    expect(statSync(out).mode & 0o777).toBe(0o600);
    // The command line builds the bodies under the desktop's own settings (loadConfig()); the file records them, so the build reproduces from it.
    const written = JSON.parse(readFileSync(out, "utf8")), recorded = written.requestSettings;
    const settings: RequestSettings = { vllm: { model: recorded.model, ...(recorded.localReplyContract ? { localReplyContract: recorded.localReplyContract, localContextTokens: recorded.localContextTokens } : {}) },
      streamingEnabled: recorded.streaming };
    const expected = buildRoleSchemaExport(written.generatedUtc, settings);
    expect(written).toEqual(JSON.parse(JSON.stringify(expected)));
  });
});
