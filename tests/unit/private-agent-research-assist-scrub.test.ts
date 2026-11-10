import { describe, expect, it } from "vitest";
import { copiesText, createScrubber, cutWhole, holdsHeading, SCRUB_POLICY } from "../../src/main/private-agent/research-assist-scrub";

// Backlog item 10.a, the second, third and fourth code reviews: the scrubber on its own, outside the packet builders.
const HASH = "3f5a9c0e7b1d2f4a6c8e0b2d4f6a8c0e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a";
const identity = (id: string, path = id) => ({ id, path, sha256: HASH, bytes: 1 });
const SOURCES = [
  identity("input/corpus/alpha-field-notes.md"),
  identity("https://example.org/reports/annual-2025.html", "sources/0123456789abcdef.bin"),
  identity("input/İzmir-rapor-2024.md"),
  identity("input/xx.yy"),
  identity("https://www.acme-hr.example/portal/home", "sources/1111111111111111.bin"),
  identity("https://docs.example/viewer?file=Q3-Board-Minutes-2025.pdf#Layoff-Plan-2025", "sources/2222222222222222.bin"),
  identity("input/ΑΠΟΛΟΓΙΣΜΟΣ-2024.md"),
];
const scrubber = createScrubber({ sources: SOURCES, suffix: "\nClaims ledger requirement: write claims.json beside output/report.md.\n", knownDigests: [HASH] });
const text = (value: string) => scrubber.scrub(value, "text").text, model = (value: string) => scrubber.scrub(value, "model").text;
/** In both scopes the scrub's output survives a second scrub unchanged, and the audit finds nothing in it. */
function settled(value: string) {
  for (const scope of ["text", "model"] as const) {
    const once = scrubber.scrub(value, scope).text;
    expect(scrubber.scrub(once, scope).text, `${scope}: ${value}`).toBe(once);
    expect(scrubber.finding(once, scope), `${scope}: ${value}`).toBeUndefined();
  }
}
const pairs = (hash: string, join: string) => hash.match(/../gu)!.join(join);

