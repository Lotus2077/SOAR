import { execFileSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LIST_FILES, PRIVATE_SANDBOX_LIMITS, SandboxError, WORKSPACE_LISTING_MAX_ENTRIES, WORKSPACE_LISTING_MAX_OMITTED_PATHS,
  boundedOutputCollector, parseWorkspaceListing, pinnedListingHeader } from "../../src/main/private-agent/sandbox";

/**
 * Backlog item 3 (BL-20261107-0924, B and C), without Docker: the container's lister script runs under the machine's python3 with a
 * temporary directory in place of /workspace, and the host-side parser and output collector are exercised directly. The Docker-gated
 * suite (tests/integration/private-agent-sandbox.test.ts) is the live proof of the same contract inside the container.
 */
const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0).reverse()) done(); });
function workspace(): string { const root = mkdtempSync(join(tmpdir(), "soar-lister-")); cleanup.push(() => rmSync(root, { recursive: true, force: true })); return root; }
/** The lister's first stdin line is the host's pinned paths (E1-L); `list` always sends one, as `DockerSandbox.listFiles` does. */
function listRaw(root: string, header: string | Buffer): { status: number; stdout: string } {
  const script = LIST_FILES.replace("os.open('/workspace',", `os.open(${JSON.stringify(root)},`);
  expect(script).not.toBe(LIST_FILES);
  try { return { status: 0, stdout: execFileSync("python3", ["-I", "-c", script], { encoding: "utf8", stdio: "pipe", input: header }) }; }
  catch (error) { const failed = error as { status: number; stdout: string }; return { status: failed.status, stdout: failed.stdout }; }
}
function list(root: string, pinned: readonly string[] = []): { status: number; stdout: string } { return listRaw(root, pinnedListingHeader(pinned)); }
/** APFS refuses a name that is not valid UTF-8; Linux, where CI runs this suite, admits one. The case runs only where it can be created. */
const admitsNonUtf8Names = (() => {
  const root = mkdtempSync(join(tmpdir(), "soar-lister-probe-"));
  try { writeFileSync(Buffer.concat([Buffer.from(join(root, "f")), Buffer.from([0xff])]), "x"); return true; } catch { return false; } finally { rmSync(root, { recursive: true, force: true }); }
})();

