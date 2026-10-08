import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soar-blind-")); roots.push(root);
  const task = join(root, "task"); mkdirSync(task);
  const job = Buffer.from(JSON.stringify({ jobId: "p2-t1-synthetic", requiredArtifacts: ["output/report.md", "output/data.csv"] })), brief = Buffer.from("Write the report.");
  writeFileSync(join(task, "job.json"), job); writeFileSync(join(task, "brief.md"), brief);
  const run = (name: string, arm: string, files: Record<string, string>, binding = sha(job), extra: Record<string, unknown> = {}) => {
    const directory = join(root, "runs", name);
    mkdirSync(join(directory, "candidate", "output"), { recursive: true }); mkdirSync(join(directory, "candidate", "review"), { recursive: true });
    writeFileSync(join(directory, "freeze.json"), JSON.stringify({ taskBinding: { jobSha256: binding, briefSha256: sha(brief) }, modelConfig: { model: `model-of-${arm}` }, arm: { arm }, ...extra }));
    writeFileSync(join(directory, "result.json"), JSON.stringify({ status: "submitted", finishedAt: "2026-10-08T00:00:00Z" }));
    for (const [path, body] of Object.entries(files)) writeFileSync(join(directory, "candidate", path), body);
    return directory;
  };
  return { root, task, run, out: join(root, ".soar", "blind"), keys: join(root, ".soar", "keys") };
}
const blind = (args: string[]) => spawnSync("python3", ["scripts/phase2-blind.py", ...args], { encoding: "utf8" });

describe("Phase 2 blind verdict bundles", () => {
  it("copies each run's required artifacts byte for byte under random labels, with nothing that names the arm, and keeps the key outside", () => {
    const f = fixture();
    const local = f.run("local", "L-Heavy-1", { "output/report.md": "# Local report\n", "output/data.csv": "a,b\n1,2\n" });
    const cloud = f.run("cloud", "C-Sol", { "output/report.md": "# Cloud report\n" });
    const printed = JSON.parse(execFileSync("python3", ["scripts/phase2-blind.py", "--task-directory", f.task, "--out", f.out, "--keys", f.keys,
      "--run", `L-Heavy-1=${local}`, "--run", `C-Sol=${cloud}`], { encoding: "utf8" })) as { bundle: string; labels: string[]; keySha256: string };
    expect(printed.labels).toEqual(["A", "B"]);
    const keyBytes = readFileSync(join(f.keys, "p2-t1-synthetic.json"));
    expect(sha(keyBytes)).toBe(printed.keySha256);
    const key = JSON.parse(keyBytes.toString("utf8")) as { labels: Record<string, { arm: string; missing: string[] }> };
    const cloudLabel = Object.entries(key.labels).find(([, row]) => row.arm === "C-Sol")![0], localLabel = cloudLabel === "A" ? "B" : "A";
    expect(readFileSync(join(printed.bundle, localLabel, "output/report.md"), "utf8")).toBe("# Local report\n");
    expect(readFileSync(join(printed.bundle, cloudLabel, "MISSING.txt"), "utf8")).toContain("output/data.csv");
    expect(key.labels[cloudLabel]!.missing).toEqual(["output/data.csv"]);
    // The bundle holds artifacts, a verdict sheet and missing-file notes only: no freeze, result, model or arm.
    const everything = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? everything(join(dir, e.name)) : [join(dir, e.name)]);
    const text = everything(printed.bundle).map(path => readFileSync(path, "utf8")).join("\n");
    for (const tell of ["L-Heavy", "C-Sol", "model-of", "freeze", "submitted", "2026-10-08"]) expect(text).not.toContain(tell);
    expect(readFileSync(join(printed.bundle, "verdicts.csv"), "utf8").split("\n")[0]).toContain("arm guess");
    expect(statSync(join(f.keys, "p2-t1-synthetic.json")).mode & 0o777).toBe(0o600);
    // Nothing is left in the bundle root but the bundle itself.
    expect(readdirSync(f.out)).toEqual(["p2-t1-synthetic"]);
  });
  it("includes the deliverables a host-checked mode adds, and gives a run with no outputs a full missing list", () => {
    const f = fixture();
    const review = { "output/report.md": "summary", "output/redline.docx": "R", "output/clean.docx": "C", "output/issues.xlsx": "I", "output/hygiene.json": "{}", "review/edits.json": "{}" };
    const one = f.run("one", "L-Heavy-1", review, undefined, { documentReview: true });
    const empty = f.run("empty", "L-Heavy-2", {}, undefined, { documentReview: true });
    const printed = JSON.parse(execFileSync("python3", ["scripts/phase2-blind.py", "--task-directory", f.task, "--out", f.out, "--keys", f.keys,
      "--run", `L-Heavy-1=${one}`, "--run", `L-Heavy-2=${empty}`], { encoding: "utf8" })) as { bundle: string };
    const key = JSON.parse(readFileSync(join(f.keys, "p2-t1-synthetic.json"), "utf8")) as { labels: Record<string, { arm: string; missing: string[] }> };
    const [full] = Object.entries(key.labels).find(([, row]) => row.arm === "L-Heavy-1")!, [bare, bareRow] = Object.entries(key.labels).find(([, row]) => row.arm === "L-Heavy-2")!;
    for (const path of ["output/redline.docx", "output/clean.docx", "output/issues.xlsx", "output/hygiene.json", "review/edits.json"]) expect(readFileSync(join(printed.bundle, full, path), "utf8")).toBe(review[path as keyof typeof review]);
    expect(bareRow.missing).toHaveLength(7); expect(readdirSync(join(printed.bundle, bare))).toEqual(["MISSING.txt"]);
  });
  it("refuses a run of another task, a key root inside the bundle, and any overwrite", () => {
    const f = fixture();
    const good = f.run("good", "L-Heavy-1", { "output/report.md": "x" });
    const other = f.run("other", "C-Sol", { "output/report.md": "y" }, "0".repeat(64));
    expect(blind(["--task-directory", f.task, "--out", f.out, "--keys", f.keys, "--run", `C-Sol=${other}`]).stderr).toContain("not bound to this task");
    expect(blind(["--task-directory", f.task, "--out", f.out, "--keys", join(f.out, "keys"), "--run", `L=${good}`]).stderr).toContain("outside the bundle root");
    expect(blind(["--task-directory", f.task, "--out", join(f.root, "blind"), "--keys", f.keys, "--run", `L=${good}`]).stderr).toContain("under the ignored .soar/");
    const reviewed = f.run("reviewed", "L-Heavy-2", { "output/report.md": "z" }, undefined, { documentReview: true });
    expect(blind(["--task-directory", f.task, "--out", f.out, "--keys", f.keys, "--run", `L=${good}`, "--run", `R=${reviewed}`]).stderr).toContain("share its host-checked mode");
    const repaired = f.run("repaired", "L-prime", { "output/report.md": "w" }, undefined, { repair: { source: { freezeSha256: sha(readFileSync(join(good, "freeze.json"))) } } });
    expect(blind(["--task-directory", f.task, "--out", f.out, "--keys", f.keys, "--run", `L=${good}`, "--run", `P=${repaired}`]).stderr).toContain("bundle repair pairs on their own");
    expect(blind(["--task-directory", f.task, "--out", f.out, "--keys", f.keys, "--run", `L=${good}`]).status).toBe(0);
    expect(blind(["--task-directory", f.task, "--out", f.out, "--keys", f.keys, "--run", `L=${good}`]).stderr).toContain("refusing to overwrite");
  });
});
