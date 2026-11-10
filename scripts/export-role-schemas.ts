/**
 * Role-schema export for probe P10 (backlog item 5, experiment E0): the planner, extractor and synthesis JSON schemas,
 * their system prompts, the role output caps and thinking policy, and one synthetic user payload per role, written to the
 * ignored `.soar/experiments/role-schemas.json` so `scripts/serving-probe.py` sends the pipeline's exact role requests
 * without duplicating any TypeScript value. The index role has no JSON schema and is not exported. Nothing here reads
 * the endpoint or sends a request; the payloads are invented text with no owner data.
 *
 *   pnpm probe:export-schemas [-- --out <path>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { canonical, digest } from "../src/main/private-agent/contracts";
import { ResearchCoverageSchema, ResearchEvidenceSchema, ResearchSynthesisSchema, deriveBriefUnits, inventoryResearchSources } from "../src/main/private-agent/research-coverage";
import { assembleIndexEntry, buildLiteralSourceCard } from "../src/main/private-agent/research-index";
import { RESEARCH_PLAN_JSON_SCHEMA, ResearchPlanSchema } from "../src/main/private-agent/research-plan";
import { EXTRACT_SYSTEM, OUTPUT_TOKENS, PLAN_SYSTEM, RESEARCH_EXTRACT_JSON_SCHEMA, RESEARCH_PIPELINE_BUDGET, SYNTHESIS_SYSTEM, THINKING, researchExtractionUserContent, researchProtocolSha256, synthesisLengthCap } from "../src/main/private-agent/research-pipeline";

export const ROLE_SCHEMA_EXPORT_VERSION = 1;
export const DEFAULT_ROLE_SCHEMAS_PATH = ".soar/experiments/role-schemas.json";
/** The roles with a reply JSON schema; the index role is validated structurally and has none. */
export const P10_ROLES = ["plan", "extract", "synthesis"] as const;
export type RoleWithSchema = (typeof P10_ROLES)[number];

export interface RoleSchemaExport {
  version: typeof ROLE_SCHEMA_EXPORT_VERSION;
  generatedUtc: string;
  protocolSha256: string;
  schemas: Record<RoleWithSchema, unknown>;
  systems: Record<RoleWithSchema, string>;
  outputTokens: typeof OUTPUT_TOKENS;
  thinking: typeof THINKING;
  payloads: { plan: { userContent: string; units: string[]; sourceIds: string[] }; extract: { userContent: string }; synthesis: { userContent: string } };
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

export function buildRoleSchemaExport(generatedUtc = new Date().toISOString()): RoleSchemaExport {
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
  const coverage = ResearchCoverageSchema.parse({ version: 2, protocolSha256: researchProtocolSha256(), briefSha256: digest(Buffer.from(brief)), briefBytes: Buffer.byteLength(brief),
    sourceManifestSha256: inventory.sourceManifestSha256, units, sources: inventory.sources,
    chunks: inventory.chunks.map(c => ({ ...c, status: "complete", attempts: [{ responseSha256: digest("synthetic extraction reply"), status: "complete" }],
      questions: plan.questions.map(q => ({ questionId: q.id, status: c.id === chunk.id && q.id === "Q1" ? "evidence_retained" : "no_verified_evidence", evidenceIds: c.id === chunk.id && q.id === "Q1" ? ["E1"] : [] })) })),
    omissions: [], conflictOmissions: [], unresolved: [], synthesis: { status: "pending", questions: [] }, fallbacks: { plan: "none", synthesis: "none" }, status: "incomplete", semanticAcceptance: "not_evaluated", corpusAbsenceEstablished: false });
  const planPayload = { authoritativeSchema: RESEARCH_PLAN_JSON_SCHEMA, brief, units, sourceIndex, mandatorySourceChunks: inventory.chunks.length, extractionCallBudget: RESEARCH_PIPELINE_BUDGET.extractionCalls, repair: null };
  // The pipeline's own builder (7b.1): the stable packet line, a newline, then the chunk line, exactly as every extraction call sends it.
  const extractPayload = { brief, units, plan, source: { id: chunkSource.id, sha256: chunk.sourceSha256 }, chunk: { id: chunk.id, startByte: chunk.startByte, endByte: chunk.endByte, text: chunkText }, repairReason: null };
  const synthesisPayload = { brief, units, plan, evidence, coverage, lengthCap: { words: synthesisLengthCap(brief).words }, repairReason: null };
  return {
    version: ROLE_SCHEMA_EXPORT_VERSION, generatedUtc, protocolSha256: researchProtocolSha256(),
    schemas: { plan: RESEARCH_PLAN_JSON_SCHEMA, extract: RESEARCH_EXTRACT_JSON_SCHEMA, synthesis: z.toJSONSchema(ResearchSynthesisSchema) },
    systems: { plan: PLAN_SYSTEM, extract: EXTRACT_SYSTEM, synthesis: SYNTHESIS_SYSTEM },
    outputTokens: OUTPUT_TOKENS, thinking: THINKING,
    payloads: { plan: { userContent: canonical(planPayload), units: units.map(u => u.id), sourceIds: inventory.sources.map(s => s.id) },
      extract: { userContent: researchExtractionUserContent(extractPayload) }, synthesis: { userContent: canonical(synthesisPayload) } },
  };
}

function main(): number {
  const outIndex = process.argv.indexOf("--out");
  const out = resolve(outIndex >= 0 && process.argv[outIndex + 1] ? process.argv[outIndex + 1]! : DEFAULT_ROLE_SCHEMAS_PATH);
  const data = buildRoleSchemaExport();
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  writeFileSync(out, `${JSON.stringify(data, null, 1)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ written: true, roles: Object.keys(data.schemas), protocolSha256: data.protocolSha256,
    schemaSha256: Object.fromEntries(P10_ROLES.map(role => [role, digest(canonical(data.schemas[role]))])) })}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = main();
