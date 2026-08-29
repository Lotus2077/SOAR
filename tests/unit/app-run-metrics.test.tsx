/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { summarizeRun, TracePanel } from "../../src/renderer/src/App";
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

function metric(label: "End-to-end" | "Total tokens" | "Cost"): HTMLElement {
  const container = screen.getByText(label).parentElement;
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
});
