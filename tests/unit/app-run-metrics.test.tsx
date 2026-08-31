/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  HYBRID_SIMULATION_MARKER,
  StatusBar,
  summarizeRun,
  TracePanel,
} from "../../src/renderer/src/App";
import type { SessionSnapshot } from "../../src/shared/contracts";

afterEach(cleanup);

function snapshotWithUsage(
  ...usagePayloads: Array<Record<string, unknown>>
): SessionSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    title: "Inspect usage provenance",
    workspaceRoot: "/tmp/workspace",
    status: "completed",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:01.000Z",
    events: usagePayloads.map((payload, index) => ({
      id: `usage-${index + 1}`,
      sequence: index + 1,
      type: "usage.recorded",
      createdAt: `2026-08-29T00:00:0${index + 1}.000Z`,
      payload,
    })),
  };
}

function metric(
  label: "End-to-end" | "Total tokens" | "Cost" | "Actual external spend",
): HTMLElement {
  const labelElement = screen
    .getAllByText(label)
    .find((element) => element.matches(".metric-grid > div > span"));
  const container = labelElement?.parentElement ?? null;
  if (container === null) throw new Error(`Missing ${label} metric container`);
  return container;
}

describe("run metrics provenance", () => {
  it("renders unreported token and cost telemetry as unknown instead of zero", () => {
    const snapshot = snapshotWithUsage({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      reported: false,
      costUsd: 0,
      costProvenance: "unreported",
    });

    expect(summarizeRun(snapshot)).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      reported: false,
      cost: "Unknown",
      costProvenance: "unreported",
    });

    render(<TracePanel snapshot={snapshot} open={false} onClose={() => undefined} />);

    expect(metric("Total tokens")).toHaveTextContent("Total tokensUnknown");
    expect(metric("Cost")).toHaveTextContent("CostUnknown");
    expect(metric("Total tokens")).not.toHaveTextContent("Total tokens0");
    expect(metric("Cost")).not.toHaveTextContent("$0.00");
  });

  it("keeps reported local zero usage distinct from missing telemetry", () => {
    const snapshot = snapshotWithUsage({
      inputTokens: 3,
      outputTokens: 2,
      reasoningTokens: 0,
      reported: true,
      costUsd: 0,
      costProvenance: "local_zero_cost_policy",
    });

    expect(summarizeRun(snapshot)).toMatchObject({
      inputTokens: 3,
      outputTokens: 2,
      reported: true,
      cost: "$0.00",
      costProvenance: "local_zero_cost_policy",
    });

    render(<TracePanel snapshot={snapshot} open={false} onClose={() => undefined} />);

    expect(metric("Total tokens")).toHaveTextContent("Total tokens5");
    expect(metric("Cost")).toHaveTextContent("Cost$0.00");
  });

  it("marks an aggregate unknown when any usage record is unreported", () => {
    const snapshot = snapshotWithUsage(
      {
        inputTokens: 8,
        outputTokens: 3,
        reported: true,
        costUsd: 0.25,
        costProvenance: "provider_reported",
      },
      {
        inputTokens: 0,
        outputTokens: 0,
        reported: false,
        costUsd: 0,
        costProvenance: "unreported",
      },
    );

    expect(summarizeRun(snapshot)).toMatchObject({
      inputTokens: 8,
      outputTokens: 3,
      reported: false,
      cost: "Unknown",
      costProvenance: "unreported",
    });
  });

  it("uses v2 finished-attempt usage, route reason, and locality without double counting legacy telemetry", () => {
    const snapshot: SessionSnapshot = {
      id: "00000000-0000-4000-8000-000000000011",
      title: "Review current changes",
      workspaceRoot: "/tmp/workspace",
      taskTrack: "change-review-v1",
      status: "completed",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:01.000Z",
      events: [
        {
          id: "route",
          sequence: 1,
          type: "routing.decision.recorded",
          createdAt: "2026-08-30T00:00:00.100Z",
          payload: {
            selectedProviderId: "local-vllm",
            selectedModel: "local-review-model",
            reasonCode: "low_risk_local_review",
            routerInputSnapshot: {
              providers: [
                {
                  providerId: "local-vllm",
                  model: "local-review-model",
                  locality: "local",
                },
              ],
            },
          },
        },
        {
          id: "finished",
          sequence: 2,
          type: "inference.attempt.finished",
          createdAt: "2026-08-30T00:00:00.900Z",
          payload: {
            outcome: "succeeded",
            servedModel: "local-review-model",
            usage: {
              inputTokens: 11,
              outputTokens: 4,
              reasoningTokens: 2,
              reported: true,
            },
            cost: {
              amountMicrousd: 0,
              provenance: "local_zero_cost_policy",
            },
            latencyMs: 800,
          },
        },
        {
          id: "legacy-duplicate",
          sequence: 3,
          type: "usage.recorded",
          createdAt: "2026-08-30T00:00:01.000Z",
          payload: {
            inputTokens: 11,
            outputTokens: 4,
            reported: true,
            costUsd: 0,
            costProvenance: "local_zero_cost_policy",
            latencyMs: 800,
          },
        },
      ],
    };

    expect(summarizeRun(snapshot)).toMatchObject({
      model: "local-review-model",
      provider: "local-vllm",
      locality: "local",
      reason: "low_risk_local_review",
      inputTokens: 11,
      outputTokens: 4,
      reasoningTokens: 2,
      totalTokens: 17,
      duration: "1s",
      providerDuration: "800ms",
      cost: "$0.00",
    });

    render(<TracePanel snapshot={snapshot} open={false} onClose={() => undefined} />);

    expect(metric("End-to-end")).toHaveTextContent(
      "End-to-end1sProvider time 800ms",
    );
    expect(metric("Total tokens")).toHaveTextContent("Total tokens17");
    expect(screen.queryByText("Latency")).not.toBeInTheDocument();
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
  });

  it("separates simulation accounting from actual external provider spend", () => {
    const snapshot = {
      ...snapshotWithUsage(),
      executionMode: "hybrid_simulation" as const,
      simulationMarker: HYBRID_SIMULATION_MARKER,
      events: [
        {
          id: "route",
          sequence: 1,
          type: "routing.decision.recorded",
          createdAt: "2026-08-29T00:00:00.100Z",
          payload: {
            costScope: "simulation",
            budgetReservationId: "simulation-reservation",
            billing: { projectedCostMicrousd: 250_000 },
          },
        },
        {
          id: "finished",
          sequence: 2,
          type: "inference.attempt.finished",
          createdAt: "2026-08-29T00:00:00.900Z",
          payload: {
            usage: {
              inputTokens: 8,
              outputTokens: 3,
              reasoningTokens: 0,
              reported: true,
            },
            cost: {
              amountMicrousd: 120_000,
              provenance: "provider_reported",
              costScope: "simulation",
            },
            latencyMs: 800,
          },
        },
      ],
    };

    expect(summarizeRun(snapshot)).toMatchObject({
      simulationState: "attributed",
      cost: "$0.00",
      simulation: {
        settledMicrousd: 120_000,
        settlementProvenance: "provider_reported",
        actualExternalSpendMicrousd: 0,
      },
    });

    render(<TracePanel snapshot={snapshot} open onClose={() => undefined} />);

    expect(screen.getByText(HYBRID_SIMULATION_MARKER)).toBeVisible();
    expect(metric("Actual external spend")).toHaveTextContent(
      "Actual external spend$0.00",
    );
    expect(screen.getAllByText("Simulated $0.25").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Simulated $0.12").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Settled · Provider-reported simulated settlement"),
    ).toBeVisible();
    expect(screen.queryByText("Cost", { selector: "span" })).not.toBeInTheDocument();
  });

  it("does not report a denied projected cost as a simulated reservation", () => {
    const snapshot = {
      ...snapshotWithUsage(),
      executionMode: "hybrid_simulation" as const,
      simulationMarker: HYBRID_SIMULATION_MARKER,
      events: [
        {
          id: "budget-denied-route",
          sequence: 1,
          type: "routing.decision.recorded",
          createdAt: "2026-08-29T00:00:00.100Z",
          payload: {
            costScope: "simulation",
            reasonCode: "budget_denial",
            billing: { projectedCostMicrousd: 250_000 },
          },
        },
      ],
    };

    expect(summarizeRun(snapshot)).toMatchObject({
      simulationState: "attributed",
      simulation: {
        reservedMicrousd: 0,
        settledMicrousd: 0,
        actualExternalSpendMicrousd: 0,
      },
    });
  });

  it("keeps a failed fake-cloud reservation attributed after Local fallback", () => {
    const reservedMicrousd = 37_407;
    const snapshot = {
      ...snapshotWithUsage(),
      executionMode: "hybrid_simulation" as const,
      simulationMarker: HYBRID_SIMULATION_MARKER,
      events: [
        {
          id: "cloud-route",
          sequence: 1,
          type: "routing.decision.recorded",
          createdAt: "2026-08-29T00:00:00.100Z",
          payload: {
            costScope: "simulation",
            budgetReservationId: "simulation-reservation",
            billing: { projectedCostMicrousd: reservedMicrousd },
          },
        },
        {
          id: "cloud-finished",
          sequence: 2,
          type: "inference.attempt.finished",
          createdAt: "2026-08-29T00:00:00.500Z",
          payload: {
            outcome: "provider_error",
            requestDisposition: "unknown",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              reasoningTokens: 0,
              reported: false,
            },
            cost: {
              amountMicrousd: reservedMicrousd,
              provenance: "reserved_unknown",
              costScope: "simulation",
            },
            latencyMs: 0,
          },
        },
        {
          id: "fallback-route",
          sequence: 3,
          type: "routing.decision.recorded",
          createdAt: "2026-08-29T00:00:00.600Z",
          payload: {
            costScope: "simulation",
            reasonCode: "local_fallback",
          },
        },
        {
          id: "fallback-finished",
          sequence: 4,
          type: "inference.attempt.finished",
          createdAt: "2026-08-29T00:00:00.900Z",
          payload: {
            outcome: "succeeded",
            requestDisposition: "sent",
            usage: {
              inputTokens: 96,
              outputTokens: 48,
              reasoningTokens: 0,
              reported: true,
            },
            cost: {
              amountMicrousd: 0,
              provenance: "local_zero_cost_policy",
              costScope: "simulation",
            },
            latencyMs: 300,
          },
        },
      ],
    };

    expect(summarizeRun(snapshot)).toMatchObject({
      simulationState: "attributed",
      cost: "$0.00",
      simulation: {
        reservedMicrousd,
        settledMicrousd: reservedMicrousd,
        settlementProvenance: "reserved_unknown",
        actualExternalSpendMicrousd: 0,
      },
    });

    render(<TracePanel snapshot={snapshot} open onClose={() => undefined} />);
    expect(metric("Actual external spend")).toHaveTextContent("$0.00");
    expect(screen.getAllByText("Simulated $0.04").length).toBeGreaterThan(0);
    expect(screen.queryByText("Withheld")).not.toBeInTheDocument();
  });

  it("shows a recorded simulation overrun in full on a failed terminal run", () => {
    const snapshot = {
      ...snapshotWithUsage(),
      status: "failed" as const,
      executionMode: "hybrid_simulation" as const,
      simulationMarker: HYBRID_SIMULATION_MARKER,
      events: [
        {
          id: "route",
          sequence: 1,
          type: "routing.decision.recorded",
          createdAt: "2026-08-29T00:00:00.100Z",
          payload: {
            costScope: "simulation",
            budgetReservationId: "simulation-reservation",
            billing: { projectedCostMicrousd: 250_000 },
          },
        },
        {
          id: "finished-overrun",
          sequence: 2,
          type: "inference.attempt.finished",
          createdAt: "2026-08-29T00:00:00.900Z",
          payload: {
            usage: {
              inputTokens: 8,
              outputTokens: 3,
              reasoningTokens: 0,
              reported: true,
            },
            cost: {
              amountMicrousd: 300_000,
              provenance: "provider_reported",
              costScope: "simulation",
            },
            latencyMs: 800,
          },
        },
      ],
    };

    expect(summarizeRun(snapshot)).toMatchObject({
      simulationState: "attributed",
      cost: "$0.00",
      simulation: {
        reservedMicrousd: 250_000,
        settledMicrousd: 300_000,
        settlementProvenance: "provider_reported",
        actualExternalSpendMicrousd: 0,
      },
    });

    render(<TracePanel snapshot={snapshot} open onClose={() => undefined} />);
    expect(screen.getByText(HYBRID_SIMULATION_MARKER)).toBeVisible();
    expect(screen.getByText("Simulated $0.30")).toBeVisible();
    expect(metric("Actual external spend")).toHaveTextContent("$0.00");
  });

  it("withholds route and cost when a simulation snapshot loses its exact marker", () => {
    const snapshot = {
      ...snapshotWithUsage(),
      executionMode: "hybrid_simulation" as const,
      simulationMarker: "Fake review",
      events: [
        {
          id: "malformed-attributed-route",
          sequence: 1,
          type: "routing.decision.recorded",
          createdAt: "2026-08-29T00:00:00.100Z",
          payload: {
            costScope: "simulation",
            selectedProviderId: "fake-local-review",
            selectedModel: "fake-local-model",
            reasonCode: "low_risk_local_review",
            routerInputSnapshot: {
              providers: [
                {
                  providerId: "fake-local-review",
                  model: "fake-local-model",
                  locality: "local",
                },
              ],
            },
          },
        },
      ],
    };

    expect(summarizeRun(snapshot)).toMatchObject({
      simulationState: "invalid",
      model: null,
      provider: null,
      locality: null,
      cost: "Withheld",
      simulation: null,
    });

    render(
      <>
        <TracePanel snapshot={snapshot} open onClose={() => undefined} />
        <StatusBar snapshot={snapshot} />
      </>,
    );
    expect(
      screen.getByText(
        "Simulation attribution unavailable — route and cost details withheld.",
      ),
    ).toBeVisible();
    expect(metric("Cost")).toHaveTextContent("CostWithheld");
    expect(screen.queryByText("Simulated $0.12")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Activity details are withheld until simulation attribution is valid.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Activity")).not.toBeInTheDocument();
    expect(screen.getByTestId("route-model")).toHaveTextContent("Route withheld");
    expect(screen.getByText("Locality withheld")).toBeVisible();
    expect(screen.getByTestId("route-cost")).toHaveTextContent("Withheld");
    expect(screen.queryByText("fake-local-model")).not.toBeInTheDocument();
  });
});
