import { z } from "zod";

import {
  APP_TASK_TRACKS,
  AppTaskTrackSchema,
  SESSION_STATUSES,
  SessionStatusSchema,
  type AppTaskTrack,
  type SessionStatus,
} from "./session-events";
import type { ReviewResultV1 } from "./review-result-contract";
import type {
  CloudSetupStatus,
  HybridLockedReachabilitySummary,
  HybridLockedReason,
  SaveCloudCredentialInput,
} from "./cloud-setup-contracts";

export const sessionStatuses = SESSION_STATUSES;
export const sessionStatusSchema = SessionStatusSchema;
export { APP_TASK_TRACKS, AppTaskTrackSchema };
export type { AppTaskTrack, SessionStatus };

export const createSessionInputSchema = z
  .object({
    task: z.string().trim().min(1).max(100_000),
    workspaceRoot: z.string().trim().min(1).max(4_096),
    taskTrack: z.literal("repository-investigator-v1"),
  })
  .strict();

export const createChangeReviewSessionInputSchema = z
  .object({
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
  /** Absent only for sessions created before task tracks were persisted. */
  taskTrack?: AppTaskTrack;
  events: SessionEventView[];
}

export type ReviewFreshness =
  | "pending"
  | "not_available"
  | "fresh_complete"
  | "identity_same_unverifiable"
  | "drifted"
  | "unavailable";

export interface ReviewAvailability {
  local: {
    enabled: boolean;
    label: string;
    providerId?: string;
    model?: string;
    reason?: string;
    declaredTokenFeeMicrousd: 0;
    costAccountingSummary: "The configured vLLM route declares a $0 token fee; endpoint billing and infrastructure costs are not independently verified.";
    evidenceTransportSummary: "Review evidence is sent to the configured vLLM endpoint.";
  };
  hybrid: {
    enabled: false;
    reason: HybridLockedReason;
    separatelyConfiguredPaidProviderReachable: false;
    reachabilitySummary: HybridLockedReachabilitySummary;
    consent: "none";
  };
}

export interface ReviewPhaseView {
  id: "inspection" | "checkpoint" | "synthesis" | "fallback";
  status: "pending" | "active" | "complete" | "failed" | "cancelled";
  label: string;
}

export interface ReviewCoverageView {
  schemaVersion: "review-coverage-view-v1";
  status: "complete" | "incomplete";
  counts: {
    changedPaths: number;
    admittedPaths: number;
    omittedPaths: number;
    changedHunks: number;
    admittedHunks: number;
    omittedHunks: number;
  };
  changedTestCount: number;
  runtimeCodeChangedWithoutChangedTest: boolean;
  snapshotRevalidated: boolean;
  omissionCodes: string[];
}

export interface ChangeReviewView {
  sessionId: string;
  status: SessionStatus;
  freshness: ReviewFreshness;
  phases: ReviewPhaseView[];
  route?: {
    providerId: string;
    model: string;
    locality: "local" | "cloud";
    reasonCode: string;
  };
  reviewResult?: ReviewResultV1;
  coverage?: ReviewCoverageView;
  baseRevision?: string;
  acceptanceNote?: string;
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
  getReviewAvailability(): Promise<ReviewAvailability>;
  createChangeReviewSession(
    input: z.input<typeof createChangeReviewSessionInputSchema>,
  ): Promise<SessionSnapshot>;
  getChangeReviewView(id: string): Promise<ChangeReviewView>;
  getCloudSetupStatus(): Promise<CloudSetupStatus>;
  saveCloudCredential(input: SaveCloudCredentialInput): Promise<CloudSetupStatus>;
  deleteCloudCredential(): Promise<CloudSetupStatus>;
  subscribeSessionEvents(listener: (update: SessionUpdate) => void): () => void;
}

export const IPC_CHANNELS = {
  chooseWorkspace: "soar:choose-workspace",
  createSession: "soar:create-session",
  listSessions: "soar:list-sessions",
  getSession: "soar:get-session",
  startSession: "soar:start-session",
  cancelSession: "soar:cancel-session",
  getReviewAvailability: "soar:get-review-availability",
  createChangeReviewSession: "soar:create-change-review-session",
  getChangeReviewView: "soar:get-change-review-view",
  getCloudSetupStatus: "soar:get-cloud-setup-status",
  saveCloudCredential: "soar:save-cloud-credential",
  deleteCloudCredential: "soar:delete-cloud-credential",
  sessionUpdate: "soar:session-update",
} as const;
