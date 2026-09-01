import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");

describe("packaged credential-status canary contract", () => {
  it("keeps the live proof local, hostile-override aware, bounded, and mutation-free", async () => {
    const source = await readFile(
      path.join(
        projectRoot,
        "tests",
        "e2e",
        "packaged-credential-status.spec.ts",
      ),
      "utf8",
    );

    expect(source).toContain('SOAR_PROVIDER_MODE: "local"');
    expect(source).toContain("ELECTRON_RENDERER_URL:");
    expect(source).toContain('SOAR_VLLM_BASE_URL: `${trap.origin}/v1`');
    expect(source).toContain("expect(trap.requests).toEqual([])");
    expect(source).toContain(
      'page.getByText("Signed setup is not available in this build"',
    );
    expect(source).toContain("STATUS_COMPLETION_TIMEOUT_MS = 8_000");
    expect(source).toContain('input[type="password"]');
    expect(source).toContain("/save|replace|delete|remove/u");
    expect(source).toContain("packagedExecutable === undefined");
    expect(source).not.toContain("SOAR_TEST_CREDENTIAL_OPERATION_STATE");
    expect(source).not.toContain('SOAR_PROVIDER_MODE: "fake"');
  });

  it("extracts the fixed archive to temporary storage and runs only the canary spec", async () => {
    const [source, packageJson] = await Promise.all([
      readFile(
        path.join(
          projectRoot,
          "scripts",
          "run-packaged-credential-status-canary.mjs",
        ),
        "utf8",
      ),
      readFile(path.join(projectRoot, "package.json"), "utf8"),
    ]);

    expect(source).toContain('"dist", "SOAR-mac-arm64.zip"');
    expect(source).toContain('"/usr/bin/ditto"');
    expect(source).toContain('"-x", "-k"');
    expect(source).toContain(
      'const canarySpec = "tests/e2e/packaged-credential-status.spec.ts"',
    );
    expect(source).toContain("run-electron-e2e.mjs");
    expect(source).toContain("SOAR_E2E_EXECUTABLE: executablePath");
    expect(source).toContain(
      "await rm(extractionRoot, { recursive: true, force: true })",
    );
    expect(source).not.toContain("package:mac");
    expect(JSON.parse(packageJson).scripts).toMatchObject({
      "test:e2e:packaged-credential-status":
        "node scripts/run-packaged-credential-status-canary.mjs",
    });
  });
});
