import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_LOCKED_NATIVE_ACTIVATION_SYMBOLS,
  LOCKED_NATIVE_BINARY,
  LOCKED_NATIVE_MANIFEST,
  LOCKED_NATIVE_PACKAGE_MANIFEST,
  PHASE_B_AD_HOC_ENTITLEMENT,
  PHASE_B_ALLOW_JIT_CODE_PATHS,
  SEALED_MAIN_ENTRY,
  SEALED_PRELOAD_ENTRY,
  SEALED_RENDERER_ENTRY,
  assertLockedArchiveEntries,
  assertLockedNativeInspection,
  assertPhaseBAdHocCodeEntitlements,
  assertRendererBundleLocked,
  parseLockedFlavorManifest,
} from "../../scripts/locked-credential-package-policy.mjs";

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
