import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { sourceEvidenceCheck, type EvidenceContract } from "../../src/main/private-agent/evidence";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";

const enabled = process.env.SOAR_RUN_PRIVATE_AGENT_RUNTIME === "true";
// Qualified immutable artifact image; these tests never pull/build an image.
const imageId = "sha256:e5c7075fac7a7a68900db45e3de06e50e7b0f6896a5ca0f82cddb4ef8ad4ac2f";
const exec = promisify(execFile);
const json = (value: unknown) => Buffer.from(JSON.stringify(value) + "\n");
const python = (source: string) => `python3 -I -B - <<'SOAR_EVIDENCE_CHECK'\n${source}\nSOAR_EVIDENCE_CHECK`;

function fixture(count = 6, price = 7) {
  const total = count * price;
  const source = { count, price };
  const contract: EvidenceContract = { version: 1, claimsPath: "output/evidence.json", scriptPath: "output/calculations.py",
    resultsPath: "output/calculation-results.json", requirements: [{ id: "computed_total", statement: "Compute the synthetic quantity times unit price.", kind: "numeric" }] };
  const sourceReference = { path: "input/facts.json", quote: `"count":${count}` };
  const comparison = { id: "total", expected: total, actual: total, unit: "USD",
    artifact: { path: "output/decision.json", pointer: "/total" },
    operands: [{ value: count, unit: "items", source: sourceReference },
      { value: price, unit: "USD/item", source: { path: "input/facts.json", quote: `"price":${price}` } }] };
  const results = { version: 1, comparisons: [comparison], overallVerdict: "pass" };
  const claims = { version: 1, overallVerdict: "pass", claims: [{ id: "total_claim", requirementIds: ["computed_total"], status: "supported",
    artifact: { path: "output/decision.json", quote: `"total":${total}` }, sources: [sourceReference], calculationIds: ["total"] }] };
  let script = `import json\nfrom pathlib import Path\nfacts=json.loads(Path('input/facts.json').read_text())\nartifact=json.loads(Path('output/decision.json').read_text())\nresult={'version':1,'comparisons':[{'id':'total','expected':facts['count']*facts['price'],'actual':artifact['total'],'unit':'USD','artifact':{'path':'output/decision.json','pointer':'/total'},'operands':[{'value':facts['count'],'unit':'items','source':{'path':'input/facts.json','quote':'\"count\":'+str(facts['count'])}},{'value':facts['price'],'unit':'USD/item','source':{'path':'input/facts.json','quote':'\"price\":'+str(facts['price'])}}]}],'overallVerdict':'pass'}\nprint(json.dumps(result))\n`;
  return { contract, results, claims, get script() { return script; }, set script(value: string) { script = value; },
    files: () => [{ path: "input/facts.json", bytes: json(source) }, { path: "output/decision.json", bytes: json({ total }) },
      { path: contract.claimsPath, bytes: json(claims) }, { path: contract.resultsPath, bytes: json(results) },
      { path: contract.scriptPath, bytes: Buffer.from(script) }] };
}

type Fixture = ReturnType<typeof fixture>;
async function containers(jobId: string, endpoint: string) {
  const result = await exec("docker", ["--host", endpoint, "ps", "--all", "--quiet", "--filter", `label=soar.private-job-id=${jobId}`], { timeout: 10_000 });
  return result.stdout.trim().split("\n").filter(Boolean);
}

async function check(f: Fixture, expected: { passed: boolean; code?: string }, options: { inspectIsolation?: boolean; timeoutMs?: number } = {}) {
  const files = f.files(), originalResults = files.find(file => file.path === f.contract.resultsPath)!.bytes;
  const hostCheck = sourceEvidenceCheck(files, f.contract), jobId = randomUUID();
  const sandbox = await DockerSandbox.create({ imageId, jobId, contextId: randomUUID(), files });
  const began = performance.now();
  try {
    if (options.inspectIsolation) {
      const ids = await containers(jobId, sandbox.endpoint); expect(ids).toHaveLength(1);
      const info = JSON.parse((await exec("docker", ["--host", sandbox.endpoint, "inspect", ids[0]!], { timeout: 10_000 })).stdout)[0];
      expect(info.Image).toBe(imageId);
      expect(info.Config.User).toBe("65534:65534");
      expect(info.HostConfig).toMatchObject({ NetworkMode: "none", ReadonlyRootfs: true, Privileged: false, CapDrop: ["ALL"] });
      expect(info.HostConfig.Binds ?? []).toEqual([]);
    }
    const response = await sandbox.execute(python(hostCheck.python), { timeoutMs: options.timeoutMs ?? 35_000 });
    expect(response.exitCode).toBe(expected.passed ? 0 : 1);
    expect(response.stderr).toBe("");
    const result = JSON.parse(response.stdout);
    expect(result).toMatchObject(expected);
    expect(result).not.toHaveProperty("artifactAccepted", true);
    if (expected.passed) {
      expect(result).toEqual({ passed: true, semanticAcceptance: "independent_review_required" });
      for (const file of files) expect(await sandbox.readFile(file.path, file.bytes.length + 1)).toEqual(file.bytes);
    } else {
      expect(result).not.toHaveProperty("semanticAcceptance", "accepted");
      // Replay-only failures restore the exact prior results bytes. A semantic
      // failure before replay leaves them untouched. Neither path can upgrade it.
      expect(await sandbox.readFile(f.contract.resultsPath, originalResults.length + 1)).toEqual(originalResults);
    }
    return performance.now() - began;
  } finally {
    await sandbox.close();
    expect(await containers(jobId, sandbox.endpoint)).toEqual([]);
  }
}

