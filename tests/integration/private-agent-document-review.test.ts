import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DOCUMENT_REVIEW_EDITS_PATH, documentReviewApplierFile, documentReviewCheck } from "../../src/main/private-agent/document-review";
import { checkCommand } from "../../src/main/private-agent/runner";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { AGREEMENT_EDITS, DOCUMENT_FIXTURE_PY } from "../helpers/document-review-fixtures";

const enabled = process.env.SOAR_RUN_PRIVATE_AGENT_RUNTIME === "true";
// The qualified tool image (python-docx, lxml, openpyxl, pypdf, LibreOffice); never pulled or built here.
const imageId = "sha256:e5c7075fac7a7a68900db45e3de06e50e7b0f6896a5ca0f82cddb4ef8ad4ac2f";
const SOURCE = "input/agreement.docx";
const APPLY = `python3 -I review/soar_redline.py ${SOURCE} ${DOCUMENT_REVIEW_EDITS_PATH} output`;

/** A sandbox with the applier and a generated source; returns helpers that run commands, the applier and the host check. */
async function session(kind: "nda" | "tracked" | "commented" | "objects" | "header_tracked" | "hidden" | "word_like" | "long", edits: readonly object[]) {
  const sandbox = await DockerSandbox.create({ imageId, jobId: `review-${randomUUID().slice(0, 8)}`, contextId: randomUUID(), files: [
    documentReviewApplierFile(), { path: "fixture.py", bytes: Buffer.from(DOCUMENT_FIXTURE_PY) },
    { path: DOCUMENT_REVIEW_EDITS_PATH, bytes: Buffer.from(JSON.stringify({ version: 1, edits })) }] });
  const sh = (command: string, timeoutMs = 60_000) => sandbox.execute(command, { timeoutMs });
  const generated = await sh(`mkdir -p input && python3 -I fixture.py ${kind} ${SOURCE}`);
  expect(generated, generated.stderr).toMatchObject({ exitCode: 0 });
  const sourceSha256 = (await sh(`python3 -I -c "import hashlib; print(hashlib.sha256(open('${SOURCE}','rb').read()).hexdigest())"`)).stdout.trim();
  const apply = async () => { const result = await sh(APPLY); return { exitCode: result.exitCode, report: JSON.parse(result.stdout) } };
  const check = async () => {
    const started = Date.now(), result = await sh(checkCommand(documentReviewCheck({ sourcePath: SOURCE, sourceSha256 })), 90_000);
    return { exitCode: result.exitCode, result: JSON.parse(result.stdout) as { passed: boolean; failures: { code: string; path?: string }[] }, elapsedMs: Date.now() - started };
  };
  /** Replaces the plan; base64 keeps quotes in anchors away from the shell. */
  const plan = async (next: readonly object[]) => {
    const encoded = Buffer.from(JSON.stringify({ version: 1, edits: next })).toString("base64");
    expect((await sh(`python3 -I -c "import base64; open('${DOCUMENT_REVIEW_EDITS_PATH}', 'wb').write(base64.b64decode('${encoded}'))"`)).exitCode).toBe(0);
  };
  return { sandbox, sh, apply, check, plan };
}

