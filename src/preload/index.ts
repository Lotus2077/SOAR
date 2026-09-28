import { contextBridge, ipcRenderer } from "electron";

import type { SessionUpdate, SoarRendererApi } from "../shared/contracts";
import type { PatchRunSnapshot } from "../shared/patch-run-contracts";
import type { GeneralTaskSnapshot } from "../shared/general-task-contracts";

// Keep the sandboxed preload dependency-free. Runtime channel validation lives
// in the main process; importing contracts here would pull Zod into a context
// where Electron intentionally blocks arbitrary Node module loading.
const IPC_CHANNELS = {
  chooseWorkspace: "soar:choose-workspace",
  createSession: "soar:create-session",
  listSessions: "soar:list-sessions",
  getSession: "soar:get-session",
  startSession: "soar:start-session",
  cancelSession: "soar:cancel-session",
  getReviewAvailability: "soar:get-review-availability",
  issueHybridSimulationConsentChallenge:
    "soar:issue-hybrid-simulation-consent-challenge",
  invalidateHybridSimulationConsentChallenges:
    "soar:invalidate-hybrid-simulation-consent-challenges",
  createChangeReviewSession: "soar:create-change-review-session",
  getChangeReviewView: "soar:get-change-review-view",
  getCloudCredentialStatus: "soar:get-cloud-credential-status",
  sessionUpdate: "soar:session-update",
} as const;

const api: SoarRendererApi = {
  getGeneralTaskAvailability: () => ipcRenderer.invoke("soar:general-task-availability"),
  chooseGeneralTaskInputs: () => ipcRenderer.invoke("soar:general-task-choose-inputs"),
  createGeneralTask: input => ipcRenderer.invoke("soar:general-task-create", input),
  listGeneralTasks: () => ipcRenderer.invoke("soar:general-task-list"),
  getGeneralTask: id => ipcRenderer.invoke("soar:general-task-get", id),
  startGeneralTask: id => ipcRenderer.invoke("soar:general-task-start", id),
  pauseGeneralTask: id => ipcRenderer.invoke("soar:general-task-pause", id),
  resumeGeneralTask: id => ipcRenderer.invoke("soar:general-task-resume", id),
  cancelGeneralTask: id => ipcRenderer.invoke("soar:general-task-cancel", id),
  previewGeneralTaskConsultation: input => ipcRenderer.invoke("soar:general-task-preview-consultation", input),
  decideGeneralTaskConsultation: input => ipcRenderer.invoke("soar:general-task-decide-consultation", input),
  readGeneralTaskArtifact: input => ipcRenderer.invoke("soar:general-task-read-artifact", input),
  exportGeneralTaskArtifact: input => ipcRenderer.invoke("soar:general-task-export-artifact", input),
  exportGeneralTaskBundle: input => ipcRenderer.invoke("soar:general-task-export-bundle", input),
  subscribeGeneralTasks: listener => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: GeneralTaskSnapshot): void => listener(snapshot);
    ipcRenderer.on("soar:general-task-update", handler);
    return () => ipcRenderer.removeListener("soar:general-task-update", handler);
  },
  getPatchRunAvailability: () => ipcRenderer.invoke("soar:patch-run-availability"),
  createPatchRun: (input) => ipcRenderer.invoke("soar:patch-run-create", input),
  listPatchRuns: () => ipcRenderer.invoke("soar:patch-run-list"),
  getPatchRun: (id) => ipcRenderer.invoke("soar:patch-run-get", id),
  startPatchRun: (id) => ipcRenderer.invoke("soar:patch-run-start", id),
  cancelPatchRun: (id) => ipcRenderer.invoke("soar:patch-run-cancel", id),
  exportPatchRun: (id) => ipcRenderer.invoke("soar:patch-run-export", id),
  decidePatchRun: (input) => ipcRenderer.invoke("soar:patch-run-decide", input),
  subscribePatchRuns: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: PatchRunSnapshot): void => listener(snapshot);
    ipcRenderer.on("soar:patch-run-update", handler);
    return () => ipcRenderer.removeListener("soar:patch-run-update", handler);
  },
  chooseWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.chooseWorkspace),
  createSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.createSession, input),
  listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.listSessions),
  getSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.getSession, id),
  startSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.startSession, id),
  cancelSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.cancelSession, id),
  getReviewAvailability: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getReviewAvailability),
  issueHybridSimulationConsentChallenge: (input) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.issueHybridSimulationConsentChallenge,
      input,
    ),
  invalidateHybridSimulationConsentChallenges: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.invalidateHybridSimulationConsentChallenges,
    ),
  createChangeReviewSession: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.createChangeReviewSession, input),
  getChangeReviewView: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.getChangeReviewView, id),
  getCloudCredentialStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getCloudCredentialStatus),
  subscribeSessionEvents: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, update: SessionUpdate): void => {
      listener(update);
    };
    ipcRenderer.on(IPC_CHANNELS.sessionUpdate, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sessionUpdate, handler);
  },
};

contextBridge.exposeInMainWorld("soar", Object.freeze(api));
