import { describe, expect, it, vi } from "vitest";

import {
  type CloudCredentialStatusSource,
  type TestCredentialOperationState,
  withFakeCredentialOperationStatus,
} from "../../src/main/cloud-credential-status-test-fixture";
import { unavailableCloudCredentialStatus } from "../../src/main/cloud-credential-service";

function baseSource(): {
  source: CloudCredentialStatusSource;
  getStatus: ReturnType<typeof vi.fn>;
} {
  const getStatus = vi
    .fn()
    .mockResolvedValue(unavailableCloudCredentialStatus("native_module_unavailable"));
  return { source: { getStatus }, getStatus };
}

describe("withFakeCredentialOperationStatus", () => {
  it("returns the production status source unchanged when no fixture was requested", () => {
    const { source } = baseSource();
    expect(
      withFakeCredentialOperationStatus({
        base: source,
        providerMode: "local",
        testWorkspace: undefined,
        fixture: undefined,
        packagedRuntime: true,
      }),
    ).toBe(source);
  });

  it("fails closed before status access outside the Fake test-workspace gate", () => {
    for (const gate of [
      {
        providerMode: "local" as const,
        testWorkspace: "/test/workspace",
        packagedRuntime: false,
      },
      {
        providerMode: "fake" as const,
        testWorkspace: undefined,
        packagedRuntime: false,
      },
      {
        providerMode: "fake" as const,
        testWorkspace: "/test/workspace",
        packagedRuntime: true,
      },
    ]) {
      const { source, getStatus } = baseSource();
      expect(() =>
        withFakeCredentialOperationStatus({
          base: source,
          ...gate,
          fixture: "pending",
        }),
      ).toThrow(/requires an unpackaged Fake runtime/u);
      expect(getStatus).not.toHaveBeenCalled();
    }
  });

  it.each<{
    fixture: TestCredentialOperationState;
    expected: object;
  }>([
    {
      fixture: "pending",
      expected: { state: "pending", kind: "replace_protected" },
    },
    {
      fixture: "outcome_unknown_await_native_completion",
      expected: {
        state: "outcome_unknown",
        kind: "replace_protected",
        recoveryCode: "await_native_completion",
      },
    },
    {
      fixture: "outcome_unknown_manual_recovery_required",
      expected: {
        state: "outcome_unknown",
        kind: "replace_protected",
        recoveryCode: "manual_recovery_required",
      },
    },
  ])("projects $fixture without changing the locked/provider boundary", async ({
    fixture,
    expected,
  }) => {
    const { source, getStatus } = baseSource();
    const fixtureSource = withFakeCredentialOperationStatus({
      base: source,
      providerMode: "fake",
      testWorkspace: "/test/workspace",
      fixture,
      packagedRuntime: false,
    });

    await expect(fixtureSource.getStatus()).resolves.toMatchObject({
      latestOperation: expected,
      dispatch: { state: "locked", reasonCode: "pr6b1_phase_b_locked" },
      providerCheck: { state: "not_run" },
      providerContact: { state: "not_contacted" },
    });
    expect(getStatus).toHaveBeenCalledTimes(1);
  });
});
