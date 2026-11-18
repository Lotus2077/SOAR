import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RESEARCH_BETA_FOLDER_SUFFIX, decideUserDataFolder, researchBetaFolderIssue, resolvedPath, withResearchBetaFolder } from "../../src/main/user-data-folder";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
/** A root standing for the app-data folder, with the default user-data folder "SOAR" in it. */
function appData(): { root: string; home: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "soar-user-data-folder-"))); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "SOAR"); mkdirSync(home); return { root, home };
}

describe("the local research beta's own user-data folder (backlog item 13a, requirement A)", () => {
  it("keeps the default folder unless the flag is true, chooses the sibling folder when it is, and refuses any other value", () => {
    const { home } = appData();
    expect(decideUserDataFolder(undefined, home)).toEqual({ kind: "default" });
    expect(decideUserDataFolder("false", home)).toEqual({ kind: "default" });
    expect(decideUserDataFolder("true", home)).toEqual({ kind: "beta", path: `${home}${RESEARCH_BETA_FOLDER_SUFFIX}` });
    expect(`${home}${RESEARCH_BETA_FOLDER_SUFFIX}`).toBe(join(home, "..", "SOAR Research Beta"));
    for (const flag of ["TRUE", "1", "yes", "", " true"]) expect(decideUserDataFolder(flag, home), flag).toMatchObject({ kind: "refused", reason: "SOAR_ENABLE_LOCAL_RESEARCH_BETA must be true or false." });
  });

  it("refuses a beta folder that resolves to the default folder, into it or around it", () => {
    const { root, home } = appData(), beta = `${home}${RESEARCH_BETA_FOLDER_SUFFIX}`;
    symlinkSync(home, beta);
    expect(decideUserDataFolder("true", home)).toMatchObject({ kind: "refused" });
    // A dangling link is followed through its text: here into a folder not yet made inside the default one.
    rmSync(beta); symlinkSync(join(home, "nested"), beta);
    expect(decideUserDataFolder("true", home)).toMatchObject({ kind: "refused" });
    // A link loop does not resolve, so it is refused.
    rmSync(beta); symlinkSync(join(root, "loop"), beta); symlinkSync(beta, join(root, "loop"));
    expect(decideUserDataFolder("true", home)).toEqual({ kind: "refused", reason: "The local research beta's user-data folder could not be resolved." });
    rmSync(join(root, "loop"));
    // The default folder reached through a link into the beta folder.
    rmSync(beta); mkdirSync(beta); const linked = join(root, "linked"); symlinkSync(beta, linked);
    expect(decideUserDataFolder("true", linked)).toMatchObject({ kind: "beta" });
    // A default folder that is a link into its own beta folder: the beta folder would hold it.
    const around = join(root, "SOAR2"), aroundBeta = `${around}${RESEARCH_BETA_FOLDER_SUFFIX}`;
    mkdirSync(join(aroundBeta, "inner"), { recursive: true }); symlinkSync(join(aroundBeta, "inner"), around);
    expect(decideUserDataFolder("true", around)).toMatchObject({ kind: "refused" });
    // A folder not yet made resolves through its nearest existing ancestor.
    expect(resolvedPath(join(root, "absent", "deeper"))).toBe(join(root, "absent", "deeper"));
  });

  it("refuses to start with the flag on outside the beta folder, or with the beta's database outside its folder", () => {
    const { home } = appData(), beta = { kind: "beta" as const, path: `${home}${RESEARCH_BETA_FOLDER_SUFFIX}` };
    expect(researchBetaFolderIssue({ folder: { kind: "default" }, localResearchBeta: true, userDataPath: home })).toMatch(/beta checkout's \.env\.local/u);
    expect(researchBetaFolderIssue({ folder: { kind: "default" }, localResearchBeta: false, userDataPath: home })).toBeUndefined();
    expect(researchBetaFolderIssue({ folder: beta, localResearchBeta: true, userDataPath: beta.path })).toBeUndefined();
    expect(researchBetaFolderIssue({ folder: beta, localResearchBeta: false, userDataPath: beta.path })).toBeUndefined();
    expect(researchBetaFolderIssue({ folder: beta, localResearchBeta: true, userDataPath: beta.path, databasePath: join(beta.path, "soar.sqlite") })).toBeUndefined();
    expect(researchBetaFolderIssue({ folder: beta, localResearchBeta: true, userDataPath: beta.path, databasePath: join(home, "soar.sqlite") })).toMatch(/SOAR_DB_PATH/u);
    expect(researchBetaFolderIssue({ folder: beta, localResearchBeta: false, userDataPath: beta.path, databasePath: join(beta.path, "..", "SOAR", "soar.sqlite") })).toMatch(/SOAR_DB_PATH/u);
  });

  it("keeps the research flag off at run time outside the beta folder", () => {
    const on = { localResearchBeta: true, other: 1 }, off = { localResearchBeta: false, other: 1 };
    expect(withResearchBetaFolder(on, { kind: "default" })).toEqual(off);
    expect(withResearchBetaFolder(on, { kind: "beta", path: "beta" })).toBe(on);
    expect(withResearchBetaFolder(off, { kind: "default" })).toBe(off);
  });
});
