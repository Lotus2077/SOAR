import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLAIMS_LEDGER_PATH, claimsLedgerCheck } from "../../src/main/private-agent/claims";
import { checkCommand } from "../../src/main/private-agent/runner";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { buildBinarySource } from "../helpers/claims-fixtures";

const enabled = process.env.SOAR_RUN_PRIVATE_AGENT_RUNTIME === "true";
// The qualified tool image built from runtime/private-agent/Dockerfile (pypdf installed system-wide, importable under -I); never pulled or built here.
const imageId = "sha256:e5c7075fac7a7a68900db45e3de06e50e7b0f6896a5ca0f82cddb4ef8ad4ac2f";
const report = "Alpha [C1]. Bravo [C2].\n\n## Conflicting evidence\n\nnone found\n\n## Unanswered questions\n\nnone\n";
const sources = [{ id: "input/source.pdf", path: "input/source.pdf" }, { id: "input/source.docx", path: "input/source.docx" }];
const paragraphs = ["Alpha page about the plant.", "The reactor produced 42 units in May 2026."];

/** Runs the host check in the real sandbox exactly as the loop (check_claims) and the finish verifier do. */
async function run(claims: object[]) {
  const sandbox = await DockerSandbox.create({ imageId, jobId: `claims-${randomUUID().slice(0, 8)}`, contextId: randomUUID(), files: [
    { path: "input/source.pdf", bytes: buildBinarySource("pdf", paragraphs) }, { path: "input/source.docx", bytes: buildBinarySource("docx", paragraphs) },
    { path: "output/report.md", bytes: Buffer.from(report) }, { path: CLAIMS_LEDGER_PATH, bytes: Buffer.from(JSON.stringify({ version: 1, claims })) }] });
  try {
    const result = await sandbox.execute(checkCommand(claimsLedgerCheck({ reportPath: "output/report.md", sources })), { timeoutMs: 60_000 });
    return { exitCode: result.exitCode, stderr: result.stderr, result: JSON.parse(result.stdout) as { passed: boolean; claims: { locator?: string; code?: string }[] } };
  } finally { await sandbox.close(); }
}

describe.skipIf(!enabled)("research claims ledger check inside the real sandbox image", () => {
  it("verifies PDF and DOCX quotes with pypdf and the document XML and names page and paragraph", async () => {
    const passed = await run([{ id: "C1", sentence: "a", sourceId: "input/source.pdf", quote: "produced 42 units in May 2026" },
      { id: "C2", sentence: "b", sourceId: "input/source.docx", quote: "Alpha page about the plant" }]);
    expect(passed).toMatchObject({ exitCode: 0, result: { passed: true, claims: [{ locator: "page 2" }, { locator: "paragraph 1" }] } });
    const fabricated = await run([{ id: "C1", sentence: "a", sourceId: "input/source.pdf", quote: "produced 43 units" },
      { id: "C2", sentence: "b", sourceId: "input/source.docx", quote: "Alpha page about the plant" }]);
    expect(fabricated).toMatchObject({ exitCode: 1, result: { passed: false, claims: [{ code: "quote_not_found" }, { locator: "paragraph 1" }] } });
  }, 120_000);
});