describe("the workspace lister reports instead of dying (backlog item 3, finding A3)", () => {
  it("keeps regular files with their sizes and omits links, special files, oversize files and refused names with fixed reasons, never following a link", () => {
    const root = workspace();
    mkdirSync(join(root, "src", "pkg"), { recursive: true }); mkdirSync(join(root, "venv", "bin"), { recursive: true });
    writeFileSync(join(root, "src", "pkg", "main.py"), "print(1)\n"); writeFileSync(join(root, "README.md"), "# notes");
    writeFileSync(join(root, "source.txt"), "synthetic"); linkSync(join(root, "source.txt"), join(root, "copy.txt"));
    symlinkSync("/usr/bin/python3", join(root, "venv", "bin", "python")); symlinkSync(tmpdir(), join(root, "escape"));
    execFileSync("mkfifo", [join(root, "pipe")]);
    writeFileSync(join(root, "big.bin"), ""); truncateSync(join(root, "big.bin"), PRIVATE_SANDBOX_LIMITS.fileBytes + 1);
    writeFileSync(join(root, "bad\nname.txt"), "x");
    const deep = join(root, ...Array.from({ length: 33 }, (_, i) => `d${i}`)); mkdirSync(deep, { recursive: true }); writeFileSync(join(deep, "leaf.txt"), "x");
    const result = list(root);
    expect(result.status).toBe(0);
    const listing = parseWorkspaceListing(result.stdout);
    expect(listing.files).toEqual([{ path: "README.md", size: 7 }, { path: "src/pkg/main.py", size: 9 }]);
    // Named in sorted traversal order; the two refused names (a control character, a 33rd path part) are counted, never named.
    expect(listing.omitted).toEqual([{ path: "big.bin", reason: "oversize" }, { path: "copy.txt", reason: "hard_link" }, { path: "escape", reason: "symlink" },
      { path: "pipe", reason: "special" }, { path: "source.txt", reason: "hard_link" }, { path: "venv/bin/python", reason: "symlink" }]);
    expect(listing.counts).toEqual({ symlink: 2, hard_link: 2, special: 1, oversize: 1, name_invalid: 2, cap: 0 });
    expect(listing.complete).toBe(true);
    expect(result.stdout).not.toContain(tmpdir());
  });

  it("keeps the first 1,024 regular files in sorted order, counts the rest as cap, and stops at the entry cap with an incomplete report", () => {
    const root = workspace();
    for (let i = 0; i < 1030; i++) writeFileSync(join(root, `f${String(i).padStart(4, "0")}.txt`), "x");
    const capped = parseWorkspaceListing(list(root).stdout);
    expect(capped.files).toHaveLength(PRIVATE_SANDBOX_LIMITS.files); expect(capped.files.at(-1)!.path).toBe("f1023.txt");
    expect(capped.counts.cap).toBe(6); expect(capped.complete).toBe(true);
    expect(capped.omitted.map(item => item.path)).toEqual(["f1024.txt", "f1025.txt", "f1026.txt", "f1027.txt", "f1028.txt", "f1029.txt"]);
    for (let i = 1030; i < WORKSPACE_LISTING_MAX_ENTRIES + 10; i++) writeFileSync(join(root, `f${String(i).padStart(4, "0")}.txt`), "x");
    const stopped = parseWorkspaceListing(list(root).stdout);
    expect(stopped.files).toHaveLength(PRIVATE_SANDBOX_LIMITS.files); expect(stopped.complete).toBe(false);
    expect(stopped.counts.cap).toBe(WORKSPACE_LISTING_MAX_ENTRIES - PRIVATE_SANDBOX_LIMITS.files);
    expect(stopped.omitted).toHaveLength(WORKSPACE_LISTING_MAX_OMITTED_PATHS);
  });

  it.skipIf(!admitsNonUtf8Names)("counts a name that is not valid UTF-8 as name_invalid instead of dying, never naming it (BL-20261107-1006, 2)", () => {
    const root = workspace();
    writeFileSync(join(root, "kept.txt"), "x");
    writeFileSync(Buffer.concat([Buffer.from(join(root, "latin1-")), Buffer.from([0xe9]), Buffer.from(".txt")]), "x");
    // A directory with such a name is skipped whole: its contents are neither listed nor counted.
    mkdirSync(Buffer.concat([Buffer.from(join(root, "dir-")), Buffer.from([0xff])]));
    writeFileSync(Buffer.concat([Buffer.from(join(root, "dir-")), Buffer.from([0xff]), Buffer.from("/inner.txt")]), "y");
    const result = list(root);
    expect(result.status).toBe(0);
    const listing = parseWorkspaceListing(result.stdout);
    expect(listing.files).toEqual([{ path: "kept.txt", size: 1 }]);
    expect(listing.omitted).toEqual([]); expect(listing.counts).toEqual({ symlink: 0, hard_link: 0, special: 0, oversize: 0, name_invalid: 2, cap: 0 }); expect(listing.complete).toBe(true);
    expect(result.stdout).not.toContain("latin1"); expect(result.stdout).not.toContain("inner");
  });

  it("still dies (exit 53) when the walk itself fails, which the host maps to unsafe_file", () => {
    const result = list(join(workspace(), "missing"));
    expect(result.status).toBe(53); expect(result.stdout).toBe("");
  });
});

