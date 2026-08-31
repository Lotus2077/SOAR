import { describe, expect, it } from "vitest";

import {
  HybridSimulationConsentChallengeError,
  HybridSimulationConsentChallengeStore,
} from "../../src/main/hybrid-simulation-consent";
import {
  HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
  HYBRID_SIMULATION_CONSENT_ID,
  HYBRID_SIMULATION_DISCLOSURE_TEXT,
  HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
  HYBRID_SIMULATION_DISCLOSURE_VERSION,
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_RESULT_MARKER,
  HYBRID_SIMULATION_ROUTE,
  type HybridSimulationSessionAuthorityV1,
} from "../../src/shared/hybrid-simulation-contracts";

const START_MS = Date.parse("2026-09-01T01:00:00.000Z");
const WORKSPACE_A = "workspace-sha256:a";
const WORKSPACE_B = "workspace-sha256:b";

function directoryIdentity(
  workspace: string,
  inode: string,
) {
  return {
    canonicalWorkspaceIdentity: workspace,
    device: "1",
    inode,
  };
}

function issue(
  store: HybridSimulationConsentChallengeStore,
  workspace = WORKSPACE_A,
  inode = workspace === WORKSPACE_A ? "101" : "202",
) {
  return store.issue(
    workspace,
    directoryIdentity(workspace, inode),
    store.captureIssueGeneration(),
  );
}

function consume(
  store: HybridSimulationConsentChallengeStore,
  challengeId: string,
  acknowledgementWorkspace = WORKSPACE_A,
  currentIdentity = directoryIdentity(WORKSPACE_A, "101"),
) {
  return store.consume(
    acknowledgement(challengeId, acknowledgementWorkspace),
    async () => currentIdentity,
  );
}

function authority(): HybridSimulationSessionAuthorityV1 {
  return {
    schemaVersion: "hybrid-simulation-session-authority-v1",
    simulationAuthorityId: "hybrid-simulation-authority-v1",
    disclosureVersion: HYBRID_SIMULATION_DISCLOSURE_VERSION,
    disclosureTextSha256: HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
    route: HYBRID_SIMULATION_ROUTE,
    resultMarker: HYBRID_SIMULATION_RESULT_MARKER,
    costScope: "simulation",
    simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
    egressConsent: "none",
    maxSimulatedSpendMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    fakeLocalProvider: { providerId: "fake-local", model: "fake-local-v1" },
    fakeCloudProvider: { providerId: "fake-cloud", model: "fake-cloud-v1" },
    riskPolicyId: "review-risk-v1",
    routerPolicyVersion: "hybrid-lease-router-v0",
    healthSnapshotId: "fake-cloud-health-v1",
    pricingSnapshotId: "fake-cloud-pricing-v1",
    credentialMetadataId: "fake-cloud-credential-v1",
    campaignId: "hybrid-simulation-campaign-v1",
    campaignCreatedAt: HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
  };
}

function acknowledgement(challengeId: string, workspace = WORKSPACE_A) {
  return {
    challengeId,
    acknowledged: true as const,
    canonicalWorkspaceIdentity: workspace,
    route: HYBRID_SIMULATION_ROUTE,
  };
}

