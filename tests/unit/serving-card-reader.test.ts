import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { LocalTokenAdmissionError, pinned } from "../../src/main/private-agent/flash-next-admission";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { OUTPUT_TOKENS, THINKING } from "../../src/main/private-agent/research-pipeline";
import { DEFAULT_RESEARCH_ROLE_POLICY, RESEARCH_ROLES, STRUCTURED_OUTPUT_ROLES, nonDefaultRoleParameters, type ResearchRolePolicy } from "../../src/main/private-agent/research-roles";
import { DEFAULT_SERVING_POLICY, P10_RULE, RESEARCH_ROLE_MAX_OUTPUT_TOKENS, SERVING_CARD_CODES, SERVING_CARD_CONSUMED, SERVING_CARD_PARAMETER_PATHS,
  ServingCardError, currentRoleSchemaSha256, isServingCardParameterPath, loadServingCard, nonDefaultParameters, parseServingCard, servingCardFreeze,
  servingCardRefusal, type ServingCardCode, type ServingCardExpectation, type ServingCardRequestSettings, type ServingCardV1 } from "../../src/main/private-agent/serving-card";
import { buildRoleSchemaExport } from "../../scripts/export-role-schemas";
import { failureCode } from "../../scripts/phase4-loop";
import { ADOPTING_ENTRY, PYTHON_TIMEOUT_MS, SERVING_CARD_WRITER, adopt, proposedServingCard, writeCard } from "../helpers/serving-card-fixture";
import { SYNTHETIC_P10_REQUEST_SETTINGS } from "../helpers/serving-probe-fixture";

const PROBE_SCRIPT = resolve(__dirname, "..", "..", "scripts", "serving-probe.py");
const ALIAS = "RM-01 VLM";
/** The run's settings equal the ones the synthetic P10 recorded (BL-20261114-1734-serving-card-request-settings-design). */
const EXPECT: ServingCardExpectation = { model: ALIAS, requestSettings: { ...SYNTHETIC_P10_REQUEST_SETTINGS } };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
function workspace(): string { const root = mkdtempSync(join(tmpdir(), "soar-card-reader-")); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; }

let writerCard: ServingCardV1 | undefined;
/** The writer's proposed card for the current synthetic probe, written once and copied per use. */
const proposed = (): ServingCardV1 => structuredClone(writerCard ??= proposedServingCard());
const allDefault = (): ServingCardV1 => adopt(proposed(), ADOPTING_ENTRY, { defaults: true });
/** An adopted all-default card edited by `edit` (typed loosely: the edits make it invalid on purpose). */
function edited(edit: (card: any) => void, base: () => ServingCardV1 = allDefault): ServingCardV1 { const card = base(); edit(card); return card; }
const flag = (role: "plan" | "extract" | "synthesis", thinkingOff: boolean, thinkingOn: boolean, variant = "strict") =>
  (card: any) => { card.roles[role].structuredOutput = { variant, thinkingOff, thinkingOn }; };
function refusal(run: () => unknown): ServingCardError {
  try { run(); } catch (error) { if (error instanceof ServingCardError) return error; throw error; }
  throw new Error("expected a ServingCardError");
}
const loadFrom = (card: unknown, expectation: ServingCardExpectation = EXPECT) => (dir: string) => loadServingCard(writeCard(dir, card), expectation);
/** The adopted all-default card as the writer formats it, with `edit` applied to its text (which must change it). */
function editedText(edit: (text: string) => string): Buffer {
  const text = `${JSON.stringify(allDefault(), null, 2)}\n`, changed = edit(text);
  if (changed === text) throw new Error("the text edit did not apply");
  return Buffer.from(changed);
}

