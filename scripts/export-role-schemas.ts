/**
 * Role-schema export for probe P10 (backlog item 5, experiment E0): the planner, extractor and synthesis JSON schemas,
 * their system prompts, the role output caps and thinking policy, one synthetic user payload per role and, since P10-align
 * (#95), the whole request body the pipeline sends for each role and thinking mode, written
 * to the ignored `.soar/experiments/role-schemas.json` so `scripts/serving-probe.py` sends the pipeline's own role requests
 * without duplicating any TypeScript value. The bodies are built by the model layer's own `requestBody` under the headless
 * driver's local configuration, read from the desktop's settings by `loadConfig()`. The index role has no JSON schema and is
 * not exported. Nothing here reads the endpoint or sends a request; the payloads are invented text with no owner data, and
 * neither the bodies nor the recorded settings carry an address or a key.
 *
 *   pnpm probe:export-schemas [-- [--out <path>] [--plan-cap <tokens>] [--synthesis-cap <tokens>]]
 *
 * `--plan-cap` (topic 6, #136) builds both plan cells at that cap, from 128 to 16,384 tokens,
 * and records it as `outputTokens.plan`. The probe copies those caps and the card writer proposes the planner's attempts from them,
 * so the planner a card proposes and its P10 plan cells name one cap. `--synthesis-cap` (the E0 card's Amendment 8) does the same for
 * both synthesis cells, whose payloads then carry the word cap the stage would send at that cap, and refuses a cap whose synthesis
 * length ceiling falls below the floor, which the pipeline refuses (researchSynthesisBelowFloor). Any other argument is refused before
 * anything is written.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, type SoarConfig } from "../src/main/config";
import type { PrivateAgentBroker } from "../src/main/private-agent/broker";
import { canonical, digest } from "../src/main/private-agent/contracts";
import { PrivateAgentModel, type ModelResponseFormat } from "../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../src/main/private-agent/profiles";
import { researchSynthesisLengthCap } from "../src/main/private-agent/research-admission";
import { ResearchCoverageSchema, ResearchEvidenceSchema, deriveBriefUnits, inventoryResearchSources } from "../src/main/private-agent/research-coverage";
import { assembleIndexEntry, buildLiteralSourceCard } from "../src/main/private-agent/research-index";
import { RESEARCH_PLAN_JSON_SCHEMA, ResearchPlanSchema } from "../src/main/private-agent/research-plan";
import { EXTRACT_SYSTEM, OUTPUT_TOKENS, PLAN_SYSTEM, RESEARCH_PIPELINE_BUDGET, RESEARCH_ROLE_SCHEMAS, SYNTHESIS_SYSTEM, THINKING, researchExtractionUserContent, researchProtocolSha256, researchSynthesisBelowFloor, synthesisLengthCap } from "../src/main/private-agent/research-pipeline";
import { MIN_ROLE_OUTPUT_TOKENS } from "../src/main/private-agent/research-roles";
import { RESEARCH_ROLE_MAX_OUTPUT_TOKENS, servingCardRequestSettings, type ServingCardRequestSettings } from "../src/main/private-agent/serving-card";
import { buildLocalScreenModelConfig } from "./private-agent-local-screen";

export const ROLE_SCHEMA_EXPORT_VERSION = 2;
export const DEFAULT_ROLE_SCHEMAS_PATH = ".soar/experiments/role-schemas.json";
/** Topic 6: the plan cap P10's plan cells are built at, when it is not the pipeline's own. */
export interface RoleSchemaExportOptions { planCap?: number; synthesisCap?: number }
/** The command line's values: the file it writes and the export's options. */
export interface RoleSchemaExportArguments extends RoleSchemaExportOptions { out: string }
/** The roles with a reply JSON schema; the index role is validated structurally and has none. */
export const P10_ROLES = ["plan", "extract", "synthesis"] as const;
export type RoleWithSchema = (typeof P10_ROLES)[number];
/** P10's thinking modes: "on" is a role whose thinking follows the model (the heavy profile's medium thinking); "off" one whose thinking is disabled. */
export const P10_THINKING_MODES = ["on", "off"] as const;
export type P10ThinkingMode = (typeof P10_THINKING_MODES)[number];
/** The job id of every P10 body: it fixes the one cache salt they all carry, as one job's id fixes the pipeline's. */
export const P10_JOB_ID = "serving-probe-p10";
/** The desktop settings that shape a body, as `loadConfig()` reads them: no address and no key. */
export interface RequestSettings { vllm: Pick<SoarConfig["vllm"], "model" | "localReplyContract" | "localContextTokens">; streamingEnabled: boolean }
/** Synthetic settings for callers that need only the schemas or payloads; the command line always uses the desktop's. */
export const SYNTHETIC_REQUEST_SETTINGS: RequestSettings = Object.freeze({ vllm: Object.freeze({ model: "Synthetic" }), streamingEnabled: true });
export interface P10Request { body: Record<string, unknown>; bodySha256: string }

