import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { localScreenGitRunner, localScreenGitState, localScreenSourceFreeze, type LocalScreenGit } from "../../scripts/private-agent-local-screen";

/**
 * Backlog item 11, part 2 (BL-20261109-0422-registry-run-commit-design): the driver's freeze records the run's commit and
 * whether a checkout of it reproduces the frozen sources, and registry rows take `git` from it with a labelled source.
 */
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "registry-row.py");
const h = (n: string) => n.repeat(64);
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
function scratch(prefix: string) { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }

/** A run directory as the driver leaves one, with `git` in its freeze when given (undefined leaves the key out). */
function runDirectory(root: string, name: string, git?: unknown) {
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  const jobId = `job-${name.replace(/[^A-Za-z0-9_-]/gu, "-")}`;
  writeFileSync(join(dir, "freeze.json"), `${canonical({ version: 1, jobId, startedAt: "2026-11-09T10:00:00.000Z", sourceFreezeSha256: h("4"), taskBinding: { jobSha256: h("1"), briefSha256: h("2") },
    profile: "heavy", modelConfig: { maxOutputTokens: 16384, thinking: "medium" }, ...(git === undefined ? {} : { git }) })}\n`);
  writeFileSync(join(dir, "result.json"), `${canonical({ status: "submitted", reason: "independent_acceptance_pending", finishedAt: "2026-11-09T10:05:00.000Z", snapshotSha256: h("7"), candidateFiles: [], dispatches: [] })}\n`);
  const db = new Database(join(dir, "state.sqlite")); const store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["m"], maxRequests: 10, maxFeeMicrousd: 0 });
  store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q" });
  db.close();
  return dir;
}
function loopDirectory(root: string, stages: Partial<Record<string, unknown>>, final: "a" | "b" | "repair", candidates: string[] = ["a", "b", "repair"]) {
  for (const [name, git] of Object.entries(stages)) runDirectory(root, name, git);
  const status = { status: "submitted", reason: "independent_acceptance_pending" };
  writeFileSync(join(root, "loop.json"), `${canonical({ version: 1, selectionRule: 2, arm: "local", startedAt: "2026-11-09T09:59:00.000Z", finishedAt: "2026-11-09T10:06:00.000Z",
    candidates: Object.fromEntries(["a", "b", "repair"].map(name => [name, candidates.includes(name) ? status : null])), seeded: { b: false, repair: false, snapshotSha256: null },
    writeIdentityEqual: null, critique: null, selected: { stage1: { candidate: "a", step: "tie" }, final: { candidate: final, step: "tie" } } })}\n`);
  return root;
}
function row(args: string[], script = SCRIPT, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return JSON.parse(execFileSync("python3", ["-I", script, ...args, "--id", "x", "--batch", "b", "--task", "t", "--family", "research", "--exposure", "fresh", "--arm", "local-heavy", "--outcome", "accepted", "--verdict-by", "none", "--lesson", "l"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env }));
}
const C = (n: string) => n.repeat(40);

