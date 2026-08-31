import { describe, expect, it } from "vitest";

import {
  CLOUD_CREDENTIAL_MAX_BYTES,
  CloudSetupStatusSchema,
  SaveCloudCredentialInputSchema,
  cloudCandidateView,
  cloudDispatchLock,
} from "../../src/shared/cloud-setup-contracts";

function status(state: "not_configured" | "stored_unvalidated") {
  return {
    schemaVersion: "cloud-setup-status-v1",
    candidate: cloudCandidateView(),
    state,
    dispatch: cloudDispatchLock(),
  } as const;
}

describe("cloud setup contracts", () => {
  it("accepts exactly one bounded credential string", () => {
    expect(
      SaveCloudCredentialInputSchema.parse({ credential: "synthetic-value" }),
    ).toEqual({ credential: "synthetic-value" });

    for (const input of [
      {},
      { credential: "" },
      { credential: " leading-space" },
      { credential: "trailing-space " },
      { credential: "line-one\nline-two" },
      { credential: "nul\0byte" },
      { credential: "synthetic-value", providerId: "forged-provider" },
      { credential: "synthetic-value", consent: true },
      { credential: "é".repeat(CLOUD_CREDENTIAL_MAX_BYTES) },
    ]) {
      expect(SaveCloudCredentialInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("accepts only metadata-only setup projections with dispatch locked", () => {
    expect(CloudSetupStatusSchema.parse(status("not_configured"))).toEqual(
      status("not_configured"),
    );
    expect(
      CloudSetupStatusSchema.parse(status("stored_unvalidated")),
    ).toEqual(status("stored_unvalidated"));
    expect(
      CloudSetupStatusSchema.parse({
        ...status("not_configured"),
        state: "local_storage_error",
        errorCode: "keychain_status_failed",
      }),
    ).toMatchObject({
      state: "local_storage_error",
      errorCode: "keychain_status_failed",
      dispatch: { state: "locked" },
    });
    expect(
      CloudSetupStatusSchema.parse({
        ...status("not_configured"),
        state: "local_storage_error",
        errorCode: "operation_in_progress",
      }),
    ).toMatchObject({
      state: "local_storage_error",
      errorCode: "operation_in_progress",
      dispatch: { state: "locked" },
    });
  });

  it("rejects secret echoes, forged authority, and inconsistent error fields", () => {
    for (const projection of [
      { ...status("not_configured"), credential: "synthetic-secret" },
      { ...status("not_configured"), endpoint: "https://example.invalid" },
      { ...status("not_configured"), consent: "granted" },
      {
        ...status("not_configured"),
        candidate: {
          ...cloudCandidateView(),
          candidateId: "forged-candidate",
          intendedModelSlug: "forged/model",
        },
      },
      { ...status("not_configured"), errorCode: "keychain_status_failed" },
      {
        ...status("not_configured"),
        state: "local_storage_error",
      },
      {
        ...status("not_configured"),
        dispatch: { ...cloudDispatchLock(), state: "enabled" },
      },
    ]) {
      expect(CloudSetupStatusSchema.safeParse(projection).success).toBe(false);
    }
  });
});