describe.skipIf(!enabled)("document review inside the real sandbox image (PR-I)", () => {
  it("applies a plan as tracked changes that pass every fidelity check, deterministically, and refuses tampering", async () => {
    const s = await session("nda", AGREEMENT_EDITS);
    try {
      expect((await s.sh(`python3 -I review/soar_redline.py --list ${SOURCE}`)).stdout.split("\n")[7]).toBe('{"paragraph": 8, "text": "Twenty-four months"}');
      expect(await s.apply()).toMatchObject({ exitCode: 0, report: { ok: true, edits: 8, revisions: 11, comments: 8 } });
      const passed = await s.check();
      expect(passed).toMatchObject({ exitCode: 0, result: { passed: true, failures: [] } });
      expect(passed.elapsedMs).toBeLessThan(60_000);
      // Same plan, same bytes.
      expect((await s.sh(`python3 -I review/soar_redline.py ${SOURCE} ${DOCUMENT_REVIEW_EDITS_PATH} /tmp/again && cmp output/redline.docx /tmp/again/redline.docx && cmp output/clean.docx /tmp/again/clean.docx`)).exitCode).toBe(0);
      // Model text is stored as text, never as a formula.
      expect((await s.sh(`python3 -I -c "from openpyxl import load_workbook; c = load_workbook('output/issues.xlsx').active.cell(3, 7); print(c.data_type, c.value[:10])"`)).stdout.trim()).toBe("s =HYPERLINK");
      // A hand edit of any output, a changed applier and a changed source are each caught.
      await s.sh(`cp output/issues.xlsx /tmp/issues.xlsx && python3 -I -c "from openpyxl import load_workbook; b = load_workbook('output/issues.xlsx'); b.create_sheet('Notes')['A1'] = '=1+1'; b.save('output/issues.xlsx')"`);
      expect((await s.check()).result.failures).toEqual([{ code: "output_differs", path: "output/issues.xlsx" }]);
      await s.sh("cp /tmp/issues.xlsx output/issues.xlsx && printf ' ' >> output/hygiene.json");
      expect((await s.check()).result.failures).toEqual([{ code: "output_differs", path: "output/hygiene.json" }]);
      await s.sh("python3 -I review/soar_redline.py input/agreement.docx review/edits.json output > /dev/null");
      await s.sh(`cp output/redline.docx /tmp/redline.docx && python3 -I -c "import docx; d = docx.Document('output/redline.docx'); d.paragraphs[1].add_run(' extra'); d.save('output/redline.docx')"`);
      expect((await s.check()).result.failures).toContainEqual({ code: "output_differs", path: "output/redline.docx" });
      await s.sh("cp /tmp/redline.docx output/redline.docx && cp review/soar_redline.py /tmp/applier.py && echo '# changed' >> review/soar_redline.py");
      expect((await s.check()).result.failures).toEqual([{ code: "applier_changed" }]);
      await s.sh(`cp /tmp/applier.py review/soar_redline.py && python3 -I fixture.py commented ${SOURCE}`);
      expect((await s.check()).result.failures).toEqual([{ code: "source_changed" }]);
    } finally { await s.sandbox.close(); }
  }, 300_000);
  it("reports every plan error the agent must fix, and refuses a source with tracked changes", async () => {
    const s = await session("nda", [
      { id: "E1", anchor: "the", action: "replace", newText: "a", rationale: "x", severity: "low" },
      { id: "E2", anchor: "not in the document", action: "delete", rationale: "x", severity: "low" },
      { id: "E3", anchor: "example.invalid/notices within", action: "delete", rationale: "crosses a hyperlink", severity: "low" },
      { id: "E4", anchor: "Page 1 of", action: "delete", rationale: "crosses a field", severity: "low" },
      { id: "E5", anchor: "governed by the laws", action: "delete", rationale: "x", severity: "low" },
      { id: "E6", anchor: "the laws of the State", action: "comment", rationale: "overlaps E5", severity: "low" }]);
    try {
      const refused = await s.apply();
      expect(refused.exitCode).toBe(2);
      expect(refused.report.errors.map((error: { id: string; code: string }) => `${error.id} ${error.code}`).sort()).toEqual([
        "E1 anchor_not_unique", "E2 anchor_not_found", "E3 anchor_not_editable", "E4 anchor_not_editable", "E6 edits_overlap"]);
      await s.plan([{ id: "E1", anchor: "x", action: "move", rationale: "x", severity: "urgent" }]);
      expect((await s.apply()).report.errors).toEqual([{ id: "E1", code: "action_invalid", allowed: ["replace", "delete", "insert_after", "comment"] }]);
    } finally { await s.sandbox.close(); }
    const tracked = await session("tracked", [{ id: "E1", anchor: "Already", action: "delete", rationale: "x", severity: "low" }]);
    try {
      expect(await tracked.apply()).toMatchObject({ exitCode: 2, report: { errors: [{ code: "source_has_tracked_changes", found: ["word/document.xml:ins"] }] } });
    } finally { await tracked.sandbox.close(); }
  }, 300_000);
  it("never lets an anchor swallow an object or someone's comment, refuses revisions outside the body, and never inherits hidden formatting", async () => {
    const objects = await session("objects", [
      { id: "E1", anchor: "one hundred pounds", action: "replace", newText: "two hundred pounds", rationale: "Crosses a symbol.", severity: "low" },
      { id: "E2", anchor: "that the cap is low in", action: "delete", rationale: "Crosses Counsel's comment.", severity: "low" }]);
    try {
      expect((await objects.sh(`python3 -I review/soar_redline.py --list ${SOURCE}`)).stdout.split("\n")[0]).toBe('{"paragraph": 1, "text": "The fee is one\uFFFC hundred pounds."}');
      expect((await objects.apply()).report.errors.map((error: { id: string; code: string }) => [error.id, error.code])).toEqual([["E1", "anchor_not_found"], ["E2", "anchor_not_editable"]]);
    } finally { await objects.sandbox.close(); }
    const header = await session("header_tracked", [{ id: "E1", anchor: "Body text", action: "comment", rationale: "x", severity: "low" }]);
    try {
      expect(await header.apply()).toMatchObject({ exitCode: 2, report: { errors: [{ code: "source_has_tracked_changes", found: ["word/header1.xml:ins"] }] } });
    } finally { await header.sandbox.close(); }
    const hidden = await session("hidden", [
      { id: "E1", anchor: "follows. [internal note]", action: "insert_after", newText: " The Supplier shall indemnify the Client.", rationale: "Add the indemnity.", severity: "high" },
      { id: "E2", anchor: "for the partner only.", action: "insert_after", newText: " Shared with the Client.", rationale: "Inside a hidden paragraph style.", severity: "low" }]);
    try {
      expect((await hidden.sh(`python3 -I review/soar_redline.py --list ${SOURCE}`)).stdout).toContain('"hiddenText": true');
      expect(await hidden.apply()).toMatchObject({ exitCode: 0 });
      expect(await hidden.check()).toMatchObject({ exitCode: 0, result: { passed: true } });
      // New text carries an explicit "not hidden", which beats direct, character and paragraph styles alike.
      const visible = await hidden.sh(`python3 -I -c "import docx; d = docx.Document('output/clean.docx'); print([r.font.hidden for p in d.paragraphs for r in p.runs if 'indemnify' in r.text or 'Shared' in r.text])"`);
      expect(visible.stdout.trim()).toBe("[False, False]");
    } finally { await hidden.sandbox.close(); }
  }, 300_000);
  it("handles what Word writes: text beside a tab, a page-break cache in a deleted run, a heading repeated in a table of contents, curly quotes", async () => {
    const s = await session("word_like", [
      { id: "E1", anchor: "thirty days", action: "replace", newText: "sixty days", rationale: "Shares a run with a tab.", severity: "medium" },
      { id: "E2", anchor: "shall indemnify the", action: "replace", newText: "shall hold harmless the", rationale: "Covers a run with a page-break cache.", severity: "high" },
      { id: "E3", anchor: "Term and Termination", action: "replace", newText: "Duration and Termination", rationale: "The heading also appears in the table of contents.", severity: "low" }]);
    try {
      expect(await s.apply()).toMatchObject({ exitCode: 0, report: { ok: true, edits: 3 } });
      expect(await s.check()).toMatchObject({ exitCode: 0, result: { passed: true } });
      await s.plan([{ id: "E1", anchor: "Contents entry", action: "comment", rationale: "x", severity: "low" },
        { id: "E2", anchor: "The Recipient's obligations", action: "comment", rationale: "x", severity: "low" }]);
      const refused = await s.apply();
      expect(refused.report.errors).toMatchObject([{ id: "E1", code: "anchor_inside_field" },
        { id: "E2", code: "anchor_not_found", paragraph: 5, documentText: "The Recipient\u2019s obligations" }]);
    } finally { await s.sandbox.close(); }
  }, 300_000);
  it("pages the paragraph listing so a long contract never exceeds the sandbox's output cap", async () => {
    const s = await session("long", [{ id: "E1", anchor: "Clause 900.", action: "comment", rationale: "x", severity: "low" }]);
    try {
      const first = await s.sh(`python3 -I review/soar_redline.py --list ${SOURCE}`);
      const lines = first.stdout.trim().split("\n");
      expect(Buffer.byteLength(first.stdout)).toBeLessThanOrEqual(48 * 1024 + 64);
      const next = JSON.parse(lines.at(-1)!) as { next: number; of: number };
      expect(next.of).toBe(900); expect(next.next).toBe(lines.length);
      const second = await s.sh(`python3 -I review/soar_redline.py --list ${SOURCE} ${next.next}`);
      expect(JSON.parse(second.stdout.split("\n")[0]!)).toMatchObject({ paragraph: next.next });
    } finally { await s.sandbox.close(); }
  }, 300_000);
  it("adds to a document's existing comments without touching them", async () => {
    const s = await session("commented", [{ id: "E1", anchor: "one hundred dollars", action: "replace", newText: "two hundred dollars", rationale: "Update the fee.", severity: "high" }]);
    try {
      expect(await s.apply()).toMatchObject({ exitCode: 0, report: { revisions: 2, comments: 1 } });
      expect(await s.check()).toMatchObject({ exitCode: 0, result: { passed: true } });
      expect(JSON.parse((await s.sh("cat output/hygiene.json")).stdout)).toMatchObject({ source: { commentAuthors: ["Counsel"], comments: 1 },
        redline: { commentAuthors: ["Counsel", "SOAR draft"], comments: 2 } });
    } finally { await s.sandbox.close(); }
  }, 300_000);
});
