/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  App,
  ChangeReviewWorkspace,
  HYBRID_SIMULATION_MARKER,
  MarkdownContent,
  ReviewSetup,
  reviewMarkdown,
} from "../../src/renderer/src/App";
import type { SessionSnapshot } from "../../src/shared/contracts";
import {
  HYBRID_SIMULATION_DISCLOSURE_TEXT,
  HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
} from "../../src/shared/hybrid-simulation-contracts";

afterEach(cleanup);

const availability = {
  local: {
    enabled: true,
    label: "Local vLLM",
    providerId: "local-vllm",
    model: "local-review-model",
    declaredTokenFeeMicrousd: 0 as const,
    costAccountingSummary:
      "The configured vLLM route declares a $0 token fee; endpoint billing and infrastructure costs are not independently verified." as const,
    evidenceTransportSummary:
      "Review evidence is sent to the configured vLLM endpoint." as const,
  },
  hybrid: {
    enabled: false as const,
    reason:
      "Cloud setup does not enable Hybrid. Hybrid dispatch is locked in this build." as const,
    separatelyConfiguredPaidProviderReachable: false as const,
    reachabilitySummary:
      "This build performs no cloud-provider validation or dispatch." as const,
    consent: "none" as const,
  },
};

const snapshot: SessionSnapshot = {
  id: "00000000-0000-4000-8000-000000000020",
  title: "Review current changes",
  workspaceRoot: "/tmp/workspace",
  taskTrack: "change-review-v1",
  status: "completed",
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:03.000Z",
  events: [],
};

const reviewResult = {
  schemaVersion: "change-review-result-v1",
  snapshotId: "a".repeat(64),
  evidenceSetId: "b".repeat(64),
  summary: "The route can lose a required fallback.",
  conclusion: "blocking_findings",
  omissions: [],
  findings: [
    {
      findingId: "finding-1",
      severity: "P1",
      title: "Fallback is skipped after timeout",
      impact: "The review terminates without a local result.",
      suggestedCorrection: "Retain the local lease before dispatch.",
      suggestedTest: "Add a timeout regression with a local fallback.",
      evidence: [
        {
          kind: "change",
          path: "src/main/router.ts",
          side: "working",
          line: 42,
        },
      ],
    },
  ],
};

const coverage = {
  schemaVersion: "review-coverage-view-v1",
  status: "complete",
  counts: {
    changedPaths: 2,
    admittedPaths: 2,
    omittedPaths: 0,
    changedHunks: 3,
    admittedHunks: 3,
    omittedHunks: 0,
  },
  changedTestCount: 1,
  runtimeCodeChangedWithoutChangedTest: false,
  snapshotRevalidated: true,
  omissionCodes: [],
};

const view = {
  sessionId: snapshot.id,
  status: "completed",
  freshness: "fresh_complete" as const,
  phases: [
    { id: "inspection" as const, status: "complete" as const, label: "Local inspection" },
    { id: "checkpoint" as const, status: "complete" as const, label: "Routing checkpoint" },
    { id: "synthesis" as const, status: "complete" as const, label: "Local synthesis" },
    { id: "fallback" as const, status: "pending" as const, label: "Fallback" },
  ],
  route: {
    providerId: "local-vllm",
    model: "local-review-model",
    locality: "local" as const,
    reasonCode: "low_risk_local_review",
  },
  reviewResult,
  coverage,
  baseRevision: "0123456789ab",
  acceptanceNote: "Accepted against the current snapshot.",
};

const simulationAvailability = {
  local: {
    ...availability.local,
    label: "Fake Local",
    providerId: "fake-local-review",
    model: "fake-local-review",
  },
  hybrid: {
    enabled: true as const,
    mode: "simulation" as const,
    reason:
      "Simulation is independent of Cloud Settings and never reads your stored credential." as const,
    separatelyConfiguredPaidProviderReachable: false as const,
    reachabilitySummary:
      "Two in-process Fake models; no external provider is contacted." as const,
    consent: "simulation_cloud_synthesis_v1" as const,
    label: "Hybrid simulation",
  },
};

const simulationChallenge = {
  schemaVersion: "hybrid-simulation-consent-challenge-v1" as const,
  challengeId: "challenge-1",
  expiresAt: "2099-09-01T01:00:00.000Z",
  disclosureText: HYBRID_SIMULATION_DISCLOSURE_TEXT,
  disclosureVersion: "hybrid-simulation-disclosure-v1" as const,
  disclosureTextSha256: HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
  route: "hybrid_simulation" as const,
  maxSimulatedSpendMicrousd: 250_000 as const,
};

const simulationProjection = {
  marker: HYBRID_SIMULATION_MARKER,
  costScope: "simulation" as const,
  maxSimulatedSpendMicrousd: 250_000,
  reservedMicrousd: 250_000,
  settledMicrousd: 120_000,
  settlementProvenance: "provider_reported" as const,
  actualExternalSpendMicrousd: 0 as const,
};

const simulationRoutes = [
  {
    phaseId: "inspection" as const,
    providerLabel: "Fake Local",
    model: "fake-local-review",
    locality: "local" as const,
    status: "complete" as const,
    reason: "Repository evidence was inspected locally.",
    latencyMs: 12,
    actualExternalSpendMicrousd: 0 as const,
  },
  {
    phaseId: "synthesis" as const,
    providerLabel: "Fake Cloud",
    model: "fake-cloud-review",
    locality: "cloud" as const,
    status: "complete" as const,
    reason: "The bounded fake-cloud simulation was admitted.",
    latencyMs: 35,
    simulatedReservedMicrousd: 250_000,
    simulatedSettledMicrousd: 120_000,
    simulatedSettlementProvenance: "provider_reported" as const,
    actualExternalSpendMicrousd: 0 as const,
  },
];

