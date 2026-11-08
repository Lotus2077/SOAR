import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { DIAGNOSTICS_MANIFEST, assertRunDirectoryIgnored, createDiagnosticsFileSink, type DiagnosticsManifest } from "../../src/main/private-agent/research-diagnostics";
import { runResearchPipeline, type ResearchDiagnostic } from "../../src/main/private-agent/research-pipeline";
import { parseLocalArtifactScreenArguments } from "../../scripts/private-agent-local-screen";
import { RESEARCH_V4_TEST_BRIEF, researchV4Reply, researchV4Sources } from "../helpers/research-v4-fixture";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
function temp(prefix: string) { const dir = mkdtempSync(join(tmpdir(), prefix)); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const entry = (over: Partial<ResearchDiagnostic> = {}): ResearchDiagnostic => {
  const content = over.content ?? "a rejected reply with SECRET_REPLY_TEXT inside";
  return { stage: "plan", ordinal: 1, purpose: "research plan", replyContentSha256: digest(content), replyBytes: Buffer.byteLength(content), truncated: false, content, reasons: [{ code: "invalid_json", path: [] }], ...over };
};
const manifest = (directory: string) => JSON.parse(readFileSync(join(directory, DIAGNOSTICS_MANIFEST), "utf8")) as DiagnosticsManifest;
const mode = (path: string) => statSync(path).mode & 0o777;

describe("backlog item 4: the headless driver's diagnostics file sink", () => {
  it("writes each retained reply once, named by the sha256 of its bytes with mode 0600, beside a hashes-only manifest, and nothing outside diagnostics/", () => {
    const run = temp("soar-diag-run-"), sink = createDiagnosticsFileSink(run);
    expect(sink.directory).toBe(join(run, "diagnostics")); expect(mode(sink.directory)).toBe(0o700);
    expect(manifest(sink.directory)).toEqual({ version: 1, entries: [], writeFailures: 0 });
    const first = entry(), truncated = entry({ stage: "extract", ordinal: 2, purpose: "research evidence extraction", truncated: true, content: "{\"questions\": [ cut off SECRET_REPLY_TEXT", reasons: [{ code: "truncated", path: [] }] });
    sink.retain(first); sink.retain(truncated); sink.retain({ ...first, ordinal: 2 });  // the same content rejected twice: one file, two rows
    expect(readdirSync(sink.directory).sort()).toEqual([first.replyContentSha256, truncated.replyContentSha256, DIAGNOSTICS_MANIFEST].sort());
    for (const item of [first, truncated]) {
      const path = join(sink.directory, item.replyContentSha256), bytes = readFileSync(path);
      expect(digest(bytes)).toBe(item.replyContentSha256); expect(bytes.toString("utf8")).toBe(item.content); expect(mode(path)).toBe(0o600);
    }
    expect(mode(join(sink.directory, DIAGNOSTICS_MANIFEST))).toBe(0o600);
    const saved = manifest(sink.directory);
    expect(saved.entries.map(row => [row.stage, row.ordinal, row.purpose, row.replyContentSha256, row.replyBytes, row.truncated, row.reasons])).toEqual([
      ["plan", 1, "research plan", first.replyContentSha256, first.replyBytes, false, [{ code: "invalid_json", path: [] }]],
      ["extract", 2, "research evidence extraction", truncated.replyContentSha256, truncated.replyBytes, true, [{ code: "truncated", path: [] }]],
      ["plan", 2, "research plan", first.replyContentSha256, first.replyBytes, false, [{ code: "invalid_json", path: [] }]]]);
    expect(saved.entries.every(row => !("content" in row))).toBe(true);
    expect(readFileSync(join(sink.directory, DIAGNOSTICS_MANIFEST), "utf8")).not.toContain("SECRET_REPLY_TEXT");
    expect(saved).toEqual(sink.manifest());
    expect(readdirSync(run)).toEqual(["diagnostics"]);
  });
  it("writes content that is not valid UTF-16 as bytes without throwing, and counts a failed write instead of failing the run", () => {
    const run = temp("soar-diag-run-"), sink = createDiagnosticsFileSink(run);
    const lone = "lone surrogate \uD800 and NUL \0 inside";
    expect(() => sink.retain(entry({ content: lone }))).not.toThrow();
    expect(readdirSync(sink.directory)).toHaveLength(2); expect(sink.manifest().writeFailures).toBe(0);
    expect(digest(readFileSync(join(sink.directory, digest(lone))))).toBe(digest(lone));
    rmSync(sink.directory, { recursive: true, force: true });
    expect(() => sink.retain(entry())).not.toThrow(); expect(sink.manifest().writeFailures).toBeGreaterThan(0);
  });
  it("is exercised by the real pipeline on fixture models: rejected planner replies land as files, accepted replies and every packet file stay hash-only", async () => {
    const run = temp("soar-diag-run-"), sink = createDiagnosticsFileSink(run);
    const request = vi.fn(async (input: { body: string }, settle: (bytes: Buffer) => number) => {
      const body = JSON.parse(input.body), system = body.messages[0].content as string, user = body.messages[1].content as string;
      const content = system.startsWith("You plan") ? `not a plan NEVER_IN_SUMMARY ${digest(user).slice(0, 8)}` : researchV4Reply(system, user);
      const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      return { bytes, receipt: { feeMicrousd: settle(bytes) } };
    });
    const config = { destinationId: "owned", model: "Synthetic", maxOutputTokens: 16384, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium" as const };
    const make = () => new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, "job", "reader");
    const outcome = await runResearchPipeline({ brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), models: { reader: make(), planner: make(), synthesiser: make() }, signal: new AbortController().signal, record() {}, diagnostics: sink });
    expect(outcome).toMatchObject({ status: "incomplete", reason: "research_plan_invalid" });
    const saved = manifest(sink.directory);
    expect(saved.entries.map(row => [row.stage, row.ordinal, row.purpose, row.reasons])).toEqual([["plan", 1, "research plan", [{ code: "invalid_json", path: [] }]], ["plan", 2, "research plan", [{ code: "invalid_json", path: [] }]]]);
    expect(new Set(saved.entries.map(row => row.replyContentSha256)).size).toBe(2);  // two different rejected replies (the repair request differs), two files
    for (const row of saved.entries) expect(readFileSync(join(sink.directory, row.replyContentSha256), "utf8")).toContain("NEVER_IN_SUMMARY");
    expect(readdirSync(sink.directory)).toHaveLength(3);
    expect(JSON.stringify(outcome.summary)).not.toContain("NEVER_IN_SUMMARY");
    expect(outcome.files.every(file => !file.bytes.toString("utf8").includes("NEVER_IN_SUMMARY"))).toBe(true);
  });
});

