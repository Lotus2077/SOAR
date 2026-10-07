import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { renderDraft } from "../../scripts/phase2-repair";
import { buildBinarySource } from "../helpers/claims-fixtures";

const enabled = process.env.SOAR_RUN_PRIVATE_AGENT_RUNTIME === "true";
const imageId = "sha256:e5c7075fac7a7a68900db45e3de06e50e7b0f6896a5ca0f82cddb4ef8ad4ac2f";
const MAKE = String.raw`import base64, io, json
import docx, openpyxl, pptx
from pptx.util import Inches
out = {}
d = docx.Document(); d.add_paragraph("Clause 1. The fee is fixed."); t = d.add_table(rows=1, cols=2); t.cell(0, 0).text = "Term"; t.cell(0, 1).text = "Twelve months"
b = io.BytesIO(); d.save(b); out["output/review.docx"] = base64.b64encode(b.getvalue()).decode()
p = pptx.Presentation(); s = p.slides.add_slide(p.slide_layouts[5]); s.shapes.title.text = "Quarterly revenue"
s.shapes.add_textbox(Inches(1), Inches(2), Inches(4), Inches(1)).text_frame.text = "Revenue grew 12 percent."
b = io.BytesIO(); p.save(b); out["output/deck.pptx"] = base64.b64encode(b.getvalue()).decode()
w = openpyxl.Workbook(); w.active.title = "Data"; w.active.append(["Region", "Sales"]); w.active.append(["North", 42])
b = io.BytesIO(); w.save(b); out["output/data.xlsx"] = base64.b64encode(b.getvalue()).decode()
print(json.dumps(out))
`;

describe.skipIf(!enabled)("Phase 2 repair packet rendering inside the real sandbox image", () => {
  it("renders DOCX (with tables), PPTX, XLSX and PDF drafts to text, and passes text formats through", async () => {
    const sandbox = await DockerSandbox.create({ imageId, jobId: `render-${randomUUID().slice(0, 8)}`, contextId: randomUUID(), files: [{ path: "make.py", bytes: Buffer.from(MAKE) }] });
    let made: Record<string, string>;
    try { made = JSON.parse((await sandbox.execute("python3 -I make.py", { timeoutMs: 60_000 })).stdout) as Record<string, string>; }
    finally { await sandbox.close(); }
    const draft = [...Object.entries(made).map(([path, b64]) => ({ path, bytes: Buffer.from(b64, "base64") })),
      { path: "output/source.pdf", bytes: buildBinarySource("pdf", ["The reactor produced 42 units."]) }, { path: "output/notes.md", bytes: Buffer.from("# Notes\nplain") }];
    const texts = Object.fromEntries((await renderDraft(draft, imageId)).map(item => [item.path, item.text]));
    expect(texts["output/review.docx"]).toBe("Clause 1. The fee is fixed.\nTerm | Twelve months");
    expect(texts["output/deck.pptx"]).toContain("Slide 1:"); expect(texts["output/deck.pptx"]).toContain("Revenue grew 12 percent.");
    expect(texts["output/data.xlsx"]).toBe("Sheet Data:\nRegion\tSales\nNorth\t42");
    expect(texts["output/source.pdf"]).toContain("The reactor produced 42 units.");
    expect(texts["output/notes.md"]).toBe("# Notes\nplain");
  }, 180_000);
  it("keeps the renderer's output under the sandbox's 256 KiB cap for large drafts", async () => {
    const big = String.raw`import base64, io, json
import docx
out = {}
for name in ("redline", "clean"):
    d = docx.Document()
    for n in range(1500):
        d.add_paragraph("Clause %d. The Supplier shall perform the services with care and report every month on progress." % n)
    b = io.BytesIO(); d.save(b); out["output/%s.docx" % name] = base64.b64encode(b.getvalue()).decode()
print(json.dumps(out))
`;
    const sandbox = await DockerSandbox.create({ imageId, jobId: `render-${randomUUID().slice(0, 8)}`, contextId: randomUUID(), files: [{ path: "big.py", bytes: Buffer.from(big) }] });
    let made: Record<string, string>;
    try { made = JSON.parse((await sandbox.execute("python3 -I big.py", { timeoutMs: 120_000 })).stdout) as Record<string, string>; }
    finally { await sandbox.close(); }
    const texts = await renderDraft(Object.entries(made).map(([path, b64]) => ({ path, bytes: Buffer.from(b64, "base64") })), imageId);
    for (const item of texts) { expect(item.text.startsWith("Clause 0.")).toBe(true); expect(Buffer.byteLength(item.text)).toBeLessThan(64 * 1024); }
  }, 240_000);
});
