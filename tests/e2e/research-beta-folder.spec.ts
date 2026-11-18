import { existsSync, readdirSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const projectRoot = path.resolve(import.meta.dirname, "../..");

/**
 * Backlog item 13a, requirement A, in the real app: started the plain way with the beta flag on, the app's user-data and session
 * folders are the beta's own, which holds the database and the lock, and the folder it would otherwise use stays absent or empty.
 * `--user-data-dir` stands for the default folder, so the run never touches the owner's. No model, Docker or network is used.
 */
test("the local research beta starts in its own user-data folder and leaves the default one untouched", async ({}, testInfo) => {
  test.skip(process.env.SOAR_RUN_RESEARCH_BETA_FOLDER_E2E !== "true", "Launches the built app with a window: run `pnpm build` first.");
  test.skip(existsSync(path.join(projectRoot, ".env.local")) || existsSync(path.join(projectRoot, ".env")), "The checkout's own .env.local or .env would change the run.");
  const root = realpathSync(await mkdtemp(path.join(tmpdir(), "soar-beta-folder-e2e-"))), home = path.join(root, "browser-data"), beta = `${home} Research Beta`;
  const env: Record<string, string> = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "DISPLAY", "XAUTHORITY"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name]!;
  }
  const app = await electron.launch({ ...(process.env.SOAR_E2E_EXECUTABLE ? { executablePath: process.env.SOAR_E2E_EXECUTABLE } : {}),
    args: [`--user-data-dir=${home}`, ...(process.env.SOAR_E2E_EXECUTABLE ? [] : [projectRoot])], cwd: projectRoot, timeout: 30000,
    env: { ...env, SOAR_PROVIDER_MODE: "fake", SOAR_ENABLE_HYBRID_SIMULATION: "false", SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1", SOAR_ENABLE_LOCAL_RESEARCH_BETA: "true" } });
  try {
    // Evaluate only once the first window exists (Playwright's handle to the main process comes from its first context).
    await app.firstWindow({ timeout: 30000 });
    // The normal start shows exactly one window: no second window, and no start-up box before it.
    expect(app.windows()).toHaveLength(1);
    expect(await app.evaluate(({ app: electronApp }) => [electronApp.getPath("userData"), electronApp.getPath("sessionData")])).toEqual([beta, beta]);
    await expect.poll(() => existsSync(path.join(beta, "soar.sqlite")), { timeout: 15000 }).toBe(true);
    const left = existsSync(home) ? readdirSync(home) : [];
    await testInfo.attach("default-folder-entries.json", { body: JSON.stringify(left), contentType: "application/json" });
    expect(left).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
