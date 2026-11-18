import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");

describe("main startup ordering", () => {
  it("keeps database and credential modules behind the primary-instance lock", () => {
    const entry = readFileSync(
      path.join(projectRoot, "src/main/index.ts"),
      "utf8",
    );
    const lock = entry.indexOf("app.requestSingleInstanceLock()");
    const bootstrapImport = entry.indexOf('import("./bootstrap")');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(bootstrapImport).toBeGreaterThan(lock);
    expect(entry).not.toMatch(
      /^import .*from ["']\.\/(?:database|credentials\/|cloud-credential-service)/mu,
    );
    expect(entry).toContain("if (!primaryInstance)");
    // Backlog item 13a, requirement A: the user-data folder is chosen first, since Electron keeps the lock in it.
    const folder = entry.indexOf("const userDataFolder = chooseUserDataFolder();");
    expect(folder).toBeGreaterThanOrEqual(0);
    expect(folder).toBeLessThan(lock);
    expect(entry).toContain('const primaryInstance = userDataFolder.kind !== "refused" && app.requestSingleInstanceLock();');
    expect(entry).toContain("controller = await bootstrap({ userDataFolder });");
    // Backlog item 13a: the quit offer reads the research stage when it opens, and shows only quitOffer's words.
    expect(entry).toContain("const offer = quitOffer(current.researchStageRunning());");
    expect(entry).toContain("message: offer.message, detail: offer.detail");
    expect(entry).not.toContain("can be resumed later");
  });

  it("refuses the research beta outside its folder before the database opens, and keeps its flag off there at run time (backlog item 13a)", () => {
    const bootstrap = readFileSync(path.join(projectRoot, "src/main/bootstrap.ts"), "utf8");
    const config = bootstrap.indexOf("const config = loadConfig({"), issue = bootstrap.indexOf("if (folderIssue !== undefined) throw new Error(folderIssue);");
    const database = bootstrap.indexOf("database = createSoarDatabase(databasePath);");
    expect(config).toBeGreaterThanOrEqual(0); expect(issue).toBeGreaterThan(config); expect(database).toBeGreaterThan(issue);
    expect(bootstrap).toContain("config: () => withResearchBetaFolder(loadConfig({ appPath: app.getAppPath(), userDataPath }), userDataFolder),");
    expect(bootstrap.match(/\bloadConfig\(/gu)).toHaveLength(3);
    // The quit offer asks the general-task controller whether a research stage is in progress (backlog item 13a, part 3).
    expect(bootstrap).toContain("researchStageRunning: () => generalTasks?.researchStageRunning() ?? false,");
  });

  it("creates the renderer shell, installs required IPC authority, then loads", () => {
    const bootstrap = readFileSync(
      path.join(projectRoot, "src/main/bootstrap.ts"),
      "utf8",
    );
    const createWindow = bootstrap.indexOf(
      "mainWindow = createWindowShell(rendererTarget, preloadPath)",
    );
    const register = bootstrap.indexOf("registerIpcHandlers({");
    const load = bootstrap.indexOf("await loadRenderer(initialWindow");
    expect(createWindow).toBeGreaterThanOrEqual(0);
    expect(register).toBeGreaterThan(createWindow);
    expect(load).toBeGreaterThan(register);
    expect(bootstrap).toContain("credentialIpcAuthority,");
    expect(bootstrap).toContain("applicationPath: app.getAppPath()");
    expect(bootstrap).toContain(
      "const preloadPath = resolvePreloadPath(app.getAppPath())",
    );
    expect(bootstrap).not.toContain("__dirname");
  });

  it("recovers one production credential journal before exposing status or a window", () => {
    const bootstrap = readFileSync(
      path.join(projectRoot, "src/main/bootstrap.ts"),
      "utf8",
    );
    const journal = bootstrap.indexOf(
      "const credentialOperationJournal = new CredentialOperationJournal(database)",
    );
    const recover = bootstrap.indexOf(
      "credentialOperationJournal.recoverAfterRestart()",
    );
    const status = bootstrap.indexOf("new CloudCredentialStatusService(");
    const fixtureGate = bootstrap.indexOf(
      "withFakeCredentialOperationStatus({",
    );
    const createWindow = bootstrap.indexOf(
      "mainWindow = createWindowShell(rendererTarget, preloadPath)",
    );

    expect(journal).toBeGreaterThanOrEqual(0);
    expect(recover).toBeGreaterThan(journal);
    expect(status).toBeGreaterThan(recover);
    expect(fixtureGate).toBeGreaterThan(status);
    expect(createWindow).toBeGreaterThan(fixtureGate);
    expect(bootstrap).toContain(
      "credentialAuthority,\n      credentialOperationJournal,",
    );
    expect(bootstrap.match(/new CredentialOperationJournal\(/gu)).toHaveLength(1);
  });
});
