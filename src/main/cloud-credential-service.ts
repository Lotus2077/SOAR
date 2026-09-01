import {
  CREDENTIAL_ACTIVATION_PHASE,
  CREDENTIAL_AUTHORITY_CAPABILITY_VERSION,
  CLOUD_CREDENTIAL_STATUS_SCHEMA_VERSION,
  CloudCredentialStatusSchema,
  cloudDispatchLock,
  cloudProviderCheckNotRun,
  cloudProviderNotContacted,
  type CloudCredentialStatus,
  type CredentialBuildEligibility,
  type CredentialOperationProjection,
  type LegacyStagedItemStatus,
} from "../shared/cloud-setup-contracts";
import type { CredentialLeaseAuthority } from "./credentials/credential-lease-authority";
import type { CredentialOperationJournal } from "./credentials/credential-operation-journal";

function projectBuild(
  capability: Awaited<
    ReturnType<CredentialLeaseAuthority["getSnapshot"]>
  >["capability"],
): CredentialBuildEligibility {
  if (capability.eligibility === "eligible") {
    return { state: "eligible", reasonCode: capability.reasonCode };
  }
  if (capability.eligibility === "unavailable") {
    return {
      state: "eligibility_unknown",
      reasonCode: capability.reasonCode,
    };
  }
  if (capability.reasonCode === "signed_build_required") {
    return {
      state: "unsigned_or_adhoc",
      reasonCode: capability.reasonCode,
    };
  }
  return { state: "ineligible", reasonCode: capability.reasonCode };
}

function status(input: {
  build: CredentialBuildEligibility;
  legacyStagedItem: LegacyStagedItemStatus;
  latestOperation: ReturnType<CredentialOperationJournal["latestProjection"]>;
}): CloudCredentialStatus {
  return Object.freeze(
    CloudCredentialStatusSchema.parse({
      schemaVersion: CLOUD_CREDENTIAL_STATUS_SCHEMA_VERSION,
      capabilityVersion: CREDENTIAL_AUTHORITY_CAPABILITY_VERSION,
      activationPhase: CREDENTIAL_ACTIVATION_PHASE,
      build: input.build,
      legacyStagedItem: input.legacyStagedItem,
      // The phase-B package has no protected locator. Even an eligible host may
      // not claim that a protected item is present or absent.
      protectedItem: {
        state: "unknown",
        reasonCode: "activation_locked",
      },
      providerCheck: cloudProviderCheckNotRun(),
      dispatch: cloudDispatchLock(),
      providerContact: cloudProviderNotContacted(),
      latestOperation: input.latestOperation,
    }),
  );
}

/**
 * Status-only PR6B1-B projection. It has no credential input, mutation,
 * provider, egress, budget, or dispatch dependency.
 */
export class CloudCredentialStatusService {
  private statusInFlight: Promise<CloudCredentialStatus> | undefined;

  constructor(
    private readonly authority: CredentialLeaseAuthority,
    private readonly journal: CredentialOperationJournal,
  ) {}

  getStatus(): Promise<CloudCredentialStatus> {
    if (this.statusInFlight !== undefined) return this.statusInFlight;
    const pending = this.readStatus();
    this.statusInFlight = pending;
    void pending.then(
      () => this.clearStatusInFlight(pending),
      () => this.clearStatusInFlight(pending),
    );
    return pending;
  }

  /**
   * Fail-closed projection for callers that could not obtain native metadata.
   * The journal is read independently so an authority failure cannot hide a
   * persisted pending or ambiguous operation as if no operation existed.
   */
  getUnavailableStatus(): CloudCredentialStatus {
    return unavailableCloudCredentialStatus(
      "identity_check_unavailable",
      this.journal.latestProjection(),
    );
  }

  private async readStatus(): Promise<CloudCredentialStatus> {
    const snapshot = await this.authority.getSnapshot();
    return status({
      build: projectBuild(snapshot.capability),
      legacyStagedItem: snapshot.legacyStagedItem,
      latestOperation: this.journal.latestProjection(),
    });
  }

  private clearStatusInFlight(pending: Promise<CloudCredentialStatus>): void {
    if (this.statusInFlight === pending) this.statusInFlight = undefined;
  }
}

export function unavailableCloudCredentialStatus(
  reasonCode:
    | "unsupported_platform"
    | "native_module_unavailable"
    | "identity_check_unavailable" = "identity_check_unavailable",
  latestOperation: CredentialOperationProjection = { state: "none" },
): CloudCredentialStatus {
  return status({
    build: { state: "eligibility_unknown", reasonCode },
    legacyStagedItem: {
      state: "unknown",
      reasonCode: "legacy_metadata_unavailable",
    },
    latestOperation,
  });
}
