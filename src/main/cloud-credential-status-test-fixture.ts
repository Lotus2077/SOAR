import {
  CloudCredentialStatusSchema,
  CredentialOperationProjectionSchema,
  type CloudCredentialStatus,
  type CredentialOperationProjection,
} from "../shared/cloud-setup-contracts";
import type { SoarConfig } from "./config";

export type TestCredentialOperationState = NonNullable<
  SoarConfig["testCredentialOperationState"]
>;

export interface CloudCredentialStatusSource {
  getStatus(): Promise<CloudCredentialStatus>;
  getUnavailableStatus?(): CloudCredentialStatus;
}

const operationProjection: Readonly<
  Record<TestCredentialOperationState, CredentialOperationProjection>
> = Object.freeze({
  pending: CredentialOperationProjectionSchema.parse({
    state: "pending",
    kind: "replace_protected",
  }),
  outcome_unknown_await_native_completion:
    CredentialOperationProjectionSchema.parse({
      state: "outcome_unknown",
      kind: "replace_protected",
      recoveryCode: "await_native_completion",
    }),
  outcome_unknown_manual_recovery_required:
    CredentialOperationProjectionSchema.parse({
      state: "outcome_unknown",
      kind: "replace_protected",
      recoveryCode: "manual_recovery_required",
    }),
});

/**
 * Renderer-only proof fixture. The double gate is repeated here even though
 * config parsing already enforces it, so a future caller cannot accidentally
 * expose synthetic operation state in a Local/production process.
 *
 * The fixture wraps status projection only. It has no credential input,
 * journal mutation, native authority, provider, egress, or dispatch path.
 */
export function withFakeCredentialOperationStatus(input: {
  base: CloudCredentialStatusSource;
  providerMode: SoarConfig["providerMode"];
  testWorkspace: SoarConfig["testWorkspace"];
  fixture: SoarConfig["testCredentialOperationState"];
  packagedRuntime: boolean;
}): CloudCredentialStatusSource {
  if (input.fixture === undefined) return input.base;
  if (
    input.packagedRuntime ||
    input.providerMode !== "fake" ||
    !input.testWorkspace
  ) {
    throw new Error(
      "The credential-operation status fixture requires an unpackaged Fake runtime and an explicit test workspace.",
    );
  }

  const latestOperation = operationProjection[input.fixture];
  return Object.freeze({
    async getStatus(): Promise<CloudCredentialStatus> {
      const baseStatus = await input.base.getStatus();
      return Object.freeze(
        CloudCredentialStatusSchema.parse({
          ...baseStatus,
          latestOperation,
        }),
      );
    },
    ...(input.base.getUnavailableStatus === undefined
      ? {}
      : {
          getUnavailableStatus: (): CloudCredentialStatus =>
            input.base.getUnavailableStatus!(),
        }),
  });
}
