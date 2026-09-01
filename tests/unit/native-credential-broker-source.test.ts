import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../native/macos-credential-lease/src/addon.mm",
  ),
  "utf8",
);

function assertPassiveLegacyMetadataQuery(candidate: string): void {
  const functionBody = /LegacyState ReadLegacyStatus\(\) \{([\s\S]*?)\n\}\n\nstruct LegacyWork/u.exec(
    candidate,
  )?.[1];
  if (functionBody === undefined) {
    throw new Error("legacy status function is missing");
  }
  const requiredStatements = [
    "CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);",
    "CFDictionarySetValue(query, kSecAttrService, service);",
    "CFDictionarySetValue(query, kSecAttrAccount, account);",
    "CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);",
    "CFDictionarySetValue(query, kSecReturnAttributes, kCFBooleanTrue);",
    "CFDictionarySetValue(query, kSecReturnData, kCFBooleanFalse);",
    "CFDictionarySetValue(query, kSecUseAuthenticationUI,\n                       kSecUseAuthenticationUIFail);",
    "if (result != nullptr) CFRelease(result);",
  ];
  for (const required of requiredStatements) {
    if (functionBody.split(required).length !== 2) {
      throw new Error(`legacy status contract is missing: ${required}`);
    }
  }
  const expectedQueryKeys = [
    "kSecClass",
    "kSecAttrService",
    "kSecAttrAccount",
    "kSecMatchLimit",
    "kSecReturnAttributes",
    "kSecReturnData",
    "kSecUseAuthenticationUI",
  ];
  const queryKeys = [...functionBody.matchAll(
    /CFDictionarySetValue\s*\(\s*query\s*,\s*([A-Za-z0-9_]+)\s*,/gu,
  )].map((match) => match[1]);
  if (
    queryKeys.length !== expectedQueryKeys.length ||
    queryKeys.some((key, index) => key !== expectedQueryKeys[index])
  ) {
    throw new Error("legacy status query contains an extra, duplicate, or reordered mutation");
  }
  if (!candidate.includes('constexpr std::string_view kLegacyService = "ai.soar.openrouter";')) {
    throw new Error("legacy status service changed");
  }
  if (!candidate.includes('constexpr std::string_view kLegacyAccount = "default";')) {
    throw new Error("legacy status account changed");
  }
  const queryIndex = functionBody.indexOf("SecItemCopyMatching(query, &result)");
  const releaseQueryIndex = functionBody.indexOf("CFRelease(query);", queryIndex);
  const releaseResultIndex = functionBody.indexOf(
    "if (result != nullptr) CFRelease(result);",
    queryIndex,
  );
  if (
    candidate.match(/\bSecItemCopyMatching\s*\(/gu)?.length !== 1 ||
    queryIndex < 0 ||
    releaseQueryIndex <= queryIndex ||
    releaseResultIndex <= releaseQueryIndex
  ) {
    throw new Error("legacy query/result release order changed");
  }
}

describe("locked native credential broker source contract", () => {
  it("serializes initialization and every broker operation on one queue", () => {
    expect(source).toMatch(
      /BrokerState\(\)[\s\S]*?dispatch_sync\(queue,[\s\S]*?initial_identity = EvaluateCurrentIdentity\(\)/u,
    );
    expect(source).toMatch(
      /EvaluateIdentityOnBrokerQueue\(\)[\s\S]*?dispatch_sync\(State\(\)\.queue,[\s\S]*?EvaluateCurrentIdentity\(\)/u,
    );
    expect(source).toMatch(
      /Capability\([\s\S]*?EvaluateIdentityOnBrokerQueue\(\)/u,
    );
    expect(source).toMatch(
      /ActivationLocked\([\s\S]*?EvaluateIdentityOnBrokerQueue\(\)/u,
    );
    expect(source).toMatch(
      /ExecuteLegacyStatus\([\s\S]*?dispatch_sync\(State\(\)\.queue,[\s\S]*?LegacyStatusAllowedForCurrentIdentity\(\)[\s\S]*?ReadLegacyStatus\(\)/u,
    );
  });

  it("returns unknown before the legacy query for an inadmissible host", () => {
    expect(source).toMatch(
      /if \(BrokerState::LegacyStatusAllowedForCurrentIdentity\(\)\) \{\s*work->result = ReadLegacyStatus\(\);\s*\}/u,
    );
    expect(source).not.toMatch(
      /ExecuteLegacyStatus\([\s\S]*?\(void\)BrokerState::EvaluateCurrentIdentity\(\);\s*work->result = ReadLegacyStatus/u,
    );
    expect(source).toContain(
      "const bool both_ad_hoc = host.ad_hoc && module.ad_hoc",
    );
    expect(source).toContain("if (entitlement != nullptr) return true;");
    expect(source).toContain("ModulePathMatchesCurrentBundle(module_path)");
    expect(source).not.toContain("EndsWith(module_path");
  });

  it("keeps the sole legacy Keychain query metadata-only and noninteractive", () => {
    expect(() => assertPassiveLegacyMetadataQuery(source)).not.toThrow();
    expect(() =>
      assertPassiveLegacyMetadataQuery(
        source.replace(
          "CFDictionarySetValue(query, kSecReturnData, kCFBooleanFalse);",
          "CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);",
        ),
      ),
    ).toThrow(/kSecReturnData/u);
    expect(() =>
      assertPassiveLegacyMetadataQuery(
        source.replace("kSecUseAuthenticationUIFail);", "kCFBooleanTrue);"),
      ),
    ).toThrow(/kSecUseAuthenticationUI/u);
    expect(() =>
      assertPassiveLegacyMetadataQuery(
        source.replace("if (result != nullptr) CFRelease(result);", ""),
      ),
    ).toThrow(/CFRelease\(result\)/u);
    for (const unsafeMutation of [
      "CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);",
      "CFDictionarySetValue(query, kSecUseAuthenticationUI, kCFBooleanTrue);",
      "CFDictionarySetValue(query, kSecReturnRef, kCFBooleanTrue);",
    ]) {
      expect(() =>
        assertPassiveLegacyMetadataQuery(
          source.replace(
            "CFTypeRef result = nullptr;",
            `${unsafeMutation}\n  CFTypeRef result = nullptr;`,
          ),
        ),
      ).toThrow(/extra, duplicate, or reordered mutation/u);
    }
    expect(() =>
      assertPassiveLegacyMetadataQuery(
        source.replace(
          "const OSStatus status = SecItemCopyMatching(query, &result);",
          "CFTypeRef second = nullptr;\n  (void)SecItemCopyMatching(query, &second);\n  const OSStatus status = SecItemCopyMatching(query, &result);",
        ),
      ),
    ).toThrow(/legacy query\/result release order changed/u);
  });
});
