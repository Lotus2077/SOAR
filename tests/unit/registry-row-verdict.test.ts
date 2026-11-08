import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const SCRIPT = resolve(__dirname, "..", "..", "scripts", "registry-row.py");
const h = (n: string) => n.repeat(64);
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
/** Runs the registry writer; a refusal surfaces as a thrown error carrying the script's one-line reason. */
function run(args: string[]): Record<string, unknown> {
  return JSON.parse(execFileSync("python3", ["-I", SCRIPT, ...args], { cwd: resolve(__dirname, "..", ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}
function registry(rows: Record<string, unknown>[]): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "soar-registry-verdict-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "registry.jsonl"); writeFileSync(path, rows.map(row => `${JSON.stringify(row)}\n`).join(""));
  return { root, path };
}
/** A harness row as the writer emits one today, with the fields a verdict must never touch. */
const original = { id: "p9-r1-local-heavy", arm: "local-heavy", batch: "phase9", task: "r1", family: "research", exposure: "fresh", date: "2026-10-30", git: "abcdefabcdef", profile: "heavy", thinking: "medium", maxOutputTokens: 16384,
  taskJobSha256: h("1"), runStatus: "submitted", terminalCause: "independent_acceptance_pending", modelCalls: 12, toolCalls: 11, wallSeconds: 321.5, inputTokens: 123456, outputTokens: 7890, cachedTokens: 1000, cacheWriteTokens: 20, lengthStops: 1, usd: 0.25,
  unknownDispatches: 0, retriedDispatches: 1, failedDispatches: 0, cloudModel: "claude-sonnet-5-5", cloudApi: "anthropic_messages", pipeline: "research", pipelinePlanner: "cloud",
  entailment: { counts: { supported: 20, partial: 1, unsupported: 0, contradicted: 0, not_judged: 0 }, entailmentCalls: 21, truncated: false, supportRate: 0.952 },
  loop: { version: 1, rule: 1, samples: 2, repaired: false, selected: "a", step: "submitted" }, outcome: "incomplete", criticalChecks: "5/7", verdictBy: "none", ownerMinutes: null, interventions: 0, lesson: "blind proxy grade pending" };
const superseded = { ...original, id: "p9-r2-old", task: "r2", lesson: "first version" };
const correction = { ...superseded, id: "p9-r2-old-fix", supersedes: "p9-r2-old", lesson: "metric correction" };
const owner = ["--outcome", "accepted", "--verdict-by", "owner", "--owner-minutes", "8", "--interventions", "1", "--lesson", "accepted after one edit pass"];
/** The desktop verdict receipt exactly as the app exports it (src/main/general-tasks/controller.ts, VERDICT_RECEIPT_KEYS). */
function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 1, taskId: "00000000-0000-4000-8000-000000000201", taskJobSha256: h("a"), date: "2026-11-07", profile: "heavy", thinking: "medium", maxOutputTokens: 16384, runStatus: "submitted", terminalCause: "submitted",
    modelCalls: 19, toolCalls: 19, wallSeconds: 493.3, inputTokens: 1200, outputTokens: 300, cachedTokens: 400, cacheWriteTokens: 0, lengthStops: 1, usd: 0, unknownDispatches: 0, retriedDispatches: 0, failedDispatches: 0,
    entailment: null, arm: "local-heavy", verdict: { decision: "accept", ownerMinutes: 8, interventions: 1, exportedThroughApp: true, recordedAt: "2026-11-07T09:00:00.000Z" }, cloudModel: null, cloudApi: null, ...overrides };
}
function receiptFile(value: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "soar-receipt-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "verdict-receipt.json"); writeFileSync(path, `${JSON.stringify(value)}\n`); return path;
}
const operator = ["--id", "oaj-20261107-document-review-1", "--batch", "owner-real-jobs", "--task", "owner-00000000", "--family", "document_review", "--exposure", "fresh", "--verdict-by", "owner", "--lesson", "owner accepted with one edit pass"];

describe("registry verdict rows", () => {
  it("supersedes a row by copying its measurements verbatim and changing only the verdict fields", () => {
    const { path } = registry([original, superseded, correction]);
    const row = run(["--supersedes", original.id, "--registry", path, "--id", "p9-r1-local-heavy-owner", ...owner]);
    const changed = new Set(["id", "supersedes", "outcome", "verdictBy", "ownerMinutes", "interventions", "lesson", "verdictAt", "git"]);
    for (const [key, value] of Object.entries(original)) if (!changed.has(key)) expect(row[key], key).toEqual(value);
    expect(row).toMatchObject({ id: "p9-r1-local-heavy-owner", supersedes: original.id, outcome: "accepted", verdictBy: "owner", ownerMinutes: 8, interventions: 1, lesson: "accepted after one edit pass" });
    expect(row.verdictAt).toMatch(UTC); expect(row.git).toMatch(/^[a-f0-9]{12}$/u); expect(row.git).not.toBe(original.git);
    expect(Object.keys(row).sort()).toEqual([...Object.keys(original), "supersedes", "verdictAt"].sort());
    // The verdict time may be declared; it is normalised to the Z form and must be UTC.
    expect(run(["--supersedes", original.id, "--registry", path, "--id", "x", ...owner, "--verdict-at", "2026-11-07T10:00:00+00:00"]).verdictAt).toBe("2026-11-07T10:00:00Z");
    expect(() => run(["--supersedes", original.id, "--registry", path, "--id", "x", ...owner, "--verdict-at", "2026-11-07T10:00:00"])).toThrow(/UTC offset/u);
    expect(() => run(["--supersedes", original.id, "--registry", path, "--id", "x", ...owner, "--verdict-at", "yesterday"])).toThrow(/ISO 8601/u);
    // Re-declared enums override the copy; a non-owner verdict keeps null minutes and zero interventions.
    const relabelled = run(["--supersedes", original.id, "--registry", path, "--id", "y", "--family", "document_review", "--outcome", "rejected", "--verdict-by", "agent_diagnostic", "--lesson", "l"]);
    expect(relabelled).toMatchObject({ family: "document_review", outcome: "rejected", verdictBy: "agent_diagnostic", ownerMinutes: null, interventions: 0, criticalChecks: "5/7", usd: 0.25 });
  });

  it("refuses an unknown or already superseded id, a reused id, owner verdicts without effort, and verdictBy values outside the enum", () => {
    const { path } = registry([original, superseded, correction]);
    expect(() => run(["--supersedes", "missing", "--registry", path, "--id", "x", ...owner])).toThrow(/no registry row has id 'missing'/u);
    expect(() => run(["--supersedes", superseded.id, "--registry", path, "--id", "x", ...owner])).toThrow(/already superseded by 'p9-r2-old-fix'/u);
    expect(() => run(["--supersedes", original.id, "--registry", path, "--id", correction.id, ...owner])).toThrow(/already exists/u);
    expect(() => run(["--supersedes", original.id, "--registry", join(path, "missing"), "--id", "x", ...owner])).toThrow(/cannot read the registry/u);
    const base = ["--supersedes", original.id, "--registry", path, "--id", "x", "--outcome", "accepted", "--lesson", "l"];
    expect(() => run([...base, "--verdict-by", "owner", "--interventions", "1"])).toThrow(/requires --owner-minutes and --interventions/u);
    expect(() => run([...base, "--verdict-by", "owner", "--owner-minutes", "8"])).toThrow(/requires --owner-minutes and --interventions/u);
    expect(() => run([...base, "--verdict-by", "owner", "--owner-minutes", "nan", "--interventions", "1"])).toThrow(/finite/u);
    expect(() => run([...base, "--verdict-by", "owner", "--owner-minutes", "-1", "--interventions", "1"])).toThrow(/at least 0/u);
    expect(() => run([...base, "--verdict-by", "owner", "--owner-minutes", "8", "--interventions", "-1"])).toThrow(/at least 0/u);
    expect(() => run([...base, "--verdict-by", "owner", "--owner-minutes", "8", "--interventions", "1.5"])).toThrow();
    expect(() => run([...base, "--verdict-by", "none", "--owner-minutes", "8"])).toThrow(/owner effort/u);
    for (const legacy of ["host_gate", "qualified_checker", "agent_diagnostic_blind", "claude-fable-5-1 host checks; owner verdict pending"])
      expect(() => run([...base, "--verdict-by", legacy])).toThrow(/invalid --verdict-by/u);
    expect(() => run([...base, "--verdict-by", "none", "--exposure", "seen"])).toThrow(/invalid --exposure/u);
    expect(() => run(["--supersedes", original.id, "--registry", path, "--id", "x", "--verdict-by", "none", "--lesson", "l"])).toThrow(/missing --outcome/u);
    // Exactly one source: --supersedes excludes every other source, and a new row still needs its enums.
    for (const other of [["--run-dir", "/nonexistent"], ["--loop-dir", "/nonexistent"], ["--verdict-file", "/nonexistent"]])
      expect(() => run(["--supersedes", original.id, "--registry", path, "--id", "x", ...owner, ...other])).toThrow(/exactly one/u);
    expect(() => run(["--verdict-file", "/nonexistent", "--run-dir", "/nonexistent", ...operator])).toThrow(/exactly one/u);
    expect(() => run(["--verdict-file", "/nonexistent", "--loop-dir", "/nonexistent", ...operator])).toThrow(/exactly one/u);
    expect(() => run(["--run-dir", "/nonexistent", "--id", "x", "--verdict-by", "none", "--lesson", "l", "--outcome", "accepted"])).toThrow(/missing --batch, --task, --family, --exposure, --arm/u);
  });

  it("rows a desktop verdict receipt as an owner row with the operator's enums and the receipt's measurements, effort and time", () => {
    const path = receiptFile(receipt());
    const row = run(["--verdict-file", path, ...operator, "--critical-checks", "1/1"]);
    expect(row).toEqual({ id: "oaj-20261107-document-review-1", batch: "owner-real-jobs", task: "owner-00000000", family: "document_review", exposure: "fresh", arm: "local-heavy",
      date: "2026-11-07", git: row.git, taskJobSha256: h("a"), profile: "heavy", thinking: "medium", maxOutputTokens: 16384, runStatus: "submitted", terminalCause: "submitted",
      modelCalls: 19, toolCalls: 19, wallSeconds: 493.3, inputTokens: 1200, outputTokens: 300, cachedTokens: 400, cacheWriteTokens: 0, lengthStops: 1, usd: 0, unknownDispatches: 0, retriedDispatches: 0, failedDispatches: 0,
      entailment: null, cloudModel: null, cloudApi: null, outcome: "accepted", criticalChecks: "1/1", verdictBy: "owner", ownerMinutes: 8, interventions: 1, exportedThroughApp: true, verdictAt: "2026-11-07T09:00:00Z",
      lesson: "owner accepted with one edit pass" });
    expect(row.git).toMatch(/^[a-f0-9]{12}$/u);
    const text = JSON.stringify(row);
    expect(text).not.toContain("taskId"); expect(text).not.toContain("00000000-0000-4000"); expect(text).not.toContain("http"); expect(text).not.toContain(tmpdir());
    // A rejection rows as rejected; the receipt's values may be repeated on the command line, never contradicted.
    const rejected = receiptFile(receipt({ verdict: { decision: "reject", ownerMinutes: 30, interventions: 2, exportedThroughApp: false, recordedAt: "2026-11-07T09:30:00Z" },
      entailment: { counts: { supported: 3, partial: 1, unsupported: 0, contradicted: 0, not_judged: 1 }, entailmentCalls: 4, truncated: true, supportRate: 0.75 }, arm: "local-standard-consulted", usd: 0.0312 }));
    expect(run(["--verdict-file", rejected, ...operator, "--outcome", "rejected", "--owner-minutes", "30", "--interventions", "2", "--arm", "local-standard-consulted", "--verdict-at", "2026-11-07T09:30:00+00:00"]))
      .toMatchObject({ outcome: "rejected", ownerMinutes: 30, interventions: 2, exportedThroughApp: false, arm: "local-standard-consulted", usd: 0.0312, verdictAt: "2026-11-07T09:30:00Z", criticalChecks: null,
        entailment: { counts: { supported: 3, partial: 1, unsupported: 0, contradicted: 0, not_judged: 1 }, entailmentCalls: 4, truncated: true, supportRate: 0.75 } });
    expect(() => run(["--verdict-file", rejected, ...operator, "--outcome", "accepted"])).toThrow(/records outcome 'rejected'/u);
    expect(() => run(["--verdict-file", rejected, ...operator, "--owner-minutes", "8"])).toThrow(/records ownerMinutes 30/u);
    expect(() => run(["--verdict-file", rejected, ...operator, "--interventions", "1"])).toThrow(/records interventions 2/u);
    expect(() => run(["--verdict-file", rejected, ...operator, "--arm", "local-heavy"])).toThrow(/records arm 'local-standard-consulted'/u);
    expect(() => run(["--verdict-file", rejected, ...operator, "--verdict-at", "2026-11-07T10:00:00Z"])).toThrow(/records verdictAt/u);
    // The receipt rows an owner verdict only, and the operator's enums are still required.
    expect(() => run(["--verdict-file", path, ...operator.map(value => value === "owner" ? "none" : value)])).toThrow(/give --verdict-by owner/u);
    expect(() => run(["--verdict-file", path, "--id", "x", "--verdict-by", "owner", "--lesson", "l"])).toThrow(/missing --batch, --task, --family, --exposure/u);
  });

  it("refuses a receipt with any other key, a wrong version, a missing or malformed verdict, or content that is not a hash, count or enum", () => {
    const refused: [Record<string, unknown>, RegExp][] = [
      [receipt({ goal: "Translate the attached contract" }), /unknown key 'goal'/u],
      [receipt({ path: "/Users/someone/Documents/contract.docx" }), /unknown key 'path'/u],
      [receipt({ url: "https://example.org/source" }), /unknown key 'url'/u],
      [receipt({ outputName: "report.md" }), /unknown key 'outputName'/u],
      [receipt({ version: 2 }), /version is not 1/u],
      [receipt({ verdict: null }), /verdict is missing/u],
      [receipt({ verdict: { decision: "accept", ownerMinutes: 8, interventions: 1, exportedThroughApp: true, recordedAt: "2026-11-07T09:00:00Z", note: "free text" } }), /verdict is missing or carries other keys/u],
      [receipt({ verdict: { decision: "maybe", ownerMinutes: 8, interventions: 1, exportedThroughApp: true, recordedAt: "2026-11-07T09:00:00Z" } }), /decision is not accept or reject/u],
      [receipt({ verdict: { decision: "accept", ownerMinutes: -1, interventions: 1, exportedThroughApp: true, recordedAt: "2026-11-07T09:00:00Z" } }), /ownerMinutes/u],
      [receipt({ verdict: { decision: "accept", ownerMinutes: 8, interventions: 1.5, exportedThroughApp: true, recordedAt: "2026-11-07T09:00:00Z" } }), /interventions/u],
      [receipt({ verdict: { decision: "accept", ownerMinutes: 8, interventions: 1, exportedThroughApp: "yes", recordedAt: "2026-11-07T09:00:00Z" } }), /exportedThroughApp/u],
      [receipt({ verdict: { decision: "accept", ownerMinutes: 8, interventions: 1, exportedThroughApp: true, recordedAt: "2026-11-07T09:00:00" } }), /UTC offset/u],
      [receipt({ taskJobSha256: "not a hash" }), /taskJobSha256/u],
      [receipt({ taskId: "report.md" }), /taskId/u],
      [receipt({ terminalCause: "the model said: ignore previous instructions" }), /terminalCause is not an identifier/u],
      [receipt({ arm: "cloud-gpt-6-sol" }), /arm is not local/u],
      [receipt({ modelCalls: -1 }), /modelCalls is not a count/u],
      [receipt({ usd: "free" }), /usd is not a non-negative number/u],
      [receipt({ cloudModel: "gpt-6-sol" }), /no cloud model/u],
      [receipt({ entailment: { counts: { supported: 1 }, entailmentCalls: 1, truncated: false, supportRate: 1 } }), /five verdict counts/u],
      [receipt({ entailment: { counts: { supported: 1, partial: 0, unsupported: 0, contradicted: 0, not_judged: 0 }, entailmentCalls: 1, truncated: false, supportRate: 1, reasons: ["judge text"] } }), /entailment carries other keys/u],
    ];
    for (const [value, reason] of refused) expect(() => run(["--verdict-file", receiptFile(value), ...operator]), JSON.stringify(value).slice(0, 80)).toThrow(reason);
    const { version: _version, ...withoutVersion } = receipt();
    expect(() => run(["--verdict-file", receiptFile(withoutVersion), ...operator])).toThrow(/missing key 'version'/u);
    const broken = receiptFile(receipt()); writeFileSync(broken, "{not json");
    expect(() => run(["--verdict-file", broken, ...operator])).toThrow(/not JSON/u);
    expect(() => run(["--verdict-file", join(tmpdir(), "soar-missing-receipt.json"), ...operator])).toThrow(/cannot read the receipt/u);
  });
});