const simulationView = {
  ...view,
  executionMode: "hybrid_simulation" as const,
  routes: simulationRoutes,
  simulation: simulationProjection,
};

const simulationSnapshot = {
  ...snapshot,
  executionMode: "hybrid_simulation" as const,
  simulationMarker: HYBRID_SIMULATION_MARKER,
};

function relativeLuminance([red, green, blue]: readonly number[]): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const normalized = channel! / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(
  foreground: readonly number[],
  background: readonly number[],
): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

describe("Review Current Changes renderer", () => {
  it("keeps light-theme Complete small text above WCAG AA contrast", () => {
    const css = readFileSync(
      "src/renderer/src/styles.css",
      "utf8",
    );
    const lightTheme = css.slice(0, css.indexOf("@media (prefers-color-scheme: dark)"));
    const green = lightTheme.match(/--green:\s*#([0-9a-f]{6})/iu)?.[1];
    const soft = lightTheme.match(
      /--green-soft:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/u,
    );
    if (!green || !soft) throw new Error("Light Complete colors are missing.");
    const foreground = green.match(/../gu)!.map((value) => parseInt(value, 16));
    const alpha = Number(soft[4]);
    const background = soft.slice(1, 4).map((value) =>
      Math.round(Number(value) * alpha + 255 * (1 - alpha)),
    );

    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("enters the review flow from the sidebar and creates a dedicated local review session", async () => {
    const user = userEvent.setup();
    const created: SessionSnapshot = {
      ...snapshot,
      status: "running",
      updatedAt: "2026-08-30T00:00:01.000Z",
    };
    const createChangeReviewSession = vi.fn().mockResolvedValue(created);
    const startSession = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        chooseWorkspace: vi.fn().mockResolvedValue({
          path: "/tmp/workspace",
          name: "workspace",
        }),
        createSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([]),
        getSession: vi.fn().mockResolvedValue(created),
        startSession,
        cancelSession: vi.fn().mockResolvedValue(undefined),
        subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
        getReviewAvailability: vi.fn().mockResolvedValue(availability),
        createChangeReviewSession,
        getChangeReviewView: vi.fn().mockResolvedValue({
          ...view,
          status: "running",
          freshness: "pending",
          reviewResult: undefined,
          coverage: undefined,
        }),
      },
    });

    render(<App />);
    const newTask = screen.getByRole("button", { name: /New task/u });
    const reviewEntry = screen.getAllByRole("button", {
      name: "Review Current Changes",
    })[0]!;
    expect(newTask.compareDocumentPosition(reviewEntry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(reviewEntry);
    expect(await screen.findByRole("heading", { name: "Review current changes" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Choose" }));
    await user.click(await screen.findByRole("button", { name: "Start local review" }));

    await waitFor(() => {
      expect(createChangeReviewSession).toHaveBeenCalledWith({
        workspaceRoot: "/tmp/workspace",
        route: "local",
      });
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(await screen.findByText("Inspecting your changes")).toBeVisible();
  });

  it("shows a flat local setup with an honest disabled Hybrid policy", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    const openCloudSettings = vi.fn();
    const start = vi.fn();
    render(
      <ReviewSetup
        workspace={{ path: "/tmp/workspace", name: "workspace" }}
        availability={availability}
        loading={false}
        busy={false}
        onChooseWorkspace={choose}
        onOpenCloudSettings={openCloudSettings}
        onStart={start}
      />,
    );

    expect(screen.getByRole("heading", { name: "Review current changes" })).toBeVisible();
    expect(
      screen.getByText(
        "Cloud setup does not enable Hybrid. Hybrid dispatch is locked in this build.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Declared token fee")).toBeVisible();
    expect(screen.getByText("$0")).toBeVisible();
    expect(screen.getByText("Paid cloud consent")).toBeVisible();
    expect(screen.getByText("Off")).toBeVisible();
    expect(
      screen.getByText(/Review evidence is sent to the configured vLLM endpoint/u),
    ).toBeVisible();
    expect(
      screen.getByText(/configured vLLM route declares a \$0 token fee/u),
    ).toBeVisible();
    expect(
      screen.getByText(/no cloud-provider validation or dispatch/u),
    ).toBeVisible();
    expect(screen.queryByText("$0.25")).not.toBeInTheDocument();

    const hybrid = screen.getByRole("radio", { name: "Hybrid" });
    expect(hybrid).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Set up cloud" }));
    expect(openCloudSettings).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Start local review" }));
    expect(start).toHaveBeenCalledOnce();
  });

  it("keeps Local as the default and gates Hybrid simulation on a current unchecked disclosure", async () => {
    const user = userEvent.setup();
    const onRouteChange = vi.fn();
    const onConsentChange = vi.fn();
    const onStart = vi.fn();
    const { rerender } = render(
      <ReviewSetup
        workspace={{ path: "/tmp/workspace", name: "workspace" }}
        availability={simulationAvailability}
        loading={false}
        busy={false}
        onChooseWorkspace={() => undefined}
        onOpenCloudSettings={() => undefined}
        onRouteChange={onRouteChange}
        onConsentChange={onConsentChange}
        onStart={onStart}
      />,
    );

    expect(screen.getByRole("radio", { name: "Local" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Hybrid simulation" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Set up cloud" })).not.toBeInTheDocument();
    expect(screen.queryByText(HYBRID_SIMULATION_MARKER)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Local uses the in-process Fake Local model/u),
    ).toBeVisible();
    expect(screen.queryByText(/configured vLLM route/u)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Hybrid simulation" }));
    expect(onRouteChange).toHaveBeenCalledWith("hybrid_simulation");

    rerender(
      <ReviewSetup
        workspace={{ path: "/tmp/workspace", name: "workspace" }}
        availability={simulationAvailability}
        loading={false}
        busy={false}
        route="hybrid_simulation"
        challenge={simulationChallenge}
        consentChecked={false}
        onChooseWorkspace={() => undefined}
        onOpenCloudSettings={() => undefined}
        onRouteChange={onRouteChange}
        onConsentChange={onConsentChange}
        onStart={onStart}
      />,
    );

    expect(screen.getByText(HYBRID_SIMULATION_MARKER)).toBeVisible();
    expect(document.querySelector(".review-disclosure-copy")).toHaveTextContent(
      "Hybrid simulation never contacts an external provider",
    );
    expect(
      screen.getByText(
        "Simulation is independent of Cloud Settings and never reads your stored credential.",
      ),
    ).toBeVisible();
    expect(screen.getAllByText("Simulated $0.25").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Actual external spend").length).toBeGreaterThan(0);
    const consent = screen.getByRole("checkbox", {
      name: /acknowledge this challenge-bound fake simulation disclosure/u,
    });
    expect(consent).not.toBeChecked();
    expect(consent).toHaveFocus();
    expect(screen.getByRole("button", { name: "Start Hybrid simulation" })).toBeDisabled();

    await user.click(consent);
    expect(onConsentChange).toHaveBeenCalledWith(true);
  });

  it("issues a workspace-bound challenge and submits only its opaque acknowledgement", async () => {
    const user = userEvent.setup();
    const created = {
      ...simulationSnapshot,
      status: "running",
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    const issueHybridSimulationConsentChallenge = vi
      .fn()
      .mockResolvedValue(simulationChallenge);
    const invalidateHybridSimulationConsentChallenges = vi
      .fn()
      .mockResolvedValue(undefined);
    const createChangeReviewSession = vi.fn().mockResolvedValue(created);
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        chooseWorkspace: vi.fn().mockResolvedValue({
          path: "/tmp/workspace",
          name: "workspace",
        }),
        createSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([]),
        getSession: vi.fn().mockResolvedValue(created),
        startSession: vi.fn(),
        cancelSession: vi.fn(),
        subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
        getReviewAvailability: vi.fn().mockResolvedValue(simulationAvailability),
        issueHybridSimulationConsentChallenge,
        invalidateHybridSimulationConsentChallenges,
        createChangeReviewSession,
        getChangeReviewView: vi.fn().mockResolvedValue({
          ...simulationView,
          status: "running",
          freshness: "pending",
          reviewResult: undefined,
          coverage: undefined,
        }),
      },
    });

    render(<App />);
    await user.click(
      screen.getAllByRole("button", { name: "Review Current Changes" })[0]!,
    );
    await user.click(await screen.findByRole("button", { name: "Choose" }));
    await user.click(screen.getByRole("radio", { name: "Hybrid simulation" }));

    const consent = await screen.findByRole("checkbox", {
      name: /acknowledge this challenge-bound fake simulation disclosure/u,
    });
    expect(issueHybridSimulationConsentChallenge).toHaveBeenCalledWith({
      workspaceRoot: "/tmp/workspace",
      route: "hybrid_simulation",
    });
    expect(consent).not.toBeChecked();
    expect(consent).toHaveFocus();
    const start = screen.getByRole("button", { name: "Start Hybrid simulation" });
    expect(start).toBeDisabled();

    await user.click(consent);
    expect(start).toBeEnabled();
    await user.click(start);

    await waitFor(() =>
      expect(createChangeReviewSession).toHaveBeenCalledWith({
        workspaceRoot: "/tmp/workspace",
        route: "hybrid_simulation",
        challengeId: simulationChallenge.challengeId,
        acknowledged: true,
      }),
    );
    const submitted = createChangeReviewSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(submitted).not.toHaveProperty("providerId");
    expect(submitted).not.toHaveProperty("model");
    expect(submitted).not.toHaveProperty("endpoint");
    expect(submitted).not.toHaveProperty("maxSimulatedSpendMicrousd");
    expect(submitted).not.toHaveProperty("disclosureText");
  });

  it("announces a stale disclosure inline and restores focus to the retry action", () => {
    render(
      <ReviewSetup
        workspace={{ path: "/tmp/workspace", name: "workspace" }}
        availability={simulationAvailability}
        loading={false}
        busy={false}
        route="hybrid_simulation"
        consentError="This disclosure expired. Prepare a new disclosure before starting."
        onChooseWorkspace={() => undefined}
        onOpenCloudSettings={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This disclosure expired",
    );
    expect(
      screen.getByRole("button", { name: "Prepare a new disclosure" }),
    ).toHaveFocus();
  });

  it("clears acknowledgement and replaces the challenge when the repository changes", async () => {
    const user = userEvent.setup();
    const replacementChallenge = {
      ...simulationChallenge,
      challengeId: "challenge-2",
    };
    const chooseWorkspace = vi
      .fn()
      .mockResolvedValueOnce({ path: "/tmp/workspace-a", name: "workspace-a" })
      .mockResolvedValueOnce({ path: "/tmp/workspace-b", name: "workspace-b" });
    const issueHybridSimulationConsentChallenge = vi
      .fn()
      .mockResolvedValueOnce(simulationChallenge)
      .mockResolvedValueOnce(replacementChallenge);
    const invalidateHybridSimulationConsentChallenges = vi
      .fn()
      .mockResolvedValue(undefined);
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        chooseWorkspace,
        createSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([]),
        getSession: vi.fn(),
        startSession: vi.fn(),
        cancelSession: vi.fn(),
        subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
        getReviewAvailability: vi.fn().mockResolvedValue(simulationAvailability),
        issueHybridSimulationConsentChallenge,
        invalidateHybridSimulationConsentChallenges,
        createChangeReviewSession: vi.fn(),
        getChangeReviewView: vi.fn(),
      },
    });

    render(<App />);
    await user.click(
      screen.getAllByRole("button", { name: "Review Current Changes" })[0]!,
    );
    await user.click(await screen.findByRole("button", { name: "Choose" }));
    await user.click(screen.getByRole("radio", { name: "Hybrid simulation" }));
    const firstConsent = await screen.findByRole("checkbox", {
      name: /acknowledge this challenge-bound fake simulation disclosure/u,
    });
    await user.click(firstConsent);
    expect(firstConsent).toBeChecked();

    const invalidationsBeforeWorkspaceChange =
      invalidateHybridSimulationConsentChallenges.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Change" }));
    const replacementConsent = await screen.findByRole("checkbox", {
      name: /acknowledge this challenge-bound fake simulation disclosure/u,
    });
    expect(replacementConsent).not.toBeChecked();
    expect(replacementConsent).toHaveFocus();
    expect(issueHybridSimulationConsentChallenge).toHaveBeenNthCalledWith(2, {
      workspaceRoot: "/tmp/workspace-b",
      route: "hybrid_simulation",
    });
    expect(
      invalidateHybridSimulationConsentChallenges.mock.calls.length,
    ).toBeGreaterThan(invalidationsBeforeWorkspaceChange);
    expect(screen.getByRole("button", { name: "Start Hybrid simulation" })).toBeDisabled();

    const invalidationsBeforeLocalRoute =
      invalidateHybridSimulationConsentChallenges.mock.calls.length;
    await user.click(screen.getByRole("radio", { name: "Local" }));
    await waitFor(() =>
      expect(
        invalidateHybridSimulationConsentChallenges.mock.calls.length,
      ).toBeGreaterThan(invalidationsBeforeLocalRoute),
    );
    expect(
      screen.queryByRole("checkbox", {
        name: /acknowledge this challenge-bound fake simulation disclosure/u,
      }),
    ).not.toBeInTheDocument();
  });

  it("reissues an unchecked disclosure for the unchanged repository when the picker is cancelled", async () => {
    const user = userEvent.setup();
    const replacementChallenge = {
      ...simulationChallenge,
      challengeId: "challenge-after-cancel",
    };
    const chooseWorkspace = vi
      .fn()
      .mockResolvedValueOnce({ path: "/tmp/workspace-a", name: "workspace-a" })
      .mockResolvedValueOnce(null);
    const issueHybridSimulationConsentChallenge = vi
      .fn()
      .mockResolvedValueOnce(simulationChallenge)
      .mockResolvedValueOnce(replacementChallenge);
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        chooseWorkspace,
        createSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([]),
        getSession: vi.fn(),
        startSession: vi.fn(),
        cancelSession: vi.fn(),
        subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
        getReviewAvailability: vi.fn().mockResolvedValue(simulationAvailability),
        issueHybridSimulationConsentChallenge,
        invalidateHybridSimulationConsentChallenges: vi
          .fn()
          .mockResolvedValue(undefined),
        createChangeReviewSession: vi.fn(),
        getChangeReviewView: vi.fn(),
      },
    });

    render(<App />);
    await user.click(
      screen.getAllByRole("button", { name: "Review Current Changes" })[0]!,
    );
    await user.click(await screen.findByRole("button", { name: "Choose" }));
    await user.click(screen.getByRole("radio", { name: "Hybrid simulation" }));
    const firstConsent = await screen.findByRole("checkbox", {
      name: /acknowledge this challenge-bound fake simulation disclosure/u,
    });
    await user.click(firstConsent);
    expect(firstConsent).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Change" }));

    await waitFor(() =>
      expect(issueHybridSimulationConsentChallenge).toHaveBeenNthCalledWith(2, {
        workspaceRoot: "/tmp/workspace-a",
        route: "hybrid_simulation",
      }),
    );
    const replacementConsent = await screen.findByRole("checkbox", {
      name: /acknowledge this challenge-bound fake simulation disclosure/u,
    });
    expect(replacementConsent).not.toBeChecked();
    expect(replacementConsent).toHaveFocus();
    expect(screen.getByText("/tmp/workspace-a")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Start Hybrid simulation" }),
    ).toBeDisabled();
  });

  it("keeps the workspace and Hybrid route unchanged when main cannot burn consent", async () => {
    const user = userEvent.setup();
    const chooseWorkspace = vi
      .fn()
      .mockResolvedValue({ path: "/tmp/workspace-a", name: "workspace-a" });
    const invalidateHybridSimulationConsentChallenges = vi
      .fn()
      .mockResolvedValue(undefined);
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        chooseWorkspace,
        createSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([]),
        getSession: vi.fn(),
        startSession: vi.fn(),
        cancelSession: vi.fn(),
        subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
        getReviewAvailability: vi.fn().mockResolvedValue(simulationAvailability),
        issueHybridSimulationConsentChallenge: vi
          .fn()
          .mockResolvedValue(simulationChallenge),
        invalidateHybridSimulationConsentChallenges,
        createChangeReviewSession: vi.fn(),
        getChangeReviewView: vi.fn(),
      },
    });

    render(<App />);
    await user.click(
      screen.getAllByRole("button", { name: "Review Current Changes" })[0]!,
    );
    await user.click(await screen.findByRole("button", { name: "Choose" }));
    await user.click(screen.getByRole("radio", { name: "Hybrid simulation" }));
    await screen.findByRole("checkbox", {
      name: /acknowledge this challenge-bound fake simulation disclosure/u,
    });

    invalidateHybridSimulationConsentChallenges.mockRejectedValueOnce(
      new Error("main unavailable"),
    );
    await user.click(screen.getByRole("button", { name: "Change" }));
    await screen.findByText(
      /workspace cannot change until the previous Hybrid simulation disclosure is revoked/u,
    );
    expect(chooseWorkspace).toHaveBeenCalledOnce();
    expect(screen.getByRole("radio", { name: "Hybrid simulation" })).toBeChecked();

    invalidateHybridSimulationConsentChallenges.mockRejectedValueOnce(
      new Error("main unavailable"),
    );
    await user.click(screen.getByRole("radio", { name: "Local" }));
    await screen.findByText(
      /previous Hybrid simulation disclosure could not be revoked/u,
    );
    expect(screen.getByRole("radio", { name: "Hybrid simulation" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Local" })).not.toBeChecked();
  });

  it("revalidates a displayed review on window focus and withholds a drifted result", async () => {
    const getChangeReviewView = vi
      .fn()
      .mockResolvedValueOnce(view)
      .mockResolvedValueOnce({
        ...view,
        freshness: "drifted",
        acceptanceNote: "The workspace changed after this review completed.",
      });
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        chooseWorkspace: vi.fn().mockResolvedValue(null),
        createSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([snapshot]),
        getSession: vi.fn().mockResolvedValue(snapshot),
        startSession: vi.fn(),
        cancelSession: vi.fn(),
        subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
        getReviewAvailability: vi.fn().mockResolvedValue(availability),
        createChangeReviewSession: vi.fn().mockResolvedValue(snapshot),
        getChangeReviewView,
      },
    });

    render(<App />);
    expect(await screen.findByText("Fresh and complete")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy Markdown" })).toBeVisible();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(await screen.findByText("Workspace changed")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).not.toBeInTheDocument();
    expect(getChangeReviewView).toHaveBeenCalledTimes(2);
  });

  it("announces the active review phase with textual status and aria-current", () => {
    render(
      <ChangeReviewWorkspace
        snapshot={{ ...snapshot, status: "running" }}
        view={{
          ...view,
          status: "running",
          freshness: "pending",
          phases: view.phases.map((phase) => ({
            ...phase,
            status:
              phase.id === "checkpoint"
                ? ("active" as const)
                : phase.id === "inspection"
                  ? ("complete" as const)
                  : ("pending" as const),
            ...(phase.id === "checkpoint"
              ? {
                  providerLabel: "Fake Cloud",
                  model: "fake-cloud-review",
                  reason: "cloud_admitted",
                  latencyMs: 9,
                  simulatedReservedMicrousd: 250_000,
                  actualExternalSpendMicrousd: 0 as const,
                }
              : {}),
          })),
          reviewResult: undefined,
          coverage: undefined,
        }}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    const activePhase = screen
      .getByText("Routing checkpoint")
      .closest("li");
    expect(activePhase).toHaveAttribute("aria-current", "step");
    expect(activePhase).toHaveTextContent("Active");
    expect(activePhase).toHaveTextContent("Fake Cloud · fake-cloud-review");
    expect(activePhase).toHaveTextContent("Simulated $0.25 reserved");
    expect(activePhase).toHaveTextContent("Actual external spend $0");
    expect(screen.getByText("Local inspection").closest("li")).toHaveTextContent(
      "Complete",
    );
  });

  it("refreshes when visible and ignores an older focus response that finishes last", async () => {
    let resolveOlderRefresh: ((value: typeof view) => void) | undefined;
    const olderRefresh = new Promise<typeof view>((resolve) => {
      resolveOlderRefresh = resolve;
    });
    const driftedView = {
      ...view,
      freshness: "drifted" as const,
      acceptanceNote: "The workspace changed after this review completed.",
    };
    const getChangeReviewView = vi
      .fn()
      .mockResolvedValueOnce(view)
      .mockReturnValueOnce(olderRefresh)
      .mockResolvedValueOnce(driftedView);
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        chooseWorkspace: vi.fn().mockResolvedValue(null),
        createSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([snapshot]),
        getSession: vi.fn().mockResolvedValue(snapshot),
        startSession: vi.fn(),
        cancelSession: vi.fn(),
        subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
        getReviewAvailability: vi.fn().mockResolvedValue(availability),
        createChangeReviewSession: vi.fn().mockResolvedValue(snapshot),
        getChangeReviewView,
      },
    });

    render(<App />);
    expect(await screen.findByText("Fresh and complete")).toBeVisible();

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(getChangeReviewView).toHaveBeenCalledTimes(2));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(await screen.findByText("Workspace changed")).toBeVisible();
    await act(async () => {
      resolveOlderRefresh?.(view);
      await olderRefresh;
    });
    expect(screen.getByText("Workspace changed")).toBeVisible();
    expect(screen.queryByText("Fresh and complete")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).not.toBeInTheDocument();
    expect(getChangeReviewView).toHaveBeenCalledTimes(3);
  });

  it("renders accepted findings, host coverage, freshness, phases, and copies renderer-authored Markdown", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const getChangeReviewView = vi.fn().mockResolvedValue(view);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        getReviewAvailability: vi.fn().mockResolvedValue(availability),
        createChangeReviewSession: vi.fn().mockResolvedValue(snapshot),
        getChangeReviewView,
      },
    });

    render(
      <ChangeReviewWorkspace
        snapshot={snapshot}
        view={view}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText("Fresh and complete")).toBeVisible();
    expect(screen.getByText("Fallback is skipped after timeout")).toBeVisible();
    expect(screen.getByText("src/main/router.ts:42 · working · change")).toBeVisible();
    expect(screen.getByText("paths admitted").parentElement).toHaveTextContent("2 / 2");
    expect(screen.getByText("Local inspection")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Copy Markdown" }));
    expect(getChangeReviewView).toHaveBeenCalledWith(snapshot.id);
    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain("# Review current changes");
    expect(copied).toContain("### [P1] Fallback is skipped after timeout");
    expect(copied).toContain("`src/main/router.ts:42 · working · change`");
    expect(copied).not.toContain('"schemaVersion"');
    expect(reviewMarkdown(view)).toBe(copied);
  });

  it("keeps fake-provider, simulated-cost, and zero-spend attribution in result, route, copy, and replay", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        getReviewAvailability: vi.fn().mockResolvedValue(simulationAvailability),
        createChangeReviewSession: vi.fn().mockResolvedValue(simulationSnapshot),
        getChangeReviewView: vi.fn().mockResolvedValue(simulationView),
      },
    });

    render(
      <ChangeReviewWorkspace
        snapshot={simulationSnapshot}
        view={simulationView}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getAllByText(HYBRID_SIMULATION_MARKER).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("Fake Local")).toBeVisible();
    expect(screen.getByText("Fake Cloud")).toBeVisible();
    expect(screen.getAllByText("Simulated $0.25").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Simulated $0.12").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Provider-reported simulated settlement").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("$0").length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Review phases" })).toHaveTextContent(
      "Local inspectionComplete",
    );

    await user.click(screen.getByRole("button", { name: "Copy Markdown" }));
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain(HYBRID_SIMULATION_MARKER);
    expect(copied.match(new RegExp(HYBRID_SIMULATION_MARKER.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"))?.length).toBeGreaterThanOrEqual(2);
    expect(copied).toContain("Maximum reservation: Simulated $0.25");
    expect(copied).toContain(
      "Settled: Simulated $0.12 (Provider-reported simulated settlement)",
    );
    expect(copied).toContain("Actual external provider spend: $0");
  });

  it("withholds a claimed simulation result and copy when immutable attribution is incomplete", () => {
    const malformedSimulationView = {
      ...simulationView,
      simulation: {
        ...simulationProjection,
        marker: "Fake review",
      },
    };

    render(
      <ChangeReviewWorkspace
        snapshot={simulationSnapshot}
        view={malformedSimulationView}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText("Simulation attribution is incomplete")).toBeVisible();
    expect(screen.queryByText("Fallback is skipped after timeout")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Review phases" })).not.toBeInTheDocument();
    expect(screen.queryByText("Fake Local")).not.toBeInTheDocument();
    expect(screen.queryByText("Fake Cloud")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).not.toBeInTheDocument();
    expect(reviewMarkdown(malformedSimulationView)).toBeNull();
  });

  it.each([
    [
      "a provider label that only contains Fake as a substring",
      {
        ...simulationView,
        routes: simulationRoutes.map((route) =>
          route.phaseId === "synthesis"
            ? { ...route, providerLabel: "Not Fake Cloud" }
            : route,
        ),
      },
    ],
    [
      "a Fake Cloud label paired with Local locality",
      {
        ...simulationView,
        routes: simulationRoutes.map((route) =>
          route.phaseId === "synthesis"
            ? { ...route, locality: "local" as const }
            : route,
        ),
      },
    ],
    [
      "an unbounded route reservation without settlement",
      {
        ...simulationView,
        routes: simulationRoutes.map((route) =>
          route.phaseId === "inspection"
            ? {
                ...route,
                simulatedReservedMicrousd: 250_001,
              }
            : route,
        ),
      },
    ],
    [
      "a fractional aggregate settlement",
      {
        ...simulationView,
        simulation: {
          ...simulationProjection,
          settledMicrousd: 120_000.5,
        },
      },
    ],
    [
      "a fractional phase reservation",
      {
        ...simulationView,
        phases: simulationView.phases.map((phase) =>
          phase.id === "synthesis"
            ? { ...phase, simulatedReservedMicrousd: 1.5 }
            : phase,
        ),
      },
    ],
    [
      "an unknown phase settlement provenance even when the amount is in bounds",
      {
        ...simulationView,
        phases: simulationView.phases.map((phase) =>
          phase.id === "synthesis"
            ? {
                ...phase,
                providerLabel: "Fake Cloud",
                model: "fake-cloud-review",
                simulatedReservedMicrousd: 120_000,
                simulatedSettledMicrousd: 120_000,
                simulatedSettlementProvenance: "unknown" as never,
                actualExternalSpendMicrousd: 0 as const,
              }
            : phase,
        ),
      },
    ],
    [
      "a provider-attributed phase without an explicit zero actual spend",
      {
        ...simulationView,
        phases: simulationView.phases.map((phase) =>
          phase.id === "synthesis"
            ? {
                ...phase,
                providerLabel: "Fake Cloud",
                model: "fake-cloud-review",
                simulatedReservedMicrousd: 120_000,
                simulatedSettledMicrousd: 120_000,
                simulatedSettlementProvenance: "provider_reported" as const,
              }
            : phase,
        ),
      },
    ],
  ])("fails closed for %s", (_case, malformedView) => {
    render(
      <ChangeReviewWorkspace
        snapshot={simulationSnapshot}
        view={malformedView}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText("Simulation attribution is incomplete")).toBeVisible();
    expect(screen.queryByText("Hybrid simulation route")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).not.toBeInTheDocument();
  });

  it("shows snapshot attribution immediately but withholds details until a matching view is validated", () => {
    render(
      <ChangeReviewWorkspace
        snapshot={{ ...simulationSnapshot, status: "running" }}
        view={null}
        loading
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText(HYBRID_SIMULATION_MARKER)).toBeVisible();
    expect(
      screen.getByText(
        "SOAR is exercising the fake Hybrid route. No external provider is contacted.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("list", { name: "Review phases" })).not.toBeInTheDocument();
    expect(screen.queryByText("Fake Cloud")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).not.toBeInTheDocument();
  });

  it("rejects a stale review projection from another selected session", () => {
    render(
      <ChangeReviewWorkspace
        snapshot={simulationSnapshot}
        view={{ ...simulationView, sessionId: "00000000-0000-4000-8000-000000000099" }}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText(HYBRID_SIMULATION_MARKER)).toBeVisible();
    expect(screen.getByText("Simulation attribution is incomplete")).toBeVisible();
    expect(screen.queryByText("Fallback is skipped after timeout")).not.toBeInTheDocument();
    expect(screen.queryByText("Fake Cloud")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).not.toBeInTheDocument();
  });

  it("explains that cancellation creates no fallback and keeps actual spend at zero", () => {
    render(
      <ChangeReviewWorkspace
        snapshot={{ ...simulationSnapshot, status: "cancelled" }}
        view={{
          ...simulationView,
          status: "cancelled",
          freshness: "pending",
          phases: simulationView.phases.map((phase) => ({
            ...phase,
            status: phase.id === "fallback" ? ("cancelled" as const) : phase.status,
          })),
          reviewResult: undefined,
          coverage: undefined,
        }}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText("Simulation stopped")).toBeVisible();
    expect(
      screen.getByText(
        /No Local fallback starts after cancellation\. Actual external provider spend remains \$0\./u,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).not.toBeInTheDocument();
  });

  it("renders a failed simulated overrun in full instead of losing attribution", () => {
    render(
      <ChangeReviewWorkspace
        snapshot={{ ...simulationSnapshot, status: "failed" }}
        view={{
          ...simulationView,
          status: "failed",
          simulation: {
            ...simulationProjection,
            settledMicrousd: 300_000,
          },
          routes: simulationRoutes.map((route) =>
            route.phaseId === "synthesis"
              ? {
                  ...route,
                  status: "failed" as const,
                  simulatedSettledMicrousd: 300_000,
                }
              : route,
          ),
          freshness: "pending",
          reviewResult: undefined,
          coverage: undefined,
        }}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText(HYBRID_SIMULATION_MARKER)).toBeVisible();
    expect(screen.getByText("Hybrid simulation route")).toBeVisible();
    expect(screen.getAllByText("Simulated $0.30").length).toBeGreaterThan(0);
    expect(screen.queryByText("Simulation attribution is incomplete")).not.toBeInTheDocument();
  });

  it("retains the exact simulation marker in session history and replayed review UI", async () => {
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        chooseWorkspace: vi.fn(),
        createSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([simulationSnapshot]),
        getSession: vi.fn().mockResolvedValue(simulationSnapshot),
        startSession: vi.fn(),
        cancelSession: vi.fn(),
        subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
        getReviewAvailability: vi.fn().mockResolvedValue(simulationAvailability),
        issueHybridSimulationConsentChallenge: vi.fn(),
        createChangeReviewSession: vi.fn(),
        getChangeReviewView: vi.fn().mockResolvedValue(simulationView),
      },
    });

    render(<App />);

    expect(
      await screen.findByRole("button", {
        name: new RegExp("Simulation only — fake models", "u"),
      }),
    ).toBeVisible();
    expect(await screen.findByText("Hybrid simulation route")).toBeVisible();
    expect(screen.getAllByText(HYBRID_SIMULATION_MARKER).length).toBeGreaterThanOrEqual(4);
  });

  it("announces a live terminal simulation with the exact attribution marker", async () => {
    const user = userEvent.setup();
    let emit:
      | Parameters<typeof window.soar.subscribeSessionEvents>[0]
      | undefined;
    const runningSnapshot = {
      ...simulationSnapshot,
      status: "running" as const,
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    const otherSnapshot = {
      ...snapshot,
      id: "00000000-0000-4000-8000-000000000021",
      title: "Other local session",
      taskTrack: "repository-investigator-v1" as const,
      updatedAt: "2026-08-30T00:00:00.000Z",
    };
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        chooseWorkspace: vi.fn(),
        createSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([runningSnapshot, otherSnapshot]),
        getSession: vi.fn((id: string) =>
          Promise.resolve(
            id === runningSnapshot.id ? runningSnapshot : otherSnapshot,
          ),
        ),
        startSession: vi.fn(),
        cancelSession: vi.fn(),
        subscribeSessionEvents: vi.fn(
          (listener: Parameters<typeof window.soar.subscribeSessionEvents>[0]) => {
            emit = listener;
            return () => undefined;
          },
        ),
        getReviewAvailability: vi.fn().mockResolvedValue(simulationAvailability),
        issueHybridSimulationConsentChallenge: vi.fn(),
        createChangeReviewSession: vi.fn(),
        getChangeReviewView: vi.fn().mockResolvedValue({
          ...simulationView,
          status: "running",
          freshness: "pending",
          reviewResult: undefined,
          coverage: undefined,
        }),
      },
    });

    render(<App />);
    await waitFor(() => expect(emit).toBeDefined());
    await waitFor(() =>
      expect(screen.getByTestId("session-status")).toHaveTextContent("running"),
    );
    act(() => {
      emit?.({
        kind: "snapshot",
        sessionId: simulationSnapshot.id,
        snapshot: simulationSnapshot,
      });
    });

    const notification = await screen.findByTestId(
      "simulation-completion-notification",
    );
    expect(notification).toHaveAttribute("role", "status");
    expect(notification).toHaveAttribute("data-outcome", "completed");
    expect(within(notification).getByText("Hybrid simulation completed")).toBeVisible();
    expect(within(notification).getByText(simulationSnapshot.title)).toBeVisible();
    expect(
      within(notification).getByText(`Session ${simulationSnapshot.id}`),
    ).toBeVisible();
    expect(
      notification.querySelector('[data-icon="success"]'),
    ).toBeInTheDocument();
    expect(within(notification).getByText(HYBRID_SIMULATION_MARKER)).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: /Other local session/u }),
    );
    expect(
      screen.queryByTestId("simulation-completion-notification"),
    ).not.toBeInTheDocument();
  });

  it("announces a failed simulation with warning semantics rather than a success icon", async () => {
    let emit:
      | Parameters<typeof window.soar.subscribeSessionEvents>[0]
      | undefined;
    const runningSnapshot = {
      ...simulationSnapshot,
      status: "running" as const,
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        chooseWorkspace: vi.fn(),
        createSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([runningSnapshot]),
        getSession: vi.fn().mockResolvedValue(runningSnapshot),
        startSession: vi.fn(),
        cancelSession: vi.fn(),
        subscribeSessionEvents: vi.fn(
          (listener: Parameters<typeof window.soar.subscribeSessionEvents>[0]) => {
            emit = listener;
            return () => undefined;
          },
        ),
        getReviewAvailability: vi.fn().mockResolvedValue(simulationAvailability),
        issueHybridSimulationConsentChallenge: vi.fn(),
        createChangeReviewSession: vi.fn(),
        getChangeReviewView: vi.fn().mockResolvedValue({
          ...simulationView,
          status: "running",
          freshness: "pending",
          reviewResult: undefined,
          coverage: undefined,
        }),
      },
    });

    render(<App />);
    await waitFor(() => expect(emit).toBeDefined());
    await waitFor(() =>
      expect(screen.getByTestId("session-status")).toHaveTextContent("running"),
    );
    act(() => {
      emit?.({
        kind: "snapshot",
        sessionId: simulationSnapshot.id,
        snapshot: { ...simulationSnapshot, status: "failed" },
      });
    });

    const notification = await screen.findByTestId(
      "simulation-completion-notification",
    );
    expect(notification).toHaveAttribute("data-outcome", "failed");
    expect(within(notification).getByText("Hybrid simulation failed")).toBeVisible();
    expect(
      notification.querySelector('[data-icon="warning"]'),
    ).toBeInTheDocument();
    expect(
      notification.querySelector('[data-icon="success"]'),
    ).not.toBeInTheDocument();
  });

  it("copies model-authored text and adversarial paths as inert Markdown literals", () => {
    const attack = (label: string) =>
      `${label} ![remote](https://attacker.invalid/${label}.png) [open](https://attacker.invalid/${label})`;
    const adversarialPath =
      "src/`![path](https://attacker.invalid/path.png)`-payload.ts";
    const markdown = reviewMarkdown({
      ...view,
      reviewResult: {
        ...reviewResult,
        summary: attack("summary"),
        findings: [
          {
            ...reviewResult.findings[0],
            title: attack("title"),
            impact: attack("impact"),
            suggestedCorrection: attack("correction"),
            suggestedTest: attack("test"),
            evidence: [
              {
                kind: "change",
                path: adversarialPath,
                side: "working",
                line: 42,
              },
            ],
          },
        ],
        omissions: [
          {
            code: "unsafe.code",
            description: attack("omission"),
          },
        ],
      },
    });

    expect(markdown).not.toBeNull();
    expect(markdown).toContain(
      `\`\`${adversarialPath}:42 · working · change\`\``,
    );
    const { container } = render(<MarkdownContent text={markdown!} />);
    expect(container.querySelectorAll("a, img")).toHaveLength(0);
    expect(container.querySelector(".markdown-image-placeholder")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Copy link address" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("code")).toHaveTextContent(
      `${adversarialPath}:42 · working · change`,
    );
  });

  it("revalidates in main and refuses to copy a review that drifted after display", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        getReviewAvailability: vi.fn().mockResolvedValue(availability),
        createChangeReviewSession: vi.fn().mockResolvedValue(snapshot),
        getChangeReviewView: vi.fn().mockResolvedValue({
          ...view,
          freshness: "drifted",
        }),
      },
    });

    render(
      <ChangeReviewWorkspace
        snapshot={snapshot}
        view={view}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Copy Markdown" }));

    expect(await screen.findByRole("button", { name: "Copy failed" })).toBeVisible();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("withholds findings and copying when the workspace has drifted", () => {
    render(
      <ChangeReviewWorkspace
        snapshot={snapshot}
        view={{ ...view, freshness: "drifted" }}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText("Workspace changed")).toBeVisible();
    expect(screen.getByText("Review result withheld")).toBeVisible();
    expect(screen.queryByText("Fallback is skipped after timeout")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).not.toBeInTheDocument();
  });

  it("shows a host-accepted identity-matching incomplete review but disables copying", () => {
    render(
      <ChangeReviewWorkspace
        snapshot={snapshot}
        view={{
          ...view,
          freshness: "identity_same_unverifiable",
          reviewResult: {
            ...reviewResult,
            summary: "The review is incomplete because full freshness was not proven.",
            conclusion: "incomplete",
            findings: [],
            omissions: [
              {
                code: "snapshot_not_revalidated",
                description: "The complete snapshot could not be revalidated.",
              },
            ],
          },
          coverage: {
            ...coverage,
            status: "incomplete",
            omissionCodes: ["snapshot_not_revalidated"],
          },
          acceptanceNote:
            "The snapshot identity still matches, but host coverage or the accepted result is incomplete. The review is shown with its omissions; copying is disabled.",
        }}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getAllByText("Review incomplete").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Snapshot Not Revalidated").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).not.toBeInTheDocument();
    expect(
      reviewMarkdown({
        ...view,
        freshness: "identity_same_unverifiable",
      }),
    ).toBeNull();
  });

  it("fails closed instead of silently dropping a malformed accepted finding", () => {
    const malformedResult = structuredClone(reviewResult);
    malformedResult.findings[0]!.suggestedTest = "";
    render(
      <ChangeReviewWorkspace
        snapshot={snapshot}
        view={{ ...view, reviewResult: malformedResult }}
        loading={false}
        stopping={false}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText("Review result withheld")).toBeVisible();
    expect(screen.queryByText("Fallback is skipped after timeout")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).not.toBeInTheDocument();
  });
});
