import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RESEARCH_BETA_FOLDER_SUFFIX, decideUserDataFolder, researchBetaFolderIssue, resolvedPath, userDataFolderFromSettings, withResearchBetaFolder } from "../../src/main/user-data-folder";

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
    expect(decideUserDataFolder({}, home)).toEqual({ kind: "default" });
    expect(decideUserDataFolder({ research: "false" }, home)).toEqual({ kind: "default" });
    expect(decideUserDataFolder({ research: "true" }, home)).toEqual({ kind: "beta", path: `${home}${RESEARCH_BETA_FOLDER_SUFFIX}` });
    expect(`${home}${RESEARCH_BETA_FOLDER_SUFFIX}`).toBe(join(home, "..", "SOAR Research Beta"));
    for (const flag of ["TRUE", "1", "yes", "", " true"]) expect(decideUserDataFolder({ research: flag }, home), flag).toMatchObject({ kind: "refused", reason: "SOAR_ENABLE_LOCAL_RESEARCH_BETA must be true or false." });
  });

  it("refuses a beta folder that resolves to the default folder, into it or around it", () => {
    const { root, home } = appData(), beta = `${home}${RESEARCH_BETA_FOLDER_SUFFIX}`;
    const into = { kind: "refused", reason: "The beta's user-data folder resolves to the default user-data folder, into it or around it." };
    symlinkSync(home, beta);
    expect(decideUserDataFolder({ research: "true" }, home)).toEqual(into);
    // A dangling link is followed through its text: here into a folder not yet made inside the default one.
    rmSync(beta); symlinkSync(join(home, "nested"), beta);
    expect(decideUserDataFolder({ research: "true" }, home)).toEqual(into);
    // A link loop does not resolve, so it is refused.
    rmSync(beta); symlinkSync(join(root, "loop"), beta); symlinkSync(beta, join(root, "loop"));
    expect(decideUserDataFolder({ research: "true" }, home)).toEqual({ kind: "refused", reason: "The beta's user-data folder could not be resolved." });
    rmSync(join(root, "loop"));
    // The default folder reached through a link into the beta folder.
    rmSync(beta); mkdirSync(beta); const linked = join(root, "linked"); symlinkSync(beta, linked);
    expect(decideUserDataFolder({ research: "true" }, linked)).toMatchObject({ kind: "beta" });
    // A default folder that is a link into its own beta folder: the beta folder would hold it.
    const around = join(root, "SOAR2"), aroundBeta = `${around}${RESEARCH_BETA_FOLDER_SUFFIX}`;
    mkdirSync(join(aroundBeta, "inner"), { recursive: true }); symlinkSync(join(aroundBeta, "inner"), around);
    expect(decideUserDataFolder({ research: "true" }, around)).toEqual(into);
    // A folder not yet made resolves through its nearest existing ancestor.
    expect(resolvedPath(join(root, "absent", "deeper"))).toBe(join(root, "absent", "deeper"));
  });

  it("refuses another spelling of the default folder: another case, or the same device and inode under another name", () => {
    const { root, home } = appData(), beta = `${home}${RESEARCH_BETA_FOLDER_SUFFIX}`;
    // A link spelt in another case than the default folder's: the same folder on a case-insensitive volume, refused everywhere.
    symlinkSync(join(root, "soar"), beta);
    expect(decideUserDataFolder({ research: "true" }, home)).toMatchObject({ kind: "refused" });
    // With a resolver that keeps every spelling, the device and inode still catch a link to the default folder.
    rmSync(beta); symlinkSync(home, beta);
    expect(decideUserDataFolder({ research: "true" }, home, target => resolve(target))).toMatchObject({ kind: "refused" });
    rmSync(beta); mkdirSync(beta);
    expect(decideUserDataFolder({ research: "true" }, home, target => resolve(target))).toEqual({ kind: "beta", path: beta });
    // A default folder not yet made has no device or inode: its spelling alone, without case, refuses a link spelt otherwise.
    const fresh = join(root, "Fresh"), freshBeta = `${fresh}${RESEARCH_BETA_FOLDER_SUFFIX}`;
    symlinkSync(join(root, "fresh"), freshBeta);
    expect(decideUserDataFolder({ research: "true" }, fresh)).toEqual({ kind: "refused", reason: "The beta's user-data folder resolves to the default user-data folder, into it or around it." });
    // On a case-insensitive volume, an entry reached through another case of the beta folder's own name stays inside it.
    const variant = join(root, "soar research beta");
    if (existsSync(variant)) {
      mkdirSync(join(beta, "patch-runs-real")); symlinkSync(join(variant, "patch-runs-real"), join(beta, "patch-runs"));
      expect(decideUserDataFolder({ research: "true" }, home)).toEqual({ kind: "beta", path: beta });
    }
  });

  it("refuses a beta folder whose settings, database, side files or task data lead out of it through a link", () => {
    const { root, home } = appData(), beta = `${home}${RESEARCH_BETA_FOLDER_SUFFIX}`, elsewhere = join(root, "elsewhere");
    mkdirSync(beta); mkdirSync(elsewhere); writeFileSync(join(beta, "soar.sqlite"), ""); mkdirSync(join(beta, "general-tasks"));
    expect(decideUserDataFolder({ research: "true" }, home)).toEqual({ kind: "beta", path: beta });
    for (const [name, target] of [[".env.local", join(home, ".env.local")], ["soar.sqlite-wal", join(home, "soar.sqlite-wal")], ["patch-runs", join(elsewhere, "patch-runs")]]) {
      symlinkSync(target, join(beta, name));
      expect(decideUserDataFolder({ research: "true" }, home), name).toEqual({ kind: "refused", reason: `The beta's ${name} leads out of its own user-data folder.` });
      rmSync(join(beta, name));
    }
    // After the settings, the effective database and the task data beside it are resolved too.
    const folder = { kind: "beta" as const, path: beta };
    expect(researchBetaFolderIssue({ folder, localResearchBeta: true, userDataPath: beta })).toBeUndefined();
    rmSync(join(beta, "general-tasks"), { recursive: true }); symlinkSync(join(home, "general-tasks"), join(beta, "general-tasks"));
    expect(researchBetaFolderIssue({ folder, localResearchBeta: true, userDataPath: beta })).toMatch(/any link there that leads out of the folder/u);
    rmSync(join(beta, "general-tasks")); rmSync(join(beta, "soar.sqlite")); symlinkSync(join(home, "soar.sqlite"), join(beta, "soar.sqlite"));
    expect(researchBetaFolderIssue({ folder, localResearchBeta: false, userDataPath: beta })).toMatch(/any link there that leads out of the folder/u);
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

  it("keeps the document review flag off at run time outside the beta folder too, alone or beside the research flag (backlog item 13b)", () => {
    const review = { documentReviewBeta: true, other: 1 }, both = { localResearchBeta: true, documentReviewBeta: true, other: 1 };
    expect(withResearchBetaFolder(review, { kind: "default" })).toEqual({ documentReviewBeta: false, other: 1 });
    expect(withResearchBetaFolder(both, { kind: "default" })).toEqual({ localResearchBeta: false, documentReviewBeta: false, other: 1 });
    expect(withResearchBetaFolder(review, { kind: "beta", path: "beta" })).toBe(review);
    expect(withResearchBetaFolder(both, { kind: "beta", path: "beta" })).toBe(both);
    // A flag that is off stays absent or off, and nothing else is touched.
    expect(withResearchBetaFolder({ localResearchBeta: true, other: 1 }, { kind: "default" })).toEqual({ localResearchBeta: false, other: 1 });
    const off = { documentReviewBeta: false, other: 1 };
    expect(withResearchBetaFolder(off, { kind: "default" })).toBe(off);
  });
});