export interface RoleSchemaExport {
  version: typeof ROLE_SCHEMA_EXPORT_VERSION;
  generatedUtc: string;
  protocolSha256: string;
  schemas: Record<RoleWithSchema, unknown>;
  systems: Record<RoleWithSchema, string>;
  /** The caps the bodies were built at: the pipeline's `OUTPUT_TOKENS`, or with the plan's replaced by a plan cap (topic 6). */
  outputTokens: Readonly<Record<keyof typeof OUTPUT_TOKENS, number>>;
  thinking: typeof THINKING;
  payloads: { plan: { userContent: string; units: string[]; sourceIds: string[] }; extract: { userContent: string }; synthesis: { userContent: string } };
  /**
   * The settings the bodies were built under: the desktop's model, streaming and Flash reply contract, the heavy profile and the cache
   * salt. Built by the serving-card reader's own function, which compares a run's settings with the card's copy of this record.
   */
  requestSettings: ServingCardRequestSettings;
  /** The body the pipeline sends for each role and thinking mode, before P10 adds `response_format`, with its SHA-256. */
  requests: Record<RoleWithSchema, Record<P10ThinkingMode, P10Request>>;
}

/** The settings `loadConfig()` reads, narrowed to what shapes a body. */
export function requestSettingsOf(config: Pick<SoarConfig, "vllm" | "streamingEnabled">): RequestSettings {
  return { vllm: { model: config.vllm.model, ...(config.vllm.localReplyContract ? { localReplyContract: config.vllm.localReplyContract, localContextTokens: config.vllm.localContextTokens } : {}) },
    streamingEnabled: config.streamingEnabled === true };
}

/** The system message the pipeline sends for each role with a reply schema. */
const ROLE_SYSTEMS: Readonly<Record<RoleWithSchema, string>> = Object.freeze({ plan: PLAN_SYSTEM, extract: EXTRACT_SYSTEM, synthesis: SYNTHESIS_SYSTEM });

/**
 * P10-align (#95): one role call's body exactly as `PrivateAgentModel.requestBody` builds it for a pipeline call,
 * under the configuration the headless driver gives every local research role (`buildLocalScreenModelConfig`), with the heavy profile, whose
 * thinking is on, and the cache salt on, salted for `jobId`. Without overrides the call takes the model's thinking and the role's pipeline cap;
 * `thinking: "disabled"` is the override the pipeline's call() sends for a role whose thinking is disabled. P10's cells (buildP10Requests) and
 * E0's extractor fixture (scripts/extractor-fixture.ts, #116) build their bodies here. The broker is
 * never called: requestBody only builds, and it never reads the model's context id.
 */
export function buildRoleRequest(settings: RequestSettings, jobId: string, role: RoleWithSchema, userContent: string,
  overrides: { thinking?: "disabled"; maxOutputTokens?: number; responseFormat?: ModelResponseFormat } = {}): P10Request {
  const config = buildLocalScreenModelConfig({ vllm: settings.vllm as SoarConfig["vllm"], streamingEnabled: settings.streamingEnabled }, COORDINATOR_PROFILES.heavy, true);
  const model = new PrivateAgentModel({} as PrivateAgentBroker, config, jobId, jobId);
  const { body } = model.requestBody([{ role: "system", content: ROLE_SYSTEMS[role] }, { role: "user", content: userContent }], [],
    { maxOutputTokens: overrides.maxOutputTokens ?? OUTPUT_TOKENS[role], ...(overrides.thinking ? { thinking: overrides.thinking } : {}),
      // The serving card's call adds item 9's response_format (E0's fixtures, #125);
      // P10's own cells never pass it, so their bodies are unchanged.
      ...(overrides.responseFormat ? { responseFormat: overrides.responseFormat } : {}) });
  return { body: JSON.parse(body) as Record<string, unknown>, bodySha256: digest(body) };
}

