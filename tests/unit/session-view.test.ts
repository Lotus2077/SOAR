import { describe, expect, it } from "vitest";

import type { EventStore, SessionRecord } from "../../src/main/event-store";
import { toSessionSnapshot } from "../../src/main/session-view";
import type { StoredSessionEvent } from "../../src/shared/session-events";
import type { SessionState } from "../../src/shared/session-reducer";

describe("renderer-safe session snapshots", () => {
  it("projects only the simulation reservation fields needed for accounting", () => {
    const sessionId = "00000000-0000-4000-8000-000000000030";
    const createdAt = "2026-09-01T00:00:00.000Z";
    const session: SessionRecord = {
      id: sessionId,
      title: "Review current changes",
      objective: "Review current changes",
      workspaceRoot: "/tmp/workspace",
      profile: "balanced",
      status: "running",
      lastSequence: 1,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalReasoningTokens: 0,
      totalCostUsd: 0,
      totalLatencyMs: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const state = {
      taskTrack: "change-review-v1",
      hybridSimulation: {},
    } as unknown as SessionState;
    const event = {
      id: "00000000-0000-4000-8000-000000000031",
      sessionId,
      sequence: 1,
      createdAt,
      type: "routing.decision.recorded",
      payload: {
        decisionId: "simulation-decision",
        boundary: "evidence_complete",
        phase: "synthesis",
        action: "assign_new_lease",
        reasonCode: "cloud_admitted",
        selectedProviderId: "fake-cloud-review",
        selectedModel: "Fake Cloud Review v1",
        costScope: "simulation",
        budgetReservationId: "simulation-reservation",
        billing: {
          billableInputTokens: 4_639,
          billableCacheReadTokens: 0,
          requestedMaxOutputTokens: 8_192,
          inputMicrousdPerMillionTokens: 1_000_000,
          outputMicrousdPerMillionTokens: 4_000_000,
          cacheReadMicrousdPerMillionTokens: 0,
          providerFeeCeilingMicrousd: 0,
          roundingPolicy: "ceil_each_component_v1",
          projectedCostMicrousd: 37_407,
          remainingEpisodeMicrousd: 250_000,
          remainingCampaignMicrousd: 250_000,
        },
      },
    } as unknown as StoredSessionEvent;
    const store = {
      requireSession: () => session,
      getProjectedState: () => state,
      getEvents: () => [event],
    } as unknown as EventStore;

    const snapshot = toSessionSnapshot(store, sessionId);
    const payload = snapshot.events[0]?.payload as Record<string, unknown>;

    expect(payload.budgetReservationId).toBe("simulation-reservation");
    expect(payload.billing).toEqual({ projectedCostMicrousd: 37_407 });
    for (const omittedBillingField of [
      "billableInputTokens",
      "billableCacheReadTokens",
      "requestedMaxOutputTokens",
      "inputMicrousdPerMillionTokens",
      "outputMicrousdPerMillionTokens",
      "cacheReadMicrousdPerMillionTokens",
      "providerFeeCeilingMicrousd",
      "roundingPolicy",
      "remainingEpisodeMicrousd",
      "remainingCampaignMicrousd",
    ]) {
      expect(payload.billing).not.toHaveProperty(omittedBillingField);
    }
  });
});
