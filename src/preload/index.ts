import { contextBridge, ipcRenderer } from "electron";

import type { SessionUpdate, SoarRendererApi } from "../shared/contracts";

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
  createChangeReviewSession: "soar:create-change-review-session",
  getChangeReviewView: "soar:get-change-review-view",
  sessionUpdate: "soar:session-update",
} as const;

const api: SoarRendererApi = {
  chooseWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.chooseWorkspace),
  createSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.createSession, input),
  listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.listSessions),
  getSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.getSession, id),
  startSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.startSession, id),
  cancelSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.cancelSession, id),
  getReviewAvailability: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getReviewAvailability),
  createChangeReviewSession: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.createChangeReviewSession, input),
  getChangeReviewView: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.getChangeReviewView, id),
  subscribeSessionEvents: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, update: SessionUpdate): void => {
      listener(update);
    };
    ipcRenderer.on(IPC_CHANNELS.sessionUpdate, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sessionUpdate, handler);
  },
};

contextBridge.exposeInMainWorld("soar", Object.freeze(api));