describe("the host-side listing parser", () => {
  const valid = { files: [["a.txt", 1], ["dir/b.txt", 0]], omitted: [["link", "symlink"]], counts: { symlink: 1, hard_link: 0, special: 0, oversize: 0, name_invalid: 0, cap: 0 }, complete: true };
  it("accepts the lister's shape and refuses every other as unsafe_file", () => {
    expect(parseWorkspaceListing(JSON.stringify(valid))).toEqual({ files: [{ path: "a.txt", size: 1 }, { path: "dir/b.txt", size: 0 }], omitted: [{ path: "link", reason: "symlink" }], counts: valid.counts, complete: true });
    for (const bad of ["not json", JSON.stringify([]), JSON.stringify({ ...valid, extra: 1 }), JSON.stringify({ files: valid.files, omitted: [], complete: true }),
      JSON.stringify({ ...valid, files: [["../escape", 1]] }), JSON.stringify({ ...valid, files: [["a.txt", 1], ["a.txt", 2]] }), JSON.stringify({ ...valid, files: [["a.txt", PRIVATE_SANDBOX_LIMITS.fileBytes + 1]] }),
      JSON.stringify({ ...valid, files: [["a.txt", -1]] }), JSON.stringify({ ...valid, files: [["a.txt", "1"]] }), JSON.stringify({ ...valid, files: Array.from({ length: 1025 }, (_, i) => [`f${i}`, 0]) }),
      JSON.stringify({ ...valid, omitted: [["a.txt", "symlink"]] }), JSON.stringify({ ...valid, omitted: [["link", "total_cap"]] }), JSON.stringify({ ...valid, omitted: [["link", "deleted"]] }),
      JSON.stringify({ ...valid, omitted: Array.from({ length: WORKSPACE_LISTING_MAX_OMITTED_PATHS + 1 }, (_, i) => [`l${i}`, "symlink"]) }),
      JSON.stringify({ ...valid, counts: { ...valid.counts, symlink: -1 } }), JSON.stringify({ ...valid, counts: { ...valid.counts, total_cap: 0 } }), JSON.stringify({ ...valid, complete: "yes" })]) {
      let thrown: unknown;
      try { parseWorkspaceListing(bad); } catch (error) { thrown = error; }
      expect(thrown, bad.slice(0, 80)).toBeInstanceOf(SandboxError); expect((thrown as SandboxError).code, bad.slice(0, 80)).toBe("unsafe_file");
    }
  });
});

describe("the bounded output collector (backlog item 3, finding A4)", () => {
  it("fails closed at the cap for protocol calls", () => {
    const bound = boundedOutputCollector(8, false), target: Buffer[] = [];
    expect(bound.push(target, Buffer.from("12345678"))).toBe(true); expect(bound.push(target, Buffer.from("9"))).toBe(false);
    expect(bound.truncated()).toBe(false); expect(Buffer.concat(target).toString()).toBe("12345678");
  });
  it("keeps the first bytes of both streams in arrival order, cuts the chunk that crosses the cap and discards the rest for execute", () => {
    const bound = boundedOutputCollector(10, true), stdout: Buffer[] = [], stderr: Buffer[] = [];
    expect(bound.push(stdout, Buffer.from("abcd"))).toBe(true); expect(bound.push(stderr, Buffer.from("EFGH"))).toBe(true); expect(bound.truncated()).toBe(false);
    expect(bound.push(stdout, Buffer.from("ijklmnop"))).toBe(true); expect(bound.truncated()).toBe(true);
    expect(bound.push(stderr, Buffer.from("QRST"))).toBe(true); expect(bound.push(stdout, Buffer.from("later"))).toBe(true);
    expect(Buffer.concat(stdout).toString()).toBe("abcdij"); expect(Buffer.concat(stderr).toString()).toBe("EFGH");
  });
});

