import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Bind the executed app build; code changes require a new task, never silent resume. */
export function generalTaskRuntimeIdentity(applicationPath: string, developmentRenderer = false): string {
  const roots = ["out/main", "out/preload", "out/renderer", ...(developmentRenderer ? ["src/renderer"] : [])];
  const records: { path: string; sha256: string }[] = [];
  let totalBytes = 0;
  const walk = (relative: string): void => {
    const absolute = path.join(applicationPath, relative);
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) throw new Error("general_runtime_unavailable");
    if (info.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) walk(`${relative}/${name}`);
    } else if (info.isFile() && /\.(?:[cm]?js|css|html|tsx?|json)$/u.test(relative)) {
      totalBytes += info.size;
      if (records.length >= 2048 || info.size > 32 * 1024 * 1024 || totalBytes > 128 * 1024 * 1024) throw new Error("general_runtime_unavailable");
      records.push({ path: relative, sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex") });
    }
  };
  for (const root of roots) {
    const count = records.length;
    walk(root);
    if (records.length === count) throw new Error("general_runtime_unavailable");
  }
  walk("package.json");
  return createHash("sha256").update(JSON.stringify({ protocol: "desktop-general-task-v1", records })).digest("hex");
}
