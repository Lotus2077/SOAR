import {
  LegacyStagedItemStatusSchema,
  ProtectedCredentialItemStatusSchema,
  type LegacyStagedItemStatus,
} from "../../shared/cloud-setup-contracts";
import {
  AcquireCredentialLeaseInputSchema,
  AcquireCredentialLeaseResultSchema,
  ConsumeCredentialLeaseInputSchema,
  ConsumeCredentialLeaseResultSchema,
  CredentialLeasePurposeSchema,
  NativeCredentialCapabilitySchema,
  NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION,
  ReleaseCredentialLeaseInputSchema,
  ReleaseCredentialLeaseResultSchema,
  type AcquireCredentialLeaseInput,
  type AcquireCredentialLeaseResult,
  type ConsumeCredentialLeaseInput,
  type ConsumeCredentialLeaseResult,
  type CredentialAuthoritySnapshot,
  type CredentialLeaseAuthority,
  type CredentialLeasePurpose,
  type ReleaseCredentialLeaseInput,
  type ReleaseCredentialLeaseResult,
} from "./credential-lease-authority";

type FakeLeaseLifecycle =
  | "acquiring"
  | "active"
  | "consumed"
  | "released"
  | "expired"
  | "abandoned";

interface FakeLeaseRecord {
  handle: string;
  purpose: CredentialLeasePurpose;
  generation: string;
  nonce?: string;
  expiresAtMonotonicMs: number;
  state: FakeLeaseLifecycle;
}

export interface FakeCredentialLeaseAuthorityOptions {
  monotonicNow?: () => number;
  handleFactory?: () => string;
  legacyStagedItem?: LegacyStagedItemStatus;
  protectedGeneration?: string;
}

/**
 * Metadata-only deterministic authority for unit and renderer fixtures.
 * It never accepts, retains, or returns credential bytes.
 */
export class FakeCredentialLeaseAuthority implements CredentialLeaseAuthority {
  private readonly monotonicNow: () => number;
  private readonly handleFactory: () => string;
  private readonly leases = new Map<string, FakeLeaseRecord>();
  private nextDeterministicHandle = 0;
  private legacyStagedItem: LegacyStagedItemStatus;
  private protectedGeneration: string | undefined;
  private activeHandle: string | undefined;

  constructor(options: FakeCredentialLeaseAuthorityOptions = {}) {
    this.monotonicNow = options.monotonicNow ?? (() => 0);
    this.handleFactory =
      options.handleFactory ??
      (() => `fake-lease-${++this.nextDeterministicHandle}`);
    this.legacyStagedItem = LegacyStagedItemStatusSchema.parse(
      options.legacyStagedItem ?? {
        state: "not_observed",
        reasonCode: "legacy_metadata_not_observed",
      },
    );
    this.protectedGeneration = options.protectedGeneration;
  }

  async getSnapshot(): Promise<CredentialAuthoritySnapshot> {
    return Object.freeze({
      capability: NativeCredentialCapabilitySchema.parse({
        schemaVersion: NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION,
        flavor: "locked",
        eligibility: "eligible",
        reasonCode: "identity_policy_satisfied",
      }),
      legacyStagedItem: this.legacyStagedItem,
      protectedItem: ProtectedCredentialItemStatusSchema.parse(
        this.protectedGeneration === undefined
          ? {
              state: "not_observed",
              reasonCode: "protected_metadata_not_observed",
            }
          : {
              state: "present",
              reasonCode: "protected_metadata_present",
            },
      ),
    });
  }

