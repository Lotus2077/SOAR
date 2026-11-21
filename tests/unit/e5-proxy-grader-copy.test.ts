import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../../scripts/e5-proxy-grader-copy.py");
const roots: string[] = [];
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "soar-blind-fixture-")));
  roots.push(root);
  const operator = join(root, "operator"), grader = join(root, "grader");
  for (const dir of [operator, grader]) mkdirSync(dir, { mode: 0o700 });
  const need = "Help a volunteer choose a four-session lecture timetable.\n";
  const criteria = "List start times and room assignments for all four lectures.\n";
  const artifact = "<h1>Lecture timetable</h1><p>Room assignments by session</p>\n";
  const files = { need: join(operator, "community-brief.txt"), criteria: join(operator, "acceptance-notes.md"), artifact: join(operator, "speaker-timetable.html") };
  writeFileSync(files.need, need);
  writeFileSync(files.criteria, criteria);
  writeFileSync(files.artifact, artifact);
  const policy = { ownerNames: ["Synthetic Owner Example"], endpointHosts: ["endpoint.example.invalid"], materialRoots: [operator, grader] };
  const out = join(grader, "blind");
  const args = ["--need", files.need, hash(need), "--criteria", files.criteria, hash(criteria), "--deliverable", files.artifact, hash(artifact), "--out", out];
  function run(argv = args) {
    const result = spawnSync("python3", ["-I", script, ...argv], { input: JSON.stringify(policy), encoding: "utf8" });
    if (result.error) throw result.error;
    return result;
  }
  return { root, operator, grader, out, files, args, run, need, criteria, artifact };
}

describe("E5 blind grader copy", () => {
  it("publishes only the pinned need, criteria and named deliverables under neutral filenames", () => {
    const f = fixture();
    writeFileSync(join(f.operator, "decision.json"), '{"decision":"accept","artifactSha256":"operator-only"}');
    writeFileSync(join(f.operator, "receipt.json"), '{"verdictBy":"proxy_agent","interventions":1}');
    writeFileSync(join(f.operator, "source-log.json"), '{"persona":"p-12345678","community":"synthetic fixture"}');
    const supplement = "session,room\nA,101\nB,109\n";
    const extra = join(f.operator, "operator-labelled-supplement.csv");
    writeFileSync(extra, supplement);
    const sourceTime = statSync(f.operator, { bigint: true }).mtimeNs;
    const result = f.run([...f.args, "--deliverable", extra, hash(supplement)]);
    expect(result.status).toBe(0);
    expect(statSync(f.operator, { bigint: true }).mtimeNs).toBe(sourceTime);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ status: "staged", files: 4, sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(readdirSync(f.out).sort()).toEqual(["criteria.txt", "deliverable-01.html", "deliverable-02.csv", "need.txt"]);
    for (const [name, content] of [["criteria.txt", f.criteria], ["deliverable-01.html", f.artifact], ["deliverable-02.csv", supplement], ["need.txt", f.need]]) {
      expect(readFileSync(join(f.out, name))).toEqual(Buffer.from(content));
    }
    expect(readdirSync(f.grader)).toEqual(["blind"]);
  });

  it.each(["need", "criteria", "artifact"] as const)("rejects a changed %s before any blind copy is published", key => {
    const f = fixture();
    writeFileSync(f.files[key], "Replacement material.\n");
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe("pin_mismatch");
    expect(result.stdout).toBe("");
    expect(readdirSync(f.grader)).toEqual([]);
  });

  it("refuses out-of-root files, linked files and linked parents without disclosing their paths", () => {
    const f = fixture(), outside = join(f.root, "elsewhere");
    mkdirSync(outside, { mode: 0o700 });
    const real = join(outside, "private.txt");
    writeFileSync(real, f.need);
    const leaf = join(f.operator, "leaf.txt"), parent = join(f.operator, "linked-parent"), hard = join(f.operator, "hard.txt");
    symlinkSync(real, leaf);
    symlinkSync(outside, parent, "dir");
    linkSync(real, hard);
    for (const source of [real, leaf, join(parent, "private.txt"), hard]) {
      const args = [...f.args]; args[1] = source;
      const result = f.run(args);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toMatch(/^[a-z_]+$/u);
      expect(result.stderr).not.toContain("private.txt");
      expect(result.stderr).not.toContain(f.root);
      expect(existsSync(f.out)).toBe(false);
    }
  });

  it("refuses even pinned deliverables flagged by the shared scanner and preserves existing destinations", () => {
    const f = fixture(), content = '<p>Contact sample.reader@example.invalid.</p>';
    writeFileSync(f.files.artifact, content);
    const args = [...f.args]; args[8] = hash(content);
    const rejected = f.run(args);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr.trim()).toBe("sensitive_content");
    expect(rejected.stdout).toBe("");
    expect(readdirSync(f.grader)).toEqual([]);
    mkdirSync(f.out, { mode: 0o700 });
    writeFileSync(join(f.out, "existing.txt"), "Earlier handoff.");
    expect(f.run().stderr.trim()).toBe("destination_exists");
    expect(readdirSync(f.out)).toEqual(["existing.txt"]);
    expect(readFileSync(join(f.out, "existing.txt"), "utf8")).toBe("Earlier handoff.");
  });

  it("refuses broad or out-of-policy output locations and missing or malformed pins", () => {
    const f = fixture();
    expect(f.run(f.args.slice(0, 3)).stderr.trim()).toBe("invalid_arguments");
    const badPin = [...f.args]; badPin[5] = "not-a-sha";
    expect(f.run(badPin).stderr.trim()).toBe("invalid_pin");
    const outside = [...f.args]; outside[10] = join(f.root, "outside");
    expect(f.run(outside).stderr.trim()).toBe("outside_material_roots");
    const inSource = [...f.args]; inSource[10] = join(f.operator, "blind");
    const sourceTime = statSync(f.operator, { bigint: true }).mtimeNs;
    expect(f.run(inSource).stderr.trim()).toBe("unsafe_destination");
    expect(statSync(f.operator, { bigint: true }).mtimeNs).toBe(sourceTime);
    chmodSync(f.grader, 0o755);
    expect(f.run().status).not.toBe(0);
    expect(existsSync(f.out)).toBe(false);
  });
});
