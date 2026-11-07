import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syntheticProbe } from "../helpers/serving-probe-fixture";

const SCRIPT = resolve(__dirname, "..", "..", "scripts", "serving-card.py");
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "soar-card-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const envFile = join(root, "empty.env"); writeFileSync(envFile, "");
  return { root, envFile };
}
/** Runs the writer as the operator does, with no SOAR variables unless the test sets them and never the repository's .env.local. */
function card(probe: unknown, extra: string[] = [], environment: Record<string, string> = {}) {
  const { root, envFile } = workspace();
  const input = join(root, "probe.json"); writeFileSync(input, JSON.stringify(probe));
  const result = spawnSync("python3", ["-I", SCRIPT, "--input", input, "--env-file", envFile, ...extra], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...environment } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const COMPARE = ["--compare-root", "Qwen3.8-Flash-Next-NVFP4", "--compare-version", "0.33.0rc1.dev617+g821038729", "--compare-context", "262144"];

describe("serving-card writer", () => {
  it("emits the identity, behaviour and derived-bounds tables from a probe_version 2 result and tells skipped probes from failed ones", () => {
    const result = card(syntheticProbe(), COMPARE);
    expect(result.status).toBe(0); expect(result.stderr).toBe("");
    const text = result.stdout;
    expect(text).toContain("# Serving card: owner's inference endpoint, 2026-11-08");
    expect(text).toContain("| Engine | vLLM 0.33.0rc1.dev617+g821038729 |");
    expect(text).toContain("| Served alias | `RM-01 VLM` |");
    expect(text).toContain("| Model root (basename) | `Qwen3.8-Flash-Next-NVFP4` |");
    expect(text).toContain("| Context limit | 262,144 tokens |");
    expect(text).toContain("| Transport | loopback");
    expect(text).toContain("| Authentication | none required");
    expect(text).toContain("| Speculative decoding | active: 73% of drafted tokens accepted during the probe |");
    // The comparison says consistent, never that the weights are the same or verified.
    expect(text).toContain("| Consistent with the 2026-11-04 qualification: model root | yes (`Qwen3.8-Flash-Next-NVFP4`) |");
    expect(text).toContain("| Consistent with the 2026-11-04 qualification: engine version | yes");
    expect(text).toContain("| Consistent with the 2026-11-04 qualification: context | yes (`262144`) |");
    expect(text).toContain("cannot prove identical weights");
    expect(text).not.toMatch(/same weights/iu); expect(text).not.toMatch(/\bverified\b/iu);
    // Probe states: run, skipped by the operator, failed before a result.
    expect(text).toContain("| **P8** | not run (skipped by the operator) |");
    expect(text).toContain("| **P6** | failed before recording a result (`URLError`) |");
    expect(text).toContain("| **P4** prefix cache | repeating the same long prompt reused 44,800 cached tokens, first token 1.85 s |");
    expect(text).toContain("| **P9** context guard | max_tokens 262,144 requested: status 400, 0.0 s; rejected with 400 yes |");
    // P10 rows report the 95% rule per cell with the variant named; P11 and the adapter have their own rows.
    expect(text).toContain("**P10** structured output, plan/on | valid 19/20 (95%); truncated 1;");
    expect(text).toContain("against the 95% rule (strict variant): meets");
    expect(text).toContain("**P10** structured output, plan/off | valid 17/20 (85%); truncated 0; schema invalid 2; binding invalid 1;");
    expect(text).toContain("against the 95% rule (strict variant): does not meet");
    expect(text).toContain("| **P10** `response_format` acceptance, plan | strict: accepted (status 200); non-strict: accepted (status 200) |");
    expect(text).toContain("**P11** prefill and decode by prompt size | 20,000 target (20,010 observed)");
    expect(text).toContain("stable_prefix: second request reused 5,120 of 21,010 prompt tokens");
    expect(text).toContain("K=8: aggregate 236.8 tok/s, median per stream 30.2 tok/s");
    expect(text).toContain("| **Adapter** `/tokenize` parity | status 200; count 23 against usage.prompt_tokens 23: parity yes |");
    expect(text).toContain("consistent with `flash_next_v1`: yes");
    // Derived bounds: (900 - 31.2) x 34.1 = 29,626 for the plan's 60k prompt; (300 - 66) ... only the roles' sizes appear.
    expect(text).toContain("## Stage bounds derived from this card (proposals for the E0 card)");
    expect(text).toContain("| plan | 8,192 | 60,000 | 31.2 | 34.1 | 9,166 (within the cap) | 29,626 (within the cap) |");
    expect(text).toContain("| index | 1,536 | 20,000 | 9.8 | 36.0 | 10,447 (within the cap) | 32,047 (within the cap) |");
    expect(text).toContain("## Consequences for the plan");
    // Deterministic for a given input.
    expect(card(syntheticProbe(), COMPARE).stdout).toBe(text);
  });

  it("marks unassessed P10 cells and a missing P11 instead of evaluating the rule or deriving bounds", () => {
    const probe = syntheticProbe();
    delete probe.P10.assessed; probe.P10.cells["plan/on"].counts.unassessed = 20; probe.P10.cells["plan/on"].counts.valid = 0;
    probe.probes_run = probe.probes_run.filter((name: string) => name !== "P11"); probe.probes_skipped.push("P11"); delete probe.P11;
    const result = card(probe);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("20 replies not yet assessed (`pnpm probe:assess`), so the 95% rule is not evaluated");
    expect(result.stdout).toContain("| **P11** | not run (skipped by the operator) |");
    expect(result.stdout).toContain("Not derived: the table needs the role export");
    expect(result.stdout).not.toContain("Consistent with the 2026-11-04");
  });

  it.each([
    ["a URL in the alias", (p: any) => { p.P1.models[0].id = "http://rm01.internal:8000/v1"; }],
    ["an IPv4 literal in a failure name", (p: any) => { p.probes_failed.P6 = "10.0.0.5"; }],
    ["a host:port in the run id", (p: any) => { p.run_id = "rm01-box:8000"; }],
    ["an IPv6 literal", (p: any) => { p.model_source = "fe80::1"; }],
    ["a bracketed IPv6 host:port", (p: any) => { p.P1.version = "[::1]:8000"; }],
    ["an address inside a nested key", (p: any) => { p.P10.cells["plan/on"].calls[0]["https://leak.example"] = 1; }],
  ])("refuses %s with exit 2 and no output", (_name, plant) => {
    const probe = syntheticProbe(); plant(probe);
    const result = card(probe, COMPARE);
    expect(result.status).toBe(2); expect(result.stdout).toBe("");
    expect(result.stderr).toContain("refused: an address-like string at $.");
    expect(result.stderr).not.toMatch(/rm01|10\.0\.0\.5|fe80|leak\.example/u);
    if (_name.includes("nested key")) expect(result.stderr).toContain("$.P10.cells.plan/on.calls[0].<redacted-key>");
  });

  it("refuses the configured endpoint's host even without a port or scheme, and a version 1 probe", () => {
    const probe = syntheticProbe(); probe.P1.models[0].root_basename = "weights-from-box-example-host.internal";
    const refused = card(probe, [], { SOAR_VLLM_BASE_URL: "https://box-example-host.internal:8443/v1" });
    expect(refused.status).toBe(2); expect(refused.stdout).toBe(""); expect(refused.stderr).toContain("$.P1.models[0].root_basename");
    expect(refused.stderr).not.toContain("box-example-host");
    const accepted = card(probe, [], { SOAR_VLLM_BASE_URL: "http://127.0.0.1:8000/v1" });
    expect(accepted.status).toBe(0);
    const old = { ...syntheticProbe(), probe_version: 1 };
    const v1 = card(old);
    expect(v1.status).toBe(2); expect(v1.stdout).toBe(""); expect(v1.stderr).toContain("probe_version 2");
    expect(() => execFileSync("python3", ["-I", SCRIPT], { encoding: "utf8", stdio: "pipe" })).toThrow();
  });

  it("leaves ordinary probe text alone: timestamps, versions, ratios and file names are not addresses", () => {
    const probe = syntheticProbe();
    probe.P10.cells["plan/on"].calls[0].reply_file = "plan-on-strict-01.json"; probe.P1.version = "0.33.0rc1.dev617+g821038729";
    probe.P10.assessed.assessedUtc = "2026-11-08T11:05:00.123Z"; probe.started_utc = "2026-11-08T09:15:00+00:00";
    expect(card(probe).status).toBe(0);
  });
});
