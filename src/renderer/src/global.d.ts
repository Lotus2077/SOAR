import type { SoarRendererApi } from "../../shared/contracts";

declare global {
  type SoarSessionStatus =
    | "idle"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "error"
    | "cancelled"
    | "interrupted"
    | string;

  interface SoarSessionEvent {
    id: string;
    sequence: number;
    type: string;
    createdAt: string;
    payload?: unknown;
  }

  interface SoarSessionSummary {
    id: string;
    title: string;
    status: SoarSessionStatus;
    createdAt: string;
    updatedAt: string;
    executionMode?: "local" | "hybrid_simulation";
    simulationMarker?: string;
  }

  interface SoarSessionSnapshot extends SoarSessionSummary {
    workspaceRoot: string;
    taskTrack?: "repository-investigator-v1" | "change-review-v1";
    events: SoarSessionEvent[];
  }

  interface SoarSessionUpdate {
    sessionId: string;
    kind: "snapshot" | "stream";
    snapshot?: SoarSessionSnapshot;
    delta?: string;
  }

  interface Window {
    soar: SoarRendererApi;
  }
}
