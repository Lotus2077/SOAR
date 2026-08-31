import {
  ArrowUp,
  CaretRight,
  CheckCircle,
  Clock,
  Code,
  Coins,
  Copy,
  Cpu,
  Files,
  FolderOpen,
  GitDiff,
  Gear,
  HardDrives,
  List,
  LockKey,
  MagnifyingGlass,
  SidebarSimple,
  Sparkle,
  Stop,
  TerminalWindow,
  WarningCircle,
  Wrench,
  X,
  XCircle,
} from "@phosphor-icons/react";
import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CloudSetupStatus } from "../../shared/cloud-setup-contracts";
import type {
  ChangeReviewView,
  HybridSimulationProjection,
  ReviewAvailability,
  ReviewFreshness,
  ReviewPhaseView,
  ReviewRouteIntent,
  SoarRendererApi,
} from "../../shared/contracts";
import {
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_RESULT_MARKER,
  type HybridSimulationConsentChallengeV1,
} from "../../shared/hybrid-simulation-contracts";
import { CloudSettings } from "./CloudSettings";

type Payload = Record<string, unknown>;

export const HYBRID_SIMULATION_MARKER = HYBRID_SIMULATION_RESULT_MARKER;

type HybridSimulationConsentChallenge = HybridSimulationConsentChallengeV1;
type ReviewRendererApi = Pick<
  SoarRendererApi,
  "getReviewAvailability" | "createChangeReviewSession" | "getChangeReviewView"
> & {
  issueHybridSimulationConsentChallenge?(input: {
    workspaceRoot: string;
    route: "hybrid_simulation";
  }): Promise<HybridSimulationConsentChallenge>;
  invalidateHybridSimulationConsentChallenges?(): Promise<void>;
};

const defaultReviewAvailability: ReviewAvailability = {
  local: {
    enabled: false,
    label: "Local model",
    reason: "Checking local review support...",
    declaredTokenFeeMicrousd: 0,
    costAccountingSummary:
      "The configured vLLM route declares a $0 token fee; endpoint billing and infrastructure costs are not independently verified.",
    evidenceTransportSummary:
      "Review evidence is sent to the configured vLLM endpoint.",
  },
  hybrid: {
    enabled: false,
    reason:
      "Cloud setup does not enable Hybrid. Hybrid dispatch is locked in this build.",
    separatelyConfiguredPaidProviderReachable: false,
    reachabilitySummary:
      "This build performs no cloud-provider validation or dispatch.",
    consent: "none",
  },
};

type TranscriptItem =
  | { kind: "user"; id: string; text: string; time?: string }
  | { kind: "assistant"; id: string; text: string; time?: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      detail: string;
      state: "running" | "complete" | "error";
      time?: string;
    }
  | { kind: "error"; id: string; text: string; time?: string };

const terminalStatuses = new Set([
  "completed",
  "failed",
  "error",
  "cancelled",
  "canceled",
  "interrupted",
]);

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function useMediaQuery(query: string): boolean {
  const getMatches = () =>
    typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function useModalFocus(
  panelRef: React.RefObject<HTMLElement | null>,
  initialFocusRef: React.RefObject<HTMLElement | null>,
  open: boolean,
): void {
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => initialFocusRef.current?.focus());

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => element.getClientRects().length > 0 && !element.hasAttribute("inert"),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1) || first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected && previousFocus.getClientRects().length > 0) {
        previousFocus.focus();
      }
    };
  }, [initialFocusRef, open, panelRef]);
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (React.isValidElement<{ children?: ReactNode }>(node)) {
    return textFromNode(node.props.children);
  }
  return "";
}

function MarkdownCodeBlock({ children, ...props }: React.ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(textFromNode(children).replace(/\n$/, ""));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="markdown-code-block">
      <button type="button" className="markdown-copy-button" onClick={() => void copyCode()}>
        <Copy aria-hidden="true" />
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}

function MarkdownLink({ children, href, ...props }: React.ComponentProps<"a">) {
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    if (!href) return;
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="markdown-link">
      <a {...props} href={href} rel="noreferrer noopener" target="_blank">
        {children}
      </a>
      {href ? (
        <button
          type="button"
          className="markdown-link-copy"
          onClick={() => void copyLink()}
          aria-label="Copy link address"
          title="Copy link address"
        >
          <Copy aria-hidden="true" />
          <span className="sr-only">{copied ? "Link copied" : "Copy link address"}</span>
        </button>
      ) : null}
      {copied ? <span className="sr-only" role="status">Link copied</span> : null}
    </span>
  );
}

const markdownComponents: Components = {
  a: ({ node: _node, ...props }) => <MarkdownLink {...props} />,
  img: ({ node: _node, alt }) => (
    <span className="markdown-image-placeholder">[Image: {alt || "preview"}]</span>
  ),
  pre: ({ node: _node, ...props }) => <MarkdownCodeBlock {...props} />,
};

export function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function asPayload(value: unknown): Payload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Payload)
    : {};
}

