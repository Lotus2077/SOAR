import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, jsonSchemaResponseFormat, vllmCacheSalt } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { researchSynthesisLengthCap } from "../../src/main/private-agent/research-admission";
import { ResearchSynthesisSchema, deriveBriefUnits } from "../../src/main/private-agent/research-coverage";
import { RESEARCH_PLAN_JSON_SCHEMA } from "../../src/main/private-agent/research-plan";
import { EXTRACT_SYSTEM, ExtractReplySchema, OUTPUT_TOKENS, PLAN_SYSTEM, RESEARCH_EXTRACT_JSON_SCHEMA, RESEARCH_ROLE_SCHEMAS, SYNTHESIS_SYSTEM, THINKING, researchExtractionUserContent, researchProtocolSha256, runResearchPipeline, synthesisLengthCap } from "../../src/main/private-agent/research-pipeline";
import { DEFAULT_RESEARCH_ROLE_POLICY, type ResearchRolePolicy } from "../../src/main/private-agent/research-roles";
import { DEFAULT_ROLE_SCHEMAS_PATH, P10_JOB_ID, P10_ROLES, P10_THINKING_MODES, SYNTHETIC_REQUEST_SETTINGS, buildRoleSchemaExport, isRoleSchemaExportSynthesisCap, parseRoleSchemaExportArguments, syntheticRoleCorpus,
  type RequestSettings, type RoleSchemaExport } from "../../scripts/export-role-schemas";
import { buildLocalScreenModelConfig } from "../../scripts/private-agent-local-screen";
import { RESEARCH_ROLE_MAX_OUTPUT_TOKENS, parseServingCard, resolveServingCard, servingCardRequestSettings, type ServingCardV1 } from "../../src/main/private-agent/serving-card";
import { RESEARCH_PROTOCOL_SHA256 } from "../helpers/research-protocol-pin";
import { parseResearchUserContent, researchV4Reply } from "../helpers/research-v4-fixture";
import { adopt, currentSyntheticProbe, runCardWriter } from "../helpers/serving-card-fixture";
import { SYNTHETIC_P10_REQUEST_SETTINGS } from "../helpers/serving-probe-fixture";

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
      // BL-20261114-2301-serving-card-request-settings-design: the record is the reader's own function of the settings, so a run's comparison cannot drift from it.
      expect(data.requestSettings).toEqual(servingCardRequestSettings(settings, true));
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

