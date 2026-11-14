import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAIMS_CONTEXT_BYTES, CLAIMS_CONTEXT_CHARS, CLAIMS_CONTEXT_ENV, CLAIMS_LEDGER_CHECK_ID, CLAIMS_LEDGER_PATH, CLAIMS_MARKUP_STRIP_PY, CLAIMS_OUTPUT_BUDGET_BYTES, CLAIMS_REPORT_STRIP_PY, CLAIMS_RETAINED_ENV, CLAIMS_SECTION_RULE_PY, CheckClaimsOutputSchema, ClaimsLedgerSchema, ClaimsVerifiedClaimSchema, ENTAILMENT_PURPOSE, ENTAILMENT_SYSTEM_PROMPT, EntailmentReplySchema, claimsInstructions, claimsLedgerCheck, encodeRetainedClaimsSources, entailmentMessages, judgeClaims, publicSourceWorkspacePath } from "../../src/main/private-agent/claims";
import { BrokerError } from "../../src/main/private-agent/broker";
import { digest } from "../../src/main/private-agent/contracts";
import { buildBinarySource, buildDocxFromXml, hasIsolatedPypdf } from "../helpers/claims-fixtures";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0).reverse()) done(); });

const notes = "Alpha report, first edition.\nThe reactor produced 42 units in May 2026.\nMaintenance   was deferred\nuntil June.\n";
const page = "<html><head><style>p{color:red}</style></head><body><h1>Bravo &amp; Charlie</h1><p>Output fell by <b>12 percent</b> after the outage.</p><script>var x=1;</script></body></html>";
const sources = [{ id: "input/notes.txt", path: "input/notes.txt" }, { id: "https://example.test/page", path: "sources/page.bin" }];

/** Runs the host-owned check with the local python against a temporary workspace, exactly as the verifier container would. */
function run(files: Record<string, string | Buffer>, extra: { sources?: typeof sources; publicSources?: boolean; retained?: Parameters<typeof encodeRetainedClaimsSources>[0]; reportPath?: string; context?: boolean; timeoutMs?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), "soar-claims-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), content); }
  const check = claimsLedgerCheck({ reportPath: extra.reportPath ?? "output/report.md", sources: extra.sources ?? sources, publicSources: extra.publicSources, root });
  expect(check.id).toBe(CLAIMS_LEDGER_CHECK_ID);
  const env = { ...process.env, ...(extra.retained ? { [CLAIMS_RETAINED_ENV]: encodeRetainedClaimsSources(extra.retained) } : {}), ...(extra.context ? { [CLAIMS_CONTEXT_ENV]: "1" } : {}) };
  try { return { exitCode: 0, result: JSON.parse(execFileSync("python3", ["-I", "-c", check.python], { encoding: "utf8", env, ...(extra.timeoutMs ? { timeout: extra.timeoutMs } : {}) })) }; }
  catch (error) {
    const failure = error as { status: number | null; stdout: string; signal?: string | null; code?: string };
    // A check stopped by `timeoutMs` has no JSON to parse: say so instead. Any other signal (a full output buffer, a kill) is rethrown as it is.
    if (failure.code === "ETIMEDOUT") throw new Error(`claims check stopped at the ${extra.timeoutMs} ms bound`);
    if (failure.signal) throw error;
    return { exitCode: failure.status, result: JSON.parse(failure.stdout) };
  }
}
const ledger = (claims: object[]) => JSON.stringify({ version: 1, claims });
const report = "# Findings\n\nThe reactor produced 42 units in May 2026 [C1]. Output fell by 12 percent after the outage [C2].\n\n## Conflicting evidence\n\nnone found\n\n## Unanswered questions\n\nnone\n";