describe.skipIf(!enabled)("real isolated source-evidence consistency and replay", () => {
  it("replays source-derived calculations and leaves semantic acceptance independent", async () => {
    await check(fixture(), { passed: true }, { inspectIsolation: true });
  }, 60_000);

  it("rejects a numeric mismatch despite declared overall pass", async () => {
    const f = fixture(); f.results.comparisons[0]!.expected = 41;
    await check(f, { passed: false, code: "comparison_mismatch" });
  }, 60_000);

  it("does not collapse distinct decimal JSON tokens into the same floating-point value", async () => {
    const f = fixture(), original = f.files;
    f.claims.claims[0]!.artifact.quote = '"total":0.1';
    f.files = () => original().map(file => file.path === f.contract.resultsPath
      ? { ...file, bytes: Buffer.from(file.bytes.toString().replace('"expected":42', '"expected":0.10000000000000001').replace('"actual":42', '"actual":0.1')) }
      : file.path === "output/decision.json" ? { ...file, bytes: Buffer.from('{"total":0.1}\n') } : file);
    await check(f, { passed: false, code: "comparison_mismatch" });
  }, 60_000);

  it("resolves actual values from the artifact and rejects a fabricated pointer", async () => {
    const f = fixture(); f.results.comparisons[0]!.artifact.pointer = "/not_present";
    await check(f, { passed: false, code: "invalid_pointer" });
  }, 60_000);

  it("does not accept fresh booleans as identical numeric replay values", async () => {
    const f = fixture(1, 1);
    f.script = f.script.replace("print(json.dumps(result))", "result['comparisons'][0]['expected']=True\nprint(json.dumps(result))");
    await check(f, { passed: false, code: "replay_result_mismatch" });
  }, 60_000);

  it("requires a comparison for a numeric requirement", async () => {
    const f = fixture(); f.results.comparisons = []; f.claims.claims[0]!.calculationIds = [];
    await check(f, { passed: false, code: "numeric_evidence_missing" });
  }, 60_000);

  it("rejects an omitted required factual claim", async () => {
    const f = fixture(); f.contract.requirements.push({ id: "source_status", statement: "Establish the supplied source status.", kind: "factual" });
    await check(f, { passed: false, code: "critical_coverage_missing" });
  }, 60_000);

  it.each(["source", "artifact"])("rejects a whitespace-only %s excerpt", async target => {
    const f = fixture();
    if (target === "source") f.claims.claims[0]!.sources[0]!.quote = " \n\t ";
    else f.claims.claims[0]!.artifact.quote = " \n\t ";
    await check(f, { passed: false, code: "invalid_excerpt" });
  }, 60_000);

  it("rejects an invented nonempty source excerpt", async () => {
    const f = fixture(); f.claims.claims[0]!.sources[0]!.quote = "This statement is absent from the source.";
    await check(f, { passed: false, code: "excerpt_not_found" });
  }, 60_000);

  it("removes stale results before replay instead of accepting a self-copy", async () => {
    const f = fixture(); f.script = "from pathlib import Path\nprint(Path('output/calculation-results.json').read_text())\n";
    await check(f, { passed: false, code: "replay_failed" });
  }, 60_000);

  it("rejects input mutation even when the replayed comparison still matches", async () => {
    const f = fixture(); f.script += "Path('input/facts.json').write_text('changed by candidate')\n";
    await check(f, { passed: false, code: "workspace_mutation" });
  }, 60_000);

  it("prevents an untrusted replay from forking a detached background process", async () => {
    const f = fixture();
    f.script = `import os,time\nchild=os.fork()\nif child==0:\n os.setsid()\n for descriptor in (0,1,2):\n  try: os.close(descriptor)\n  except OSError: pass\n time.sleep(2)\n from pathlib import Path\n Path('output/escaped-background.txt').write_text('synthetic descendant')\n time.sleep(60)\n os._exit(0)\n` + f.script;
    await check(f, { passed: false, code: "replay_failed" });
  }, 60_000);

  it("bounds a stalled program and kills its replay process", async () => {
    const f = fixture(); f.script = "import time\ntime.sleep(60)\n";
    const elapsed = await check(f, { passed: false, code: "replay_timeout" }, { timeoutMs: 35_000 });
    expect(elapsed).toBeGreaterThanOrEqual(19_000);
    expect(elapsed).toBeLessThan(32_000);
  }, 60_000);

  it("bounds replay output before parsing it or promoting a verdict", async () => {
    const f = fixture(); f.script = "import sys\nsys.stdout.write('x'*524289)\nsys.stdout.flush()\n";
    await check(f, { passed: false, code: "replay_output_limit" });
  }, 60_000);

  it("checks comparisons that an overall summary and claim list omit", async () => {
    const f = fixture(); f.results.comparisons.push({ ...structuredClone(f.results.comparisons[0]!), id: "unmentioned_total" });
    await check(f, { passed: false, code: "unreferenced_comparison" });
  }, 60_000);
});
