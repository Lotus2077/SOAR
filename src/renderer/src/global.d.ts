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
  }

  interface SoarSessionSnapshot extends SoarSessionSummary {
    workspaceRoot: string;
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