describe("HybridSimulationConsentChallengeStore", () => {
  it("issues only renderer-safe disclosure fields and consumes once", async () => {
    let nextId = 0;
    const store = new HybridSimulationConsentChallengeStore({
      authority: authority(),
      nowMs: () => START_MS,
      idFactory: () => `challenge-${++nextId}`,
    });

    const challenge = issue(store);
    expect(challenge).toEqual({
      schemaVersion: "hybrid-simulation-consent-challenge-v1",
      challengeId: "challenge-1",
      expiresAt: "2026-09-01T01:05:00.000Z",
      disclosureText: HYBRID_SIMULATION_DISCLOSURE_TEXT,
      disclosureVersion: HYBRID_SIMULATION_DISCLOSURE_VERSION,
      disclosureTextSha256: HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
      route: HYBRID_SIMULATION_ROUTE,
      maxSimulatedSpendMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    });
    expect(JSON.stringify(challenge)).not.toContain(WORKSPACE_A);
    expect(JSON.stringify(challenge)).not.toContain('"providerId":"fake-cloud"');
    expect(JSON.stringify(challenge)).not.toContain("fake-cloud-v1");

    const consumed = await consume(store, challenge.challengeId);
    expect(consumed).toEqual({
      schemaVersion: "consumed-hybrid-simulation-consent-v1",
      canonicalWorkspaceIdentity: WORKSPACE_A,
      authority: authority(),
    });
    await expect(
      consume(store, challenge.challengeId),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_unknown_or_reused" }),
    );
  });

  it("burns a known challenge before returning mismatch or expiry", async () => {
    let now = START_MS;
    let nextId = 0;
    const store = new HybridSimulationConsentChallengeStore({
      authority: authority(),
      nowMs: () => now,
      idFactory: () => `challenge-${++nextId}`,
      challengeTtlMs: 1_000,
    });

    const mismatch = issue(store);
    await expect(
      consume(store, mismatch.challengeId, WORKSPACE_B),
    ).rejects.toThrowError(expect.objectContaining({ code: "challenge_mismatch" }));
    await expect(
      consume(store, mismatch.challengeId),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_unknown_or_reused" }),
    );

    const malformed = issue(store);
    await expect(
      store.consume({
        ...acknowledgement(malformed.challengeId),
        acknowledged: false,
      }, async () => directoryIdentity(WORKSPACE_A, "101")),
    ).rejects.toThrowError(expect.objectContaining({ code: "challenge_mismatch" }));
    await expect(
      consume(store, malformed.challengeId),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_unknown_or_reused" }),
    );

    const expired = issue(store);
    now += 1_000;
    await expect(
      consume(store, expired.challengeId),
    ).rejects.toThrowError(expect.objectContaining({ code: "challenge_expired" }));
    await expect(
      consume(store, expired.challengeId),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_unknown_or_reused" }),
    );
  });

  it("invalidates an older challenge for the same workspace and bounds capacity", async () => {
    let nextId = 0;
    const store = new HybridSimulationConsentChallengeStore({
      authority: authority(),
      nowMs: () => START_MS,
      idFactory: () => `challenge-${++nextId}`,
      maxOutstanding: 2,
    });

    const old = issue(store);
    const replacement = issue(store);
    await expect(consume(store, old.challengeId)).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_unknown_or_reused" }),
    );
    const other = issue(store, WORKSPACE_B);
    expect(() => issue(store, "workspace-sha256:c", "303")).toThrowError(
      expect.objectContaining({ code: "challenge_capacity_exhausted" }),
    );
    await expect(consume(store, replacement.challengeId)).resolves.toMatchObject({
      canonicalWorkspaceIdentity: WORKSPACE_A,
    });
    await expect(
      consume(
        store,
        other.challengeId,
        WORKSPACE_B,
        directoryIdentity(WORKSPACE_B, "202"),
      ),
    ).resolves.toMatchObject({ canonicalWorkspaceIdentity: WORKSPACE_B });
  });

  it("never reissues a challenge identity after invalidation or clear", () => {
    const store = new HybridSimulationConsentChallengeStore({
      authority: authority(),
      nowMs: () => START_MS,
      idFactory: () => "challenge-reused",
    });

    issue(store);
    expect(store.invalidateWorkspace(WORKSPACE_A)).toBe(true);
    expect(() => issue(store, WORKSPACE_B)).toThrow(
      /ID factory returned an invalid ID/u,
    );

    store.clear();
    expect(() => issue(store)).toThrow(
      /ID factory returned an invalid ID/u,
    );
  });

  it("burns route/workspace invalidation and rejects same-path directory replacement", async () => {
    let nextId = 0;
    const store = new HybridSimulationConsentChallengeStore({
      authority: authority(),
      nowMs: () => START_MS,
      idFactory: () => `challenge-${++nextId}`,
    });

    const invalidated = issue(store);
    store.clear();
    await expect(
      consume(store, invalidated.challengeId),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_unknown_or_reused" }),
    );

    const replaced = issue(store);
    await expect(
      consume(
        store,
        replaced.challengeId,
        WORKSPACE_A,
        directoryIdentity(WORKSPACE_A, "999"),
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_mismatch" }),
    );
    await expect(
      consume(store, replaced.challengeId),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_unknown_or_reused" }),
    );
  });

  it("does not issue after invalidation overtakes in-flight workspace validation", () => {
    const store = new HybridSimulationConsentChallengeStore({
      authority: authority(),
      nowMs: () => START_MS,
      idFactory: () => "challenge-1",
    });
    const generation = store.captureIssueGeneration();
    store.clear();

    expect(() =>
      store.issue(
        WORKSPACE_A,
        directoryIdentity(WORKSPACE_A, "101"),
        generation,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "challenge_unknown_or_reused" }),
    );
  });

  it("does not finish consumption after route invalidation overtakes identity validation", async () => {
    const store = new HybridSimulationConsentChallengeStore({
      authority: authority(),
      nowMs: () => START_MS,
      idFactory: () => "challenge-1",
    });
    const challenge = issue(store);

    await expect(
      store.consume(
        acknowledgement(challenge.challengeId),
        async () => {
          store.clear();
          return directoryIdentity(WORKSPACE_A, "101");
        },
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_mismatch" }),
    );
  });

  it("does not finish consumption after a replacement challenge overtakes it", async () => {
    let nextId = 0;
    const store = new HybridSimulationConsentChallengeStore({
      authority: authority(),
      nowMs: () => START_MS,
      idFactory: () => `challenge-${++nextId}`,
    });
    const oldChallenge = issue(store);
    let replacementChallengeId: string | undefined;

    await expect(
      store.consume(
        acknowledgement(oldChallenge.challengeId),
        async () => {
          replacementChallengeId = issue(store).challengeId;
          return directoryIdentity(WORKSPACE_A, "101");
        },
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_mismatch" }),
    );
    await expect(
      consume(store, replacementChallengeId!),
    ).resolves.toMatchObject({ canonicalWorkspaceIdentity: WORKSPACE_A });
  });

  it("burns a known challenge referenced by a forged outer IPC envelope", async () => {
    const store = new HybridSimulationConsentChallengeStore({
      authority: authority(),
      nowMs: () => START_MS,
      idFactory: () => "challenge-1",
    });
    const challenge = issue(store);

    expect(store.burnKnownChallenge(`  ${challenge.challengeId}  `)).toBe(true);
    expect(store.burnKnownChallenge(challenge.challengeId)).toBe(false);
    await expect(consume(store, challenge.challengeId)).rejects.toThrowError(
      expect.objectContaining({ code: "challenge_unknown_or_reused" }),
    );
  });

  it.each([
    [
      "disclosure hash",
      { disclosureTextSha256: "0".repeat(64) },
    ],
    ["simulated cap", { maxSimulatedSpendMicrousd: 249_999 }],
    [
      "canonical campaign time",
      { campaignCreatedAt: "2026-09-01T00:00:00.001Z" },
    ],
  ] as const)("rejects mismatched %s authority before issuing", (_name, patch) => {
    const mismatched = { ...authority(), ...patch };
    expect(
      () =>
        new HybridSimulationConsentChallengeStore({
          authority:
            mismatched as unknown as HybridSimulationSessionAuthorityV1,
          nowMs: () => START_MS,
        }),
    ).toThrow();
  });

  it("returns bounded safe errors without echoing workspace identity", async () => {
    const workspace = "workspace-sha256:private-identity";
    const store = new HybridSimulationConsentChallengeStore({
      authority: authority(),
      nowMs: () => START_MS,
      idFactory: () => "challenge-1",
    });
    const challenge = issue(store, workspace, "404");

    try {
      await consume(store, challenge.challengeId, WORKSPACE_B);
      throw new Error("expected challenge mismatch");
    } catch (error) {
      expect(error).toBeInstanceOf(HybridSimulationConsentChallengeError);
      expect(String(error)).not.toContain(workspace);
    }
  });
});
