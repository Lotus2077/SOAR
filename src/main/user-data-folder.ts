import { readlinkSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import type { SoarConfig } from "./config";

/**
 * Backlog item 13a, requirement A: a build with the local research beta on keeps its own user-data folder, so it never opens,
 * migrates or writes the default folder's database, settings or single-instance lock. The main process decides the folder before
 * that lock, from the settings it can read without a user-data folder: the process environment, SOAR_ENV_FILE and the checkout's
 * own .env.local and .env. A beta checkout with the flag in its own .env.local therefore finds its folder when started the plain
 * way (`pnpm exec electron .`), with no launch flag.
 */
export const RESEARCH_BETA_FOLDER_SUFFIX = " Research Beta";
/** What the app keeps in its user-data folder by name: its settings, the database with SQLite's side files, and task data. */
export const USER_DATA_ENTRIES = Object.freeze([".env.local", "soar.sqlite", "soar.sqlite-wal", "soar.sqlite-shm", "soar.sqlite-journal", "general-tasks", "patch-runs"]);

export type UserDataFolder = { kind: "default" } | { kind: "beta"; path: string } | { kind: "refused"; reason: string };

/**
 * The real path of `target`, in the file system's own spelling where it exists (realpath.native). A link whose target is absent is
 * followed through its text, and a folder not yet made resolves through its nearest existing ancestor. It throws on a link loop.
 */
export function resolvedPath(target: string, depth = 0): string {
  if (depth > 40) throw new Error("user_data_folder_unresolvable");
  const absolute = path.resolve(target);
  try { return realpathSync.native(absolute); } catch { /* absent, or a link whose target is absent */ }
  let link: string | undefined;
  try { link = readlinkSync(absolute); } catch { link = undefined; }
  if (link !== undefined) return resolvedPath(path.resolve(path.dirname(absolute), link), depth + 1);
  const parent = path.dirname(absolute);
  return parent === absolute ? absolute : path.join(resolvedPath(parent, depth + 1), path.basename(absolute));
}
const within = (inner: string, outer: string) => inner === outer || inner.startsWith(outer.endsWith(path.sep) ? outer : `${outer}${path.sep}`);
/** The device and inode of what `target` names, following links, or undefined when nothing is there. */
function identity(target: string): string | undefined {
  try { const stat = statSync(target); return `${stat.dev}:${stat.ino}`; } catch { return undefined; }
}
/**
 * Whether resolved `inner` is resolved `outer` or lies inside it, failing closed: by spelling, ignoring case and Unicode form, and by
 * device and inode, so another spelling of the same folder (another case, a firmlink) counts as the same folder.
 */
function overlaps(inner: string, outer: string): boolean {
  const fold = (spelling: string) => spelling.normalize("NFC").toLowerCase();
  if (within(fold(inner), fold(outer))) return true;
  const target = identity(outer);
  if (target === undefined) return false;
  for (let current = inner; ; current = path.dirname(current)) {
    if (identity(current) === target) return true;
    if (path.dirname(current) === current) return false;
  }
}
const REFUSED_UNRESOLVED: UserDataFolder = { kind: "refused", reason: "The local research beta's user-data folder could not be resolved." };

/**
 * The flag reads as config.ts reads it: absent or "false" keeps the default folder, "true" chooses the default folder's sibling
 * named with the suffix, and any other value refuses to start. The beta folder is refused when it resolves to the default folder,
 * into it or around it (through a link, for example), or when one of the app's entries in it leads out of it.
 */
export function decideUserDataFolder(flag: string | undefined, defaultPath: string, resolve: (target: string) => string = resolvedPath): UserDataFolder {
  if (flag === undefined || flag === "false") return { kind: "default" };
  if (flag !== "true") return { kind: "refused", reason: "SOAR_ENABLE_LOCAL_RESEARCH_BETA must be true or false." };
  const beta = `${path.resolve(defaultPath)}${RESEARCH_BETA_FOLDER_SUFFIX}`;
  let home: string, own: string;
  try { home = resolve(defaultPath); own = resolve(beta); } catch { return REFUSED_UNRESOLVED; }
  if (overlaps(own, home) || overlaps(home, own)) return { kind: "refused", reason: "The local research beta's user-data folder resolves to the default user-data folder, into it or around it." };
  for (const name of USER_DATA_ENTRIES) {
    let entry: string;
    try { entry = resolve(path.join(beta, name)); } catch { return REFUSED_UNRESOLVED; }
    if (!within(entry, own) || overlaps(entry, home)) return { kind: "refused", reason: `The local research beta's ${name} leads out of its own user-data folder.` };
  }
  return { kind: "beta", path: beta };
}

/**
 * Checked after the settings are read and before the database opens. The flag on in the settings read only from the user-data
 * folder means the folder was chosen without it, so the app refuses to start rather than run the beta in the default folder. In
 * the beta folder, the effective database (SOAR_DB_PATH or the folder's own), its side files and the task data beside it must
 * resolve inside the folder.
 */
export function researchBetaFolderIssue(input: { folder: UserDataFolder; localResearchBeta: boolean; userDataPath: string; databasePath?: string },
  resolve: (target: string) => string = resolvedPath): string | undefined {
  if (input.localResearchBeta && input.folder.kind !== "beta") {
    return "The local research beta is on only in the user-data folder's own settings. Set SOAR_ENABLE_LOCAL_RESEARCH_BETA=true in the beta checkout's .env.local instead, so the beta keeps its own user-data folder.";
  }
  if (input.folder.kind !== "beta") return undefined;
  const database = input.databasePath ?? path.join(input.userDataPath, "soar.sqlite");
  const targets = [database, `${database}-wal`, `${database}-shm`, `${database}-journal`, path.join(path.dirname(database), "general-tasks")];
  let inside = false;
  try { const own = resolve(input.folder.path); inside = targets.every(target => within(resolve(target), own)); } catch { inside = false; }
  return inside ? undefined
    : "The local research beta keeps its database and task data inside its own user-data folder. Remove SOAR_DB_PATH from its settings, and any link there that leads out of the folder.";
}

/** The configuration the running app sees: outside the beta folder the flag is off, whatever a settings file says later. */
export function withResearchBetaFolder<T extends Pick<SoarConfig, "localResearchBeta">>(config: T, folder: UserDataFolder): T {
  return folder.kind === "beta" || config.localResearchBeta !== true ? config : { ...config, localResearchBeta: false };
}