describe("E1 recoverability: the lister keeps the host's pinned paths first (S6, E1-L)", () => {
  const bulk = (root: string, directory: string, count: number) => {
    mkdirSync(join(root, directory), { recursive: true });
    for (let i = 0; i < count; i++) writeFileSync(join(root, directory, `f${String(i).padStart(4, "0")}.py`), "x");
  };
  it("keeps pinned files that sort after a bulky directory, within the cap and never twice, and counts the rest of the directory as cap", () => {
    const root = workspace();
    bulk(root, ".venv", PRIVATE_SANDBOX_LIMITS.files + 76);
    mkdirSync(join(root, "input")); writeFileSync(join(root, "input", "a.md"), "source"); writeFileSync(join(root, "output.txt"), "report");
    const listing = parseWorkspaceListing(list(root, ["output.txt", "input/a.md"]).stdout);
    expect(listing.files.map(file => file.path)).toEqual([...Array.from({ length: PRIVATE_SANDBOX_LIMITS.files - 2 }, (_, i) => `.venv/f${String(i).padStart(4, "0")}.py`), "input/a.md", "output.txt"]);
    expect(listing.counts.cap).toBe(78); expect(listing.complete).toBe(true);
    // Without the pins the same tree drops both files, as before.
    expect(parseWorkspaceListing(list(root).stdout).files.map(file => file.path)).not.toContain("output.txt");
  });
  it("keeps pinned files even when a bulky directory stops the walk at its entry limit", () => {
    const root = workspace();
    bulk(root, ".cache", WORKSPACE_LISTING_MAX_ENTRIES + 10);
    writeFileSync(join(root, "output.txt"), "report");
    const listing = parseWorkspaceListing(list(root, ["output.txt"]).stdout);
    expect(listing.complete).toBe(false); expect(listing.files.map(file => file.path)).toContain("output.txt");
    expect(listing.files).toHaveLength(PRIVATE_SANDBOX_LIMITS.files);
  });
  it("skips a pinned path that is missing, a link, inside a linked directory, special, oversize or refused, never follows a link, and lets the walk report each", () => {
    const root = workspace(), outside = workspace();
    // The linked directory really holds the pinned leaf, so only the no-follow open of `linked` keeps it out.
    writeFileSync(join(outside, "hosts"), "outside the workspace");
    writeFileSync(join(root, "kept.txt"), "x"); symlinkSync("/etc/hosts", join(root, "link.txt")); symlinkSync(outside, join(root, "linked"));
    execFileSync("mkfifo", [join(root, "pipe")]); writeFileSync(join(root, "big.bin"), ""); truncateSync(join(root, "big.bin"), PRIVATE_SANDBOX_LIMITS.fileBytes + 1);
    // Sent raw, so the script's own rule meets the refused name the host would have filtered.
    const result = listRaw(root, `${JSON.stringify(["missing.txt", "link.txt", "linked/hosts", "pipe", "big.bin", "../escape", "kept.txt", "kept.txt"])}\n`);
    expect(result.status).toBe(0);
    const listing = parseWorkspaceListing(result.stdout);
    expect(listing.files).toEqual([{ path: "kept.txt", size: 1 }]);
    expect(listing.counts).toEqual({ symlink: 2, hard_link: 0, special: 1, oversize: 1, name_invalid: 0, cap: 0 });
    expect(result.stdout).not.toContain(tmpdir()); expect(result.stdout).not.toContain("outside the workspace");
  });
  it("lists exactly as before for a workspace under the cap, pinned or not", () => {
    const root = workspace();
    mkdirSync(join(root, "src")); writeFileSync(join(root, "src", "main.py"), "print(1)\n"); writeFileSync(join(root, "README.md"), "# notes"); writeFileSync(join(root, "zz.txt"), "last");
    expect(list(root, ["zz.txt", "README.md", "src/main.py"]).stdout).toBe(list(root).stdout);
  });
  it("dies (exit 53) without the pinned header or with a malformed one, which the host never sends", () => {
    const root = workspace(); writeFileSync(join(root, "a.txt"), "x");
    for (const header of ["", "[]", "not json\n", "{}\n", "[1]\n", `${JSON.stringify(Array.from({ length: PRIVATE_SANDBOX_LIMITS.files + 1 }, (_, i) => `f${i}`))}\n`]) {
      expect(listRaw(root, header).status, JSON.stringify(header.slice(0, 20))).toBe(53);
    }
  });
  it("builds the header the host sends: each admitted path once, in order, at most 1,024", () => {
    const parse = (pinned: readonly string[]) => JSON.parse(pinnedListingHeader(pinned).toString("utf8")) as string[];
    expect(pinnedListingHeader([]).toString("utf8")).toBe("[]\n");
    expect(parse(["output.txt", "input/a.md", "output.txt", "../escape", "/abs", "a//b", "bad\nname", "input/a.md"])).toEqual(["output.txt", "input/a.md"]);
    const many = Array.from({ length: PRIVATE_SANDBOX_LIMITS.files + 40 }, (_, i) => `f${i}`);
    expect(parse(many)).toEqual(many.slice(0, PRIVATE_SANDBOX_LIMITS.files));
  });
  it("refuses a listing that names a file beside a file under it, which only a path changing kind between the two passes could produce", () => {
    const counts = { symlink: 0, hard_link: 0, special: 0, oversize: 0, name_invalid: 0, cap: 0 };
    for (const files of [[["input", 1], ["input/x", 1]], [["output.txt/notes", 1], ["output.txt", 1]]]) {
      let thrown: unknown;
      try { parseWorkspaceListing(JSON.stringify({ files, omitted: [], counts, complete: true })); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(SandboxError); expect((thrown as SandboxError).code).toBe("unsafe_file");
    }
    expect(parseWorkspaceListing(JSON.stringify({ files: [["input.txt", 1], ["input/x", 1]], omitted: [], counts, complete: true })).files).toHaveLength(2);
  });
});
