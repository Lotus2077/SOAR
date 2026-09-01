import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CloudCredentialStatusService,
  unavailableCloudCredentialStatus,
} from "../../src/main/cloud-credential-service";
import {
  NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION,
  type CredentialAuthoritySnapshot,
  type CredentialLeaseAuthority,
} from "../../src/main/credentials/credential-lease-authority";
import { FakeCredentialLeaseAuthority } from "../../src/main/credentials/fake-credential-lease-authority";
import { CredentialOperationJournal } from "../../src/main/credentials/credential-operation-journal";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";

const databases: SoarDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function journal(): CredentialOperationJournal {
  const database = createSoarDatabase();
  databases.push(database);
  return new CredentialOperationJournal(database);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("CloudCredentialStatusService", () => {
  it("projects native metadata while protected state and provider dispatch stay locked", async () => {
    const authority = new FakeCredentialLeaseAuthority({
      protectedGeneration: "generation-1",
      legacyStagedItem: {
        state: "present",
        reasonCode: "legacy_metadata_present",
      },
    });
    const service = new CloudCredentialStatusService(authority, journal());

    await expect(service.getStatus()).resolves.toEqual({
      schemaVersion: "cloud-credential-status-v1",
      capabilityVersion: "credential-lease-authority-v1",
      activationPhase: "phase_b_locked",
      build: {
        state: "eligible",
        reasonCode: "identity_policy_satisfied",
      },
      legacyStagedItem: {
        state: "present",
        reasonCode: "legacy_metadata_present",
      },
      protectedItem: { state: "unknown", reasonCode: "activation_locked" },
      providerCheck: { providerLabel: "OpenRouter", state: "not_run" },
      dispatch: {
        state: "locked",
        reasonCode: "pr6b1_phase_b_locked",
        explanation:
          "Real cloud dispatch remains locked until the later credential, provider, egress, and budget gates pass.",
      },
      providerContact: {
        providerLabel: "OpenRouter",
        state: "not_contacted",
        scope: "credential_operation",
      },
      latestOperation: { state: "none" },
    });
    expect("save" in service).toBe(false);
    expect("delete" in service).toBe(false);
  });

  it("maps unsigned, ineligible, and unavailable identity results without free text", async () => {
    const cases = [
      [
        {
          schemaVersion: NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION,
          flavor: "locked",
          eligibility: "ineligible",
          reasonCode: "signed_build_required",
        },
        { state: "unsigned_or_adhoc", reasonCode: "signed_build_required" },
      ],
      [
        {
          schemaVersion: NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION,
          flavor: "locked",
          eligibility: "ineligible",
          reasonCode: "wrong_team_identifier",
        },
        { state: "ineligible", reasonCode: "wrong_team_identifier" },
      ],
      [
        {
          schemaVersion: NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION,
          flavor: "locked",
          eligibility: "unavailable",
          reasonCode: "native_module_unavailable",
        },
        {
          state: "eligibility_unknown",
          reasonCode: "native_module_unavailable",
        },
      ],
    ] as const;

    for (const [capability, expected] of cases) {
      const authority: CredentialLeaseAuthority = {
        getSnapshot: async () => ({
          capability,
          legacyStagedItem: {
            state: "unknown",
            reasonCode: "legacy_metadata_unavailable",
          },
          protectedItem: {
            state: "unknown",
            reasonCode: "activation_locked",
          },
        }),
        acquireLease: vi.fn(),
        consumeLease: vi.fn(),
        releaseLease: vi.fn(),
      };
      const service = new CloudCredentialStatusService(authority, journal());
      await expect(service.getStatus()).resolves.toMatchObject({
        build: expected,
        dispatch: { state: "locked" },
      });
    }
  });

  it("coalesces concurrent metadata reads and never invokes a lease operation", async () => {
    const pending = deferred<CredentialAuthoritySnapshot>();
    const authority: CredentialLeaseAuthority = {
      getSnapshot: vi.fn(() => pending.promise),
      acquireLease: vi.fn(),
      consumeLease: vi.fn(),
      releaseLease: vi.fn(),
    };
    const service = new CloudCredentialStatusService(authority, journal());

    const first = service.getStatus();
    const second = service.getStatus();
    expect(first).toBe(second);
    expect(authority.getSnapshot).toHaveBeenCalledOnce();

    pending.resolve({
      capability: {
        schemaVersion: NATIVE_CREDENTIAL_LEASE_SCHEMA_VERSION,
        flavor: "locked",
        eligibility: "unavailable",
        reasonCode: "identity_check_unavailable",
      },
      legacyStagedItem: {
        state: "unknown",
        reasonCode: "legacy_metadata_unavailable",
      },
      protectedItem: { state: "unknown", reasonCode: "activation_locked" },
    });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(authority.acquireLease).not.toHaveBeenCalled();
    expect(authority.consumeLease).not.toHaveBeenCalled();
    expect(authority.releaseLease).not.toHaveBeenCalled();
  });

  it("projects only allow-listed journal recovery metadata", async () => {
    const operationJournal = journal();
    const operation = operationJournal.begin({
      operationKind: "replace_protected",
      requestedGeneration:
        "generation-00000000-0000-4000-8000-000000000001",
      startedAt: "2026-09-01T00:00:00.000Z",
    });
    operationJournal.markCallerAbandoned(
      operation.operationId,
      "2026-09-01T00:00:01.000Z",
    );
    const service = new CloudCredentialStatusService(
      new FakeCredentialLeaseAuthority(),
      operationJournal,
    );

    const result = await service.getStatus();
    expect(result.latestOperation).toEqual({
      state: "outcome_unknown",
      kind: "replace_protected",
      recoveryCode: "await_native_completion",
    });
    expect(JSON.stringify(result)).not.toContain(operation.operationId);
    expect(JSON.stringify(result)).not.toContain(
      "generation-00000000-0000-4000-8000-000000000001",
    );
  });

  it("builds a strict unavailable projection without native diagnostics", () => {
    expect(unavailableCloudCredentialStatus()).toMatchObject({
      build: {
        state: "eligibility_unknown",
        reasonCode: "identity_check_unavailable",
      },
      protectedItem: { state: "unknown", reasonCode: "activation_locked" },
      providerCheck: { state: "not_run" },
      dispatch: { state: "locked" },
      providerContact: { state: "not_contacted" },
    });
  });

  it("preserves journal ambiguity in an unavailable native projection", () => {
    const operationJournal = journal();
    const operation = operationJournal.begin({
      operationKind: "replace_protected",
      requestedGeneration:
        "generation-00000000-0000-4000-8000-000000000001",
      startedAt: "2026-09-01T00:00:00.000Z",
    });
    operationJournal.markNativeCompletionUnknown(
      operation.operationId,
      "2026-09-01T00:00:01.000Z",
    );
    const service = new CloudCredentialStatusService(
      new FakeCredentialLeaseAuthority(),
      operationJournal,
    );

    expect(service.getUnavailableStatus()).toMatchObject({
      build: {
        state: "eligibility_unknown",
        reasonCode: "identity_check_unavailable",
      },
      latestOperation: {
        state: "outcome_unknown",
        kind: "replace_protected",
        recoveryCode: "await_native_completion",
      },
    });
  });
});
