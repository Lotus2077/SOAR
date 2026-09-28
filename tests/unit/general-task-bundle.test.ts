import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildArtifactBundle, bundleManifest, type ArtifactBundleRecord } from "../../src/main/general-tasks/artifact-bundle";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const record = (path: string, bytes = 1): ArtifactBundleRecord => ({ path, bytes, sha256: "a".repeat(64) });
const MiB = 1024 * 1024;
const inspect = (archive: Buffer) => {
  const python = spawnSync("python3", ["-I", "-c", `
import base64,io,json,stat,sys,zipfile
raw=sys.stdin.buffer.read()
with zipfile.ZipFile(io.BytesIO(raw)) as z:
 assert z.testzip() is None
 rows=[]
 for info in z.infolist():
  assert info.compress_type==zipfile.ZIP_STORED
  assert info.flag_bits==0x800
  assert info.date_time==(1980,1,1,0,0,0)
  assert stat.S_ISREG(info.external_attr>>16)
  assert info.create_system==3 and info.extra==b'' and info.comment==b''
  assert not info.is_dir()
  data=z.read(info.filename)
  assert info.file_size==len(data) and info.compress_size==len(data)
  rows.append({'path':info.filename,'base64':base64.b64encode(data).decode(),'crc':info.CRC})
 assert z.comment==b''
 print(json.dumps(rows,ensure_ascii=False))
`], { input: archive, timeout: 10000, maxBuffer: 1024 * 1024, encoding: "utf8" });
  expect(python.error).toBeUndefined(); expect(python.status, python.stderr).toBe(0);
  return JSON.parse(python.stdout) as { path: string; base64: string; crc: number }[];
};

