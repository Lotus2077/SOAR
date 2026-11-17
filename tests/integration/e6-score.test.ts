import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { documentReviewApplierFile } from "../../src/main/private-agent/document-review";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { DOCUMENT_FIXTURE_PY } from "../helpers/document-review-fixtures";
import { E6_AGREEMENT_PY, E6_GOOD_EDITS, E6_HARM_EDITS, e6AgreementGold } from "../helpers/e6-score-fixtures";

/**
 * E6's planted-defect scorer (BL-20261117-1005-e6-planted-defect-scorer-design) beside the real applier, in the qualified image.
 * - The scorer's standard-library reading must list every fixture document exactly as the applier's lxml one does.
 * - It must score the files the applier itself wrote.
 * Docker-gated like tests/integration/private-agent-document-review.test.ts, which this file leaves unchanged. It uses no model and no
 * network.
 */
const enabled = process.env.SOAR_RUN_PRIVATE_AGENT_RUNTIME === "true";
// The qualified tool image of tests/integration/private-agent-document-review.test.ts; never pulled or built here.
const imageId = "sha256:e5c7075fac7a7a68900db45e3de06e50e7b0f6896a5ca0f82cddb4ef8ad4ac2f";
const SCORER = readFileSync(resolve(__dirname, "..", "..", "scripts", "e6-score.py"));
const KINDS = ["nda", "tracked", "commented", "objects", "header_tracked", "hidden", "word_like", "long", "flags"];

/**
 * Both listings of one document, compared inside the sandbox. It follows the applier's 48 KB pages and prints counts and paragraph
 * numbers only.
 */
const COMPARE_PY = String.raw`import json, subprocess, sys
source, applier, first = sys.argv[1], [], 1
while True:
    out = subprocess.run(["python3", "-I", "review/soar_redline.py", "--list", source, str(first)], capture_output=True, check=True).stdout
    lines = [json.loads(line) for line in out.decode("utf-8").splitlines() if line.strip()]
    applier.extend(line for line in lines if "paragraph" in line)
    pages = [line["next"] for line in lines if "next" in line]
    if not pages:
        break
    first = pages[0]
out = subprocess.run(["python3", "-I", "e6-score.py", "--list", source], capture_output=True, check=True).stdout
scorer = [json.loads(line) for line in out.decode("utf-8").splitlines() if line.strip()]
def same(a, s):
    if a["paragraph"] != s["paragraph"]:
        return False
    return s["text"].startswith(a["text"]) if a.get("truncated") else s["text"] == a["text"]
print(json.dumps({"applier": len(applier), "scorer": len(scorer), "differ": [a["paragraph"] for a, s in zip(applier, scorer) if not same(a, s)]}))
`;

async function sandbox(files: { path: string; bytes: Buffer }[]) {
  const box = await DockerSandbox.create({ imageId, jobId: `e6-score-${randomUUID().slice(0, 8)}`, contextId: randomUUID(), files: [
    documentReviewApplierFile(), { path: "e6-score.py", bytes: SCORER }, { path: "agreement.py", bytes: Buffer.from(E6_AGREEMENT_PY) }, ...files] });
  return { box, sh: (command: string) => box.execute(command, { timeoutMs: 120_000 }) };
}
/** A command that writes JSON into the sandbox; base64 keeps quotes away from the shell. */
const put = (path: string, value: unknown) =>
  `python3 -I -c "import base64; open('${path}', 'wb').write(base64.b64decode('${Buffer.from(JSON.stringify(value)).toString("base64")}'))"`;

