import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DOCX_SCAN_LIMITS, scanDocxText } from "../../src/main/general-tasks/docx-text-scan";
import { secretPatterns } from "../../scripts/secret-patterns.mjs";

/** A ZIP built by Python's zipfile from `{ name: text }`, deflated unless `stored`. */
function zip(parts: Record<string, string>, stored = false): Buffer {
  return execFileSync("python3", ["-I", "-c", `
import io, json, sys, zipfile
parts = json.loads(sys.stdin.read()); buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED if ${stored ? "True" : "False"} else zipfile.ZIP_DEFLATED) as z:
    for name, text in parts.items(): z.writestr(name, text)
sys.stdout.buffer.write(buffer.getvalue())`], { input: JSON.stringify(parts), maxBuffer: 64 * 1024 * 1024 });
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const body = (runs: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body><w:p>${runs}</w:p></w:body></w:document>`;
const run = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
// A credential-shaped value, built here so no source file holds one.
const KEY = ["AK", "IA"].join("") + "Q".repeat(16);
const types = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const plainScan = (bytes: Buffer) => secretPatterns.some(item => item.pattern.test(bytes.toString("utf8")));

describe("the .docx text scan of a document review (backlog item 13b, part 4)", () => {
  it("passes a real deflated document with no credential", () => {
    expect(scanDocxText(zip({ "[Content_Types].xml": types, "word/document.xml": body(run("The supplier services the lifts every month.")) }))).toBe("clean");
  });

  it("finds a credential the byte scan cannot see: deflated, split across runs, in a header, a comment, the properties, or as character references", () => {
    const split = zip({ "word/document.xml": body(run(KEY.slice(0, 4)) + run(KEY.slice(4))) });
    // The desktop's selection scan reads the file's bytes, deflated, and finds nothing.
    expect(plainScan(split)).toBe(false);
    expect(scanDocxText(split)).toBe("credential");
    for (const [name, xml] of [["word/header1.xml", `<w:hdr ${W}><w:p>${run(KEY)}</w:p></w:hdr>`], ["word/comments.xml", `<w:comments ${W}><w:comment>${run(KEY)}</w:comment></w:comments>`],
      ["docProps/core.xml", `<cp:coreProperties xmlns:cp="x"><dc:title xmlns:dc="y">${KEY}</dc:title></cp:coreProperties>`]] as const) {
      expect(scanDocxText(zip({ "word/document.xml": body(run("Plain text.")), [name]: xml })), name).toBe("credential");
    }
    const referenced = `&#x${KEY.charCodeAt(0).toString(16)};&#${KEY.charCodeAt(1)};${KEY.slice(2)}`;
    expect(scanDocxText(zip({ "word/document.xml": body(run(referenced)) }))).toBe("credential");
    expect(scanDocxText(zip({ "word/document.xml": body(run(KEY)) }, true))).toBe("credential");
  });

  it("refuses what it cannot read whole: more text than the budget, too many entries, not a ZIP, a cut ZIP, an encrypted part, or no XML part", () => {
    const big = zip({ "word/document.xml": body(run("a".repeat(5000))) });
    expect(scanDocxText(big)).toBe("clean");
    expect(scanDocxText(big, { ...DOCX_SCAN_LIMITS, inflatedBytes: 1000 })).toBe("oversize");
    expect(scanDocxText(zip({ "word/document.xml": body(run("a")), "word/footer1.xml": body(run("b")) }), { ...DOCX_SCAN_LIMITS, entries: 1 })).toBe("oversize");
    // A header that understates the size is not trusted: inflation stops one byte past the budget.
    const understated = Buffer.from(big), record = understated.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    understated.writeUInt32LE(10, record + 24);
    expect(scanDocxText(understated, { ...DOCX_SCAN_LIMITS, inflatedBytes: 1000 })).toBe("oversize");
    expect(scanDocxText(Buffer.from("A plain text file named .docx."))).toBe("unreadable");
    expect(scanDocxText(Buffer.alloc(0))).toBe("unreadable");
    expect(scanDocxText(big.subarray(0, big.length - 30))).toBe("unreadable");
    // The encrypted bit set on the part's central directory record.
    const encrypted = Buffer.from(big), central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
    expect(scanDocxText(encrypted)).toBe("unreadable");
    expect(scanDocxText(zip({ "media/image1.png": "not xml" }))).toBe("unreadable");
  });
});
