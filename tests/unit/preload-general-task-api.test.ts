import { describe, expect, it, vi } from "vitest";
import { GENERAL_TASK_IPC_CHANNELS as channels, type SoarGeneralTaskApi } from "../../src/shared/general-task-contracts";

const electron = vi.hoisted(() => ({ exposed: new Map<string, unknown>(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (name: string, api: unknown) => electron.exposed.set(name, api) },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener },
}));

describe("preload general-task bridge", () => {
  it("exposes every general-task method, the verdict ones included, on the frozen bridge and routes them to their channels", async () => {
    await import("../../src/preload/index");
    const api = electron.exposed.get("soar") as Record<keyof SoarGeneralTaskApi, (...args: unknown[]) => unknown>;
    expect(Object.isFrozen(api)).toBe(true);
    // The renderer's `SoarRendererApi` is `Partial<SoarGeneralTaskApi>`, so only this check proves the bridge carries each method.
    const methods: (keyof SoarGeneralTaskApi)[] = ["getGeneralTaskAvailability", "chooseGeneralTaskInputs", "createGeneralTask", "listGeneralTasks", "getGeneralTask", "startGeneralTask", "pauseGeneralTask",
      "resumeGeneralTask", "cancelGeneralTask", "previewGeneralTaskConsultation", "decideGeneralTaskConsultation", "readGeneralTaskArtifact", "exportGeneralTaskArtifact", "exportGeneralTaskBundle",
      "recordGeneralTaskVerdict", "exportGeneralTaskVerdictReceipt", "subscribeGeneralTasks"];
    for (const name of methods) expect(typeof api[name], name).toBe("function");
    const verdict = { id: "00000000-0000-4000-8000-000000000101", decision: "accept", ownerMinutes: 8, interventions: 1, exportedThroughApp: true };
    api.recordGeneralTaskVerdict(verdict);
    expect(electron.invoke).toHaveBeenLastCalledWith(channels.recordVerdict, verdict);
    api.exportGeneralTaskVerdictReceipt(verdict.id);
    expect(electron.invoke).toHaveBeenLastCalledWith(channels.exportVerdictReceipt, verdict.id);
    api.exportGeneralTaskBundle({ id: verdict.id, manifestSha256: "a".repeat(64) });
    expect(electron.invoke).toHaveBeenLastCalledWith(channels.exportBundle, { id: verdict.id, manifestSha256: "a".repeat(64) });
  });
});