describe("registry git provenance (backlog item 11, part 2)", () => {
  it("takes a run row's git from its freeze, not from the commit the row is written at", () => {
    const root = scratch("soar-git-row-");
    expect(row(["--run-dir", runDirectory(root, "clean", { commit: C("c"), dirty: false })])).toMatchObject({ git: "cccccccccccc", gitSource: "run", gitDirty: false });
    expect(row(["--run-dir", runDirectory(root, "dirty", { commit: C("d"), dirty: true })])).toMatchObject({ git: "dddddddddddd", gitSource: "run", gitDirty: true });
    expect(row(["--run-dir", runDirectory(root, "sha256", { commit: "e".repeat(64), dirty: false })])).toMatchObject({ git: "eeeeeeeeeeee", gitSource: "run" });
  });
  it("falls back to the writing commit, labelled, when the freeze records no valid git, and never guesses at a malformed one", () => {
    const root = scratch("soar-git-fallback-");
    const variants: unknown[] = [undefined, null, "c".repeat(40), { commit: "abc", dirty: false }, { commit: C("C"), dirty: false }, { commit: C("c") }, { commit: C("c"), dirty: "no" },
      { commit: C("c"), dirty: false, path: "/Users/someone" }, [C("c"), false]];
    variants.forEach((git, i) => expect(row(["--run-dir", runDirectory(root, `v${i}`, git)]), JSON.stringify(git)).toMatchObject({ git: HEAD.slice(0, 12), gitSource: "row_written", gitDirty: null }));
  });
  it("takes a loop row's git from the selected run, and says when its stages do not all record that commit", () => {
    const clean = { commit: C("a"), dirty: false };
    expect(row(["--loop-dir", loopDirectory(scratch("soar-git-loop-"), { a: clean, b: clean, repair: clean }, "b")])).toMatchObject({ git: "aaaaaaaaaaaa", gitSource: "run", gitDirty: false });
    // Another commit in one stage: the selected run's commit, flagged.
    expect(row(["--loop-dir", loopDirectory(scratch("soar-git-loop-"), { a: { commit: C("b"), dirty: false }, b: clean, repair: clean }, "repair")])).toMatchObject({ git: "aaaaaaaaaaaa", gitSource: "runs_differ", gitDirty: false });
    // A stage with no valid record counts as differing, and its unknown state makes the loop's state unknown; a dirty stage makes it dirty.
    expect(row(["--loop-dir", loopDirectory(scratch("soar-git-loop-"), { a: null, b: clean, repair: clean }, "b")])).toMatchObject({ git: "aaaaaaaaaaaa", gitSource: "runs_differ", gitDirty: null });
    expect(row(["--loop-dir", loopDirectory(scratch("soar-git-loop-"), { a: null, b: { commit: C("a"), dirty: true }, repair: clean }, "b")])).toMatchObject({ gitSource: "runs_differ", gitDirty: true });
    // Sample a without a summary (a cloud loop whose stage failed) is still compared: its freeze is on disk.
    expect(row(["--loop-dir", loopDirectory(scratch("soar-git-loop-"), { a: { commit: C("b"), dirty: false }, b: clean, repair: clean }, "b", ["b", "repair"])])).toMatchObject({ gitSource: "runs_differ" });
    // Without the selected run's record, the writing commit, labelled.
    expect(row(["--loop-dir", loopDirectory(scratch("soar-git-loop-"), { a: clean, b: undefined, repair: clean }, "b")])).toMatchObject({ git: HEAD.slice(0, 12), gitSource: "row_written", gitDirty: null });
    // A loop that ended before b or the repair ran compares only the run directories it has.
    expect(row(["--loop-dir", loopDirectory(scratch("soar-git-loop-"), { a: clean }, "a", ["a"])])).toMatchObject({ git: "aaaaaaaaaaaa", gitSource: "run", gitDirty: false });
    expect(row(["--loop-dir", loopDirectory(scratch("soar-git-loop-"), { a: clean, b: clean }, "a", ["a", "b"])])).toMatchObject({ git: "aaaaaaaaaaaa", gitSource: "run", gitDirty: false });
    // A run directory moved aside (part 3) is one of the loop's runs too.
    expect(row(["--loop-dir", loopDirectory(scratch("soar-git-loop-"), { a: clean, "a.infra-1": { commit: C("9"), dirty: true }, b: clean }, "b", ["a", "b"])])).toMatchObject({ gitSource: "runs_differ", gitDirty: true });
  });
  it("refuses to emit a row when the writing commit cannot be read, where it once wrote an empty string", () => {
    const outside = scratch("soar-git-outside-"); mkdirSync(join(outside, "scripts"));
    const copy = join(outside, "scripts", "registry-row.py"); copyFileSync(SCRIPT, copy);
    const run = runDirectory(scratch("soar-git-run-"), "old");
    expect(() => row(["--run-dir", run], copy)).toThrow(/cannot read the commit this row is written at/u);
    // A run that recorded its commit needs no writing commit.
    expect(row(["--run-dir", runDirectory(scratch("soar-git-run-"), "new", { commit: C("f"), dirty: false })], copy)).toMatchObject({ git: "ffffffffffff", gitSource: "run" });
    // The writing commit is read without the caller's git environment: an inherited GIT_DIR naming another repository is not used.
    const other = scratch("soar-git-other-");
    execFileSync("/usr/bin/git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: other, env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    expect(row(["--run-dir", run], SCRIPT, { ...process.env, GIT_DIR: join(other, ".git"), GIT_WORK_TREE: other })).toMatchObject({ git: HEAD.slice(0, 12), gitSource: "row_written" });
  });
});

/** A temporary repository set up without the user's configuration, signing or hooks. */
function repository() {
  const root = scratch("soar-git-repo-");
  const env = { PATH: "/usr/bin:/bin", HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CEILING_DIRECTORIES: resolve(root, "..") };
  const git = (...args: string[]) => execFileSync("/usr/bin/git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main", ...args],
    { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return { root, git };
}
/** The source freeze's entries for these paths, as the driver would read them now. */
const frozenOf = (root: string, paths: string[]) => paths.map(path => ({ path, sha256: digest(readFileSync(join(root, path))) }));

describe("the driver's git state (backlog item 11, part 2)", () => {
  it("asks git exactly these read-only questions, keeps only the commit and a boolean, and returns null on any doubt", () => {
    const root = scratch("soar-git-fake-");
    mkdirSync(join(root, "src")); writeFileSync(join(root, "src", "a.ts"), "export {};\n");
    const blob = execFileSync("/usr/bin/git", ["hash-object", "--stdin"], { input: "export {};\n", encoding: "utf8" }).trim();
    const frozen = frozenOf(root, ["src/a.ts"]);
    type Key = "toplevel" | "filters" | "head" | "status" | "flags" | "tree" | "end";
    const fake = (answers: Partial<Record<Key, string | Error>>, calls: string[][] = []): LocalScreenGit => args => {
      calls.push([...args]);
      const key: Key = args.includes("--show-toplevel") ? "toplevel" : args.includes("--get-regexp") ? "filters" : args.includes("--verify") ? (calls.filter(call => call.includes("--verify")).length > 1 ? "end" : "head")
        : args.includes("status") ? "status" : args.includes("ls-files") ? "flags" : "tree";
      const defaults: Record<Key, string | Error> = { toplevel: `${root}\n`, filters: Object.assign(new Error("no match"), { status: 1 }), head: `${C("a")}\n`, status: "", flags: "H src/a.ts\0H README.md\0",
        tree: `100644 blob ${blob}\tsrc/a.ts\0`, end: `${C("a")}\n` };
      const answer = answers[key] ?? defaults[key];
      if (answer instanceof Error) throw answer;
      return answer;
    };
    const calls: string[][] = [];
    expect(localScreenGitState(frozen, { root, cwd: root, git: fake({}, calls) })).toEqual({ commit: C("a"), dirty: false });
    expect(calls).toEqual([["rev-parse", "--show-toplevel"], ["config", "--name-only", "--get-regexp", "^filter\\."], ["rev-parse", "--verify", "HEAD^{commit}"],
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], ["ls-files", "-z", "-v"],
      ["--literal-pathspecs", "ls-tree", "-r", "-z", C("a"), "--", "src/a.ts"], ["rev-parse", "--verify", "HEAD^{commit}"]]);
    // Anything in the status, an index entry the status does not compare, a frozen file whose bytes are not its committed blob (or not
    // in the commit), or not the bytes the source freeze hashed: all dirty.
    const dirtyCases: [string, Partial<Record<Key, string | Error>>][] = [["status", { status: "?? notes.md\0" }], ["skip-worktree", { flags: "H src/a.ts\0S src/b.ts\0" }],
      ["assume-unchanged", { flags: "h src/b.ts\0H src/a.ts\0" }], ["another blob", { tree: `100644 blob ${C("9")}\tsrc/a.ts\0` }], ["not in the commit", { tree: "" }],
      ["a status too large for the buffer", { status: Object.assign(new Error("spawnSync /usr/bin/git ENOBUFS"), { code: "ENOBUFS" }) }]];
    for (const [label, answers] of dirtyCases) expect(localScreenGitState(frozen, { root, cwd: root, git: fake(answers) }), label).toEqual({ commit: C("a"), dirty: true });
    expect(localScreenGitState([{ path: "src/a.ts", sha256: h("0") }], { root, cwd: root, git: fake({}) })).toEqual({ commit: C("a"), dirty: true });
    // Every other failure, a configured filter, a HEAD that moved, and any doubt about the repository record null.
    const nullCases: [string, Partial<Record<Key, string | Error>>][] = [["a timed-out status", { status: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) }], ["not a commit", { head: "not a commit\n" }],
      ["upper case", { head: `${C("A")}\n` }], ["an unborn HEAD", { head: new Error("unborn") }], ["another top level", { toplevel: `${tmpdir()}\n` }], ["a missing top level", { toplevel: "/elsewhere\n" }],
      ["a configured filter", { filters: "filter.x.clean\n" }], ["a failing config read", { filters: Object.assign(new Error("bad config"), { status: 3 }) }], ["a failing tree", { tree: new Error("x") }],
      ["a moved HEAD", { end: `${C("b")}\n` }]];
    for (const [label, answers] of nullCases) expect(localScreenGitState(frozen, { root, cwd: root, git: fake(answers) }), label).toBeNull();
    // The working directory the source freeze reads must be the repository's root.
    mkdirSync(join(root, "sub"));
    expect(localScreenGitState(frozen, { root, cwd: join(root, "sub"), git: fake({}) })).toBeNull();
  });
  it("tells a clean checkout from every way it checked the tree can fail to reproduce the frozen sources, in a real repository", () => {
    const { root, git } = repository();
    git("init", "-q");
    // No commit yet: HEAD is unborn.
    expect(localScreenGitState([], { root, cwd: root })).toBeNull();
    mkdirSync(join(root, "src"));
    for (const name of ["a", "b", "c"]) writeFileSync(join(root, "src", `${name}.ts`), `export const ${name} = 1;\n`);
    writeFileSync(join(root, "README.md"), "r\n"); writeFileSync(join(root, ".gitignore"), "ignored/\n");
    git("add", "."); git("commit", "-q", "-m", "init");
    const commit = git("rev-parse", "HEAD").trim(), frozen = () => frozenOf(root, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(localScreenGitState(frozen(), { root, cwd: root })).toEqual({ commit, dirty: false });
    // An ignored file changes nothing; an untracked one, a staged or unstaged edit, all make the tree dirty.
    mkdirSync(join(root, "ignored")); writeFileSync(join(root, "ignored", "x"), "x");
    expect(localScreenGitState(frozen(), { root, cwd: root })).toEqual({ commit, dirty: false });
    writeFileSync(join(root, "notes.md"), "n");
    expect(localScreenGitState(frozen(), { root, cwd: root })).toEqual({ commit, dirty: true }); rmSync(join(root, "notes.md"));
    writeFileSync(join(root, "README.md"), "edited\n");
    expect(localScreenGitState(frozen(), { root, cwd: root })).toEqual({ commit, dirty: true });
    git("add", "README.md");
    expect(localScreenGitState(frozen(), { root, cwd: root })).toEqual({ commit, dirty: true });
    git("reset", "-q", "--hard");
    // A frozen file the commit does not hold: an untracked one the source freeze would still hash, hidden from the status by an ignore rule.
    writeFileSync(join(root, ".git", "info", "exclude"), "src/new.ts\n"); writeFileSync(join(root, "src", "new.ts"), "export {};\n");
    expect(localScreenGitState(frozenOf(root, ["src/a.ts", "src/b.ts", "src/c.ts", "src/new.ts"]), { root, cwd: root })).toEqual({ commit, dirty: true });
    expect(localScreenGitState(frozen(), { root, cwd: root })).toEqual({ commit, dirty: false });
    // A frozen file whose bytes changed after the source freeze read them.
    const stale = frozen(); writeFileSync(join(root, "src", "a.ts"), "export const a = 9;\n"); writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    expect(localScreenGitState([{ ...stale[0]!, sha256: h("0") }, ...stale.slice(1)], { root, cwd: root })).toEqual({ commit, dirty: true });
    // An edit the status cannot see (skip-worktree) still differs from the committed blob.
    git("update-index", "--skip-worktree", "src/a.ts"); writeFileSync(join(root, "src", "a.ts"), "export const a = 2;\n");
    expect(git("status", "--porcelain")).toBe("");
    expect(localScreenGitState(frozen(), { root, cwd: root })).toEqual({ commit, dirty: true });
    git("update-index", "--no-skip-worktree", "src/a.ts"); git("checkout", "-q", "--", "src/a.ts");
    expect(localScreenGitState(frozen(), { root, cwd: root })).toEqual({ commit, dirty: false });
    // A tracked frozen file deleted behind skip-worktree or assume-unchanged: neither the status nor the source freeze's listing shows it.
    for (const flag of ["--skip-worktree", "--assume-unchanged"]) {
      git("update-index", flag, "src/b.ts"); rmSync(join(root, "src", "b.ts"));
      expect(git("status", "--porcelain"), flag).toBe("");
      expect(localScreenGitState(frozenOf(root, ["src/a.ts", "src/c.ts"]), { root, cwd: root }), flag).toEqual({ commit, dirty: true });
      git("update-index", flag.replace("--", "--no-"), "src/b.ts"); git("checkout", "-q", "--", "src/b.ts");
    }
    expect(localScreenGitState(frozen(), { root, cwd: root })).toEqual({ commit, dirty: false });
    // A sparse checkout that leaves a frozen file out of the working tree.
    git("sparse-checkout", "set", "--no-cone", "/README.md", "/.gitignore", "/src/a.ts", "/src/c.ts");
    expect(localScreenGitState(frozenOf(root, ["src/a.ts", "src/c.ts"]), { root, cwd: root })).toEqual({ commit, dirty: true });
    git("sparse-checkout", "disable");
    expect(localScreenGitState(frozen(), { root, cwd: root })).toEqual({ commit, dirty: false });
    // A filter configured for the repository would run during the status: nothing runs and nothing is recorded.
    writeFileSync(join(root, ".git", "info", "attributes"), "*.ts filter=x\n");
    git("config", "filter.x.clean", `touch ${join(root, "FILTER_RAN")}; cat`);
    writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
    expect(localScreenGitState(frozen(), { root, cwd: root })).toBeNull();
    expect(() => readFileSync(join(root, "FILTER_RAN"))).toThrow();
    git("config", "--unset", "filter.x.clean");
    // An inherited GIT_DIR naming another repository is not used: the runner sets git's whole environment.
    const other = repository(); other.git("init", "-q");
    const saved = process.env.GIT_DIR; process.env.GIT_DIR = join(other.root, ".git");
    try { expect(localScreenGitState(frozen(), { root, cwd: root })?.commit).toBe(commit); } finally { if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved; }
  });
  it("records null outside any repository, even inside an ignored directory of an enclosing one", () => {
    const outside = scratch("soar-git-none-");
    expect(localScreenGitState([], { root: outside, cwd: outside })).toBeNull();
    const { root, git } = repository();
    git("init", "-q"); writeFileSync(join(root, ".gitignore"), "copy/\n"); git("add", "."); git("commit", "-q", "-m", "init");
    mkdirSync(join(root, "copy"));
    expect(localScreenGitState([], { root: join(root, "copy"), cwd: join(root, "copy") })).toBeNull();
    expect(() => localScreenGitRunner(outside)(["rev-parse", "HEAD"])).toThrow();
  });
  it("reads this repository's commit from the directory the driver runs in, whatever the tree's state", () => {
    const state = localScreenGitState(localScreenSourceFreeze().files);
    expect(state?.commit).toBe(HEAD); expect(typeof state?.dirty).toBe("boolean");
  });
  it("writes the helper's value into the driver's freeze, read right after the source-freeze check", () => {
    // CI never runs the driver (its run needs Docker), so its source text pins the wiring a rebase could drop.
    const driver = readFileSync(join(ROOT, "scripts", "private-agent-local-screen.ts"), "utf8");
    const check = driver.indexOf('if (sourceFreeze.sha256 !== input.expectedRuntimeSha256) throw new Error("local_screen_reviewed_source_changed");');
    const read = driver.indexOf("const git = localScreenGitState(sourceFreeze.files);");
    expect(check).toBeGreaterThan(0); expect(read).toBeGreaterThan(check); expect(read).toBeLessThan(driver.indexOf("mkdirSync(directory, { mode: 0o700 });"));
    const literal = driver.slice(driver.indexOf("const freeze = { version: 1, jobId,"), driver.indexOf('save("freeze.json", freeze);'));
    expect(literal).toMatch(/\n\s+git,\n/u);
  });
});
