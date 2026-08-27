import {
  ArrowUp,
  CaretRight,
  CheckCircle,
  Clock,
  Code,
  Coins,
  Copy,
  Cpu,
  FolderOpen,
  List,
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

type Payload = Record<string, unknown>;
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
  return typeLabel(reason);
}

function eventDetail(event: SoarSessionEvent): string {
  const payload = asPayload(event.payload);
  const type = event.type.toLowerCase();
  if (type.includes("route") || type.includes("model")) {
    const provider = firstText(payload, ["providerId", "provider", "providerName"]);
    const model = firstText(payload, ["model", "modelName"]);
    const reason = firstText(payload, ["reason", "decisionReason"]);
    return shortText([provider, model, reason].filter(Boolean).join(" / "));
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

function transcriptFrom(snapshot: SoarSessionSnapshot | null): TranscriptItem[] {
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
    if (isAssistant && !isDelta && text) {
      const messageId = firstText(payload, ["messageId"]);
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
      body: "The saved session can continue from its last durable event.",
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

interface SessionSidebarProps {
  sessions: SoarSessionSummary[];
  selectedId: string | null;
  loading: boolean;
  open: boolean;
  modal: boolean;
  runtimeActive: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
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
  onClose,
}: SessionSidebarProps) {
  const [query, setQuery] = useState("");
  const sidebarRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocus(sidebarRef, closeRef, modal && open);
  const visibleSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return sessions;
    return sessions.filter((session) =>
      (session.title || "Untitled task").toLowerCase().includes(normalizedQuery),
    );
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
        <Cpu aria-hidden="true" />
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
}: {
  snapshot: SoarSessionSnapshot | null;
  streamedText: string;
  loading: boolean;
  onPromptSelect: (prompt: string) => void;
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

function traceIcon(type: string): ReactNode {
  const normalized = type.toLowerCase();
  if (normalized.includes("tool")) return <Wrench />;
  if (normalized.includes("route") || normalized.includes("model")) return <Cpu />;
  if (normalized.includes("fail") || normalized.includes("error")) return <XCircle />;
  if (normalized.includes("complete")) return <CheckCircle />;
  return <CaretRight />;
}

interface RunSummary {
  events: SoarSessionEvent[];
  model: string | null;
  reason: string;
  duration: string;
  cost: string | null;
  inputTokens: number;
  outputTokens: number;
}

function summarizeRun(snapshot: SoarSessionSnapshot | null): RunSummary {
  const events = [...(snapshot?.events || [])].sort(
    (a, b) => (a.sequence || 0) - (b.sequence || 0),
  );
  const status = normalizeStatus(snapshot?.status);
  const routeEvent = [...events]
    .reverse()
    .find((event) => /route|model|provider/i.test(event.type));
  const routePayload = asPayload(routeEvent?.payload);
  const model = firstText(routePayload, ["model", "modelName"]) || null;
  const reason =
    firstText(routePayload, ["reason", "decisionReason"]) || "Routing begins when the run starts";
  const usage = events.reduce(
    (total, event) => {
      if (event.type !== "usage.recorded") return total;
      const payload = asPayload(event.payload);
      const number = (key: string) =>
        typeof payload[key] === "number" && Number.isFinite(payload[key])
          ? (payload[key] as number)
          : 0;
      return {
        input: total.input + number("inputTokens"),
        output: total.output + number("outputTokens"),
        cost: total.cost + number("costUsd"),
        latency: total.latency + number("latencyMs"),
        records: total.records + 1,
      };
    },
    { input: 0, output: 0, cost: 0, latency: 0, records: 0 },
  );
  const endTime = terminalStatuses.has(status) ? snapshot?.updatedAt : undefined;
  const duration = usage.latency > 0
    ? usage.latency < 1_000
      ? `${Math.round(usage.latency)}ms`
      : `${(usage.latency / 1_000).toFixed(1)}s`
    : formatDuration(snapshot?.createdAt, endTime);

  return {
    events,
    model,
    reason,
    duration,
    cost: usage.records === 0 ? null : usage.cost === 0 ? "$0.00" : `$${usage.cost.toFixed(4)}`,
    inputTokens: usage.input,
    outputTokens: usage.output,
  };
}

function TracePanel({
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
          <section className="route-summary">
            <div className="route-model">
              <span className="route-model-icon"><Cpu weight="fill" /></span>
              <span>
                <small>{summary.model ? "Selected model" : "Routing"}</small>
                <strong>{summary.model || "Route pending"}</strong>
              </span>
            </div>
            <p>{shortText(routeReasonLabel(summary.reason), 100)}</p>
          </section>

          <div className="metric-grid">
            <div>
              <Clock />
              <span>Latency</span>
              <strong>{summary.duration}</strong>
            </div>
            <div>
              <Code />
              <span>Tokens</span>
              <strong>{summary.inputTokens + summary.outputTokens}</strong>
            </div>
            <div>
              <Coins />
              <span>Cost</span>
              <strong>{summary.cost || "—"}</strong>
            </div>
          </div>

          <section className="workspace-summary">
            <span>Workspace</span>
            <strong title={snapshot.workspaceRoot}>{workspaceName(snapshot.workspaceRoot)}</strong>
            <small>{snapshot.workspaceRoot || "No workspace selected"}</small>
          </section>

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
        </>
      )}
    </aside>
  );
}

function StatusBar({ snapshot }: { snapshot: SoarSessionSnapshot | null }) {
  const summary = useMemo(() => summarizeRun(snapshot), [snapshot]);
  const status = normalizeStatus(snapshot?.status);
  const statusLabel = !snapshot
    ? "Runtime checked when a task starts"
    : status === "running" || status === "queued"
      ? "Agent working"
      : status === "completed"
        ? "Run completed"
        : status === "failed" || status === "error"
          ? "Run failed"
          : status === "cancelled"
            ? "Run stopped"
            : status === "interrupted"
              ? "Run interrupted"
              : "Run not started";

  return (
    <footer className="statusbar" aria-label="Runtime status">
      <span className="statusbar-connection">
        <span className={`runtime-dot ${status === "running" ? "is-working" : ""}`} aria-hidden="true" />
        {statusLabel}
      </span>
      <span className="statusbar-session">
        <span data-testid="route-model">{summary.model || (snapshot ? "Route pending" : "No active run")}</span>
        <span aria-hidden="true">·</span>
        <span>{summary.model ? "Local" : "Idle"}</span>
        <span aria-hidden="true">·</span>
        <span data-testid="route-cost">{summary.cost || "—"}</span>
      </span>
    </footer>
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const compactLayout = useMediaQuery("(max-width: 880px)");
  const selectedIdRef = useRef<string | null>(null);
  const latestAssistantStartRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const upsertSummary = useCallback((incoming: SoarSessionSnapshot) => {
    setSessions((current) => {
      const summary: SoarSessionSummary = {
        id: incoming.id,
        title: incoming.title,
        status: incoming.status,
        createdAt: incoming.createdAt,
        updatedAt: incoming.updatedAt,
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
        if (update.sessionId === selectedIdRef.current) {
          const latestEvent = [...(update.snapshot.events || [])].sort(
            (a, b) => (b.sequence || 0) - (a.sequence || 0),
          )[0];
          if (
            latestEvent?.type === "assistant.message.started" &&
            latestAssistantStartRef.current !== latestEvent.id
          ) {
            latestAssistantStartRef.current = latestEvent.id;
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
      return;
    }
    let active = true;
    setLoadingSession(true);
    setStreamedText("");
    latestAssistantStartRef.current = null;
    void window.soar
      .getSession(selectedId)
      .then((value) => {
        if (!active) return;
        setSnapshot(value);
        if (value.workspaceRoot) {
          setWorkspace({ path: value.workspaceRoot, name: workspaceName(value.workspaceRoot) });
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

  const chooseWorkspace = useCallback(async () => {
    setError(null);
    try {
      const choice = await window.soar.chooseWorkspace();
      if (choice) setWorkspace(choice);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The workspace picker could not open.");
    }
  }, []);

  const startNewSession = useCallback(async () => {
    if (!task.trim() || !workspace || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await window.soar.createSession({
        task: task.trim(),
        workspaceRoot: workspace.path,
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
    setSidebarOpen(false);
  }, []);

  const selectSession = useCallback((id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setSidebarOpen(false);
    setError(null);
  }, []);

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
  const running = status === "running" || status === "queued";
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
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main-workspace">
        <header className={`task-header ${snapshot ? "has-session" : "is-empty"}`}>
          <button
            className="icon-button session-menu-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sessions"
          >
            <SidebarSimple />
          </button>
          <div className="task-heading">
            {snapshot ? (
              <>
                <strong>{snapshot.title || "Untitled task"}</strong>
                <span>{workspaceName(snapshot.workspaceRoot)}</span>
              </>
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

        <section className="conversation-panel">
          <Transcript
            snapshot={snapshot}
            streamedText={streamedText}
            loading={loadingSession}
            onPromptSelect={setTask}
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
