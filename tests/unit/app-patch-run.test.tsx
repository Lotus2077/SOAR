/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/src/App";
import { PatchRunWorkspace } from "../../src/renderer/src/PatchRunWorkspace";
import type { PatchRunAvailability, PatchRunSnapshot, SoarPatchRunApi } from "../../src/shared/patch-run-contracts";
import { checkpoint } from "../helpers/patch-native-fixture";

afterEach(cleanup);

const ready: PatchRunAvailability = {
  ready: true,
  executionMode: "live",
  cloudReady: true,
  localReady: false,
  dockerReady: true,
  blockedReasons: [],
  maxEpisodeCostMicrousd: 5_000_000,
  cloudLabel: "Pilot cloud model",
};

function snapshot(overrides: Partial<PatchRunSnapshot> = {}): PatchRunSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000081",
    schemaVersion: "patch-run-v1",
    objective: "Handle an empty parser input.",
    title: "Fix empty input",
    workspaceLabel: "parser",
    baseRevision: "a".repeat(40),
    policy: "cloud",
    executionMode: "live",
    status: "created",
    phase: "pending",
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    providerLabel: "Pilot cloud model",
    spentMicrousd: 0,
    reservedMicrousd: 0,
    maxCostMicrousd: 5_000_000,
    elapsedMs: 0,
    events: [],
    checks: { status: "not_run", command: "", exitCode: null, output: "" },
    ...overrides,
  };
}

function finished(overrides: Partial<PatchRunSnapshot> = {}): PatchRunSnapshot {
  return snapshot({
    status: "completed",
    phase: "finished",
    updatedAt: "2026-09-08T00:00:05.000Z",
    elapsedMs: 5_000,
    spentMicrousd: 125_000,
    events: [{ sequence: 3, type: "completed", summary: "Patch captured; visible checks passed.", createdAt: "2026-09-08T00:00:05.000Z" }],
    checks: { status: "passed", command: "python -m pytest tests", exitCode: 0, output: "2 passed" },
    patch: {
      text: "--- a/parser.py\n+++ b/parser.py\n@@ -1 +1 @@\n-return values[0]\n+return values[0] if values else None\n",
      sha256: "b".repeat(64),
      files: ["parser.py"],
      truncated: false,
    },
    ...overrides,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolve_, reject_) => { resolve = resolve_; reject = reject_; });
  return { promise, resolve, reject };
}

function mockApi(options: { availability?: PatchRunAvailability; history?: PatchRunSnapshot[] } = {}) {
  const history = options.history ?? [];
  let listener: ((run: PatchRunSnapshot) => void) | undefined;
  const unsubscribe = vi.fn();
  const api = {
    chooseWorkspace: vi.fn().mockResolvedValue({ path: "/tmp/public-parser", name: "parser" }),
    getPatchRunAvailability: vi.fn().mockResolvedValue(options.availability ?? ready),
    createPatchRun: vi.fn().mockResolvedValue(snapshot()),
    listPatchRuns: vi.fn().mockResolvedValue(history),
    getPatchRun: vi.fn(async (id: string) => history.find((run) => run.id === id) ?? snapshot()),
    startPatchRun: vi.fn().mockResolvedValue(snapshot({ status: "running", phase: "cloud_solver" })),
    cancelPatchRun: vi.fn().mockResolvedValue(snapshot({ status: "cancelled", phase: "finished" })),
    exportPatchRun: vi.fn().mockResolvedValue({ exported: true, filePath: "/tmp/fix.patch" }),
    decidePatchRun: vi.fn(async (input: { id: string; decision: "keep" | "reject" }) => finished({ id: input.id, decision: input.decision, updatedAt: "2026-09-08T00:00:06.000Z" })),
    subscribePatchRuns: vi.fn((next: Parameters<SoarPatchRunApi["subscribePatchRuns"]>[0]) => { listener = next; return unsubscribe; }),
  } satisfies SoarPatchRunApi & { chooseWorkspace: unknown };
  return { api, emit: (run: PatchRunSnapshot) => listener?.(run), unsubscribe };
}

async function fillTask(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Ready for a coding task");
  await user.click(screen.getByRole("button", { name: "Choose repository" }));
  await user.type(screen.getByRole("textbox", { name: "What should change?" }), "Handle an empty parser input.");
}