// Topic 6 (BL-20261117-1000-p10-plan-cap-export-design): a plan cap for P10's re-probe, so a card can flag the planner at 16,384.
describe("role schema export with a plan cap (topic 6)", () => {
  const settings: RequestSettings = { vllm: { model: "Synthetic" }, streamingEnabled: true };

  it("builds both plan cells at the cap and records it as the plan's output cap, and changes nothing else", () => {
    const today = buildRoleSchemaExport("2026-11-17T00:00:00.000Z", settings), capped = buildRoleSchemaExport("2026-11-17T00:00:00.000Z", settings, { planCap: 16384 });
    // Without a cap the export is today's, with the pipeline's own caps object.
    expect(canonical(buildRoleSchemaExport("2026-11-17T00:00:00.000Z", settings, {}))).toBe(canonical(today)); expect(today.outputTokens).toBe(OUTPUT_TOKENS);
    expect(capped.outputTokens).toEqual({ index: 1536, plan: 16384, extract: 2048, synthesis: 8192 });
    const model = new PrivateAgentModel({} as PrivateAgentBroker, buildLocalScreenModelConfig(settings as never, COORDINATOR_PROFILES.heavy, true), P10_JOB_ID, "p10");
    for (const mode of P10_THINKING_MODES) {
      const cell = capped.requests.plan[mode], messages = cell.body.messages as { role: "system" | "user"; content: string }[];
      const expected = model.requestBody(messages, [], { maxOutputTokens: 16384, ...(mode === "off" ? { thinking: "disabled" as const } : {}) }).body;
      expect(canonical(cell.body)).toBe(expected); expect(cell.bodySha256).toBe(digest(expected)); expect(cell.body.max_tokens).toBe(16384);
      // Each plan body is today's with its cap replaced, and nothing else.
      expect({ ...cell.body, max_tokens: OUTPUT_TOKENS.plan }).toEqual(today.requests.plan[mode].body);
    }
    const rest = ({ outputTokens: _caps, requests: { plan: _plan, ...requests }, ...other }: RoleSchemaExport) => ({ requests, other });
    expect(rest(capped)).toEqual(rest(today));
    // Only a cap the reader accepts: above the Heavy profile's limit the model layer would clamp the body without a word.
    for (const planCap of [127, RESEARCH_ROLE_MAX_OUTPUT_TOKENS + 1, 0, -8192, 8192.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => buildRoleSchemaExport(undefined, settings, { planCap })).toThrow("role_export_plan_cap_invalid");
    expect(buildRoleSchemaExport(undefined, settings, { planCap: 128 }).requests.plan.off.body.max_tokens).toBe(128);
    expect(RESEARCH_ROLE_MAX_OUTPUT_TOKENS).toBe(16384);
  });

  it("reads --out and --plan-cap, each once, after one leading --, and refuses anything else", () => {
    expect(parseRoleSchemaExportArguments([])).toEqual({ out: DEFAULT_ROLE_SCHEMAS_PATH });
    expect(parseRoleSchemaExportArguments(["--"])).toEqual({ out: DEFAULT_ROLE_SCHEMAS_PATH });
    expect(parseRoleSchemaExportArguments(["--", "--out", "x.json", "--plan-cap", "16384"])).toEqual({ out: "x.json", planCap: 16384 });
    expect(parseRoleSchemaExportArguments(["--plan-cap", "128", "--out", "x.json"])).toEqual({ out: "x.json", planCap: 128 });
    for (const args of [["--plan-cap", "127"], ["--plan-cap", "16385"], ["--plan-cap", "0"], ["--plan-cap", "-8192"], ["--plan-cap", "8192.5"], ["--plan-cap", "1e4"],
      ["--plan-cap", "08192"], ["--plan-cap", " 8192"], ["--plan-cap", "0x2000"], ["--plan-cap", ""], ["--plan-cap"], ["--plan-cap", "--out", "x.json"], ["--out"],
      ["--out", "a.json", "--out", "b.json"], ["--plan-cap", "8192", "--plan-cap", "16384"], ["--plan-caps", "16384"], ["--plan-cap=16384"], ["--out=x.json"],
      ["x.json"], ["--", "--", "--out", "x.json"], ["--out", "x.json", "--"], ["--out", ""], ["--out", "--plan-cap"], ["--out", "--plan-cap", "16384"]])
      expect(() => parseRoleSchemaExportArguments(args), JSON.stringify(args)).toThrow("role_export_arguments_invalid");
    // An option's value is never empty and never another option: the file would otherwise be named after the option.
    for (const option of ["--out", "--plan-cap"]) for (const value of [[], [""], ["--out"]])
      expect(() => parseRoleSchemaExportArguments([option, ...value])).toThrow(`role_export_arguments_invalid: ${option} needs a value`);
    expect(() => parseRoleSchemaExportArguments(["--plan-cap", "16385"])).toThrow("role_export_arguments_invalid: --plan-cap takes an integer from 128 to 16384");
    expect(() => parseRoleSchemaExportArguments(["--plan-cap", "8192", "--plan-cap", "16384"])).toThrow("role_export_arguments_invalid: --plan-cap given twice");
  });

  it("is what the pipeline sends under a card with the planner at 16,384 and its thinking-on mode flagged: P10's plan/on body plus the format P10 adds", async () => {
    const unstreamed: RequestSettings = { vllm: { model: "Synthetic" }, streamingEnabled: false };
    const data = buildRoleSchemaExport(undefined, unstreamed, { planCap: 16384 }), { brief, sources } = syntheticRoleCorpus();
    const exportedPlan = JSON.parse(data.payloads.extract.userContent.split("\n")[0]!).plan, sent: Record<string, unknown>[] = [];
    const request = vi.fn(async (input: { body: string }, settle: (bytes: Buffer) => number) => {
      const body = JSON.parse(input.body), system = body.messages[0].content as string, user = body.messages[1].content as string; sent.push(body);
      const content = system.startsWith("You plan") ? JSON.stringify(exportedPlan) : researchV4Reply(system, user);
      const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
      return { bytes, receipt: { feeMicrousd: settle(bytes) } };
    });
    const config = buildLocalScreenModelConfig(unstreamed as never, COORDINATOR_PROFILES.heavy, true);
    const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, P10_JOB_ID, "reader");
    // The planner a card written from that export's probe proposes, as the reader returns it once adopted.
    const roles = structuredClone(DEFAULT_RESEARCH_ROLE_POLICY) as ResearchRolePolicy;
    roles.plan = { maxOutputTokens: [16384, 16384], thinking: ["model", "model"], structuredOutput: { variant: "strict", thinkingOff: false, thinkingOn: true } };
    const outcome = await runResearchPipeline({ brief, sources, models: { reader: make(), planner: make(), synthesiser: make() }, signal: new AbortController().signal, record: () => {}, roles });
    expect(outcome.status).toBe("completed");
    const plans = sent.filter(body => (body.messages as { content: string }[])[0]!.content === PLAN_SYSTEM);
    expect(plans).toHaveLength(1); expect(plans[0]!.max_tokens).toBe(16384);
    // The format P10 adds is the pipeline's own (pinned in serving-probe-helpers.test.ts, item 9); every field but the user message is P10's.
    const probed = { ...data.requests.plan.on.body, response_format: jsonSchemaResponseFormat({ ...RESEARCH_ROLE_SCHEMAS.plan, strict: true }) };
    const transport = (body: Record<string, unknown>) => { const { messages: _messages, ...rest } = body; return rest; };
    expect(transport(plans[0]!)).toEqual(transport(probed));
  });

  it("reaches the card through the probe's record: the writer proposes the planner at 16,384 beside P10's plan cells at 16,384, and the reader resolves its flag", () => {
    // What scripts/serving-probe.py records from an export: its caps under roles.output_tokens, and each P10 cell's cap from the body it sent.
    const probeOf = (data: RoleSchemaExport) => {
      const probe = currentSyntheticProbe(); probe.roles.output_tokens = { ...data.outputTokens };
      for (const role of P10_ROLES) for (const mode of P10_THINKING_MODES) probe.P10.cells[`${role}/${mode}`].max_tokens = data.requests[role][mode].body.max_tokens;
      return probe;
    };
    const cardOf = (data: RoleSchemaExport) => { const run = runCardWriter(probeOf(data)); expect(run.status, run.stderr).toBe(0); return parseServingCard(run.policy!); };
    const capped = cardOf(buildRoleSchemaExport(undefined, SYNTHETIC_REQUEST_SETTINGS, { planCap: 16384 })), today = cardOf(buildRoleSchemaExport(undefined, SYNTHETIC_REQUEST_SETTINGS));
    expect(capped.roles.plan).toEqual({ maxOutputTokens: [16384, 16384], thinking: ["model", "model"], structuredOutput: { variant: "strict", thinkingOff: false, thinkingOn: true } });
    expect([capped.evidence.p10!.cells["plan/on"]!.maxTokens, capped.evidence.p10!.cells["plan/off"]!.maxTokens]).toEqual([16384, 16384]);
    expect(today.roles.plan.maxOutputTokens).toEqual([8192, 8192]);
    // Apart from the probe's digest, only the planner's caps and its two cells' caps differ from the card today's export gives.
    const others = (card: ServingCardV1) => {
      const copy = structuredClone(card) as any; copy.probe.sha256 = null; copy.roles.plan.maxOutputTokens = null;
      for (const mode of P10_THINKING_MODES) copy.evidence.p10.cells[`plan/${mode}`].maxTokens = null;
      return copy;
    };
    expect(others(capped)).toEqual(others(today));
    const expectation = { model: "RM-01 VLM", requestSettings: { ...SYNTHETIC_P10_REQUEST_SETTINGS } };
    expect(resolveServingCard(adopt(capped), expectation).roles.plan).toEqual(capped.roles.plan);
    // Without the cap no card can keep plan's flag at 16,384: its cell measured 8,192.
    const moved = adopt(today); moved.roles.plan.maxOutputTokens = [16384, 16384];
    expect(() => resolveServingCard(moved, expectation)).toThrow("serving_card_structured_output_cap_unmeasured");
  });

  it("takes --plan-cap from the command line, prints the caps it wrote, and refuses another argument with exit 2 and no file", () => {
    const root = mkdtempSync(join(tmpdir(), "soar-role-schemas-cap-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/export-role-schemas.ts", ...args],
      { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
    const out = join(root, "capped.json"), written = run(["--", "--out", out, "--plan-cap", "16384"]);
    expect(written.status, written.stderr).toBe(0);
    const printed = JSON.parse(written.stdout), file = JSON.parse(readFileSync(out, "utf8"));
    expect(printed.outputTokens).toEqual({ index: 1536, plan: 16384, extract: 2048, synthesis: 8192 }); expect(file.outputTokens).toEqual(printed.outputTokens);
    expect(P10_THINKING_MODES.map(mode => file.requests.plan[mode].body.max_tokens)).toEqual([16384, 16384]);
    expect(printed.bodySha256.plan).toEqual({ on: file.requests.plan.on.bodySha256, off: file.requests.plan.off.bodySha256 });
    // The file reproduces from the builder with the same cap, under the settings it records.
    const recorded = file.requestSettings, under: RequestSettings = { vllm: { model: recorded.model, ...(recorded.localReplyContract
      ? { localReplyContract: recorded.localReplyContract, localContextTokens: recorded.localContextTokens } : {}) }, streamingEnabled: recorded.streaming };
    expect(file).toEqual(JSON.parse(JSON.stringify(buildRoleSchemaExport(file.generatedUtc, under, { planCap: 16384 }))));
    for (const args of [["--plan-cap", "16385"], ["--plan-caps", "16384"]]) {
      const target = join(root, `refused-${args[0]}.json`), refused = run(["--out", target, ...args]);
      expect(refused.status).toBe(2); expect(refused.stdout).toBe(""); expect(refused.stderr).toContain("role_export_arguments_invalid"); expect(existsSync(target)).toBe(false);
    }
  });
});

// The E0 card's Amendment 8: a synthesis cap for the re-probe, so a revised card can carry the synthesis caps the fixtures choose.
describe("role schema export with a synthesis cap (the E0 card's Amendment 8)", () => {
  const settings: RequestSettings = { vllm: { model: "Synthetic" }, streamingEnabled: true };

  it("builds both synthesis cells at the cap with the word cap the stage would send there, records the cap, and changes nothing else", () => {
    const today = buildRoleSchemaExport("2026-11-18T00:00:00.000Z", settings), capped = buildRoleSchemaExport("2026-11-18T00:00:00.000Z", settings, { synthesisCap: 16384 });
    expect(capped.outputTokens).toEqual({ index: 1536, plan: 8192, extract: 2048, synthesis: 16384 });
    const model = new PrivateAgentModel({} as PrivateAgentBroker, buildLocalScreenModelConfig(settings as never, COORDINATOR_PROFILES.heavy, true), P10_JOB_ID, "p10");
    const { brief } = syntheticRoleCorpus();
    for (const mode of P10_THINKING_MODES) {
      const cell = capped.requests.synthesis[mode], messages = cell.body.messages as { role: "system" | "user"; content: string }[];
      const expected = model.requestBody(messages, [], { maxOutputTokens: 16384, ...(mode === "off" ? { thinking: "disabled" as const } : {}) }).body;
      expect(canonical(cell.body)).toBe(expected); expect(cell.body.max_tokens).toBe(16384);
      // The payload's word cap is the stage's at this cap and thinking: the thinking ceiling on, the cap's own fit off.
      expect(JSON.parse(messages[1]!.content).lengthCap).toEqual({ words: researchSynthesisLengthCap(brief, { maxOutputTokens: 16384, thinking: mode === "on" ? "model" : "disabled" }).words });
    }
    expect(JSON.parse((capped.requests.synthesis.off.body.messages as { content: string }[])[1]!.content).lengthCap.words)
      .not.toBe(JSON.parse((today.requests.synthesis.off.body.messages as { content: string }[])[1]!.content).lengthCap.words);
    const rest = ({ outputTokens: _caps, payloads: { synthesis: _p, ...payloads }, requests: { synthesis: _s, ...requests }, ...other }: RoleSchemaExport) => ({ payloads, requests, other });
    expect(rest(capped)).toEqual(rest(today));
    // Below about 2,518 tokens the thinking-on cell's fit is under its 1,200-word ceiling, so its word cap moves with the cap: 822 words at 2,048.
    const low = buildRoleSchemaExport(undefined, settings, { synthesisCap: 2048 });
    expect(P10_THINKING_MODES.map(mode => JSON.parse((low.requests.synthesis[mode].body.messages as { content: string }[])[1]!.content).lengthCap.words)).toEqual([822, 822]);
    // Both caps together, and the default export unchanged by the new option.
    expect(buildRoleSchemaExport(undefined, settings, { planCap: 16384, synthesisCap: 16384 }).outputTokens).toEqual({ index: 1536, plan: 16384, extract: 2048, synthesis: 16384 });
    expect(canonical(buildRoleSchemaExport("2026-11-18T00:00:00.000Z", settings, {}))).toBe(canonical(today)); expect(today.outputTokens).toBe(OUTPUT_TOKENS);
  });

  it("refuses a cap outside the reader's range or whose synthesis length ceiling falls below the pipeline's floor", () => {
    // floor((1148 - 1024) / 1.245) = 99 words, below the 100-word floor; 1149 gives 100.
    for (const synthesisCap of [127, 1148, RESEARCH_ROLE_MAX_OUTPUT_TOKENS + 1, 8192.5, Number.NaN]) {
      expect(isRoleSchemaExportSynthesisCap(synthesisCap)).toBe(false);
      expect(() => buildRoleSchemaExport(undefined, settings, { synthesisCap })).toThrow("role_export_synthesis_cap_invalid");
    }
    expect([1149, 8192, 16384].map(isRoleSchemaExportSynthesisCap)).toEqual([true, true, true]);
    expect(parseRoleSchemaExportArguments(["--", "--synthesis-cap", "16384", "--plan-cap", "16384"])).toEqual({ out: DEFAULT_ROLE_SCHEMAS_PATH, planCap: 16384, synthesisCap: 16384 });
    for (const args of [["--synthesis-cap", "1148"], ["--synthesis-cap", "16385"], ["--synthesis-cap", "8192", "--synthesis-cap", "16384"], ["--synthesis-caps", "16384"], ["--synthesis-cap"]])
      expect(() => parseRoleSchemaExportArguments(args)).toThrow("role_export_arguments_invalid");
  });

  it("reaches the card through the probe's record: the writer proposes synthesis at the cap beside P10's synthesis cells at it, and the reader resolves the card", () => {
    const data = buildRoleSchemaExport(undefined, SYNTHETIC_REQUEST_SETTINGS, { planCap: 16384, synthesisCap: 16384 }), probe = currentSyntheticProbe();
    probe.roles.output_tokens = { ...data.outputTokens };
    for (const role of P10_ROLES) for (const mode of P10_THINKING_MODES) probe.P10.cells[`${role}/${mode}`].max_tokens = data.requests[role][mode].body.max_tokens;
    const run = runCardWriter(probe, ["--attempt-thinking", "synthesis=model,disabled"]);
    expect(run.status, run.stderr).toBe(0);
    const card = parseServingCard(run.policy!);
    expect(card.roles.synthesis).toMatchObject({ maxOutputTokens: [16384, 16384], thinking: ["model", "disabled"] });
    expect([card.evidence.p10!.cells["synthesis/on"]!.maxTokens, card.evidence.p10!.cells["synthesis/off"]!.maxTokens]).toEqual([16384, 16384]);
    // Adopted with a `serving_card` basis, so the reader also derives the admission rates from the paired roles' first attempts.
    const admitted = adopt(card); (admitted as { admission: { basis: string } }).admission.basis = "serving_card";
    const resolved = resolveServingCard(admitted, { model: "RM-01 VLM", requestSettings: { ...SYNTHETIC_P10_REQUEST_SETTINGS } });
    expect(resolved.roles.synthesis).toEqual(card.roles.synthesis); expect(resolved.admission.basis).toBe("serving_card");
  });

  it("takes --synthesis-cap from the command line and prints the caps it wrote", () => {
    const root = mkdtempSync(join(tmpdir(), "soar-role-schemas-synthesis-cap-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const out = join(root, "capped.json"), written = spawnSync(process.execPath, ["--import", "tsx", "scripts/export-role-schemas.ts", "--", "--out", out, "--synthesis-cap", "16384"],
      { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
    expect(written.status, written.stderr).toBe(0);
    expect(JSON.parse(written.stdout).outputTokens).toEqual({ index: 1536, plan: 8192, extract: 2048, synthesis: 16384 });
    expect(P10_THINKING_MODES.map(mode => JSON.parse(readFileSync(out, "utf8")).requests.synthesis[mode].body.max_tokens)).toEqual([16384, 16384]);
  });
});
