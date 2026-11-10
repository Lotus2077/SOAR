import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical } from "../../src/main/private-agent/contracts";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { ZERO_FEE_DESTINATIONS, isZeroFeeFailedDispatch, summarizeRun } from "../../src/main/private-agent/selection";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { buildLocalScreenModelConfig } from "../../scripts/private-agent-local-screen";

/**
 * Backlog item 11, part 1 (BL-20261109-0331-loop-selection-protocol-2-design): `zeroFeeFailedDispatches`, the part of
 * `failedDispatches` the H4 loop admits, counted by scripts/registry-row.py with the predicate `summarizeRun` uses.
 */
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "registry-row.py");
const h = (n: string) => n.repeat(64);
const local = (over: Record<string, unknown> = {}) => ({ status: "failed", destinationId: "owned_local_model", purpose: "research source index", reservedFeeMicrousd: 0, ...over });
/** Every edge of the predicate as a raw JSON row (so `0.0` stays a float for Python), labelled with whether it is a zero-fee failed row. */
const ROWS: [string, string, boolean][] = [
  ["a zero-fee local failure", JSON.stringify(local()), true],
  ["a public GET that failed", JSON.stringify(local({ destinationId: "approved_public_snapshots", purpose: "public source retrieval" })), true],
  ["a zero-fee failure with an explicit zero fee", JSON.stringify(local({ feeMicrousd: 0 })), true],
  ["a zero-fee failure whose reservation is written 0.0", JSON.stringify(local()).replace("\"reservedFeeMicrousd\":0", "\"reservedFeeMicrousd\":0.0"), true],
  ["a zero-fee failure with its diagnostic", JSON.stringify(local({ failure: { phase: "transport", code: "request_timeout" } })), true],
  ["a priced failure", JSON.stringify(local({ reservedFeeMicrousd: 160_000 })), false],
  ["a failure to the cloud destination reserved at zero (a zero-price cloud arm)", JSON.stringify(local({ destinationId: "cloud_coordinator", purpose: "research plan" })), false],
  ["a failure to a destination nobody named", JSON.stringify(local({ destinationId: "search_api" })), false],
  ["a failure without a destination", JSON.stringify(local({ destinationId: undefined })), false],
  ["a failure whose destination is not a string", JSON.stringify(local({ destinationId: ["owned_local_model"] })), false],
  ["a failure without a recorded reservation", JSON.stringify(local({ reservedFeeMicrousd: undefined })), false],
  ["a failure whose reservation is the string \"0\"", JSON.stringify(local({ reservedFeeMicrousd: "0" })), false],
  ["a failure whose reservation is false", JSON.stringify(local({ reservedFeeMicrousd: false })), false],
  ["a failure whose reservation is null", JSON.stringify(local({ reservedFeeMicrousd: null })), false],
  ["a failure that carries a fee", JSON.stringify(local({ feeMicrousd: 5 })), false],
  ["a failure whose fee is null", JSON.stringify(local({ feeMicrousd: null })), false],
  ["a failure that carries an approval", JSON.stringify(local({ approval: { proposalId: "p", maxFeeMicrousd: 0 } })), false],
  ["a failure whose approval is null", JSON.stringify(local({ approval: null })), false],
  ["a failed assist row (its own column)", JSON.stringify(local({ purpose: "research plan assist" })), false],
  ["a settled row", JSON.stringify(local({ status: "settled", feeMicrousd: 0 })), false],
  ["a superseded row", JSON.stringify(local({ status: "superseded" })), false],
  ["an unknown row", JSON.stringify(local({ status: "unknown" })), false],
];
/** A boolean fee fails the summariser's result schema, so the loop stops on the whole run (fail closed); the registry row just does not count it. */
const BOOLEAN_FEE = JSON.stringify(local({ feeMicrousd: false }));
const failedOf = (raw: string) => { const row = JSON.parse(raw) as Record<string, unknown>; return row.status === "failed" && row.purpose !== "research plan assist" ? 1 : 0; };

/** A run directory both readers accept: the summariser's freeze and result fields, the registry's model configuration, and an empty ledger. */
function runDirectory(root: string, name: string, rawRows: string[]) {
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  const jobId = `job-${name}`;
  writeFileSync(join(dir, "freeze.json"), `${canonical({ version: 1, jobId, startedAt: "2026-11-09T10:00:00.000Z", sourceFreezeSha256: h("4"), taskBinding: { jobSha256: h("1"), briefSha256: h("2") },
    profile: "heavy", modelConfig: { maxOutputTokens: 16384, thinking: "medium" }, arm: { arm: "local" } })}\n`);
  writeFileSync(join(dir, "result.json"), `{"candidateFiles":[],"dispatches":[${rawRows.join(",")}],"finishedAt":"2026-11-09T10:05:00.000Z","reason":"bounded_allowance_exhausted","snapshotSha256":"${h("7")}","status":"incomplete"}\n`);
  const db = new Database(join(dir, "state.sqlite")); const store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["m"], maxRequests: 10, maxFeeMicrousd: 0 });
  store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q" });
  db.close();
  return dir;
}
function row(args: string[]): Record<string, unknown> {
  return JSON.parse(execFileSync("python3", ["-I", SCRIPT, ...args, "--id", "x", "--batch", "b", "--task", "t", "--family", "research", "--exposure", "fresh", "--arm", "local-loop", "--outcome", "rejected", "--verdict-by", "none", "--lesson", "l"],
    { cwd: ROOT, encoding: "utf8" }));
}
function scratch() { const root = mkdtempSync(join(tmpdir(), "soar-zero-fee-row-")); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; }

