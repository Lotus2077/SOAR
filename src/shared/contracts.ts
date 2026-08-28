import { z } from "zod";

import {
  SESSION_STATUSES,
  SessionStatusSchema,
  type SessionStatus,
} from "./session-events";

export const sessionStatuses = SESSION_STATUSES;
export const sessionStatusSchema = SessionStatusSchema;
export type { SessionStatus };

export const createSessionInputSchema = z
  .object({
    task: z.string().trim().min(1).max(100_000),
    workspaceRoot: z.string().trim().min(1).max(4_096),
  })
  .strict();

export const sessionIdSchema = z.string().uuid();

export interface WorkspaceSelection {
  path: string;
  name: string;
}

export interface SessionEventView {
  id: string;
  sequence: number;
  type: string;
  createdAt: string;
  payload: unknown;
}

export interface SessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSnapshot extends SessionSummary {
  workspaceRoot: string;
  events: SessionEventView[];
}

export type SessionUpdate =
  | {
      sessionId: string;
      kind: "snapshot";
      snapshot: SessionSnapshot;
    }
  | {
      sessionId: string;
      kind: "stream";
      delta: string;
    };

export interface SoarRendererApi {
  chooseWorkspace(): Promise<WorkspaceSelection | null>;
  createSession(input: z.input<typeof createSessionInputSchema>): Promise<SessionSnapshot>;
  listSessions(): Promise<SessionSummary[]>;
  getSession(id: string): Promise<SessionSnapshot>;
  startSession(id: string): Promise<void>;
  cancelSession(id: string): Promise<void>;
  subscribeSessionEvents(listener: (update: SessionUpdate) => void): () => void;
}

export const IPC_CHANNELS = {
  chooseWorkspace: "soar:choose-workspace",
  createSession: "soar:create-session",
  listSessions: "soar:list-sessions",
  getSession: "soar:get-session",
  startSession: "soar:start-session",
  cancelSession: "soar:cancel-session",
  sessionUpdate: "soar:session-update",
} as const;