/**
 * P10's six cells: "on" is the role call with the model's thinking; "off" adds the call override `thinking: "disabled"`. Each is built
 * at its role's cap in `caps`, the pipeline's own unless the export was given a plan cap.
 */
export function buildP10Requests(settings: RequestSettings, userContent: Record<RoleWithSchema, Record<P10ThinkingMode, string>>,
  caps: Readonly<Record<RoleWithSchema, number>> = OUTPUT_TOKENS): RoleSchemaExport["requests"] {
  const cell = (role: RoleWithSchema, mode: P10ThinkingMode): P10Request => buildRoleRequest(settings, P10_JOB_ID, role, userContent[role][mode],
    { maxOutputTokens: caps[role], ...(mode === "off" ? { thinking: "disabled" as const } : {}) });
  return Object.fromEntries(P10_ROLES.map(role => [role, { on: cell(role, "on"), off: cell(role, "off") }])) as RoleSchemaExport["requests"];
}

/**
 * A plan cap the reader accepts: an integer from MIN_ROLE_OUTPUT_TOKENS to RESEARCH_ROLE_MAX_OUTPUT_TOKENS (`serving_card_cap_out_of_range`).
 * Above the Heavy profile's limit the model layer would clamp the body's cap without a word, and the body and the recorded cap would disagree.
 */
export function isRoleSchemaExportPlanCap(value: number): boolean {
  return Number.isSafeInteger(value) && value >= MIN_ROLE_OUTPUT_TOKENS && value <= RESEARCH_ROLE_MAX_OUTPUT_TOKENS;
}
/** A synthesis cap the reader and the pipeline accept: a plan cap's range, and a length ceiling at or above the floor in either thinking mode. */
export function isRoleSchemaExportSynthesisCap(value: number): boolean {
  return isRoleSchemaExportPlanCap(value) && !researchSynthesisBelowFloor({ maxOutputTokens: [value, value], thinking: ["model", "disabled"] });
}

/**
 * The command line: `--out <path>` and `--plan-cap <tokens>`, each at most once, after one optional leading `--`, which pnpm 10 passes
 * through (as scripts/serving-card.py allows). Anything else throws `role_export_arguments_invalid`, so a mistyped option can never
 * export the pipeline's 8,192 for a re-probe meant to measure another plan cap.
 */
export function parseRoleSchemaExportArguments(argv: readonly string[]): RoleSchemaExportArguments {
  const args = argv[0] === "--" ? argv.slice(1) : argv, seen = new Set<string>(), invalid = (why: string) => new Error(`role_export_arguments_invalid: ${why}`);
  let out = DEFAULT_ROLE_SCHEMAS_PATH, planCap: number | undefined, synthesisCap: number | undefined;
  for (let i = 0; i < args.length; i += 2) {
    const option = args[i]!, value = args[i + 1];
    if (option !== "--out" && option !== "--plan-cap" && option !== "--synthesis-cap")
      throw invalid(`unknown argument ${JSON.stringify(option)}; the options are --out <path>, --plan-cap <tokens> and --synthesis-cap <tokens>`);
    if (seen.has(option)) throw invalid(`${option} given twice`);
    seen.add(option);
    if (value === undefined || value === "" || value.startsWith("--")) throw invalid(`${option} needs a value`);
    if (option === "--out") { out = value; continue; }
    if (option === "--plan-cap") {
      if (!/^[1-9][0-9]{0,5}$/u.test(value) || !isRoleSchemaExportPlanCap(Number(value)))
        throw invalid(`--plan-cap takes an integer from ${MIN_ROLE_OUTPUT_TOKENS} to ${RESEARCH_ROLE_MAX_OUTPUT_TOKENS}`);
      planCap = Number(value); continue;
    }
    if (!/^[1-9][0-9]{0,5}$/u.test(value) || !isRoleSchemaExportSynthesisCap(Number(value)))
      throw invalid(`--synthesis-cap takes an integer up to ${RESEARCH_ROLE_MAX_OUTPUT_TOKENS} whose synthesis length ceiling is at least the floor`);
    synthesisCap = Number(value);
  }
  return { out, ...(planCap === undefined ? {} : { planCap }), ...(synthesisCap === undefined ? {} : { synthesisCap }) };
}