describe("the assist scrubber (research-assist-scrub.ts)", () => {
  it("replaces names, stems and hosts glued to text written without spaces, and ends a name's extensions where that text starts", () => {
    expect(text("该文件alpha-field-notes.md记录了")).toBe("该文件S1记录了");
    expect(text("ファイルalpha-field-notes.mdによると")).toBe("ファイルS1によると");
    expect(text("파일alpha-field-notes.md에 따르면")).toBe("파일S1에 따르면");
    expect(text("参见example.org上的年报")).toBe("参见S2上的年报");
    // A stem is a name only in model-written text; there it is bounded the same way.
    expect(text("见alpha-field-notes的记录")).toBe("见alpha-field-notes的记录");
    expect(model("见alpha-field-notes的记录")).toBe("见S1的记录");
    // The extensions after a name are Latin letters and digits: CJK text after "." is the sentence, not an extension.
    expect(text("见 alpha-field-notes.md。记录了十二棵树")).toBe("见 S1。记录了十二棵树");
    expect(model("见 alpha-field-notes.记录了十二棵健康的树木")).toBe("见 S1.记录了十二棵健康的树木");
    expect(text("详见https://intranet.acme.example/hr/layoffs-2025。")).toBe("详见[url]。");
  });

  it("takes paths, URLs and file names written in spaceless scripts, but not the prose after them or a list of names", () => {
    for (const path of ["C:\\用户\\张三\\文档\\合并计划.docx", "/home/김철수/문서/구조조정.xlsx", "/home/สมชาย/เอกสาร/แผน.docx", "/Users/张三/Documents/plan.docx"]) expect(text(path)).toBe("[file]");
    for (const url of ["https://内网.acme.example/hr/plan", "https://intranet.acme.example/人事/裁员名单.xlsx", "https://hr.acme.example/search?employee=张三&action=terminate",
      "www.例子.测试/秘密"]) expect(text(url)).toBe("[url]");
    expect(text("参见www.acme.example上的年报")).toBe("参见[url]上的年报");
    // Full-width slashes read as slashes; spaceless letters glued before a path go with it.
    expect(text("资料／2024／report.pdf を要約")).toBe("[file] を要約");
    expect(text("文件在用户/张三/合并计划.docx里")).toBe("[file]里");
    expect(text("文件在/Users/alice/Clients/Acme/merger-plan.docx里")).toBe("[file]里");
    expect(text("目录/Users/alice/Clients/Acme里有三个文件")).toBe("[file]里有三个文件");
    for (const list of ["中国/日本/韩国/美国", "東京／大阪", "２０２４／１１／０９"]) { expect(text(list)).toBe(list); expect(model(list)).toBe(list); }
  });

  it("replaces a file name in model text whatever its script or brackets, and keeps it in the owner's text", () => {
    for (const name of ["merger-plan(1).docx", "layoffs_2025(final).xlsx", "merger-plan,v2.docx", "Отчёт.docx", "Résumé.docx", "Café.pdf", "2024年度报告.pdf", "合并计划.docx"]) {
      expect(model(`see ${name} now`)).toBe("see [file] now");
      expect(text(`see ${name} now`)).toBe(`see ${name} now`);
    }
    expect(model("see (plan.docx) now")).toBe("see ([file]) now");
    expect(model("see results.Numbers now")).toBe("see results.Numbers now");
    expect(text("Клиенты/Акме/Отчёт.docx")).toBe("[file]");
    expect(model("Files: \\nmerger-plan-2025.docx")).toBe("Files: [file]");
  });

  it("reads an escape or a percent-encoded byte before a name as a boundary, and folds Turkish i, final sigma and ignorable characters", () => {
    expect(text("Files:\\nalpha-field-notes.md")).toBe("Files:\\nS1");
    expect(text("Shared%20alpha-field-notes.md")).toBe("Shared%20S1");
    expect(text("Bkz. İZMİR-RAPOR-2024.md ve izmir-rapor-2024.md")).toBe("Bkz. S3 ve S3");
    expect(text("Summarize απολογισμος-2024.md now")).toBe("Summarize S7 now");
    expect(text("alpha\u200b-field-notes.md and alpha\u2010field\u2010notes.md")).toBe("S1 and S1");
  });

  it("bounds a name only by letters of its own script, and takes the longest run of extensions nothing glues to", () => {
    expect(text("alpha-field-notes.md¹ and xx.yy²")).toBe("S1¹ and S4²");
    expect(text("①alpha-field-notes.md and בalpha-field-notes.md")).toBe("①S1 and בS1");
    expect(text("xalpha-field-notes.md")).toBe("xalpha-field-notes.md");
    // A timestamped copy's name is the source's name: the digits glued to its last extension go with it.
    expect(text("alpha-field-notes.md.20240315101500123 and xx.yy.Then")).toBe("S1 and S4.Then");
    expect(text("xx.yy.a.b.c.d.e")).toBe("S4.e");
    expect(text("alpha-field-notes.md.Then the trees")).toBe("S1.Then the trees");
    // Verified quotes arrive in NFKC, where footnote marks and circled numbers are plain digits: a name with an extension takes
    // the digits glued to it, and no alias is ever followed by a digit, which would read as another alias (`S1` then `1`).
    expect(text("Counts follow alpha-field-notes.md1 and xx.yy2 as cited; files: 1alpha-field-notes.md 2xx.yy")).toBe("Counts follow S1 and S4 as cited; files: S1 S4");
    expect(text("input/corpus/alpha-field-notes.md5 and https://example.org/reports/annual-2025.html2 here")).toBe("S1 and S2 here");
    expect(text("x1alpha-field-notes.md and alpha-field-notes.md1st")).toBe("x1alpha-field-notes.md and alpha-field-notes.md1st");
  });

  it("names a URL source by its host without www, by the file in its query, and in model text by its fragment", () => {
    expect(text("acme-hr.example/x and acme-hr.example")).toBe("S5 and S5");
    expect(text("Q3-Board-Minutes-2025.pdf and Q3-Board-Minutes-2025 and Layoff-Plan-2025")).toBe("S6 and Q3-Board-Minutes-2025 and Layoff-Plan-2025");
    expect(model("Q3-Board-Minutes-2025.pdf and Q3-Board-Minutes-2025 and Layoff-Plan-2025")).toBe("S6 and S6 and S6");
  });

  it("lets a source URL or host take the path, query or fragment after it, through an apostrophe inside it", () => {
    expect(text("www.example.org/news")).toBe("www.S2");
    expect(text("https://example.org/reports/annual-2025.html?x=1#top, then")).toBe("S2, then");
    expect(text("Mirror https://example.org/reports/annual-2025.html#section-'Payroll' now.")).toBe("Mirror S2' now.");
    expect(text("Mirror https://example.org/reports/annual-2025.html#'Payroll-2025' now")).toBe("Mirror S2' now");
  });

  it("replaces every other URL whole: slashless schemes in their own shapes, protocol-relative, localhost or bracketed IPv6 with a port or path, IPv4", () => {
    for (const url of ["mailto:hr@acme.example", "tel:+15551234567", "doi:10.1000/acme-2025", "urn:isbn:9783161484100", "data:text/plain;base64,SGVsbG8=", "//fileserver/share/x",
      "localhost:8080/admin/keys", "localhost/admin", "[fd00::1]:8080/admin/keys", "10.20.30.40:8443/backup"]) expect(text(`see ${url} now`)).toBe("see [url] now");
    expect(text("path=//fileserver/hr-share/merger-plan.docx and src=//cdn.acme-internal.example/payroll/export.js")).toBe("path=[url] and src=[url]");
    expect(text("See https://acme.example/hr/'layoff-plan-2025' today.")).toBe("See [url]' today.");
    for (const prose of ["on localhost today", "a [::2] slice", "news:markets and data:clean", "the 10.0.0.0/8 range"]) expect(text(prose)).toBe(prose);
  });

  it("replaces paths of every shape: either slash after a drive, rooted under either slash, doubled slashes, a quoted path with spaces, a digit-led extension", () => {
    for (const path of ["C:/Users/alice/plan.docx", "c:\\Users\\alice\\plan.docx", "%USERPROFILE%\\Documents\\plan.docx", "$HOME/Documents/plan.docx", "~/Documents/plan.docx",
      "/merger-plan-2025.docx", "archive/2024/acme-ledger.7z", "/Users/o'brien/notes/plan.docx", "archive\\2024\\ledger.xlsx", "/srv/data/exports", "\\Users\\alice\\Documents\\merger-plan.docx",
      "/Users//alice/merger-plan.docx", "Clients//Acme/merger-plan.docx", "/var/log//app/current/today"]) expect(text(`at ${path} now`)).toBe("at [file] now");
    expect(text("at \"/Users/alice/My Files/plan.docx\" now")).toBe("at \"[file]\" now");
    // A relative path is cut at its extension, or taken whole when it goes on after a dotted folder; a list without spaces goes whole.
    expect(text("a/b.docx#frag, a/b.docx,see and c/d.pdf,e/f.pdf")).toBe("[file]#frag, [file],see and [file]");
    for (const path of ["src/com.example.app/ui/main/view", "node_modules/lodash.merge/dist/es/index", "config/app.v2b/prod/eu/west"]) expect(text(path)).toBe("[file]");
    expect(text("see a/b.md/c/d/e now")).toBe("see [file] now");
  });

  it("replaces any 8-character piece of a known digest, however its groups are split, and a long run only with a hexadecimal letter", () => {
    expect(text(`id ${HASH.slice(0, 8)}-${HASH.slice(8, 16)}, ref ${HASH.slice(20, 36)}, 0x${HASH.slice(0, 12)}, ${HASH.slice(40, 48)}`)).toBe("id [digest], ref [digest], 0x[digest], [digest]");
    expect(text(`SHA256 Fingerprint=${pairs(HASH, ":").toUpperCase()}`)).toBe("SHA256 Fingerprint=[digest]");
    expect(text(`dump ${pairs(HASH, " ")} end`)).toBe("dump [digest] end");
    expect(text(`dotted ${HASH.slice(0, 16).match(/..../gu)!.join(".")} and ${HASH.slice(0, 16).match(/..../gu)!.join("\n")}`)).toBe("dotted [digest] and [digest]");
    expect(text(`hash ${"9".repeat(63)}a`)).toBe("hash [digest]");
    for (const prose of ["commit 3f786850e387550fdab836ed7e6dc881de23001b and dead beef cafe", `Years: ${Array.from({ length: 16 }, (_, i) => 2009 + i).join(" ")}`,
      "pi 3.1415926535897932384626433832795028841971693993751058209749445923", `Codes ${Array.from({ length: 16 }, (_, i) => String((i + 1) * 1001)).join(" ")}.`]) expect(text(prose)).toBe(prose);
  });

  it("keeps ordinary prose in any script: units, ratios, decimals, versions, times, lists, quotations and abbreviations", () => {
    for (const prose of ["Node.js/Deno and Node.js/React", "U.S./U.K. relations", "e.g./i.e. usage", "IPA /ˈæpəl/ and /tə/", "v1.2.3 to v1.3.0", "pi is 3.14", "and/or", "km/h",
      "Then/usually", "at 10:30", "ratio [1:2:3]", "1.5/2.0 scale", "24/7 support", "the 2024/25 season", "TCP/IP stack", "I/O bound", "w/o sugar", "1/2 cup", "costs $3.50/kg",
      "C# and F#", "mother-in-law", "COVID-19", "Москва/Санкт-Петербург/Казань/Сочи", "Αθήνα/Θεσσαλονίκη/Πάτρα/Ηράκλειο", "الرياض/جدة/الدمام/مكة", "café/thé/jus/eau",
      "Kraków/Łódź/Gdańsk/Poznań/Wrocław", "\"the input/output layer runs on Node.js\"", "“and/or 3.5mm”", "\"24/7 service at 3.5kg\"", "€10/2.5kg", "$3.50/1.5L", "1/2.5mg",
      "km/h.It was", "and/or.The next"]) { expect(text(prose), prose).toBe(prose); expect(model(prose), prose).toBe(prose); }
  });

  it("leaves output that a second scrub keeps and the audit passes, so a replacement never gets its own packet refused", () => {
    for (const value of ["src/com.example.app/ui/main/view", "node_modules/lodash.merge/dist/es/index", "/var/log//app/current/today", "config/app.v2b/prod/eu/west", "see a/b.md/c/d/e now",
      "example.org.report.md", "资料／2024／report.pdf を要約", "C:\\用户\\张三\\文档\\合并计划.docx", "https://hr.acme.example/search?employee=张三&action=terminate", "see (plan.docx) now",
      "Mirror https://example.org/reports/annual-2025.html#'Payroll-2025' now", `SHA256 Fingerprint=${pairs(HASH, ":")}`, "目录/Users/alice/Clients/Acme里有三个文件"]) settled(value);
    // A host left glued to a later replacement is taken by the next pass.
    expect(text("example.org.report.md")).toBe("S2.[file]");
  });

  it("finds in a finished string what the scrub replaces: source forms in the stricter NFKC view, the rest as the scrub reads them", () => {
    expect(scrubber.finding("see ﬀ alpha-field-notes.md", "text")).toBe("source_identity");
    expect(scrubber.finding(`ref ${HASH.slice(24, 32)}`, "text")).toBe("digest");
    expect(scrubber.finding("at localhost:8080/admin", "text")).toBe("url_or_path");
    expect(scrubber.finding("at archive/2024/ledger.7z", "text")).toBe("url_or_path");
    expect(scrubber.finding("at 资料／2024／report.pdf", "text")).toBe("url_or_path");
    expect(scrubber.finding("see report.docx", "text")).toBeUndefined();
    expect(scrubber.finding("see report.docx", "model")).toBe("url_or_path");
    expect(scrubber.finding("S1, [file], \"[file]\", [url] and [digest]", "model")).toBeUndefined();
  });

  it("reads a copy case-folded, with names and URLs glued to it kept, masking only long hexadecimal runs", () => {
    const source = "The orchard recorded twelve healthy trees during the autumn survey of the north slope, and the ledger agrees.";
    expect(copiesText([`See https://example.org/a${source.slice(0, 70).toUpperCase()}`], [source], 64)).toBe(true);
    expect(copiesText([`记录${"十二棵健康的树木".repeat(10)}`], [`见https://example.org/${"十二棵健康的树木".repeat(10)}`], 64)).toBe(true);
    expect(copiesText([source.slice(0, 63)], [source], 64)).toBe(false);
    expect(copiesText([`${source.slice(0, 40)}${"a".repeat(16)}${source.slice(40, 80)}`], [`${source.slice(0, 40)}${"b".repeat(16)}${source.slice(40, 80)}`], 64)).toBe(true);
  });

  it("finds a whole literal heading of 32 code points or more among many, and no shorter one", () => {
    const headings = Array.from({ length: 2000 }, (_, i) => `## Quarterly orchard survey of the synthetic year, part ${i}`);
    expect(holdsHeading([`Plan: quarterly orchard survey of the synthetic year, part 1234 first.`], headings, 32)).toBe(true);
    expect(holdsHeading(["Plan: quarterly orchard survey of the synthetic year, part"], headings, 32)).toBe(false);
    expect(holdsHeading(["see: Short title"], ["# Short title"], 32)).toBe(false);
  });

  it("cuts a gist without splitting an alias or a placeholder, and at any character of text written without spaces", () => {
    expect(cutWhole("see S12 and [file] now", 6)).toBe("see");
    expect(cutWhole("see S12 and [file] now", 15)).toBe("see S12 and");
    expect(cutWhole("记录了十二棵健康的树木", 5)).toBe("记录了十二");
  });

  it("scans crafted text in linear time", () => {
    const crafted = [`a/${"1.".repeat(32_000)}x`, "+a\\".repeat(21_000), `${"a'".repeat(32_000)}/x`, "0123456789abcdef".repeat(4_000), `${"abcd".repeat(16_000)}g`, "+a".repeat(32_000),
      `${"xx.yy.".repeat(10_000)}${"z".repeat(30)}`, "a:".repeat(32_000), "%a%".repeat(21_000), `${"a".repeat(64_000)}.docx`, "[::".repeat(21_000), `https://x.com/a${")".repeat(64_000)}`,
      "\"“/\"".repeat(16_000), `/${"汉/a汉".repeat(16_000)}`, `${"资料".repeat(32_000)}/`, `${"aa ".repeat(21_000)}q`, `a${"\u0301".repeat(32_000)}${"\u0316".repeat(32_000)}`];
    const started = performance.now();
    for (const value of crafted) { scrubber.scrub(value, "model"); scrubber.finding(value, "model"); }
    // Tens of milliseconds each here; the quadratic patterns these replace took from seconds to minutes at this size.
    expect(performance.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it("scans many sources that share a long prefix, a corpus of deep URLs and megabytes of source text in linear time", () => {
    const deep = (i: number) => `https://h${i}.example/${Array.from({ length: 60 }, (_, k) => `seg${k}-${i}`).join("/")}?q=${"x".repeat(1500)}`;
    const urls = createScrubber({ sources: Array.from({ length: 40 }, (_, i) => identity(deep(i), `sources/${String(i).padStart(16, "0")}.bin`)), suffix: "", knownDigests: [HASH] });
    const started = performance.now();
    expect(urls.scrub(`See ${deep(7)} and h3.example/seg58-3/seg59-3 now. ${"The orchard recorded twelve healthy trees. ".repeat(100)}`, "model").text.startsWith("See S8 and S4 now.")).toBe(true);
    const dashes = createScrubber({ sources: Array.from({ length: 1000 }, (_, i) => identity(`input/${"-".repeat(120)}/file-${i}.md`)), suffix: "", knownDigests: [HASH] });
    const zeros = createScrubber({ sources: Array.from({ length: 1000 }, (_, i) => identity(`scans/${String(i).padStart(16, "0")}.txt`)), suffix: "", knownDigests: [HASH] });
    dashes.scrub("-".repeat(48_000), "model"); zeros.scrub(`Totals ${"0".repeat(1_200)} end`.repeat(40), "model");
    expect(copiesText(["The orchard recorded twelve healthy trees during the autumn survey, it seems."], ["The meadow and the orchard. ".repeat(300_000)], 64)).toBe(false);
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 60_000);

  it("binds its rules into the policy the protocol block hashes", () => {
    expect(SCRUB_POLICY).toMatchObject({ version: 3, placeholders: { url: "[url]", file: "[file]", digest: "[digest]", source: "[source]" } });
    expect(SCRUB_POLICY.patterns.url.length).toBe(8);
    expect(SCRUB_POLICY.patterns.relative.run).toContain("\\1");
  });
});