  async acquireLease(
    rawInput: AcquireCredentialLeaseInput,
  ): Promise<AcquireCredentialLeaseResult> {
    const input = AcquireCredentialLeaseInputSchema.parse(rawInput);
    const now = this.now();
    this.expireActive(now);
    if (this.activeHandle !== undefined) {
      return AcquireCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "lease_already_active",
      });
    }
    if (this.protectedGeneration === undefined) {
      return AcquireCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "protected_item_unavailable",
      });
    }
    if (input.generation !== this.protectedGeneration) {
      return AcquireCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "generation_mismatch",
      });
    }

    const handle = this.handleFactory();
    if (this.leases.has(handle)) {
      throw new Error("fake credential lease handle collision");
    }
    const lease: FakeLeaseRecord = {
      handle,
      purpose: CredentialLeasePurposeSchema.parse(input.purpose),
      generation: input.generation,
      nonce: input.nonce,
      expiresAtMonotonicMs: now + input.ttlMs,
      state: "acquiring",
    };
    AcquireCredentialLeaseResultSchema.parse({
      state: "active",
      handle,
      expiresAtMonotonicMs: lease.expiresAtMonotonicMs,
    });
    lease.state = "active";
    this.leases.set(handle, lease);
    this.activeHandle = handle;
    return {
      state: "active",
      handle,
      expiresAtMonotonicMs: lease.expiresAtMonotonicMs,
    };
  }

  async consumeLease(
    rawInput: ConsumeCredentialLeaseInput,
  ): Promise<ConsumeCredentialLeaseResult> {
    const input = ConsumeCredentialLeaseInputSchema.parse(rawInput);
    const lease = this.leases.get(input.handle);
    if (lease === undefined) {
      return ConsumeCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "unknown_lease",
      });
    }
    const now = this.now();
    if (lease.state === "active" && now >= lease.expiresAtMonotonicMs) {
      this.finish(lease, "expired");
      return ConsumeCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "lease_expired",
      });
    }
    if (lease.state !== "active") {
      return ConsumeCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "lease_not_active",
      });
    }
    if (lease.purpose !== input.expectedPurpose) {
      return ConsumeCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "purpose_mismatch",
      });
    }
    if (lease.nonce !== input.nonce) {
      return ConsumeCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "nonce_mismatch",
      });
    }
    if (lease.generation !== this.protectedGeneration) {
      this.finish(lease, "abandoned");
      return ConsumeCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "generation_mismatch",
      });
    }

    // The state change and fixed metadata-only consumer result are one
    // synchronous transition, so a second call cannot consume the lease.
    this.finish(lease, "consumed");
    return ConsumeCredentialLeaseResultSchema.parse({
      state: "consumed",
      resultCode: "phase_b_test_consumer_completed",
    });
  }

  async releaseLease(
    rawInput: ReleaseCredentialLeaseInput,
  ): Promise<ReleaseCredentialLeaseResult> {
    const input = ReleaseCredentialLeaseInputSchema.parse(rawInput);
    const lease = this.leases.get(input.handle);
    if (lease === undefined) {
      return ReleaseCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "unknown_lease",
      });
    }
    this.expireActive(this.now());
    if (lease.state !== "active") {
      return ReleaseCredentialLeaseResultSchema.parse({
        state: "denied",
        reasonCode: "lease_not_active",
      });
    }
    this.finish(lease, "released");
    return ReleaseCredentialLeaseResultSchema.parse({ state: "released" });
  }

  /** Test-only metadata mutation; it never accepts a credential value. */
  setProtectedGenerationForTest(generation: string | undefined): void {
    if (generation !== undefined) {
      AcquireCredentialLeaseInputSchema.shape.generation.parse(generation);
    }
    const active =
      this.activeHandle === undefined
        ? undefined
        : this.leases.get(this.activeHandle);
    if (active?.state === "active") this.finish(active, "abandoned");
    this.protectedGeneration = generation;
  }

  setLegacyStagedItemForTest(status: LegacyStagedItemStatus): void {
    this.legacyStagedItem = LegacyStagedItemStatusSchema.parse(status);
  }

  lifecycleForTest(handle: string): FakeLeaseLifecycle | undefined {
    return this.leases.get(handle)?.state;
  }

  controlledMetadataForTest(handle: string): {
    hasNonce: boolean;
    state: FakeLeaseLifecycle;
  } | undefined {
    const lease = this.leases.get(handle);
    return lease === undefined
      ? undefined
      : { hasNonce: lease.nonce !== undefined, state: lease.state };
  }

  private now(): number {
    const value = this.monotonicNow();
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("monotonic time must be finite and non-negative");
    }
    return value;
  }

  private expireActive(now: number): void {
    if (this.activeHandle === undefined) return;
    const active = this.leases.get(this.activeHandle);
    if (
      active?.state === "active" &&
      now >= active.expiresAtMonotonicMs
    ) {
      this.finish(active, "expired");
    }
  }

  private finish(
    lease: FakeLeaseRecord,
    state: Exclude<FakeLeaseLifecycle, "acquiring" | "active">,
  ): void {
    lease.state = state;
    lease.nonce = undefined;
    if (this.activeHandle === lease.handle) this.activeHandle = undefined;
  }
}