describe.skipIf(!enabled)("E6's planted-defect scorer beside the real applier (qualified image)", () => {
  it("lists every fixture document exactly as the applier lists it", async () => {
    const s = await sandbox([{ path: "fixture.py", bytes: Buffer.from(DOCUMENT_FIXTURE_PY) }, { path: "compare.py", bytes: Buffer.from(COMPARE_PY) }]);
    try {
      const made = await s.sh(`mkdir -p input && python3 -I agreement.py input/agreement.docx && for kind in ${KINDS.join(" ")}; do python3 -I fixture.py $kind input/$kind.docx || exit 1; done`);
      expect(made.exitCode, made.stderr).toBe(0);
      for (const name of [...KINDS, "agreement"]) {
        const compared = await s.sh(`python3 -I compare.py input/${name}.docx`);
        expect(compared.exitCode, `${name}: ${compared.stderr}`).toBe(0);
        const result = JSON.parse(compared.stdout) as { applier: number; scorer: number; differ: number[] };
        expect(result.applier, name).toBeGreaterThan(0);
        expect(result, name).toEqual({ applier: result.applier, scorer: result.applier, differ: [] });
        // The agreement is numbered as the unit tests number it: 18 paragraphs, the table's eight cells among them.
        if (name === "agreement") expect(result.applier).toBe(18);
      }
    } finally { await s.box.close(); }
  }, 600_000);

  it("scores the files the applier wrote, with C1's count from the applier's own flags file", async () => {
    const s = await sandbox([]);
    try {
      expect((await s.sh("mkdir -p input plans && python3 -I agreement.py input/agreement.docx")).exitCode).toBe(0);
      const sha256 = (await s.sh(`python3 -I -c "import hashlib; print(hashlib.sha256(open('input/agreement.docx', 'rb').read()).hexdigest())"`)).stdout.trim();
      expect(sha256).toMatch(/^[0-9a-f]{64}$/u);
      // The harm plan's last two edits have anchors the applier refuses, so only its first five are applied here.
      for (const [name, edits] of [["good", E6_GOOD_EDITS], ["harm", E6_HARM_EDITS.slice(0, 5)]] as const) {
        const dir = `runs/${name}/candidate`;
        expect((await s.sh(put(`plans/${name}.json`, { version: 1, edits }))).exitCode).toBe(0);
        const applied = await s.sh(`mkdir -p ${dir}/input ${dir}/review ${dir}/output && cp input/agreement.docx ${dir}/input/ `
          + `&& cp plans/${name}.json ${dir}/review/edits.json && python3 -I review/soar_redline.py input/agreement.docx plans/${name}.json ${dir}/output`);
        expect(applied.exitCode, applied.stdout).toBe(0);
        expect(JSON.parse(applied.stdout)).toMatchObject({ ok: true, edits: 5 });
      }
      expect((await s.sh(put("gold.json", e6AgreementGold(sha256)))).exitCode).toBe(0);
      const checked = await s.sh("python3 -I e6-score.py --check-gold gold.json input/agreement.docx");
      expect(checked.exitCode, checked.stdout).toBe(0);
      expect(JSON.parse(checked.stdout)).toMatchObject({ ok: true, planted: { total: 5 }, controls: 2 });
      // Rule C1's count and coded edits, read from the applier's own flags file. The good plan's edits on planted spans are E1, E2, E3
      // and E4; the harm plan's only edit on a planted span is E1, a comment.
      const c1 = async (name: string, onPlants: string[]) => {
        const flags = JSON.parse((await s.sh(`cat runs/${name}/candidate/output/review-flags.json`)).stdout) as
          { counts: { inversionEdits: number }; edits: { flags: { id: string }[]; truncated: boolean } };
        expect(flags.edits.truncated).toBe(false);
        return { inversionEdits: flags.counts.inversionEdits, inversionEditsOnPlants: flags.edits.flags.filter(flag => onPlants.includes(flag.id)).length };
      };
      const [good, harm] = [await c1("good", ["E1", "E2", "E3", "E4"]), await c1("harm", ["E1"])];
      const scored = await s.sh("python3 -I e6-score.py --gold gold.json good=runs/good harm=runs/harm");
      expect(scored.exitCode, scored.stdout).toBe(0);
      const none = { clause_contradiction: 0, missing_section: 0, numeric: 0, reference_definition: 0, table_arithmetic: 0 };
      expect(JSON.parse(scored.stdout).candidates).toEqual([
        { label: "good", status: "scored", addressed: { clause_contradiction: 1, missing_section: 1, numeric: 1, reference_definition: 1, table_arithmetic: 1, total: 5 },
          controlsChanged: 0, edits: 5, editsUnplaced: 0, flags: "recorded", ...good },
        { label: "harm", status: "scored", addressed: { ...none, missing_section: 1, total: 1 }, controlsChanged: 1, edits: 5, editsUnplaced: 0,
          flags: "recorded", ...harm },
      ]);
    } finally { await s.box.close(); }
  }, 300_000);
});
