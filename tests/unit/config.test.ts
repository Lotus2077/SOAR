import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/main/config";

const temporaryDirectories: string[] = [];

async function createConfigRoots(): Promise<{
  root: string;
  appPath: string;
  cwd: string;
  userDataPath: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "soar-config-"));
  temporaryDirectories.push(root);
  const appPath = path.join(root, "app");
  const cwd = path.join(root, "cwd");
  const userDataPath = path.join(root, "user-data");
  await Promise.all([
    mkdir(appPath, { recursive: true }),
    mkdir(cwd, { recursive: true }),
    mkdir(userDataPath, { recursive: true }),
  ]);
  return { root, appPath, cwd, userDataPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("loadConfig", () => {
  it("loads Finder configuration from userData before cwd and app files", async () => {
    const roots = await createConfigRoots();
    await Promise.all([
      writeFile(
        path.join(roots.userDataPath, ".env.local"),
        [
          "SOAR_VLLM_BASE_URL=https://user-data.example/v1",
          "SOAR_VLLM_MODEL=user-data-model",
          "SOAR_DB_PATH=/tmp/user-data.sqlite",
        ].join("\n"),
      ),
      writeFile(
        path.join(roots.cwd, ".env.local"),
        [
          "SOAR_VLLM_BASE_URL=https://cwd.example/v1",
          "SOAR_VLLM_MODEL=cwd-model",
        ].join("\n"),
      ),
      writeFile(
        path.join(roots.appPath, ".env"),
        [
          "SOAR_VLLM_BASE_URL=https://app.example/v1",
          "SOAR_VLLM_MODEL=app-model",
        ].join("\n"),
      ),
    ]);

    const config = loadConfig({
      appPath: roots.appPath,
      cwd: roots.cwd,
      userDataPath: roots.userDataPath,
      environment: {},
    });

    expect(config.vllm).toMatchObject({
      baseUrl: "https://user-data.example/v1",
      model: "user-data-model",
      costPolicy: "local_zero_cost",
    });
    expect(config.databasePath).toBe("/tmp/user-data.sqlite");
    expect(config.context).toEqual({
      maxInputTokens: 16_384,
      safetyMargin: 0.2,
    });
  });

  it("keeps explicit process environment values authoritative", async () => {
    const roots = await createConfigRoots();
    await writeFile(
      path.join(roots.userDataPath, ".env.local"),
      [
        "SOAR_VLLM_BASE_URL=https://user-data.example/v1",
        "SOAR_VLLM_MODEL=user-data-model",
      ].join("\n"),
    );

    const environment = {
      SOAR_VLLM_BASE_URL: "https://explicit.example/v1",
      SOAR_VLLM_MODEL: "explicit-model",
    };
    const config = loadConfig({
      ...roots,
      environment,
    });

    expect(config.vllm).toMatchObject({
      baseUrl: "https://explicit.example/v1",
      model: "explicit-model",
    });
    expect(environment).toEqual({
      SOAR_VLLM_BASE_URL: "https://explicit.example/v1",
      SOAR_VLLM_MODEL: "explicit-model",
    });
  });

  it("honors SOAR_ENV_FILE ahead of the default file locations", async () => {
    const roots = await createConfigRoots();
    const explicitFile = path.join(roots.root, "explicit.env");
    await Promise.all([
      writeFile(
        explicitFile,
        [
          "SOAR_VLLM_BASE_URL=https://explicit-file.example/v1",
          "SOAR_VLLM_MODEL=explicit-file-model",
        ].join("\n"),
      ),
      writeFile(
        path.join(roots.userDataPath, ".env.local"),
        [
          "SOAR_VLLM_BASE_URL=https://user-data.example/v1",
          "SOAR_VLLM_MODEL=user-data-model",
        ].join("\n"),
      ),
    ]);

    const config = loadConfig({
      ...roots,
      environment: { SOAR_ENV_FILE: explicitFile },
    });

    expect(config.vllm).toMatchObject({
      baseUrl: "https://explicit-file.example/v1",
      model: "explicit-file-model",
    });
  });

  it("loads and validates the provider-neutral context budget", async () => {
    const roots = await createConfigRoots();
    const config = loadConfig({
      ...roots,
      environment: {
        SOAR_VLLM_BASE_URL: "https://context.example/v1",
        SOAR_VLLM_MODEL: "context-model",
        SOAR_CONTEXT_MAX_INPUT_TOKENS: "16384",
        SOAR_CONTEXT_SAFETY_MARGIN: "0.25",
      },
    });

    expect(config.context).toEqual({
      maxInputTokens: 16_384,
      safetyMargin: 0.25,
    });

    expect(() =>
      loadConfig({
        ...roots,
        environment: {
          SOAR_VLLM_BASE_URL: "https://context.example/v1",
          SOAR_VLLM_MODEL: "context-model",
          SOAR_CONTEXT_MAX_INPUT_TOKENS: "1024",
        },
      }),
    ).toThrow();
  });

  it("rejects an unknown local cost-accounting policy", async () => {
    const roots = await createConfigRoots();
    expect(() =>
      loadConfig({
        ...roots,
        environment: {
          SOAR_VLLM_BASE_URL: "https://context.example/v1",
          SOAR_VLLM_MODEL: "context-model",
          SOAR_VLLM_COST_POLICY: "trust-me-zero",
        },
      }),
    ).toThrow();
  });

  it("requires an HTTP(S) vLLM API base at the exact /v1 path", async () => {
    const roots = await createConfigRoots();
    const baseEnvironment = {
      SOAR_VLLM_MODEL: "endpoint-contract-model",
    };

    expect(() =>
      loadConfig({
        ...roots,
        environment: {
          ...baseEnvironment,
          SOAR_VLLM_BASE_URL: "ftp://example.invalid/v1",
        },
      }),
    ).toThrow(/must use HTTP or HTTPS/);

    expect(() =>
      loadConfig({
        ...roots,
        environment: {
          ...baseEnvironment,
          SOAR_VLLM_BASE_URL: "https://example.invalid/v1/models",
        },
      }),
    ).toThrow(/must be the exact \/v1 API base/);

    expect(
      loadConfig({
        ...roots,
        environment: {
          ...baseEnvironment,
          SOAR_VLLM_BASE_URL: "https://example.invalid/v1",
        },
      }).vllm.baseUrl,
    ).toBe("https://example.invalid/v1");
  });
});