describe("zero-fee failed dispatches in the loop summary and the registry row (backlog item 11, part 1)", () => {
  it.each(ROWS)("classifies %s the same way in summarizeRun, the predicate and registry-row.py", (_label, raw, zeroFee) => {
    expect(isZeroFeeFailedDispatch(JSON.parse(raw) as Record<string, unknown>)).toBe(zeroFee);
    const dir = runDirectory(scratch(), "run", [raw]);
    const expected = { failedDispatches: failedOf(raw), zeroFeeFailedDispatches: zeroFee ? 1 : 0 };
    expect(summarizeRun(dir, [])).toMatchObject(expected);
    expect(row(["--run-dir", dir])).toMatchObject(expected);
  });
  it("refuses a run whose fee is a boolean in the summary, and does not count the row in the registry", () => {
    expect(isZeroFeeFailedDispatch(JSON.parse(BOOLEAN_FEE) as Record<string, unknown>)).toBe(false);
    const dir = runDirectory(scratch(), "run", [BOOLEAN_FEE]);
    expect(() => summarizeRun(dir, [])).toThrow(/feeMicrousd/u); expect(row(["--run-dir", dir])).toMatchObject({ failedDispatches: 1, zeroFeeFailedDispatches: 0 });
  });
  it("counts a subset of failedDispatches on a run row, and sums it over a loop's runs", () => {
    const root = scratch();
    const mixed = runDirectory(root, "mixed", ROWS.map(([, raw]) => raw));
    const expected = { failedDispatches: ROWS.reduce((total, [, raw]) => total + failedOf(raw), 0), zeroFeeFailedDispatches: ROWS.filter(([, , zero]) => zero).length, assistFailedDispatches: 1 };
    expect(expected.zeroFeeFailedDispatches).toBeLessThan(expected.failedDispatches);
    expect(summarizeRun(mixed, [])).toMatchObject(expected); expect(row(["--run-dir", mixed])).toMatchObject(expected);
    const loop = join(root, "loop"); mkdirSync(loop);
    runDirectory(loop, "a", [JSON.stringify(local()), JSON.stringify(local({ reservedFeeMicrousd: 160_000, destinationId: "cloud_coordinator" }))]);
    runDirectory(loop, "b", [JSON.stringify(local()), JSON.stringify(local({ destinationId: "approved_public_snapshots" }))]);
    writeFileSync(join(loop, "loop.json"), `${canonical({ version: 1, selectionRule: 2, arm: "local", startedAt: "2026-11-09T09:59:00.000Z", finishedAt: "2026-11-09T10:06:00.000Z",
      candidates: { a: { status: "incomplete", reason: "bounded_allowance_exhausted" }, b: { status: "incomplete", reason: "bounded_allowance_exhausted" } }, seeded: { b: true, repair: false, snapshotSha256: h("f") },
      writeIdentityEqual: null, critique: null, selected: { stage1: { candidate: "a", step: "tie" }, final: { candidate: "a", step: "no_draft" } } })}\n`);
    expect(row(["--loop-dir", loop])).toMatchObject({ failedDispatches: 4, zeroFeeFailedDispatches: 3, loop: { rule: 2, selected: "a", step: "no_draft" } });
  });
  it("mirrors the destination allowlist byte for byte in registry-row.py, and names exactly the driver's fee-free destinations", () => {
    expect(ZERO_FEE_DESTINATIONS).toEqual(["owned_local_model", "approved_public_snapshots"]);
    const script = readFileSync(SCRIPT, "utf8");
    expect(script).toContain(`ZERO_FEE_DESTINATIONS = (${ZERO_FEE_DESTINATIONS.map(id => `"${id}"`).join(", ")})`);
    // The driver's local destination and its model configuration, its loopback public-snapshot fixture, and its cloud destination outside the list.
    // Every destination the driver declares, by id and kind: the allowlist is exactly the ones that are not the cloud model.
    const driver = readFileSync(join(ROOT, "scripts", "private-agent-local-screen.ts"), "utf8");
    const declared = new Set([...driver.matchAll(/\{ id: "([a-z_]+)", kind: "([a-z_]+)"/gu)].map(match => `${match[1]}:${match[2]}`));
    expect([...declared].sort()).toEqual(["approved_public_snapshots:public_web", "cloud_coordinator:cloud_model", "owned_local_model:local_model"]);
    expect([...declared].filter(entry => !entry.endsWith(":cloud_model")).map(entry => entry.split(":")[0]).sort()).toEqual([...ZERO_FEE_DESTINATIONS].sort());
    const config = buildLocalScreenModelConfig({ vllm: { baseUrl: "http://127.0.0.1:9/v1", model: "m", apiKey: undefined, costPolicy: "local_zero_cost" }, streamingEnabled: false } as never, COORDINATOR_PROFILES.heavy);
    expect(config).toMatchObject({ destinationId: "owned_local_model", inputUsdPerMillion: 0, outputUsdPerMillion: 0 });
  });
});
