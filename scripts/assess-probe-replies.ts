/**
 * P10 assessor (backlog item 5, experiment E0): reads a probe JSON written by `scripts/serving-probe.py` (probe_version 2),
 * validates every retained P10 reply with the real zod schemas (the planner through assessResearchPlanReply, bound to the
 * synthetic units and source ids the probe sent; the extractor and synthesis through their reply schemas) and writes the
 * classification and the per-cell counts back into the probe JSON. The order is the probe's: request_rejected, truncated,
 * invalid_json, then schema_invalid, binding_invalid (planner only) or valid. It reads no endpoint, sends nothing and
 * prints counts only; reply text never leaves the ignored run directory.
 *
 *   pnpm probe:assess -- --probe .soar/experiments/serving-probe-<ts>/probe.json
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "../src/main/private-agent/contracts";
import { ResearchSynthesisSchema } from "../src/main/private-agent/research-coverage";
import { parseJsonReply } from "../src/main/private-agent/research-index";
import { assessResearchPlanReply } from "../src/main/private-agent/research-plan";
import { ExtractReplySchema, researchProtocolSha256 } from "../src/main/private-agent/research-pipeline";

export const P10_CLASSES = ["request_rejected", "truncated", "invalid_json", "schema_invalid", "binding_invalid", "valid", "unassessed"] as const;
export type P10Class = (typeof P10_CLASSES)[number];
export type P10Role = "plan" | "extract" | "synthesis";
export interface P10Call { ordinal: number; status: number; finish_reason?: string | null; classification: P10Class; reply_file?: string; body_sha256?: string; content_sha256?: string | null; codes?: string[]; [key: string]: unknown }
export interface P10Cell { role: P10Role; thinking: "on" | "off"; strict: boolean; max_tokens: number; calls: P10Call[]; counts: Record<string, unknown> }
export interface P10Binding { units: string[]; sourceIds: string[] }

const MAX_CODES = 16;

/** The verdict for one retained reply body; digests must match the probe's record or the file is not the reply. */
export function classifyRetainedReply(role: P10Role, body: Buffer, call: P10Call, binding: P10Binding): { classification: P10Class; codes: string[] } {
  if (call.body_sha256 !== digest(body)) throw new Error("p10_reply_body_digest_mismatch");
  let reply: unknown;
  try { reply = JSON.parse(body.toString("utf8")); } catch { throw new Error("p10_reply_body_not_json"); }
  const choices = (reply as { choices?: unknown }).choices;
  const message = Array.isArray(choices) && choices.length ? (choices[0] as { message?: { content?: unknown }; finish_reason?: unknown }).message : undefined;
  const content = message && typeof message.content === "string" ? message.content : undefined;
  if (content === undefined) return { classification: "invalid_json", codes: ["no_content"] };
  if (call.content_sha256 !== digest(content)) throw new Error("p10_reply_content_digest_mismatch");
  if (call.status !== 200) return { classification: "request_rejected", codes: [] };
  if (call.finish_reason === "length") return { classification: "truncated", codes: ["truncated"] };
  const decoded = parseJsonReply(content);
  if (decoded === undefined) return { classification: "invalid_json", codes: ["invalid_json"] };
  if (role === "plan") {
    const { attempt } = assessResearchPlanReply({ content, truncated: false, ordinal: 1, units: binding.units.map(id => ({ id })), sources: binding.sourceIds.map(id => ({ id })) });
    const codes = attempt.errors.map(error => error.code).slice(0, MAX_CODES);
    if (attempt.accepted) return { classification: "valid", codes };
    return { classification: attempt.bindingInspection === "completed" ? "binding_invalid" : "schema_invalid", codes };
  }
  const parsed = (role === "extract" ? ExtractReplySchema : ResearchSynthesisSchema).safeParse(decoded);
  // Only issue codes leave the schema check: never messages, paths beyond the schema, or reply values.
  return parsed.success ? { classification: "valid", codes: [] } : { classification: "schema_invalid", codes: parsed.error.issues.map(issue => issue.code).slice(0, MAX_CODES) };
}

export function countClasses(calls: readonly P10Call[]): Record<P10Class | "total", number> {
  const counts = Object.fromEntries(P10_CLASSES.map(name => [name, 0])) as Record<P10Class | "total", number>;
  for (const call of calls) counts[call.classification] = (counts[call.classification] ?? 0) + 1;
  counts.total = calls.length;
  return counts;
}

export interface AssessmentSummary { cells: Record<string, Record<string, number>>; schemasProtocolMatch: boolean; assessedUtc: string }

/** Rewrites the probe JSON in place (temporary file then rename) with every P10 call assessed. */
export function assessProbeFile(probePath: string, now = new Date().toISOString()): AssessmentSummary {
  const probe = JSON.parse(readFileSync(probePath, "utf8")) as { probe_version?: unknown; P10?: { binding?: P10Binding; cells?: Record<string, P10Cell>; schemas_protocol_sha256?: unknown; assessed?: unknown } };
  if (probe.probe_version !== 2) throw new Error("probe_version_2_required");
  const p10 = probe.P10;
  if (!p10 || !p10.cells || !p10.binding) throw new Error("probe_has_no_p10_section");
  const replyDir = join(dirname(probePath), "p10"), cells: Record<string, Record<string, number>> = {};
  for (const [key, cell] of Object.entries(p10.cells)) {
    for (const call of cell.calls) {
      if (!call.reply_file) continue;
      if (basename(call.reply_file) !== call.reply_file) throw new Error("p10_reply_file_name_invalid");
      const verdict = classifyRetainedReply(cell.role, readFileSync(join(replyDir, call.reply_file)), call, p10.binding);
      call.classification = verdict.classification; call.codes = verdict.codes;
    }
    cell.counts = { ...cell.counts, ...countClasses(cell.calls) };
    cells[key] = countClasses(cell.calls);
  }
  const protocolSha256 = researchProtocolSha256(), schemasProtocolMatch = p10.schemas_protocol_sha256 === protocolSha256;
  p10.assessed = { version: 1, assessedUtc: now, protocolSha256, schemasProtocolMatch, assessor: "scripts/assess-probe-replies.ts" };
  const temporary = `${probePath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(probe, null, 1)}\n`, { mode: 0o600 });
  renameSync(temporary, probePath);
  return { cells, schemasProtocolMatch, assessedUtc: now };
}

function main(): number {
  const index = process.argv.indexOf("--probe");
  const probePath = index >= 0 ? process.argv[index + 1] : undefined;
  if (!probePath) { process.stderr.write("usage: --probe <probe.json>\n"); return 2; }
  const summary = assessProbeFile(resolve(probePath));
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "assessment_failed"}\n`); process.exitCode = 2; }
}
