/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralTaskWorkspace } from "../../src/renderer/src/GeneralTaskWorkspace";
import { App } from "../../src/renderer/src/App";
import type { GeneralTaskArtifactPreview, GeneralTaskAvailability, GeneralTaskConsultationPreview, GeneralTaskInputSelection, GeneralTaskSnapshot, SoarGeneralTaskApi } from "../../src/shared/general-task-contracts";
afterEach(cleanup);
const id = "00000000-0000-4000-8000-000000000101";
const otherId = "00000000-0000-4000-8000-000000000102";
const selectedFiles: GeneralTaskInputSelection = { id: "00000000-0000-4000-8000-000000000103", files: [{ name: "invoices.csv", path: "input/invoices.csv", bytes: 43, sha256: "a".repeat(64) }] };
const ready: GeneralTaskAvailability = { available: true, reason: "Local runtime configured.", limits: { modelCalls: 20, toolCalls: 30, elapsedMs: 900000 }, publicOrSyntheticOnly: true, executionMode: "local" };
const artifact = { path: "output/report.md", bytes: 250, sha256: "b".repeat(64) };
function task(overrides: Partial<GeneralTaskSnapshot> = {}): GeneralTaskSnapshot {
  return { id, goal: "Audit the invoice batch", outputName: "report.md", status: "queued", reason: "waiting_for_start", createdAt: 1000, updatedAt: 1000, revision: 1, inputs: selectedFiles.files, artifacts: [], modelCalls: 0, toolCalls: 0, elapsedMs: 0, checks: [], cleanupConfirmed: true, independentAcceptance: "not_evaluated", events: [], canResume: false, ...overrides };
}
function submitted(overrides: Partial<GeneralTaskSnapshot> = {}) { return task({ status: "submitted", reason: "independent_acceptance_pending", artifacts: [artifact], modelCalls: 6, toolCalls: 5, elapsedMs: 45000, revision: 4, updatedAt: 5000, checks: [{ id: "artifact_exists", passed: true }], ...overrides }); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(history: GeneralTaskSnapshot[] = [], availability = ready) {
  let listener: ((snapshot: GeneralTaskSnapshot) => void) | undefined;
  const unsubscribe = vi.fn();
  const api = {
    getGeneralTaskAvailability: vi.fn().mockResolvedValue(availability),
    chooseGeneralTaskInputs: vi.fn().mockResolvedValue(selectedFiles),
    createGeneralTask: vi.fn().mockResolvedValue(task()),
    listGeneralTasks: vi.fn().mockResolvedValue(history),
    getGeneralTask: vi.fn(async (key: string) => history.find(row => row.id === key) ?? task()),
    startGeneralTask: vi.fn().mockResolvedValue(task({ status: "running", revision: 2, modelCalls: 1, cleanupConfirmed: false })),
    pauseGeneralTask: vi.fn().mockResolvedValue(task({ status: "paused", revision: 3, canResume: true })),
    resumeGeneralTask: vi.fn().mockResolvedValue(task({ status: "running", revision: 4, modelCalls: 2, cleanupConfirmed: false })),
    cancelGeneralTask: vi.fn().mockResolvedValue(task({ status: "cancelled", revision: 5 })),
    previewGeneralTaskConsultation: vi.fn(),
    decideGeneralTaskConsultation: vi.fn(),
    readGeneralTaskArtifact: vi.fn().mockResolvedValue({ id, ...artifact, kind: "text", text: "# Report\n\nThree rows need review.", truncated: false } satisfies GeneralTaskArtifactPreview),
    exportGeneralTaskArtifact: vi.fn().mockResolvedValue({ exported: true, filePath: "/tmp/report.md" }),
    exportGeneralTaskBundle: vi.fn().mockResolvedValue({ exported: true, filePath: "/tmp/task.zip" }),
    subscribeGeneralTasks: vi.fn((value: (snapshot: GeneralTaskSnapshot) => void) => { listener = value; return unsubscribe; }),
  } satisfies SoarGeneralTaskApi;
  return { api, unsubscribe, emit: (value: GeneralTaskSnapshot) => listener?.(value) };
}
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Ready for a general task");
  await user.type(screen.getByRole("textbox", { name: "Task goal" }), "Audit the invoice batch");
  await user.click(screen.getByRole("button", { name: "Choose files" }));
  await user.click(screen.getByRole("checkbox"));
}
const proposalId = "00000000-0000-4000-8000-000000000104";
function consultationTask(overrides: Partial<GeneralTaskSnapshot> = {}) {
  return task({ status: "paused", routing: "ask_before_consulting", revision: 3, updatedAt: 3000,
    consultation: { proposalId, proposalSha256: "c".repeat(64), state: "pending", model: "test-consultant", maxFeeMicrousd: 100000 },
    fees: { reservedMicrousd: 0, settledMicrousd: 0 }, ...overrides });
}
function exactPreview(): GeneralTaskConsultationPreview {
  return { ...consultationTask().consultation!, packet: '<script>do not execute</script>\nSynthetic question', packetSha256: "d".repeat(64),
    contextSha256: "e".repeat(64), checkpointSha256: "f".repeat(64), profileSha256: "a".repeat(64),
    destination: { id: "desktop_consultant", endpoint: "https://consultant.example/v1/chat/completions", accountId: "fixture-account", credentialVersion: 1 },
    prices: { inputMicrousdPerMillion: 1000000, outputMicrousdPerMillion: 2000000, cachedInputMicrousdPerMillion: 500000 },
    maxOutputTokens: 4096, selectedPaths: ["input/public.txt"], omittedPaths: ["output/partial.md"], expiresAt: Date.now() + 60000 };
}
describe("exact consultation review", () => {
  it("defaults to local only and explains disabled consultation; opt-in reaches only creation", async () => {
    const user = userEvent.setup(), unavailable = fixture();
    const first = render(<GeneralTaskWorkspace api={unavailable.api} />);
    await screen.findByText("Ready for a general task");
    expect(screen.getByRole("combobox", { name: "Consultation mode" })).toHaveValue("local_only");
    expect(screen.getByRole("option", { name: "Ask before consulting" })).toBeDisabled();
    expect(screen.getByText(/Configure an explicit host consultant profile/u)).toBeVisible();
    first.unmount();
    const { api } = fixture([], { ...ready, consultation: { available: true, reason: "Configured", model: "test-consultant" } });
    render(<GeneralTaskWorkspace api={api} />); await fill(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Consultation mode" }), "ask_before_consulting");
    await user.click(screen.getByRole("button", { name: "Create and start task" }));
    expect(api.createGeneralTask).toHaveBeenCalledWith(expect.objectContaining({ routing: "ask_before_consulting" }));
    expect(api.decideGeneralTaskConsultation).not.toHaveBeenCalled();
  });
  it("requires the exact preview before approval, escapes its packet, and needs a separate Resume", async () => {
    const user = userEvent.setup(), pending = consultationTask(), { api } = fixture([pending]);
    api.previewGeneralTaskConsultation.mockResolvedValue(exactPreview());
    api.decideGeneralTaskConsultation.mockResolvedValue({ ...pending, revision: 4, canResume: true, consultation: { ...pending.consultation!, state: "approved" } });
    const { container } = render(<GeneralTaskWorkspace api={api} />);
    expect(await screen.findByRole("button", { name: "Approve exact consultation" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Resume task" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review consultation packet" }));
    const preview = await screen.findByRole("region", { name: "Exact consultation preview" });
    expect(preview).toHaveTextContent("fixture-account"); expect(preview).toHaveTextContent("USD 0.100000");
    expect(preview).toHaveTextContent("input/public.txt"); expect(preview).toHaveTextContent("output/partial.md");
    expect(preview).toHaveTextContent("<script>do not execute</script>"); expect(container.querySelector("script,img,iframe")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Approve exact consultation" }));
    expect(api.decideGeneralTaskConsultation).toHaveBeenCalledExactlyOnceWith({ id, proposalId, proposalSha256: "c".repeat(64), decision: "approve" });
    expect(api.resumeGeneralTask).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Resume task" }));
    expect(api.resumeGeneralTask).toHaveBeenCalledExactlyOnceWith(id);
  });
  it("rejects a late preview after the proposal changes", async () => {
    const user = userEvent.setup(), wait = deferred<GeneralTaskConsultationPreview>(), { api, emit } = fixture([consultationTask()]);
    api.previewGeneralTaskConsultation.mockReturnValue(wait.promise);
    render(<GeneralTaskWorkspace api={api} />); await user.click(await screen.findByRole("button", { name: "Review consultation packet" }));
    await act(async () => emit(consultationTask({ revision: 4, consultation: { ...consultationTask().consultation!, proposalSha256: "b".repeat(64) } })));
    await act(async () => wait.resolve(exactPreview()));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed or expired");
    expect(screen.getByRole("button", { name: "Approve exact consultation" })).toBeDisabled();
    expect(api.decideGeneralTaskConsultation).not.toHaveBeenCalled();
  });
  it.each([{ maxFeeMicrousd: 100001 }, { model: "different" }, { packetSha256: "invalid" }])(
    "rejects inconsistent preview fields %j", async changed => {
      const user = userEvent.setup(), { api } = fixture([consultationTask()]); api.previewGeneralTaskConsultation.mockResolvedValue({ ...exactPreview(), ...changed });
      render(<GeneralTaskWorkspace api={api} />); await user.click(await screen.findByRole("button", { name: "Review consultation packet" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("changed or expired");
      expect(screen.getByRole("button", { name: "Approve exact consultation" })).toBeDisabled();
    });
  it.each(["pending", "settled", "declined", "revoked", "uncertain"] as const)("keeps expired %s packets readable without approval", async state => {
    const user = userEvent.setup(), base = consultationTask(), { api } = fixture([consultationTask({ consultation: { ...base.consultation!, state } })]);
    api.previewGeneralTaskConsultation.mockResolvedValue({ ...exactPreview(), state, expiresAt: 1 });
    render(<GeneralTaskWorkspace api={api} />); await user.click(await screen.findByRole("button", { name: "Review consultation packet" }));
    expect(await screen.findByRole("region", { name: "Exact consultation preview" })).toHaveTextContent("available for review only");
    if (state === "pending") expect(screen.getByRole("button", { name: "Approve exact consultation" })).toBeDisabled();
    else expect(screen.queryByRole("button", { name: "Approve exact consultation" })).not.toBeInTheDocument();
    expect(api.decideGeneralTaskConsultation).not.toHaveBeenCalled();
  });
  it.each([{ status: "running", cleanupConfirmed: false }, { status: "paused", cleanupConfirmed: false }] as const)("blocks pending decisions before inactive cleanup %j", async changed => {
    const user = userEvent.setup(), { api } = fixture([consultationTask(changed)]);
    api.previewGeneralTaskConsultation.mockResolvedValue(exactPreview());
    render(<GeneralTaskWorkspace api={api} />); await user.click(await screen.findByRole("button", { name: "Review consultation packet" }));
    await screen.findByRole("region", { name: "Exact consultation preview" });
    expect(screen.getByRole("button", { name: "Approve exact consultation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline consultation" })).toBeDisabled();
    expect(api.decideGeneralTaskConsultation).not.toHaveBeenCalled();
  });
  it("discards a loaded preview on source/proposal change and does not approve it", async () => {
    const user = userEvent.setup(), { api, emit } = fixture([consultationTask()]); api.previewGeneralTaskConsultation.mockResolvedValue(exactPreview());
    render(<GeneralTaskWorkspace api={api} />); await user.click(await screen.findByRole("button", { name: "Review consultation packet" }));
    await screen.findByRole("region", { name: "Exact consultation preview" });
    await act(async () => emit(consultationTask({ revision: 4, consultation: { ...consultationTask().consultation!, proposalSha256: "b".repeat(64) } })));
    expect(screen.queryByRole("region", { name: "Exact consultation preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve exact consultation" })).toBeDisabled();
  });
  it("records decline/revoke separately, shows dispatch uncertainty and retains fee totals", async () => {
    const user = userEvent.setup(), pending = consultationTask(), { api, emit } = fixture([pending]);
    api.decideGeneralTaskConsultation.mockResolvedValue({ ...pending, revision: 4, canResume: true, consultation: { ...pending.consultation!, state: "declined" } });
    render(<GeneralTaskWorkspace api={api} />); await user.click(await screen.findByRole("button", { name: "Decline consultation" }));
    expect(api.resumeGeneralTask).not.toHaveBeenCalled();
    await act(async () => emit({ ...pending, revision: 5, status: "running", consultation: { ...pending.consultation!, state: "dispatching" }, fees: { reservedMicrousd: 100000, settledMicrousd: 64 } }));
    expect(screen.getByText(/data already disclosed cannot be recalled/u)).toBeVisible();
    expect(screen.getByRole("article", { name: "Selected general task" })).toHaveTextContent("USD 0.000064");
    api.decideGeneralTaskConsultation.mockResolvedValue({ ...pending, revision: 6, consultation: { ...pending.consultation!, state: "uncertain" } });
    await user.click(screen.getByRole("button", { name: "Revoke consultation" }));
    expect(api.decideGeneralTaskConsultation).toHaveBeenLastCalledWith({ id, proposalId, proposalSha256: "c".repeat(64), decision: "revoke" });
    expect(screen.queryByRole("button", { name: "Resume task" })).not.toBeInTheDocument(); expect(api.resumeGeneralTask).not.toHaveBeenCalled();
  });
});
describe("general task workspace", () => {
  it("exports the displayed multi-file bundle without changing unfinished-work acceptance", async () => {
    const user = userEvent.setup(), bundle = { manifestSha256: "c".repeat(64), fileCount: 2, totalBytes: 1024 };
    const asset = { path: "output/assets/theme.css", bytes: 774, sha256: "d".repeat(64) };
    const { api } = fixture([submitted({ status: "incomplete", artifacts: [artifact, asset], bundle })]);
    render(<GeneralTaskWorkspace api={api} />);
    const panel = await screen.findByRole("region", { name: "Task artifacts" });
    expect(panel).toHaveTextContent("2 files · 1.0 KB");
    expect(panel).toHaveTextContent("ZIP contains all output files with their folder structure.");
    expect(within(panel).getByRole("button", { name: "Export output/assets/theme.css" })).toBeEnabled();
    expect(screen.getByText(/saved artifacts are unfinished work/u)).toBeVisible();
    await user.click(within(panel).getByRole("button", { name: "Export all as ZIP" }));
    expect(api.exportGeneralTaskBundle).toHaveBeenCalledExactlyOnceWith({ id, manifestSha256: bundle.manifestSha256 });
    expect(await screen.findByText("ZIP bundle exported.")).toBeVisible();
    expect(screen.getByText(/saved artifacts are unfinished work/u)).toBeVisible();
    expect(api.startGeneralTask).not.toHaveBeenCalled(); expect(api.resumeGeneralTask).not.toHaveBeenCalled();
    expect(api.createGeneralTask).not.toHaveBeenCalled(); expect(api.exportGeneralTaskArtifact).not.toHaveBeenCalled();
  });
  it.each([{ status: "running", cleanupConfirmed: true }, { status: "cancelled", cleanupConfirmed: false }] as const)(
    "blocks bundle export during work or unconfirmed cleanup %j", async changed => {
      const { api } = fixture([submitted({ ...changed, bundle: { manifestSha256: "c".repeat(64), fileCount: 1, totalBytes: artifact.bytes } })]);
      render(<GeneralTaskWorkspace api={api} />);
      expect(await screen.findByRole("button", { name: "Export all as ZIP" })).toBeDisabled();
      expect(api.exportGeneralTaskBundle).not.toHaveBeenCalled();
    });
  it("disables duplicate exports while the dialog is pending and uses a refreshed manifest next time", async () => {
    const user = userEvent.setup(), pending = deferred<{ exported: boolean }>();
    const bundle = { manifestSha256: "c".repeat(64), fileCount: 1, totalBytes: artifact.bytes };
    const { api, emit } = fixture([submitted({ bundle })]); api.exportGeneralTaskBundle.mockReturnValueOnce(pending.promise);
    render(<GeneralTaskWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: "Export all as ZIP" }));
    expect(screen.getByRole("button", { name: "Export all as ZIP" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export output/report.md" })).toBeDisabled();
    await act(async () => emit(submitted({ revision: 5, bundle: { ...bundle, manifestSha256: "d".repeat(64) } })));
    await act(async () => pending.resolve({ exported: false }));
    expect(await screen.findByText("ZIP export cancelled.")).toBeVisible();
    expect(screen.queryByText("ZIP bundle exported.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export all as ZIP" }));
    expect(api.exportGeneralTaskBundle).toHaveBeenNthCalledWith(2, { id, manifestSha256: "d".repeat(64) });
  });
  it("keeps individual exports available when a bundle is unavailable and renders the reason inertly", async () => {
    const { api } = fixture([submitted({ bundleUnavailableReason: "ZIP unavailable: <script>unsafe names</script>" })]);
    const { container } = render(<GeneralTaskWorkspace api={api} />);
    expect(await screen.findByText("ZIP unavailable: <script>unsafe names</script>")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Export all as ZIP" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export output/report.md" })).toBeEnabled();
    expect(container.querySelector("script,img,iframe")).toBeNull();
  });
  it("reports bundle export errors without displaying host details or a success message", async () => {
    const user = userEvent.setup(), { api } = fixture([submitted({ bundle: { manifestSha256: "c".repeat(64), fileCount: 1, totalBytes: artifact.bytes } })]);
    api.exportGeneralTaskBundle.mockRejectedValue(new Error("private host diagnostic"));
    render(<GeneralTaskWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: "Export all as ZIP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The ZIP bundle could not be exported");
    expect(screen.queryByText(/private host diagnostic/u)).not.toBeInTheDocument();
    expect(screen.queryByText("ZIP bundle exported.")).not.toBeInTheDocument();
  });
  it("starts from a goal alone without granting retrieval to a URL mentioned in the goal", async () => {
    const user = userEvent.setup(), { api } = fixture(); render(<GeneralTaskWorkspace api={api} />);
    await screen.findByText("Ready for a general task");
    const goal = "Write an offline example mentioning https://example.org/source";
    await user.type(screen.getByRole("textbox", { name: "Task goal" }), goal);
    await user.click(screen.getByRole("checkbox", { name: /^I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Create and start task" }));
    expect(api.chooseGeneralTaskInputs).not.toHaveBeenCalled();
    expect(api.createGeneralTask).toHaveBeenCalledExactlyOnceWith({ goal, outputName: "report.md", publicOrSynthetic: true });
  });
  it("requires separate retrieval consent and sends the exact URL list with the default system resolver", async () => {
    const user = userEvent.setup(), { api } = fixture(); render(<GeneralTaskWorkspace api={api} />);
    await screen.findByText("Ready for a general task");
    await user.type(screen.getByRole("textbox", { name: "Task goal" }), "Compare these public sources");
    await user.type(screen.getByRole("textbox", { name: "Public source URLs (optional)" }), "https://example.org/a?year=2026\nhttps://example.org/b");
    expect(screen.getByRole("combobox", { name: "Hostname lookup" })).toHaveValue("system");
    await user.click(screen.getByRole("checkbox", { name: /^I confirm/u }));
    expect(screen.getByRole("button", { name: "Create and start task" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /^Allow SOAR/u }));
    await user.click(screen.getByRole("button", { name: "Create and start task" }));
    expect(api.createGeneralTask).toHaveBeenCalledExactlyOnceWith({ goal: "Compare these public sources", outputName: "report.md", publicOrSynthetic: true,
      publicSources: { urls: ["https://example.org/a?year=2026", "https://example.org/b"], allowPublicRetrieval: true, dnsResolver: "system" } });
  });
  it("revokes retrieval consent after URL and resolver changes and discloses Cloudflare only when selected", async () => {
    const user = userEvent.setup(), { api } = fixture(); render(<GeneralTaskWorkspace api={api} />); await fill(user);
    await user.type(screen.getByRole("textbox", { name: "Public source URLs (optional)" }), "https://example.org/a");
    expect(screen.getByRole("checkbox", { name: /^I confirm/u })).not.toBeChecked();
    expect(screen.queryByText(/Cloudflare receives hostname lookups/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /^Allow SOAR/u }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Hostname lookup" }), "cloudflare_v1");
    expect(screen.getByRole("checkbox", { name: /^Allow SOAR/u })).not.toBeChecked();
    expect(screen.getByText(/Cloudflare receives hostname lookups/u)).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /^Allow SOAR/u }));
    await user.type(screen.getByRole("textbox", { name: "Public source URLs (optional)" }), "?revision=2");
    expect(screen.getByRole("checkbox", { name: /^Allow SOAR/u })).not.toBeChecked();
    expect(api.createGeneralTask).not.toHaveBeenCalled();
  });
  it("clears file and URL authority when optional inputs are removed", async () => {
    const user = userEvent.setup(), { api } = fixture(); render(<GeneralTaskWorkspace api={api} />); await fill(user);
    await user.type(screen.getByRole("textbox", { name: "Public source URLs (optional)" }), "https://example.org/a");
    await user.click(screen.getByRole("checkbox", { name: /^Allow SOAR/u }));
    await user.clear(screen.getByRole("textbox", { name: "Public source URLs (optional)" }));
    await user.click(screen.getByRole("button", { name: "Clear files" }));
    expect(screen.queryByRole("checkbox", { name: /^Allow SOAR/u })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /^I confirm/u }));
    await user.click(screen.getByRole("button", { name: "Create and start task" }));
    expect(api.createGeneralTask).toHaveBeenCalledExactlyOnceWith({ goal: "Audit the invoice batch", outputName: "report.md", publicOrSynthetic: true });
  });
  it.each(["http://example.org/source", "https://example.org/source#fragment", "https://example.org/a\nhttps://example.org/b\nhttps://example.org/c\nhttps://example.org/d"])(
    "rejects an invalid or excessive explicit public-source list", async urls => {
      const user = userEvent.setup(), { api } = fixture(); render(<GeneralTaskWorkspace api={api} />); await fill(user);
      await user.type(screen.getByRole("textbox", { name: "Public source URLs (optional)" }), urls);
      expect(screen.getByRole("textbox", { name: "Public source URLs (optional)" })).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("checkbox", { name: /^Allow SOAR/u })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Create and start task" })).toBeDisabled();
      expect(api.createGeneralTask).not.toHaveBeenCalled();
    });
  it("restores approved URLs and actual host receipts as inert metadata without granting acceptance", async () => {
    const url = "https://example.org/source?q=%3Cimg%3E", source = { dispatchId: "dispatch-1", url, sha256: "d".repeat(64), bytes: 1234, retrievedAt: 1700000000000 };
    const { api, emit } = fixture([submitted({ inputs: [], network: { urls: [url], dnsResolver: "cloudflare_v1", maxFetches: 5, maxResponseBytes: 65536 }, sources: [], publicFetches: 0 })]);
    const { container } = render(<GeneralTaskWorkspace api={api} />);
    expect(await screen.findByRole("region", { name: "Approved public sources" })).toHaveTextContent(url);
    expect(screen.getByRole("region", { name: "Host source receipts" })).toHaveTextContent("No completed source receipt yet");
    await act(async () => emit(submitted({ revision: 5, inputs: [], network: { urls: [url], dnsResolver: "cloudflare_v1", maxFetches: 5, maxResponseBytes: 65536 }, sources: [source], publicFetches: 1 })));
    expect(screen.getByRole("region", { name: "Approved public sources" })).toHaveTextContent("1 / 5 GET attempts");
    const receipts = screen.getByRole("region", { name: "Host source receipts" });
    expect(receipts).toHaveTextContent(source.sha256); expect(receipts).toHaveTextContent(source.dispatchId); expect(receipts).toHaveTextContent(url);
    expect(within(receipts).queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("a,img,iframe,script")).toBeNull();
    expect(screen.getByText(/has not been independently evaluated for correctness/u)).toBeVisible();
  });
  it("starts through the opaque selection only after explicit goal-and-input attestation", async () => {
    const user = userEvent.setup(), { api } = fixture(); render(<GeneralTaskWorkspace api={api} />);
    expect(screen.getByRole("button", { name: "Create and start task" })).toBeDisabled();
    await fill(user);
    expect(screen.getByRole("textbox", { name: "Output filename" })).toHaveValue("report.md");
    await user.click(screen.getByRole("button", { name: "Create and start task" }));
    expect(api.createGeneralTask).toHaveBeenCalledExactlyOnceWith({ goal: "Audit the invoice batch", inputSelectionId: selectedFiles.id, outputName: "report.md", publicOrSynthetic: true });
    expect(api.startGeneralTask).toHaveBeenCalledExactlyOnceWith(id);
    expect(await screen.findByRole("article", { name: "Selected general task" })).toHaveTextContent("Working");
  });
  it("revokes the declaration after a goal/file change and refuses path-like output names", async () => {
    const user = userEvent.setup(), { api } = fixture(); render(<GeneralTaskWorkspace api={api} />); await fill(user);
    await user.type(screen.getByRole("textbox", { name: "Task goal" }), " carefully");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Change files" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await user.clear(screen.getByRole("textbox", { name: "Output filename" }));
    await user.type(screen.getByRole("textbox", { name: "Output filename" }), "../report.md");
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Create and start task" })).toBeDisabled();
    expect(api.createGeneralTask).not.toHaveBeenCalled();
  });
  it("retains a queued task when starting fails and retries its start without creating a duplicate", async () => {
    const user = userEvent.setup(), { api } = fixture(); api.startGeneralTask.mockRejectedValueOnce(new Error("private diagnostic"));
    render(<GeneralTaskWorkspace api={api} />); await fill(user); await user.click(screen.getByRole("button", { name: "Create and start task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("saved but could not start");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private diagnostic");
    await user.click(screen.getByRole("button", { name: "Start task" }));
    expect(api.createGeneralTask).toHaveBeenCalledOnce(); expect(api.startGeneralTask).toHaveBeenCalledTimes(2);
  });
  it("restores saved state and uses host-authorized pause, resume and cancel actions", async () => {
    const user = userEvent.setup(), { api } = fixture([task({ status: "running", revision: 2, cleanupConfirmed: false })]);
    render(<GeneralTaskWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: "Pause task" }));
    expect(api.pauseGeneralTask).toHaveBeenCalledExactlyOnceWith(id);
    await user.click(await screen.findByRole("button", { name: "Resume task" }));
    expect(api.resumeGeneralTask).toHaveBeenCalledExactlyOnceWith(id);
    await user.click(await screen.findByRole("button", { name: "Cancel task" }));
    expect(api.cancelGeneralTask).toHaveBeenCalledExactlyOnceWith(id);
    expect(await screen.findByText(/did not submit a completed deliverable/u)).toBeVisible();
    expect(api.createGeneralTask).not.toHaveBeenCalled();
  });
  it("keeps submitted work distinct from independent acceptance and exports the exact artifact reference", async () => {
    const user = userEvent.setup(), { api } = fixture([submitted()]); render(<GeneralTaskWorkspace api={api} />);
    expect(await screen.findByText(/has not been independently evaluated for correctness/u)).toBeVisible();
    expect(screen.getByRole("region", { name: "Approved public sources" })).toHaveTextContent("Public retrieval is not permitted");
    await user.click(screen.getByRole("button", { name: "Export output/report.md" }));
    expect(api.exportGeneralTaskArtifact).toHaveBeenCalledExactlyOnceWith({ id, path: artifact.path, sha256: artifact.sha256 });
    expect(await screen.findByText("Artifact exported.")).toBeVisible();
  });
  it("renders hostile Markdown without active HTML, images, links or embedded content", async () => {
    const user = userEvent.setup(), { api } = fixture([submitted()]);
    api.readGeneralTaskArtifact.mockResolvedValue({ id, ...artifact, kind: "text", text: '# Audit\n\n<script>alert(1)</script>\n<iframe src="https://invalid.example"></iframe>\n![remote](https://invalid.example/track)\n[Source](https://invalid.example)\n[Bad](javascript:alert(1))\n\n| Item | Amount |\n|---|---|\n| Row | 2 |', truncated: false });
    const { container } = render(<GeneralTaskWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: "Preview output/report.md" }));
    expect(await screen.findByRole("heading", { name: "Audit" })).toBeVisible();
    const panel = within(screen.getByRole("region", { name: "Artifact preview" }));
    expect(panel.getByRole("table")).toBeVisible();
    expect(panel.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("img,script,iframe,object,embed")).toBeNull();
  });
  it("treats HTML as literal text and binary files as metadata with native export only", async () => {
    const user = userEvent.setup(), binary = { path: "output/deck.pptx", bytes: 900, sha256: "c".repeat(64) }, html = { ...artifact, path: "output/page.html" };
    const { api } = fixture([submitted({ artifacts: [binary, html] })]);
    api.readGeneralTaskArtifact.mockImplementation(async ref => ({ ...ref, bytes: ref.path === binary.path ? 900 : 250, kind: ref.path === binary.path ? "binary" : "text", text: ref.path === binary.path ? null : '<img src="https://invalid.example">', truncated: false }));
    const { container } = render(<GeneralTaskWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: "Preview output/deck.pptx" }));
    expect(await screen.findByText(/no text preview/u)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Preview output/page.html" }));
    expect(await screen.findByText('<img src="https://invalid.example">')).toBeVisible(); expect(container.querySelector("img")).toBeNull();
  });
  it("rejects a mismatched preview identity and labels truncation", async () => {
    const user = userEvent.setup(), { api } = fixture([submitted()]);
    api.readGeneralTaskArtifact.mockResolvedValueOnce({ id: otherId, ...artifact, kind: "text", text: "wrong task", truncated: false });
    render(<GeneralTaskWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: "Preview output/report.md" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified"); expect(screen.queryByText("wrong task")).not.toBeInTheDocument();
    api.readGeneralTaskArtifact.mockResolvedValue({ id, ...artifact, kind: "text", text: "Partial text", truncated: true });
    await user.click(screen.getByRole("button", { name: "Preview output/report.md" }));
    expect(await screen.findByText(/preview is truncated/u)).toBeVisible();
  });
  it("ignores an older list response after a newer subscribed snapshot", async () => {
    const pending = deferred<GeneralTaskSnapshot[]>(), { api, emit } = fixture(); api.listGeneralTasks.mockReturnValue(pending.promise);
    render(<GeneralTaskWorkspace api={api} />);
    await act(async () => emit(submitted())); await act(async () => pending.resolve([task()]));
    expect(await screen.findByRole("article", { name: "Selected general task" })).toHaveTextContent("Submitted for review");
    expect(screen.queryByRole("button", { name: "Start task" })).not.toBeInTheDocument();
  });
  it("does not show a late artifact from a previously selected task", async () => {
    const user = userEvent.setup(), pending = deferred<GeneralTaskArtifactPreview>();
    const second = submitted({ id: otherId, goal: "Prepare another report", updatedAt: 4000 });
    const { api } = fixture([submitted(), second]); api.readGeneralTaskArtifact.mockReturnValue(pending.promise);
    render(<GeneralTaskWorkspace api={api} />);
    await user.click(await screen.findByRole("button", { name: "Preview output/report.md" }));
    await user.click(screen.getByRole("button", { name: /Prepare another report/u }));
    await act(async () => pending.resolve({ id, ...artifact, kind: "text", text: "Old private artifact", truncated: false }));
    expect(screen.queryByText("Old private artifact")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Selected general task" })).toHaveTextContent("Prepare another report");
  });
  it("rejects a stale artifact after its host snapshot changes", async () => {
    const user = userEvent.setup(), pending = deferred<GeneralTaskArtifactPreview>(), { api, emit } = fixture([submitted()]); api.readGeneralTaskArtifact.mockReturnValue(pending.promise);
    render(<GeneralTaskWorkspace api={api} />); await user.click(await screen.findByRole("button", { name: "Preview output/report.md" }));
    await act(async () => emit(submitted({ revision: 5, artifacts: [{ ...artifact, sha256: "c".repeat(64) }] })));
    await act(async () => pending.resolve({ id, ...artifact, kind: "text", text: "Stale bytes", truncated: false }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed"); expect(screen.queryByText("Stale bytes")).not.toBeInTheDocument();
  });
  it("advances same-revision elapsed time and expires resume without accepting an older reversal", async () => {
    const initial = task({ status: "paused", revision: 3, canResume: true, elapsedMs: 1000 });
    const { api, emit } = fixture([initial]); render(<GeneralTaskWorkspace api={api} />);
    expect(await screen.findByRole("button", { name: "Resume task" })).toBeVisible();
    await act(async () => emit({ ...initial, elapsedMs: 19000, canResume: false }));
    expect(screen.queryByRole("button", { name: "Resume task" })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Selected general task" })).toHaveTextContent("19s");
    await act(async () => emit(initial));
    expect(screen.queryByRole("button", { name: "Resume task" })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Selected general task" })).toHaveTextContent("19s");
  });
  it.each([task({ status: "running", artifacts: [artifact] }), task({ status: "cancelled", cleanupConfirmed: false, artifacts: [artifact] })])(
    "keeps artifact access disabled during work or unconfirmed cleanup", async value => {
      const { api } = fixture([value]); render(<GeneralTaskWorkspace api={api} />);
      expect(await screen.findByRole("button", { name: "Preview output/report.md" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Export output/report.md" })).toBeDisabled();
      expect(api.readGeneralTaskArtifact).not.toHaveBeenCalled(); expect(api.exportGeneralTaskArtifact).not.toHaveBeenCalled();
    });
  it("handles missing runtime and partial bridges without attempting unsupported calls", async () => {
    const probe = vi.fn(); Object.defineProperty(window, "soar", { configurable: true, value: { getGeneralTaskAvailability: probe } });
    const view = render(<GeneralTaskWorkspace />); expect(screen.getByText("General tasks are unavailable in this build")).toBeVisible(); expect(probe).not.toHaveBeenCalled(); view.unmount();
    const { api } = fixture([], { ...ready, available: false, executionMode: "unavailable", reason: "Configure the local runtime first." });
    render(<GeneralTaskWorkspace api={api} />); expect(await screen.findByText("Task runtime unavailable")).toBeVisible(); expect(screen.getByRole("button", { name: "Create and start task" })).toBeDisabled();
  });
  it("marks scripted execution and treats cancelled native export as cancellation", async () => {
    const user = userEvent.setup(), { api } = fixture([submitted()], { ...ready, executionMode: "scripted" }); api.exportGeneralTaskArtifact.mockResolvedValue({ exported: false });
    render(<GeneralTaskWorkspace api={api} />); expect(await screen.findByText(/Scripted test/u)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Export output/report.md" })); expect(await screen.findByText("Export cancelled.")).toBeVisible(); expect(screen.queryByText("Artifact exported.")).not.toBeInTheDocument();
  });
  it("sends the chosen model profile with the create request and leaves it out by default", async () => {
    const user = userEvent.setup(), { api } = fixture([], { ...ready, profile: "heavy", profiles: ["standard", "heavy"] });
    render(<GeneralTaskWorkspace api={api} />);
    await user.type(await screen.findByLabelText("Task goal"), "Make a memo.");
    await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "Create and start task" }));
    expect(api.createGeneralTask.mock.calls[0]![0]).not.toHaveProperty("profile");
    await user.click(screen.getByRole("button", { name: "New general task" }));
    await user.type(await screen.findByLabelText("Task goal"), "Make a memo.");
    await user.selectOptions(screen.getByLabelText("Model profile"), "standard");
    await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "Create and start task" }));
    expect(api.createGeneralTask.mock.calls[1]![0]).toMatchObject({ profile: "standard" });
  });
  it("shows the agent's plan and finish summary as untrusted, reported issues, claim judgements and per-action details", async () => {
    const judged: GeneralTaskSnapshot = { ...submitted(), profile: "heavy", plan: "1. Read. 2. Write.", finishSummary: "Wrote the memo.", reportedIssues: ["1 finish attempt failed the host checks before the final one passed."],
      entailment: { counts: { supported: 3, partial: 1, unsupported: 0, contradicted: 0, not_judged: 0 }, entailmentCalls: 4, truncated: false, claims: [{ id: "C1", verdict: "supported" }, { id: "C2", verdict: "partial", reason: "weaker form" }] },
      events: [{ sequence: 1, type: "tool_started", summary: "Executing an admitted action.", detail: "execute: python3 compute.py" }] };
    const { api } = fixture([judged]);
    render(<GeneralTaskWorkspace api={api} />);
    expect(await screen.findByRole("heading", { name: "Submitted with reported issues" })).toBeVisible();
    expect(screen.getByText("1 finish attempt failed the host checks before the final one passed.")).toBeVisible();
    expect(screen.getByRole("region", { name: "What the agent did" })).toHaveTextContent("Untrusted");
    expect(screen.getByText("1. Read. 2. Write.")).toBeVisible(); expect(screen.getByText("Wrote the memo.")).toBeVisible();
    expect(screen.getByRole("region", { name: "Claim judgements" })).toHaveTextContent("C2 · partial · weaker form");
    expect(screen.getByText("Model profile: heavy")).toBeVisible();
    // Progress details are collapsed by default; the action line is present and labelled untrusted.
    expect(screen.getByText("execute: python3 compute.py")).toBeInTheDocument(); expect(screen.getByText("execute: python3 compute.py")).toHaveAttribute("title", expect.stringContaining("Untrusted"));
  });
  it("unsubscribes and ignores a history response after unmount", async () => {
    const pending = deferred<GeneralTaskSnapshot[]>(), { api, unsubscribe } = fixture(); api.listGeneralTasks.mockReturnValue(pending.promise);
    const view = render(<GeneralTaskWorkspace api={api} />); view.unmount(); await act(async () => pending.resolve([submitted()])); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("opens on the general task by default, keeps ⌘N there, and shows the legacy tracks only with Labs on", async () => {
    const user = userEvent.setup(), { api } = fixture(); const legacyCreate = vi.fn();
    const shell = { ...api, listSessions: vi.fn().mockResolvedValue([]), subscribeSessionEvents: vi.fn().mockReturnValue(() => undefined), createSession: legacyCreate,
      getReviewAvailability: vi.fn().mockResolvedValue({ local: { enabled: false, label: "Local model", reason: "x", declaredTokenFeeMicrousd: 0, costAccountingSummary: "", evidenceTransportSummary: "" }, hybrid: { enabled: false, reason: "", separatelyConfiguredPaidProviderReachable: false, reachabilitySummary: "", consent: "none" } }) };
    Object.defineProperty(window, "soar", { configurable: true, value: shell });
    render(<App />);
    expect(await screen.findByRole("form", { name: "New general task" })).toBeVisible();
    expect(screen.queryByTestId("review-current-changes")).toBeNull(); expect(screen.queryByTestId("coding-task-entry")).toBeNull(); expect(screen.queryByTestId("legacy-task-entry")).toBeNull();
    await user.keyboard("{Meta>}n{/Meta}");
    expect(screen.getByRole("form", { name: "New general task" })).toBeVisible(); expect(legacyCreate).not.toHaveBeenCalled();
    // Labs on: the legacy entries return and the legacy "New task" opens the investigator composer.
    api.getGeneralTaskAvailability.mockResolvedValue({ ...ready, labs: true });
    Object.defineProperty(window, "soar", { configurable: true, value: { ...shell, getGeneralTaskAvailability: api.getGeneralTaskAvailability } });
    render(<App />);
    expect(await screen.findByTestId("review-current-changes")).toBeVisible();
    await user.click(screen.getByTestId("legacy-task-entry")); expect(screen.getByRole("form", { name: "New task" })).toBeVisible();
  });
});
