import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generalTaskRuntimeIdentity } from "../../src/main/general-task-runtime";

const directories: string[] = [];
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "general-runtime-")); directories.push(root);
  for (const relative of ["out/main", "out/preload", "out/renderer"]) {
    mkdirSync(path.join(root, relative), { recursive: true });
    writeFileSync(path.join(root, relative, "index.js"), "void 0;");
  }
  writeFileSync(path.join(root, "package.json"), '{"version":"1"}');
  return root;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true }); });
describe("general task build identity", () => {
  it("survives relocation but changes when executable app or renderer bytes change", () => {
    const a = fixture(), b = fixture(), first = generalTaskRuntimeIdentity(a);
    expect(generalTaskRuntimeIdentity(b)).toBe(first);
    writeFileSync(path.join(b, "out/renderer/index.js"), "void 1;");
    expect(generalTaskRuntimeIdentity(b)).not.toBe(first);
    writeFileSync(path.join(a, "out/preload/index.js"), "void 2;");
    expect(generalTaskRuntimeIdentity(a)).not.toBe(first);
  });
  it("refuses missing builds and symlinked runtime files", () => {
    const root = fixture(); rmSync(path.join(root, "out/main/index.js"));
    expect(() => generalTaskRuntimeIdentity(root)).toThrow();
    symlinkSync(path.join(root, "out/preload/index.js"), path.join(root, "out/main/index.js"));
    expect(() => generalTaskRuntimeIdentity(root)).toThrow();
  });
  it("binds renderer source during development", () => {
    const root = fixture(); mkdirSync(path.join(root, "src/renderer"), { recursive: true });
    writeFileSync(path.join(root, "src/renderer/App.tsx"), "export default 1;");
    const first = generalTaskRuntimeIdentity(root, true);
    writeFileSync(path.join(root, "src/renderer/App.tsx"), "export default 2;");
    expect(generalTaskRuntimeIdentity(root, true)).not.toBe(first);
  });
});
