import asar from "@electron/asar";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  FORBIDDEN_LOCKED_NATIVE_ACTIVATION_SYMBOLS,
  LOCKED_NATIVE_BINARY,
  LOCKED_NATIVE_MANIFEST,
  LOCKED_NATIVE_PACKAGE_MANIFEST,
  PHASE_B_AD_HOC_ENTITLEMENT,
  PHASE_B_ALLOW_JIT_CODE_PATHS,
  PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES,
  SEALED_MAIN_ENTRY,
  SEALED_PRELOAD_ENTRY,
  SEALED_RENDERER_ENTRY,
  assertLockedArchiveEntries,
  assertLockedNativeInspection,
  assertPhaseBAdHocCodeEntitlements,
  assertRendererBundleLocked,
  parseLockedFlavorManifest,
} from "../../scripts/locked-credential-package-policy.mjs";
import { packagedOutputText } from "../../scripts/verify-locked-mac-package.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");

const manifest = JSON.stringify({
  schemaVersion: "soar-native-credential-package-v1",
  flavor: "locked",
  protectedItemLocator: false,
  syntheticItemLocator: false,
  secureEntry: false,
  mutation: false,
  consumer: false,
});

describe("locked credential package policy", () => {
  it("requires one locked unpacked broker manifest and excludes native sources", () => {
    expect(() =>
      assertLockedArchiveEntries([
        `/${LOCKED_NATIVE_BINARY}`,
        `/${LOCKED_NATIVE_MANIFEST}`,
        `/${LOCKED_NATIVE_PACKAGE_MANIFEST}`,
        `/${SEALED_MAIN_ENTRY}`,
        `/${SEALED_PRELOAD_ENTRY}`,
        `/${SEALED_RENDERER_ENTRY}`,
      ]),
    ).not.toThrow();
    expect(() => assertLockedArchiveEntries([LOCKED_NATIVE_MANIFEST])).toThrow(
      /missing/u,
    );
    expect(() =>
      assertLockedArchiveEntries([
        LOCKED_NATIVE_BINARY,
        LOCKED_NATIVE_MANIFEST,
        LOCKED_NATIVE_PACKAGE_MANIFEST,
        SEALED_MAIN_ENTRY,
        SEALED_PRELOAD_ENTRY,
        SEALED_RENDERER_ENTRY,
        "node_modules/@soar/macos-credential-lease/src/secure-zero.hpp",
      ]),
    ).toThrow(/source leaked/u);
    expect(() =>
      assertLockedArchiveEntries([
        LOCKED_NATIVE_BINARY,
        LOCKED_NATIVE_MANIFEST,
        LOCKED_NATIVE_PACKAGE_MANIFEST,
        SEALED_MAIN_ENTRY,
        SEALED_PRELOAD_ENTRY,
        SEALED_RENDERER_ENTRY,
        "node_modules/@soar/macos-credential-lease/bin/darwin-arm64-143/macos-credential-lease.node",
      ]),
    ).toThrow(/unexpected native addon/iu);
  });

  it("accepts only the exact locked flavor manifest", () => {
    expect(parseLockedFlavorManifest(manifest)).toMatchObject({
      flavor: "locked",
      mutation: false,
      consumer: false,
    });
    expect(() =>
      parseLockedFlavorManifest(
        JSON.stringify({ ...JSON.parse(manifest), mutation: true }),
      ),
    ).toThrow(/exact locked/u);
    expect(() =>
      parseLockedFlavorManifest(
        JSON.stringify({ ...JSON.parse(manifest), extra: false }),
      ),
    ).toThrow(/exact locked/u);
  });

  it("rejects retired renderer mutations and native activation surfaces", () => {
    expect(() => assertRendererBundleLocked("soar:get-cloud-credential-status")).not.toThrow();
    expect(() => assertRendererBundleLocked("soar:save-cloud-credential")).toThrow(
      /mutation survived/u,
    );
    for (const identity of Object.values(
      PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES,
    )) {
      expect(() => assertRendererBundleLocked(identity)).toThrow(
        /development-canary marker survived packaging/iu,
      );
    }
    expect(() =>
      assertLockedNativeInspection({
        symbols: "_SecItemCopyMatching\n",
        strings: "locked\n",
      }),
    ).not.toThrow();
    expect(() =>
      assertLockedNativeInspection({
        symbols: "_SecItemCopyMatching\n_SecItemAdd\n",
        strings: "locked\n",
      }),
    ).toThrow(/forbidden mutation symbol/u);
    expect(() =>
      assertLockedNativeInspection({
        symbols: "_SecItemCopyMatching\n",
        strings: "NSSecureTextField\n",
      }),
    ).toThrow(/forbidden activation marker/u);

    for (const symbol of FORBIDDEN_LOCKED_NATIVE_ACTIVATION_SYMBOLS) {
      expect(() =>
        assertLockedNativeInspection({
          symbols: `_SecItemCopyMatching\n${symbol}\n`,
          strings: "locked\n",
        }),
      ).toThrow(
        new RegExp(
          `forbidden activation symbol: ${symbol.replaceAll("$", "\\$")}`,
          "u",
        ),
      );
    }

    expect(() =>
      assertLockedNativeInspection({
        symbols: "_SecItemCopyMatchingExtended\n",
        strings: "locked\n",
      }),
    ).toThrow(/missing its permitted legacy metadata query/u);
    expect(() =>
      assertLockedNativeInspection({
        symbols: "_SecItemCopyMatching\n_SecItemAddExtended\n",
        strings: "locked\n",
      }),
    ).not.toThrow();
  });

  it("scans packaged output artifacts regardless of filename extension", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "soar-packaged-output-scan-"),
    );
    const sourceRoot = path.join(temporaryRoot, "source");
    const archivePath = path.join(temporaryRoot, "app.asar");
    try {
      await mkdir(path.join(sourceRoot, "out", "main"), { recursive: true });
      await writeFile(
        path.join(sourceRoot, "out", "main", "hidden-runtime.mjs"),
        "SOAR_PR6R_DEVELOPMENT_CANARY_V1",
        "utf8",
      );
      await asar.createPackage(sourceRoot, archivePath);
      const entries = asar.listPackage(archivePath, { isPack: false });
      expect(packagedOutputText(archivePath, entries)).toContain(
        "SOAR_PR6R_DEVELOPMENT_CANARY_V1",
      );

      const linkedArchivePath = path.join(temporaryRoot, "linked.asar");
      await symlink(
        "hidden-runtime.mjs",
        path.join(sourceRoot, "out", "main", "unsupported-link"),
      );
      await asar.createPackage(sourceRoot, linkedArchivePath);
      expect(() =>
        packagedOutputText(
          linkedArchivePath,
          asar.listPackage(linkedArchivePath, { isPack: false }),
        ),
      ).toThrow(/unsupported symbolic link/iu);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects declared ASAR size overruns before extracting any output", () => {
    const statSpy = vi.spyOn(asar, "statFile");
    const extractSpy = vi.spyOn(asar, "extractFile");
    try {
      statSpy.mockImplementation((_archivePath, entry) => {
        const normalized = entry.replace(/^[/\\]+/u, "");
        const size = normalized.endsWith("oversized.bin")
          ? 16 * 1024 * 1024 + 1
          : 1;
        return { size } as ReturnType<typeof asar.statFile>;
      });
      extractSpy.mockImplementation(() => {
        throw new Error("extractFile must not run after a preflight denial");
      });

      expect(() =>
        packagedOutputText("unused.asar", ["/out/main/oversized.bin"]),
      ).toThrow(/packaged source exceeds its verifier bound/iu);
      expect(extractSpy).not.toHaveBeenCalled();

      statSpy.mockImplementation(() => ({
        size: 16 * 1024 * 1024,
      }) as ReturnType<typeof asar.statFile>);
      expect(() =>
        packagedOutputText("unused.asar", [
          "/out/main/a.bin",
          "/out/main/b.bin",
          "/out/main/c.bin",
          "/out/main/d.bin",
          "/out/main/e.bin",
        ]),
      ).toThrow(/packaged output inspection exceeded its byte bound/iu);
      expect(extractSpy).not.toHaveBeenCalled();
    } finally {
      statSpy.mockRestore();
      extractSpy.mockRestore();
    }
  });

  it("allows exactly allow-jit on the bounded Phase-B Electron executables", async () => {
    const entitlementsXml = await readFile(
      path.join(
        projectRoot,
        "build",
        "entitlements.phase-b.ad-hoc.plist",
      ),
      "utf8",
    );
    expect(PHASE_B_AD_HOC_ENTITLEMENT).toBe(
      "com.apple.security.cs.allow-jit",
    );
    expect(PHASE_B_ALLOW_JIT_CODE_PATHS).toHaveLength(7);
    for (const relativePath of PHASE_B_ALLOW_JIT_CODE_PATHS) {
      expect(() =>
        assertPhaseBAdHocCodeEntitlements({
          relativePath,
          entitlementsXml,
        }),
      ).not.toThrow();
    }

    expect(() =>
      assertPhaseBAdHocCodeEntitlements({
        relativePath: "Contents/Frameworks/unknown-helper",
        entitlementsXml: "",
      }),
    ).not.toThrow();
    expect(() =>
      assertPhaseBAdHocCodeEntitlements({
        relativePath: PHASE_B_ALLOW_JIT_CODE_PATHS[0],
        entitlementsXml: "",
      }),
    ).toThrow(/exact allow-jit-only/u);
    expect(() =>
      assertPhaseBAdHocCodeEntitlements({
        relativePath: "Contents/Frameworks/unknown-helper",
        entitlementsXml,
      }),
    ).toThrow(/unexpected Phase-B code-signing entitlement/iu);
    expect(() =>
      assertPhaseBAdHocCodeEntitlements({
        relativePath: PHASE_B_ALLOW_JIT_CODE_PATHS[0],
        entitlementsXml: entitlementsXml.replace(
          "</dict>",
          "<key>com.apple.security.cs.disable-library-validation</key><true/></dict>",
        ),
      }),
    ).toThrow(/exact allow-jit-only/u);
    expect(() =>
      assertPhaseBAdHocCodeEntitlements({
        relativePath: PHASE_B_ALLOW_JIT_CODE_PATHS[0],
        entitlementsXml: entitlementsXml.replace("<true/>", "<false/>"),
      }),
    ).toThrow(/exact allow-jit-only/u);
  });
});
