import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appendedEntries, moveAppendedEntries } from "../../scripts/build-log-to-files";
import {
  BUILD_LOG_ENTRY_DIRECTORY,
  ENTRY_FILE_SOFT_LINE_LIMIT,
  REQUIRED_BUILD_LOG_FIELDS,
  runBuildLogValidationCli,
  validateEntryCitations,
  validateEntryFile,
  validateImmutableEntryFiles,
  validateMaterialChangeEntryFiles,
  validateNoAddedCodeCitations,
} from "../../scripts/validate-build-log";

/**
 * The build log's one-file-per-entry layout: entry files under docs/build-log/, the frozen archive, immutable files on the base,
 * citations in either order, no new log IDs under src/ or scripts/, and the conversion for branches opened before the switch.
 */
const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const step of cleanups.splice(0).reverse()) step(); });
function scratch(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "soar-entry-files-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const ID = "BL-20261118-0430-example";
/** An entry file's text: the archive's heading form, then the ten fields in order. */
function entryText(input: { id?: string; date?: string; title?: string; status?: string; references?: string; decisions?: string; lines?: number } = {}): string {
  const values: Record<string, string> = {
    Status: `\`${input.status ?? "Implemented"}\``, "Scope or hypothesis": "Test the entry files.", Decisions: input.decisions ?? "Keep it short.",
    Changes: "Fixture only.", Evidence: "A unit test.", "Failures or blockers": "None.", "Limitations and non-claims": "A fixture.",
    "Paid exposure": "None.", "Next gate": "None.", References: input.references ?? "None.",
  };
  const body = REQUIRED_BUILD_LOG_FIELDS.flatMap((field) => [`${field}: ${values[field]}`, ""]);
  const padding = Array.from({ length: Math.max(0, (input.lines ?? 0) - body.length - 1) }, (_, index) => `- detail ${index}`);
  if (padding.length) body.splice(body.indexOf(`Decisions: ${values.Decisions}`) + 1, 0, ...padding);
  return [`### ${input.id ?? ID} -- ${input.date ?? "2026-11-18"} -- ${input.title ?? "Fixture"}`, "", ...body].join("\n").replace(/\n+$/u, "\n");
}
/** A fixture archive the archive parser accepts: its history marker and one timestamped entry. */
const ARCHIVE_ID = "BL-20261117-1049-archived";
const archive = () => `# Fixture build log\n\n## Backfilled project history\n\n${entryText({ id: ARCHIVE_ID, date: "2026-11-17" })}`;

function git(cwd: string, args: string[]): string {
  return execFileSync("/usr/bin/git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", HOME: cwd, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
}
function write(root: string, relative: string, text: string) { mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); writeFileSync(path.join(root, relative), text); }
/** A repository whose base commit holds the archive, one entry file and a source file citing an archive ID. */
function repository(): string {
  const root = scratch();
  git(root, ["init", "-q", "-b", "main"]);
  write(root, "docs/BUILD_LOG.md", archive());
  write(root, `${BUILD_LOG_ENTRY_DIRECTORY}/BL-20261118-0400-base.md`, entryText({ id: "BL-20261118-0400-base" }));
  write(root, "src/main/old.ts", `// cites ${ARCHIVE_ID}\nexport const old = 1;\n`);
  git(root, ["add", "-A"]); git(root, ["commit", "-q", "-m", "base"]);
  return root;
}
/** The validator's CLI against HEAD after staging the work tree: its exit code and what it printed. */
function validate(root: string, base = "HEAD"): { code: number; out: string; err: string } {
  git(root, ["add", "-A"]);
  let out = "", err = "";
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => { out += String(chunk); return true; }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => { err += String(chunk); return true; }) as typeof process.stderr.write);
  try { return { code: runBuildLogValidationCli(["--base-ref", base], root), out, err }; } finally { vi.restoreAllMocks(); }
}

