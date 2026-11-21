import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Backlog item 13a, requirement A: the real src/main/index.ts, loaded under a fake Electron app that records its calls in order.
 * The fake keeps the app's paths, so a moved folder is what the lock and bootstrap then see.
 */
interface Fake { calls: string[]; paths: Record<string, string>; setPath: "move" | "hold" | "throw"; bootstrap: ReturnType<typeof vi.fn> }
let fake: Fake;
const cleanups: (() => void)[] = [];
const saved = { flag: process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA, review: process.env.SOAR_ENABLE_DOCUMENT_REVIEW_BETA, envFile: process.env.SOAR_ENV_FILE };
afterEach(() => {
  vi.restoreAllMocks(); vi.doUnmock("electron"); vi.doUnmock("../../src/main/bootstrap"); vi.resetModules();
  for (const [name, value] of [["SOAR_ENABLE_LOCAL_RESEARCH_BETA", saved.flag], ["SOAR_ENABLE_DOCUMENT_REVIEW_BETA", saved.review], ["SOAR_ENV_FILE", saved.envFile]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  for (const step of cleanups.splice(0).reverse()) step();
});

/** A checkout (the app path and the working directory) and an app-data folder holding the default user-data folder "SOAR". */
function machine(): { checkout: string; home: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "soar-main-folder-"))); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, "checkout"), home = join(root, "AppData", "SOAR");
  mkdirSync(checkout); mkdirSync(home, { recursive: true });
  return { checkout, home };
}

async function start(checkout: string, home: string, setPath: Fake["setPath"] = "move"): Promise<Fake> {
  fake = { calls: [], paths: { app: checkout, userData: home, sessionData: home }, setPath, bootstrap: vi.fn(async () => ({ close: async () => {}, busy: () => false })) };
  vi.spyOn(process, "cwd").mockReturnValue(checkout);
  vi.resetModules();
  vi.doMock("electron", () => ({
    app: {
      getAppPath: () => fake.paths.app,
      getPath: (name: string) => fake.paths[name],
      setPath: (name: string, value: string) => {
        fake.calls.push(`setPath ${name}`);
        // As Electron documents, setPath throws for a folder that does not exist.
        if (fake.setPath === "throw" || !existsSync(value)) throw new Error("setPath refused");
        if (fake.setPath === "move") fake.paths[name] = value;
      },
      requestSingleInstanceLock: () => { fake.calls.push(`lock in ${fake.paths.userData}`); return true; },
      on: () => undefined,
      whenReady: () => Promise.resolve(),
      quit: () => { fake.calls.push("quit"); },
    },
    BrowserWindow: { getAllWindows: () => [] },
    dialog: { showErrorBox: (_title: string, content: string) => { fake.calls.push(`error ${content}`); } },
  }));
  vi.doMock("../../src/main/bootstrap", () => ({ bootstrap: fake.bootstrap }));
  await import("../../src/main/index");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return fake;
}

