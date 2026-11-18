import { readlinkSync, realpathSync } from "node:fs";
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

export type UserDataFolder = { kind: "default" } | { kind: "beta"; path: string } | { kind: "refused"; reason: string };

/**
 * The real path of `target`. A link whose target is absent is followed through its text, and a folder not yet made resolves through
 * its nearest existing ancestor. It throws on a link loop.
 */
export function resolvedPath(target: string, depth = 0): string {
  if (depth > 40) throw new Error("user_data_folder_unresolvable");
  const absolute = path.resolve(target);
  try { return realpathSync(absolute); } catch { /* absent, or a link whose target is absent */ }
  let link: string | undefined;
  try { link = readlinkSync(absolute); } catch { link = undefined; }
  if (link !== undefined) return resolvedPath(path.resolve(path.dirname(absolute), link), depth + 1);
  const parent = path.dirname(absolute);
  return parent === absolute ? absolute : path.join(resolvedPath(parent, depth + 1), path.basename(absolute));
}
const within = (inner: string, outer: string) => inner === outer || inner.startsWith(outer.endsWith(path.sep) ? outer : `${outer}${path.sep}`);

/**
 * The flag reads as config.ts reads it: absent or "false" keeps the default folder, "true" chooses the default folder's sibling
 * named with the suffix, and any other value refuses to start. The beta folder is refused when it resolves to the default folder,
 * into it or around it (through a link, for example).
 */
export function decideUserDataFolder(flag: string | undefined, defaultPath: string, resolve: (target: string) => string = resolvedPath): UserDataFolder {
  if (flag === undefined || flag === "false") return { kind: "default" };
  if (flag !== "true") return { kind: "refused", reason: "SOAR_ENABLE_LOCAL_RESEARCH_BETA must be true or false." };
  const beta = `${path.resolve(defaultPath)}${RESEARCH_BETA_FOLDER_SUFFIX}`;
  let home: string, own: string;
  try { home = resolve(defaultPath); own = resolve(beta); } catch { return { kind: "refused", reason: "The local research beta's user-data folder could not be resolved." }; }
  if (within(own, home) || within(home, own)) return { kind: "refused", reason: "The local research beta's user-data folder resolves to the default user-data folder, into it or around it." };
  return { kind: "beta", path: beta };
}

/**
 * Checked after the settings are read and before the database opens. The flag on in the settings read only from the user-data
 * folder means the folder was chosen without it, so the app refuses to start rather than run the beta in the default folder. In
 * the beta folder, the database stays inside it.
 */
export function researchBetaFolderIssue(input: { folder: UserDataFolder; localResearchBeta: boolean; userDataPath: string; databasePath?: string },
  resolve: (target: string) => string = resolvedPath): string | undefined {
  if (input.localResearchBeta && input.folder.kind !== "beta") {
    return "The local research beta is on only in the user-data folder's own settings. Set SOAR_ENABLE_LOCAL_RESEARCH_BETA=true in the beta checkout's .env.local instead, so the beta keeps its own user-data folder.";
  }
  if (input.folder.kind === "beta" && input.databasePath !== undefined) {
    let inside = false;
    try { inside = within(resolve(input.databasePath), resolve(input.userDataPath)); } catch { inside = false; }
    if (!inside) return "The local research beta keeps its database in its own user-data folder. Remove SOAR_DB_PATH from its settings.";
  }
  return undefined;
}

/** The configuration the running app sees: outside the beta folder the flag is off, whatever a settings file says later. */
export function withResearchBetaFolder<T extends Pick<SoarConfig, "localResearchBeta">>(config: T, folder: UserDataFolder): T {
  return folder.kind === "beta" || config.localResearchBeta !== true ? config : { ...config, localResearchBeta: false };
}