describe("coding task workspace", () => {
  it("requests Automatic without forging a route and displays the host-selected cloud reason", async () => {
    const user = userEvent.setup();
    const routed = snapshot({ policy: "prepared_cloud", maxCostMicrousd: 3_000_000,
      routingSelection: { schemaVersion: 1, selector: "source_size_v1", requestedPolicy: "automatic",
        selectedPolicy: "prepared_cloud", reason: "baseline_exceeds_critic_hard_limits", baseRevision: "a".repeat(40),
        sourceFiles: 43, sourceBytes: 232059, sourceTreeSha256: "b".repeat(64), configurationSha256: "c".repeat(64), maxCostMicrousd: 3_000_000 } });
    const { api } = mockApi();
    api.createPatchRun.mockResolvedValue(routed);
    api.startPatchRun.mockResolvedValue({ ...routed, status: "running", phase: "cloud_solver" });
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    expect(screen.getByRole("radio", { name: "Cloud", exact: true })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Automatic Experimental", exact: true }));
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Start coding task" }));
    expect(api.createPatchRun).toHaveBeenCalledWith(expect.objectContaining({ policy: "automatic" }));
    expect(api.createPatchRun.mock.calls[0]?.[0]).not.toHaveProperty("routingSelection");
    expect(await screen.findByText("Automatic → Cloud with host preparation")).toBeVisible();
    expect(screen.getByLabelText("Automatic route reason")).toHaveTextContent("exceeds the critic's source size limits");
  });

  it.each([{ ...ready, cloudReady: false }, { ...ready, executionMode: "scripted" as const }])(
    "keeps Automatic unavailable without a live cloud destination", async (availability) => {
      const { api } = mockApi({ availability });
      render(<PatchRunWorkspace api={api} />);
      expect(await screen.findByRole("radio", { name: "Automatic Experimental", exact: true })).toBeDisabled();
    });

  it("offers the opt-in critique route only when its live profile is available", async () => {
    const user = userEvent.setup();
    const { api } = mockApi({ availability: { ...ready, localReady: true, criticReady: true } });
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    expect(screen.getByRole("radio", { name: "Cloud", exact: true })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /^Local \+ Cloud critique/u }));
    expect(screen.getByText(/cloud critiques it once/u)).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Start coding task" }));
    expect(api.createPatchRun).toHaveBeenCalledWith(expect.objectContaining({ policy: "local_critic_repair" }));
  });

  it("keeps critique unavailable without its profile even when both providers are configured", async () => {
    const { api } = mockApi({ availability: { ...ready, localReady: true, criticReady: false } });
    render(<PatchRunWorkspace api={api} />);
    expect(await screen.findByRole("radio", { name: /^Local \+ Cloud critique/u })).toBeDisabled();
  });

  it("offers local-only execution when runtime and local are ready without cloud credentials", async () => {
    const user = userEvent.setup();
    const { api } = mockApi({ availability: { ...ready, cloudReady: false, cloudLabel: undefined, localReady: true, localLabel: "Local fixture" } });
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("radio", { name: /^Local only/u }));
    await fillTask(user);
    expect(screen.getByRole("radio", { name: /^Local first/u })).toBeDisabled();
    for (const option of screen.getAllByRole("radio", { name: /^Cloud plan/u })) expect(option).toBeDisabled();
    expect(screen.getByText(/No cloud request is admitted/u)).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Start coding task" }));
    expect(api.createPatchRun).toHaveBeenCalledWith(expect.objectContaining({ policy: "local_only" }));
  });

  it("selects required cloud review and shows a provisional local candidate as waiting for review", async () => {
    const user = userEvent.setup();
    const provisional = snapshot({ policy: "cloud_plan_local_review", status: "running", phase: "local_solver",
      checkpoint: checkpoint(undefined, { policy: "cloud_plan_local_review", decision: "checkpoint", state: "checkpoint", reason: "review_required" }) });
    const { api, emit } = mockApi({ availability: { ...ready, localReady: true, localLabel: "Local fixture" } });
    api.createPatchRun.mockResolvedValue(provisional);
    api.startPatchRun.mockResolvedValue(provisional);
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    await user.click(screen.getByRole("radio", { name: "Cloud plan + Local + Cloud review Experimental", exact: true }));
    expect(screen.getByText(/Cloud review is required even when local checks pass/u)).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Start coding task" }));
    expect(api.createPatchRun).toHaveBeenCalledWith(expect.objectContaining({ policy: "cloud_plan_local_review" }));
    expect(await screen.findByText("The local candidate passed its visible check and is waiting for required cloud review.")).toBeVisible();
    expect(screen.queryByText("Ready for review", { exact: true })).not.toBeInTheDocument();
    await act(async () => emit({ ...provisional, phase: "cloud_solver", cloudRecoveryCount: 1,
      checkpoint: checkpoint(provisional.checkpoint, { policy: "cloud_plan_local_review", decision: "escalate", state: "cloud", reason: "handoff_confirmed", handoffUsed: true }),
      events: [{ sequence: 2, type: "phase.changed", summary: "Cloud review started", createdAt: "2026-09-08T00:00:01.000Z" }] }));
    const selected = screen.getByRole("article", { name: "Selected coding task" });
    expect(within(selected).getByRole("status")).toHaveTextContent("Reviewing and refining with cloud");
    expect(screen.getByLabelText("Routing checkpoint")).toHaveTextContent("Cloud review and repair phases: 1 / 1.");
  });

  it("shows checkpoint freshness and separate planner/local fees without implying accepted unfinished work", async () => {
    const user = userEvent.setup();
    const usage = { providerLabel: "Fixture", requestCount: 1, usageReceipts: 1, unknownRequests: 0, spentMicrousd: 0,
      reservedMicrousd: 0, inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    const record = finished({ policy: "cloud_plan_local", status: "failed", checks: { status: "not_run", command: "python public_cases.py", exitCode: null, output: "" },
      patch: { ...finished().patch!, kind: "recovered" },
      checkpoint: checkpoint(undefined, { policy: "cloud_plan_local", decision: "stop", state: "stopped", reason: "insufficient_handoff_time" }),
      checkpointCheck: { command: "python public_cases.py", exitCode: 0, output: "Visible checks passed on earlier source", elapsedMs: 900,
        sourceSha256: "a".repeat(64), sourceAfterSha256: "a".repeat(64), passed: true, fresh: false },
      phaseUsage: { local: usage, planner: { ...usage, spentMicrousd: 20000 } } });
    const { api } = mockApi({ history: [record] }); render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    expect(screen.getByLabelText("Routing checkpoint")).toHaveTextContent("stopped this route");
    expect(screen.getByLabelText("Latest local checkpoint check")).toHaveTextContent("stale for later work");
    expect(screen.getByLabelText("Cloud planner usage")).toHaveTextContent("$0.02");
    expect(screen.getByLabelText("Local solver usage")).toHaveTextContent("$0.00");
    expect(screen.getByText(/Zero API fees do not mean zero total cost/u)).toBeVisible();
    expect(screen.queryByText("Ready for review")).not.toBeInTheDocument();
  });
  it("shows failed generated checks separately when final visible checks passed", async () => {
    const user = userEvent.setup();
    const tree = "a".repeat(64), artifact = "b".repeat(64);
    const record = finished({ policy: "cloud_plan_local_review", status: "failed",
      cloudPlan: { summary: "Plan from the public task", sha256: "c".repeat(64),
        checks: { schemaVersion: 1, kind: "model_generated_python_unittest", source: "import unittest\n",
          expectedTests: 1, sha256: artifact, testIds: ["Public.test_contract"] } },
      plannerCheck: { stage: "final", artifactSha256: artifact, sourceSha256: tree, sourceAfterSha256: tree,
        exitCode: 1, output: "", outputTruncated: false, elapsedMs: 100, timedOut: false, passed: false, fresh: true,
        result: { schemaVersion: 1, kind: "model_generated_python_unittest", sourceSha256: artifact,
          expectedTests: 1, discoveredTests: 1, testsRun: 1, passed: 0, failures: 1, errors: 0,
          skipped: 0, expectedFailures: 0, unexpectedSuccesses: 0, completed: true, status: "failed",
          detail: "Signed operands do not satisfy the public task." } } });
    const { api } = mockApi({ history: [record] }); render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    const generated = screen.getByLabelText("Latest planner-generated check result");
    expect(generated).toHaveTextContent("Generated checks failed or did not complete.");
    expect(generated).toHaveTextContent("Final verification");
    expect(generated).toHaveTextContent("1/1 tests executed");
    expect(generated).toHaveTextContent("Signed operands do not satisfy the public task.");
    expect(screen.getByText(/passing them is not independent acceptance/u)).toBeInTheDocument();
    expect(screen.queryByText("Ready for review", { exact: true })).not.toBeInTheDocument();
  });
  it("requires public-source acknowledgement and defaults to the static cloud policy", async () => {
    const user = userEvent.setup();
    const { api } = mockApi();
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    expect(screen.getByRole("radio", { name: "Cloud" })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Local investigation/u })).toBeDisabled();
    const start = screen.getByRole("button", { name: "Start coding task" });
    expect(start).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    expect(start).toBeEnabled();
    await user.click(start);
    await waitFor(() => expect(api.startPatchRun).toHaveBeenCalledWith(snapshot().id));
    expect(api.createPatchRun).toHaveBeenCalledWith({
      workspaceRoot: "/tmp/public-parser", objective: "Handle an empty parser input.",
      policy: "cloud", publicSourceAcknowledged: true, episodeBudgetUsd: 5,
    });
    expect(screen.getByRole("button", { name: "Cancel task" })).toBeEnabled();
  });

  it("clamps the untouched default to a three-dollar cap before submission", async () => {
    const user = userEvent.setup();
    const { api } = mockApi({ availability: { ...ready, maxEpisodeCostMicrousd: 3_000_000 } });
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    expect(screen.getByRole("spinbutton", { name: "Episode ceiling (USD)" })).toHaveValue(3);
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    expect(screen.getByRole("button", { name: "Start coding task" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Start coding task" }));
    expect(api.createPatchRun).toHaveBeenCalledWith(expect.objectContaining({ episodeBudgetUsd: 3 }));
  });

  it.each(["", "0"])("preserves an explicit %j ceiling during readiness refresh and keeps submission disabled", async (value) => {
    const user = userEvent.setup();
    const { api } = mockApi({ availability: { ...ready, maxEpisodeCostMicrousd: 3_000_000 } });
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    const input = screen.getByRole("spinbutton", { name: "Episode ceiling (USD)" });
    await user.clear(input);
    if (value) await user.type(input, value);
    api.getPatchRunAvailability.mockResolvedValue({ ...ready, maxEpisodeCostMicrousd: 5_000_000 });
    await user.click(screen.getByRole("button", { name: "Recheck readiness" }));
    await screen.findByText("Ready for a coding task");
    expect(api.getPatchRunAvailability).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue(value ? 0 : null);
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    expect(screen.getByRole("button", { name: "Start coding task" })).toBeDisabled();
    expect(api.createPatchRun).not.toHaveBeenCalled();
  });

  it("preserves a lower chosen ceiling on refresh and only clamps it downward", async () => {
    const user = userEvent.setup();
    const { api } = mockApi({ availability: { ...ready, maxEpisodeCostMicrousd: 3_000_000 } });
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    const input = screen.getByRole("spinbutton", { name: "Episode ceiling (USD)" });
    await user.clear(input);
    await user.type(input, "2");
    for (const [cap, expected] of [[5, 2], [1, 1], [3, 1]]) {
      api.getPatchRunAvailability.mockResolvedValue({ ...ready, maxEpisodeCostMicrousd: cap * 1_000_000 });
      await user.click(screen.getByRole("button", { name: "Recheck readiness" }));
      await screen.findByText("Ready for a coding task");
      expect(input).toHaveValue(expected);
    }
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Start coding task" }));
    expect(api.createPatchRun).toHaveBeenCalledWith(expect.objectContaining({ episodeBudgetUsd: 1 }));
  });

  it("clears acknowledgement when the task or repository changes and enforces the advertised budget", async () => {
    const user = userEvent.setup();
    const { api } = mockApi();
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    const ack = screen.getByRole("checkbox", { name: /I confirm/u });
    await user.click(ack);
    await user.type(screen.getByRole("textbox", { name: "What should change?" }), " Keep errors clear.");
    expect(ack).not.toBeChecked();
    await user.click(ack);
    await user.click(screen.getByRole("button", { name: "Change repository" }));
    expect(ack).not.toBeChecked();
    await user.clear(screen.getByRole("spinbutton", { name: "Episode ceiling (USD)" }));
    await user.type(screen.getByRole("spinbutton", { name: "Episode ceiling (USD)" }), "6");
    await user.click(ack);
    expect(screen.getByRole("button", { name: "Start coding task" })).toBeDisabled();
    expect(api.createPatchRun).not.toHaveBeenCalled();
  });

  it("offers the host-only comparator and passes the declared visible command", async () => {
    const user = userEvent.setup();
    const { api } = mockApi();
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    await user.click(screen.getByText("Comparison option"));
    await user.click(screen.getByRole("radio", { name: "Cloud with host preparation" }));
    await user.type(screen.getByRole("textbox", { name: /Visible test command/u }), "python -m pytest tests");
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Start coding task" }));
    expect(api.createPatchRun).toHaveBeenCalledWith(expect.objectContaining({ policy: "prepared_cloud", visibleTestCommand: "python -m pytest tests" }));
  });

  it("does not start when prerequisites are blocked and reports the real reason", async () => {
    const { api } = mockApi({ availability: { ...ready, ready: false, dockerReady: false, blockedReasons: ["Container engine unavailable."] } });
    render(<PatchRunWorkspace api={api} />);
    expect(await screen.findByText("Container engine unavailable.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start coding task" })).toBeDisabled();
    expect(api.createPatchRun).not.toHaveBeenCalled();
    expect(api.startPatchRun).not.toHaveBeenCalled();
  });

  it("offers an experimental local phase only when ready and shares the episode ceiling", async () => {
    const user = userEvent.setup();
    const { api } = mockApi({ availability: { ...ready, localReady: true, localLabel: "Dedicated local model" } });
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    await user.click(screen.getByRole("radio", { name: /Local investigation/u }));
    expect(screen.getByText("Pilot cloud model · Dedicated local model")).toBeVisible();
    await user.clear(screen.getByRole("spinbutton", { name: "Episode ceiling (USD)" }));
    await user.type(screen.getByRole("spinbutton", { name: "Episode ceiling (USD)" }), "3");
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Start coding task" }));
    expect(api.createPatchRun).toHaveBeenCalledWith(expect.objectContaining({ policy: "hybrid", episodeBudgetUsd: 3 }));
  });

  it("treats a partial bridge as unavailable instead of attempting unsupported calls", () => {
    const probe = vi.fn();
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: { chooseWorkspace: vi.fn(), getPatchRunAvailability: probe },
    });
    render(<PatchRunWorkspace />);
    expect(screen.getByText("This build does not include the coding runner.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start coding task" })).toBeDisabled();
    expect(probe).not.toHaveBeenCalled();
  });

  it("marks scripted setup and results as mechanics-only and never labels them live evidence", async () => {
    const user = userEvent.setup();
    const { api } = mockApi({ availability: { ...ready, executionMode: "scripted", cloudReady: false, maxEpisodeCostMicrousd: 0 } });
    api.createPatchRun.mockResolvedValue(snapshot({ executionMode: "scripted", maxCostMicrousd: 0 }));
    api.startPatchRun.mockResolvedValue(finished({ executionMode: "scripted", spentMicrousd: 0, maxCostMicrousd: 0 }));
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    expect(screen.getByText("Scripted test — mechanics only.")).toBeVisible();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Start scripted task" }));
    await screen.findByRole("button", { name: "Keep patch" });
    expect(screen.getByText("Scripted test — mechanics only.")).toBeVisible();
    expect(screen.getByText(/Independent task acceptance has not been established/u)).toBeVisible();
    expect(api.createPatchRun.mock.calls[0]?.[0]).not.toHaveProperty("episodeBudgetUsd");
    expect(api.decidePatchRun).not.toHaveBeenCalled();
  });

  it("retains a newer terminal event when a late start response arrives", async () => {
    const user = userEvent.setup();
    const { api, emit } = mockApi();
    const starting = deferred<PatchRunSnapshot>();
    api.startPatchRun.mockReturnValue(starting.promise);
    render(<PatchRunWorkspace api={api} />);
    await fillTask(user);
    await user.click(screen.getByRole("checkbox", { name: /I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Start coding task" }));
    await waitFor(() => expect(api.startPatchRun).toHaveBeenCalled());
    act(() => emit(finished()));
    await act(async () => starting.resolve(snapshot({ status: "running", phase: "cloud_solver" })));
    expect(screen.getByRole("button", { name: "Keep patch" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cancel task" })).not.toBeInTheDocument();
    expect(screen.getByText("$0.13")).toBeVisible();
  });

  it("keeps cancellation pending until the host confirms and retains unresolved exposure", async () => {
    const user = userEvent.setup();
    const inProgress = snapshot({ status: "running", phase: "cloud_solver", spentMicrousd: 100_000, reservedMicrousd: 500_000 });
    const { api } = mockApi({ history: [inProgress] });
    const cancellation = deferred<PatchRunSnapshot>();
    api.cancelPatchRun.mockReturnValue(cancellation.promise);
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    await user.click(screen.getByRole("button", { name: "Cancel task" }));
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
    await act(async () => cancellation.resolve(snapshot({ status: "cancelled", phase: "finished", spentMicrousd: 100_000, reservedMicrousd: 500_000, updatedAt: "2026-09-08T00:00:07.000Z" })));
    const selected = within(screen.getByRole("article", { name: "Selected coding task" }));
    expect(selected.getByText("Cancelled")).toBeVisible();
    expect(selected.getByText("$0.50")).toBeVisible();
    expect(selected.getByText(/not settled spend/u)).toBeVisible();
  });

  it("does not claim cancellation succeeded when cleanup fails", async () => {
    const user = userEvent.setup();
    const { api } = mockApi({ history: [snapshot({ status: "running", phase: "cloud_solver" })] });
    api.cancelPatchRun.mockRejectedValue(new Error("Worker cleanup is not confirmed."));
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    await user.click(screen.getByRole("button", { name: "Cancel task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Worker cleanup is not confirmed.");
    expect(screen.getByRole("button", { name: "Cancel task" })).toBeEnabled();
    expect(screen.queryByText("Cancelled", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps the stopping state after an immediate cancellation acknowledgement", async () => {
    const user = userEvent.setup();
    const running = snapshot({ status: "running", phase: "checking" });
    const { api, emit } = mockApi({ history: [running] });
    api.cancelPatchRun.mockResolvedValue({
      ...running,
      events: [{ sequence: 1, type: "run.cancel_requested", summary: "Waiting for container cleanup.", createdAt: "2026-09-08T00:00:01.000Z" }],
      updatedAt: "2026-09-08T00:00:01.000Z",
    });
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    await user.click(screen.getByRole("button", { name: "Cancel task" }));
    await waitFor(() => expect(api.cancelPatchRun).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
    act(() => emit(snapshot({
      status: "cancelled", phase: "finished", updatedAt: "2026-09-08T00:00:02.000Z",
      events: [{ sequence: 2, type: "run.cancelled", summary: "Container cleanup confirmed.", createdAt: "2026-09-08T00:00:02.000Z" }],
    })));
    expect(screen.queryByRole("button", { name: "Stopping…" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Selected coding task" })).getByText("Cancelled")).toBeVisible();
  });

  it("shows failed visible checks without retrying and exports or records a decision only on request", async () => {
    const user = userEvent.setup();
    const completed = finished({ checks: { status: "failed", command: "pytest", exitCode: 1, output: "assertion failed" } });
    const { api } = mockApi({ history: [completed] });
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    expect(screen.getByText(/Visible checks failed/u)).toBeVisible();
    expect(screen.getByLabelText("Proposed diff")).toHaveTextContent("return values[0] if values else None");
    expect(api.startPatchRun).not.toHaveBeenCalled();
    expect(api.decidePatchRun).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /apply/iu })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export patch" }));
    expect(api.exportPatchRun).toHaveBeenCalledWith(completed.id);
    expect(await screen.findByText(/Patch exported/u)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Reject patch" }));
    expect(api.decidePatchRun).toHaveBeenCalledWith({ id: completed.id, decision: "reject" });
    expect(await screen.findByText("Patch rejected")).toBeVisible();
  });

  it("shows partial source preparation without claiming completed investigation or fallback", async () => {
    const user = userEvent.setup();
    const hybrid = finished({ policy: "hybrid", localSummary: "notes.py:1:VALUE = 1",
      localInvestigation: { elapsedMs: 25000, outcome: "partial" } });
    const { api } = mockApi({ history: [hybrid] });
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    await user.click(screen.getByText("Local investigation evidence"));
    expect(screen.getByText("The local step limit was reached. Partial source observations were prepared for cloud; the investigation did not finish.")).toBeVisible();
    expect(screen.getByText("notes.py:1:VALUE = 1")).toBeVisible();
    expect(screen.queryByText("Host-captured read-only observations prepared for cloud.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Cloud preparation uses the host inventory only/u)).not.toBeInTheDocument();
    expect(screen.getByText(/does not independently verify a diagnosis/u)).toBeVisible();
  });

  it("shows local evidence, elapsed time and per-phase fees without treating free API calls as free hardware", async () => {
    const user = userEvent.setup();
    const hybrid = finished({ policy: "hybrid", localSummary: "read parser.py:10-20\nObserved guard condition", localInvestigation: { elapsedMs: 6500, outcome: "completed" },
      phaseUsage: {
        scout: { providerLabel: "Local · RM-01 VLM", requestCount: 2, usageReceipts: 2, unknownRequests: 0, spentMicrousd: 0, reservedMicrousd: 0,
          inputTokens: 300, outputTokens: 30, reasoningTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cloud: { providerLabel: "OpenAI · cloud-fixture", requestCount: 1, usageReceipts: 1, unknownRequests: 0, spentMicrousd: 125000, reservedMicrousd: 0,
          inputTokens: 120, outputTokens: 20, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      } });
    const { api } = mockApi({ history: [hybrid] });
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    const local = within(screen.getByLabelText("Local investigation usage"));
    const cloud = within(screen.getByLabelText("Cloud solver usage"));
    expect(local.getByText("300 / 30")).toBeVisible();
    expect(local.getByText("2 / 2")).toBeVisible();
    expect(cloud.getByText("120 / 20")).toBeVisible();
    expect(cloud.getByText("$0.13")).toBeVisible();
    expect(screen.getByText(/Local token fees exclude the machine/u)).toBeVisible();
    await user.click(screen.getByText("Local investigation evidence"));
    expect(screen.getByText("Local investigation elapsed: 6s.")).toBeVisible();
    expect(screen.getByText(/Observed guard condition/u)).toBeVisible();
    expect(screen.getByText(/does not independently verify a diagnosis/u)).toBeVisible();
  });

  it.each(["fallback", "stopped"] as const)("shows the local %s reason without inventing cloud evidence", async (outcome) => {
    const user = userEvent.setup();
    const stopped = outcome === "stopped";
    const hybrid = finished({ policy: "hybrid", status: stopped ? "failed" : "completed", localSummary: "",
      localInvestigation: { elapsedMs: 2100, outcome, fallbackReason: stopped ? "provider_outcome_unknown" : "scout_action_denied" },
      phaseUsage: { scout: { providerLabel: "Local model", requestCount: 1, usageReceipts: stopped ? 0 : 1, unknownRequests: stopped ? 1 : 0, spentMicrousd: 0, reservedMicrousd: 0,
        inputTokens: stopped ? 0 : 10, outputTokens: stopped ? 0 : 20, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
    const { api } = mockApi({ history: [hybrid] });
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    if (stopped) {
      expect(screen.getByText("No usage receipt")).toBeVisible();
      expect(screen.getByText(/request outcome\(s\) remain unknown/u)).toBeVisible();
    }
    await user.click(screen.getByText("Local investigation evidence"));
    expect(screen.getByText("Local investigation elapsed: 2s.")).toBeVisible();
    expect(screen.getByText(stopped ? /Its observations were not handed to cloud/u : /Cloud preparation uses the host inventory only/u)).toBeVisible();
    expect(screen.getByText(stopped ? "The provider outcome is unknown; the task cannot continue." : "The local model requested an action outside read-only investigation.")).toBeVisible();
    expect(screen.queryByText("Host-captured read-only observations prepared for cloud.")).not.toBeInTheDocument();
  });

  it.each([
    [undefined, "The local investigation could not continue. The exact cause was not recorded."],
    ["provider_output_empty", "The local provider returned no usable text."],
    ["provider_output_truncated", "The local provider marked its response as truncated."],
  ] as const)("shows the recorded local response diagnosis %s without inferring legacy details", async (providerOutputError, message) => {
    const user = userEvent.setup();
    const hybrid = finished({ policy: "hybrid", localSummary: "",
      localInvestigation: { elapsedMs: 1200, outcome: "fallback", fallbackReason: "scout_limit_or_format_failure",
        ...(providerOutputError === undefined ? {} : { providerOutputError }) } });
    const { api } = mockApi({ history: [hybrid] });
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    await user.click(screen.getByText("Local investigation evidence"));
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByText(/Cloud preparation uses the host inventory only/u)).toBeVisible();
    expect(screen.queryByText("The local action or response limit was reached.")).not.toBeInTheDocument();
    for (const other of ["The local investigation could not continue. The exact cause was not recorded.",
      "The local provider returned no usable text.", "The local provider marked its response as truncated."]) {
      if (other !== message) expect(screen.queryByText(other)).not.toBeInTheDocument();
    }
  });

  it("does not claim evidence from an older scout that submitted only an inventory", async () => {
    const user = userEvent.setup();
    const hybrid = finished({ policy: "hybrid", localSummary: "", localInvestigation: { elapsedMs: 2100, outcome: "completed" } });
    const { api } = mockApi({ history: [hybrid] });
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    await user.click(screen.getByText("Local investigation evidence"));
    expect(screen.getByText(/finished without usable source evidence/u)).toBeVisible();
    expect(screen.queryByText("Host-captured read-only observations prepared for cloud.")).not.toBeInTheDocument();
  });

  it("labels recovered work unfinished and unchecked while allowing explicit export", async () => {
    const user = userEvent.setup();
    const recovered = finished({ status: "cancelled", patch: { ...finished().patch!, kind: "recovered" },
      checks: { status: "not_run", command: "pytest", exitCode: null, output: "" },
      events: [{ sequence: 3, type: "patch.recovered", summary: "Unfinished work recovered.", createdAt: "2026-09-08T00:00:05.000Z" }] });
    const { api } = mockApi({ history: [recovered] });
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    const selected = within(screen.getByRole("article", { name: "Selected coding task" }));
    expect(selected.getByText("Cancelled · unfinished work recovered")).toBeVisible();
    expect(selected.getByText(/The solver did not submit this patch/u)).toBeVisible();
    expect(selected.getByText("Visible checks have not run.")).toBeVisible();
    expect(screen.queryByText("Ready for review")).not.toBeInTheDocument();
    expect(api.startPatchRun).not.toHaveBeenCalled();
    expect(api.decidePatchRun).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Export patch" }));
    expect(api.exportPatchRun).toHaveBeenCalledWith(recovered.id);
    expect(await screen.findByText(/Unfinished patch exported\. It was not submitted or checked/u)).toBeVisible();
    expect(api.decidePatchRun).not.toHaveBeenCalled();
  });

  it("does not replace the selected task with an earlier history request", async () => {
    const user = userEvent.setup();
    const first = finished();
    const second = finished({ id: "00000000-0000-4000-8000-000000000082", title: "Fix missing value" });
    const pending = deferred<PatchRunSnapshot>();
    const { api } = mockApi({ history: [first, second] });
    api.getPatchRun.mockImplementation((id) => id === first.id ? pending.promise : Promise.resolve(second));
    render(<PatchRunWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: /Fix empty input/u }));
    await user.click(screen.getByRole("button", { name: /Fix missing value/u }));
    await act(async () => pending.resolve(first));
    expect(within(screen.getByRole("article", { name: "Selected coding task" })).getByRole("heading", { level: 1 })).toHaveTextContent("Fix missing value");
  });

  it("unsubscribes on unmount and ignores a late history response", async () => {
    const { api, unsubscribe } = mockApi();
    const history = deferred<PatchRunSnapshot[]>();
    api.listPatchRuns.mockReturnValue(history.promise);
    const rendered = render(<PatchRunWorkspace api={api} />);
    rendered.unmount();
    await act(async () => history.resolve([finished()]));
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("opens from the existing shell without invoking a legacy task or review", async () => {
    const user = userEvent.setup();
    const { api } = mockApi();
    const legacyCreate = vi.fn();
    const legacyReview = vi.fn();
    Object.defineProperty(window, "soar", {
      configurable: true,
      value: {
        ...api,
        listSessions: vi.fn().mockResolvedValue([]),
        subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined),
        createSession: legacyCreate,
        createChangeReviewSession: legacyReview,
        getCloudCredentialStatus: vi.fn(),
        invalidateHybridSimulationConsentChallenges: vi.fn().mockResolvedValue(undefined),
      },
    });
    render(<App />);
    await user.click(screen.getByTestId("coding-task-entry"));
    expect(await screen.findByRole("heading", { name: "Fix a repository" })).toBeVisible();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(legacyReview).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /New task/u }));
    expect(screen.getByRole("form", { name: "New task" })).toBeVisible();
  });
});