describe("entry files (one file per entry)", () => {
  it("accepts a well-formed entry file and parses it", () => {
    const result = validateEntryFile(`${ID}.md`, entryText());
    expect(result.errors).toEqual([]); expect(result.warnings).toEqual([]);
    expect(result.entry).toMatchObject({ id: ID, date: "2026-11-18", title: "Fixture", fields: { Status: "`Implemented`", References: "None." } });
  });

  it("refuses a bad name, a heading that is not the first line or names another ID, a non-UTC date, and a second entry", () => {
    for (const name of ["notes.md", "BL-20261118-0430-Upper.md", "BL-2026111-0430-x.md", `${ID}.txt`, "BL-20261118-0430-a--b.md"]) {
      expect(validateEntryFile(name, entryText()).errors, name).toEqual([expect.stringContaining("named BL-YYYYMMDD-HHMM-short-slug.md")]);
    }
    expect(validateEntryFile(`${ID}.md`, `\n${entryText()}`).errors).toEqual([expect.stringContaining("starts with its heading line")]);
    expect(validateEntryFile(`${ID}.md`, `Preface.\n${entryText()}`).errors).toEqual([expect.stringContaining("starts with its heading line")]);
    expect(validateEntryFile(`${ID}.md`, entryText({ id: "BL-20261118-0431-example" })).errors).toEqual([expect.stringContaining("is not the file's name")]);
    expect(validateEntryFile(`${ID}.md`, entryText({ date: "2026-11-17" })).errors).toEqual([expect.stringContaining("is not the ID's UTC date 2026-11-18")]);
    expect(validateEntryFile("BL-20261318-0430-example.md", entryText({ id: "BL-20261318-0430-example", date: "2026-13-18" })).errors)
      .toEqual(expect.arrayContaining([expect.stringContaining("UTC timestamp is invalid"), expect.stringContaining("invalid entry date")]));
    expect(validateEntryFile("BL-20261118-2460-example.md", entryText({ id: "BL-20261118-2460-example" })).errors).toEqual([expect.stringContaining("UTC timestamp is invalid")]);
    expect(validateEntryFile(`${ID}.md`, `${entryText()}\n${entryText({ id: "BL-20261118-0431-second" })}`).errors).toEqual([expect.stringContaining("holds one entry")]);
    // A heading inside a fenced block is text, not a second entry.
    expect(validateEntryFile(`${ID}.md`, entryText({ decisions: "Keep it short.\n\n```text\n### BL-20261118-0431-quoted -- 2026-11-18 -- Quoted\n```" })).errors).toEqual([]);
  });

  it("requires the ten fields in order, none empty or repeated, and an allowed status", () => {
    const text = entryText();
    const without = (field: string) => text.split("\n").filter((line) => !line.startsWith(`${field}:`)).join("\n");
    expect(validateEntryFile(`${ID}.md`, without("Evidence")).errors).toEqual([expect.stringContaining("missing required field Evidence")]);
    expect(validateEntryFile(`${ID}.md`, text.replace("Changes: Fixture only.\n\nEvidence: A unit test.", "Evidence: A unit test.\n\nChanges: Fixture only.")).errors)
      .toEqual([expect.stringContaining("out of order")]);
    expect(validateEntryFile(`${ID}.md`, text.replace("Changes: Fixture only.", "Changes:")).errors).toEqual([expect.stringContaining("field Changes is empty")]);
    expect(validateEntryFile(`${ID}.md`, text.replace("Evidence: A unit test.", "Evidence: A unit test.\nEvidence: Again.")).errors)
      .toEqual([expect.stringContaining("duplicate field Evidence"), expect.stringContaining("out of order")]);
    expect(validateEntryFile(`${ID}.md`, entryText({ status: "Done" })).errors).toEqual([expect.stringContaining('invalid Status "Done"')]);
    for (const status of ["Proposed", "Approved", "In progress", "Implemented", "Verified", "Released", "Blocked", "Failed", "Superseded", "Reverted"]) {
      expect(validateEntryFile(`${ID}.md`, entryText({ status })).errors, status).toEqual([]);
    }
  });

  it(`warns above ${ENTRY_FILE_SOFT_LINE_LIMIT} lines and never fails on length`, () => {
    const at = validateEntryFile(`${ID}.md`, entryText({ lines: ENTRY_FILE_SOFT_LINE_LIMIT }));
    expect(at.entry && at.errors).toEqual([]); expect(at.warnings).toEqual([]);
    const over = validateEntryFile(`${ID}.md`, entryText({ lines: ENTRY_FILE_SOFT_LINE_LIMIT + 1 }));
    expect(over.errors).toEqual([]); expect(over.warnings).toEqual([expect.stringContaining(`${ENTRY_FILE_SOFT_LINE_LIMIT + 1} lines`)]);
  });

  it("lets a Correction cite any entry in the archive or the directory, in either order, and nothing else", () => {
    const parse = (text: string, id = ID) => validateEntryFile(`${id}.md`, text).entry!;
    const known = new Set([ARCHIVE_ID, ID, "BL-20261118-0500-later"]);
    expect(validateEntryCitations([parse(entryText({ title: "Correction to an archive entry", references: `${ARCHIVE_ID}.` }))], known)).toEqual([]);
    // A later file is fine: no check orders one entry after another.
    expect(validateEntryCitations([parse(entryText({ title: "Correction to a later file", references: "BL-20261118-0500-later." }))], known)).toEqual([]);
    expect(validateEntryCitations([parse(entryText({ title: "Correction to nothing", references: "BL-20261118-0459-absent." }))], known))
      .toEqual([expect.stringContaining("Correction reference BL-20261118-0459-absent is not an entry")]);
    expect(validateEntryCitations([parse(entryText({ title: "Correction with a short form only", references: "BL-20261117-1049." }))], known))
      .toEqual([expect.stringContaining("must cite the entry it corrects")]);
    expect(validateEntryCitations([parse(entryText({ title: "Correction citing only itself", references: `${ID}.` }))], known))
      .toEqual([expect.stringContaining("must cite the entry it corrects")]);
    // An entry that is not a Correction may name any ID.
    expect(validateEntryCitations([parse(entryText({ references: "BL-20261118-0459-absent." }))], known)).toEqual([]);
  });

  it("keeps files on the base immutable, and asks a material change for a new file", () => {
    const base = new Map([["a.md", "one\ntwo\n"]]);
    expect(validateImmutableEntryFiles(base, new Map([["a.md", "one\ntwo\n"], ["b.md", "new\n"]]))).toEqual([]);
    expect(validateImmutableEntryFiles(base, new Map([["a.md", "one\nthree\n"]]))).toEqual([expect.stringContaining("a.md is on the base and may not change (first changed line 2)")]);
    expect(validateImmutableEntryFiles(base, new Map())).toEqual([expect.stringContaining("a.md is on the base and may not be deleted")]);
    const names = new Set(["a.md"]);
    expect(validateMaterialChangeEntryFiles(["src/main/index.ts"], names, names)).toEqual([expect.stringContaining("require a new entry file")]);
    expect(validateMaterialChangeEntryFiles(["src/main/index.ts"], names, new Set(["a.md", "b.md"]))).toEqual([]);
    expect(validateMaterialChangeEntryFiles(["docs/typo.md", `${BUILD_LOG_ENTRY_DIRECTORY}/b.md`], names, names)).toEqual([]);
    expect(validateMaterialChangeEntryFiles(["docs/plans/x.md", "tests/unit/x.test.ts", "package.json"], names, names)).toEqual([expect.stringContaining("docs/plans/x.md, tests/unit/x.test.ts, package.json")]);
  });

  it("refuses a log ID a change adds under src/ or scripts/, and nothing else", () => {
    const old = `// ${ARCHIVE_ID}\nconst a = 1;\n`;
    const cases: [string, string | null, string | null, string[]][] = [
      ["src/a.ts", old, `const a = 1;\n// moved: ${ARCHIVE_ID}\n`, []],
      ["src/a.ts", old, "const a = 1;\n", []],
      ["src/a.ts", old, null, []],
      ["src/a.ts", old, `${old}// BL-20261118-0430-new\n`, ["BL-20261118-0430-new"]],
      ["scripts/b.py", null, "# BL-20261118-0430 and BL-0003\n", ["BL-20261118-0430", "BL-0003"]],
      ["src/a.ts", old, `${old}// ${ARCHIVE_ID.replace("-archived", "")}\n`, ["BL-20261117-1049"]],
      ["tests/unit/a.test.ts", null, "// BL-20261118-0430-new\n", []],
      ["docs/x.md", null, "BL-20261118-0430-new\n", []],
      ["scripts/c.ts", null, "const pattern = /BL-[0-9]{8}-[0-9]{4}/;\n", []],
    ];
    for (const [file, base, current, ids] of cases) {
      const errors = validateNoAddedCodeCitations([{ path: file, base, current }]);
      expect(errors, `${file} ${String(current)}`).toEqual(ids.length ? [expect.stringContaining(`${file} adds the build-log ID${ids.length > 1 ? "s" : ""} ${ids.join(", ")}`)] : []);
    }
  });
});