describe("deterministic artifact ZIP bundle", () => {
  it("Python independently reads exact nested Unicode, binary and empty file bytes", () => {
    const files = [
      { path: "output/图表/数据 🙂.bin", bytes: Buffer.from([0, 255, 80, 75, 3, 4, 128, 13, 10]) },
      { path: "output/site/assets/app.js", bytes: Buffer.from("document.title = 'Résumé';\n") },
      { path: "output/site/index.html", bytes: Buffer.from("<!doctype html><title>示例</title>\n") },
      { path: "output/empty.txt", bytes: Buffer.alloc(0) },
      { path: "output/with spaces/notes.txt", bytes: Buffer.from("123456789") },
    ];
    const archive = buildArtifactBundle(files);
    expect(buildArtifactBundle([...files].reverse())).toEqual(archive);
    const actual = inspect(archive);
    const expected = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
      .map(file => ({ path: file.path.slice(7), base64: file.bytes.toString("base64") }));
    expect(actual.map(({ path, base64 }) => ({ path, base64 }))).toEqual(expected);
    expect(actual.find(row => row.path === "with spaces/notes.txt")!.crc).toBe(0xcbf43926);
    expect(actual.some(row => row.path.startsWith("output/"))).toBe(false);
  });

  it("hashes a deterministic sorted inventory and binds each name, length and digest", () => {
    const records = [record("output/β.txt", 0), record("output/a.txt", 10)];
    const expectedFiles = [records[1], records[0]];
    expect(bundleManifest(records)).toEqual({ manifestSha256: sha(JSON.stringify({ version: 1, files: expectedFiles })), fileCount: 2, totalBytes: 10 });
    expect(bundleManifest([...records].reverse())).toEqual(bundleManifest(records));
    for (const delta of [{ path: "output/b.txt" }, { bytes: 11 }, { sha256: "b".repeat(64) }]) {
      expect(bundleManifest([{ ...records[0], ...delta }, records[1]]).manifestSha256).not.toBe(bundleManifest(records).manifestSha256);
    }
  });

  it("supports the empty inventory and bounded maximum file count", () => {
    expect(bundleManifest([])).toMatchObject({ fileCount: 0, totalBytes: 0 });
    expect(buildArtifactBundle([])).toHaveLength(22); expect(inspect(buildArtifactBundle([]))).toEqual([]);
    const files = Array.from({ length: 1024 }, (_, i) => ({ path: `output/file-${i}.txt`, bytes: Buffer.alloc(0) }));
    expect(inspect(buildArtifactBundle(files))).toHaveLength(1024);
    expect(() => buildArtifactBundle([...files, { path: "output/extra", bytes: Buffer.alloc(0) }])).toThrow("artifact_bundle_size_exceeded");
  });

  it.each([
    "input/private.txt", "/output/a.txt", "output/", "output//a", "output/./a", "output/../a", "output/a/", "output/a\\b",
    "output/C:drive.txt", "output/folder/file:stream", "output/Ｃ：drive.txt", "output/file.", "output/file ", "output/file\u00a0",
    "output/CON", "output/con.txt", "output/CON .txt", "output/aux/a.txt", "output/NUL.md", "output/LPT9.txt", "output/COM¹.txt", "output/CONIN$", "output/CLOCK$",
    "output/a?b", "output/a*b", "output/a|b", 'output/a"b', "output/a<b", "output/a>b", "output/a\0b", "output/a\nb", "output/a\x7fb",
    "output/\uff0e\uff0e/file", "output/a\uff0fb", "output/\ud800.txt", `output/${"a".repeat(240)}`,
  ])("rejects extraction-unsafe path %j in both APIs", path => {
    expect(() => bundleManifest([record(path)])).toThrow("artifact_bundle_path_invalid");
    expect(() => buildArtifactBundle([{ path, bytes: Buffer.from("x") }])).toThrow("artifact_bundle_path_invalid");
  });

  it.each([
    ["output/a.txt", "output/a.txt"], ["output/A.txt", "output/a.txt"], ["output/é.txt", "output/e\u0301.txt"],
    ["output/straße.txt", "output/STRASSE.txt"], ["output/Ａ.txt", "output/A.txt"],
    ["output/a", "output/a/b.txt"], ["output/A", "output/a/b.txt"], ["output/é", "output/e\u0301/file"],
    ["output/A/one.txt", "output/a/two.txt"],
  ])("rejects duplicate or ambiguous extraction tree %j and %j", (a, b) => {
    for (const paths of [[a, b], [b, a]]) {
      expect(() => bundleManifest(paths.map(path => record(path)))).toThrow("artifact_bundle_path_collision");
      expect(() => buildArtifactBundle(paths.map(path => ({ path, bytes: Buffer.from("x") })))).toThrow("artifact_bundle_path_collision");
    }
  });

  it("accepts ordinary Unicode/spaces and does not rewrite file names", () => {
    const paths = ["output/Résumé final.txt", "output/資料/分析.csv", "output/COM10.txt", "output/a/.notes"];
    const data = inspect(buildArtifactBundle(paths.map(path => ({ path, bytes: Buffer.from(path) }))));
    expect(new Set(data.map(row => row.path))).toEqual(new Set(paths.map(path => path.slice(7))));
  });

  it("rejects malformed metadata and never accepts filesystem or symlink metadata", () => {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => bundleManifest([record("output/a", value)])).toThrow("artifact_bundle_size_exceeded");
    for (const hash of ["", "A".repeat(64), "b".repeat(63), "b".repeat(65)]) expect(() => bundleManifest([{ ...record("output/a"), sha256: hash }])).toThrow("artifact_bundle_digest_invalid");
    expect(() => bundleManifest([{ ...record("output/a"), mode: "symlink" } as ArtifactBundleRecord])).toThrow("artifact_bundle_record_invalid");
    expect(() => buildArtifactBundle([{ path: "output/a", bytes: "path/to/host" as unknown as Buffer }])).toThrow("artifact_bundle_bytes_invalid");
    expect(() => buildArtifactBundle([{ path: "output/a", bytes: Buffer.from("x"), target: "/host/private" } as { path: string; bytes: Buffer }])).toThrow("artifact_bundle_record_invalid");
  });

  it("enforces the checkpoint per-file and aggregate byte bounds before allocating ZIP output", () => {
    expect(bundleManifest([record("output/a", 64 * MiB), record("output/b", 64 * MiB)])).toMatchObject({ fileCount: 2, totalBytes: 128 * MiB });
    expect(() => bundleManifest([record("output/a", 64 * MiB + 1)])).toThrow("artifact_bundle_size_exceeded");
    expect(() => bundleManifest([record("output/a", 64 * MiB), record("output/b", 64 * MiB), record("output/c", 1)])).toThrow("artifact_bundle_size_exceeded");
    expect(() => bundleManifest(Array.from({ length: 1025 }, (_, i) => record(`output/${i}`, 0)))).toThrow("artifact_bundle_size_exceeded");
    const oversized = Buffer.alloc(64 * MiB + 1);
    expect(() => buildArtifactBundle([{ path: "output/a", bytes: oversized }])).toThrow("artifact_bundle_size_exceeded");
    const atLimit = oversized.subarray(0, 64 * MiB);
    expect(() => buildArtifactBundle([{ path: "output/a", bytes: atLimit }, { path: "output/b", bytes: atLimit }, { path: "output/c", bytes: Buffer.from("x") }])).toThrow("artifact_bundle_size_exceeded");
  });
});
