import {
  CloudSetupStatusSchema,
  cloudCandidateView,
  cloudDispatchLock,
  type CloudSetupErrorCode,
  type CloudSetupStatus,
} from "../shared/cloud-setup-contracts";
import {
  SetupCredentialStoreError,
  type SetupOnlyCredentialStore,
} from "./providers/macos-keychain-credential-store";

function status(
  state: "not_configured" | "stored_unvalidated",
): CloudSetupStatus {
  return Object.freeze(
    CloudSetupStatusSchema.parse({
      schemaVersion: "cloud-setup-status-v1",
      candidate: cloudCandidateView(),
      state,
      dispatch: cloudDispatchLock(),
    }),
  );
}

function errorStatus(errorCode: CloudSetupErrorCode): CloudSetupStatus {
  return Object.freeze(
    CloudSetupStatusSchema.parse({
      schemaVersion: "cloud-setup-status-v1",
      candidate: cloudCandidateView(),
      state: "local_storage_error",
      errorCode,
      dispatch: cloudDispatchLock(),
    }),
  );
}

function stableErrorCode(error: unknown): CloudSetupErrorCode {
  if (error instanceof SetupCredentialStoreError) return error.code;
  return "keychain_unavailable";
}

/**
 * Metadata-only PR6A setup service.
 *
 * It has no raw-secret read capability and never retains the credential after
 * the bounded Keychain call returns. Provider validation and dispatch require
 * a separately approved service in PR6B.
 */
export class CloudCredentialSetupService {
  // Valid IPC calls must not build a raw-secret queue behind the Keychain
  // adapter. The gate is acquired synchronously before the store sees a value.
  private mutationInFlight = false;
  // Status carries no secret. Coalescing it prevents metadata-only callers from
  // stacking an unbounded serialized queue ahead of one accepted mutation.
  private statusInFlight: Promise<CloudSetupStatus> | undefined;

  constructor(private readonly store: SetupOnlyCredentialStore) {}

  getStatus(): Promise<CloudSetupStatus> {
    if (this.statusInFlight !== undefined) return this.statusInFlight;

    const pending = this.readStatus();
    this.statusInFlight = pending;
    void pending.then(
      () => this.clearStatusInFlight(pending),
      () => this.clearStatusInFlight(pending),
    );
    return pending;
  }

  private async readStatus(): Promise<CloudSetupStatus> {
    try {
      return (await this.store.has())
        ? status("stored_unvalidated")
        : status("not_configured");
    } catch (error) {
      return errorStatus(stableErrorCode(error));
    }
  }

  async save(credential: string): Promise<CloudSetupStatus> {
    if (!this.beginMutation()) return errorStatus("operation_in_progress");

    try {
      // `security -U` is an upsert. This avoids a check-then-write race while
      // keeping the raw value inside one setup-only call.
      await this.store.replace(credential);
      return status("stored_unvalidated");
    } catch (error) {
      return errorStatus(stableErrorCode(error));
    } finally {
      this.mutationInFlight = false;
    }
  }

  async delete(): Promise<CloudSetupStatus> {
    if (!this.beginMutation()) return errorStatus("operation_in_progress");

    try {
      await this.store.delete();
      return status("not_configured");
    } catch (error) {
      return errorStatus(stableErrorCode(error));
    } finally {
      this.mutationInFlight = false;
    }
  }

  private beginMutation(): boolean {
    if (this.mutationInFlight) return false;
    this.mutationInFlight = true;
    return true;
  }

  private clearStatusInFlight(pending: Promise<CloudSetupStatus>): void {
    if (this.statusInFlight === pending) this.statusInFlight = undefined;
  }
}

export function unavailableCloudSetupStatus(
  errorCode: CloudSetupErrorCode = "keychain_unavailable",
): CloudSetupStatus {
  return errorStatus(errorCode);
}