function firstText(payload: Payload, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function shortText(value: string, max = 160): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function isRawStructuredReview(payload: Payload, text: string): boolean {
  if (
    asPayload(payload.reviewResult).schemaVersion === "change-review-result-v1" ||
    payload.structuredOutputContract === "change-review-result-v1"
  ) {
    return true;
  }
  const compact = text.replace(/\s+/g, "");
  return (
    compact.startsWith("{") &&
    compact.includes('"schemaVersion":"change-review-result-v1"')
  );
}

function normalizeStatus(status?: string): string {
  const value = status?.toLowerCase().trim() || "idle";
  return value === "canceled" ? "cancelled" : value;
}

function formatClock(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatRelative(value?: string): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function formatDuration(start?: string, end?: string): string {
  if (!start) return "0s";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "0s";
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function workspaceName(path?: string): string {
  if (!path) return "No workspace";
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || path;
}

function typeLabel(type: string): string {
  return type
    .replace(/[._:-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function routeReasonLabel(reason: string): string {
  if (reason === "MVP_LOCAL_PROOF") return "Local-only lease for the MVP proof";
  const labels: Record<string, string> = {
    local_investigation: "Local inspection collects change evidence",
    low_risk_local_review: "The local model can complete this review",
    cloud_admitted: "Cloud synthesis passed every admission check",
    local_fallback: "Cloud synthesis did not finish, so the review stayed local",
    disabled_provider: "Cloud routing is disabled",
    missing_credential: "Cloud routing has no configured credential",
    unhealthy_provider: "The cloud provider is not healthy",
    pricing_denial: "Cloud pricing could not be verified",
    capability_mismatch: "The proposed model lacks a required capability",
    egress_denial: "Evidence egress was not approved",
    budget_denial: "The paid route exceeds its fixed budget",
    deadline_denial: "The paid route cannot finish inside the deadline",
  };
  if (labels[reason]) return labels[reason];
  return typeLabel(reason);
}

function eventDetail(event: SoarSessionEvent): string {
  const payload = asPayload(event.payload);
  const type = event.type.toLowerCase();
  if (type === "completion.obligations.checked") {
    const outcome = firstText(payload, ["outcome"]);
    const missing = Array.isArray(payload.missingRequiredTools)
      ? payload.missingRequiredTools.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const verified = Array.isArray(payload.verifiedPathLineCitations)
      ? payload.verifiedPathLineCitations.length
      : 0;
    return shortText(
      [
        outcome || "checked",
        `${verified} verified citation${verified === 1 ? "" : "s"}`,
        missing.length > 0 ? `next: ${missing[0]}` : "tools complete",
      ].join(" / "),
    );
  }
  if (type === "context.compiled") {
    const number = (key: string) =>
      typeof payload[key] === "number" && Number.isFinite(payload[key])
        ? (payload[key] as number)
        : 0;
    const estimated = number("estimatedTokens");
    const reserved = number("reservedInputTokens");
    const maximum = number("maxTokens");
    const evidence = number("evidenceCount");
    const omitted = number("omittedEvidenceCount");
    return shortText(
      `${estimated} packet + ${reserved} reserved / ${maximum} token cap / ${evidence} evidence / ${omitted} omitted`,
    );
  }
  if (type.includes("route") || type.includes("model")) {
    const provider = firstText(payload, [
      "selectedProviderId",
      "providerId",
      "provider",
      "providerName",
    ]);
    const model = firstText(payload, ["selectedModel", "model", "modelName"]);
    const reason = firstText(payload, ["reasonCode", "reason", "decisionReason"]);
    return shortText([provider, model, reason].filter(Boolean).join(" / "));
  }
  if (type === "inference.attempt.finished") {
    const outcome = firstText(payload, ["outcome"]);
    const model = firstText(payload, ["servedModel"]);
    const usage = asPayload(payload.usage);
    const input = typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
    const output = typeof usage.outputTokens === "number" ? usage.outputTokens : 0;
    return shortText(
      [outcome, model, `${input + output} token${input + output === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" / "),
    );
  }
  if (type.includes("tool")) {
    const name = firstText(payload, ["toolName", "tool", "name"]);
    const args = asPayload(payload.arguments);
    const path =
      firstText(payload, ["path", "filePath", "target"]) ||
      firstText(args, ["relativePath", "path"]);
    const result = firstText(payload, ["summary", "result", "message"]);
    return shortText([name, path, result].filter(Boolean).join(" / "));
  }
  return shortText(
    firstText(payload, ["message", "reason", "summary", "status", "error"]),
  );
}

function persistedAssistantDraft(snapshot: SoarSessionSnapshot | null): string {
  if (!snapshot) return "";
  const drafts = new Map<string, string>();
  const completed = new Set<string>();
  const sorted = [...(snapshot.events || [])].sort(
    (a, b) => (a.sequence || 0) - (b.sequence || 0),
  );
  for (const event of sorted) {
    const payload = asPayload(event.payload);
    const messageId = firstText(payload, ["messageId"]);
    if (!messageId) continue;
    if (event.type === "assistant.message.started") drafts.set(messageId, "");
    if (event.type === "assistant.message.delta") {
      drafts.set(messageId, (drafts.get(messageId) || "") + firstText(payload, ["delta"]));
    }
    if (event.type === "assistant.message.completed") completed.add(messageId);
  }
  return [...drafts.entries()]
    .reverse()
    .find(([messageId]) => !completed.has(messageId))?.[1] || "";
}

export function latestAssistantStartEventId(
  snapshot: SoarSessionSnapshot | null,
): string | null {
  if (!snapshot) return null;
  return (
    [...(snapshot.events || [])]
      .filter((event) => event.type === "assistant.message.started")
      .sort((left, right) => (right.sequence || 0) - (left.sequence || 0))[0]
      ?.id ?? null
  );
}

export function transcriptFrom(snapshot: SoarSessionSnapshot | null): TranscriptItem[] {
  if (!snapshot) return [];
  const sorted = [...(snapshot.events || [])].sort(
    (a, b) => (a.sequence || 0) - (b.sequence || 0),
  );
  const items: TranscriptItem[] = [];
  let hasUserTask = false;
  let hasAssistantAnswer = false;
  const drafts = new Map<string, string>();
  const completedMessages = new Set<string>();
  const toolPositions = new Map<string, number>();

  for (const event of sorted) {
    const payload = asPayload(event.payload);
    const messageId = firstText(payload, ["messageId"]);
    if (!messageId) continue;
    if (event.type === "assistant.message.started") drafts.set(messageId, "");
    if (event.type === "assistant.message.delta") {
      drafts.set(messageId, (drafts.get(messageId) || "") + firstText(payload, ["delta"]));
    }
  }

  for (const event of sorted) {
    const type = event.type.toLowerCase();
    const payload = asPayload(event.payload);
    const text = firstText(payload, [
      "text",
      "content",
      "message",
      "output",
      "result",
      "task",
      "input",
      "error",
    ]);

    if (
      type.includes("task") ||
      type.includes("user") ||
      type === "session.created"
    ) {
      const task = firstText(payload, ["task", "input", "text", "content"]);
      if (task && !hasUserTask) {
        items.push({
          kind: "user",
          id: event.id,
          text: task,
          time: event.createdAt,
        });
        hasUserTask = true;
      }
      continue;
    }

    if (type.includes("tool")) {
      const name =
        firstText(payload, ["toolName", "tool", "name"]) || "Workspace tool";
      const args = asPayload(payload.arguments);
      const detail =
        firstText(payload, ["path", "filePath", "target", "summary", "message"]) ||
        firstText(args, ["relativePath", "path"]);
      const state = type.includes("fail") || type.includes("error") || payload.isError === true
        ? "error"
        : type.includes("complete") || type.includes("finish") || type.includes("result")
          ? "complete"
          : "running";
      const toolCallId = firstText(payload, ["toolCallId", "callId"]) || event.id;
      const existingIndex = toolPositions.get(toolCallId);
      const previous = existingIndex === undefined ? undefined : items[existingIndex];
      const next: TranscriptItem = {
        kind: "tool",
        id: toolCallId,
        name,
        detail: shortText(
          detail || (previous?.kind === "tool" ? previous.detail : "Workspace access"),
        ),
        state,
        time: event.createdAt,
      };
      if (existingIndex === undefined) {
        toolPositions.set(toolCallId, items.length);
        items.push(next);
      } else {
        items[existingIndex] = next;
      }
      continue;
    }

    if (type.includes("fail") || type.includes("error")) {
      if (text) {
        items.push({
          kind: "error",
          id: event.id,
          text: shortText(text, 500),
          time: event.createdAt,
        });
      }
      continue;
    }

    const isAssistant =
      type.includes("assistant") ||
      type.includes("answer") ||
      type.includes("output") ||
      type.includes("response") ||
      type.includes("complete");
    const isDelta = type.includes("delta") || type.includes("stream");
    if (
      snapshot.taskTrack === "change-review-v1" &&
      isAssistant &&
      isRawStructuredReview(payload, text)
    ) {
      const messageId = firstText(payload, ["messageId"]);
      if (messageId) completedMessages.add(messageId);
      continue;
    }
    if (isAssistant && !isDelta && text) {
      const messageId = firstText(payload, ["messageId"]);
      if (
        type === "assistant.message.completed" &&
        payload.completionState === "incomplete"
      ) {
        if (messageId) completedMessages.add(messageId);
        continue;
      }
      const resolvedText =
        type === "assistant.message.completed" && messageId
          ? firstText(payload, ["content"]) || drafts.get(messageId) || text
          : text;
      if (messageId) completedMessages.add(messageId);
      if (type === "session.completed" && hasAssistantAnswer) continue;
      items.push({
        kind: "assistant",
        id: event.id,
        text: resolvedText,
        time: event.createdAt,
      });
      hasAssistantAnswer = true;
    }
  }

  if (["failed", "cancelled", "interrupted"].includes(normalizeStatus(snapshot.status))) {
    const partial = [...drafts.entries()]
      .reverse()
      .find(([messageId, value]) => !completedMessages.has(messageId) && value.trim());
    if (partial) {
      items.push({
        kind: "assistant",
        id: `${snapshot.id}-${partial[0]}-partial`,
        text: partial[1],
        time: snapshot.updatedAt,
      });
    }
  }

  if (!hasUserTask && snapshot.title) {
    items.unshift({
      kind: "user",
      id: `${snapshot.id}-task`,
      text: snapshot.title,
      time: snapshot.createdAt,
    });
  }
  return items;
}

function statusCopy(status: string): { title: string; body: string } | null {
  if (status === "failed" || status === "error") {
    return {
      title: "This run could not finish",
      body: "Review the latest activity, then try the run again.",
    };
  }
  if (status === "cancelled") {
    return {
      title: "Run stopped",
      body: "The session context and activity trace were preserved.",
    };
  }
  if (status === "interrupted") {
    return {
      title: "Run interrupted",
      body: "The saved activity trace was preserved. Start a new run to continue the task.",
    };
  }
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const normalized = normalizeStatus(status);
  const icon: Record<string, ReactNode> = {
    queued: <Clock weight="fill" />,
    running: <Sparkle weight="fill" />,
    completed: <CheckCircle weight="fill" />,
    failed: <XCircle weight="fill" />,
    error: <XCircle weight="fill" />,
    cancelled: <Stop weight="fill" />,
    interrupted: <WarningCircle weight="fill" />,
  };
  return (
    <span className={`status-badge status-${normalized}`} data-testid="session-status">
      {icon[normalized]}
      <span>{normalized}</span>
    </span>
  );
}

function SessionListSkeleton() {
  return (
    <div className="session-skeleton" aria-label="Loading sessions">
      {[0, 1, 2].map((item) => (
        <div className="session-skeleton-row" key={item}>
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function sessionSimulationState(
  session: Pick<SoarSessionSummary, "executionMode" | "simulationMarker">,
): "attributed" | "invalid" | null {
  const claimed =
    session.executionMode === "hybrid_simulation" ||
    session.simulationMarker !== undefined;
  if (!claimed) return null;
  return session.executionMode === "hybrid_simulation" &&
    session.simulationMarker === HYBRID_SIMULATION_MARKER
    ? "attributed"
    : "invalid";
}

function simulationProjectionFromSnapshot(
  snapshot: SoarSessionSnapshot,
): HybridSimulationProjection | null {
  if (sessionSimulationState(snapshot) !== "attributed") return null;
  let reservedMicrousd = 0;
  let settledMicrousd = 0;
  let settlementProvenance: HybridSimulationProjection["settlementProvenance"] =
    "not_settled";
  for (const event of snapshot.events) {
    const payload = asPayload(event.payload);
    if (event.type === "routing.decision.recorded") {
      if (payload.costScope !== "simulation") return null;
      const billing = asPayload(payload.billing);
      const projectedCost = billing.projectedCostMicrousd;
      const hasReservation =
        typeof payload.budgetReservationId === "string" &&
        payload.budgetReservationId.trim().length > 0;
      if (
        projectedCost !== undefined &&
        !isSafeSimulatedMicrousd(projectedCost)
      ) {
        return null;
      }
      if (hasReservation && projectedCost !== undefined) {
        reservedMicrousd += projectedCost;
        if (
          !Number.isSafeInteger(reservedMicrousd) ||
          reservedMicrousd > HYBRID_SIMULATION_MAX_SPEND_MICROUSD
        ) {
          return null;
        }
      } else if (hasReservation) {
        return null;
      }
    }
    if (event.type === "inference.attempt.finished") {
      const cost = asPayload(payload.cost);
      if (cost.costScope !== "simulation") return null;
      if (!isSafeNonnegativeMicrousd(cost.amountMicrousd)) {
        return null;
      }
      settledMicrousd += cost.amountMicrousd;
      if (!Number.isSafeInteger(settledMicrousd)) {
        return null;
      }
      if (cost.amountMicrousd > 0) {
        if (!isSimulationSettlementProvenance(cost.provenance)) return null;
        settlementProvenance = cost.provenance;
      }
    }
  }
  if (
    reservedMicrousd > HYBRID_SIMULATION_MAX_SPEND_MICROUSD
  ) {
    return null;
  }
  const overrun = settledMicrousd > HYBRID_SIMULATION_MAX_SPEND_MICROUSD;
  if (
    overrun &&
    (normalizeStatus(snapshot.status) !== "failed" ||
      (settlementProvenance !== "provider_reported" &&
        settlementProvenance !== "host_pricing_snapshot"))
  ) {
    return null;
  }
  if (
    (settlementProvenance === "not_settled" && settledMicrousd !== 0) ||
    (settlementProvenance === "reserved_unknown" &&
      settledMicrousd !== reservedMicrousd)
  ) {
    return null;
  }
  return {
    marker: HYBRID_SIMULATION_MARKER,
    costScope: "simulation",
    maxSimulatedSpendMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    reservedMicrousd,
    settledMicrousd,
    settlementProvenance,
    actualExternalSpendMicrousd: 0,
  };
}

interface SessionSidebarProps {
  sessions: SoarSessionSummary[];
  selectedId: string | null;
  loading: boolean;
  open: boolean;
  modal: boolean;
  runtimeActive: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onReview: () => void;
  onSettings: () => void;
  onClose: () => void;
}

function SessionSidebar({
  sessions,
  selectedId,
  loading,
  open,
  modal,
  runtimeActive,
  onSelect,
  onNew,
  onReview,
  onSettings,
  onClose,
}: SessionSidebarProps) {
  const [query, setQuery] = useState("");
  const sidebarRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocus(sidebarRef, closeRef, modal && open);
  const visibleSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return sessions;
    return sessions.filter((session) => {
      const searchable = [
        session.title || "Untitled task",
        sessionSimulationState(session) === "attributed"
          ? HYBRID_SIMULATION_MARKER
          : "",
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [query, sessions]);

  return (
    <aside
      ref={sidebarRef}
      className={`session-sidebar ${open ? "is-open" : ""}`}
      aria-hidden={modal && !open ? true : undefined}
      aria-label="Sessions"
      aria-modal={modal && open ? true : undefined}
      inert={modal && !open ? true : undefined}
      role={modal ? "dialog" : undefined}
    >
      <div className="sidebar-titlebar" aria-hidden="true" />
      <button
        ref={closeRef}
        className="icon-button sidebar-close mobile-only"
        onClick={onClose}
        aria-label="Close sessions"
      >
        <X />
      </button>

      <button className="new-task-button" onClick={onNew}>
        <Sparkle />
        <span>New task</span>
        <kbd>⌘ N</kbd>
      </button>
      <button
        className="new-task-button review-changes-entry"
        data-testid="review-current-changes"
        onClick={onReview}
      >
        <GitDiff />
        <span>Review Current Changes</span>
      </button>

      <label className="session-search">
        <MagnifyingGlass aria-hidden="true" />
        <span className="sr-only">Search sessions</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sessions..."
        />
      </label>

      <div className="sidebar-section-heading">
        <span>Sessions</span>
        <span>{sessions.length}</span>
      </div>

      <nav className="session-list" aria-label="Task sessions">
        {loading ? <SessionListSkeleton /> : null}
        {!loading && sessions.length === 0 ? (
          <div className="sidebar-empty">
            <TerminalWindow />
            <p>Your sessions will appear here.</p>
          </div>
        ) : null}
        {!loading && sessions.length > 0 && visibleSessions.length === 0 ? (
          <div className="sidebar-empty sidebar-empty-search">
            <MagnifyingGlass />
            <p>No sessions match “{query.trim()}”.</p>
          </div>
        ) : null}
        {!loading
          ? visibleSessions.map((session) => {
              const status = normalizeStatus(session.status);
              const simulationState = sessionSimulationState(session);
              return (
                <button
                  key={session.id}
                  className={`session-row ${selectedId === session.id ? "is-active" : ""}`}
                  onClick={() => onSelect(session.id)}
                  aria-current={selectedId === session.id ? "page" : undefined}
                >
                  <span className="session-row-main">
                    <strong>{session.title || "Untitled task"}</strong>
                    <span>{formatRelative(session.updatedAt)}</span>
                    {simulationState === "attributed" ? (
                      <small className="session-simulation-marker">
                        {HYBRID_SIMULATION_MARKER}
                      </small>
                    ) : simulationState === "invalid" ? (
                      <small className="session-simulation-marker is-invalid">
                        Simulation attribution unavailable — result withheld.
                      </small>
                    ) : null}
                  </span>
                  <span className={`session-state-mark state-${status}`} aria-label={status} />
                </button>
              );
            })
          : null}
      </nav>

      <div className="sidebar-footer">
        <span className={`runtime-dot ${runtimeActive ? "is-working" : ""}`} aria-hidden="true" />
        <span>
          <strong>Local runtime</strong>
          {runtimeActive ? "Working" : "Checked on run"}
        </span>
        <button
          type="button"
          className="sidebar-settings-button"
          data-cloud-settings-trigger="sidebar"
          onClick={onSettings}
          aria-label="Open settings"
          title="Settings"
        >
          <Gear aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

function ToolItem({ item }: { item: Extract<TranscriptItem, { kind: "tool" }> }) {
  const icon =
    item.state === "complete" ? (
      <CheckCircle weight="fill" />
    ) : item.state === "error" ? (
      <XCircle weight="fill" />
    ) : (
      <Wrench />
  );
  return (
    <details className={`tool-event tool-${item.state}`}>
      <summary>
        <span className="tool-icon">{icon}</span>
        <span className="tool-copy">
          <strong>{item.name}</strong>
        </span>
        <span className="tool-state">{item.state}</span>
        <CaretRight className="tool-caret" aria-hidden="true" />
      </summary>
      <p>{item.detail}</p>
    </details>
  );
}

function Transcript({
  snapshot,
  streamedText,
  loading,
  onPromptSelect,
  onReview,
}: {
  snapshot: SoarSessionSnapshot | null;
  streamedText: string;
  loading: boolean;
  onPromptSelect: (prompt: string) => void;
  onReview: () => void;
}) {
  const items = useMemo(() => transcriptFrom(snapshot), [snapshot]);
  const persistedDraft = useMemo(() => persistedAssistantDraft(snapshot), [snapshot]);
  const visibleStream = streamedText || persistedDraft;
  const status = normalizeStatus(snapshot?.status);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    setFollowing(true);
  }, [snapshot?.id]);

  const handleScroll = useCallback(() => {
    const viewport = transcriptRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nextFollowing = distanceFromBottom <= 56;
    setFollowing((current) => (current === nextFollowing ? current : nextFollowing));
  }, []);

  useEffect(() => {
    if (status === "running" && following) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [following, visibleStream, items.length, status]);

  if (loading) {
    return (
      <div className="transcript transcript-loading" aria-label="Loading session">
        <div className="message-skeleton is-short" />
        <div className="message-skeleton" />
        <div className="message-skeleton is-medium" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="conversation-empty">
        <div className="empty-watermark" aria-hidden="true">S</div>
        <h1 className="soar-wordmark">SOAR</h1>
        <p>Choose a workspace, then ask SOAR to inspect a specific text file.</p>
        <button type="button" className="empty-review-action" onClick={onReview}>
          <GitDiff />
          Review Current Changes
          <CaretRight />
        </button>
        <div className="starter-prompts" aria-label="Starter tasks">
          {[
            "Read README.md and summarize its purpose",
            "Read package.json and explain its scripts",
            "Read tsconfig.json and flag strictness settings",
          ].map((prompt) => (
            <button type="button" key={prompt} onClick={() => onPromptSelect(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const notice = statusCopy(status);
  const lastAssistantIndex = items.reduce(
    (lastIndex, item, index) => (item.kind === "assistant" ? index : lastIndex),
    -1,
  );
  return (
    <div
      ref={transcriptRef}
      className="transcript"
      role="log"
      aria-live="polite"
      aria-busy={status === "running"}
      onScroll={handleScroll}
    >
      {items.map((item, index) => {
        if (item.kind === "tool") return <ToolItem key={item.id} item={item} />;
        if (item.kind === "error") {
          return (
            <div className="inline-error" key={item.id}>
              <WarningCircle weight="fill" />
              <span>{item.text}</span>
            </div>
          );
        }
        return (
          <article
            className={`message message-${item.kind}`}
            data-testid={
              item.kind === "assistant" && index === lastAssistantIndex
                ? "session-result"
                : undefined
            }
            key={item.id}
          >
            <header>
              <span>{item.kind === "user" ? "You" : "SOAR"}</span>
              <time>{formatClock(item.time)}</time>
            </header>
            {item.kind === "assistant" ? (
              <MarkdownContent text={item.text} />
            ) : (
              <div>{item.text}</div>
            )}
          </article>
        );
      })}

      {status === "running" ? (
        <article className="message message-assistant message-streaming">
          <header>
            <span>SOAR</span>
            <span className="working-label">Working</span>
          </header>
          {visibleStream ? (
            <MarkdownContent text={visibleStream} />
          ) : (
            <div className="thinking-row" aria-label="Waiting for the local model">
              <span />
              <span />
              <span />
            </div>
          )}
        </article>
      ) : null}

      {notice ? (
        <div className={`run-notice notice-${status}`}>
          {status === "cancelled" ? <Stop weight="fill" /> : <WarningCircle weight="fill" />}
          <div>
            <strong>{notice.title}</strong>
            <span>{notice.body}</span>
          </div>
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

interface ComposerProps {
  task: string;
  workspace: { path: string; name: string } | null;
  busy: boolean;
  running: boolean;
  onTaskChange: (value: string) => void;
  onChooseWorkspace: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function Composer({
  task,
  workspace,
  busy,
  running,
  onTaskChange,
  onChooseWorkspace,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && event.metaKey) {
      event.preventDefault();
      onSubmit();
    }
  };
  return (
    <form className="composer" onSubmit={handleSubmit} aria-label="New task">
      <div className="composer-surface">
        <button
          type="button"
          className="workspace-button"
          data-testid="choose-workspace"
          onClick={onChooseWorkspace}
        >
          <FolderOpen />
          <span>{workspace?.name || "Choose workspace"}</span>
          <CaretRight />
        </button>
        <label className="sr-only" htmlFor="task-input">
          Task
        </label>
        <textarea
          id="task-input"
          data-testid="task-input"
          value={task}
          onChange={(event) => onTaskChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What's on your mind?"
          rows={1}
          disabled={running}
        />
        {running ? (
          <button
            type="button"
            className="stop-button"
            data-testid="stop-task"
            onClick={onCancel}
            disabled={busy}
            aria-label="Stop task"
          >
            <Stop weight="fill" />
            <span className="sr-only">Stop</span>
          </button>
        ) : (
          <button
            type="submit"
            className="run-button"
            data-testid="run-task"
            disabled={busy || !workspace || !task.trim()}
            aria-label="Run task locally"
          >
            <ArrowUp weight="bold" />
            <span className="sr-only">Run locally</span>
          </button>
        )}
      </div>
      <div className="composer-footer">
        <span>{running ? "Local model is working" : "⌘ Enter to run"}</span>
        <span>Local-only policy</span>
      </div>
    </form>
  );
}

function reviewApi(): ReviewRendererApi | null {
  const candidate = window.soar as unknown as Partial<ReviewRendererApi>;
  return typeof candidate.getReviewAvailability === "function" &&
    typeof candidate.createChangeReviewSession === "function" &&
    typeof candidate.getChangeReviewView === "function"
    ? (candidate as ReviewRendererApi)
    : null;
}

function isCurrentSimulationChallenge(
  value: HybridSimulationConsentChallenge,
): boolean {
  return (
    value.schemaVersion === "hybrid-simulation-consent-challenge-v1" &&
    value.route === "hybrid_simulation" &&
    value.maxSimulatedSpendMicrousd === HYBRID_SIMULATION_MAX_SPEND_MICROUSD &&
    value.challengeId.trim().length > 0 &&
    value.disclosureVersion.trim().length > 0 &&
    value.disclosureText.trim().length > 0 &&
    /^[a-f0-9]{64}$/u.test(value.disclosureTextSha256) &&
    Number.isFinite(Date.parse(value.expiresAt)) &&
    Date.parse(value.expiresAt) > Date.now()
  );
}

function isSimulationSettlementProvenance(
  value: unknown,
): value is Exclude<
  HybridSimulationProjection["settlementProvenance"],
  "not_settled"
> {
  return (
    value === "provider_reported" ||
    value === "host_pricing_snapshot" ||
    value === "reserved_unknown"
  );
}

function isProjectedSimulationSettlementProvenance(
  value: unknown,
): value is HybridSimulationProjection["settlementProvenance"] {
  return value === "not_settled" || isSimulationSettlementProvenance(value);
}

function simulationSettlementLabel(
  provenance: HybridSimulationProjection["settlementProvenance"],
): string {
  switch (provenance) {
    case "provider_reported":
      return "Provider-reported simulated settlement";
    case "host_pricing_snapshot":
      return "Host-priced simulated settlement";
    case "reserved_unknown":
      return "Conservative full simulated reservation";
    case "not_settled":
      return "Not settled";
  }
}

function isSafeSimulatedMicrousd(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= HYBRID_SIMULATION_MAX_SPEND_MICROUSD
  );
}

function isSafeNonnegativeMicrousd(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isAllowedSimulationSettlement(
  value: unknown,
  provenance: unknown,
  status: string,
): value is number {
  if (!isSafeNonnegativeMicrousd(value)) return false;
  if (value <= HYBRID_SIMULATION_MAX_SPEND_MICROUSD) return true;
  return (
    normalizeStatus(status) === "failed" &&
    (provenance === "provider_reported" ||
      provenance === "host_pricing_snapshot")
  );
}

function isAllowedSimulationRouteIdentity(route: {
  providerLabel: string;
  locality: "local" | "cloud";
}): boolean {
  return (
    (route.providerLabel === "Fake Local" && route.locality === "local") ||
    (route.providerLabel === "Fake Cloud" && route.locality === "cloud") ||
    (route.providerLabel === "Fake Cloud candidate" &&
      route.locality === "cloud")
  );
}

function simulationProjectionIsSafe(
  view: ChangeReviewView,
): view is ChangeReviewView & { simulation: HybridSimulationProjection } {
  const projection = view.simulation;
  if (view.executionMode !== "hybrid_simulation") return false;
  const overrun =
    projection !== undefined &&
    isSafeNonnegativeMicrousd(projection.settledMicrousd) &&
    projection.settledMicrousd > HYBRID_SIMULATION_MAX_SPEND_MICROUSD;
  if (
    !projection ||
    projection.marker !== HYBRID_SIMULATION_MARKER ||
    projection.costScope !== "simulation" ||
    projection.actualExternalSpendMicrousd !== 0 ||
    !isProjectedSimulationSettlementProvenance(
      projection.settlementProvenance,
    ) ||
    !isSafeSimulatedMicrousd(projection.maxSimulatedSpendMicrousd) ||
    !isSafeSimulatedMicrousd(projection.reservedMicrousd) ||
    !isAllowedSimulationSettlement(
      projection.settledMicrousd,
      projection.settlementProvenance,
      view.status,
    ) ||
    projection.maxSimulatedSpendMicrousd !== HYBRID_SIMULATION_MAX_SPEND_MICROUSD ||
    projection.reservedMicrousd > projection.maxSimulatedSpendMicrousd ||
    (overrun &&
      projection.settlementProvenance !== "provider_reported" &&
      projection.settlementProvenance !== "host_pricing_snapshot") ||
    (projection.settlementProvenance === "not_settled" &&
      projection.settledMicrousd !== 0) ||
    (projection.settlementProvenance === "reserved_unknown" &&
      projection.settledMicrousd !== projection.reservedMicrousd)
  ) {
    return false;
  }
  if (
    !view.phases.every((phase) => {
      if (phase.providerLabel === undefined) {
        return (
          phase.model === undefined &&
          phase.simulatedReservedMicrousd === undefined &&
          phase.simulatedSettledMicrousd === undefined &&
          phase.simulatedSettlementProvenance === undefined &&
          phase.actualExternalSpendMicrousd === undefined
        );
      }
      if (
        (phase.providerLabel !== "Fake Local" &&
          phase.providerLabel !== "Fake Cloud" &&
          phase.providerLabel !== "Fake Cloud candidate") ||
        typeof phase.model !== "string" ||
        phase.model.trim().length === 0 ||
        phase.actualExternalSpendMicrousd !== 0
      ) {
        return false;
      }
      const reserved = phase.simulatedReservedMicrousd;
      if (reserved !== undefined && !isSafeSimulatedMicrousd(reserved)) {
        return false;
      }
      const settled = phase.simulatedSettledMicrousd;
      const provenance = phase.simulatedSettlementProvenance;
      if (settled === undefined && provenance === undefined) return true;
      if (
        settled === undefined ||
        !isProjectedSimulationSettlementProvenance(provenance) ||
        !isAllowedSimulationSettlement(settled, provenance, view.status)
      ) {
        return false;
      }
      if (provenance === "not_settled") return settled === 0;
      if (provenance !== "reserved_unknown") return true;
      return reserved !== undefined && settled === reserved;
    })
  ) {
    return false;
  }
  const attributedRoutes = view.routes || [];
  if (attributedRoutes.length === 0) {
    return view.reviewResult === undefined;
  }
  let routeSettledMicrousd = 0;
  const routesSafe = attributedRoutes.every((route) => {
      if (
        !isAllowedSimulationRouteIdentity(route) ||
        route.actualExternalSpendMicrousd !== 0
      ) {
        return false;
      }
      const settled = route.simulatedSettledMicrousd;
      const reserved = route.simulatedReservedMicrousd;
      const provenance = route.simulatedSettlementProvenance;
      if (reserved !== undefined && !isSafeSimulatedMicrousd(reserved)) {
        return false;
      }
      if (settled === undefined && provenance === undefined) return true;
      if (
        settled === undefined ||
        !isAllowedSimulationSettlement(settled, provenance, view.status) ||
        !isProjectedSimulationSettlementProvenance(provenance)
      ) {
        return false;
      }
      routeSettledMicrousd += settled;
      if (!Number.isSafeInteger(routeSettledMicrousd)) return false;
      if (provenance === "not_settled") return settled === 0;
      if (provenance !== "reserved_unknown") return true;
      return (
        reserved !== undefined &&
        settled === reserved
      );
    });
  return routesSafe && routeSettledMicrousd === projection.settledMicrousd;
}

interface ReviewFindingView {
  findingId: string;
  severity: "P0" | "P1" | "P2" | "P3";
  title: string;
  impact: string;
  suggestedCorrection: string;
  suggestedTest: string;
  evidence: Payload[];
}

interface ReviewResultView {
  summary: string;
  conclusion:
    | "blocking_findings"
    | "no_blocking_findings"
    | "incomplete";
  findings: ReviewFindingView[];
  omissions: Array<{ code: string; description: string }>;
}

function reviewResultProjection(value: unknown): ReviewResultView | null {
  const payload = asPayload(value);
  if (payload.schemaVersion !== "change-review-result-v1") return null;
  const summary = firstText(payload, ["summary"]);
  if (!summary || !Array.isArray(payload.findings) || !Array.isArray(payload.omissions)) {
    return null;
  }
  const conclusion = firstText(payload, ["conclusion"]);
  if (
    conclusion !== "blocking_findings" &&
    conclusion !== "no_blocking_findings" &&
    conclusion !== "incomplete"
  ) {
    return null;
  }
  const findings: ReviewFindingView[] = [];
  const findingIds = new Set<string>();
  for (const candidate of payload.findings) {
    const finding = asPayload(candidate);
    const findingId = firstText(finding, ["findingId"]);
    const severity = firstText(finding, ["severity"]);
    const title = firstText(finding, ["title"]);
    const impact = firstText(finding, ["impact"]);
    const suggestedCorrection = firstText(finding, ["suggestedCorrection"]);
    const suggestedTest = firstText(finding, ["suggestedTest"]);
    if (
      !findingId ||
      findingIds.has(findingId) ||
      (severity !== "P0" &&
        severity !== "P1" &&
        severity !== "P2" &&
        severity !== "P3") ||
      !title ||
      !impact ||
      !suggestedCorrection ||
      !suggestedTest ||
      !Array.isArray(finding.evidence) ||
      finding.evidence.length === 0
    ) {
      return null;
    }
    const evidence = finding.evidence.map(asPayload);
    if (evidence.some((item) => Object.keys(item).length === 0)) return null;
    findingIds.add(findingId);
    findings.push({
      findingId,
      severity,
      title,
      impact,
      suggestedCorrection,
      suggestedTest,
      evidence,
    });
  }
  const omissions: Array<{ code: string; description: string }> = [];
  const omissionCodes = new Set<string>();
  for (const candidate of payload.omissions) {
    const omission = asPayload(candidate);
    const code = firstText(omission, ["code"]);
    const description = firstText(omission, ["description"]);
    if (!code || !description || omissionCodes.has(code)) return null;
    omissionCodes.add(code);
    omissions.push({ code, description });
  }
  return {
    summary,
    conclusion,
    findings,
    omissions,
  };
}

function evidenceLabel(evidence: Payload, baseRevision?: string): string {
  const path = firstText(evidence, ["path"]);
  const side = firstText(evidence, ["side"]);
  const kind = firstText(evidence, ["kind"]);
  const line =
    typeof evidence.line === "number" && Number.isSafeInteger(evidence.line)
      ? evidence.line
      : null;
  const location = path
    ? `${path}${side === "base" ? `@${baseRevision || "base"}` : ""}${line === null ? "" : `:${line}`}`
    : "Verified evidence";
  return [location, side, kind]
    .filter(Boolean)
    .join(" · ");
}

function freshnessCopy(freshness: ReviewFreshness): {
  label: string;
  detail: string;
} {
  const copy: Record<ReviewFreshness, { label: string; detail: string }> = {
    pending: {
      label: "Checking workspace",
      detail: "SOAR is comparing the current repository with the reviewed snapshot.",
    },
    not_available: {
      label: "No accepted review",
      detail: "This run ended without a review that passed the host acceptance checks.",
    },
    fresh_complete: {
      label: "Fresh and complete",
      detail: "The accepted review still matches the current change snapshot.",
    },
    identity_same_unverifiable: {
      label: "Review incomplete",
      detail: "The snapshot identity matches, but host coverage or the accepted result is incomplete. The review is shown with its omissions; copying is disabled.",
    },
    drifted: {
      label: "Workspace changed",
      detail: "The current changes no longer match this review. Start a new review before using the findings.",
    },
    unavailable: {
      label: "Freshness unavailable",
      detail: "SOAR could not revalidate the reviewed snapshot. Findings and copy are withheld.",
    },
  };
  return copy[freshness];
}

function markdownLiteral(value: string): string {
  const escapePunctuation = (text: string) =>
    text.replace(/[!-/:-@[-`{-~]/gu, "\\$&");
  let escaped = "";
  let cursor = 0;
  for (const match of value.matchAll(/\bhttps?(?=:\/\/)|\bwww(?=\.)|@/giu)) {
    const end = match.index + match[0].length;
    escaped += `${escapePunctuation(value.slice(cursor, end))}<!-- -->`;
    cursor = end;
  }
  return escaped + escapePunctuation(value.slice(cursor));
}

function markdownCode(value: string): string {
  const longestBacktickRun = [...value.matchAll(/`+/gu)].reduce(
    (longest, match) => Math.max(longest, match[0].length),
    0,
  );
  const delimiter = "`".repeat(longestBacktickRun + 1);
  const needsPadding =
    value.startsWith("`") ||
    value.endsWith("`") ||
    value.startsWith(" ") ||
    value.endsWith(" ");
  const padding = needsPadding ? " " : "";
  return `${delimiter}${padding}${value}${padding}${delimiter}`;
}

function formatMicrousd(microusd: number): string {
  return `$${(microusd / 1_000_000).toFixed(2)}`;
}

export function reviewMarkdown(view: ChangeReviewView): string | null {
  if (view.freshness !== "fresh_complete") return null;
  const simulationClaimed =
    view.executionMode === "hybrid_simulation" || view.simulation !== undefined;
  const simulationSafe = simulationProjectionIsSafe(view);
  if (simulationClaimed && !simulationSafe) return null;
  const result = reviewResultProjection(view.reviewResult);
  if (!result) return null;
  const conclusion =
    result.conclusion === "blocking_findings"
      ? "Blocking findings"
      : result.conclusion === "no_blocking_findings"
        ? "No blocking findings found in the inspected evidence"
        : "Incomplete review";
  const lines = [
    "# Review current changes",
    "",
    ...(simulationSafe ? [`> **${HYBRID_SIMULATION_MARKER}**`, ""] : []),
    markdownLiteral(result.summary),
    "",
    `**Conclusion:** ${conclusion}`,
  ];
  if (result.findings.length > 0) {
    lines.push("", "## Findings");
    result.findings.forEach((finding) => {
      lines.push(
        "",
        `### [${markdownLiteral(finding.severity)}] ${markdownLiteral(finding.title)}`,
        "",
        ...(simulationSafe ? [`> **${HYBRID_SIMULATION_MARKER}**`, ""] : []),
        `**Impact:** ${markdownLiteral(finding.impact)}`,
        "",
        `**Suggested correction:** ${markdownLiteral(finding.suggestedCorrection)}`,
        "",
        `**Suggested test:** ${markdownLiteral(finding.suggestedTest)}`,
        "",
        "**Evidence:**",
        ...finding.evidence.map(
          (evidence) =>
            `- ${markdownCode(evidenceLabel(evidence, view.baseRevision))}`,
        ),
      );
    });
  }
  if (simulationSafe) {
    lines.push(
      "",
      "## Simulation accounting",
      "",
      `- Maximum reservation: Simulated ${formatMicrousd(view.simulation.maxSimulatedSpendMicrousd)}`,
      `- Reserved: Simulated ${formatMicrousd(view.simulation.reservedMicrousd)}`,
      `- Settled: Simulated ${formatMicrousd(view.simulation.settledMicrousd)} (${simulationSettlementLabel(view.simulation.settlementProvenance)})`,
      "- Actual external provider spend: $0",
    );
  }
  if (result.omissions.length > 0) {
    lines.push("", "## Omissions");
    result.omissions.forEach((omission) => {
      lines.push(
        `- **${markdownLiteral(omission.code)}:** ${markdownLiteral(omission.description)}`,
      );
    });
  }
  const coverage = asPayload(view.coverage);
  const counts = asPayload(coverage.counts);
  if (coverage.schemaVersion === "review-coverage-view-v1") {
    lines.push(
      "",
      "## Coverage",
      "",
      `- Status: ${firstText(coverage, ["status"]) || "unknown"}`,
      `- Changed paths: ${typeof counts.changedPaths === "number" ? counts.changedPaths : "unknown"}`,
      `- Admitted paths: ${typeof counts.admittedPaths === "number" ? counts.admittedPaths : "unknown"}`,
      `- Changed hunks: ${typeof counts.changedHunks === "number" ? counts.changedHunks : "unknown"}`,
      `- Admitted hunks: ${typeof counts.admittedHunks === "number" ? counts.admittedHunks : "unknown"}`,
    );
  }
  return lines.join("\n").trim();
}

export function ReviewSetup({
  workspace,
  availability,
  loading,
  busy,
  route = "local",
  challenge = null,
  consentChecked = false,
  consentLoading = false,
  consentError = null,
  onChooseWorkspace,
  onOpenCloudSettings,
  onRouteChange = () => undefined,
  onConsentChange = () => undefined,
  onRetryChallenge = () => undefined,
  onStart,
}: {
  workspace: { path: string; name: string } | null;
  availability: ReviewAvailability;
  loading: boolean;
  busy: boolean;
  route?: ReviewRouteIntent;
  challenge?: HybridSimulationConsentChallenge | null;
  consentChecked?: boolean;
  consentLoading?: boolean;
  consentError?: string | null;
  onChooseWorkspace: () => void;
  onOpenCloudSettings: () => void;
  onRouteChange?: (route: ReviewRouteIntent) => void;
  onConsentChange?: (checked: boolean) => void;
  onRetryChallenge?: () => void;
  onStart: () => void;
}) {
  const consentRef = useRef<HTMLInputElement>(null);
  const retryConsentRef = useRef<HTMLButtonElement>(null);
  const simulationAvailable =
    availability.hybrid.enabled && availability.hybrid.mode === "simulation";
  const simulationSelected = route === "hybrid_simulation";
  const localDetail = availability.local.model
    ? `${availability.local.label} · ${availability.local.model}`
    : availability.local.reason || availability.local.label;
  const declaredTokenFee = `$${
    availability.local.declaredTokenFeeMicrousd / 1_000_000
  }`;

  useEffect(() => {
    if (challenge) consentRef.current?.focus();
  }, [challenge?.challengeId]);

  useEffect(() => {
    if (consentError && !challenge && !consentLoading) {
      retryConsentRef.current?.focus();
    }
  }, [challenge, consentError, consentLoading]);

  return (
    <section className="review-setup" aria-labelledby="review-setup-title">
      <header className="review-setup-heading">
        <span className="review-kicker">Repository review</span>
        <h1 id="review-setup-title">Review current changes</h1>
        <p>Inspect the working tree and return evidence-linked findings without modifying files.</p>
      </header>

      <div className="review-setup-fields">
        <div className="review-setting-row review-repository-row">
          <span className="review-setting-icon"><FolderOpen /></span>
          <span className="review-setting-copy">
            <strong>Repository</strong>
            <small>{workspace?.path || "Choose the repository to inspect"}</small>
          </span>
          <button type="button" className="review-text-button" onClick={onChooseWorkspace}>
            {workspace ? "Change" : "Choose"}
          </button>
        </div>

        <fieldset className="review-mode-fieldset">
          <legend>Route</legend>
          <label className={`review-mode-row ${route === "local" ? "is-selected" : ""} ${availability.local.enabled ? "" : "is-unavailable"}`}>
            <input
              type="radio"
              name="review-route"
              aria-label="Local"
              checked={route === "local"}
              onChange={() => onRouteChange("local")}
              disabled={!availability.local.enabled}
            />
            <span className="review-setting-icon"><HardDrives /></span>
            <span className="review-setting-copy">
              <strong>Local</strong>
              <small>{loading ? "Checking local review support..." : localDetail}</small>
            </span>
            <span className="review-mode-state">{route === "local" ? "Selected" : "Available"}</span>
          </label>
          <label
            className={`review-mode-row ${simulationSelected ? "is-selected" : ""} ${simulationAvailable ? "" : "is-disabled"}`}
          >
            <input
              type="radio"
              name="review-route"
              aria-label={simulationAvailable ? "Hybrid simulation" : "Hybrid"}
              checked={simulationSelected}
              onChange={() => onRouteChange("hybrid_simulation")}
              disabled={!simulationAvailable}
            />
            <span className="review-setting-icon"><Cpu /></span>
            <span className="review-setting-copy">
              <strong>{simulationAvailable ? "Hybrid simulation" : "Hybrid"}</strong>
              <small>
                {simulationAvailable
                  ? "Fake Local and fake cloud models exercise the Hybrid control flow."
                  : availability.hybrid.reason}
              </small>
            </span>
            <span className="review-mode-state">
              {simulationSelected ? "Selected" : simulationAvailable ? "Available" : "Unavailable"}
            </span>
          </label>
          {!simulationAvailable ? (
            <div className="review-mode-help">
              <button
                type="button"
                className="review-text-button"
                data-cloud-settings-trigger="review"
                onClick={onOpenCloudSettings}
              >
                Set up cloud
              </button>
            </div>
          ) : null}
        </fieldset>

        {simulationSelected ? (
          <section
            className="review-simulation-disclosure"
            aria-labelledby="review-simulation-disclosure-title"
          >
            <div className="review-simulation-heading">
              <WarningCircle weight="fill" aria-hidden="true" />
              <div>
                <span className="review-section-kicker">Explicit fake-only mode</span>
                <h2 id="review-simulation-disclosure-title">Hybrid simulation disclosure</h2>
              </div>
            </div>
            <p className="review-simulation-marker">{HYBRID_SIMULATION_MARKER}</p>
            {challenge ? (
              <>
                <p className="review-disclosure-copy">{challenge.disclosureText}</p>
                <div className="review-simulation-terms" aria-label="Simulation terms">
                  <span>
                    <small>Maximum reservation</small>
                    <strong>
                      Simulated ${(challenge.maxSimulatedSpendMicrousd / 1_000_000).toFixed(2)}
                    </strong>
                  </span>
                  <span>
                    <small>Actual external spend</small>
                    <strong>$0</strong>
                  </span>
                </div>
                <label className="review-consent-row">
                  <input
                    ref={consentRef}
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(event) => onConsentChange(event.target.checked)}
                  />
                  <span>
                    I acknowledge this challenge-bound fake simulation disclosure.
                  </span>
                </label>
                <small className="review-disclosure-version">
                  Disclosure {challenge.disclosureVersion} · expires {formatClock(challenge.expiresAt)}
                </small>
              </>
            ) : (
              <div className="review-consent-state" role="status" aria-live="polite">
                {consentLoading
                  ? "Preparing the disclosure for this repository…"
                  : workspace
                    ? "A current disclosure is required before simulation can start."
                    : "Choose a repository to prepare its disclosure."}
              </div>
            )}
            {consentError ? (
              <div className="review-consent-error" role="alert">
                <span>{consentError}</span>
                {workspace && !consentLoading ? (
                  <button
                    ref={retryConsentRef}
                    type="button"
                    className="review-text-button"
                    onClick={onRetryChallenge}
                  >
                    Prepare a new disclosure
                  </button>
                ) : null}
              </div>
            ) : null}
            <p className="review-cloud-independence">
              Simulation is independent of Cloud Settings and never reads your stored credential.
            </p>
          </section>
        ) : null}

        <div className="review-policy-grid">
          <div>
            <Coins />
            <span>
              <small>{simulationSelected ? "Maximum reservation" : "Declared token fee"}</small>
              <strong>{simulationSelected ? "Simulated $0.25" : declaredTokenFee}</strong>
            </span>
          </div>
          <div>
            <LockKey />
            <span>
              <small>{simulationSelected ? "Actual external spend" : "Paid cloud consent"}</small>
              <strong>{simulationSelected ? "$0" : "Off"}</strong>
            </span>
          </div>
        </div>
        <div className="review-egress-note">
          <Files />
          <span>
            <strong>Evidence transport</strong>
            {simulationSelected ? (
              "No content leaves this machine in simulation. The disclosure names the repository content classes a future real Hybrid request would send."
            ) : simulationAvailable ? (
              "Local uses the in-process Fake Local model in this explicit development/test configuration; no content leaves this machine and the declared token fee is $0."
            ) : (
              <>
                {availability.local.evidenceTransportSummary}{" "}
                {availability.local.costAccountingSummary}{" "}
                {availability.hybrid.reachabilitySummary}
              </>
            )}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="review-start-button"
        data-testid={simulationSelected ? "start-hybrid-simulation" : "start-local-review"}
        onClick={onStart}
        disabled={
          busy ||
          loading ||
          !workspace ||
          (simulationSelected
            ? !simulationAvailable || !challenge || !consentChecked
            : !availability.local.enabled)
        }
      >
        <GitDiff />
        {busy
          ? simulationSelected
            ? "Starting Hybrid simulation..."
            : "Starting local review..."
          : simulationSelected
            ? "Start Hybrid simulation"
            : "Start local review"}
      </button>
    </section>
  );
}

function ReviewTimeline({ phases }: { phases: ReviewPhaseView[] }) {
  return (
    <ol className="review-timeline" aria-label="Review phases">
      {phases.map((phase) => {
        const details = [
          phase.providerLabel && phase.model
            ? `${phase.providerLabel} · ${phase.model}`
            : phase.providerLabel || phase.model,
          phase.reason ? routeReasonLabel(phase.reason) : undefined,
          typeof phase.latencyMs === "number"
            ? `${formatProviderDuration(phase.latencyMs)} latency`
            : undefined,
          typeof phase.simulatedReservedMicrousd === "number"
            ? `Simulated ${formatMicrousd(phase.simulatedReservedMicrousd)} reserved`
            : undefined,
          typeof phase.simulatedSettledMicrousd === "number"
            ? `Simulated ${formatMicrousd(phase.simulatedSettledMicrousd)} settled${phase.simulatedSettlementProvenance ? ` (${simulationSettlementLabel(phase.simulatedSettlementProvenance)})` : ""}`
            : undefined,
          phase.actualExternalSpendMicrousd === 0
            ? "Actual external spend $0"
            : undefined,
        ].filter((detail): detail is string => Boolean(detail));
        return (
          <li
            className={`phase-${phase.status}`}
            key={phase.id}
            aria-current={phase.status === "active" ? "step" : undefined}
          >
            <span className="review-phase-mark" aria-hidden="true">
              {phase.status === "complete" ? (
                <CheckCircle weight="fill" />
              ) : phase.status === "failed" ? (
                <XCircle weight="fill" />
              ) : phase.status === "cancelled" ? (
                <Stop weight="fill" />
              ) : phase.status === "active" ? (
                <Sparkle weight="fill" />
              ) : (
                <Clock />
              )}
            </span>
            <span className="review-phase-copy">
              <strong>{phase.label}</strong>
              <small>{typeLabel(phase.status)}</small>
              {details.length > 0 ? (
                <small className="review-phase-detail">{details.join(" · ")}</small>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CoverageSummary({ coverage }: { coverage: unknown }) {
  const payload = asPayload(coverage);
  if (payload.schemaVersion !== "review-coverage-view-v1") return null;
  const counts = asPayload(payload.counts);
  const number = (key: string) =>
    typeof counts[key] === "number" && Number.isFinite(counts[key])
      ? (counts[key] as number)
      : null;
  const status = firstText(payload, ["status"]);
  const omissionCodes = Array.isArray(payload.omissionCodes)
    ? payload.omissionCodes.filter((item): item is string => typeof item === "string")
    : [];
  return (
    <section className="review-coverage" aria-labelledby="review-coverage-title">
      <header>
        <div>
          <span className="review-section-kicker">Host-verified evidence</span>
          <h2 id="review-coverage-title">Coverage</h2>
        </div>
        <span className={`coverage-status coverage-${status || "unknown"}`}>
          {status || "Unknown"}
        </span>
      </header>
      <div className="coverage-metrics">
        <span><strong>{number("admittedPaths") ?? "—"}</strong> / {number("changedPaths") ?? "—"}<small>paths admitted</small></span>
        <span><strong>{number("admittedHunks") ?? "—"}</strong> / {number("changedHunks") ?? "—"}<small>hunks retained</small></span>
        <span><strong>{typeof payload.changedTestCount === "number" ? payload.changedTestCount : "—"}</strong><small>changed tests</small></span>
      </div>
      {payload.runtimeCodeChangedWithoutChangedTest === true ? (
        <p className="coverage-warning"><WarningCircle weight="fill" /> Runtime code changed without a changed test.</p>
      ) : null}
      {omissionCodes.length > 0 ? (
        <p className="coverage-omissions">Incomplete: {omissionCodes.map(typeLabel).join(", ")}</p>
      ) : null}
    </section>
  );
}

export function ChangeReviewWorkspace({
  snapshot,
  view,
  loading,
  stopping,
  onStop,
}: {
  snapshot: SoarSessionSnapshot;
  view: ChangeReviewView | null;
  loading: boolean;
  stopping: boolean;
  onStop: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const matchingView = view?.sessionId === snapshot.id ? view : null;
  const snapshotSimulationState = sessionSimulationState(snapshot);
  const status = normalizeStatus(matchingView?.status || snapshot.status);
  const running = status === "running" || status === "queued" || status === "created";
  const freshness = matchingView?.freshness ?? "pending";
  const freshnessMessage = freshnessCopy(freshness);
  const simulationClaimed =
    snapshotSimulationState !== null ||
    matchingView?.executionMode === "hybrid_simulation" ||
    matchingView?.simulation !== undefined;
  const safeSimulationView =
    matchingView && simulationProjectionIsSafe(matchingView) ? matchingView : null;
  const simulationSafe = safeSimulationView !== null;
  const simulationHeaderAttributed =
    snapshotSimulationState === "attributed" || simulationSafe;
  const simulationRoutes = safeSimulationView?.routes ?? [];
  const simulationProjection = safeSimulationView?.simulation;
  const result =
    (!simulationClaimed || simulationSafe) &&
    (freshness === "fresh_complete" || freshness === "identity_same_unverifiable")
      ? reviewResultProjection(matchingView?.reviewResult)
      : null;
  const markdown = matchingView ? reviewMarkdown(matchingView) : null;
  const conclusion = result?.conclusion;
  const coveragePayload = asPayload(matchingView?.coverage);
  const coverageCounts = asPayload(coveragePayload.counts);
  const emptySnapshot =
    result !== null && coverageCounts.changedPaths === 0;

  useEffect(() => {
    setCopyState("idle");
  }, [snapshot.id, matchingView?.freshness, matchingView?.reviewResult]);

  const copyReview = async () => {
    if (!markdown) return;
    try {
      const api = reviewApi();
      if (!api) throw new Error("Review freshness cannot be checked.");
      // Copy is a new use of the artifact, so ask main to revalidate the
      // workspace again instead of trusting the view that was rendered earlier.
      const refreshed = await api.getChangeReviewView(snapshot.id);
      if (refreshed.sessionId !== snapshot.id) {
        throw new Error("The refreshed review belongs to a different session.");
      }
      const refreshedMarkdown = reviewMarkdown(refreshed);
      if (!refreshedMarkdown) {
        throw new Error("The review is no longer fresh enough to copy.");
      }
      await navigator.clipboard.writeText(refreshedMarkdown);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="review-workspace">
      <header className="review-workspace-header">
        <div>
          <span className="review-kicker">Review current changes</span>
          <h1>{workspaceName(snapshot.workspaceRoot)}</h1>
          {simulationHeaderAttributed ? (
            <p className="review-header-simulation-marker">
              {HYBRID_SIMULATION_MARKER}
            </p>
          ) : null}
        </div>
        {running ? (
          <button
            type="button"
            className="review-stop-button"
            data-testid="stop-review"
            onClick={onStop}
            disabled={stopping}
          >
            <Stop weight="fill" />
            {stopping ? "Stopping" : "Stop"}
          </button>
        ) : markdown ? (
          <button type="button" className="review-copy-button" onClick={() => void copyReview()}>
            <Copy />
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy Markdown"}
          </button>
        ) : null}
      </header>

      {!simulationClaimed || simulationSafe ? (
        <ReviewTimeline phases={matchingView?.phases || []} />
      ) : null}

      <div className="review-scroll-region">
        {simulationSafe ? (
          <section className="review-route-sequence" aria-labelledby="review-route-sequence-title">
            <header>
              <span className="review-section-kicker">Replay-safe route trace</span>
              <h2 id="review-route-sequence-title">Hybrid simulation route</h2>
            </header>
            <ol>
              {simulationRoutes.map((route, index) => (
                <li key={`${route.phaseId}-${index}`}>
                  <span className={`review-route-status phase-${route.status}`}>
                    {typeLabel(route.status)}
                  </span>
                  <div>
                    <strong>{route.providerLabel}</strong>
                    <span>{route.model}</span>
                    <p>{route.reason}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>Latency</dt>
                      <dd>{typeof route.latencyMs === "number" ? formatProviderDuration(route.latencyMs) : "—"}</dd>
                    </div>
                    {typeof route.simulatedReservedMicrousd === "number" ? (
                      <div>
                        <dt>Reserved</dt>
                        <dd>Simulated {formatMicrousd(route.simulatedReservedMicrousd)}</dd>
                      </div>
                    ) : null}
                    {typeof route.simulatedSettledMicrousd === "number" ? (
                      <div>
                        <dt>Settled</dt>
                        <dd>
                          Simulated {formatMicrousd(route.simulatedSettledMicrousd)}
                          <small className="simulation-provenance">
                            {simulationSettlementLabel(route.simulatedSettlementProvenance!)}
                          </small>
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Actual external spend</dt>
                      <dd>$0</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
            <div className="review-simulation-cost-summary">
              <span><small>Maximum reservation</small><strong>Simulated {formatMicrousd(simulationProjection!.maxSimulatedSpendMicrousd)}</strong></span>
              <span><small>Reserved</small><strong>Simulated {formatMicrousd(simulationProjection!.reservedMicrousd)}</strong></span>
              <span><small>Settled · {simulationSettlementLabel(simulationProjection!.settlementProvenance)}</small><strong>Simulated {formatMicrousd(simulationProjection!.settledMicrousd)}</strong></span>
              <span><small>Actual external spend</small><strong>$0</strong></span>
            </div>
          </section>
        ) : !simulationClaimed && matchingView?.route ? (
          <div className="review-route-line">
            <Cpu />
            <span><strong>{matchingView.route.model}</strong>{matchingView.route.providerId} · {typeLabel(matchingView.route.locality)}</span>
            <small>{routeReasonLabel(matchingView.route.reasonCode)}</small>
          </div>
        ) : null}

        {running || loading ? (
          <section className="review-progress" aria-live="polite">
            <span className="review-progress-mark"><Sparkle weight="fill" /></span>
            <div>
              <strong>{loading ? "Loading review state" : "Inspecting your changes"}</strong>
              <p>
                {simulationHeaderAttributed
                  ? "SOAR is exercising the fake Hybrid route. No external provider is contacted."
                  : "SOAR is collecting bounded repository evidence before local synthesis."}
              </p>
            </div>
          </section>
        ) : (
          <>
            <section
              className={`review-freshness freshness-${freshness}`}
              data-testid="review-freshness"
            >
              {freshness === "fresh_complete" ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}
              <span><strong>{freshnessMessage.label}</strong>{freshnessMessage.detail}</span>
            </section>

            {simulationClaimed && !simulationSafe ? (
              <section className="review-result-withheld" role="alert">
                <WarningCircle weight="fill" />
                <div>
                  <strong>Simulation attribution is incomplete</strong>
                  <p>
                    SOAR will not display or copy this result because its fake-provider, simulated-cost, or zero-external-spend attribution is missing.
                  </p>
                </div>
              </section>
            ) : null}

            {simulationSafe && status === "cancelled" ? (
              <section className="review-cancellation-note" role="status">
                <Stop weight="fill" />
                <span>
                  <strong>Simulation stopped</strong>
                  No Local fallback starts after cancellation. Actual external provider spend remains $0.
                </span>
              </section>
            ) : null}

            {result ? (
              <>
                <section className="review-result-summary" data-testid="review-result">
                  {simulationSafe ? (
                    <p className="review-simulation-inline-marker">{HYBRID_SIMULATION_MARKER}</p>
                  ) : null}
                  <span className="review-section-kicker">Accepted structured result</span>
                  <h2>
                    {emptySnapshot
                      ? "No changes to review"
                      : conclusion === "blocking_findings"
                      ? `${result.findings.length} finding${result.findings.length === 1 ? " needs" : "s need"} attention`
                      : conclusion === "no_blocking_findings"
                        ? "No blocking findings found in the inspected evidence"
                        : "Review incomplete"}
                  </h2>
                  <p>{result.summary}</p>
                  {matchingView?.acceptanceNote ? <small>{matchingView.acceptanceNote}</small> : null}
                </section>

                {result.findings.length > 0 ? (
                  <section className="review-findings" aria-labelledby="review-findings-title">
                    <header>
                      <span className="review-section-kicker">Evidence-linked</span>
                      <h2 id="review-findings-title">Findings</h2>
                    </header>
                    <div className="review-finding-list">
                      {result.findings.map((finding) => (
                        <article className={`review-finding severity-${finding.severity.toLowerCase()}`} key={finding.findingId}>
                          {simulationSafe ? (
                            <p className="review-simulation-inline-marker">{HYBRID_SIMULATION_MARKER}</p>
                          ) : null}
                          <header>
                            <span>{finding.severity}</span>
                            <h3>{finding.title}</h3>
                          </header>
                          <dl>
                            <div><dt>Impact</dt><dd>{finding.impact}</dd></div>
                            <div><dt>Correction</dt><dd>{finding.suggestedCorrection}</dd></div>
                            <div><dt>Test</dt><dd>{finding.suggestedTest}</dd></div>
                          </dl>
                          <ul className="finding-evidence">
                            {finding.evidence.map((evidence, index) => (
                              <li key={`${finding.findingId}-evidence-${index}`}>
                                <Code />
                                {evidenceLabel(evidence, matchingView?.baseRevision)}
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <CoverageSummary coverage={matchingView?.coverage} />

                {result.omissions.length > 0 ? (
                  <section className="review-omissions">
                    <h2>Review omissions</h2>
                    {result.omissions.map((omission) => (
                      <p key={omission.code}><strong>{typeLabel(omission.code)}</strong>{omission.description}</p>
                    ))}
                  </section>
                ) : null}
              </>
            ) : simulationClaimed && !simulationSafe ? null : (
              <section className="review-result-withheld">
                <WarningCircle weight="fill" />
                <div>
                  <strong>{status === "failed" || status === "error" ? "Review could not finish" : "Review result withheld"}</strong>
                  <p>{matchingView?.acceptanceNote || "SOAR does not display or copy findings until the reviewed snapshot is fully revalidated."}</p>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <span className="sr-only" role="status">
        {copyState === "copied" ? "Review copied as Markdown" : copyState === "failed" ? "Review could not be copied" : ""}
      </span>
    </div>
  );
}

function traceIcon(type: string): ReactNode {
  const normalized = type.toLowerCase();
  if (normalized.includes("tool")) return <Wrench />;
  if (normalized.includes("context")) return <Code />;
  if (normalized.includes("route") || normalized.includes("model")) return <Cpu />;
  if (normalized.includes("fail") || normalized.includes("error")) return <XCircle />;
  if (normalized.includes("complete")) return <CheckCircle />;
  return <CaretRight />;
}

type RunCostProvenance =
  | "provider_reported"
  | "local_zero_cost_policy"
  | "host_pricing_snapshot"
  | "reserved_unknown"
  | "unreported"
  | "mixed";

export interface RunSummary {
  events: SoarSessionEvent[];
  model: string | null;
  provider: string | null;
  locality: "local" | "cloud" | null;
  reason: string;
  duration: string;
  providerDuration: string | null;
  cost: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  reported: boolean | null;
  costProvenance: RunCostProvenance | null;
  simulationState: "attributed" | "invalid" | null;
  simulation: HybridSimulationProjection | null;
}

function usageCostProvenance(value: unknown): Exclude<RunCostProvenance, "mixed"> {
  if (
    value === "provider_reported" ||
    value === "local_zero_cost_policy" ||
    value === "host_pricing_snapshot" ||
    value === "reserved_unknown"
  ) {
    return value;
  }
  return "unreported";
}

function mergeCostProvenance(
  aggregate: RunCostProvenance | null,
  current: Exclude<RunCostProvenance, "mixed">,
): RunCostProvenance {
  if (aggregate === null) return current;
  if (aggregate === "unreported" || current === "unreported") return "unreported";
  if (aggregate === "reserved_unknown" || current === "reserved_unknown") {
    return "reserved_unknown";
  }
  return aggregate === current ? aggregate : "mixed";
}

function formatProviderDuration(durationMs: number): string {
  return durationMs < 1_000
    ? `${Math.round(durationMs)}ms`
    : `${(durationMs / 1_000).toFixed(1)}s`;
}

export function summarizeRun(snapshot: SoarSessionSnapshot | null): RunSummary {
  const events = [...(snapshot?.events || [])].sort(
    (a, b) => (a.sequence || 0) - (b.sequence || 0),
  );
  const status = normalizeStatus(snapshot?.status);
  const decisionEvent = [...events]
    .reverse()
    .find((event) => event.type === "routing.decision.recorded");
  const assignedEvent = [...events]
    .reverse()
    .find((event) => event.type === "route.assigned");
  const routeEvent = decisionEvent ?? assignedEvent;
  const routePayload = asPayload(routeEvent?.payload);
  const model =
    firstText(routePayload, ["selectedModel", "model", "modelName"]) || null;
  const provider =
    firstText(routePayload, [
      "selectedProviderId",
      "providerId",
      "provider",
      "providerName",
    ]) || null;
  const directLocality = firstText(routePayload, ["locality"]);
  const routerInput = asPayload(routePayload.routerInputSnapshot);
  const providers = Array.isArray(routerInput.providers)
    ? routerInput.providers.map(asPayload)
    : [];
  const selectedProvider = providers.find(
    (candidate) => firstText(candidate, ["providerId"]) === provider,
  );
  const derivedLocality =
    directLocality || (selectedProvider ? firstText(selectedProvider, ["locality"]) : "");
  const locality =
    derivedLocality === "local" || derivedLocality === "cloud"
      ? derivedLocality
      : null;
  const reason =
    firstText(routePayload, ["reasonCode", "reason", "decisionReason"]) ||
    "Routing begins when the run starts";
  const attemptEvents = events.filter(
    (event) => event.type === "inference.attempt.finished",
  );
  // v2 persists authoritative usage on the finished attempt. If it exists,
  // ignore legacy usage.recorded events so replay cannot count one call twice.
  const usageEvents =
    attemptEvents.length > 0
      ? attemptEvents
      : events.filter((event) => event.type === "usage.recorded");
  const usage = usageEvents.reduce(
    (total, event) => {
      const payload = asPayload(event.payload);
      const usagePayload =
        event.type === "inference.attempt.finished"
          ? asPayload(payload.usage)
          : payload;
      const costPayload =
        event.type === "inference.attempt.finished"
          ? asPayload(payload.cost)
          : payload;
      const number = (key: string) =>
        typeof usagePayload[key] === "number" && Number.isFinite(usagePayload[key])
          ? (usagePayload[key] as number)
          : 0;
      const cost =
        event.type === "inference.attempt.finished"
          ? typeof costPayload.amountMicrousd === "number" &&
            Number.isFinite(costPayload.amountMicrousd)
            ? costPayload.amountMicrousd / 1_000_000
            : 0
          : typeof payload.costUsd === "number" && Number.isFinite(payload.costUsd)
            ? payload.costUsd
            : 0;
      const latencyReported =
        typeof payload.latencyMs === "number" &&
        Number.isFinite(payload.latencyMs) &&
        payload.latencyMs >= 0;
      const latency = latencyReported ? (payload.latencyMs as number) : 0;
      const provenance = usageCostProvenance(
        event.type === "inference.attempt.finished"
          ? costPayload.provenance
          : payload.costProvenance,
      );
      return {
        input: total.input + number("inputTokens"),
        output: total.output + number("outputTokens"),
        reasoning: total.reasoning + number("reasoningTokens"),
        cost: total.cost + cost,
        latency: total.latency + latency,
        latencyReported: total.latencyReported && latencyReported,
        records: total.records + 1,
        reported: total.reported && usagePayload.reported === true,
        costProvenance: mergeCostProvenance(
          total.costProvenance,
          provenance,
        ),
      };
    },
    {
      input: 0,
      output: 0,
      reasoning: 0,
      cost: 0,
      latency: 0,
      latencyReported: true,
      records: 0,
      reported: true,
      costProvenance: null as RunCostProvenance | null,
    },
  );
  const endTime = terminalStatuses.has(status) ? snapshot?.updatedAt : undefined;
  const duration = formatDuration(snapshot?.createdAt, endTime);
  const providerDuration =
    usage.records === 0
      ? null
      : usage.latencyReported
        ? formatProviderDuration(usage.latency)
        : "Unknown";
  const claimedSimulationState = snapshot
    ? sessionSimulationState(snapshot)
    : null;
  const simulation =
    snapshot && claimedSimulationState === "attributed"
      ? simulationProjectionFromSnapshot(snapshot)
      : null;
  const simulationState =
    claimedSimulationState === "attributed" && simulation === null
      ? "invalid"
      : claimedSimulationState;

  return {
    events,
    model: simulationState === "invalid" ? null : model,
    provider: simulationState === "invalid" ? null : provider,
    locality: simulationState === "invalid" ? null : locality,
    reason:
      simulationState === "invalid"
        ? "Simulation attribution unavailable"
        : reason,
    duration,
    providerDuration,
    cost:
      simulationState === "invalid"
        ? "Withheld"
        : simulation
          ? "$0.00"
          : usage.records === 0
        ? null
        : usage.costProvenance === "unreported" ||
            usage.costProvenance === "reserved_unknown"
          ? "Unknown"
          : usage.cost === 0
            ? "$0.00"
            : `$${usage.cost.toFixed(4)}`,
    inputTokens: usage.input,
    outputTokens: usage.output,
    reasoningTokens: usage.reasoning,
    totalTokens: usage.input + usage.output + usage.reasoning,
    reported: usage.records === 0 ? null : usage.reported,
    costProvenance: usage.records === 0 ? null : usage.costProvenance,
    simulationState,
    simulation,
  };
}

export function TracePanel({
  snapshot,
  open,
  onClose,
}: {
  snapshot: SoarSessionSnapshot | null;
  open: boolean;
  onClose: () => void;
}) {
  const summary = useMemo(() => summarizeRun(snapshot), [snapshot]);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocus(panelRef, closeRef, open);

  return (
    <aside
      ref={panelRef}
      className={`trace-panel ${open ? "is-open" : ""}`}
      role="dialog"
      aria-label="Run details"
      aria-hidden={!open}
      aria-modal={open ? true : undefined}
      inert={!open ? true : undefined}
    >
      <div className="trace-header">
        <div>
          <strong>Run details</strong>
          <span>Routing and activity</span>
        </div>
        <button
          ref={closeRef}
          className="icon-button trace-close"
          onClick={onClose}
          aria-label="Close run details"
        >
          <X />
        </button>
      </div>

      {!snapshot ? (
        <div className="trace-empty">
          <List />
          <p>Run details will appear after you start a task.</p>
        </div>
      ) : (
        <>
          {summary.simulationState === "attributed" ? (
            <div className="trace-simulation-marker" role="note">
              {HYBRID_SIMULATION_MARKER}
            </div>
          ) : summary.simulationState === "invalid" ? (
            <div className="trace-simulation-marker is-invalid" role="alert">
              Simulation attribution unavailable — route and cost details withheld.
            </div>
          ) : null}
          {summary.simulationState === "invalid" ? null : (
            <section className="route-summary">
              <div className="route-model">
                <span className="route-model-icon"><Cpu weight="fill" /></span>
                <span>
                  <small>
                    {summary.locality
                      ? `${typeLabel(summary.locality)} route${summary.provider ? ` · ${summary.provider}` : ""}`
                      : summary.model
                        ? "Selected model"
                        : "Routing"}
                  </small>
                  <strong>{summary.model || "Route pending"}</strong>
                </span>
              </div>
              <p>{shortText(routeReasonLabel(summary.reason), 100)}</p>
            </section>
          )}

          <div className="metric-grid">
            <div>
              <Clock />
              <span>End-to-end</span>
              <strong>{summary.duration}</strong>
              <small>
                Provider time {summary.providerDuration || "—"}
              </small>
            </div>
            <div>
              <Code />
              <span>Total tokens</span>
              <strong>
                {summary.reported === null
                  ? "—"
                  : summary.reported
                    ? summary.totalTokens
                    : "Unknown"}
              </strong>
            </div>
            <div>
              <Coins />
              <span>
                {summary.simulationState === "attributed"
                  ? "Actual external spend"
                  : "Cost"}
              </span>
              <strong>{summary.cost || "—"}</strong>
            </div>
          </div>

          {summary.simulation ? (
            <section className="trace-simulation-cost" aria-label="Simulation accounting">
              <span>
                <small>Maximum reservation</small>
                <strong>Simulated {formatMicrousd(summary.simulation.maxSimulatedSpendMicrousd)}</strong>
              </span>
              <span>
                <small>Reserved</small>
                <strong>Simulated {formatMicrousd(summary.simulation.reservedMicrousd)}</strong>
              </span>
              <span>
                <small>Settled · {simulationSettlementLabel(summary.simulation.settlementProvenance)}</small>
                <strong>Simulated {formatMicrousd(summary.simulation.settledMicrousd)}</strong>
              </span>
              <span>
                <small>Actual external spend</small>
                <strong>$0</strong>
              </span>
            </section>
          ) : null}

          <section className="workspace-summary">
            <span>Workspace</span>
            <strong title={snapshot.workspaceRoot}>{workspaceName(snapshot.workspaceRoot)}</strong>
            <small>{snapshot.workspaceRoot || "No workspace selected"}</small>
          </section>

          {summary.simulationState === "invalid" ? (
            <div className="trace-empty" role="status">
              <List />
              <p>Activity details are withheld until simulation attribution is valid.</p>
            </div>
          ) : (
          <section className="activity-section">
            <div className="activity-heading">
              <strong>Activity</strong>
              <span>{summary.events.length}</span>
            </div>
            {summary.events.length === 0 ? (
              <div className="activity-empty">Waiting for the first event.</div>
            ) : (
              <ol className="activity-list">
                {summary.events.map((event) => {
                  const detail = eventDetail(event);
                  return (
                    <li key={event.id}>
                      <span className="activity-icon">{traceIcon(event.type)}</span>
                      <span className="activity-copy">
                        <strong>{typeLabel(event.type)}</strong>
                        {detail ? <small>{detail}</small> : null}
                      </span>
                      <time>{formatClock(event.createdAt)}</time>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          )}
        </>
      )}
    </aside>
  );
}

export function StatusBar({ snapshot }: { snapshot: SoarSessionSnapshot | null }) {
  const summary = useMemo(() => summarizeRun(snapshot), [snapshot]);
  const status = normalizeStatus(snapshot?.status);
  const statusLabel = !snapshot
    ? "Runtime checked when a task starts"
    : status === "created" && snapshot.taskTrack === "change-review-v1"
      ? summary.simulationState === "attributed"
        ? "Preparing Hybrid simulation"
        : "Preparing local review"
    : status === "running" || status === "queued"
      ? summary.simulationState === "attributed"
        ? "Hybrid simulation running"
        : "Agent working"
      : status === "completed"
        ? "Run completed"
        : status === "failed" || status === "error"
          ? "Run failed"
          : status === "cancelled"
            ? "Run stopped"
            : status === "interrupted"
              ? "Run interrupted"
              : "Run not started";
  const displayedStatusLabel =
    summary.simulationState === "invalid"
        ? "Simulation attribution unavailable"
        : statusLabel;

  return (
    <footer className="statusbar" aria-label="Runtime status">
      <span className="statusbar-connection">
        <span className={`runtime-dot ${status === "running" ? "is-working" : ""}`} aria-hidden="true" />
        {displayedStatusLabel}
      </span>
      <span className="statusbar-session">
        <span data-testid="route-model">
          {summary.simulationState === "invalid"
            ? "Route withheld"
            : summary.model || (snapshot ? "Route pending" : "No active run")}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {summary.simulationState === "attributed"
            ? "Simulation"
            : summary.simulationState === "invalid"
              ? "Locality withheld"
            : summary.locality
              ? typeLabel(summary.locality)
              : summary.model
                ? "Local"
                : "Idle"}
        </span>
        <span aria-hidden="true">·</span>
        <span data-testid="route-cost">
          {summary.simulation
            ? `Simulated ${formatMicrousd(summary.simulation.settledMicrousd)} · actual $0`
            : summary.cost || "—"}
        </span>
      </span>
    </footer>
  );
}

interface SimulationCompletionNotice {
  sessionId: string;
  sessionTitle: string;
  outcome: "completed" | "failed" | "cancelled" | "interrupted";
}

function SimulationCompletionNotification({
  notice,
  onDismiss,
}: {
  notice: SimulationCompletionNotice;
  onDismiss: () => void;
}) {
  const heading =
    notice.outcome === "completed"
      ? "Hybrid simulation completed"
      : notice.outcome === "cancelled"
        ? "Hybrid simulation stopped"
        : notice.outcome === "interrupted"
          ? "Hybrid simulation interrupted"
          : "Hybrid simulation failed";
  const outcomeIcon =
    notice.outcome === "completed" ? (
      <CheckCircle weight="fill" />
    ) : notice.outcome === "cancelled" ? (
      <Stop weight="fill" />
    ) : (
      <WarningCircle weight="fill" />
    );
  return (
    <aside
      className={`simulation-completion-notification is-${notice.outcome}`}
      data-testid="simulation-completion-notification"
      data-outcome={notice.outcome}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        className="simulation-notification-outcome-icon"
        data-icon={
          notice.outcome === "completed"
            ? "success"
            : notice.outcome === "cancelled"
              ? "stop"
              : "warning"
        }
        aria-hidden="true"
      >
        {outcomeIcon}
      </span>
      <span>
        <strong>{heading}</strong>
        <small>{notice.sessionTitle}</small>
        <small>Session {notice.sessionId}</small>
        <small>{HYBRID_SIMULATION_MARKER}</small>
      </span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss simulation notification">
        <X />
      </button>
    </aside>
  );
}

export function App() {
  const [sessions, setSessions] = useState<SoarSessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SoarSessionSnapshot | null>(null);
  const [workspace, setWorkspace] = useState<{ path: string; name: string } | null>(null);
  const [task, setTask] = useState("");
  const [streamedText, setStreamedText] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingSession, setLoadingSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [surface, setSurface] = useState<
    "task" | "review_setup" | "settings"
  >("task");
  const [reviewAvailability, setReviewAvailability] = useState<ReviewAvailability>(
    defaultReviewAvailability,
  );
  const [reviewAvailabilityLoading, setReviewAvailabilityLoading] = useState(false);
  const [reviewRoute, setReviewRoute] = useState<ReviewRouteIntent>("local");
  const [simulationChallenge, setSimulationChallenge] =
    useState<HybridSimulationConsentChallenge | null>(null);
  const [simulationConsentChecked, setSimulationConsentChecked] = useState(false);
  const [simulationConsentLoading, setSimulationConsentLoading] = useState(false);
  const [simulationConsentError, setSimulationConsentError] = useState<string | null>(null);
  const [reviewView, setReviewView] = useState<ChangeReviewView | null>(null);
  const [reviewViewLoading, setReviewViewLoading] = useState(false);
  const [cloudSetupStatus, setCloudSetupStatus] =
    useState<CloudSetupStatus | null>(null);
  const [cloudSetupLoading, setCloudSetupLoading] = useState(false);
  const [cloudSetupLoadFailed, setCloudSetupLoadFailed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [simulationCompletionNotice, setSimulationCompletionNotice] =
    useState<SimulationCompletionNotice | null>(null);
  const compactLayout = useMediaQuery("(max-width: 880px)");
  const selectedIdRef = useRef<string | null>(null);
  const workspaceRef = useRef<{ path: string; name: string } | null>(null);
  const reviewRouteRef = useRef<ReviewRouteIntent>("local");
  const latestAssistantStartRef = useRef<string | null>(null);
  const reviewRequestOrdinalRef = useRef(0);
  const simulationChallengeOrdinalRef = useRef(0);
  const settingsReturnSurfaceRef = useRef<"task" | "review_setup">("task");
  const settingsReturnFocusRef = useRef<"sidebar" | "review" | null>(null);
  const settingsFocusRestorePendingRef = useRef(false);
  const notifiedSimulationTerminalsRef = useRef(new Set<string>());

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!simulationChallenge) return;
    const remainingMs = Date.parse(simulationChallenge.expiresAt) - Date.now();
    const expire = () => {
      simulationChallengeOrdinalRef.current += 1;
      setSimulationChallenge(null);
      setSimulationConsentChecked(false);
      setSimulationConsentLoading(false);
      setSimulationConsentError(
        "This disclosure expired. Prepare a new disclosure before starting.",
      );
    };
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      expire();
      return;
    }
    if (remainingMs > 2_147_000_000) return;
    const timeout = window.setTimeout(expire, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [simulationChallenge]);

  useEffect(() => {
    const focusTarget = settingsReturnFocusRef.current;
    if (
      surface === "settings" ||
      focusTarget === null ||
      !settingsFocusRestorePendingRef.current
    ) {
      return;
    }
    settingsFocusRestorePendingRef.current = false;
    settingsReturnFocusRef.current = null;
    const candidate = document.querySelector<HTMLElement>(
      `[data-cloud-settings-trigger="${focusTarget}"]`,
    );
    const target = candidate?.closest("[inert]")
      ? document.querySelector<HTMLElement>("[data-cloud-settings-return-menu]")
      : candidate;
    target?.focus();
  }, [surface]);

  useEffect(() => {
    if (snapshot?.taskTrack !== "change-review-v1") {
      reviewRequestOrdinalRef.current += 1;
      setReviewView(null);
      setReviewViewLoading(false);
      return;
    }
    // A review projection is session-bound. Clear any prior projection before
    // issuing the next request so a fast history switch cannot briefly render
    // or copy another session's attribution.
    setReviewView(null);
    const api = reviewApi();
    if (!api) {
      reviewRequestOrdinalRef.current += 1;
      setReviewView(null);
      setReviewViewLoading(false);
      setError("Review Current Changes is not available in this app build.");
      return;
    }
    let disposed = false;
    const refresh = () => {
      const requestOrdinal = ++reviewRequestOrdinalRef.current;
      setReviewViewLoading(true);
      void api
        .getChangeReviewView(snapshot.id)
        .then((value) => {
          if (
            !disposed &&
            requestOrdinal === reviewRequestOrdinalRef.current
          ) {
            setReviewView(value);
          }
        })
        .catch((reason: unknown) => {
          if (
            !disposed &&
            requestOrdinal === reviewRequestOrdinalRef.current
          ) {
            setReviewView(null);
            setError(
              reason instanceof Error
                ? reason.message
                : "The review state could not load.",
            );
          }
        })
        .finally(() => {
          if (
            !disposed &&
            requestOrdinal === reviewRequestOrdinalRef.current
          ) {
            setReviewViewLoading(false);
          }
        });
    };
    const refreshOnFocus = () => refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      disposed = true;
      reviewRequestOrdinalRef.current += 1;
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [snapshot?.id, snapshot?.taskTrack, snapshot?.updatedAt]);

  const upsertSummary = useCallback((incoming: SoarSessionSnapshot) => {
    setSessions((current) => {
      const summary: SoarSessionSummary = {
        id: incoming.id,
        title: incoming.title,
        status: incoming.status,
        createdAt: incoming.createdAt,
        updatedAt: incoming.updatedAt,
        executionMode: incoming.executionMode,
        simulationMarker: incoming.simulationMarker,
      };
      const rest = current.filter((item) => item.id !== incoming.id);
      return [summary, ...rest].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    });
  }, []);

  useEffect(() => {
    let active = true;
    void window.soar
      .listSessions()
      .then((items) => {
        if (!active) return;
        const sorted = [...(items || [])].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        setSessions(sorted);
        if (sorted[0]) setSelectedId(sorted[0].id);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Sessions could not load.");
      })
      .finally(() => {
        if (active) setLoadingSessions(false);
      });

    const unsubscribe = window.soar.subscribeSessionEvents((update) => {
      if (update.kind === "stream" && update.delta && update.sessionId === selectedIdRef.current) {
        setStreamedText((current) => current + update.delta);
        return;
      }
      if (update.kind === "snapshot" && update.snapshot) {
        upsertSummary(update.snapshot);
        const terminalStatus = normalizeStatus(update.snapshot.status);
        if (
          update.sessionId === selectedIdRef.current &&
          terminalStatuses.has(terminalStatus) &&
          sessionSimulationState(update.snapshot) === "attributed" &&
          !notifiedSimulationTerminalsRef.current.has(update.snapshot.id)
        ) {
          notifiedSimulationTerminalsRef.current.add(update.snapshot.id);
          setSimulationCompletionNotice({
            sessionId: update.snapshot.id,
            sessionTitle: update.snapshot.title || "Untitled task",
            outcome:
              terminalStatus === "completed" ||
              terminalStatus === "cancelled" ||
              terminalStatus === "interrupted"
                ? terminalStatus
                : "failed",
          });
        }
        if (update.sessionId === selectedIdRef.current) {
          const latestAssistantStartId = latestAssistantStartEventId(
            update.snapshot,
          );
          if (
            latestAssistantStartId !== null &&
            latestAssistantStartRef.current !== latestAssistantStartId
          ) {
            latestAssistantStartRef.current = latestAssistantStartId;
            setStreamedText("");
          }
          setSnapshot(update.snapshot);
          if (terminalStatuses.has(normalizeStatus(update.snapshot.status))) {
            setStreamedText("");
          }
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [upsertSummary]);

  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      setReviewView(null);
      return;
    }
    let active = true;
    setLoadingSession(true);
    setSnapshot(null);
    setReviewView(null);
    setStreamedText("");
    latestAssistantStartRef.current = null;
    void window.soar
      .getSession(selectedId)
      .then((value) => {
        if (!active) return;
        setSnapshot(value);
        if (value.workspaceRoot) {
          const nextWorkspace = {
            path: value.workspaceRoot,
            name: workspaceName(value.workspaceRoot),
          };
          workspaceRef.current = nextWorkspace;
          setWorkspace(nextWorkspace);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "The session could not load.");
      })
      .finally(() => {
        if (active) setLoadingSession(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const invalidateSimulationConsent = useCallback((): Promise<boolean> => {
    simulationChallengeOrdinalRef.current += 1;
    setSimulationChallenge(null);
    setSimulationConsentChecked(false);
    setSimulationConsentLoading(false);
    setSimulationConsentError(null);
    const api = reviewApi();
    if (!api?.invalidateHybridSimulationConsentChallenges) {
      return Promise.resolve(false);
    }
    return api
      .invalidateHybridSimulationConsentChallenges()
      .then(() => true)
      .catch(() => {
        setSimulationConsentError(
          "The previous Hybrid simulation disclosure could not be revoked.",
        );
        return false;
      });
  }, []);

  const issueSimulationChallenge = useCallback(async (workspaceRoot: string) => {
    const api = reviewApi();
    const requestOrdinal = ++simulationChallengeOrdinalRef.current;
    setSimulationChallenge(null);
    setSimulationConsentChecked(false);
    setSimulationConsentError(null);
    if (!api?.issueHybridSimulationConsentChallenge) {
      setSimulationConsentLoading(false);
      setSimulationConsentError(
        "This app build cannot issue a Hybrid simulation disclosure.",
      );
      return;
    }
    setSimulationConsentLoading(true);
    try {
      const challenge = await api.issueHybridSimulationConsentChallenge({
        workspaceRoot,
        route: "hybrid_simulation",
      });
      if (requestOrdinal !== simulationChallengeOrdinalRef.current) return;
      if (!isCurrentSimulationChallenge(challenge)) {
        throw new Error("The simulation disclosure returned by the app is invalid or expired.");
      }
      setSimulationChallenge(challenge);
    } catch (reason) {
      if (requestOrdinal !== simulationChallengeOrdinalRef.current) return;
      setSimulationChallenge(null);
      setSimulationConsentChecked(false);
      setSimulationConsentError(
        reason instanceof Error
          ? reason.message
          : "The simulation disclosure could not be prepared.",
      );
    } finally {
      if (requestOrdinal === simulationChallengeOrdinalRef.current) {
        setSimulationConsentLoading(false);
      }
    }
  }, []);

  const chooseWorkspace = useCallback(async () => {
    setError(null);
    const mustInvalidateConsent =
      surface === "review_setup" &&
      (reviewRoute === "hybrid_simulation" || simulationChallenge !== null);
    const consentInvalidated = mustInvalidateConsent
      ? await invalidateSimulationConsent()
      : true;
    if (mustInvalidateConsent && !consentInvalidated) {
      setError(
        "The workspace cannot change until the previous Hybrid simulation disclosure is revoked.",
      );
      return;
    }
    try {
      const choice = await window.soar.chooseWorkspace();
      if (choice) {
        workspaceRef.current = choice;
        setWorkspace(choice);
        if (
          surface === "review_setup" &&
          reviewRouteRef.current === "hybrid_simulation" &&
          consentInvalidated
        ) {
          void issueSimulationChallenge(choice.path);
        }
      } else if (
        surface === "review_setup" &&
        reviewRoute === "hybrid_simulation" &&
        consentInvalidated &&
        workspace
      ) {
        // The picker was cancelled after main burned the prior challenge.
        // Restore a usable, unchecked disclosure for the unchanged workspace.
        void issueSimulationChallenge(workspace.path);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The workspace picker could not open.");
      if (
        surface === "review_setup" &&
        reviewRoute === "hybrid_simulation" &&
        consentInvalidated &&
        workspace
      ) {
        void issueSimulationChallenge(workspace.path);
      }
    }
  }, [
    invalidateSimulationConsent,
    issueSimulationChallenge,
    reviewRoute,
    simulationChallenge,
    surface,
    workspace,
  ]);

  const startNewSession = useCallback(async () => {
    if (!task.trim() || !workspace || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await window.soar.createSession({
        task: task.trim(),
        workspaceRoot: workspace.path,
        taskTrack: "repository-investigator-v1",
      });
      upsertSummary(created);
      selectedIdRef.current = created.id;
      setSelectedId(created.id);
      setSnapshot(created);
      setStreamedText("");
      latestAssistantStartRef.current = null;
      setTask("");
      await window.soar.startSession(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The task could not start.");
    } finally {
      setBusy(false);
    }
  }, [busy, task, upsertSummary, workspace]);

  const loadCloudSetupStatus = useCallback(() => {
    setCloudSetupLoading(true);
    setCloudSetupLoadFailed(false);
    void window.soar
      .getCloudSetupStatus()
      .then((status) => setCloudSetupStatus(status))
      .catch(() => {
        setCloudSetupStatus(null);
        setCloudSetupLoadFailed(true);
      })
      .finally(() => setCloudSetupLoading(false));
  }, []);

  const openCloudSettings = useCallback(
    (
      returnSurface: "task" | "review_setup",
      returnFocus: "sidebar" | "review",
    ) => {
      settingsReturnSurfaceRef.current = returnSurface;
      settingsReturnFocusRef.current = returnFocus;
      settingsFocusRestorePendingRef.current = false;
      setSurface("settings");
      setError(null);
      setSidebarOpen(false);
      loadCloudSetupStatus();
    },
    [loadCloudSetupStatus],
  );

  const closeCloudSettings = useCallback(() => {
    const returnSurface = settingsReturnSurfaceRef.current;
    settingsFocusRestorePendingRef.current = true;
    setSurface(returnSurface);
    setError(null);

    if (returnSurface !== "review_setup") return;
    const api = reviewApi();
    if (!api) {
      setReviewAvailability(defaultReviewAvailability);
      setError("Review Current Changes is not available in this app build.");
      return;
    }
    setReviewAvailabilityLoading(true);
    void api
      .getReviewAvailability()
      .then(setReviewAvailability)
      .catch(() => {
        setReviewAvailability(defaultReviewAvailability);
        setError("Local review support could not be checked.");
      })
      .finally(() => setReviewAvailabilityLoading(false));
  }, []);

  const saveCloudCredential = useCallback((credential: string) => {
    return window.soar.saveCloudCredential({ credential }).then((status) => {
      setCloudSetupStatus(status);
      setCloudSetupLoadFailed(false);
      return status;
    });
  }, []);

  const deleteCloudCredential = useCallback(() => {
    return window.soar.deleteCloudCredential().then((status) => {
      setCloudSetupStatus(status);
      setCloudSetupLoadFailed(false);
      return status;
    });
  }, []);

  const openReviewSetup = useCallback(() => {
    selectedIdRef.current = null;
    setSelectedId(null);
    setSnapshot(null);
    setReviewView(null);
    reviewRouteRef.current = "local";
    setReviewRoute("local");
    void invalidateSimulationConsent();
    setStreamedText("");
    latestAssistantStartRef.current = null;
    setSurface("review_setup");
    setError(null);
    setSidebarOpen(false);

    const api = reviewApi();
    if (!api) {
      setReviewAvailability(defaultReviewAvailability);
      setError("Review Current Changes is not available in this app build.");
      return;
    }
    setReviewAvailabilityLoading(true);
    void api
      .getReviewAvailability()
      .then(setReviewAvailability)
      .catch((reason: unknown) => {
        setReviewAvailability(defaultReviewAvailability);
        setError(reason instanceof Error ? reason.message : "Local review support could not be checked.");
      })
      .finally(() => setReviewAvailabilityLoading(false));
  }, [invalidateSimulationConsent]);

  const changeReviewRoute = useCallback(
    (nextRoute: ReviewRouteIntent) => {
      if (nextRoute === reviewRoute) return;
      const invalidation = invalidateSimulationConsent();
      const invalidationOrdinal = simulationChallengeOrdinalRef.current;
      void invalidation.then((invalidated) => {
        if (
          invalidated &&
          invalidationOrdinal === simulationChallengeOrdinalRef.current
        ) {
          reviewRouteRef.current = nextRoute;
          setReviewRoute(nextRoute);
          if (nextRoute === "hybrid_simulation" && workspaceRef.current) {
            void issueSimulationChallenge(workspaceRef.current.path);
          }
        }
      });
    },
    [invalidateSimulationConsent, issueSimulationChallenge, reviewRoute, workspace],
  );

  const retrySimulationChallenge = useCallback(() => {
    if (!workspace || reviewRoute !== "hybrid_simulation") return;
    const invalidation = invalidateSimulationConsent();
    const invalidationOrdinal = simulationChallengeOrdinalRef.current;
    void invalidation.then((invalidated) => {
      if (
        invalidated &&
        invalidationOrdinal === simulationChallengeOrdinalRef.current
      ) {
        void issueSimulationChallenge(workspace.path);
      }
    });
  }, [invalidateSimulationConsent, issueSimulationChallenge, reviewRoute, workspace]);

  const startChangeReview = useCallback(async () => {
    const simulationSelected = reviewRoute === "hybrid_simulation";
    const simulationChallengeId = simulationChallenge?.challengeId;
    if (
      !workspace ||
      busy ||
      (simulationSelected
        ? !reviewAvailability.hybrid.enabled ||
          !simulationChallengeId ||
          !simulationConsentChecked
        : !reviewAvailability.local.enabled)
    ) {
      return;
    }
    const api = reviewApi();
    if (!api) {
      setError("Review Current Changes is not available in this app build.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createChangeReviewSession(
        simulationSelected
          ? {
              workspaceRoot: workspace.path,
              route: "hybrid_simulation",
              challengeId: simulationChallengeId!,
              acknowledged: true,
            }
          : {
              workspaceRoot: workspace.path,
              route: "local",
            },
      );
      upsertSummary(created);
      selectedIdRef.current = created.id;
      setSelectedId(created.id);
      setSnapshot(created);
      setReviewView(null);
      void invalidateSimulationConsent();
      setSurface("task");
    } catch (reason) {
      if (simulationSelected) {
        simulationChallengeOrdinalRef.current += 1;
        setSimulationChallenge(null);
        setSimulationConsentChecked(false);
        setSimulationConsentError(
          reason instanceof Error
            ? `${reason.message} Prepare a new disclosure before retrying.`
            : "The Hybrid simulation could not start. Prepare a new disclosure before retrying.",
        );
      } else {
        setError(reason instanceof Error ? reason.message : "The local review could not start.");
      }
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    reviewAvailability.hybrid.enabled,
    reviewAvailability.local.enabled,
    reviewRoute,
    simulationChallenge,
    simulationConsentChecked,
    invalidateSimulationConsent,
    upsertSummary,
    workspace,
  ]);

  const cancelSession = useCallback(async () => {
    if (!snapshot || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.soar.cancelSession(snapshot.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The run could not be stopped.");
    } finally {
      setBusy(false);
    }
  }, [busy, snapshot]);

  const newTask = useCallback(() => {
    selectedIdRef.current = null;
    setSelectedId(null);
    setSnapshot(null);
    setTask("");
    setStreamedText("");
    latestAssistantStartRef.current = null;
    setError(null);
    setSurface("task");
    setReviewView(null);
    setSimulationCompletionNotice(null);
    void invalidateSimulationConsent();
    setSidebarOpen(false);
  }, [invalidateSimulationConsent]);

  const selectSession = useCallback((id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setSnapshot(null);
    setReviewView(null);
    setSimulationCompletionNotice(null);
    setSidebarOpen(false);
    setError(null);
    setSurface("task");
    void invalidateSimulationConsent();
  }, [invalidateSimulationConsent]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && (sidebarOpen || traceOpen)) {
        event.preventDefault();
        setSidebarOpen(false);
        setTraceOpen(false);
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newTask();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newTask, sidebarOpen, traceOpen]);

  useEffect(() => {
    if (!compactLayout) setSidebarOpen(false);
  }, [compactLayout]);

  const status = normalizeStatus(snapshot?.status);
  const reviewSession = snapshot?.taskTrack === "change-review-v1";
  const running =
    status === "running" ||
    status === "queued" ||
    (reviewSession && status === "created");
  return (
    <div className="app-shell">
      <SessionSidebar
        sessions={sessions}
        selectedId={selectedId}
        loading={loadingSessions}
        open={sidebarOpen}
        modal={compactLayout}
        runtimeActive={running}
        onSelect={selectSession}
        onNew={newTask}
        onReview={openReviewSetup}
        onSettings={() =>
          openCloudSettings(
            surface === "review_setup" ? "review_setup" : "task",
            "sidebar",
          )
        }
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main-workspace">
        <header className={`task-header ${snapshot || surface !== "task" ? "has-session" : "is-empty"}`}>
          <button
            className="icon-button session-menu-button"
            data-cloud-settings-return-menu
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sessions"
          >
            <SidebarSimple />
          </button>
          <div className="task-heading">
            {surface === "settings" ? (
              <strong>Settings</strong>
            ) : snapshot ? (
              <>
                <strong>{snapshot.title || "Untitled task"}</strong>
                <span>{workspaceName(snapshot.workspaceRoot)}</span>
              </>
            ) : surface === "review_setup" ? (
              <strong>Review current changes</strong>
            ) : null}
          </div>
          <div className="task-header-actions">
            {snapshot ? <StatusBadge status={snapshot.status} /> : null}
            <button
              className="icon-button trace-toggle"
              onClick={() => setTraceOpen(true)}
              aria-label="Open run details"
              disabled={!snapshot}
            >
              <List />
            </button>
          </div>
        </header>

        {error ? (
          <div className="global-error" role="alert">
            <WarningCircle weight="fill" />
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error"><X /></button>
          </div>
        ) : null}

        {simulationCompletionNotice &&
        simulationCompletionNotice.sessionId === selectedId &&
        simulationCompletionNotice.sessionId === snapshot?.id ? (
          <SimulationCompletionNotification
            notice={simulationCompletionNotice}
            onDismiss={() => setSimulationCompletionNotice(null)}
          />
        ) : null}

        <section className="conversation-panel">
          {surface === "settings" ? (
            <CloudSettings
              status={cloudSetupStatus}
              loading={cloudSetupLoading}
              loadFailed={cloudSetupLoadFailed}
              onRetry={loadCloudSetupStatus}
              onSave={saveCloudCredential}
              onDelete={deleteCloudCredential}
              onDone={closeCloudSettings}
            />
          ) : surface === "review_setup" ? (
            <ReviewSetup
              workspace={workspace}
              availability={reviewAvailability}
              loading={reviewAvailabilityLoading}
              busy={busy}
              route={reviewRoute}
              challenge={simulationChallenge}
              consentChecked={simulationConsentChecked}
              consentLoading={simulationConsentLoading}
              consentError={simulationConsentError}
              onChooseWorkspace={chooseWorkspace}
              onOpenCloudSettings={() =>
                openCloudSettings("review_setup", "review")
              }
              onRouteChange={changeReviewRoute}
              onConsentChange={setSimulationConsentChecked}
              onRetryChallenge={retrySimulationChallenge}
              onStart={startChangeReview}
            />
          ) : reviewSession && snapshot ? (
            <ChangeReviewWorkspace
              snapshot={snapshot}
              view={reviewView}
              loading={loadingSession || reviewViewLoading}
              stopping={busy}
              onStop={cancelSession}
            />
          ) : (
            <>
              <Transcript
                snapshot={snapshot}
                streamedText={streamedText}
                loading={loadingSession}
                onPromptSelect={setTask}
                onReview={openReviewSetup}
              />
              <Composer
                task={task}
                workspace={workspace}
                busy={busy}
                running={running}
                onTaskChange={setTask}
                onChooseWorkspace={chooseWorkspace}
                onSubmit={startNewSession}
                onCancel={cancelSession}
              />
            </>
          )}
        </section>
        <StatusBar snapshot={snapshot} />
      </main>

      <TracePanel snapshot={snapshot} open={traceOpen} onClose={() => setTraceOpen(false)} />
      {((compactLayout && sidebarOpen) || traceOpen) ? (
        <button
          className="panel-scrim"
          aria-label="Close panel"
          onClick={() => {
            setSidebarOpen(false);
            setTraceOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
