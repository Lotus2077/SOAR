/**
 * Backlog item 4 (review finding F3): the harness's file sink for rejected or truncated research replies, and since 7a.1 for kept
 * extraction replies that lost or had corrected part of their content (a manifest row's `disposition`). Raw model text is
 * written in exactly one place, the headless driver's ignored run directory, and only when the operator asks for it with
 * `--retain-diagnostics true`; the desktop never builds this sink. Everything persisted elsewhere (events, receipts,
 * summary.json, coverage.json, result.json, the registry) stays hash-only for every label, and the session hands the sink to
 * the pipeline only while the reader context's retention is `raw` (contracts.ts, `diagnosticRetention`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, digest } from "./contracts";
import type { ResearchDiagnostic, ResearchDiagnosticsSink } from "./research-pipeline";

export const DIAGNOSTICS_DIRECTORY = "diagnostics";
export const DIAGNOSTICS_MANIFEST = "manifest.json";
/** 2 since 7a.1 (BL-20261109-0447-research-tolerance-design): a row may carry `disposition: "accepted_with_drops"`. */
export const DIAGNOSTICS_MANIFEST_VERSION = 2;
/** One manifest row: the entry without its content. */
export type DiagnosticsManifestEntry = Omit<ResearchDiagnostic, "content">;
export interface DiagnosticsManifest { version: typeof DIAGNOSTICS_MANIFEST_VERSION; entries: DiagnosticsManifestEntry[]; writeFailures: number }
export interface DiagnosticsFileSink extends ResearchDiagnosticsSink {
  /** The `diagnostics/` directory under the run directory. */
  readonly directory: string;
  manifest(): DiagnosticsManifest;
}

/**
 * Refuses an output directory the repository does not ignore, so retained model text can never sit in a tracked path. The
 * directory need not exist yet: `git check-ignore` matches the rules against the path. A path outside the repository is
 * refused too (git reports it as an error).
 */
export function assertRunDirectoryIgnored(directory: string, repository = process.cwd()): void {
  const result = spawnSync("git", ["check-ignore", "-q", "--", resolve(directory)], { cwd: repository, stdio: "ignore" });
  if (result.error || result.status !== 0) throw new Error("local_screen_retain_directory_not_ignored");
}

/**
 * Writes each retained reply to `<runDirectory>/diagnostics/<sha256 of its bytes>` (mode 0o600) and keeps a hashes-only
 * `manifest.json` beside them. The directory and an empty manifest are created at once, so a run that rejected nothing still
 * shows that retention was on. A write failure never fails the run: it is counted in the manifest and the run goes on.
 */
export function createDiagnosticsFileSink(runDirectory: string): DiagnosticsFileSink {
  const directory = join(resolve(runDirectory), DIAGNOSTICS_DIRECTORY);
  const manifest: DiagnosticsManifest = { version: DIAGNOSTICS_MANIFEST_VERSION, entries: [], writeFailures: 0 };
  const save = () => writeFileSync(join(directory, DIAGNOSTICS_MANIFEST), `${canonical(manifest)}\n`, { mode: 0o600 });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  save();
  return {
    directory,
    manifest: () => structuredClone(manifest),
    retain(entry) {
      const { content, ...rest } = entry;
      try {
        // The file is named by the sha256 of the bytes it holds, which is the pipeline's replyContentSha256 (both hash the UTF-8 encoding).
        const bytes = Buffer.from(content, "utf8"), path = join(directory, digest(bytes));
        if (!existsSync(path)) writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
        manifest.entries.push({ ...rest, reasons: rest.reasons.map(reason => ({ ...reason, ...(reason.path ? { path: [...reason.path] } : {}) })) });
      } catch { manifest.writeFailures++; }
      try { save(); } catch { manifest.writeFailures++; }
    },
  };
}