describe("the validator's command line on a repository", () => {
  it("passes a new entry file beside a material change, and reports the archive and the files", () => {
    const root = repository();
    write(root, "src/main/new.ts", "export const fresh = 1;\n");
    write(root, `${BUILD_LOG_ENTRY_DIRECTORY}/${ID}.md`, entryText({ title: "Correction to the archived entry", references: `${ARCHIVE_ID}.` }));
    const result = validate(root);
    expect(result).toMatchObject({ code: 0, err: "" });
    expect(result.out).toContain("1 archive entries and 2 entry files; the archive unchanged and 1 new entry file against HEAD");
  });

  it("fails each broken rule, naming it", () => {
    const cases: [string, (root: string) => void, string][] = [
      ["a material change without a new file", root => write(root, "src/main/new.ts", "export const fresh = 1;\n"), "material changes require a new entry file"],
      ["a changed base file", root => write(root, `${BUILD_LOG_ENTRY_DIRECTORY}/BL-20261118-0400-base.md`, entryText({ id: "BL-20261118-0400-base", status: "Verified" })), "is on the base and may not change"],
      ["a deleted base file", root => unlinkSync(path.join(root, BUILD_LOG_ENTRY_DIRECTORY, "BL-20261118-0400-base.md")), "is on the base and may not be deleted"],
      ["an appended archive entry", root => write(root, "docs/BUILD_LOG.md", `${archive()}\n${entryText({ id: "BL-20261118-0430-appended" })}`), "frozen archive and may not change"],
      ["a new ID in source", root => write(root, "src/main/old.ts", `// cites ${ARCHIVE_ID}\n// and ${ID}\nexport const old = 1;\n`), `src/main/old.ts adds the build-log ID ${ID}`],
      ["a stray file", root => write(root, `${BUILD_LOG_ENTRY_DIRECTORY}/README.md`, "notes\n"), "holds only entry files"],
      ["a file that repeats an archive ID", root => write(root, `${BUILD_LOG_ENTRY_DIRECTORY}/${ARCHIVE_ID}.md`, entryText({ id: ARCHIVE_ID, date: "2026-11-17" })), "already an archive entry's"],
      ["a Correction citing nothing that exists", root => write(root, `${BUILD_LOG_ENTRY_DIRECTORY}/${ID}.md`, entryText({ title: "Correction", references: "BL-20261118-0459-absent." })), "is not an entry"],
      ["a malformed new file", root => write(root, `${BUILD_LOG_ENTRY_DIRECTORY}/${ID}.md`, entryText({ date: "2026-11-17" })), "is not the ID's UTC date"],
    ];
    for (const [name, change, message] of cases) {
      const root = repository();
      change(root);
      const result = validate(root);
      expect(result.code, name).toBe(1);
      expect(result.err, name).toContain(message);
    }
    // A symbolic link is not an entry file, even when its name is.
    const root = repository();
    symlinkSync(path.join(root, BUILD_LOG_ENTRY_DIRECTORY, "BL-20261118-0400-base.md"), path.join(root, BUILD_LOG_ENTRY_DIRECTORY, `${ID}.md`));
    expect(validate(root).err).toContain("holds only entry files");
  });

  it("warns, without failing, on a new file over the soft limit, and only on new files", () => {
    const root = repository();
    write(root, `${BUILD_LOG_ENTRY_DIRECTORY}/${ID}.md`, entryText({ lines: ENTRY_FILE_SOFT_LINE_LIMIT + 5 }));
    const result = validate(root);
    expect(result.code).toBe(0);
    expect(result.err).toBe(`WARN ${BUILD_LOG_ENTRY_DIRECTORY}/${ID}.md: ${ENTRY_FILE_SOFT_LINE_LIMIT + 5} lines; an entry is about 25, with the detail in the pull request's description\n`);
    git(root, ["commit", "-q", "-m", "long entry"]);
    write(root, "docs/notes.md", "unrelated\n");
    expect(validate(root)).toMatchObject({ code: 0, err: "" });
  });
});

