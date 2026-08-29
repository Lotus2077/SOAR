/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  App,
  ChangeReviewWorkspace,
  MarkdownContent,
  ReviewSetup,
  reviewMarkdown,
} from "../../src/renderer/src/App";
import type { SessionSnapshot } from "../../src/shared/contracts";

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
    reason: "Cloud setup is not available in this build." as const,
    separatelyConfiguredPaidProviderReachable: false as const,
    reachabilitySummary:
      "No separately configured paid provider is available in this build." as const,
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

describe("Review Current Changes renderer", () => {
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
      });
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(await screen.findByText("Inspecting your changes")).toBeVisible();
  });

  it("shows a flat local setup with an honest disabled Hybrid policy", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    const start = vi.fn();
    render(
      <ReviewSetup
        workspace={{ path: "/tmp/workspace", name: "workspace" }}
        availability={availability}
        loading={false}
        busy={false}
        onChooseWorkspace={choose}
        onStart={start}
      />,
    );

    expect(screen.getByRole("heading", { name: "Review current changes" })).toBeVisible();
    expect(screen.getByText("Cloud setup is not available in this build.")).toBeVisible();
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
      screen.getByText(/No separately configured paid provider is available in this build/u),
    ).toBeVisible();
    expect(screen.queryByText("$0.25")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start local review" }));
    expect(start).toHaveBeenCalledOnce();
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
