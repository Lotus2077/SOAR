import { inflateRawSync } from "node:zlib";
import { secretPatterns } from "../../../scripts/secret-patterns.mjs";

/**
 * Backlog item 13b, part 4: the desktop's input credential scan reads a file's bytes as text, which cannot see inside a .docx: its
 * text is deflated in a ZIP. A document review therefore also scans the document's own text. This reads the ZIP's central directory,
 * inflates every XML part (the body, headers, footers, comments, notes and the document's properties) within a byte budget, and applies the same patterns to each part's markup and to its text with the
 * tags taken out (so a credential split across runs is joined again). It needs no dependency and writes nothing.
 *
 * It refuses, rather than passes, what it cannot read whole: a file that is not a plain ZIP, an encrypted, ZIP64 or otherwise
 * unsupported part, or more text than the budget allows.
 */
export type DocxTextScan = "clean" | "credential" | "unreadable" | "oversize";
export const DOCX_SCAN_LIMITS = Object.freeze({ inflatedBytes: 32 * 1024 * 1024, entries: 4096 });

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const XML_PART = /\.(xml|rels)$/iu;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

/** The part's text: paragraphs and breaks become new lines, every other tag goes, and the five XML entities and numeric ones are decoded. */
function text(xml: string): string {
  return xml.replace(/<\/w:p>|<w:br\b[^>]*\/>|<w:tab\b[^>]*\/>/gu, "\n").replace(/<[^>]*>/gu, "")
    .replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/giu, (whole, name: string) => {
      const code = name[0] === "#" ? Number.parseInt(name.slice(name[1] === "x" || name[1] === "X" ? 2 : 1), name[1] === "x" || name[1] === "X" ? 16 : 10) : undefined;
      if (code !== undefined) return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      return ENTITIES[name.toLowerCase()] ?? whole;
    });
}
const credential = (value: string) => secretPatterns.some(item => item.pattern.test(value));

export function scanDocxText(bytes: Buffer, limits: { inflatedBytes: number; entries: number } = DOCX_SCAN_LIMITS): DocxTextScan {
  try {
    // The end of central directory record: 22 bytes, then a comment of at most 65,535.
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) if (bytes.readUInt32LE(at) === EOCD) { end = at; break; }
    if (end < 0) return "unreadable";
    const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), offset = bytes.readUInt32LE(end + 16);
    if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return "unreadable";
    if (count > limits.entries) return "oversize";
    if (offset + size > end) return "unreadable";
    let at = offset, budget = limits.inflatedBytes, parts = 0;
    for (let i = 0; i < count; i++) {
      if (bytes.readUInt32LE(at) !== CENTRAL) return "unreadable";
      const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10), compressed = bytes.readUInt32LE(at + 20), inflated = bytes.readUInt32LE(at + 24);
      const nameLength = bytes.readUInt16LE(at + 28), extraLength = bytes.readUInt16LE(at + 30), commentLength = bytes.readUInt16LE(at + 32), local = bytes.readUInt32LE(at + 42);
      const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
      at += 46 + nameLength + extraLength + commentLength;
      if (!XML_PART.test(name)) continue;
      if (flags & 0x1 || compressed === 0xffffffff || inflated === 0xffffffff || local === 0xffffffff || (method !== 0 && method !== 8)) return "unreadable";
      if (inflated > budget) return "oversize";
      if (bytes.readUInt32LE(local) !== LOCAL) return "unreadable";
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressed > bytes.length) return "unreadable";
      const raw = bytes.subarray(start, start + compressed);
      let data: Buffer;
      // The declared size is not trusted: inflation stops one byte past the budget, whatever the header says.
      try { data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: budget + 1 }); }
      catch (error) { return error instanceof RangeError ? "oversize" : "unreadable"; }
      if (data.length > budget) return "oversize";
      budget -= data.length; parts++;
      const xml = data.toString("utf8");
      if (credential(xml) || credential(text(xml))) return "credential";
    }
    // A .docx always has XML parts; a ZIP with none is not one the review can read.
    return parts ? "clean" : "unreadable";
  } catch { return "unreadable"; }
}