describe("research claims ledger check", () => {
  it("verifies verbatim quotes across whitespace and HTML, computes locators and resolves citations", () => {
    const { exitCode, result } = run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report,
      [CLAIMS_LEDGER_PATH]: ledger([
        { id: "C1", sentence: "The reactor produced 42 units in May 2026.", sourceId: "input/notes.txt", quote: "produced 42 units in May 2026" },
        { id: "C2", sentence: "Output fell by 12 percent after the outage.", sourceId: "https://example.test/page", quote: "Output fell by 12 percent after the outage.", locator: "ignored model locator" }]) });
    expect(exitCode).toBe(0);
    expect(result).toMatchObject({ passed: true, claims: [{ id: "C1", found: true, locator: "line 2" }, { id: "C2", found: true, locator: "html text" }],
      report: { citations: { missing: [], unknown: [] }, sections: { "Conflicting evidence": true, "Unanswered questions": true } } });
  });
  it("locates a quote that spans lines and ignores NFKC and whitespace differences", () => {
    const { result } = run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report.replace("[C2]", "[C1]"),
      [CLAIMS_LEDGER_PATH]: ledger([{ id: "C1", sentence: "Maintenance was deferred until June.", sourceId: "input/notes.txt", quote: "Maintenance was  deferred until June" }]) });
    expect(result).toMatchObject({ passed: true, claims: [{ id: "C1", found: true, locator: "lines 3-4" }] });
  });
  it("fails on a fabricated quote, an unknown source, a missing citation, an unknown citation or a missing section", () => {
    const fabricated = run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report,
      [CLAIMS_LEDGER_PATH]: ledger([{ id: "C1", sentence: "x", sourceId: "input/notes.txt", quote: "produced 42 units" }, { id: "C2", sentence: "y", sourceId: "https://example.test/page", quote: "Output rose by 12 percent" }]) });
    expect(fabricated.exitCode).toBe(1);
    expect(fabricated.result).toMatchObject({ passed: false, claims: [{ id: "C1", found: true }, { id: "C2", found: false, code: "quote_not_found" }] });
    const unknownSource = run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report,
      [CLAIMS_LEDGER_PATH]: ledger([{ id: "C1", sentence: "x", sourceId: "input/notes.txt", quote: "produced 42 units" }, { id: "C2", sentence: "y", sourceId: "input/other.txt", quote: "anything whatsoever" }]) });
    expect(unknownSource.result.claims[1]).toMatchObject({ found: false, code: "unknown_source" });
    const citations = run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report.replace("[C2]", "[C7]"),
      [CLAIMS_LEDGER_PATH]: ledger([{ id: "C1", sentence: "x", sourceId: "input/notes.txt", quote: "produced 42 units" }, { id: "C2", sentence: "y", sourceId: "https://example.test/page", quote: "fell by 12 percent" }]) });
    expect(citations.result).toMatchObject({ passed: false, report: { citations: { missing: ["C2"], unknown: ["C7"] } } });
    const sections = run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report.replace("## Unanswered questions", "## Open points"),
      [CLAIMS_LEDGER_PATH]: ledger([{ id: "C1", sentence: "x", sourceId: "input/notes.txt", quote: "produced 42 units" }, { id: "C2", sentence: "y", sourceId: "https://example.test/page", quote: "fell by 12 percent" }]) });
    expect(sections.result).toMatchObject({ passed: false, report: { sections: { "Conflicting evidence": true, "Unanswered questions": false } } });
  });
  it("rejects a malformed, oversized or duplicate-id ledger and refuses unsafe source paths without crashing", () => {
    expect(run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report, [CLAIMS_LEDGER_PATH]: "{\"version\":2}" }).result).toMatchObject({ passed: false, code: "ledger_schema" });
    const oversized = JSON.stringify({ version: 1, claims: [{ id: "C1", sentence: "x", sourceId: "input/notes.txt", quote: "produced 42 units" }], padding: "p".repeat(262144) });
    expect(run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report, [CLAIMS_LEDGER_PATH]: oversized }).result).toMatchObject({ passed: false, code: "ledger_size_limit" });
    expect(run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report,
      [CLAIMS_LEDGER_PATH]: ledger([{ id: "C1", sentence: "x", sourceId: "input/notes.txt", quote: "produced 42 units" }, { id: "C1", sentence: "y", sourceId: "input/notes.txt", quote: "x" }]) }).result).toMatchObject({ passed: false, code: "claim_id" });
    expect(run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report,
      [CLAIMS_LEDGER_PATH]: ledger([{ id: "C1", sentence: "x", sourceId: "escape", quote: "produced 42 units" }]) }, { sources: [{ id: "escape", path: "../outside.txt" }] }).result)
      .toMatchObject({ passed: false, code: "invalid_path" });
    expect(() => claimsLedgerCheck({ reportPath: "output/report.md", sources: [] })).toThrow("claims_sources_invalid");
    expect(claimsLedgerCheck({ reportPath: "output/report.md", sources: [], publicSources: true }).id).toBe(CLAIMS_LEDGER_CHECK_ID);
    expect(() => claimsLedgerCheck({ reportPath: "output/report.md", sources: [sources[0]!, sources[0]!] })).toThrow("claims_sources_invalid");
  });
  it("exposes a strict ledger schema, deterministic workspace paths for public sources and host instructions", () => {
    const quote = "a quote of twelve or more characters";
    expect(ClaimsLedgerSchema.safeParse({ version: 1, claims: [{ id: "C1", sentence: "s", sourceId: "a", quote }] }).success).toBe(true);
    expect(ClaimsLedgerSchema.safeParse({ version: 1, claims: [{ id: "C1", sentence: "s", sourceId: "a", quote }, { id: "C1", sentence: "t", sourceId: "a", quote }] }).success).toBe(false);
    expect(ClaimsLedgerSchema.safeParse({ version: 1, claims: [{ id: "claim-1", sentence: "s", sourceId: "a", quote }] }).success).toBe(false);
    expect(ClaimsLedgerSchema.safeParse({ version: 1, claims: [{ id: "C1", sentence: "s", sourceId: "a", quote: "too short" }] }).success).toBe(false);
    expect(publicSourceWorkspacePath("https://example.test/a?b=1")).toMatch(/^sources\/[a-f0-9]{16}\.bin$/u);
    expect(publicSourceWorkspacePath("https://example.test/a?b=1")).toBe(publicSourceWorkspacePath("HTTPS://example.test/a?b=1"));
    expect(publicSourceWorkspacePath("https://example.test/a?b=2")).not.toBe(publicSourceWorkspacePath("https://example.test/a?b=1"));
    const text = claimsInstructions("output/report.md", sources);
    expect(text).toContain(CLAIMS_LEDGER_PATH); expect(text).toContain("[C1]"); expect(text).toContain("check_claims"); expect(text).toContain("Conflicting evidence");
    expect(text).not.toContain("fetch_public reported"); expect(claimsInstructions("output/report.md", [], true)).toContain("exact url that fetch_public reported");
  });
});