describe("one beta folder on either flag (backlog item 13b, part 4)", () => {
  it("chooses the beta folder for the review flag alone, as for the research flag or both, and the default folder when both are off", () => {
    const { home } = appData(), beta = { kind: "beta", path: `${home}${RESEARCH_BETA_FOLDER_SUFFIX}` };
    for (const flags of [{ review: "true" }, { research: "true" }, { research: "true", review: "true" }, { research: "false", review: "true" }, { research: "true", review: "false" }]) {
      expect(decideUserDataFolder(flags, home), JSON.stringify(flags)).toEqual(beta);
    }
    for (const flags of [{}, { review: "false" }, { research: "false", review: "false" }]) expect(decideUserDataFolder(flags, home), JSON.stringify(flags)).toEqual({ kind: "default" });
  });

  it("refuses an invalid value of either flag by its own name, even beside the other flag on", () => {
    const { home } = appData();
    for (const value of ["TRUE", "1", "yes", "", " true"]) {
      expect(decideUserDataFolder({ review: value }, home), value).toEqual({ kind: "refused", reason: "SOAR_ENABLE_DOCUMENT_REVIEW_BETA must be true or false." });
      expect(decideUserDataFolder({ research: "true", review: value }, home), value).toEqual({ kind: "refused", reason: "SOAR_ENABLE_DOCUMENT_REVIEW_BETA must be true or false." });
      expect(decideUserDataFolder({ research: value, review: "true" }, home), value).toEqual({ kind: "refused", reason: "SOAR_ENABLE_LOCAL_RESEARCH_BETA must be true or false." });
    }
  });

  it("reads both flags from the settings, and refuses to start when the settings cannot be read", () => {
    const { home } = appData();
    expect(userDataFolderFromSettings(() => ({ SOAR_ENABLE_DOCUMENT_REVIEW_BETA: "true" }), home)).toEqual({ kind: "beta", path: `${home}${RESEARCH_BETA_FOLDER_SUFFIX}` });
    expect(userDataFolderFromSettings(() => ({ SOAR_ENABLE_LOCAL_RESEARCH_BETA: "true" }), home)).toMatchObject({ kind: "beta" });
    expect(userDataFolderFromSettings(() => ({ SOAR_ENABLE_DOCUMENT_REVIEW_BETA: "on" }), home)).toMatchObject({ kind: "refused", reason: "SOAR_ENABLE_DOCUMENT_REVIEW_BETA must be true or false." });
    expect(userDataFolderFromSettings(() => ({}), home)).toEqual({ kind: "default" });
    expect(userDataFolderFromSettings(() => { throw new Error("EACCES"); }, home)).toEqual({ kind: "refused", reason: "SOAR could not read the settings that choose its user-data folder." });
  });

  it("refuses to start with the review flag on only in the user-data folder's own settings", () => {
    const { home } = appData(), beta = { kind: "beta" as const, path: `${home}${RESEARCH_BETA_FOLDER_SUFFIX}` };
    expect(researchBetaFolderIssue({ folder: { kind: "default" }, localResearchBeta: false, documentReviewBeta: true, userDataPath: home })).toMatch(/SOAR_ENABLE_DOCUMENT_REVIEW_BETA=true in the beta checkout's \.env\.local/u);
    expect(researchBetaFolderIssue({ folder: beta, localResearchBeta: false, documentReviewBeta: true, userDataPath: beta.path })).toBeUndefined();
    expect(researchBetaFolderIssue({ folder: { kind: "default" }, localResearchBeta: false, documentReviewBeta: false, userDataPath: home })).toBeUndefined();
  });

  it("is wired at startup: the main process reads both flags through the settings reader, and bootstrap checks the review flag", () => {
    const root = resolve(__dirname, "..", "..");
    expect(readFileSync(join(root, "src/main/index.ts"), "utf8")).toContain("userDataFolderFromSettings(() => loadEnvironmentFiles({ appPath: app.getAppPath() }), app.getPath(\"userData\"))");
    expect(readFileSync(join(root, "src/main/bootstrap.ts"), "utf8")).toContain("documentReviewBeta: config.documentReviewBeta === true, userDataPath,");
  });
});