describe("the main process chooses its user-data folder before the single-instance lock (backlog item 13a, requirement A)", () => {
  it("keeps the default folder without the flag, or with it only in the default folder's own settings", async () => {
    const { checkout, home } = machine();
    delete process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA; delete process.env.SOAR_ENV_FILE;
    writeFileSync(join(home, ".env.local"), "SOAR_ENABLE_LOCAL_RESEARCH_BETA=true\n");
    const run = await start(checkout, home);
    expect(run.calls).toEqual([`lock in ${home}`]);
    // bootstrap gets the default folder, and its own check refuses the flag found there before the database opens.
    expect(run.bootstrap).toHaveBeenCalledWith({ userDataFolder: { kind: "default" } });
  });

  it("moves to the beta folder before the lock when the checkout's own .env.local, or the environment, turns the beta on", async () => {
    for (const where of ["checkout", "environment"] as const) {
      const { checkout, home } = machine(), beta = `${home} Research Beta`;
      delete process.env.SOAR_ENV_FILE;
      if (where === "checkout") { delete process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA; writeFileSync(join(checkout, ".env.local"), "SOAR_ENABLE_LOCAL_RESEARCH_BETA=true\n"); }
      else process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA = "true";
      const run = await start(checkout, home);
      expect(run.calls, where).toEqual(["setPath userData", "setPath sessionData", `lock in ${beta}`]);
      expect(run.paths).toMatchObject({ userData: beta, sessionData: beta });
      expect(run.bootstrap).toHaveBeenCalledWith({ userDataFolder: { kind: "beta", path: beta } });
    }
  });

  it("takes no lock and starts nothing when the flag is malformed, the beta folder resolves to the default one, or the move does not hold", async () => {
    const cases: [string, (checkout: string, home: string) => void, Fake["setPath"], RegExp][] = [
      ["malformed", () => { process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA = "yes"; }, "move", /must be true or false/u],
      ["linked to the default", (_checkout, home) => { process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA = "true"; symlinkSync(home, `${home} Research Beta`); }, "move", /resolves to the default user-data folder/u],
      ["the move does not hold", () => { process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA = "true"; }, "hold", /could not move to its own user-data folder/u],
      ["setPath throws", () => { process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA = "true"; }, "throw", /could not move to its own user-data folder/u],
      ["the database links out", (_checkout, home) => { process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA = "true"; mkdirSync(`${home} Research Beta`); symlinkSync(join(home, "soar.sqlite"), join(`${home} Research Beta`, "soar.sqlite")); }, "move", /soar\.sqlite leads out of its own user-data folder/u],
      ["unreadable settings", checkout => { delete process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA; mkdirSync(join(checkout, ".env.local")); }, "move", /could not read the settings/u],
    ];
    for (const [name, arrange, setPath, reason] of cases) {
      const { checkout, home } = machine();
      delete process.env.SOAR_ENV_FILE; arrange(checkout, home);
      const run = await start(checkout, home, setPath);
      expect(run.calls.some(call => call.startsWith("lock")), name).toBe(false);
      expect(run.calls.find(call => call.startsWith("error")), name).toMatch(reason);
      expect(run.calls.at(-1), name).toBe("quit");
      expect(run.bootstrap, name).not.toHaveBeenCalled();
    }
  });

  it("moves to the same beta folder for the document review flag alone, and refuses a malformed one by name (backlog item 13b, part 4)", async () => {
    for (const where of ["checkout", "environment"] as const) {
      const { checkout, home } = machine(), beta = `${home} Research Beta`;
      delete process.env.SOAR_ENV_FILE; delete process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA; delete process.env.SOAR_ENABLE_DOCUMENT_REVIEW_BETA;
      if (where === "checkout") writeFileSync(join(checkout, ".env.local"), "SOAR_ENABLE_DOCUMENT_REVIEW_BETA=true\n");
      else process.env.SOAR_ENABLE_DOCUMENT_REVIEW_BETA = "true";
      const run = await start(checkout, home);
      expect(run.calls, where).toEqual(["setPath userData", "setPath sessionData", `lock in ${beta}`]);
      expect(run.bootstrap).toHaveBeenCalledWith({ userDataFolder: { kind: "beta", path: beta } });
    }
    const { checkout, home } = machine();
    delete process.env.SOAR_ENV_FILE; delete process.env.SOAR_ENABLE_LOCAL_RESEARCH_BETA; process.env.SOAR_ENABLE_DOCUMENT_REVIEW_BETA = "yes";
    const run = await start(checkout, home);
    expect(run.calls.some(call => call.startsWith("lock"))).toBe(false);
    expect(run.calls.find(call => call.startsWith("error"))).toMatch(/SOAR_ENABLE_DOCUMENT_REVIEW_BETA must be true or false/u);
    expect(run.bootstrap).not.toHaveBeenCalled();
  });
});
