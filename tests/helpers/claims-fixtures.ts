import { execFileSync, spawnSync } from "node:child_process";

/** Builds a minimal DOCX or PDF with one paragraph or page per entry, using only the python stdlib. A "|" inside a DOCX paragraph splits it into runs. */
export function buildBinarySource(kind: "pdf" | "docx", paragraphs: string[]): Buffer {
  const script = kind === "docx"
    ? `import sys, zipfile, html
target, paras = sys.argv[1], sys.argv[2:]
body = ''.join('<w:p>%s</w:p>' % ''.join('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r>' % html.escape(run) for run in p.split('|')) for p in paras)
with zipfile.ZipFile(target, 'w') as z: z.writestr('word/document.xml', '<?xml version="1.0"?><w:document><w:body>%s</w:body></w:document>' % body)`
    : `import sys
NL = chr(10); target, paras = sys.argv[1], sys.argv[2:]
objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join('%d 0 R' % (4 + 2 * i) for i in range(len(paras))), len(paras)), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
for text in paras:
    escaped = text.replace(chr(92), chr(92) * 2).replace('(', chr(92) + '(').replace(')', chr(92) + ')')
    stream = 'BT /F1 12 Tf 72 720 Td (%s) Tj ET' % escaped
    objs.append('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>' % (len(objs) + 2))
    objs.append('<< /Length %d >>' % len(stream) + NL + 'stream' + NL + stream + NL + 'endstream')
out = b'%PDF-1.4' + NL.encode(); offsets = []
for n, obj in enumerate(objs, 1):
    offsets.append(len(out)); out += ('%d 0 obj' % n + NL + obj + NL + 'endobj' + NL).encode()
xref = len(out)
out += ('xref' + NL + '0 %d' % (len(objs) + 1) + NL + '0000000000 65535 f ' + NL).encode() + ''.join('%010d 00000 n ' % o + NL for o in offsets).encode()
out += ('trailer' + NL + '<< /Size %d /Root 1 0 R >>' % (len(objs) + 1) + NL + 'startxref' + NL + str(xref) + NL + '%%EOF' + NL).encode()
open(target, 'wb').write(out)`;
  return execFileSync("python3", ["-c", script, "/dev/stdout", ...paragraphs], { maxBuffer: 1 << 20 });
}

/** The check runs under `python3 -I`, so pypdf must be importable in isolated mode (true in the sandbox image, usually not on a workstation). */
export function hasIsolatedPypdf(): boolean { return spawnSync("python3", ["-I", "-c", "import pypdf"]).status === 0; }