describe("the conversion for branches opened before the switch", () => {
  const base = archive();
  const one = entryText({ id: "BL-20261118-0430-one" }), two = entryText({ id: "BL-20261118-0431-two", title: "Correction to one", references: "BL-20261118-0430-one." });

  it("splits what a branch appended into whole entries, and refuses anything else", () => {
    expect(appendedEntries(base, base)).toEqual([]);
    expect(appendedEntries(base, `${base}\n${one}\n${two}`)).toEqual([{ id: "BL-20261118-0430-one", text: one }, { id: "BL-20261118-0431-two", text: two }]);
    expect(() => appendedEntries(base, `x${base}`)).toThrow("is not the base's archive plus appended entries");
    expect(() => appendedEntries(base, `${base}\nloose text\n${one}`)).toThrow("does not begin with an entry heading");
  });

  it("moves a branch's entries to files and restores the archive, mid-merge or after a clean one", () => {
    const root = repository();
    // Main gains an archive entry after the branch point; the branch appends two of its own.
    git(root, ["checkout", "-q", "-b", "lane"]);
    write(root, "docs/BUILD_LOG.md", `${base}\n${one}\n${two}`); git(root, ["commit", "-q", "-am", "lane entries"]);
    git(root, ["checkout", "-q", "main"]);
    const mainArchive = `${base}\n${entryText({ id: "BL-20261118-0420-main" })}`;
    write(root, "docs/BUILD_LOG.md", mainArchive); git(root, ["commit", "-q", "-am", "main entry"]);
    git(root, ["checkout", "-q", "lane"]);
    expect(() => git(root, ["merge", "-q", "main"])).toThrow();
    expect(git(root, ["ls-files", "-u", "--", "docs/BUILD_LOG.md"])).not.toBe("");
    expect(moveAppendedEntries(root).map((entry) => entry.id)).toEqual(["BL-20261118-0430-one", "BL-20261118-0431-two"]);
    expect(readFileSync(path.join(root, "docs/BUILD_LOG.md"), "utf8")).toBe(mainArchive);
    expect(readFileSync(path.join(root, BUILD_LOG_ENTRY_DIRECTORY, "BL-20261118-0431-two.md"), "utf8")).toBe(two);
    git(root, ["add", "-A", "docs"]); git(root, ["commit", "-q", "--no-edit"]);
    expect(validate(root, "main")).toMatchObject({ code: 0, err: "" });

    // A branch that merged cleanly: the work tree's archive is the base's plus its entries.
    const clean = repository();
    write(clean, "docs/BUILD_LOG.md", `${base}\n${one}`);
    expect(moveAppendedEntries(clean, "HEAD").map((entry) => entry.id)).toEqual(["BL-20261118-0430-one"]);
    expect(readFileSync(path.join(clean, "docs/BUILD_LOG.md"), "utf8")).toBe(base);
  });

  it("moves nothing when a file would be overwritten or an entry would fail the file checks", () => {
    const root = repository();
    write(root, "docs/BUILD_LOG.md", `${base}\n${entryText({ id: "BL-20261118-0400-base" })}`);
    expect(() => moveAppendedEntries(root, "HEAD")).toThrow("BL-20261118-0400-base.md already exists");
    const bad = repository();
    const appended = `${base}\n${entryText({ id: "BL-20261118-0430-one", date: "2026-11-17" })}`;
    write(bad, "docs/BUILD_LOG.md", appended);
    expect(() => moveAppendedEntries(bad, "HEAD")).toThrow("is not the ID's UTC date");
    expect(readFileSync(path.join(bad, "docs/BUILD_LOG.md"), "utf8")).toBe(appended);
    expect(existsSync(path.join(bad, BUILD_LOG_ENTRY_DIRECTORY, "BL-20261118-0430-one.md"))).toBe(false);
  });
});
