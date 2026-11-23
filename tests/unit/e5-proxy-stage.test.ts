import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../../scripts/e5-proxy-stage.py");
const ownerAlias = "Synthetic Owner Example";
const privateHost = "model.proxy.invalid";
const policy = { ownerNames: [ownerAlias], endpointHosts: [privateHost] };
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "soar-proxy-input-")));
  roots.push(root);
  const source = join(root, "source"), staging = join(root, "staging");
  mkdirSync(source, { mode: 0o700 });
  mkdirSync(staging, { mode: 0o700 });
  return { root, source, staging, out: join(staging, "copy") };
}

function stage(source: string, out: string, stdin = JSON.stringify({ ...policy, materialRoots: roots })) {
  const result = spawnSync("python3", ["-I", script, "--source", source, "--out", out], { input: stdin, encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

function expectRefusal(result: ReturnType<typeof stage>, forbidden: string[]) {
  expect(result.status).not.toBeNull();
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).not.toBe("");
  for (const text of [...forbidden, ownerAlias, privateHost, "Traceback"]) expect(result.stderr).not.toContain(text);
}

function writeOffice(file: string, main: string, contentType: string, xml: string, extras: Record<string, string> = {}) {
  const parts = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${contentType}.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`,
    [main]: xml, ...extras,
  };
  const writer = [
    "import json, sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1], 'w', compression=zipfile.ZIP_DEFLATED) as document:",
    "    for name, content in json.load(sys.stdin).items():",
    "        document.writestr(name, content)",
  ].join("\n");
  const result = spawnSync("python3", ["-I", "-c", writer, file], { input: JSON.stringify(parts), encoding: "utf8" });
  expect(result.status).toBe(0);
}

function writeDocx(file: string, paragraphs: string, extras: Record<string, string> = {}) {
  writeOffice(file, "word/document.xml", "wordprocessingml.document",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${paragraphs}</w:p></w:body></w:document>`, extras);
}

describe("E5 proxy material staging", () => {
  it("checks prospective website intake against the passive handoff", () => {
    const suite = resolve(__dirname, "../python");
    const result = spawnSync("python3", ["-IB", "-m", "unittest", "discover", "-s", suite, "-p", "test_e5_website_intake.py"], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });

  it("copies public and synthetic material before handoff and reports only counts and a digest", () => {
    const { root, source, out } = fixture();
    const files = {
      "source.json": JSON.stringify({ url: "https://stackoverflow.com/questions/12345", paraphrase: "Make a comparison table." }),
      "brief.md": "Compare the proposed lecture schedule against the sample above.\n",
      "schedule.csv": "session,start,minutes\nHydrology,10:30:25,25\nEcology,11:00:00,20\n",
      "index.html": '<!doctype html><html><body><p>Lecture schedule</p><a href="https://stackoverflow.com/questions/12345">Public source</a></body></html>',
      "schedule.css": "p { color: navy; }\n",
    };
    for (const [name, content] of Object.entries(files)) writeFileSync(join(source, name), content);
    const result = stage(source, out);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ status: "staged", files: Object.keys(files).length, sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(result.stdout).not.toContain(root);
    for (const [name, content] of Object.entries(files)) expect(readFileSync(join(out, name), "utf8")).toBe(content);
  });

  it.each([
    ["owner name", ownerAlias],
    ["endpoint", `https://${privateHost}/v1`],
    ["email", "sample.reader@example.invalid"],
    ["credential", "sk-" + "SampleToken".repeat(3)],
    ["absolute path", "/Users/" + "exampleperson/Documents/notes.txt"],
    ["Windows path", "C:\\Users\\exampleperson\\Documents\\notes.txt"],
  ])("refuses %s in source text atomically and reports no matched material", (kind, value) => {
    const { root, source, out, staging } = fixture();
    writeFileSync(join(source, "a-clean.md"), "Summarise the timetable.");
    writeFileSync(join(source, "z-input.txt"), `Review this example: ${value}\n`);
    const result = stage(source, out);
    expectRefusal(result, [root, value, "z-input.txt"]);
    expect(result.stderr.trim()).toBe(kind === "owner name" ? "owner_data" : "sensitive_content");
    expect(readdirSync(staging)).toEqual([]);
  });

  it.each(["sample.reader@example.invalid.txt", "C:\\Users\\exampleperson\\notes.txt"])("scans suspect filenames as well as content", name => {
    const { root, source, out } = fixture();
    writeFileSync(join(source, name), "Only synthetic figures.");
    expectRefusal(stage(source, out), [root, name]);
    expect(existsSync(out)).toBe(false);
  });

  it.each(["symlink", "hardlink"])("refuses a %s to an outside file", kind => {
    const { root, source, out } = fixture(), external = join(root, "outside.txt");
    writeFileSync(external, "Unrelated file.");
    if (kind === "symlink") symlinkSync(external, join(source, "notes.txt"));
    else linkSync(external, join(source, "notes.txt"));
    expectRefusal(stage(source, out), [root, "outside.txt", "notes.txt"]);
    expect(existsSync(out)).toBe(false);
  });

  it("requires a usable policy and regular supported input", () => {
    const { root, source, out } = fixture();
    writeFileSync(join(source, "brief.txt"), "Synthetic material.");
    for (const bad of ["{", "{}", JSON.stringify(policy), JSON.stringify({ ...policy, materialRoots: [] }),
      JSON.stringify({ ...policy, materialRoots: [root], ownerNames: [] }), JSON.stringify({ ...policy, materialRoots: [root], endpointHosts: [] })]) {
      expectRefusal(stage(source, out, bad), [root]);
      expect(existsSync(out)).toBe(false);
    }
    const alias = join(root, "source-alias");
    symlinkSync(source, alias, "dir");
    expectRefusal(stage(alias, out), [root]);
    writeFileSync(join(source, "opaque.bin"), Buffer.from([0, 1, 255]));
    expectRefusal(stage(source, out), [root, "opaque.bin"]);
    expect(existsSync(out)).toBe(false);
  });

  it("checks both the source and destination against the operator's private material roots", () => {
    const { root, source, out, staging } = fixture();
    writeFileSync(join(source, "brief.txt"), "Synthetic task.");
    for (const only of [source, staging]) {
      expectRefusal(stage(source, out, JSON.stringify({ ...policy, materialRoots: [only] })), [root]);
      expect(existsSync(out)).toBe(false);
    }
  });

  it.each([
    ["index.html", '<img src="https://images.example.test/banner.png">'],
    ["index.html", '<img srcset="https://images.example.test/banner.png 1x">'],
    ["index.html", '<link href="https://assets.example.test/layout.css" rel="stylesheet">'],
    ["index.html", '<meta content="2;url=https://example.test" http-equiv="refresh">'],
    ["layout.css", '@import "https://assets.example.test/layout.css";'],
    ["layout.css", 'p { background-image: url("https://images.example.test/banner.png"); }'],
    ["layout.css", 'p { background-image: image-set("https://images.example.test/banner.png" 1x); }'],
  ])("refuses automatic external resources in %s", (name, content) => {
    const { root, source, out } = fixture();
    writeFileSync(join(source, name), content);
    expectRefusal(stage(source, out), [root, name, content]);
    expect(existsSync(out)).toBe(false);
  });

  it("preserves the bytes of a supported text-only Word document", () => {
    const { source, out } = fixture(), file = join(source, "schedule.docx");
    writeDocx(file, "<w:r><w:t>Sample lecture schedule</w:t></w:r>");
    expect(stage(source, out).status).toBe(0);
    expect(readFileSync(join(out, "schedule.docx"))).toEqual(readFileSync(file));
  });

  it("preserves the original bytes of a quoted white-square content declaration", () => {
    const { source, out } = fixture();
    const css = String.raw`li::before { content: "\25A1"; } li::after { color: navy; content: '\25a1' }`;
    const html = `<style>${css}</style><ul><li>Sample item</li></ul>`;
    writeFileSync(join(source, "icons.css"), css);
    writeFileSync(join(source, "index.html"), html);
    expect(stage(source, out).status).toBe(0);
    expect(readFileSync(join(out, "icons.css"), "utf8")).toBe(css);
    expect(readFileSync(join(out, "index.html"), "utf8")).toBe(html);
  });

  it.each([
    String.raw`li::before { content: "\25a0"; }`,
    String.raw`li::before { content: "\25a10"; }`,
    String.raw`li::before { content: "\25a1 more"; }`,
    String.raw`li::before { content: "\25a1" "more"; }`,
    String.raw`li::before { content: "\25a1" !important; }`,
    String.raw`li::before { --other-content: "\25a1"; }`,
    String.raw`li { --panel: { content: "\25a1"; }; }`,
    String.raw`li { --panel: placeholder(; content: "\25a1";); }`,
    String.raw`li { --panel: [; content: "\25a1";]; }`,
    String.raw`@media print { li::before { content: "\25a1"; } }`,
    String.raw`li::before { content: \25a1; }`,
    String.raw`li::before { /* content: "\25a1"; */ color: navy; }`,
    String.raw`li::before { content: 'example; content: "\25a1";'; }`,
    String.raw`li::before { content: "\25a1"; } p { font-family: "\25a1"; }`,
  ])("keeps CSS escapes outside an exact decorative declaration opaque", css => {
    const { root, source, out } = fixture();
    writeFileSync(join(source, "icons.css"), css);
    const result = stage(source, out);
    expectRefusal(result, [root, css, "icons.css"]);
    expect(result.stderr.trim()).toBe("opaque_content");
  });

  it("uses the declaration-list context for inline styles", () => {
    const { root, source, staging, out } = fixture();
    const clean = String.raw`<span style="content: '\25a1';">Item</span>`;
    writeFileSync(join(source, "index.html"), clean);
    expect(stage(source, out).status).toBe(0);
    expect(readFileSync(join(out, "index.html"), "utf8")).toBe(clean);
    const nested = String.raw`<span style="--panel: { content: '\25a1'; }">Item</span>`;
    writeFileSync(join(source, "index.html"), nested);
    const result = stage(source, join(staging, "nested"));
    expectRefusal(result, [root, nested]);
    expect(result.stderr.trim()).toBe("opaque_content");
  });

  it("preserves complete static CSS comments and scanned accessibility and data attributes", () => {
    const { source, out } = fixture();
    const css = "/* Print layout\n   for the sample */\n@media print { p { color: navy; } }";
    const html = '<style>\n/* Table layout */\ntable { width: 100%; }</style>'
      + '<section role="region" aria-label="Schedule" data-view-name="weekly" tabindex="0" '
      + 'style="/* Accent */ color: navy">Timetable</section>';
    for (const [name, body] of [["layout.css", css], ["report.html", html]]) writeFileSync(join(source, name), body);
    expect(stage(source, out).status).toBe(0);
    expect(readFileSync(join(out, "layout.css"), "utf8")).toBe(css);
    expect(readFileSync(join(out, "report.html"), "utf8")).toBe(html);
  });

  it.each([
    ["layout.css", "/* /nonstandard/private-file */"],
    ["layout.css", "p { /* unfinished"],
    ["layout.css", "/* nested /* comment */"],
    ["layout.css", "p { color: navy; } */"],
    ["layout.css", 'p { content: "/*"; }'],
    ["layout.css", "p { background: u/**/rl(https://assets.example.test/image.png); }"],
    ["layout.css", '@im/**/port "https://assets.example.test/layout.css";'],
    ["report.html", '<style>/* sample.reader@example.invalid */ table { width: 100%; }</style>'],
    ["report.html", '<div aria-label="Schedule" data-view-name="sample.reader@example.invalid">Read</div>'],
    ["report.html", "<!-- /*/private-file -->"],
    ["report.html", "<p>/*/private-file</p>"],
  ])("refuses private content and ambiguous or loading CSS around comments in %s", (name, content) => {
    const { root, source, out } = fixture();
    writeFileSync(join(source, name), content);
    expectRefusal(stage(source, out), [root, name, content, "sample.reader@example.invalid"]);
    expect(existsSync(out)).toBe(false);
  });

  it.each([
    ["deck.pptx", "ppt/presentation.xml", "presentationml.presentation", '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'],
    ["schedule.xlsx", "xl/workbook.xml", "spreadsheetml.sheet", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'],
  ])("scans supported %s package metadata before copying its original bytes", (name, main, contentType, xml) => {
    const { root, source, out, staging } = fixture(), file = join(source, name);
    writeOffice(file, main, contentType, xml);
    expect(stage(source, out).status).toBe(0);
    expect(readFileSync(join(out, name))).toEqual(readFileSync(file));
    writeOffice(file, main, contentType, xml, { "docProps/core.xml": `<creator>${ownerAlias}</creator>` });
    const next = join(staging, "next");
    expectRefusal(stage(source, next), [root, name]);
    expect(existsSync(next)).toBe(false);
  });

  it("checks the displayed text of HTML and the decoded contents of JSON", () => {
    const { root, source, out } = fixture(), page = join(source, "need.html");
    writeFileSync(page, "<p><strong>Synthetic Owner</strong> Example</p>");
    expectRefusal(stage(source, out), [root, "need.html"]);
    writeFileSync(page, "<p>Public request</p>");
    writeFileSync(join(source, "source.json"), '{"contact":"sample.reader\\u0040example.invalid"}');
    expectRefusal(stage(source, out), [root, "source.json", "sample.reader@example.invalid"]);
    expect(existsSync(out)).toBe(false);
  });

  it("checks Word text, metadata and opaque package parts before handing off the original file", () => {
    const { root, source, out } = fixture(), file = join(source, "schedule.docx");
    const safe = "<w:r><w:t>Sample lecture schedule</w:t></w:r>";
    const cases: { body: string; extras: Record<string, string> }[] = [
      { body: "<w:r><w:t>Synthetic Owner</w:t></w:r><w:r><w:t xml:space=\"preserve\"> Example</w:t></w:r>", extras: {} },
      { body: safe, extras: { "docProps/core.xml": '<m:core xmlns:m="urn:metadata" m:creator="sample.reader@example.invalid"/>' } },
      { body: safe, extras: { "word/media/image1.png": "opaque image content" } },
    ];
    for (const item of cases) {
      writeDocx(file, item.body, item.extras);
      expectRefusal(stage(source, out), [root, "schedule.docx", "sample.reader@example.invalid"]);
      expect(existsSync(out)).toBe(false);
    }
  });

  it("refuses source/output overlap and preserves an existing destination", () => {
    const { root, source, out } = fixture();
    writeFileSync(join(source, "brief.txt"), "Original brief.");
    const nested = join(source, "copy");
    expectRefusal(stage(source, nested), [root]);
    expect(existsSync(nested)).toBe(false);
    mkdirSync(out, { mode: 0o700 });
    writeFileSync(join(out, "keep.txt"), "Earlier approved material.");
    expectRefusal(stage(source, out), [root]);
    expect(readdirSync(out)).toEqual(["keep.txt"]);
    expect(readFileSync(join(out, "keep.txt"), "utf8")).toBe("Earlier approved material.");
  });

  it("refuses staging from an unrelated checkout or into a shared output directory", () => {
    const { root, source, staging, out } = fixture();
    const checkout = join(root, "unrelated-checkout"), nested = join(checkout, "material");
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(checkout, ".git"));
    writeFileSync(join(nested, "brief.txt"), "Synthetic task.");
    expectRefusal(stage(nested, out), [root, "unrelated-checkout"]);
    writeFileSync(join(source, "brief.txt"), "Synthetic task.");
    chmodSync(staging, 0o755);
    expectRefusal(stage(source, out), [root]);
    expect(existsSync(out)).toBe(false);
  });

  it("checks changed source bytes at the next handoff without altering the previous copy", () => {
    const { root, source, out, staging } = fixture(), file = join(source, "brief.txt");
    writeFileSync(file, "Write a synthetic briefing.");
    expect(stage(source, out).status).toBe(0);
    writeFileSync(file, `New recipient: ${ownerAlias}`);
    const next = join(staging, "dispatch");
    expectRefusal(stage(source, next), [root]);
    expect(existsSync(next)).toBe(false);
    expect(readFileSync(join(out, "brief.txt"), "utf8")).toBe("Write a synthetic briefing.");
  });
});
