import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { canonical } from "../../src/main/private-agent/contracts";
import { ResearchSynthesisSchema, deriveBriefUnits } from "../../src/main/private-agent/research-coverage";
import { RESEARCH_PLAN_JSON_SCHEMA } from "../../src/main/private-agent/research-plan";
import { EXTRACT_SYSTEM, ExtractReplySchema, OUTPUT_TOKENS, PLAN_SYSTEM, RESEARCH_EXTRACT_JSON_SCHEMA, SYNTHESIS_SYSTEM, THINKING, researchProtocolSha256 } from "../../src/main/private-agent/research-pipeline";
import { P10_ROLES, buildRoleSchemaExport, syntheticRoleCorpus } from "../../scripts/export-role-schemas";

const ROOT = resolve(__dirname, "..", "..");
/** researchProtocolSha256() at 456344e, before PLAN_SYSTEM, OUTPUT_TOKENS, THINKING and the extraction schema were exported. */
const PROTOCOL_SHA256_BEFORE_EXPORTS = "3453710315d7226ea4d6195ec7401d000f86c5b0d9afa9839a801d5c6d391262";
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
    expect(data).toMatchObject({ version: 1, generatedUtc: "2026-11-08T00:00:00.000Z", protocolSha256: researchProtocolSha256() });
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
    const extract = JSON.parse(data.payloads.extract.userContent);
    expect(Object.keys(extract).sort()).toEqual(["brief", "chunk", "plan", "repairReason", "source", "units"]); expect(extract.chunk.text).toContain("orchard");
    const synthesis = JSON.parse(data.payloads.synthesis.userContent);
    expect(Object.keys(synthesis).sort()).toEqual(["brief", "coverage", "evidence", "plan", "repairReason", "units"]); expect(synthesis.coverage.chunks).toHaveLength(2);
    // Invented text only: no owner data, no address; the only URL is the JSON-schema dialect zod names in `$schema`.
    const serialized = JSON.stringify(data);
    expect(new Set(serialized.match(/https?:\/\/[^"\\\s]+/gu))).toEqual(new Set(["https://json-schema.org/draft/2020-12/schema"]));
    expect(serialized).not.toMatch(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/u);
  });

  it("keeps the research protocol hash at its pre-export value", () => {
    expect(researchProtocolSha256()).toBe(PROTOCOL_SHA256_BEFORE_EXPORTS);
  });

  it("writes the file from the command line with owner-only permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "soar-role-schemas-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const out = join(root, "nested", "role-schemas.json");
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "scripts/export-role-schemas.ts", "--out", out], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
    expect(JSON.parse(stdout)).toMatchObject({ written: true, roles: ["plan", "extract", "synthesis"], protocolSha256: PROTOCOL_SHA256_BEFORE_EXPORTS });
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const written = JSON.parse(readFileSync(out, "utf8")), expected = buildRoleSchemaExport(written.generatedUtc);
    expect(written).toEqual(JSON.parse(JSON.stringify(expected)));
  });
});
