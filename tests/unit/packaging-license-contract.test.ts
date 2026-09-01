import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");

function resourceMap(config: string): Map<string, string> {
  return new Map(
    [...config.matchAll(/^\s*- from: ([^\n]+)\n\s+to: ([^\n]+)$/gmu)].map(
      (match) => [match[1]!.trim(), match[2]!.trim()],
    ),
  );
}

describe("macOS packaging license contract", () => {
  it("declares project, Electron, and Chromium licenses under distinct names", () => {
    const builderConfig = readFileSync(
      path.join(projectRoot, "electron-builder.yml"),
      "utf8",
    );
    const resources = resourceMap(builderConfig);

    expect(resources.get("LICENSE")).toBe("LICENSE");
    expect(resources.get("node_modules/electron/dist/LICENSE")).toBe(
      "LICENSE.electron.txt",
    );
    expect(
      resources.get("node_modules/electron/dist/LICENSES.chromium.html"),
    ).toBe("LICENSES.chromium.html");
    expect(new Set(resources.values()).size).toBe(resources.size);

    expect(
      statSync(path.join(projectRoot, "node_modules/electron/dist/LICENSE")).size,
    ).toBeGreaterThan(0);
    expect(
      statSync(
        path.join(
          projectRoot,
          "node_modules/electron/dist/LICENSES.chromium.html",
        ),
      ).size,
    ).toBeGreaterThan(0);

    const notices = readFileSync(
      path.join(projectRoot, "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    expect(notices).toContain("not an exhaustive generated SBOM");
    expect(notices).toContain("`LICENSE.electron.txt`");
    expect(notices).toContain("`LICENSES.chromium.html`");

    const packageScript = readFileSync(
      path.join(projectRoot, "scripts/package-mac.mjs"),
      "utf8",
    );
    for (const resourceName of [
      "LICENSE",
      "LICENSE.electron.txt",
      "LICENSES.chromium.html",
      "THIRD_PARTY_NOTICES.md",
    ]) {
      expect(packageScript).toContain(`"${resourceName}"`);
    }
    expect(packageScript).toContain("metadata.size === 0");
    expect(packageScript).toContain("verifyLockedMacPackage");

    expect(notices).toContain("`@electron/asar` version 3.4.1");
    expect(
      JSON.parse(
        readFileSync(path.join(projectRoot, "package.json"), "utf8"),
      ).devDependencies["@electron/asar"],
    ).toBe("3.4.1");
  });
});