describe("research claims ledger check hardening", () => {
  const one = (quote: string, sourceId = "input/notes.txt") => ledger([{ id: "C1", sentence: "s", sourceId, quote }]);
  const single = report.replace(" Output fell by 12 percent after the outage [C2].", "");
  it("rejects a quote shorter than the minimum after normalisation", () => {
    expect(run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": single, [CLAIMS_LEDGER_PATH]: one("42   units") }).result)
      .toMatchObject({ passed: false, claims: [{ id: "C1", found: false, code: "quote_too_short" }] });
  });
  it("ignores citations inside code fences and HTML comments and requires an exact heading line", () => {
    const hidden = "# Findings\n\nThe reactor produced 42 units.\n\n```\n[C1]\n```\n<!-- [C1] -->\nConflicting evidence was weighed carefully.\n\n**Unanswered questions:**\n\nnone\n";
    expect(run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": hidden, [CLAIMS_LEDGER_PATH]: one("produced 42 units") }).result)
      .toMatchObject({ passed: false, report: { citations: { missing: ["C1"], unknown: [] }, sections: { "Conflicting evidence": false, "Unanswered questions": true } } });
  });
  it("resolves a retained public source by its exact URL, verifies the host digest and refuses anything else", () => {
    const url = "https://example.test/page", path = "sources/0123456789abcdef.bin";
    const retained = [{ url, path, sha256: digest(Buffer.from(page)) }];
    const files = { "input/notes.txt": notes, [path]: page, "output/report.md": single, [CLAIMS_LEDGER_PATH]: one("fell by 12 percent", url) };
    expect(run(files, { sources: [], publicSources: true, retained }).result).toMatchObject({ passed: true, claims: [{ id: "C1", found: true, locator: "html text" }] });
    // A model edit of the workspace copy is detected by the digest the host passed in.
    expect(run({ ...files, [path]: page.replace("fell by", "rose by") }, { sources: [], publicSources: true, retained }).result).toMatchObject({ passed: false, claims: [{ found: false, code: "source_tampered" }] });
    // A URL the host never retained, and a URL cited when public sources are not enabled, are unknown.
    expect(run(files, { sources: [], publicSources: true, retained: [{ ...retained[0]!, url: "https://example.test/other" }] }).result).toMatchObject({ passed: false, claims: [{ found: false, code: "unknown_source" }] });
    expect(run(files, { sources: [sources[0]!], publicSources: false, retained }).result).toMatchObject({ passed: false, claims: [{ found: false, code: "unknown_source" }] });
    // Without the environment (a model running the script itself) nothing public resolves.
    expect(run(files, { sources: [], publicSources: true }).result).toMatchObject({ passed: false, claims: [{ found: false, code: "unknown_source" }] });
  });
  it("detects PDF and DOCX bytes by content under any file name and joins DOCX runs inside a paragraph", () => {
    const docx = buildBinarySource("docx", ["Alpha paragraph.", "The reactor produ|ced 42 units in May 2026."]);
    expect(run({ "input/notes.txt": notes, "sources/abc.bin": docx, "output/report.md": single, [CLAIMS_LEDGER_PATH]: one("produced 42 units in May 2026", "doc") },
      { sources: [{ id: "doc", path: "sources/abc.bin" }] }).result).toMatchObject({ passed: true, claims: [{ found: true, locator: "paragraph 2" }] });
  });
  it("reads a DOCX deliverable for citations and headings", () => {
    const deliverable = buildBinarySource("docx", ["The reactor produced 42 units [C1].", "Conflicting evidence", "none found", "Unanswered questions", "none"]);
    expect(run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.docx": deliverable, [CLAIMS_LEDGER_PATH]: one("produced 42 units") }, { reportPath: "output/report.docx" }).result)
      .toMatchObject({ passed: true, report: { citations: { missing: [], unknown: [] }, sections: { "Conflicting evidence": true, "Unanswered questions": true } } });
  });
});

function runBinary(kind: "pdf" | "docx", paragraphs: string[], quote: string) {
  const root = mkdtempSync(join(tmpdir(), "soar-claims-bin-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const path = `input/source.${kind}`; mkdirSync(join(root, "input")); mkdirSync(join(root, "output"));
  writeFileSync(join(root, path), buildBinarySource(kind, paragraphs));
  writeFileSync(join(root, "output/report.md"), "Claim [C1].\n\n## Conflicting evidence\n\nnone\n\n## Unanswered questions\n\nnone\n");
  writeFileSync(join(root, CLAIMS_LEDGER_PATH), ledger([{ id: "C1", sentence: "Claim.", sourceId: "doc", quote }]));
  const check = claimsLedgerCheck({ reportPath: "output/report.md", sources: [{ id: "doc", path }], root });
  const run = spawnSync("python3", ["-I", "-c", check.python], { encoding: "utf8" });
  return { exitCode: run.status, result: JSON.parse(run.stdout) as { passed: boolean; claims: { locator?: string; code?: string }[] } };
}

describe("research claims ledger check on binary sources", () => {
  it("reads DOCX paragraphs from the document XML and names the paragraph or the paragraph span", () => {
    const paragraphs = ["Alpha paragraph about the plant.", "The reactor produced 42 units in May 2026.", "Closing remarks."];
    expect(runBinary("docx", paragraphs, "produced 42 units in May")).toMatchObject({ exitCode: 0, result: { passed: true, claims: [{ locator: "paragraph 2" }] } });
    expect(runBinary("docx", paragraphs, "about the plant. The reactor")).toMatchObject({ exitCode: 0, result: { passed: true, claims: [{ locator: "paragraph 1 to paragraph 2" }] } });
    expect(runBinary("docx", paragraphs, "produced 43 units")).toMatchObject({ exitCode: 1, result: { passed: false, claims: [{ code: "quote_not_found" }] } });
  });
  it.skipIf(!hasIsolatedPypdf())("reads PDF pages through pypdf and names the page", () => {
    const pages = ["Alpha page about the plant.", "The reactor produced 42 units in May 2026."];
    expect(runBinary("pdf", pages, "produced 42 units in May 2026")).toMatchObject({ exitCode: 0, result: { passed: true, claims: [{ locator: "page 2" }] } });
    expect(runBinary("pdf", pages, "produced 43 units")).toMatchObject({ exitCode: 1, result: { passed: false, claims: [{ code: "quote_not_found" }] } });
  });
  it("reports a corrupt binary source as invalid rather than crashing", () => {
    const root = mkdtempSync(join(tmpdir(), "soar-claims-bad-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "input")); mkdirSync(join(root, "output")); writeFileSync(join(root, "input/source.docx"), "not a zip");
    writeFileSync(join(root, "output/report.md"), "Claim [C1].\n## Conflicting evidence\nnone\n## Unanswered questions\nnone\n");
    writeFileSync(join(root, CLAIMS_LEDGER_PATH), ledger([{ id: "C1", sentence: "Claim.", sourceId: "doc", quote: "anything" }]));
    const run = spawnSync("python3", ["-I", "-c", claimsLedgerCheck({ reportPath: "output/report.md", sources: [{ id: "doc", path: "input/source.docx" }], root }).python], { encoding: "utf8" });
    expect(run.status).toBe(1); expect(JSON.parse(run.stdout)).toMatchObject({ passed: false, code: "ledger_invalid" });
  });
});

describe("research claims entailment inputs", () => {
  const one = (quote: string) => ledger([{ id: "C1", sentence: "The reactor produced 42 units in May 2026.", sourceId: "input/notes.txt", quote }]);
  const single = report.replace(" Output fell by 12 percent after the outage [C2].", "");
  it("emits sentence, quote and a bounded source window per verified claim only when the host asks for it", () => {
    const plain = run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": single, [CLAIMS_LEDGER_PATH]: one("produced 42 units in May 2026") });
    expect(plain.result.claims[0]).not.toHaveProperty("context"); expect(plain.result.claims[0]).not.toHaveProperty("sentence");
    const long = "Filler sentence number %d that pads the source well beyond the window. ";
    const padded = Array.from({ length: 40 }, (_, i) => long.replace("%d", String(i))).join("") + notes + Array.from({ length: 40 }, (_, i) => long.replace("%d", String(100 + i))).join("");
    const judged = run({ "input/notes.txt": padded, "sources/page.bin": page, "output/report.md": single, [CLAIMS_LEDGER_PATH]: one("produced 42 units in May 2026") }, { context: true });
    const claim = judged.result.claims[0] as { found: boolean; sentence: string; quote: string; context: string };
    expect(claim).toMatchObject({ found: true, sentence: "The reactor produced 42 units in May 2026.", quote: "produced 42 units in May 2026" });
    expect(claim.context).toContain("produced 42 units in May 2026"); expect(claim.context.length).toBeLessThanOrEqual(CLAIMS_CONTEXT_CHARS);
    expect(claim.context.length).toBeGreaterThan(CLAIMS_CONTEXT_CHARS - 40);
    expect(CheckClaimsOutputSchema.parse(judged.result).claims[0]!.context).toBe(claim.context);
    const fabricated = run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": single, [CLAIMS_LEDGER_PATH]: one("produced 43 units in May 2026") }, { context: true });
    expect(fabricated.result.claims[0]).toMatchObject({ found: false }); expect(fabricated.result.claims[0]).not.toHaveProperty("context");
  });
  it("builds a fresh two-message judge prompt and accepts only the four verdicts", () => {
    const messages = entailmentMessages({ id: "C1", sentence: "s", quote: "q", context: "ctx" });
    expect(messages.map(message => message.role)).toEqual(["system", "user"]);
    expect(messages[0]!.content).toBe(ENTAILMENT_SYSTEM_PROMPT); expect(messages[1]!.content).toContain("\"s\""); expect(messages[1]!.content).toContain("ctx");
    expect(EntailmentReplySchema.safeParse({ verdict: "partial", reason: "r" }).success).toBe(true);
    expect(EntailmentReplySchema.safeParse({ verdict: "maybe" }).success).toBe(false);
    expect(EntailmentReplySchema.safeParse({ verdict: "supported", extra: 1 }).success).toBe(false);
  });
});

describe("research claims entailment pass", () => {
  const claims = [{ id: "C1", sentence: "a", quote: "q1", context: "ctx1" }, { id: "C2", sentence: "b", quote: "q2", context: "ctx2" }, { id: "C3", sentence: "c", quote: "q3", context: "ctx3" }];
  const stub = (replies: (string | Error)[]) => {
    const calls: { tools: unknown; overrides: unknown }[] = [];
    const complete = async (_messages: unknown, tools: [], _signal: AbortSignal, overrides: { thinking: "disabled"; maxOutputTokens: number; purpose: string }) => {
      calls.push({ tools, overrides }); const reply = replies[calls.length - 1]!; if (reply instanceof Error) throw reply; return { content: reply };
    };
    return { calls, complete };
  };
  const far = () => 10 * 60_000;
  it("judges each claim with a tool-less, thinking-off call and counts the verdicts", async () => {
    const { calls, complete } = stub(['{"verdict":"supported","reason":"r1"}', 'Sure: {"verdict":"contradicted","reason":"r2"} done', '{"verdict":"partial"}']);
    const outcome = await judgeClaims({ claims, complete, signal: new AbortController().signal, remainingMs: far });
    expect(calls).toHaveLength(3); expect(calls[0]).toEqual({ tools: [], overrides: { thinking: "disabled", maxOutputTokens: 256, purpose: ENTAILMENT_PURPOSE } });
    expect(outcome).toEqual({ entailmentCalls: 3, truncated: false, counts: { supported: 1, partial: 1, unsupported: 0, contradicted: 1, not_judged: 0 },
      verdicts: [{ id: "C1", verdict: "supported", reason: "r1" }, { id: "C2", verdict: "contradicted", reason: "r2" }, { id: "C3", verdict: "partial" }] });
  });
  it("never throws: invalid replies and hostile reason text become not_judged or lose the reason, a transport failure stops the pass", async () => {
    // The JSON escape reaches the parser as text, so the reason decodes to a NUL and is dropped as invalid exact text.
    const { complete } = stub(["no json", '{"verdict":"supported","reason":"bad\\u0000text"}', new Error("transport_or_settlement_unknown")]);
    const outcome = await judgeClaims({ claims, complete, signal: new AbortController().signal, remainingMs: far });
    expect(outcome).toMatchObject({ entailmentCalls: 3, truncated: true, stopReason: "request_failed", counts: { supported: 1, not_judged: 2 },
      verdicts: [{ id: "C1", verdict: "not_judged", reason: "judge_reply_invalid" }, { id: "C2", verdict: "supported" }, { id: "C3", verdict: "not_judged", reason: "judge_request_failed" }] });
    expect(outcome.verdicts[1]).not.toHaveProperty("reason");
    const more = stub([new Error("x"), '{"verdict":"supported"}']);
    const stopped = await judgeClaims({ claims, complete: more.complete, signal: new AbortController().signal, remainingMs: far });
    expect(more.calls).toHaveLength(1);
    expect(stopped.verdicts).toEqual([{ id: "C1", verdict: "not_judged", reason: "judge_request_failed" }, { id: "C2", verdict: "not_judged", reason: "pass_stopped" }, { id: "C3", verdict: "not_judged", reason: "pass_stopped" }]);
  });
  it("stops at its clock reserve or on cancellation and skips claims whose window was dropped", async () => {
    let remaining = 60_000;
    const { calls, complete } = stub(['{"verdict":"supported"}', '{"verdict":"supported"}']);
    const outcome = await judgeClaims({ claims, complete: async (...args) => { remaining = 10_000; return complete(...args); }, signal: new AbortController().signal, remainingMs: () => remaining });
    expect(calls).toHaveLength(1); expect(outcome).toMatchObject({ truncated: true, stopReason: "deadline_or_cancelled", counts: { supported: 1, not_judged: 2 } });
    expect(outcome.verdicts.map(row => row.reason)).toEqual([undefined, "deadline_or_cancelled", "pass_stopped"]);
    const aborted = new AbortController(); aborted.abort();
    expect(await judgeClaims({ claims, complete, signal: aborted.signal, remainingMs: far })).toMatchObject({ entailmentCalls: 0, truncated: true, counts: { not_judged: 3 } });
    expect(await judgeClaims({ claims: [{ ...claims[0]!, context: "" }], complete, signal: new AbortController().signal, remainingMs: far }))
      .toMatchObject({ entailmentCalls: 0, truncated: false, verdicts: [{ id: "C1", verdict: "not_judged", reason: "context_omitted" }] });
  });
  it("bounds every window by escaped bytes and the whole check output by the sandbox budget, dropping windows from the end", () => {
    const cjk = "\u5de5\u5382\u5728\u4e94\u6708\u751f\u4ea7\u4e86\u56db\u5341\u4e8c\u4ef6\u3002";
    const source = Array.from({ length: 40 }, (_, i) => `${cjk.repeat(60)} marker-${i} claim text number ${i} ${cjk.repeat(60)}`).join("\n");
    // Astral characters escape to twelve bytes each, so forty 300-character sentences alone exceed the output budget.
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `C${i + 1}`, sentence: "\uD83D\uDE00".repeat(300), sourceId: "input/notes.txt", quote: `marker-${i} claim text number ${i}` }));
    const text = "# R\n" + rows.map(row => `[${row.id}]`).join(" ") + "\n\n## Conflicting evidence\n\nnone\n\n## Unanswered questions\n\nnone\n";
    const { exitCode, result } = run({ "input/notes.txt": source, "sources/page.bin": page, "output/report.md": text, [CLAIMS_LEDGER_PATH]: ledger(rows) }, { context: true });
    expect(exitCode).toBe(0); expect(result.passed).toBe(true);
    const contexts = (result.claims as { context: string }[]).map(claim => claim.context);
    expect(Math.max(...contexts.map(context => JSON.stringify(context).length))).toBeLessThanOrEqual(CLAIMS_CONTEXT_BYTES);
    expect(contexts[0]).toContain("marker-0");
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(CLAIMS_OUTPUT_BUDGET_BYTES * 2);
    expect(JSON.stringify(result).replace(/[^\x00-\x7f]/gu, "\\uXXXX").length).toBeLessThanOrEqual(CLAIMS_OUTPUT_BUDGET_BYTES * 2);
    expect(contexts.filter(context => context === "").length).toBeGreaterThan(0);
    expect(contexts.at(-1)).toBe("");
  });
});

describe("research claims entailment hardening", () => {
  const cjk = "\u5de5\u5382\u5728\u4e94\u6708\u751f\u4ea7\u4e86\u56db\u5341\u4e8c\u4ef6\u3002";
  it("keeps the verified quote inside a byte-trimmed window even at the edge of a non-ASCII line", () => {
    const quote = "marker quote at the edge";
    const source = `${quote} ${cjk.repeat(200)}\n${cjk.repeat(200)} ${quote}\n`;
    const rows = [{ id: "C1", sentence: "s", sourceId: "input/notes.txt", quote }];
    const text = "[C1]\n\n## Conflicting evidence\n\nnone\n\n## Unanswered questions\n\nnone\n";
    const { result } = run({ "input/notes.txt": source, "sources/page.bin": page, "output/report.md": text, [CLAIMS_LEDGER_PATH]: ledger(rows) }, { context: true });
    const context = (result.claims[0] as { context: string }).context;
    expect(context).toContain(quote); expect(JSON.stringify(context).length).toBeLessThanOrEqual(CLAIMS_CONTEXT_BYTES);
  });
  it("bounds verified claims in code points, the unit the python check uses", () => {
    const astral = "\uD83D\uDE00";
    expect(ClaimsVerifiedClaimSchema.safeParse({ id: "C1", sentence: astral.repeat(600), quote: astral.repeat(300), context: astral.repeat(1200) }).success).toBe(true);
    expect(ClaimsVerifiedClaimSchema.safeParse({ id: "C1", sentence: astral.repeat(601), quote: "q".repeat(12), context: "" }).success).toBe(false);
    expect(ClaimsVerifiedClaimSchema.safeParse({ id: "C1", sentence: "", quote: "q".repeat(12), context: "" }).success).toBe(false);
  });
  it("drops sentence and quote from trailing claims when blank windows still exceed the output budget", () => {
    const astral = "\uD83D\uDE00";
    const source = Array.from({ length: 40 }, (_, i) => `marker-${i} claim text number ${i}`).join("\n");
    // 40 sentences of 600 astral characters escape to 288,000 bytes before any window: the second stage must act.
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `C${i + 1}`, sentence: astral.repeat(600), sourceId: "input/notes.txt", quote: `marker-${i} claim text number ${i}` }));
    const text = "# R\n" + rows.map(row => `[${row.id}]`).join(" ") + "\n\n## Conflicting evidence\n\nnone\n\n## Unanswered questions\n\nnone\n";
    const { exitCode, result } = run({ "input/notes.txt": source, "sources/page.bin": page, "output/report.md": text, [CLAIMS_LEDGER_PATH]: ledger(rows) }, { context: true });
    expect(exitCode).toBe(0); expect(result.passed).toBe(true);
    const claims = result.claims as { id: string; found: boolean; sentence?: string }[];
    expect(claims).toHaveLength(40); expect(claims.every(claim => claim.found)).toBe(true);
    expect(claims[0]).toHaveProperty("sentence"); expect(claims.at(-1)).not.toHaveProperty("sentence");
    expect(JSON.stringify(result).replace(/[^\x00-\x7f]/gu, "\\uXXXX\\uXXXX").length).toBeLessThanOrEqual(CLAIMS_OUTPUT_BUDGET_BYTES + 2_000);
  });
  it("honours a pause at the next claim boundary and labels the rest paused", async () => {
    const claims = [{ id: "C1", sentence: "a", quote: "q1", context: "ctx1" }, { id: "C2", sentence: "b", quote: "q2", context: "ctx2" }];
    let paused = false;
    const outcome = await judgeClaims({ claims, signal: new AbortController().signal, remainingMs: () => 600_000, stop: () => paused,
      complete: async () => { paused = true; return { content: '{"verdict":"supported"}' }; } });
    expect(outcome).toMatchObject({ entailmentCalls: 1, truncated: true, stopReason: "paused", verdicts: [{ id: "C1", verdict: "supported" }, { id: "C2", verdict: "not_judged", reason: "paused" }] });
  });
});

describe("E1 recoverability: a judge call stopped mid-request is labelled by why it stopped (E1-J)", () => {
  const claims = [{ id: "C1", sentence: "a", quote: "q1", context: "ctx1" }, { id: "C2", sentence: "b", quote: "q2", context: "ctx2" }, { id: "C3", sentence: "c", quote: "q3", context: "ctx3" }];
  const rest = [{ id: "C2", verdict: "not_judged", reason: "pass_stopped" }, { id: "C3", verdict: "not_judged", reason: "pass_stopped" }];
  /** The broker's answer to a zero-fee judge call cut by its own signal: the row resolves `failed` and the call rejects `request_failed`. */
  const stoppedCall = (stop: () => void) => async () => { stop(); throw new BrokerError("request_failed"); };
  it("records a judge call cancelled mid-request as deadline_or_cancelled, not as a request failure", async () => {
    const cancel = new AbortController();
    const outcome = await judgeClaims({ claims, signal: cancel.signal, remainingMs: () => 600_000, complete: stoppedCall(() => cancel.abort()) });
    expect(outcome).toEqual({ entailmentCalls: 1, truncated: true, stopReason: "deadline_or_cancelled", counts: { supported: 0, partial: 0, unsupported: 0, contradicted: 0, not_judged: 3 },
      verdicts: [{ id: "C1", verdict: "not_judged", reason: "deadline_or_cancelled" }, ...rest] });
  });
  it("records a judge call the pass's own clock cut mid-request as deadline_or_cancelled", async () => {
    // The session joins the pass's deadline into the signal as AbortSignal.timeout; here a real 5 ms timer cuts a call that would never answer.
    const signal = AbortSignal.any([AbortSignal.timeout(5)]);
    const hanging = (_messages: unknown, _tools: [], callSignal: AbortSignal) => new Promise<{ content: string }>((_resolve, reject) =>
      callSignal.addEventListener("abort", () => reject(new BrokerError("request_failed")), { once: true }));
    const outcome = await judgeClaims({ claims, signal, remainingMs: () => 600_000, complete: hanging });
    expect(outcome).toMatchObject({ entailmentCalls: 1, truncated: true, stopReason: "deadline_or_cancelled", verdicts: [{ id: "C1", verdict: "not_judged", reason: "deadline_or_cancelled" }, ...rest] });
  });
  it("records a judge call a pause stopped mid-request as paused, as a pause at a claim boundary is", async () => {
    // The session's pause aborts the pass's own signal and sets the stop flag; it then discards a truncated outcome for the resume.
    const pass = new AbortController();
    let paused = false;
    const outcome = await judgeClaims({ claims, signal: pass.signal, remainingMs: () => 600_000, stop: () => paused, complete: stoppedCall(() => { paused = true; pass.abort(); }) });
    expect(outcome).toMatchObject({ entailmentCalls: 1, truncated: true, stopReason: "paused", verdicts: [{ id: "C1", verdict: "not_judged", reason: "paused" }, ...rest] });
  });
  it("keeps judge_request_failed for a call that failed while nothing stopped it, even with a pause requested and the clock run down", async () => {
    let paused = false, remaining = 600_000;
    const outcome = await judgeClaims({ claims, signal: new AbortController().signal, remainingMs: () => remaining, stop: () => paused,
      complete: async () => { paused = true; remaining = 0; throw new BrokerError("request_failed"); } });
    expect(outcome).toMatchObject({ entailmentCalls: 1, truncated: true, stopReason: "request_failed", verdicts: [{ id: "C1", verdict: "not_judged", reason: "judge_request_failed" }, ...rest] });
  });
});

describe("E1 recoverability: the claims check's heading strip, same result without quadratic time (E1-J2)", () => {
  const claims = ledger([
    { id: "C1", sentence: "The reactor produced 42 units in May 2026.", sourceId: "input/notes.txt", quote: "produced 42 units in May 2026" },
    { id: "C2", sentence: "Output fell by 12 percent after the outage.", sourceId: "https://example.test/page", quote: "Output fell by 12 percent after the outage." }]);
  it("checks a report holding a 1,000,000-character run of the strip's characters inside a line before both headings within a 20 s bound", () => {
    // The former strip, re.sub(r'[*_:\s]+$', '', line), retried a run that does not reach the line's end from each of its positions: both
    // titles' scans reach this line, and each would take tens of minutes. The linear strip takes well under a second.
    const line = `Context ${" _*:".repeat(250_000)}end`;
    const { exitCode, result } = run({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report.replace("## Conflicting evidence", `${line}\n\n## Conflicting evidence`),
      [CLAIMS_LEDGER_PATH]: claims }, { timeoutMs: 20_000 });
    expect(exitCode).toBe(0);
    expect(result).toMatchObject({ passed: true, report: { citations: { missing: [], unknown: [] }, sections: { "Conflicting evidence": true, "Unanswered questions": true } } });
  }, 30_000);
  it("returns what the former pattern and a regex-free strip return, on every string of up to five characters from twelve and on 2,000 longer ones", () => {
    // Compared inside Python, which prints a summary only. The alphabet: s, #, a backslash, * _ : and space, tab, newline, vertical tab,
    // U+00A0 (all whitespace), and U+200B (not whitespace).
    const script = String.raw`import itertools, json, random, re
${CLAIMS_SECTION_RULE_PY}
def former(text):
 return re.sub(r'[*_:\s]+$','',text)
def plain(text):
 end=len(text)
 while end and (text[end-1] in '*_:' or text[end-1].isspace()): end-=1
 return text[:end]
alphabet='s#\\*_: \t\n\x0b\xa0\u200b'
strings=[''.join(chars) for n in range(6) for chars in itertools.product(alphabet,repeat=n)]
rng=random.Random(20261110)
strings+=[''.join(rng.choice(alphabet) for _ in range(rng.randrange(6,301))) for _ in range(2000)]
bad=[text for text in strings if not strip_trailing(text)==former(text)==plain(text)]
print(json.dumps({'alphabet':len(alphabet),'checked':len(strings),'mismatches':len(bad),'first':bad[:3]}))`;
    expect(JSON.parse(execFileSync("python3", ["-I", "-c", script], { encoding: "utf8" }))).toEqual({ alphabet: 12, checked: 273_453, mismatches: 0, first: [] });
  }, 30_000);
  it("gives fixed results read from TypeScript, so an escaping slip that broke both regex sides alike would still show", () => {
    expect(CLAIMS_SECTION_RULE_PY).toContain(String.raw`re.match(r'[*_:\s]*',text[::-1])`);
    const cases = ["Unanswered questions:  ", "**Conflicting evidence**", "Questions", "a s", "a\\", "x\u00a0\n\t*", "x\u200b", "", " _*:"];
    const script = `import json, re, sys\n${CLAIMS_SECTION_RULE_PY}\ncases=json.load(sys.stdin)\nprint(json.dumps({'stripped':[strip_trailing(text) for text in cases],` +
      `'present':[section_present(['## Unanswered questions:**'],'unanswered QUESTIONS'),section_present(['Unanswered questionss'],'Unanswered questions')]}))`;
    expect(JSON.parse(execFileSync("python3", ["-I", "-c", script], { input: JSON.stringify(cases), encoding: "utf8" }))).toEqual({
      stripped: ["Unanswered questions", "**Conflicting evidence", "Questions", "a s", "a\\", "x", "x\u200b", "", ""], present: [true, false] });
  });
  it("runs that rule in the check, and the former pattern nowhere in it", () => {
    const python = claimsLedgerCheck({ reportPath: "output/report.md", sources }).python;
    expect(python).toContain(CLAIMS_SECTION_RULE_PY);
    // Defined once each, so no later definition shadows the rule.
    expect(["def strip_trailing(", "def section_present("].map(name => python.split(name).length - 1)).toEqual([1, 1]);
    expect(python).not.toContain(String.raw`[*_:\s]+$`);
  });
});

describe("the claims check's text rules: the same results in linear time (decision 6 of E1-J2)", () => {
  const claims = ledger([
    { id: "C1", sentence: "The reactor produced 42 units in May 2026.", sourceId: "input/notes.txt", quote: "produced 42 units in May 2026" },
    { id: "C2", sentence: "Output fell by 12 percent after the outage.", sourceId: "https://example.test/page", quote: "Output fell by 12 percent after the outage." }]);
  const workspace = (changed: Record<string, string | Buffer>) => ({ "input/notes.txt": notes, "sources/page.bin": page, "output/report.md": report, [CLAIMS_LEDGER_PATH]: claims, ...changed });
  const beforeHeadings = (text: string) => report.replace("## Conflicting evidence", `${text}\n\n## Conflicting evidence`);
  const passes = { exitCode: 0, result: { passed: true, claims: [{ id: "C1", found: true }, { id: "C2", found: true }],
    report: { citations: { missing: [], unknown: [] }, sections: { "Conflicting evidence": true, "Unanswered questions": true } } } };
  // Each input takes the former pattern several minutes or more, by the rates measured on Python 3.11.16 (BL-20261114-1711); the linear
  // helper takes well under a second. A mutation run with the former pattern back is stopped at the bound.
  it("checks a report holding 200,000 lines that open a fence and never close one within a 20 s bound", () => {
    expect(run(workspace({ "output/report.md": beforeHeadings("```x\n".repeat(200_000)) }), { timeoutMs: 20_000 })).toMatchObject(passes);
  }, 30_000);
  it("checks a report holding 250,000 comment openers and no closer within a 20 s bound", () => {
    expect(run(workspace({ "output/report.md": beforeHeadings("<!--".repeat(250_000)) }), { timeoutMs: 20_000 })).toMatchObject(passes);
  }, 30_000);
  it("checks an HTML source holding 125,000 script openers and no closer within a 20 s bound", () => {
    expect(run(workspace({ "sources/page.bin": page + "<script>".repeat(125_000) }), { timeoutMs: 20_000 })).toMatchObject(passes);
  }, 30_000);
  it("checks an HTML source holding 600,000 script openers that share one far '>' within a 20 s bound", () => {
    // #109's light review: each opener searched for its own '>', and here every search ran to the last character (BL-20261114-1711's
    // decision (3) left that search out). The first '>' at or after an opener is now found once and kept while it lies ahead.
    expect(run(workspace({ "sources/page.bin": page + "<script".repeat(600_000) + ">" }), { timeoutMs: 20_000 })).toMatchObject(passes);
  }, 30_000);
  it("checks an HTML source ending in 1,000,000 '<' with no '>' after them within a 20 s bound", () => {
    expect(run(workspace({ "sources/page.bin": page + "<".repeat(1_000_000) }), { timeoutMs: 20_000 })).toMatchObject(passes);
  }, 30_000);
  it("checks a DOCX source whose paragraph holds 100,000 run breaks that open run properties and never close them within a 20 s bound", () => {
    const xml = `<w:document><w:body><w:p><w:r><w:t>The reactor produced 42 units in May 2026.</w:t></w:r></w:p><w:p><w:r><w:t>x${"</w:t></w:r><w:r><w:rPr>".repeat(100_000)}</w:t></w:r></w:p></w:body></w:document>`;
    const files = { "input/notes.txt": notes, "sources/doc.bin": buildDocxFromXml(xml), "output/report.md": report.replace(" Output fell by 12 percent after the outage [C2].", ""),
      [CLAIMS_LEDGER_PATH]: ledger([{ id: "C1", sentence: "s", sourceId: "doc", quote: "produced 42 units in May 2026" }]) };
    expect(run(files, { sources: [{ id: "doc", path: "sources/doc.bin" }], timeoutMs: 20_000 })).toMatchObject({ exitCode: 0, result: { passed: true, claims: [{ id: "C1", found: true, locator: "paragraph 1" }] } });
  }, 30_000);
  it("reads a PDF's page labels once, not once per page: 1,000 pages build 1,000 labels, and a read that raises leaves every page its number", () => {
    // A stand-in pypdf, so this runs without pypdf: each read of page_labels builds every page's label, as pypdf's does. The former loop read it
    // once per page, 1,000 reads and 1,000,000 builds here.
    const standIn = (raises: boolean) => ["import atexit, sys, types", "reads=[0,0]",
      "class Page:", " def extract_text(self): return 'The reactor produced 42 units in May 2026.'",
      "class PdfReader:", " def __init__(self, stream): self.pages=[Page() for _ in range(1000)]",
      " @property", " def page_labels(self):", "  reads[0]+=1; reads[1]+=len(self.pages)",
      raises ? "  raise ValueError('labels')" : "  return ['p%d' % (i+1) for i in range(len(self.pages))]",
      "module=types.ModuleType('pypdf'); module.PdfReader=PdfReader; sys.modules['pypdf']=module",
      "atexit.register(lambda: sys.stderr.write('label reads %d, builds %d' % tuple(reads)))"].join("\n");
    for (const raises of [false, true]) {
      const root = mkdtempSync(join(tmpdir(), "soar-claims-pdf-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
      mkdirSync(join(root, "input")); mkdirSync(join(root, "output")); writeFileSync(join(root, "input/source.pdf"), "%PDF-1.4 stand-in");
      writeFileSync(join(root, "output/report.md"), "Claim [C1].\n\n## Conflicting evidence\n\nnone\n\n## Unanswered questions\n\nnone\n");
      writeFileSync(join(root, CLAIMS_LEDGER_PATH), ledger([{ id: "C1", sentence: "Claim.", sourceId: "doc", quote: "produced 42 units in May 2026" }]));
      const check = claimsLedgerCheck({ reportPath: "output/report.md", sources: [{ id: "doc", path: "input/source.pdf" }], root });
      const ran = spawnSync("python3", ["-I", "-c", `${standIn(raises)}\n${check.python}`], { encoding: "utf8" });
      expect([raises, ran.stderr]).toEqual([raises, "label reads 1, builds 1000"]);
      expect(JSON.parse(ran.stdout)).toMatchObject({ passed: true, claims: [{ id: "C1", found: true, locator: raises ? "page 1" : "page p1" }] });
    }
  });
  /** Compares the helper named in argv with the pattern it replaced, and prints a summary only. The backtick is chr(96), as String.raw cannot hold one. */
  const DIFFERENTIAL_PY = String.raw`import itertools, json, random, re, sys
${CLAIMS_REPORT_STRIP_PY}
${CLAIMS_MARKUP_STRIP_PY}
B=chr(96); S,I,DI=chr(0x17f),chr(0x131),chr(0x130)
WS=[' ','\t','\n','\x0b','\x1c',chr(0x85),chr(0xa0),chr(0x2028),chr(0x3000)]
FORMER={
 'strip_fences': lambda s: re.sub(r'(?ms)^[ \t]*'+B*3+r'.*?^[ \t]*'+B*3+r'[ \t]*$','',s),
 'strip_comments': lambda s: re.sub(r'(?s)<!--.*?-->','',s),
 'strip_tags': lambda s: re.sub(r'<[^>]+>',' ',s),
 'strip_scripts': lambda s: re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>',' ',s),
 'join_runs': lambda s: re.sub(r'</w:t>\s*</w:r>\s*<w:r\b[^>]*>(?:\s*<w:rPr>.*?</w:rPr>)?\s*<w:t\b[^>]*>','',s,flags=re.S),
}
TOKENS={
 'strip_fences': [B*3,B,' ','\t','\n','x','\r',B*4],
 'strip_comments': ['<!--','-->','<','!','-','>','x','\n'],
 'strip_tags': ['<','>','x','\n',' ','<>'],
 'strip_scripts': ['<script','<STYLE','<'+S+'cr'+DI+'pt','</script>','</SCR'+I+'PT>','</'+S+'cript>','</style>','</sTyLe>','</scrip>','>','<','</','x','\n',' s'],
 'join_runs': ['</w:t>','</w:r>','<w:r>','<w:r ','<w:rPr>','</w:rPr>','<w:t>','<w:t ','<w:rx>','<w:r1>','<w:tab/>','>','x',' ','\n',chr(0x3000),'<w:r','<w:t'],
}
DEPTH={'strip_fences':6,'strip_comments':6,'strip_tags':7,'strip_scripts':4,'join_runs':4}
def ws(rng): return ''.join(rng.choice(WS+['x']) for _ in range(rng.choice((0,0,0,1,2))))
def fence_doc(rng):
 kinds=[B*3,'  '+B*3+' \t','\t'+B*3+'py',B*4,' '+B*3+' x','x '+B*3,'',' ','x',B*3+'\r',B*2,B*3+chr(0xa0)]
 return '\n'.join(rng.choice(kinds) for _ in range(rng.randrange(1,40)))
def script_doc(rng):
 names=['script','SCRIPT','style','StYlE',S+'cript','scr'+I+'pt','scr'+DI+'pt','scrip','styles']
 parts=[]
 for _ in range(rng.randrange(1,12)):
  r=rng.random(); n=rng.choice(names)
  if r<0.35: parts.append('<'+n+rng.choice(['','>',' a="1">',' a=\n>','\n',' <x>']))
  elif r<0.7: parts.append('</'+n+rng.choice(['>','> ',' >','']))
  else: parts.append(rng.choice(['x','<','>','</','\n','<b>','</b>',' ']))
 return ''.join(parts)
def run_doc(rng):
 parts=[]
 for _ in range(rng.randrange(1,10)):
  seg=['</w:t>',ws(rng),'</w:r>',ws(rng),rng.choice(['<w:r>','<w:r w:rsid="1">','<w:rx>','<w:r','<w:r/>']),
   rng.choice(['',ws(rng)+'<w:rPr>'+rng.choice(['<w:b/>','','</w:rPr>x','<w:i/></w:rPr>'+ws(rng)+'<w:t>'])+rng.choice(['</w:rPr>','','</w:rPr></w:rPr>'])]),
   ws(rng),rng.choice(['<w:t>','<w:t xml:space="preserve">','<w:tab/>','<w:t','<w:tx>','']),rng.choice(['run text','','<','>'])]
  if rng.random()<0.3: del seg[rng.randrange(len(seg))]
  if rng.random()<0.2: k=rng.randrange(len(seg)); seg.insert(k,seg[rng.randrange(len(seg))])
  parts+=seg
 return ''.join(parts)
DOCS={'strip_fences':fence_doc,'strip_scripts':script_doc,'join_runs':run_doc}
name=sys.argv[1]; toks=TOKENS[name]; rng=random.Random(20261115)
strings=[''.join(p) for n in range(DEPTH[name]+1) for p in itertools.product(toks,repeat=n)]
strings+=[''.join(rng.choice(toks) for _ in range(rng.randrange(6,301))) for _ in range(3000)]
strings+=[''.join(rng.choice(toks+WS) for _ in range(rng.randrange(6,301))) for _ in range(3000)]
if name in DOCS: strings+=[DOCS[name](rng) for _ in range(40000)]
helper=globals()[name]; former=[FORMER[name](s) for s in strings]
bad=[s for s,f in zip(strings,former) if helper(s)!=f]
print(json.dumps({'checked':len(strings),'changed':sum(f!=s for s,f in zip(strings,former)),'mismatches':len(bad),'first':bad[:3]}))`;
  it.each([["strip_fences", 345_593], ["strip_comments", 305_593], ["strip_tags", 341_923], ["strip_scripts", 100_241], ["join_runs", 157_151]] as const)(
    "%s returns what the pattern it replaced returns, on every token sequence up to a length and on seeded random documents", (helper, checked) => {
      // Token sets cover each pattern's edges: Unicode whitespace, word boundaries, CR, case folding (U+017F, U+0131, U+0130) and unclosed openers.
      const summary = JSON.parse(execFileSync("python3", ["-I", "-c", DIFFERENTIAL_PY, helper], { encoding: "utf8" })) as { checked: number; changed: number; mismatches: number; first: string[] };
      expect(summary).toMatchObject({ checked, mismatches: 0, first: [] });
      // Each input set also exercises the former pattern: it changed over 10,000 of the strings.
      expect(summary.changed).toBeGreaterThan(10_000);
    }, 60_000);
  it("gives fixed results read from TypeScript, so an escaping slip that broke both sides alike would still show", () => {
    const F = "```", S = String.fromCharCode(0x17f);
    const cases = {
      strip_fences: [`a\n${F}py\nb\n${F}\nc`, `${F}\nx`, `  ${F}  \nx\n\t${F}\t\ny`, "x\n" + F + "`\ny\n" + F + "\nz", `${F}\r\nx\n${F}\r\n`, `${F}\n${F}\n${F}`],
      strip_comments: ["a<!-- x -->b", "a<!-->b-->c", "a<!--b", "<!--a--><!--b-->c", "<!---->x"],
      strip_tags: ["a<b>c", "a<>b", "a<b", "<<a>>", "x>y<z", "<a\nb>c"],
      strip_scripts: ["a<script>x</script>b", "a<SCRIPT type=x>x</script >b</ScRiPt>c", "<style>a</script>b</style>c", "<script>a", `<${S}cript>a</script>b</${S}cript>c`, "<script x=\">\">a</script>b"],
      join_runs: ["<w:t>a</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>b</w:t>", "</w:t></w:r><w:r><w:t>", "</w:t> </w:r>\n<w:r w:x=\"1\"><w:rPr></w:rPr> <w:t xml:space=\"preserve\">",
        "</w:t></w:r><w:rx><w:t>", "</w:t></w:r><w:r><w:rPr></w:rPr></w:rPr><w:t>", "</w:t></w:r><w:r><w:rPr><w:t>", "</w:t></w:r><w:r> <w:rPr></w:rPr><w:t>"] };
    const script = `import json, sys\n${CLAIMS_REPORT_STRIP_PY}\n${CLAIMS_MARKUP_STRIP_PY}\ncases=json.load(sys.stdin)\n` +
      "print(json.dumps({name:[globals()[name](text) for text in texts] for name,texts in cases.items()}))";
    expect(JSON.parse(execFileSync("python3", ["-I", "-c", script], { input: JSON.stringify(cases), encoding: "utf8" }))).toEqual({
      strip_fences: ["a\n\nc", `${F}\nx`, "\ny", "x\n\nz", `${F}\r\nx\n${F}\r\n`, `\n${F}`],
      strip_comments: ["ab", "ac", "a<!--b", "c", "x"],
      strip_tags: ["a c", "a<>b", "a<b", " >", "x>y<z", " c"],
      strip_scripts: ["a b", "a c", " c", "<script>a", " c", " b"],
      join_runs: ["<w:t>ab</w:t>", "", "", "</w:t></w:r><w:rx><w:t>", "", "</w:t></w:r><w:r><w:rPr><w:t>", ""] });
    // Single backslashes reach Python where the patterns need them.
    for (const piece of [String.raw`</\1>`, String.raw`r'\s*<w:rPr>'`, String.raw`<w:r\b[^>]*>`]) expect(CLAIMS_MARKUP_STRIP_PY).toContain(piece);
    expect(CLAIMS_REPORT_STRIP_PY).toContain(String.raw`text.split('\n')`);
  });
  it("runs both rules in the check, and neither the former patterns on text nor a label read per page", () => {
    const python = claimsLedgerCheck({ reportPath: "output/report.md", sources }).python;
    expect(python).toContain(CLAIMS_REPORT_STRIP_PY);
    expect(python).toContain(CLAIMS_MARKUP_STRIP_PY);
    expect(python).toContain("body=strip_comments(strip_fences(report))");
    // Defined once each, so no later definition shadows a rule.
    expect(["def strip_fences(", "def strip_comments(", "def strip_scripts(", "def strip_tags(", "def join_runs("].map(name => python.split(name).length - 1)).toEqual([1, 1, 1, 1, 1]);
    for (const former of [String.raw`.*?^[ \t]*`, String.raw`re.sub(r'(?s)<!--`, String.raw`re.sub(r'(?is)<(script|style)`, String.raw`re.sub(r'<[^>]+>'`,
      String.raw`(?:\s*<w:rPr>.*?</w:rPr>)?`, "page_labels[index]"]) expect(python).not.toContain(former);
  });
});
