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
