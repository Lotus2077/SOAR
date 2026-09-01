import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";

const STATUS_COMPLETION_TIMEOUT_MS = 8_000;
const packagedExecutable = process.env.SOAR_E2E_EXECUTABLE;

interface HttpTrap {
  readonly origin: string;
  readonly requests: ReadonlyArray<{ method: string; url: string }>;
  close(): Promise<void>;
}

function definedProcessEnvironment(): Record<string, string> {
  const allowed = new Set([
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TMPDIR",
    "USER",
  ]);
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (allowed.has(name) && value !== undefined) environment[name] = value;
  }
  return environment;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

async function startHttpTrap(): Promise<HttpTrap> {
  const requests: Array<{ method: string; url: string }> = [];
  const record = (method: string | undefined, url: string | undefined): void => {
    if (requests.length >= 32) return;
    requests.push({
      method: (method ?? "UNKNOWN").slice(0, 16),
      url: (url ?? "/").slice(0, 2_048),
    });
  };
  const server = createServer((request, response) => {
    record(request.method, request.url);
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("SOAR packaged canary HTTP trap\n");
  });
  server.on("upgrade", (request, socket) => {
    record(request.method, request.url);
    socket.destroy();
  });
  await listen(server);
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

test("packaged ad-hoc app reports locked native credential status without provider traffic", async () => {
  test.skip(process.platform !== "darwin", "The packaged credential canary requires macOS.");
  test.skip(
    packagedExecutable === undefined,
    "Set SOAR_E2E_EXECUTABLE through the archive-extracting wrapper.",
  );
  if (packagedExecutable === undefined) return;
  test.setTimeout(30_000);

  const testRoot = await mkdtemp(
    path.join(tmpdir(), "soar-packaged-credential-canary-"),
  );
  const userDataPath = path.join(testRoot, "user-data");
  await mkdir(userDataPath);
  const trap = await startHttpTrap();
  let electronApp: ElectronApplication | undefined;

  try {
    electronApp = await electron.launch({
      executablePath: packagedExecutable,
      args: [`--user-data-dir=${userDataPath}`],
      cwd: testRoot,
      env: {
        ...definedProcessEnvironment(),
        ELECTRON_RENDERER_URL: `${trap.origin}/hostile-renderer/`,
        SOAR_PROVIDER_MODE: "local",
        SOAR_ENABLE_HYBRID_SIMULATION: "false",
        SOAR_HYBRID_SIMULATION_FAKE_CLOUD_SCENARIO: "success",
        SOAR_FAKE_DELAY_MS: "12",
        SOAR_VLLM_BASE_URL: `${trap.origin}/v1`,
        SOAR_VLLM_API_KEY: "",
        SOAR_VLLM_MODEL: "packaged-canary-local-model",
        SOAR_VLLM_COST_POLICY: "local_zero_cost",
        SOAR_ALLOW_INSECURE_VLLM_HTTP: "false",
        SOAR_DB_PATH: path.join(testRoot, "soar-canary.sqlite"),
        SOAR_MAX_INFERENCE_ROUNDS: "24",
        SOAR_MAX_TOOL_CALLS: "24",
        SOAR_MAX_OUTPUT_TOKENS: "8192",
        SOAR_REQUEST_TIMEOUT_MS: "1000",
        SOAR_CONTEXT_MAX_INPUT_TOKENS: "18432",
        SOAR_CONTEXT_SAFETY_MARGIN: "0.2",
      },
    });
    const page = await electronApp.firstWindow();

    // Reaching the sealed SOAR renderer proves that a packaged build ignored
    // the hostile development override instead of contacting the HTTP trap.
    const trigger = page.getByRole("button", {
      name: "Manage cloud credential",
    });
    await expect(trigger).toBeVisible();
    await trigger.click();

    // No interaction occurs while native status is pending. The exact ad-hoc
    // headline distinguishes a loaded Electron-ABI addon/native identity
    // response from the Fake or native-unavailable fallback projections.
    await expect(
      page.getByText("Signed setup is not available in this build", {
        exact: true,
      }),
    ).toBeVisible({ timeout: STATUS_COMPLETION_TIMEOUT_MS });
    await expect(
      page.getByRole("heading", { name: "Cloud credential" }),
    ).toBeFocused();
    await expect(page.getByText("Not run", { exact: true })).toBeVisible();
    await expect(page.getByText("Locked", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "OpenRouter was not contacted by this credential operation.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /save|replace|delete|remove/u }),
    ).toHaveCount(0);

    await page.waitForTimeout(250);
    expect(trap.requests).toEqual([]);
    await electronApp.close();
    electronApp = undefined;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(trap.requests).toEqual([]);
  } finally {
    if (electronApp !== undefined) await electronApp.close();
    await trap.close();
    await rm(testRoot, { recursive: true, force: true });
  }
});
