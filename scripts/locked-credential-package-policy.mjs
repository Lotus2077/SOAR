export const LOCKED_NATIVE_PACKAGE_ROOT =
  "node_modules/@soar/macos-credential-lease";
export const LOCKED_NATIVE_BINARY =
  `${LOCKED_NATIVE_PACKAGE_ROOT}/build/Release/soar_macos_credential_lease.node`;
export const LOCKED_NATIVE_MANIFEST =
  `${LOCKED_NATIVE_PACKAGE_ROOT}/locked-flavor.json`;
export const LOCKED_NATIVE_PACKAGE_MANIFEST =
  `${LOCKED_NATIVE_PACKAGE_ROOT}/package.json`;
export const SEALED_MAIN_ENTRY = "out/main/index.js";
export const SEALED_PRELOAD_ENTRY = "out/preload/index.cjs";
export const SEALED_RENDERER_ENTRY = "out/renderer/index.html";
export const PHASE_B_AD_HOC_ENTITLEMENT =
  "com.apple.security.cs.allow-jit";
export const PR6R_DEVELOPMENT_CANARY_BUILD_MARKER =
  "SOAR_PR6R_DEVELOPMENT_CANARY_V1";
export const PR6R_DEVELOPMENT_CANARY_MAIN_IDENTITY =
  "SOAR_PR6R_DEVELOPMENT_CANARY_V1_MAIN_ARTIFACT_V1";
export const PR6R_DEVELOPMENT_CANARY_PRELOAD_IDENTITY =
  "SOAR_PR6R_DEVELOPMENT_CANARY_V1_PRELOAD_ARTIFACT_V1";
export const PR6R_DEVELOPMENT_CANARY_RENDERER_IDENTITY =
  "SOAR_PR6R_DEVELOPMENT_CANARY_V1_RENDERER_ARTIFACT_V1";
export const PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES = Object.freeze({
  main: PR6R_DEVELOPMENT_CANARY_MAIN_IDENTITY,
  preload: PR6R_DEVELOPMENT_CANARY_PRELOAD_IDENTITY,
  renderer: PR6R_DEVELOPMENT_CANARY_RENDERER_IDENTITY,
});

export const PR6R_DEVELOPMENT_FORBIDDEN_BUNDLE_SIGNATURES = Object.freeze([
  "AgenticExecutionPolicySchema",
  "RoutingDecisionPayloadSchema",
  "ProviderDescriptorSchema",
  "AcquireCredentialLeaseInputSchema",
  "@soar/macos-credential-lease",
  "soar:get-cloud-credential-status",
  "hybrid_simulation_v1",
  "local_only_v1",
]);

export const PHASE_B_ALLOW_JIT_CODE_PATHS = Object.freeze([
  "Contents/MacOS/SOAR",
  "Contents/Frameworks/SOAR Helper.app/Contents/MacOS/SOAR Helper",
  "Contents/Frameworks/SOAR Helper (Renderer).app/Contents/MacOS/SOAR Helper (Renderer)",
  "Contents/Frameworks/SOAR Helper (GPU).app/Contents/MacOS/SOAR Helper (GPU)",
  "Contents/Frameworks/SOAR Helper (Plugin).app/Contents/MacOS/SOAR Helper (Plugin)",
  "Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler",
  "Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt",
]);

const forbiddenBinding = `${LOCKED_NATIVE_PACKAGE_ROOT}/binding.gyp`;
const forbiddenSourceRoot = `${LOCKED_NATIVE_PACKAGE_ROOT}/src/`;
const retiredRendererMutationMarkers = [
  "soar:save-cloud-credential",
  "soar:delete-cloud-credential",
  "SaveCloudCredentialInputSchema",
  "MacOsKeychainCredentialSetupStore",
];
const forbiddenLockedBinaryMarkers = [
  "NSSecureTextField",
  "kSecUseDataProtectionKeychain",
  "kSecAttrAccessGroup",
  "kSecAttrAccessControl",
  "kSecAttrAccessible",
  "kSecAttrSynchronizable",
  "kSecValueData",
  "SOAR_CREDENTIAL_BUILD_PRODUCTION",
  "SOAR_CREDENTIAL_BUILD_SYNTHETIC",
];
const forbiddenMutationSymbols = [
  "_SecItemAdd",
  "_SecItemUpdate",
  "_SecItemDelete",
];
export const FORBIDDEN_LOCKED_NATIVE_ACTIVATION_SYMBOLS = Object.freeze([
  "_OBJC_CLASS_$_NSSecureTextField",
  "_SecAccessControlCreateWithFlags",
  "_kSecAttrAccessControl",
  "_kSecAttrAccessGroup",
  "_kSecAttrAccessible",
  "_kSecAttrAccessibleAfterFirstUnlock",
  "_kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly",
  "_kSecAttrAccessibleAlways",
  "_kSecAttrAccessibleAlwaysThisDeviceOnly",
  "_kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly",
  "_kSecAttrAccessibleWhenUnlocked",
  "_kSecAttrAccessibleWhenUnlockedThisDeviceOnly",
  "_kSecAttrSynchronizable",
  "_kSecAttrSynchronizableAny",
  "_kSecUseDataProtectionKeychain",
  "_kSecValueData",
]);

function normalizedEntry(entry) {
  return entry.replace(/^[/\\]+/u, "").replaceAll("\\", "/");
}

