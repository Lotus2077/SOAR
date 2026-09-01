import { createRequire } from "node:module";
import process from "node:process";

import {
  ProtectedCredentialItemStatusSchema,
  type ProtectedCredentialItemStatus,
} from "../../shared/cloud-setup-contracts";
import {
  ACTIVATION_LOCKED_RESULT,
  AcquireCredentialLeaseInputSchema,
  ActivationLockedResultSchema,
  ConsumeCredentialLeaseInputSchema,
  NativeCredentialCapabilitySchema,
  NativeLegacyCredentialStatusSchema,
  ReleaseCredentialLeaseInputSchema,
  UnavailableCredentialLeaseAuthority,
  type AcquireCredentialLeaseInput,
  type AcquireCredentialLeaseResult,
  type ConsumeCredentialLeaseInput,
  type ConsumeCredentialLeaseResult,
  type CredentialAuthoritySnapshot,
  type CredentialLeaseAuthority,
  type NativeCredentialCapability,
  type NativeLegacyCredentialStatus,
  type ReleaseCredentialLeaseInput,
  type ReleaseCredentialLeaseResult,
} from "./credential-lease-authority";

const NATIVE_BROKER_PACKAGE = "@soar/macos-credential-lease" as const;
const NATIVE_EXPORTS = [
  "acquireLease",
  "capability",
  "consumeLease",
  "legacyStatus",
  "releaseLease",
] as const;

const activationLockedProtectedItem: ProtectedCredentialItemStatus =
  ProtectedCredentialItemStatusSchema.parse({
    state: "unknown",
    reasonCode: "activation_locked",
  });

interface LockedNativeBrokerModule {
  capability(): unknown;
  legacyStatus(): Promise<unknown>;
  acquireLease(input: unknown): unknown;
  consumeLease(input: unknown): unknown;
  releaseLease(input: unknown): unknown;
}

export type NativeBrokerModuleLoader = () => unknown;

function defaultNativeModuleLoader(): unknown {
  return createRequire(import.meta.url)(NATIVE_BROKER_PACKAGE);
}

function exactNativeModule(value: unknown): LockedNativeBrokerModule | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== NATIVE_EXPORTS.length ||
    keys.some((key, index) => key !== NATIVE_EXPORTS[index]) ||
    NATIVE_EXPORTS.some((name) => typeof record[name] !== "function")
  ) {
    return undefined;
  }
  return value as LockedNativeBrokerModule;
}

function unavailableSnapshot(): CredentialAuthoritySnapshot {
  return {
    capability: NativeCredentialCapabilitySchema.parse({
      schemaVersion: "soar-native-credential-lease-v1",
      flavor: "locked",
      eligibility: "unavailable",
      reasonCode: "native_module_unavailable",
    }),
    legacyStagedItem: NativeLegacyCredentialStatusSchema.parse({
      state: "unknown",
      reasonCode: "legacy_metadata_unavailable",
    }),
    protectedItem: activationLockedProtectedItem,
  };
}

/**
 * Main-process-only adapter over the locked Objective-C++ broker.
 *
 * The native package is resolved lazily only after bootstrap has acquired the
 * single-instance lock. No native exception, path, signing value, Security
 * framework result, or unknown field is retained or returned.
 */
export class NativeCredentialLeaseAuthority
  implements CredentialLeaseAuthority
{
  private readonly broker: LockedNativeBrokerModule | undefined;

  constructor(loader: NativeBrokerModuleLoader = defaultNativeModuleLoader) {
    try {
      this.broker = exactNativeModule(loader());
    } catch {
      this.broker = undefined;
    }
  }

  async getSnapshot(): Promise<CredentialAuthoritySnapshot> {
    if (this.broker === undefined) return unavailableSnapshot();

    let capability: NativeCredentialCapability;
    try {
      capability = NativeCredentialCapabilitySchema.parse(
        this.broker.capability(),
      );
    } catch {
      return unavailableSnapshot();
    }

    let legacyStagedItem: NativeLegacyCredentialStatus;
    try {
      legacyStagedItem = NativeLegacyCredentialStatusSchema.parse(
        await this.broker.legacyStatus(),
      );
    } catch {
      legacyStagedItem = NativeLegacyCredentialStatusSchema.parse({
        state: "unknown",
        reasonCode: "legacy_metadata_unavailable",
      });
    }

    return Object.freeze({
      capability,
      legacyStagedItem,
      protectedItem: activationLockedProtectedItem,
    });
  }

  async acquireLease(
    input: AcquireCredentialLeaseInput,
  ): Promise<AcquireCredentialLeaseResult> {
    const parsed = AcquireCredentialLeaseInputSchema.parse(input);
    if (this.broker === undefined) return ACTIVATION_LOCKED_RESULT;
    try {
      return ActivationLockedResultSchema.parse(
        this.broker.acquireLease(parsed),
      );
    } catch {
      return ACTIVATION_LOCKED_RESULT;
    }
  }

  async consumeLease(
    input: ConsumeCredentialLeaseInput,
  ): Promise<ConsumeCredentialLeaseResult> {
    const parsed = ConsumeCredentialLeaseInputSchema.parse(input);
    if (this.broker === undefined) return ACTIVATION_LOCKED_RESULT;
    try {
      return ActivationLockedResultSchema.parse(
        this.broker.consumeLease(parsed),
      );
    } catch {
      return ACTIVATION_LOCKED_RESULT;
    }
  }

  async releaseLease(
    input: ReleaseCredentialLeaseInput,
  ): Promise<ReleaseCredentialLeaseResult> {
    const parsed = ReleaseCredentialLeaseInputSchema.parse(input);
    if (this.broker === undefined) return ACTIVATION_LOCKED_RESULT;
    try {
      return ActivationLockedResultSchema.parse(
        this.broker.releaseLease(parsed),
      );
    } catch {
      return ACTIVATION_LOCKED_RESULT;
    }
  }
}

export function createCredentialLeaseAuthority(options: {
  platform?: NodeJS.Platform;
  deterministicFake?: boolean;
  loader?: NativeBrokerModuleLoader;
} = {}): CredentialLeaseAuthority {
  const platform = options.platform ?? process.platform;
  if (options.deterministicFake === true) {
    return new UnavailableCredentialLeaseAuthority("native_module_unavailable");
  }
  if (platform !== "darwin") {
    return new UnavailableCredentialLeaseAuthority("unsupported_platform");
  }
  return new NativeCredentialLeaseAuthority(options.loader);
}
