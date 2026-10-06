import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAIMS_CONTEXT_BYTES, CLAIMS_CONTEXT_CHARS, CLAIMS_CONTEXT_ENV, CLAIMS_LEDGER_CHECK_ID, CLAIMS_LEDGER_PATH, CLAIMS_OUTPUT_BUDGET_BYTES, CLAIMS_RETAINED_ENV, CheckClaimsOutputSchema, ClaimsLedgerSchema, ClaimsVerifiedClaimSchema, ENTAILMENT_PURPOSE, ENTAILMENT_SYSTEM_PROMPT, EntailmentReplySchema, claimsInstructions, claimsLedgerCheck, encodeRetainedClaimsSources, entailmentMessages, judgeClaims, publicSourceWorkspacePath } from "../../src/main/private-agent/claims";
import { digest } from "../../src/main/private-agent/contracts";
import { buildBinarySource, hasIsolatedPypdf } from "../helpers/claims-fixtures";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0).reverse()) done(); });

const notes = "Alpha report, first edition.\nThe reactor produced 42 units in May 2026.\nMaintenance   was deferred\nuntil June.\n";
const page = "<html><head><style>p{color:red}</style></head><body><h1>Bravo &amp; Charlie</h1><p>Output fell by <b>12 percent</b> after the outage.</p><script>var x=1;</script></body></html>";
const sources = [{ id: "input/notes.txt", path: "input/notes.txt" }, { id: "https://example.test/page", path: "sources/page.bin" }];

/** Runs the host-owned check with the local python against a temporary workspace, exactly as the verifier container would. */
function run(files: Record<string, string | Buffer>, extra: { sources?: typeof sources; publicSources?: boolean; retained?: Parameters<typeof encodeRetainedClaimsSources>[0]; reportPath?: string; context?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "soar-claims-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), content); }
  const check = claimsLedgerCheck({ reportPath: extra.reportPath ?? "output/report.md", sources: extra.sources ?? sources, publicSources: extra.publicSources, root });
  expect(check.id).toBe(CLAIMS_LEDGER_CHECK_ID);
  const env = { ...process.env, ...(extra.retained ? { [CLAIMS_RETAINED_ENV]: encodeRetainedClaimsSources(extra.retained) } : {}), ...(extra.context ? { [CLAIMS_CONTEXT_ENV]: "1" } : {}) };
  try { return { exitCode: 0, result: JSON.parse(execFileSync("python3", ["-I", "-c", check.python], { encoding: "utf8", env })) }; }
  catch (error) { const failure = error as { status: number; stdout: string }; return { exitCode: failure.status, result: JSON.parse(failure.stdout) }; }
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
    expect(outcome).toMatchObject({ entailmentCalls: 3, truncated: true, counts: { supported: 1, not_judged: 2 },
      verdicts: [{ id: "C1", verdict: "not_judged", reason: "judge_reply_invalid" }, { id: "C2", verdict: "supported" }, { id: "C3", verdict: "not_judged", reason: "judge_request_failed" }] });
    expect(outcome.verdicts[1]).not.toHaveProperty("reason");
    const more = stub([new Error("x"), '{"verdict":"supported"}']);
    const stopped = await judgeClaims({ claims, complete: more.complete, signal: new AbortController().signal, remainingMs: far });
    expect(more.calls).toHaveLength(1); expect(stopped.verdicts.map(row => row.verdict)).toEqual(["not_judged", "not_judged", "not_judged"]);
  });
  it("stops at its clock reserve or on cancellation and skips claims whose window was dropped", async () => {
    let remaining = 60_000;
    const { calls, complete } = stub(['{"verdict":"supported"}', '{"verdict":"supported"}']);
    const outcome = await judgeClaims({ claims, complete: async (...args) => { remaining = 10_000; return complete(...args); }, signal: new AbortController().signal, remainingMs: () => remaining });
    expect(calls).toHaveLength(1); expect(outcome).toMatchObject({ truncated: true, counts: { supported: 1, not_judged: 2 } });
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
    expect(outcome).toMatchObject({ entailmentCalls: 1, truncated: true, verdicts: [{ id: "C1", verdict: "supported" }, { id: "C2", verdict: "not_judged", reason: "paused" }] });
  });
});