export function assertLockedArchiveEntries(rawEntries) {
  const entries = new Set(rawEntries.map(normalizedEntry));
  for (const required of [
    LOCKED_NATIVE_BINARY,
    LOCKED_NATIVE_MANIFEST,
    LOCKED_NATIVE_PACKAGE_MANIFEST,
    SEALED_MAIN_ENTRY,
    SEALED_PRELOAD_ENTRY,
    SEALED_RENDERER_ENTRY,
  ]) {
    if (!entries.has(required)) {
      throw new Error(`Locked package entry is missing: ${required}`);
    }
  }
  for (const entry of entries) {
    if (entry === forbiddenBinding || entry.startsWith(forbiddenSourceRoot)) {
      throw new Error(`Native source leaked into the package: ${entry}`);
    }
    if (
      entry.startsWith(`${LOCKED_NATIVE_PACKAGE_ROOT}/`) &&
      entry.toLowerCase().endsWith(".node") &&
      entry !== LOCKED_NATIVE_BINARY
    ) {
      throw new Error(`Unexpected native addon survived packaging: ${entry}`);
    }
  }
}

export function parseLockedFlavorManifest(rawManifest) {
  let parsed;
  try {
    parsed = JSON.parse(rawManifest);
  } catch {
    throw new Error("Locked credential flavor manifest is not valid JSON.");
  }
  const expected = {
    schemaVersion: "soar-native-credential-package-v1",
    flavor: "locked",
    protectedItemLocator: false,
    syntheticItemLocator: false,
    secureEntry: false,
    mutation: false,
    consumer: false,
  };
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Object.keys(parsed).sort().join("\0") !==
      Object.keys(expected).sort().join("\0") ||
    Object.entries(expected).some(([key, value]) => parsed[key] !== value)
  ) {
    throw new Error("Credential package is not the exact locked Phase-B flavor.");
  }
  return Object.freeze(expected);
}

export function assertRendererBundleLocked(bundleText) {
  if (bundleText.includes(PR6R_DEVELOPMENT_CANARY_BUILD_MARKER)) {
    throw new Error(
      "PR6R development-canary marker survived packaging: " +
        PR6R_DEVELOPMENT_CANARY_BUILD_MARKER,
    );
  }
  for (const marker of retiredRendererMutationMarkers) {
    if (bundleText.includes(marker)) {
      throw new Error(`Retired credential mutation survived packaging: ${marker}`);
    }
  }
}

function undefinedMachOSymbols(symbols) {
  return new Set(
    symbols
      .split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u).at(-1) ?? "")
      .filter((symbol) => symbol.startsWith("_")),
  );
}

export function assertLockedNativeInspection({ symbols, strings }) {
  const importedSymbols = undefinedMachOSymbols(symbols);
  if (!importedSymbols.has("_SecItemCopyMatching")) {
    throw new Error("Locked broker is missing its permitted legacy metadata query.");
  }
  for (const symbol of forbiddenMutationSymbols) {
    if (importedSymbols.has(symbol)) {
      throw new Error(`Locked broker imports forbidden mutation symbol: ${symbol}`);
    }
  }
  for (const symbol of FORBIDDEN_LOCKED_NATIVE_ACTIVATION_SYMBOLS) {
    if (importedSymbols.has(symbol)) {
      throw new Error(`Locked broker imports forbidden activation symbol: ${symbol}`);
    }
  }
  for (const marker of forbiddenLockedBinaryMarkers) {
    if (strings.includes(marker)) {
      throw new Error(`Locked broker contains forbidden activation marker: ${marker}`);
    }
  }
}

function entitlementEntries(rawXml) {
  const document = rawXml.trim();
  if (document.length === 0) return [];
  const dictionary = /<dict>([\s\S]*?)<\/dict>/u.exec(document);
  if (dictionary === null) {
    throw new Error("Code-signing entitlements are not an XML property-list dictionary.");
  }
  const entries = [];
  const entryPattern = /<key>([^<]+)<\/key>\s*<(true|false)\s*\/>/gu;
  let cursor = 0;
  for (const match of dictionary[1].matchAll(entryPattern)) {
    if (dictionary[1].slice(cursor, match.index).trim().length !== 0) {
      throw new Error("Code-signing entitlements contain a non-boolean or malformed entry.");
    }
    entries.push([match[1], match[2] === "true"]);
    cursor = (match.index ?? 0) + match[0].length;
  }
  if (dictionary[1].slice(cursor).trim().length !== 0) {
    throw new Error("Code-signing entitlements contain a non-boolean or malformed entry.");
  }
  return entries;
}

export function assertPhaseBAdHocCodeEntitlements({
  relativePath,
  entitlementsXml,
}) {
  const normalizedPath = normalizedEntry(relativePath);
  const entries = entitlementEntries(entitlementsXml);
  const requiresJit = PHASE_B_ALLOW_JIT_CODE_PATHS.includes(normalizedPath);
  if (!requiresJit) {
    if (entries.length !== 0) {
      throw new Error(
        `Unexpected Phase-B code-signing entitlement on ${normalizedPath}.`,
      );
    }
    return;
  }
  if (
    entries.length !== 1 ||
    entries[0][0] !== PHASE_B_AD_HOC_ENTITLEMENT ||
    entries[0][1] !== true
  ) {
    throw new Error(
      `Phase-B code object does not have the exact allow-jit-only entitlement: ${normalizedPath}.`,
    );
  }
}