/** Synthetic corpus for the P10 payloads: invented public text, two short sources, three numbered requirements. */
export function syntheticRoleCorpus() {
  const brief = "1. Describe the synthetic orchard and meadow surveys in the supplied corpus.\n2. Name every conflict between the two surveys.\n3. State the limitations of the extracted evidence.\n";
  const sources = [
    { id: "input/corpus/alpha.md", path: "input/corpus/alpha.md", bytes: Buffer.from("# Synthetic alpha\nThe orchard recorded twelve healthy trees during the autumn survey.\nThe survey ran for three days in October.\n") },
    { id: "input/corpus/beta.md", path: "input/corpus/beta.md", bytes: Buffer.from("# Synthetic beta\nThe meadow recorded seven healthy trees during the spring survey.\nThe survey ran for two days in April.\n") },
  ];
  return { brief, sources };
}

export function buildRoleSchemaExport(generatedUtc = new Date().toISOString(), settings: RequestSettings = SYNTHETIC_REQUEST_SETTINGS,
  options: RoleSchemaExportOptions = {}): RoleSchemaExport {
  if (options.planCap !== undefined && !isRoleSchemaExportPlanCap(options.planCap)) throw new RangeError("role_export_plan_cap_invalid");
  if (options.synthesisCap !== undefined && !isRoleSchemaExportSynthesisCap(options.synthesisCap)) throw new RangeError("role_export_synthesis_cap_invalid");
  // Topic 6 (#136): a plan cap reaches both plan bodies and the recorded caps, which the probe copies
  // and the card writer proposes the planner's attempts from; Amendment 8's synthesis cap does the same for synthesis. Without either
  // the caps are the pipeline's own object, so the file is today's.
  const outputTokens: RoleSchemaExport["outputTokens"] = options.planCap === undefined && options.synthesisCap === undefined ? OUTPUT_TOKENS
    : Object.freeze({ ...OUTPUT_TOKENS, ...(options.planCap === undefined ? {} : { plan: options.planCap }), ...(options.synthesisCap === undefined ? {} : { synthesis: options.synthesisCap }) });
  const { brief, sources } = syntheticRoleCorpus();
  const units = deriveBriefUnits(brief), inventory = inventoryResearchSources(sources);
  const ordered = inventory.sources.map(s => sources.find(item => item.id === s.id)!);
  // A host-literal index (no model summaries) has the exact document shape the planner receives.
  const sourceIndex = { version: 2, sources: ordered.map(s => assembleIndexEntry(buildLiteralSourceCard({ sourceId: s.id, bytes: s.bytes }), undefined, 0)) };
  const plan = ResearchPlanSchema.parse({ version: 2, questions: units.map((unit, i) => ({ id: `Q${i + 1}`, text: `What does the corpus establish about requirement ${unit.id}?`,
    requirementIds: [unit.id], sourceIds: [], lookFor: [] })), conflictsToCheck: ["survey dates"], deliverableNotes: "Distinguish evidence from uncertainty." });
  const chunk = inventory.chunks[0]!, chunkSource = ordered.find(s => s.id === chunk.sourceId)!;
  const chunkText = chunkSource.bytes.subarray(chunk.startByte, chunk.endByte).toString("utf8");
  const quote = "The orchard recorded twelve healthy trees during the autumn survey.";
  const evidence = ResearchEvidenceSchema.parse({ version: 2, quotes: [{ id: "E1", questionIds: ["Q1"], sourceId: chunkSource.id, sourceSha256: chunk.sourceSha256, chunkIds: [chunk.id], locator: "line 2", quote, note: "" }],
    conflicts: [], counts: { verified: 1, inPacket: 1, leftByCap: 0, droppedUnverifiedOrDuplicate: 0, conflictsNoted: 0 } });
  const coverage = ResearchCoverageSchema.parse({ version: 5, protocolSha256: researchProtocolSha256(), briefSha256: digest(Buffer.from(brief)), briefBytes: Buffer.byteLength(brief),
    sourceManifestSha256: inventory.sourceManifestSha256, units, sources: inventory.sources,
    chunks: inventory.chunks.map(c => ({ ...c, status: "complete", attempts: [{ responseSha256: digest("synthetic extraction reply"), status: "complete" }],
      questions: plan.questions.map(q => ({ questionId: q.id, status: c.id === chunk.id && q.id === "Q1" ? "evidence_retained" : "no_verified_evidence", evidenceIds: c.id === chunk.id && q.id === "Q1" ? ["E1"] : [] })) })),
    omissions: [], conflictOmissions: [], unresolved: [], synthesis: { status: "pending", questions: [] }, fallbacks: { plan: "none", synthesis: "none" }, status: "incomplete", semanticAcceptance: "not_evaluated", corpusAbsenceEstablished: false });
  const planPayload = { authoritativeSchema: RESEARCH_PLAN_JSON_SCHEMA, brief, units, sourceIndex, mandatorySourceChunks: inventory.chunks.length, extractionCallBudget: RESEARCH_PIPELINE_BUDGET.extractionCalls, repair: null };
  // The pipeline's own builder (7b.1): the stable packet line, a newline, then the chunk line, exactly as every extraction call sends it.
  const extractPayload = { brief, units, plan, source: { id: chunkSource.id, sha256: chunk.sourceSha256 }, chunk: { id: chunk.id, startByte: chunk.startByte, endByte: chunk.endByte, text: chunkText }, repairReason: null };
  // Each synthesis cell's word cap is the one the stage would send at the cell's cap and thinking (research-admission.ts): at the pipeline's
  // own cap and thinking, synthesisLengthCap's; a thinking-off synthesis role gets the cap that fits its reply, not the thinking ceiling (#85).
  const onCap = options.synthesisCap === undefined ? synthesisLengthCap(brief) : researchSynthesisLengthCap(brief, { maxOutputTokens: outputTokens.synthesis, thinking: "model" });
  const synthesisPayload = { brief, units, plan, evidence, coverage, lengthCap: { words: onCap.words }, repairReason: null };
  const offCap = researchSynthesisLengthCap(brief, { maxOutputTokens: outputTokens.synthesis, thinking: "disabled" });
  const planUser = canonical(planPayload), extractUser = researchExtractionUserContent(extractPayload);
  const userContent = { plan: { on: planUser, off: planUser }, extract: { on: extractUser, off: extractUser },
    synthesis: { on: canonical(synthesisPayload), off: canonical({ ...synthesisPayload, lengthCap: { words: offCap.words } }) } };
  return {
    version: ROLE_SCHEMA_EXPORT_VERSION, generatedUtc, protocolSha256: researchProtocolSha256(),
    // Item 9: the table a flagged pipeline call sends (the same values as before), so P10 measures the schema item 9 sends.
    schemas: { plan: RESEARCH_ROLE_SCHEMAS.plan.schema, extract: RESEARCH_ROLE_SCHEMAS.extract.schema, synthesis: RESEARCH_ROLE_SCHEMAS.synthesis.schema },
    systems: { plan: PLAN_SYSTEM, extract: EXTRACT_SYSTEM, synthesis: SYNTHESIS_SYSTEM },
    outputTokens, thinking: THINKING,
    payloads: { plan: { userContent: planUser, units: units.map(u => u.id), sourceIds: inventory.sources.map(s => s.id) },
      extract: { userContent: extractUser }, synthesis: { userContent: userContent.synthesis.on } },
    requestSettings: servingCardRequestSettings(settings, true),
    requests: buildP10Requests(settings, userContent, outputTokens),
  };
}

function main(): number {
  let args: RoleSchemaExportArguments;
  try { args = parseRoleSchemaExportArguments(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }
  const out = resolve(args.out);
  // The desktop's own settings: the same parser, environment and env files the app reads.
  const data = buildRoleSchemaExport(undefined, requestSettingsOf(loadConfig()), { ...(args.planCap === undefined ? {} : { planCap: args.planCap }),
    ...(args.synthesisCap === undefined ? {} : { synthesisCap: args.synthesisCap }) });
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  writeFileSync(out, `${JSON.stringify(data, null, 1)}\n`, { mode: 0o600 });
  // The caps the bodies were built at come first after the hash, so the operator sees the plan cap before probing.
  process.stdout.write(`${JSON.stringify({ written: true, roles: Object.keys(data.schemas), protocolSha256: data.protocolSha256, outputTokens: data.outputTokens,
    schemaSha256: Object.fromEntries(P10_ROLES.map(role => [role, digest(canonical(data.schemas[role]))])), requestSettings: data.requestSettings,
    bodySha256: Object.fromEntries(P10_ROLES.map(role => [role, { on: data.requests[role].on.bodySha256, off: data.requests[role].off.bodySha256 }])) })}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = main();