describe("backlog item 4: retained text may only sit in a path git ignores", () => {
  function repository() {
    const root = temp("soar-diag-repo-");
    execFileSync("git", ["init", "-q", root]);
    writeFileSync(join(root, ".gitignore"), "runs/\n");
    return root;
  }
  it("admits a not yet created directory under an ignored path and refuses an unignored path and a path outside the repository", () => {
    const root = repository();
    expect(() => assertRunDirectoryIgnored(join(root, "runs", "loop", "a"), root)).not.toThrow();
    expect(existsSync(join(root, "runs"))).toBe(false);
    expect(() => assertRunDirectoryIgnored(join(root, "docs", "run"), root)).toThrow("local_screen_retain_directory_not_ignored");
    expect(() => assertRunDirectoryIgnored(join(root, "run"), root)).toThrow("local_screen_retain_directory_not_ignored");
    expect(() => assertRunDirectoryIgnored(temp("soar-diag-outside-"), root)).toThrow("local_screen_retain_directory_not_ignored");
  });
  it("reads this repository's own rules from the driver's working directory: .soar/ is ignored, docs/ is not", () => {
    expect(() => assertRunDirectoryIgnored(".soar/experiments/item4-test/run")).not.toThrow();
    expect(() => assertRunDirectoryIgnored("docs/item4-test-run")).toThrow("local_screen_retain_directory_not_ignored");
  });
  it("parses --retain-diagnostics true only beside --pipeline research", () => {
    const base = ["--execute-synthetic-local", "--task-directory", "synthetic-task", "--job-sha256", "a".repeat(64), "--brief-sha256", "b".repeat(64),
      "--authority-sha256", "c".repeat(64), "--image-id", `sha256:${"d".repeat(64)}`, "--output-directory", "synthetic-output", "--runtime-sha256", "e".repeat(64)];
    const research = ["--arm", "local", "--pipeline", "research", "--profile", "heavy", "--claims-ledger", "true"];
    expect(parseLocalArtifactScreenArguments([...base, ...research, "--retain-diagnostics", "true"])).toMatchObject({ pipeline: "research", retainDiagnostics: true });
    expect(parseLocalArtifactScreenArguments([...base, ...research])).not.toHaveProperty("retainDiagnostics");
    expect(() => parseLocalArtifactScreenArguments([...base, ...research, "--retain-diagnostics", "false"])).toThrow("local_screen_cli_invalid");
    expect(() => parseLocalArtifactScreenArguments([...base, ...research, "--retain-diagnostics", "yes"])).toThrow("local_screen_cli_invalid");
    expect(() => parseLocalArtifactScreenArguments([...base, "--arm", "local", "--retain-diagnostics", "true"])).toThrow("local_screen_cli_invalid");
  });
});
