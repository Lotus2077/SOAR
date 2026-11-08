import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { digest } from "../../src/main/private-agent/contracts";
import { researchProtocolSha256 } from "../../src/main/private-agent/research-pipeline";
import { assessProbeFile, classifyRetainedReply, countClasses, type P10Call } from "../../scripts/assess-probe-replies";
import { syntheticProbe } from "../helpers/serving-probe-fixture";

const ROOT = resolve(__dirname, "..", "..");
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const binding = { units: ["U1", "U2", "U3"], sourceIds: ["input/corpus/alpha.md", "input/corpus/beta.md"] };
const plan = (sourceIds: string[], requirementIds = ["U1", "U2", "U3"]) => JSON.stringify({ version: 2, questions: [{ id: "Q1", text: "What is established?", requirementIds, sourceIds, lookFor: [] }], conflictsToCheck: [], deliverableNotes: "" });
/** A retained reply body the way the probe writes one, with the call record that points at it. */
function retained(content: string, finish = "stop", status = 200): { body: Buffer; call: P10Call } {
  const body = Buffer.from(JSON.stringify({ model: "Synthetic", choices: [{ message: { content, reasoning_content: "thoughts" }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  return { body, call: { ordinal: 1, status, finish_reason: finish, classification: "unassessed", reply_file: "x.json", body_sha256: digest(body), content_sha256: digest(content) } };
}

describe("P10 assessor", () => {
  it("classifies retained replies with the real schemas in the probe's order and bounds the recorded codes", () => {
    const classify = (role: "plan" | "extract" | "synthesis", r: ReturnType<typeof retained>) => classifyRetainedReply(role, r.body, r.call, binding);
    expect(classify("plan", retained(plan(["input/corpus/alpha.md"])))).toEqual({ classification: "valid", codes: [] });
    expect(classify("plan", retained(plan(["input/corpus/unlisted.md"])))).toEqual({ classification: "binding_invalid", codes: ["unknown_source_id"] });
    expect(classify("plan", retained(plan([], ["U1"])))).toEqual({ classification: "binding_invalid", codes: ["omitted_requirement", "omitted_requirement"] });
    expect(classify("plan", retained(JSON.stringify({ version: 2, questions: [] })))).toEqual({ classification: "schema_invalid", codes: ["schema_size"] });
    expect(classify("plan", retained("Reply: not json"))).toEqual({ classification: "invalid_json", codes: ["invalid_json"] });
    expect(classify("plan", retained(plan([]).slice(0, 30), "length"))).toEqual({ classification: "truncated", codes: ["truncated"] });
    expect(classify("plan", retained(plan([]), "stop", 400))).toEqual({ classification: "request_rejected", codes: [] });
    const extract = JSON.stringify({ questions: [{ questionId: "Q1", status: "evidence_found" }], quotes: [{ quote: "twelve healthy trees in autumn", questionIds: ["Q1"] }], conflicts: [] });
    expect(classify("extract", retained(extract))).toEqual({ classification: "valid", codes: [] });
    expect(classify("extract", retained(JSON.stringify({ questions: [], quotes: [], conflicts: [], extra: 1 })))).toEqual({ classification: "schema_invalid", codes: expect.arrayContaining(["too_small", "unrecognized_keys"]) });
    const synthesis = JSON.stringify({ version: 1, argument: "## Conflicting evidence\n\n## Unanswered questions\n", questions: [{ questionId: "Q1", disposition: "unresolved", evidenceIds: [] }] });
    expect(classify("synthesis", retained(synthesis))).toEqual({ classification: "valid", codes: [] });
    expect(classify("synthesis", retained(JSON.stringify({ version: 2, argument: "", questions: [] })))).toEqual({ classification: "schema_invalid", codes: expect.arrayContaining(["invalid_value", "too_small"]) });
    const noContent = Buffer.from(JSON.stringify({ choices: [{ message: { tool_calls: [] }, finish_reason: "stop" }] }));
    expect(classify("plan", { body: noContent, call: { ordinal: 1, status: 200, finish_reason: "stop", classification: "unassessed", body_sha256: digest(noContent), content_sha256: null } })).toEqual({ classification: "invalid_json", codes: ["no_content"] });
    // A file whose digest differs from the record is not the retained reply.
    const r = retained(plan([]));
    expect(() => classifyRetainedReply("plan", r.body, { ...r.call, body_sha256: "0".repeat(64) }, binding)).toThrow("p10_reply_body_digest_mismatch");
    expect(() => classifyRetainedReply("plan", r.body, { ...r.call, content_sha256: "0".repeat(64) }, binding)).toThrow("p10_reply_content_digest_mismatch");
    expect(() => classifyRetainedReply("plan", Buffer.from("x"), { ...r.call, body_sha256: digest("x") }, binding)).toThrow("p10_reply_body_not_json");
  });

  it("rewrites the probe JSON with every cell assessed, counts per class, and the protocol match", () => {
    const run = mkdtempSync(join(tmpdir(), "soar-assess-")); cleanups.push(() => rmSync(run, { recursive: true, force: true }));
    mkdirSync(join(run, "p10"));
    const replies = { "plan-on-strict-01.json": retained(plan(["input/corpus/alpha.md"])), "plan-on-strict-02.json": retained(plan(["input/corpus/unlisted.md"])), "plan-on-strict-03.json": retained("{}".slice(0, 1), "length"),
      "extract-off-strict-01.json": retained(JSON.stringify({ questions: [{ questionId: "Q1", status: "no_verified_evidence" }], quotes: [], conflicts: [] })), "extract-off-strict-02.json": retained("prose only") };
    for (const [name, { body }] of Object.entries(replies)) writeFileSync(join(run, "p10", name), body);
    const call = (name: string, ordinal: number) => ({ ...replies[name as keyof typeof replies]!.call, ordinal, reply_file: name });
    const probe = { ...syntheticProbe(), P10: { ...syntheticProbe().P10, schemas_protocol_sha256: researchProtocolSha256(), cells: {
      "plan/on": { role: "plan", thinking: "on", strict: true, max_tokens: 8192, calls: [call("plan-on-strict-01.json", 1), call("plan-on-strict-02.json", 2), call("plan-on-strict-03.json", 3), { ordinal: 4, status: 400, classification: "request_rejected", error_bytes: 12, error_sha256: "a".repeat(64) }],
        counts: { total: 4, unassessed: 3, request_rejected: 1, median_elapsed_s: 9.5, thinking_on_zero_reasoning: 2 } },
      "extract/off": { role: "extract", thinking: "off", strict: true, max_tokens: 2048, calls: [call("extract-off-strict-01.json", 1), call("extract-off-strict-02.json", 2)], counts: { total: 2, unassessed: 2 } } } } };
    delete (probe.P10 as { assessed?: unknown }).assessed;
    const path = join(run, "probe.json"); writeFileSync(path, JSON.stringify(probe));
    const summary = assessProbeFile(path, "2026-11-08T12:00:00.000Z");
    expect(summary).toEqual({ assessedUtc: "2026-11-08T12:00:00.000Z", schemasProtocolMatch: true,
      cells: { "plan/on": { request_rejected: 1, truncated: 1, invalid_json: 0, schema_invalid: 0, binding_invalid: 1, valid: 1, unassessed: 0, total: 4 }, "extract/off": { request_rejected: 0, truncated: 0, invalid_json: 1, schema_invalid: 0, binding_invalid: 0, valid: 1, unassessed: 0, total: 2 } } });
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.P10.cells["plan/on"].calls.map((c: P10Call) => c.classification)).toEqual(["valid", "binding_invalid", "truncated", "request_rejected"]);
    expect(written.P10.cells["plan/on"].calls[1].codes).toEqual(["unknown_source_id"]);
    // Existing timing and reasoning counts survive; only the class counts are rewritten.
    expect(written.P10.cells["plan/on"].counts).toMatchObject({ median_elapsed_s: 9.5, thinking_on_zero_reasoning: 2, valid: 1, unassessed: 0, total: 4 });
    expect(written.P10.assessed).toEqual({ version: 1, assessedUtc: "2026-11-08T12:00:00.000Z", protocolSha256: researchProtocolSha256(), schemasProtocolMatch: true, assessor: "scripts/assess-probe-replies.ts" });
    expect(JSON.stringify(written)).not.toContain("thoughts");
    // Refusals: a version 1 probe, a probe without P10, and a reply file name that leaves the run directory.
    writeFileSync(join(run, "v1.json"), JSON.stringify({ ...probe, probe_version: 1 }));
    expect(() => assessProbeFile(join(run, "v1.json"))).toThrow("probe_version_2_required");
    writeFileSync(join(run, "nop10.json"), JSON.stringify({ probe_version: 2 }));
    expect(() => assessProbeFile(join(run, "nop10.json"))).toThrow("probe_has_no_p10_section");
    const escaped = JSON.parse(JSON.stringify(probe)); escaped.P10.cells["plan/on"].calls[0].reply_file = "../p10/plan-on-strict-01.json";
    writeFileSync(join(run, "escape.json"), JSON.stringify(escaped));
    expect(() => assessProbeFile(join(run, "escape.json"))).toThrow("p10_reply_file_name_invalid");
    expect(countClasses([])).toMatchObject({ total: 0, valid: 0 });
    // The command line prints counts only.
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "scripts/assess-probe-replies.ts", "--probe", path], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
    expect(JSON.parse(stdout)).toMatchObject({ schemasProtocolMatch: true, cells: { "plan/on": { valid: 1 } } }); expect(stdout).not.toContain(run);
  });
});
