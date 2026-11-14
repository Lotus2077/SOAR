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
    expect(text("www.example.org/news")).toBe("S2");
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
    // Under policy 5 a relative path's fragment or query goes with it.
    expect(text("a/b.docx#frag, a/b.docx,see and c/d.pdf,e/f.pdf")).toBe("[file], [file],see and [file]");
    for (const path of ["src/com.example.app/ui/main/view", "node_modules/lodash.merge/dist/es/index", "config/app.v2b/prod/eu/west"]) expect(text(path)).toBe("[file]");
    expect(text("see a/b.md/c/d/e now")).toBe("see [file] now");
    // An opening bracket a relative path's run took from before it stays outside the placeholder, as a closing one does.
    expect(text("see (a/b.md) and [c/d.pdf] now")).toBe("see ([file]) and [[file]] now");
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
    // A host-file name glued after a host through "." is another file: the whole run is one placeholder.
    expect(text("example.org.report.md")).toBe("[file]");
  });

  it("sends a source's host with labels, userinfo or a word glued before it, and its // and scheme, as [url]; a lone www. keeps the alias", () => {
    for (const value of ["payroll-2025.intranet.example.org/hr/salaries.xlsx", "acme-merger.example.org/secret/path", "a.b.c.d.example.org/x", "alice:hunter2@example.org/reports/annual-2025.html",
      "evil-example.org/reports/annual-2025.html", "xexample.org/reports/annual-2025.html", "payroll.intranet.example.org/reports/annual-2025.html", "//sub.example.org/x",
      "https://sub.example.org/x", "sub.example.org", "alice@example.org", "mailto:hr@example.org"]) {
      expect(text(`see ${value} now`), value).toBe("see [url] now");
      expect(model(`see ${value} now`), value).toBe("see [url] now");
      settled(`see ${value} now`);
    }
    expect(scrubber.scrub("see payroll.intranet.example.org/x", "text").counts).toMatchObject({ sources: 0, urls: 1 });
    for (const value of ["www.example.org/news", "https://www.example.org/x", "example.org/reports/annual-2025.html", "mirror/example.org/reports/annual-2025.html"]) expect(text(value), value).toBe("S2");
    expect(text("the example.org team")).toBe("the S2 team");
    // A scheme-less URL with a password is a credential with no source involved too, with or without a path.
    expect(text("log in as alice:hunter2@acme.example or alice:hunter2@acme.example/x")).toBe("log in as [url] or [url]");
  });

  it("sends a file name glued to a source's file name through -, _ or . on either side, folder and all, as [file], and keeps the alias for the name itself", () => {
    for (const value of ["secret-merger-alpha-field-notes.md", "q3_board_alpha-field-notes.md", "2025.alpha-field-notes.md", "Final-ALPHA-FIELD-NOTES.MD", "merger/private-alpha-field-notes.md",
      "Clients/Acme/old-alpha-field-notes.md", "/tmp/old-alpha-field-notes.md", "alpha-field-notes.md-secret", "alpha-field-notes.md_secret", "alpha-field-notes.md.secret-merger"]) {
      expect(text(`see ${value} now`), value).toBe("see [file] now");
      expect(model(`see ${value} now`), value).toBe("see [file] now");
      settled(`see ${value} now`);
    }
    for (const value of ["alpha-field-notes.md", "corpus/alpha-field-notes.md", "Clients/Acme/alpha-field-notes.md", "/tmp/alpha-field-notes.md"]) expect(text(`see ${value} now`), value).toBe("see S1 now");
    expect(text("- alpha-field-notes.md and see alpha-field-notes.md.")).toBe("- S1 and see S1.");
    // A run glued after the name gives back a full stop; a dash before the name with no word before it glues nothing.
    expect(text("see alpha-field-notes.md-secret. Next")).toBe("see [file]. Next");
    for (const mark of ["-", "_"]) expect(text(`see alpha-field-notes.md-secret${mark} now`), mark).toBe(`see [file]${mark} now`);
    expect(text("see -alpha-field-notes.md now")).toBe("see -S1 now");
    // A whole path form glued straight to more text is another file under policy 5 (L1): the token's rest goes with it, here a
    // lone `www.` and a host, so both sources' forms become one [file].
    expect(text("input/corpus/alpha-field-notes.mdwww.example.org/news")).toBe("[file]");
    // An extension-less stem glued to other text keeps it (a recorded limit): the rule is for file names.
    expect(model("pre-alpha-field-notes and alpha-field-notes-v2")).toBe("pre-S1 and S1-v2");
  });

  it("leaves a URL on another host that ends in a source's path or file name to the URL rule, query, fragment and tail included", () => {
    for (const url of ["https://other.test/reports/annual-2025.html", "//cdn.other.test/reports/annual-2025.html", "https://other.test/x/old-alpha-field-notes.md",
      "https://hr.acme-merger.test/alpha-field-notes.md?token=sk_live_abcdef", "https://hr.acme-merger.test/alpha-field-notes.md#Layoff-List-Q3",
      "https://hr.acme-merger.test/alpha-field-notes.md/private/acme-merger", "s3://bucket/corpus/alpha-field-notes.md", "//cdn.other.test/x/old-alpha-field-notes.md?token=abc",
      "//cdn.other.test/alpha-field-notes.md-v2#Layoff-List-Q3", "http://example.org/reports/annual-2025.html?x=1"]) {
      expect(text(`see ${url} now`), url).toBe("see [url] now");
      expect(model(`see ${url} now`), url).toBe("see [url] now");
      settled(`see ${url} now`);
    }
    expect(scrubber.scrub("see https://other.test/reports/annual-2025.html now", "text").counts).toMatchObject({ urls: 1 });
    // A rooted local path's root slash goes into the alias. A UNC path with a glued name is [file] whole under policy 5: policy 4
    // kept one backslash before it.
    expect(text("see /tmp/alpha-field-notes.md now")).toBe("see S1 now");
    expect(text("see \\\\fileserver\\share\\old-alpha-field-notes.md now")).toBe("see [file] now");
    // A single slash before a glued name is no URL's: the name is [file], and the slash, with no folder taken, stays.
    expect(text("see /old-alpha-field-notes.md now")).toBe("see /[file] now");
  });

  it("takes a protocol-relative URL whole as [url] after a `//` that starts its token, whatever placeholder the source's form became", () => {
    // A host-led form with a glued lead after another host's `//`: the URL, tail and all. A scheme's URL rule already took it whole.
    for (const url of ["//proxy.other.test/fetch/sub.example.org/reports/annual-2025.html-secret/plan.md", "//proxy.other.test/fetch/sub.example.org/reports/annual-2025.html_/private/acme-merger.txt",
      "//proxy.other.test/fetch/sub.example.org/reports/annual-2025.html.bak", "//proxy.other.test/fetch/alice:hunter2@example.org/reports/annual-2025.html-secret/plan.md",
      "//proxy.other.test/fetch/evil-www.acme-hr.example/portal/homepage/secret-plan.md", "//proxy.other.test/fetch/sub.example.org/reports/annual-2025.html&token=abc",
      "//proxy.other.test/fetch/sub.example.org/reports/annual-2025.html-secret", "https://proxy.other.test/fetch/sub.example.org/reports/annual-2025.html-secret/plan.md",
      "//cdn.other.test/x/old-claims.json/private/acme-merger", "//cdn.other.test/x/claims.json?token=abc"]) {
      expect(text(`see ${url} now`), url).toBe("see [url] now");
      expect(model(`see ${url} now`), url).toBe("see [url] now");
      settled(`see ${url} now`);
    }
    expect(scrubber.scrub("see //proxy.other.test/fetch/sub.example.org/reports/annual-2025.html-secret/plan.md now", "text").counts).toMatchObject({ sources: 0, urls: 1, files: 0 });
    // One slash is no URL's start, and a host-led form right after the `//` keeps its own span: L1's stated residue, which policy 5 owns.
    for (const scope of ["text", "model"] as const) {
      expect(scrubber.scrub("see \"/old-alpha-field-notes.md\" now", scope).text).toBe("see \"/[file]\" now");
      // Under policy 5 a name that a query follows takes it (G4), and a host-led form right after a `//` that starts its token is
      // read by the protocol-relative rule, tail and all (L1's form after `//`).
      expect(scrubber.scrub("see \"/claims.json?token=abc\" now", scope).text).toBe("see \"/[url]\" now");
      expect(scrubber.scrub("see //sub.example.org/reports/annual-2025.html-secret now", scope).text).toBe("see [url] now");
    }
    // The edge may be the text's start, a quote, `<`, an apostrophe before the slash, or an opening bracket after one of those. The
    // host's appended file names count too. Where the URL rule may start but no edge stands (a bracket glued to a word), the URL is
    // `[url]` once no other rule has taken it; where it may not start (after a word), the placeholder stays as before.
    for (const [value, sent] of [["src=\"//cdn.other.test/x/final-report.md/private/acme-merger\"", "src=\"[url]\""], ["//cdn.other.test/x/claims.json?token=abc", "[url]"],
      ["see '//cdn.other.test/x/claims.json?token=abc' now", "see '[url]' now"], ["see x'//cdn.other.test/x/claims.json?token=abc now", "see x'[url] now"],
      ["see <//cdn.other.test/x/claims.json?token=abc> now", "see <[url]> now"], ["see (//cdn.other.test/x/claims.json?token=abc) now", "see ([url]) now"],
      ["see \"[//cdn.other.test/x/claims.json?token=abc]\" now", "see \"[[url]]\" now"], ["see x(//cdn.other.test/x/claims.json?token=abc) now", "see x([url]) now"],
      ["see x//cdn.other.test/x/claims.json?token=abc now", "see x//[url] now"]] as const) {
      for (const scope of ["text", "model"] as const) expect(scrubber.scrub(value, scope).text, `${value} ${scope}`).toBe(sent);
    }
    // A placeholder that no rule took and that became [url] counts as one URL, not as the file it was.
    expect(scrubber.scrub("see x(//cdn.other.test/x/claims.json?token=abc) now", "text").counts).toMatchObject({ files: 0, urls: 1 });
    // After `=`, `,`, `;` or a CJK letter the URL becomes [url] too, unless a relative path took the word before it, as before.
    expect(text("src=//proxy.other.test/fetch/sub.example.org/reports/annual-2025.html-secret now")).toBe("src=[url] now");
    // A form two sources share, plain or glued, with a query or a path.
    const pair = createScrubber({ sources: [identity("https://example.org/report.html", "sources/3333333333333333.bin"), identity("mirror/example.org/report.html")], suffix: "", knownDigests: [HASH] });
    const notes = createScrubber({ sources: [identity("a/notes-2024.md"), identity("b/notes-2024.md")], suffix: "", knownDigests: [HASH] });
    // The last row holds two provisional matches in one URL; the first one's URL takes the second whole.
    for (const [shared, value] of [[pair, "//cdn.other.test/x/report.html?token=abc"], [pair, "//cdn.other.test/x/old-report.html?token=sk_live_abcdef"],
      [pair, "//cdn.other.test/x/old-report.html/private/acme-merger"], [notes, "//cdn.other.test/x/old-notes-2024.md/private/acme-merger"],
      [pair, "//cdn.other.test/x/old-report.html//alice@example.org/report.html?token=abc"]] as const) {
      for (const scope of ["text", "model"] as const) expect(shared.scrub(`see ${value} now`, scope).text, `${value} ${scope}`).toBe("see [url] now");
    }
  });

  it("keeps [file], never the alias, after a `//` that starts no token, and keeps hidden what a rule took whole there before", () => {
    // No URL rule starts after a word, a path, a third slash, a backtick, `>` or `|`: the glued name is [file], beside what the match left.
    for (const [value, sent] of [["a//old-alpha-field-notes.md", "a//[file]"], ["/tmp//old-alpha-field-notes.md", "/tmp//[file]"], ["input/corpus//old-alpha-field-notes.md", "input/corpus//[file]"],
      ["///old-alpha-field-notes.md", "///[file]"], ["bucket//example.org.annual-2025.html", "[file]"], ["`//cdn.other.test/x/old-alpha-field-notes.md?token=abc`", "`[url]"],
      [">//cdn.other.test/x/old-alpha-field-notes.md?token=abc", ">[url]"], ["|//cdn.other.test/x/old-alpha-field-notes.md?token=abc|", "|[url]"],
      ["a//old-alpha-field-notes.md/private/acme-merger/x", "a//[file]"]] as const) {
      expect(text(`see ${value} now`), value).toBe(`see ${sent} now`);
      expect(model(`see ${value} now`), value).toBe(`see ${sent} now`);
      settled(`see ${value} now`);
    }
    expect(scrubber.scrub("see a//old-alpha-field-notes.md now", "text").counts).toMatchObject({ sources: 0, files: 1 });
    // The alias still stands where a rule takes the token whole: a URL after `:`, `=`, `,`, `;` or a CJK letter, the alias read as a
    // scheme, or a relative path. Each output is d364b46's, and the query, tail or word before stays hidden.
    const single = createScrubber({ sources: [identity("input/corpus/alpha-field-notes.md")], suffix: "", knownDigests: [HASH] });
    for (const [value, sent] of [["地址://cdn.other.test/x/old-alpha-field-notes.md?token=sk_live_abcdef 见", "地址:[url] 见"], ["-https://cdn.other.test/x/old-alpha-field-notes.md?token=abc now", "-[url] now"],
      ["see ///old-alpha-field-notes.md:///etc/acme-merger/layoffs-2025 now", "see ///[url] now"], ["see corpus//old-alpha-field-notes.md:///srv/hr/layoffs-2025 now", "see corpus//[url] now"],
      ["see secret-folder//old-alpha-field-notes.md/x.bak now", "see [file] now"]] as const) {
      for (const scope of ["text", "model"] as const) expect(single.scrub(value, scope).text, `${value} ${scope}`).toBe(sent);
    }
    // Counts are those of the sent text under policy 5: the alias a rule took is no source in it.
    expect(single.scrub("地址://cdn.other.test/x/old-alpha-field-notes.md?token=sk_live_abcdef 见", "text").counts).toMatchObject({ sources: 0, files: 0, urls: 1 });
    expect(text("see x//proxy.other.test/fetch/u/annual-2025.html-secret/plan.md now")).toBe("see [file] now");
    // A placeholder after a `//` that starts no token stays as d364b46 had it; there a relative path rule may take the whole token.
    expect(text("token=abc,//mirror/x_example.org/reports/annual-2025.html_/private/acme-merger.txt) now")).toBe("[url]) now");
    // A mark moves with the replacements before it.
    expect(text("see https://other.test/a/b and a//old-alpha-field-notes.md now")).toBe("see [url] and a//[file] now");
    // A form two sources share keeps its own placeholder: [file] when a name is glued to it, [source] when not.
    const shared = createScrubber({ sources: [identity("a/report.html"), identity("b/report.html")], suffix: "", knownDigests: [HASH] });
    for (const [value, sent] of [["a//old-report.html", "a//[file]"], ["a//report.html", "a//[source]"]] as const) {
      for (const scope of ["text", "model"] as const) expect(shared.scrub(`see ${value} now`, scope).text, `${value} ${scope}`).toBe(`see ${sent} now`);
    }
  });

  it("keeps the host lead of a form that a URL source and a local copy share, in either source order, and its URL's tail, so no credential or query is left", () => {
    const url = identity("https://example.org/report.html", "sources/3333333333333333.bin"), copy = identity("mirror/example.org/report.html");
    for (const sources of [[url, copy], [copy, url]]) {
      const both = createScrubber({ sources, suffix: "", knownDigests: [HASH] });
      // Led from the start of its token, the shared form is a URL and takes its own path, query and fragment.
      for (const value of ["alice:hunter2@example.org/report.html", "https://alice:hunter2@example.org/report.html?token=sk_live_abcdef", "//alice:hunter2@example.org/report.html#Layoff-List-Q3",
        "https://alice:hunter2@example.org/report.html/private/acme-merger", "https://alice:hunter2@example.org/report.html;jsessionid=abc123", "mailto:alice@example.org/report.html?subject=layoffs",
        "ftp://.example.org/report.html&k=v", "alice:hunter2@example.org/report.html?token=abc"]) {
        for (const scope of ["text", "model"] as const) {
          const once = both.scrub(`see ${value} now`, scope).text;
          expect(once, `${sources[0]!.id} ${scope} ${value}`).toBe("see [url] now");
          expect(both.scrub(once, scope).text).toBe(once);
          expect(both.finding(once, scope)).toBeUndefined();
        }
      }
      expect(both.scrub("(https://alice:hunter2@example.org/report.html?x=1)", "text").text).toBe("([url])");
      // Led from inside a token, the match stays as before: a relative path may take the whole token, or the rest goes out (L3).
      // Under policy 5 the lead goes back through the password once it has crossed the `@` (L3), so the userinfo is [url] too.
      expect(both.scrub("x alice:pa(ss)@example.org/report.html///acme.example report.html'bucket", "text").text).toBe("x [url] [source]'bucket");
      expect(both.scrub("see mailto:alice:pa(ss)@example.org/report.html now", "text").text).toBe("see [url] now");
    }
  });

  it("carries each provisional match through every pass, so a rule in a later pass still takes its token whole", () => {
    // The first pass takes the host and port, and that lets the second take the scheme's URL whole, in either source order. Where no
    // pass takes it, the match takes its URL's rest after the last pass.
    const url = identity("https://example.org/report.html", "sources/3333333333333333.bin"), copy = identity("mirror/example.org/report.html");
    for (const sources of [[url, copy], [copy, url]]) {
      const both = createScrubber({ sources, suffix: "", knownDigests: [HASH] });
      for (const [value, sent] of [["localhost:8080s3://example.org/report.html", "[url][url]"], ["&localhost:8080http://example.org/report.html#Layoff-List-Q3", "&[url][url]"],
        ["localhost:8080report.htmlhttp://old-report.html", "[url][url]"], ["see 8080http://example.org/report.html#x now", "see 8080[url] now"]] as const) {
        for (const scope of ["text", "model"] as const) expect(both.scrub(value, scope).text, `${value} ${scope}`).toBe(sent);
      }
      // Counts are those of the sent text under policy 5.
      expect(both.scrub("localhost:8080s3://example.org/report.html", "text").counts).toMatchObject({ sources: 0, files: 0, urls: 2 });
    }
    // The host's appended file names too.
    for (const scope of ["text", "model"] as const) expect(scrubber.scrub("see localhost:8080ftp://claims.json now", scope).text).toBe("see [url][url] now");
    // A name that a later pass finds moves the provisional match after it. In the owner's text the first pass takes the host's
    // appended path, which ends the source's name glued before it, and the second pass takes that name.
    expect(text("see alpha-field-notes.mdoutput/report.md (//old-claims.json?token=abc) now")).toBe("see S1[file] ([url]) now");
    expect(model("see alpha-field-notes.mdoutput/report.md (//old-claims.json?token=abc) now")).toBe("see [file] ([url]) now");
  });

  it("closes each limit of 10.b's scrub gate under scrub policy 5, sends nothing policy 4 hid, and states what it leaves", () => {
    const none = createScrubber({ sources: [], suffix: "", knownDigests: [HASH] });
    const github = createScrubber({ sources: [...SOURCES.slice(0, 3), identity("https://github.com/acme/public-repo", "sources/4444444444444444.bin")], suffix: "", knownDigests: [HASH] });
    const intranet = createScrubber({ sources: [identity("https://intranet.acme.example/doc", "sources/5555555555555555.bin")], suffix: "", knownDigests: [HASH] });
    const url = identity("https://example.org/report.html", "sources/3333333333333333.bin"), copy = identity("mirror/example.org/report.html");
    const pair = createScrubber({ sources: [url, copy], suffix: "", knownDigests: [HASH] }), local = createScrubber({ sources: [copy], suffix: "", knownDigests: [HASH] });
    const rows: [ReturnType<typeof createScrubber>, string, string][] = [
      // L1 and C5: a whole path or URL form with more of its segment glued after it, the token's rest and all.
      [scrubber, "see input/corpus/alpha-field-notes.md-secret now", "see [file] now"], [github, "see github.com/acme/public-repository now", "see [url] now"],
      [intranet, "see https://intranet.acme.example/docs/hr/layoff-plan-2025?employee=alice now", "see [url] now"],
      [scrubber, "see sub.example.org/reports/annual-2025.html-secret now", "see [url] now"], [scrubber, "see //sub.example.org/reports/annual-2025.html-secret now", "see [url] now"],
      // The alias stays for the form itself at a boundary.
      [scrubber, "see alpha-field-notes.md. Then", "see S1. Then"], [scrubber, "(see alpha-field-notes.md)", "(see S1)"], [scrubber, "**alpha-field-notes.md**", "**S1**"],
      // C6 and L2: a schemed URL's userinfo through a quote or spaceless letters; the credential rule's wider bounds.
      [none, "see https://alice:p\"ss@acme.example/hr/layoffs now", "see [url] now"], [none, "see https://alice:p秘密ss@acme.example/hr/layoffs now", "see [url] now"],
      [none, "see alice:p@ss@acme.example now", "see [url] now"], [none, "see :pw@acme.example now", "see [url] now"], [none, "see alice:hunter2@my_host.acme.example/x now", "see [url] now"],
      [none, "see alice:hunter2@localhost:8080/x now", "see [url] now"], [none, "see alice:hunter2@[::1]:8080/x now", "see [url] now"], [none, "see alice:hunter2@intranet:8443/x now", "see [url] now"],
      [none, "see user:pw@tcp(db.internal:3306)/app now", "see [url] now"], [none, "账号：alice:hunter2@acme.example", "账号[url]"], [none, "a@b:alice:hunter2@acme.example", "a@[url]"],
      [none, "alice:hunter2@acme.example?x=1#frag", "[url]"],
      // L6: `localhost` and a bracketed IPv6 address after `@`, and a run led by three slashes.
      [none, "see alice@localhost:8080/x now", "see alice@[url] now"], [none, "see git@[fd00::1]:8080/repo now", "see git@[url] now"], [none, "see ///etc/acme/merger-plan.docx now", "see [file] now"],
      // L7: the protocol-relative rule's left bound, and a relative path's query.
      [none, "see `//cdn.other.test/x/q3.html?token=abc` now", "see [url] now"], [none, "see >//cdn.other.test/x/q3.html?token=abc now", "see >[url] now"],
      [none, "see x//cdn.other.test/x/q3.html?token=abc now", "see [file] now"],
      // L3 and G6: a password's other characters once the lead has crossed an `@`; a credential before a local copy's form.
      [scrubber, "alice:pa(ss)@example.org/reports/annual-2025.html", "[url]"], [scrubber, "alice:p#ss@example.org/reports/annual-2025.html", "[url]"],
      [pair, "see alice:pa(ss)@example.org/report.html now", "see [url] now"], [local, "alice:hunter2@example.org/report.html?token=abc", "[url]"],
      // L4: the source's host and a hyphenated word; a bare hyphen keeps the alias.
      [scrubber, "the example.org-hosted report", "the [url] report"], [scrubber, "example.org-2025", "[url]"], [scrubber, "see example.org- now", "see S2- now"],
      // G2 to G5, G7's query and G9.
      [scrubber, "see other.test/x/old-alpha-field-notes.md?token=sk_live_abcdef now", "see [url] now"], [scrubber, "see /srv/x/old-alpha-field-notes.md?token=abc now", "see [file] now"],
      [scrubber, "see a//cdn.other.test/x/old-alpha-field-notes.md?token=abc now", "see [file] now"], [scrubber, "see docs/x/alpha-field-notes.md?token=abc now", "see [url] now"],
      [scrubber, "see x/alpha-field-notes.md/private/acme-merger now", "see [file] now"], [scrubber, "see \\\\reports/annual-2025.htmlhr.acme-merger.test now", "see [file] now"],
      [scrubber, "\\\\fileserver\\share\\alpha-field-notes.md?token=abc", "\\[url]"], [scrubber, "/\\cdn.other.test/x/old-alpha-field-notes.md?token=abc", "/\\[url]"],
      // D2 and D3, and the full-width `／／`.
      [scrubber, "`//hr.acme-merger.test/evil-www.q3_xx.yy-s/hr/x?employee=alice", "`[url]"], [pair, "x//other.test/alice:hunter2@old-example.org/report.html 文件", "[url] 文件"],
      [scrubber, ":///alice:hunter2@reports/annual-2025.html-secret/plan.md”", "[file]"], [scrubber, "see ／／cdn.other.test/x/old-claims.json?token=abc now", "see [url] now"],
      // The union: policy 4's relative path took the word before the `//`, the provisional path's URL rule only the `//…`.
      [scrubber, "src=//mirror/output/report.md.bak-secret/plan.md)", "[url])"], [scrubber, "token=abc,//x/y.md/output/report.md-secret/private/acme-merger.txt 文件", "[url] 文件"],
      // Where the paths differ, the widest placeholder wins over an alias (another host's copy is no source), and two marks
      // that one placeholder took keep both their spans (the password after the second goes too).
      [scrubber, "see www.example.org-v2/input/corpus/alpha-field-notes.md now", "see [url] now"], [scrubber, "www.example.orgawww.example.org-output/report.mdalice:pw@", "[url]"],
      // L5's over-matching is policy 4's, kept by the union.
      [scrubber, "Set host=example.org and retry.", "Set [url] and retry."],
      // After #105's review: a whole URL or path form's run is read from before the digits glued after it (L1); a credential
      // directly before a URL or path a rule replaced goes too, as `[url]` (it runs after the other URL rules); user names of
      // any spaced script (L2); a name's `&` and `;` parameters (G4); and a rooted path's query.
      [scrubber, "see example.org/reports/annual-2025.html1?token=sk_live_abcdef now", "see [url] now"], [scrubber, "see input/corpus/alpha-field-notes.md1?token=abc now", "see [file] now"],
      [intranet, "see https://intranet.acme.example/doc2?employee=alice now", "see [url] now"], [github, "see github.com/acme/public-repo1?token=sk_live_abcdef now", "see [url] now"],
      [none, "see alice:hunter2@https://acme.example/hr/x now", "see [url][url] now"], [none, "see alice:hunter2@//acme.example/hr/x now", "see [url] now"],
      [none, "see alice:hunter2@/srv/hr/x now", "see [url][file] now"], [scrubber, "alice:hunter2@s3://cdn.other.test/x/annual-2025.html/x.bak.", "[url][url]."],
      [none, "see josé:hunter2@acme.example/x now", "see [url] now"], [none, "see Алиса:hunter2@acme.example/x now", "see [url] now"], [none, "see alice(admin):hunter2@acme.example/x now", "see [url] now"],
      [none, "see (alice:pw@acme.example) now", "see ([url]) now"], [none, "Meeting 10:30@room now", "Meeting 10:30@room now"],
      [scrubber, "see viewer?file=alpha-field-notes.md&token=sk_live_abcdef now", "see viewer?file=[url] now"], [scrubber, "see alpha-field-notes.md;jsessionid=abc123 now", "see [url] now"],
      [scrubber, "see report.md&token=sk_live_abcdef now", "see [url] now"],
      [none, "see /x/q3.html?token=sk_live_abcdef now", "see [file] now"], [none, "see \\x\\q3.html#Layoff-List now", "see [file] now"], [none, "see \"/x/q3.html?token=abc\" now", "see \"[file]\" now"],
      // Stated residues: userinfo in a spaceless script or with white space; a credential before a bare single-label host, or
      // before `///` and a form two sources share; a source's host glued to digits; a dotted host after a `.` that no label
      // character precedes (L6); a backslash-written URL's scheme; division slashes.
      [scrubber, "alice:秘密@example.org/reports/annual-2025.html", "alice:秘密[url]"], [scrubber, "张三:hunter2@example.org/reports/annual-2025.html", "张三[url]"],
      [scrubber, "see alice:pa ss@example.org/reports/annual-2025.html now", "see alice:pa [url] now"], [none, "ssh admin:Passw0rd@dbserver", "ssh admin:Passw0rd@dbserver"],
      [pair, "see alice:hunter2@///other.test/x/example.org/report.html now", "see alice:hunter2@///[source] now"],
      [scrubber, "see example.org1/hr/x?employee=alice now", "see example.org1/hr/x?employee=alice now"],
      [none, "see ...acme.example/hr/x?employee=alice now", "see ...acme.example/hr/x?employee=alice now"],
      [scrubber, "https:\\\\other.test\\reports\\annual-2025.html", "https:\\S2"], [scrubber, "https:∕∕other.test∕reports∕annual-2025.html", "https:∕∕other.test∕reports∕S2"],
    ];
    for (const [shared, value, sent] of rows) for (const scope of ["text", "model"] as const) {
      const once = shared.scrub(value, scope).text;
      expect(once, `${scope} ${value}`).toBe(sent);
      expect(shared.scrub(once, scope).text, `${scope} ${value}`).toBe(once);
      expect(shared.finding(once, scope), `${scope} ${value}`).toBeUndefined();
    }
    // A stated residue (G4's wider class): a query after a file name that names no source goes out, whole in sent text and after
    // its [file] in model text.
    expect(none.scrub("see notes.md?token=sk_live_abcdef now", "text").text).toBe("see notes.md?token=sk_live_abcdef now");
    expect(none.scrub("see notes.md?token=sk_live_abcdef now", "model").text).toBe("see [file]?token=sk_live_abcdef now");
    // The audit reads the provisional path's wider rules too, so it finds a text that only they replace.
    for (const value of ["see ///etc/passwd/x now", "see git@[fd00::1]:8080/repo now"]) for (const scope of ["text", "model"] as const) expect(none.finding(value, scope), value).toBe("url_or_path");
    // A model-scope name inside a run led by three slashes: its query goes; in sent text the path rule takes the run.
    const repo = createScrubber({ sources: [identity("input/notes/meeting-notes-2024"), identity("https://github.com/acme/public-repo", "sources/6666666666666666.bin")], suffix: "", knownDigests: [HASH] });
    expect(repo.scrub("///x/y/public-repo?token=secret", "model").text).toBe("///[url]");
    expect(repo.scrub("///x/y/public-repo?token=secret", "text").text).toBe("[file]");
    // Counts are those of the sent text.
    expect(scrubber.scrub("see https://other.test/reports/annual-2025.html now", "text").counts).toEqual({ sources: 0, files: 0, urls: 1, digests: 0 });
    expect(scrubber.scrub("see alpha-field-notes.md and example.org-hosted now", "text").counts).toEqual({ sources: 1, files: 0, urls: 1, digests: 0 });
  });

  it("names a form two sources share [source], and each whole path its own alias", () => {
    const shared = createScrubber({ sources: [identity("a/notes-2024.md"), identity("b/notes-2024.md")], suffix: "", knownDigests: [HASH] });
    expect(shared.scrub("see notes-2024.md, a/notes-2024.md and b/notes-2024.md", "text").text).toBe("see [source], S1 and S2");
  });

  it("finds a source named with a compatibility ligature only in the audit's NFKC view, whichever side holds the ligature", () => {
    // The ligature in the text: the scrub (NFC) keeps it, and the audit finds the source.
    expect(text("see alpha-\ufb01eld-notes.md")).toBe("see alpha-\ufb01eld-notes.md");
    for (const scope of ["text", "model"] as const) expect(scrubber.finding("see alpha-\ufb01eld-notes.md", scope)).toBe("source_identity");
    // The ligature in the source's own name, the text plain: only the audit's forms, read in NFKC, find it.
    const ligature = createScrubber({ sources: [identity("input/corpus/alpha-\ufb01eld-notes.md")], suffix: "", knownDigests: [HASH] });
    expect(ligature.scrub("see alpha-field-notes.md", "text").text).toBe("see alpha-field-notes.md");
    for (const scope of ["text", "model"] as const) expect(ligature.finding("see alpha-field-notes.md", scope)).toBe("source_identity");
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
      "\"“/\"".repeat(16_000), `/${"汉/a汉".repeat(16_000)}`, `${"资料".repeat(32_000)}/`, `${"aa ".repeat(21_000)}q`, `a${"\u0301".repeat(32_000)}${"\u0316".repeat(32_000)}`,
      "文件在这里，".repeat(10_000), "文件在这里,".repeat(10_000), "文件在这里：".repeat(10_000), "文件在这里;".repeat(10_000)];
    // The walk resumes at a match's end: an advance by one would give "[file][file]" here, before any astral case below could hang.
    for (const scope of ["text", "model"] as const) expect(scrubber.scrub("see a/'b/c.md now", scope).text).toBe("see [file] now");
    // A run start at an astral character, alone, before a slash or before an escape: the walk steps over the whole code point and
    // returns. A walk that broke this would hang the run rather than fail it, since the scan is synchronous.
    for (const value of ["\u{20BB7}", "\u{20000}\\n", "see \u{1F600}/b now", "\u{1F600}/\u{1F600}", "see \u{20000} now", "see \u{20000}/b now"]) {
      for (const scope of ["text", "model"] as const) expect(scrubber.scrub(value, scope).text, `${value} ${scope}`).toBe(value);
      expect(scrubber.finding(value, "model"), value).toBeUndefined();
    }
    const started = performance.now();
    // Building a scrubber reads the host's appended text raw with the same walk. The separator is ASCII: read raw, a full-width
    // one is CJK punctuation, which ends every run, so it would be linear whatever the scan.
    createScrubber({ sources: SOURCES, suffix: "文件在这里,".repeat(10_000), knownDigests: [HASH] });
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
    expect(SCRUB_POLICY).toMatchObject({ version: 5, placeholders: { url: "[url]", file: "[file]", digest: "[digest]", source: "[source]" } });
    expect(SCRUB_POLICY.patterns.url.length).toBe(9);
    expect(SCRUB_POLICY.patterns.provisional.url.length).toBe(10);
    expect(SCRUB_POLICY.patterns.provisional.path.length).toBe(7);
    expect(SCRUB_POLICY.patterns.relative.run).toContain("\\1");
  });
});
