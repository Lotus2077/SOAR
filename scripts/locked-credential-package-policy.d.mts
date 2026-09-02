export const LOCKED_NATIVE_PACKAGE_ROOT: string;
export const LOCKED_NATIVE_BINARY: string;
export const LOCKED_NATIVE_MANIFEST: string;
export const LOCKED_NATIVE_PACKAGE_MANIFEST: string;
export const SEALED_MAIN_ENTRY: string;
export const SEALED_PRELOAD_ENTRY: string;
export const SEALED_RENDERER_ENTRY: string;
export const PHASE_B_AD_HOC_ENTITLEMENT: string;
export const PR6R_DEVELOPMENT_CANARY_BUILD_MARKER: string;
export const PR6R_DEVELOPMENT_CANARY_MAIN_IDENTITY: string;
export const PR6R_DEVELOPMENT_CANARY_PRELOAD_IDENTITY: string;
export const PR6R_DEVELOPMENT_CANARY_RENDERER_IDENTITY: string;
export const PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES: Readonly<
  Record<"main" | "preload" | "renderer", string>
>;
export const PR6R_DEVELOPMENT_FORBIDDEN_BUNDLE_SIGNATURES: readonly string[];
export const PHASE_B_ALLOW_JIT_CODE_PATHS: readonly string[];
export const FORBIDDEN_LOCKED_NATIVE_ACTIVATION_SYMBOLS: readonly string[];

export function assertLockedArchiveEntries(entries: readonly string[]): void;
export function parseLockedFlavorManifest(rawManifest: string): Readonly<{
  schemaVersion: "soar-native-credential-package-v1";
  flavor: "locked";
  protectedItemLocator: false;
  syntheticItemLocator: false;
  secureEntry: false;
  mutation: false;
  consumer: false;
}>;
export function assertRendererBundleLocked(bundleText: string): void;
export function assertLockedNativeInspection(input: {
  symbols: string;
  strings: string;
}): void;
export function assertPhaseBAdHocCodeEntitlements(input: {
  relativePath: string;
  entitlementsXml: string;
}): void;
