import { contextBridge } from "electron";

const DEVELOPMENT_CANARY_MARKER =
  "SOAR_PR6R_DEVELOPMENT_CANARY_V1" as const;

// A1 intentionally exposes no IPC. Later checkpoints may add only the fixed,
// main-owned canary surface after its sender and projection contracts exist.
contextBridge.exposeInMainWorld(
  "soarPr6rDevelopmentCanary",
  Object.freeze({
    buildMarker: DEVELOPMENT_CANARY_MARKER,
    buildFlavor: "pr6r-development-canary",
    phase: "r-a",
    state: "structural_stub",
    costScope: "simulation",
    actualPaidAuthority: false,
  }),
);
