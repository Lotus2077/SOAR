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

function metric(label: "Tokens" | "Cost"): HTMLElement {
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

    expect(metric("Tokens")).toHaveTextContent("TokensUnknown");
    expect(metric("Cost")).toHaveTextContent("CostUnknown");
    expect(metric("Tokens")).not.toHaveTextContent("Tokens0");
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

    expect(metric("Tokens")).toHaveTextContent("Tokens5");
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
});