describe("serving-card reader (SC)", () => {
  it("R1: round-trips the writer's card: proposed is refused, adopted as written is refused as unconsumed, adopted all-default is accepted", () => {
    const card = proposed(), dir = workspace();
    expect(card.decision).toEqual({ status: "proposed", entry: null });
    expect(refusal(() => loadFrom(card)(dir))).toMatchObject({ code: "serving_card_not_adopted", parameter: "decision" });
    // The writer's proposal passes every evidence gate (plan/on 19/20, extract 20/20, synthesis/off 19/20) and stops at the fail-closed step.
    expect(refusal(() => loadServingCard(writeCard(dir, adopt(card), "adopted.json"), EXPECT)))
      .toMatchObject({ code: "serving_card_parameter_unconsumed", parameter: "roles.plan.structuredOutput" });
    const written = writeCard(dir, allDefault(), "all-default.json"), loaded = loadServingCard(written, EXPECT);
    expect(loaded.policy).toEqual(DEFAULT_SERVING_POLICY);
    expect(loaded.sha256).toBe(written.sha256);
    expect(loaded.bytes.equals(readFileSync(written.path))).toBe(true);
    expect(loaded).toMatchObject({ version: 1, date: "2026-11-08", entry: ADOPTING_ENTRY, identity: card.identity, evidence: card.evidence });
    expect(Object.keys(loaded).sort()).toEqual(["bytes", "date", "entry", "evidence", "identity", "policy", "sha256", "version"]);
    expect(Object.isFrozen(loaded) && Object.isFrozen(loaded.policy.roles.plan.maxOutputTokens) && Object.isFrozen(loaded.evidence.p10)).toBe(true);
    expect(JSON.stringify({ ...loaded, bytes: null })).not.toContain(dir);
    // The context is compared only under flash_next_v1 (an expectation without contextTokens).
    expect(loadServingCard(written, { ...EXPECT, contextTokens: 262_144 }).policy).toEqual(DEFAULT_SERVING_POLICY);
    // A card of exactly 64 KiB is read; one byte more is refused (R2).
    const padded = Buffer.concat([readFileSync(written.path), Buffer.alloc(64 * 1024 - readFileSync(written.path).length, 0x20)]);
    expect(loadServingCard(writeCard(dir, padded, "padded.json"), EXPECT).policy).toEqual(DEFAULT_SERVING_POLICY);
  });

  const CASES: [ServingCardCode, string, (dir: string) => unknown, string?][] = [
    ["serving_card_pin_drift", "a wrong sha256", dir => loadServingCard({ path: writeCard(dir, allDefault()).path, sha256: "0".repeat(64) }, EXPECT)],
    ["serving_card_pin_drift", "a symlink", dir => { const written = writeCard(dir, allDefault()), link = join(dir, "link.json"); symlinkSync(written.path, link);
      return loadServingCard({ path: link, sha256: written.sha256 }, EXPECT); }],
    ["serving_card_pin_drift", "65,537 bytes", dir => { const bytes = Buffer.from(`${JSON.stringify(allDefault(), null, 2)}\n`);
      return loadServingCard(writeCard(dir, Buffer.concat([bytes, Buffer.alloc(65_537 - bytes.length, 0x20)])), EXPECT); }],
    ["serving_card_pin_drift", "a missing file", dir => loadServingCard({ path: join(dir, "absent.json"), sha256: "a".repeat(64) }, EXPECT)],
    ["serving_card_pin_drift", "a FIFO", dir => { const fifo = join(dir, "card.fifo"); execFileSync("mkfifo", [fifo]); return loadServingCard({ path: fifo, sha256: "a".repeat(64) }, EXPECT); }],
    // A relative path to a card that exists and matches its digest: only the absolute-path check can refuse it.
    ["serving_card_pin_drift", "a relative path", dir => { const written = writeCard(dir, allDefault());
      return loadServingCard({ path: relative(process.cwd(), written.path), sha256: written.sha256 }, EXPECT); }],
    ["serving_card_version_unsupported", "version 2", loadFrom(edited(card => { card.version = 2; }))],
    ["serving_card_invalid", "not JSON", dir => loadServingCard(writeCard(dir, Buffer.from("{\"kind\": \"soar_serving_card\",")), EXPECT)],
    ["serving_card_invalid", "not UTF-8", dir => loadServingCard(writeCard(dir, Buffer.from([0x7b, 0xff, 0x7d])), EXPECT)],
    ["serving_card_invalid", "a wrong kind", loadFrom(edited(card => { card.kind = "soar_other_card"; card.version = 2; }))],
    ["serving_card_invalid", "an extra key", loadFrom(edited(card => { card.reviewedBy = "owner"; }))],
    ["serving_card_invalid", "an extra nested key", loadFrom(edited(card => { card.evidence.p11.kStreams["8"].note = "fine"; }))],
    ["serving_card_invalid", "a __proto__ key", dir => loadServingCard(writeCard(dir, Buffer.from(JSON.stringify(allDefault()).replace(/^\{/u, "{\"__proto__\":{},"))), EXPECT)],
    // JSON.parse keeps a repeated key's last value: the earlier one would look in force to a reviewer, and the kept bytes would hold it unvalidated.
    ["serving_card_invalid", "a duplicate decision key", dir => loadServingCard(writeCard(dir, editedText(text => text.replace(/^\{/u,
      "{\n  \"decision\": {\"status\": \"proposed\", \"entry\": null},"))), EXPECT)],
    ["serving_card_invalid", "a duplicate identity.servedModel", dir => loadServingCard(writeCard(dir, editedText(text => text.replace(`"servedModel": "${ALIAS}"`,
      `"servedModel": "/synthetic/models/private-finetune", "servedModel": "${ALIAS}"`))), EXPECT)],
    ["serving_card_invalid", "a duplicate key spelled with an escape", dir => loadServingCard(writeCard(dir, editedText(text => text.replace(`"servedModel": "${ALIAS}"`,
      `"servedModel": "${ALIAS}", "served\\u004dodel": "${ALIAS}"`))), EXPECT)],
    ["serving_card_invalid", "a missing key", loadFrom(edited(card => { delete card.admission; }))],
    ["serving_card_invalid", "counts that do not sum", loadFrom(edited(card => { card.evidence.p10.cells["plan/on"].valid = 20; }))],
    ["serving_card_invalid", "both structured-output flags false", loadFrom(edited(flag("plan", false, false)))],
    ["serving_card_invalid", "an entry BL-1", loadFrom(adopt(proposed(), "BL-1", { defaults: true }))],
    ["serving_card_invalid", "structuredOutput on index", loadFrom(edited(card => { card.roles.index.structuredOutput = null; }))],
    ["serving_card_invalid", "a cap of 0", loadFrom(edited(card => { card.roles.index.maxOutputTokens = [0, 1536]; }))],
    ["serving_card_invalid", "one attempt only", loadFrom(edited(card => { card.roles.plan.thinking = ["model"]; }))],
    ["serving_card_invalid", "servedModel /home/x/m", loadFrom(edited(card => { card.identity.servedModel = "/home/x/m"; }), { ...EXPECT, model: "/home/x/m" })],
    ["serving_card_invalid", "schemasProtocolMatch true with differing hashes", loadFrom(edited(card => { card.evidence.p10.assessed.protocolSha256 = "1".repeat(64); }))],
    ["serving_card_invalid", "17 kStreams keys", loadFrom(edited(card => {
      for (let k = 9; Object.keys(card.evidence.p11.kStreams).length < 17; k++) card.evidence.p11.kStreams[String(k)] = { ...card.evidence.p11.kStreams["1"], streams: k };
    }))],
    ["serving_card_invalid", "a calendar-invalid date", loadFrom(edited(card => { card.date = "2026-02-30"; }))],
    ["serving_card_not_adopted", "proposed", loadFrom(proposed())],
    ["serving_card_not_adopted", "adopted with a null entry", loadFrom(adopt(proposed(), null, { defaults: true }))],
    ["serving_card_model_mismatch", "another alias", loadFrom(allDefault(), { ...EXPECT, model: "another-model" }), "identity.servedModel"],
    ["serving_card_context_mismatch", "another context under flash_next_v1", loadFrom(allDefault(), { ...EXPECT, contextTokens: 131_072 }), "identity.contextTokens"],
    ["serving_card_context_mismatch", "no context in the card under flash_next_v1", loadFrom(edited(card => { card.identity.contextTokens = null; }), { ...EXPECT, contextTokens: 262_144 })],
    ["serving_card_cap_out_of_range", "127", loadFrom(edited(card => { card.roles.extract.maxOutputTokens = [2048, 127]; })), "roles.extract.maxOutputTokens[1]"],
    ["serving_card_cap_out_of_range", "16,385", loadFrom(edited(card => { card.roles.plan.maxOutputTokens = [16_385, 8192]; })), "roles.plan.maxOutputTokens[0]"],
    ["serving_card_structured_output_unassessed", "p10 null", loadFrom(edited(card => { flag("extract", true, false)(card); card.evidence.p10 = null; })), "roles.extract.structuredOutput.thinkingOff"],
    ["serving_card_structured_output_unassessed", "assessed null", loadFrom(edited(card => { flag("extract", true, false)(card); card.evidence.p10.assessed = null; }))],
    ["serving_card_structured_output_unassessed", "the cell absent", loadFrom(edited(card => { flag("extract", true, false)(card); delete card.evidence.p10.cells["extract/off"]; }))],
    ["serving_card_structured_output_unassessed", "unassessed 1", loadFrom(edited(card => { flag("extract", true, false)(card);
      Object.assign(card.evidence.p10.cells["extract/off"], { valid: 19, unassessed: 1 }); }))],
    ["serving_card_p10_protocol_drift", "the export and assessor hashes set to another protocol", loadFrom(edited(card => { flag("extract", true, false)(card);
      card.evidence.p10.protocolSha256 = "1".repeat(64); card.evidence.p10.assessed.protocolSha256 = "1".repeat(64); })), "roles.extract.structuredOutput.thinkingOff"],
    ["serving_card_p10_protocol_drift", "only the assessor's hash on another protocol", loadFrom(edited(card => { flag("extract", true, false)(card);
      card.evidence.p10.assessed = { protocolSha256: "1".repeat(64), schemasProtocolMatch: false }; }))],
    ["serving_card_schema_drift", "schemaSha256.plan changed", loadFrom(edited(card => { flag("plan", false, true)(card); card.evidence.p10.schemaSha256.plan = "1".repeat(64); })),
      "roles.plan.structuredOutput.thinkingOn"],
    ["serving_card_structured_output_variant_mismatch", "a non_strict flag while strict was requested", loadFrom(edited(flag("extract", true, false, "non_strict")))],
    ["serving_card_structured_output_variant_mismatch", "a strict flag on a cell that ran non_strict", loadFrom(edited(card => { flag("extract", true, false)(card);
      card.evidence.p10.cells["extract/off"].variant = "non_strict"; }))],
    ["serving_card_structured_output_below_rule", "18/20", loadFrom(edited(flag("synthesis", false, true))), "roles.synthesis.structuredOutput.thinkingOn"],
    ["serving_card_structured_output_below_rule", "19/19", loadFrom(edited(card => { flag("extract", true, false)(card); Object.assign(card.evidence.p10.cells["extract/off"], { total: 19, valid: 19 }); }))],
    ["serving_card_streams_unproven", "K 4 with no burst", loadFrom(edited(card => { card.concurrency.localStreams = 4; delete card.evidence.p11.kStreams["4"]; })), "concurrency.localStreams"],
    ["serving_card_streams_unproven", "one error", loadFrom(edited(card => { card.concurrency.localStreams = 4; card.evidence.p11.kStreams["4"].errors = 1; }))],
    ["serving_card_streams_unproven", "3 streams", loadFrom(edited(card => { card.concurrency.localStreams = 4; card.evidence.p11.kStreams["4"].streams = 3; }))],
    ["serving_card_streams_unproven", "K 2 without P11", loadFrom(edited(card => { card.concurrency.localStreams = 2; card.evidence.p11 = null; card.evidence.bounds = null; }))],
    ["serving_card_parameter_unconsumed", "caps", loadFrom(edited(card => { card.roles.plan.maxOutputTokens = [4096, 8192]; })), "roles.plan.maxOutputTokens"],
    ["serving_card_parameter_unconsumed", "thinking", loadFrom(edited(card => { card.roles.plan.thinking = ["disabled", "model"]; })), "roles.plan.thinking"],
    ["serving_card_parameter_unconsumed", "structured output", loadFrom(edited(flag("extract", true, true))), "roles.extract.structuredOutput"],
    ["serving_card_parameter_unconsumed", "K", loadFrom(edited(card => { card.concurrency.localStreams = 4; })), "concurrency.localStreams"],
    ["serving_card_p10_settings_drift", "a run without the cache salt P10's bodies carried", loadFrom(edited(flag("extract", true, false)),
      { ...EXPECT, requestSettings: { ...SYNTHETIC_P10_REQUEST_SETTINGS, cacheSalt: false } }), "roles.extract.structuredOutput.thinkingOff"],
    // #111's review: under the same Flash contract, the context alone differs.
    ["serving_card_p10_settings_drift", "another context under the same Flash contract", loadFrom(edited(card => { flag("extract", true, false)(card);
      card.evidence.p10.requestSettings = { ...SYNTHETIC_P10_REQUEST_SETTINGS, localReplyContract: "flash_next_v1", localContextTokens: 262_144 }; }),
    { ...EXPECT, requestSettings: { ...SYNTHETIC_P10_REQUEST_SETTINGS, localReplyContract: "flash_next_v1", localContextTokens: 131_072 } }), "roles.extract.structuredOutput.thinkingOff"],
    ["serving_card_parameter_unconsumed", "admission", loadFrom(edited(card => { card.admission.basis = "serving_card"; })), "admission.basis"],
  ];

  it.each(CASES)("R2: %s for %s", (code, _label, run, parameter) => {
    const dir = workspace(), error = refusal(() => run(dir));
    expect(error).toBeInstanceOf(ServingCardError);
    expect(error.code).toBe(code); expect(error.message).toBe(code);
    expect(error.message).not.toContain(dir); expect(error.message).not.toContain(ALIAS);
    if (error.parameter !== undefined) expect(isServingCardParameterPath(error.parameter)).toBe(true);
    if (["serving_card_pin_drift", "serving_card_version_unsupported", "serving_card_invalid"].includes(code)) expect(error.parameter).toBeUndefined();
    else expect(error.parameter).toBeDefined();
    if (parameter !== undefined) expect(error.parameter).toBe(parameter);
  });

  it("R2 since BL-20261114-1734-serving-card-request-settings-design: a structured-output flag needs P10's request settings to be the run's; a card without flags does not", () => {
    // Under the run's settings, the writer's card reaches today's fail-closed step: structured output is not consumed on this branch.
    const writer = adopt(proposed());
    expect(writer.evidence.p10!.requestSettings).toEqual(SYNTHETIC_P10_REQUEST_SETTINGS);
    expect(refusal(() => loadFrom(writer)(workspace()))).toMatchObject({ code: "serving_card_parameter_unconsumed", parameter: "roles.plan.structuredOutput" });
    // Each setting P10's bodies were built under, changed on the run's side, refuses the first flagged mode (plan's thinking-on cell).
    const changes: Partial<ServingCardRequestSettings>[] = [{ model: "another-model" }, { streaming: false }, { localReplyContract: "flash_next_v1", localContextTokens: 262_144 },
      { cacheSalt: false }];
    for (const change of changes) {
      expect(refusal(() => loadFrom(writer, { ...EXPECT, requestSettings: { ...SYNTHETIC_P10_REQUEST_SETTINGS, ...change } })(workspace())))
        .toMatchObject({ code: "serving_card_p10_settings_drift", parameter: "roles.plan.structuredOutput.thinkingOn" });
    }
    // A card that records none (an earlier writer, or a probe before P10-align) binds no flag.
    for (const record of [null, undefined]) {
      const without = edited(card => { if (record === undefined) delete card.evidence.p10.requestSettings; else card.evidence.p10.requestSettings = null; }, () => adopt(proposed()));
      expect(refusal(() => loadFrom(without)(workspace()))).toMatchObject({ code: "serving_card_p10_settings_drift", parameter: "roles.plan.structuredOutput.thinkingOn" });
    }
    // A card without flags resolves under other settings: P10's evidence backs nothing else.
    expect(loadFrom(allDefault(), { ...EXPECT, requestSettings: { ...SYNTHETIC_P10_REQUEST_SETTINGS, streaming: false, cacheSalt: false } })(workspace()).policy)
      .toEqual(DEFAULT_SERVING_POLICY);
    // The record is strict: an unknown key, or a reply contract without its context, is invalid.
    expect(refusal(() => loadFrom(edited(card => { card.evidence.p10.requestSettings = { ...SYNTHETIC_P10_REQUEST_SETTINGS, endpoint: "x" }; }))(workspace())).code).toBe("serving_card_invalid");
    expect(refusal(() => loadFrom(edited(card => { card.evidence.p10.requestSettings = { ...SYNTHETIC_P10_REQUEST_SETTINGS, localReplyContract: "flash_next_v1" }; }))(workspace())).code)
      .toBe("serving_card_invalid");
  });
  it("R2: the table covers every refusal code, and a key path outside the allowlist never reaches an error", () => {
    expect(new Set(CASES.map(([code]) => code))).toEqual(new Set(SERVING_CARD_CODES));
    expect(SERVING_CARD_CODES).toHaveLength(15);
    for (const code of SERVING_CARD_CODES) expect(code).toMatch(/^[a-z0-9_]{1,79}$/u);
    expect(new ServingCardError("serving_card_invalid", "/synthetic/operator/serving-card.json").parameter).toBeUndefined();
    expect(new ServingCardError("serving_card_not_adopted", "decision").parameter).toBe("decision");
    // The allowlist is a frozen array, and the lookup behind the predicate is private, so no importer can extend it.
    expect(Object.isFrozen(SERVING_CARD_PARAMETER_PATHS)).toBe(true);
    expect(() => (SERVING_CARD_PARAMETER_PATHS as string[]).push("/synthetic/operator")).toThrow(TypeError);
    expect(isServingCardParameterPath("/synthetic/operator")).toBe(false); expect(isServingCardParameterPath(undefined)).toBe(false);
    expect(SERVING_CARD_PARAMETER_PATHS.every(isServingCardParameterPath)).toBe(true);
    for (const path of SERVING_CARD_PARAMETER_PATHS) expect(path).toMatch(/^[a-z]+(?:\.[a-zA-Z]+)*(?:\[[01]\])?$/u);
    // A printed refusal re-checks the code and the key path, so a value written onto the error after construction is never printed.
    const tampered = new ServingCardError("serving_card_not_adopted", "decision");
    (tampered as { parameter?: string }).parameter = "/synthetic/operator/serving-card.json";
    expect(servingCardRefusal(tampered)).toEqual({ code: "serving_card_not_adopted" });
    const recoded = new ServingCardError("serving_card_invalid"); (recoded as { code: string }).code = "/synthetic/operator";
    expect(servingCardRefusal(recoded)).toBeUndefined();
    expect(servingCardRefusal(new ServingCardError("serving_card_cap_out_of_range", "roles.plan.maxOutputTokens[0]")))
      .toEqual({ code: "serving_card_cap_out_of_range", parameter: "roles.plan.maxOutputTokens[0]" });
    expect(servingCardRefusal(new Error("serving_card_invalid"))).toBeUndefined();
  });

  it("R2: the pinned read refuses a FIFO without blocking, for the token admission too", () => {
    const dir = workspace(), fifo = join(dir, "policy.fifo"); execFileSync("mkfifo", [fifo]);
    expect(() => pinned(fifo, "a".repeat(64))).toThrow(LocalTokenAdmissionError);
    try { pinned(fifo, "a".repeat(64)); } catch (error) { expect((error as LocalTokenAdmissionError).code).toBe("local_token_admission_pin_drift"); }
    const written = writeCard(dir, allDefault());
    expect(pinned(written.path, written.sha256).equals(readFileSync(written.path))).toBe(true);
    // A relative path to the same file, with the right digest, is refused by the absolute-path check alone.
    expect(() => pinned(relative(process.cwd(), written.path), written.sha256)).toThrow(LocalTokenAdmissionError);
  });

  it("R4: the defaults are today's OUTPUT_TOKENS and THINKING on both attempts, every flag is false and the rule matches the writer", () => {
    for (const role of RESEARCH_ROLES) {
      expect(DEFAULT_RESEARCH_ROLE_POLICY[role].maxOutputTokens).toEqual([OUTPUT_TOKENS[role], OUTPUT_TOKENS[role]]);
      expect(DEFAULT_RESEARCH_ROLE_POLICY[role].thinking).toEqual([THINKING[role], THINKING[role]]);
    }
    expect(DEFAULT_RESEARCH_ROLE_POLICY.index).not.toHaveProperty("structuredOutput");
    for (const role of STRUCTURED_OUTPUT_ROLES) expect(DEFAULT_RESEARCH_ROLE_POLICY[role].structuredOutput).toBeNull();
    expect(Object.isFrozen(DEFAULT_RESEARCH_ROLE_POLICY.plan.maxOutputTokens) && Object.isFrozen(DEFAULT_SERVING_POLICY.admission)).toBe(true);
    expect(DEFAULT_SERVING_POLICY).toEqual({ roles: DEFAULT_RESEARCH_ROLE_POLICY, localStreams: 1, admission: { basis: "none" } });
    // Each flip is a reviewed edit of this pin, in the consumer PR that applies the value: 7(a), 9, 8 and 7(b).
    expect(SERVING_CARD_CONSUMED).toEqual({ maxOutputTokens: false, thinking: false, structuredOutput: false, localStreams: false, admission: false });
    const writer = JSON.parse(execFileSync("python3", ["-I", "-c", ["import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('serving_card', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
      "print(json.dumps({'minCalls': module.P10_MIN_CALLS, 'minValidPercent': module.P10_RULE_PERCENT}))"].join("\n"), SERVING_CARD_WRITER],
    { encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, timeout: PYTHON_TIMEOUT_MS }));
    expect(writer).toEqual({ minCalls: P10_RULE.minCalls, minValidPercent: P10_RULE.minValidPercent });
    expect(RESEARCH_ROLE_MAX_OUTPUT_TOKENS).toBe(COORDINATOR_PROFILES.heavy.maxOutputTokens);
    const roles = structuredClone(DEFAULT_RESEARCH_ROLE_POLICY) as ResearchRolePolicy;
    roles.plan.thinking = ["disabled", "model"]; roles.synthesis.maxOutputTokens = [8192, 4096]; roles.extract.structuredOutput = { variant: "strict", thinkingOff: true, thinkingOn: false };
    const policy = { roles, localStreams: 4, admission: { basis: "serving_card" as const } };
    expect(nonDefaultRoleParameters(roles)).toEqual([{ parameter: "thinking", at: "roles.plan.thinking" }, { parameter: "structuredOutput", at: "roles.extract.structuredOutput" },
      { parameter: "maxOutputTokens", at: "roles.synthesis.maxOutputTokens" }]);
    expect(nonDefaultParameters(policy)).toEqual([...nonDefaultRoleParameters(roles), { parameter: "localStreams", at: "concurrency.localStreams" },
      { parameter: "admission", at: "admission.basis" }]);
    expect(nonDefaultParameters(DEFAULT_SERVING_POLICY)).toEqual([]);
    for (const { at } of nonDefaultParameters(policy)) expect(isServingCardParameterPath(at)).toBe(true);
  });

  it("R5: the reader's role-schema digests equal the export's and the probe's canonical_json digests", () => {
    const schemas = buildRoleSchemaExport("2026-11-08T00:00:00.000Z").schemas, current = currentRoleSchemaSha256();
    // The schemas go through a file, as the probe reads its role-schemas.json, never through stdin.
    const input = join(workspace(), "role-schemas.json"); writeFileSync(input, JSON.stringify(schemas, null, 1));
    const probe = JSON.parse(execFileSync("python3", ["-I", "-c", ["import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('serving_probe', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
      "schemas = json.load(open(sys.argv[2], encoding='utf-8'))",
      "print(json.dumps({role: {'canonical': module.canonical_json(schema), 'sha256': module.sha256_text(module.canonical_json(schema))} for role, schema in schemas.items()}))"].join("\n"),
    PROBE_SCRIPT, input], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, timeout: PYTHON_TIMEOUT_MS }));
    for (const role of STRUCTURED_OUTPUT_ROLES) {
      expect(current[role]).toBe(digest(canonical(schemas[role])));
      expect(probe[role].sha256).toBe(current[role]);
      expect(probe[role].canonical).toBe(canonical(schemas[role]));
    }
  });

  it("R7: the freeze fragment is empty without a card and holds the digest, version, date and entry, never the path, with one", () => {
    expect(servingCardFreeze(undefined)).toEqual({});
    const dir = workspace(), written = writeCard(dir, allDefault()), fragment = servingCardFreeze(loadServingCard(written, EXPECT));
    expect(fragment).toEqual({ servingCard: { sha256: written.sha256, version: 1, date: "2026-11-08", entry: ADOPTING_ENTRY } });
    expect(canonical(fragment)).not.toContain(written.path); expect(canonical(fragment)).not.toContain(dir);
  });

  const drop = (probe: Record<string, any>, name: string, state: "skipped" | "failed") => {
    probe.probes_run = probe.probes_run.filter((item: string) => item !== name); delete probe[name];
    if (state === "skipped") probe.probes_skipped.push(name); else probe.probes_failed[name] = "URLError";
  };
  const EDGE_PROBES: [string, (probe: Record<string, any>) => void, (card: ServingCardV1) => void][] = [
    ...(["P10", "P11", "adapter"] as const).flatMap(name => (["skipped", "failed"] as const).map(state => [`${name} ${state}`, (probe: Record<string, any>) => drop(probe, name, state),
      (card: ServingCardV1) => {
        expect(card.evidence[name === "P10" ? "p10" : name === "P11" ? "p11" : "adapter"]).toBeNull();
        if (name === "P11") expect(card.evidence.bounds).toBeNull();
        if (name === "P10") for (const role of STRUCTURED_OUTPUT_ROLES) expect(card.roles[role].structuredOutput).toBeNull();
        expect(card.probe[state === "skipped" ? "probesSkipped" : "probesFailed"]).toContain(name);
      }] as [string, (probe: Record<string, any>) => void, (card: ServingCardV1) => void])),
    ["P10 unassessed", probe => { delete probe.P10.assessed; for (const cell of Object.values<any>(probe.P10.cells)) for (const call of cell.calls) call.classification = "unassessed"; },
      card => { expect(card.evidence.p10?.assessed).toBeNull(); expect(card.evidence.p10?.cells["plan/on"]).toMatchObject({ total: 20, unassessed: 20, valid: 0 });
        for (const role of STRUCTURED_OUTPUT_ROLES) expect(card.roles[role].structuredOutput).toBeNull(); }],
    ["one P11 size failed", probe => { probe.P11.sizes["60000"] = { error: "URLError", elapsed_s: 900.4, target_tokens: 60000, words: 48193 }; },
      card => { expect(card.evidence.p11?.sizes["60000"]).toEqual({ ok: false, promptTokens: null, completionTokens: null, ttftS: null, prefillTokS: null, decodeTokS: null, tokensPerWord: null });
        expect(card.evidence.bounds?.plan).toEqual({ promptTokensAssumed: 60000, ceiling300s: null, ceiling900s: null }); }],
    ["a K burst with only errors", probe => { probe.P11.k_streams["8"] = { streams: 8, errors: 8, per_stream_decode_tok_s: [], median_decode_tok_s: null, aggregate_tok_s: null,
      max_ttft_s: null, max_total_s: null, running_samples: [8, 8], running_max: 8 }; },
    card => { expect(card.evidence.p11?.kStreams["8"]).toEqual({ streams: 8, errors: 8, medianDecodeTokS: null, aggregateTokS: null, maxTtftS: null, maxTotalS: null, runningMax: 8 }); }],
    ["ttft_s 400 at 60k (negative ceilings)", probe => { probe.P11.sizes["60000"].ttft_s = 400; },
      card => { expect(card.evidence.bounds?.plan.ceiling300s).toBe(-3410); expect(card.evidence.bounds?.synthesis.ceiling300s).toBe(-3410); }],
    ["P1 without max_model_len, version or root", probe => { probe.P1.models[0] = { id: ALIAS, root_basename: "", max_model_len: null }; probe.P1.version = null; },
      card => { expect(card.identity).toEqual({ servedModel: ALIAS, engineVersion: null, contextTokens: null, modelRootBasename: null }); }],
    ["the strict-to-non-strict fallback", probe => { probe.P10.acceptance.plan.strict = { status: 400, elapsed_s: 0.3, error_bytes: 120, error_sha256: "d".repeat(64), accepted: false };
      for (const key of ["plan/on", "plan/off"]) probe.P10.cells[key].strict = false; },
    card => { expect(card.roles.plan.structuredOutput).toBeNull(); expect(card.evidence.p10?.cells["plan/on"]?.variant).toBe("non_strict");
      expect(card.evidence.p10?.acceptance.plan).toEqual({ strict: false, nonStrict: true }); expect(card.roles.extract.structuredOutput).not.toBeNull(); }],
    ["a non-empty sizes_refused", probe => { probe.P11.sizes_refused = [{ target_tokens: 300000, reason: "prompt_plus_max_tokens_exceeds_max_model_len" }]; },
      card => { expect(card.evidence.p11?.sizesRefused).toEqual([300000]); }],
  ];

  it.each(EDGE_PROBES)("R8: the writer's card for a probe with %s parses", (_name, edit, check) => {
    const card = proposedServingCard(edit);
    expect(card.decision).toEqual({ status: "proposed", entry: null });
    check(card);
    expect(parseServingCard(Buffer.from(JSON.stringify(card)))).toEqual(card);
  });

  it("R9: every refusal code survives the loop's failure record", () => {
    for (const code of SERVING_CARD_CODES) expect(failureCode(new ServingCardError(code), "loop_failed")).toBe(code);
  });

  it("R10: outside the reader, no production module parses a card or reads the pair's descriptor, so every value passes the fail-closed load", () => {
    const root = resolve(__dirname, "..", ".."), reader = join("src", "main", "private-agent", "serving-card.ts"), driver = join("scripts", "private-agent-local-screen.ts");
    const files = ["src", "scripts"].flatMap(top => readdirSync(join(root, top), { recursive: true, encoding: "utf8" })
      .filter(name => /\.(?:[cm]?[jt]s|tsx)$/u.test(name)).map(name => join(top, name)));
    expect(files).toContain(reader); expect(files).toContain(driver);
    for (const file of files.filter(name => name !== reader)) {
      const text = readFileSync(join(root, file), "utf8"), reads = text.match(/\bvllm\??\.servingCard\b/gu) ?? [];
      // The raw parse and the schema return values no adoption, pin or consumed-flag check has seen.
      expect(text.match(/\b(?:parseServingCard|ServingCardV1Schema)\b/gu) ?? [], file).toEqual([]);
      if (file !== driver) { expect(reads, file).toEqual([]); continue; }
      const builder = /\nexport function buildLocalScreenServingCard\b[\s\S]*?\n\}\n/u.exec(text)?.[0] ?? "";
      expect(reads.length).toBeGreaterThan(0); expect(builder.match(/\bvllm\??\.servingCard\b/gu)?.length).toBe(reads.length);
    }
  });
});
