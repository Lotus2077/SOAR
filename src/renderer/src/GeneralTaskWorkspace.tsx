import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { Files } from "@phosphor-icons/react/dist/csr/Files";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { Pause } from "@phosphor-icons/react/dist/csr/Pause";
import { Play } from "@phosphor-icons/react/dist/csr/Play";
import { Stop } from "@phosphor-icons/react/dist/csr/Stop";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  GENERAL_TASK_REVIEW_DELIVERABLES,
  GENERAL_TASK_REVIEW_OUTPUT_NAME,
  GeneralTaskCreateInputSchema,
  GeneralTaskVerdictInputSchema,
  type GeneralTaskArtifact,
  type GeneralTaskArtifactPreview,
  type GeneralTaskAvailability,
  type GeneralTaskConsultationPreview,
  type GeneralTaskConsultationSummary,
  type GeneralTaskRouting,
  type GeneralTaskInputSelection,
  type GeneralTaskResearch,
  type GeneralTaskResearchStage,
  type GeneralTaskSnapshot,
  type SoarGeneralTaskApi,
} from "../../shared/general-task-contracts";
import "./general-task.css";

function hasApi(value: unknown): value is SoarGeneralTaskApi {
  const methods: (keyof SoarGeneralTaskApi)[] = ["getGeneralTaskAvailability", "chooseGeneralTaskInputs", "createGeneralTask", "listGeneralTasks", "getGeneralTask", "startGeneralTask", "pauseGeneralTask", "resumeGeneralTask", "cancelGeneralTask", "readGeneralTaskArtifact", "exportGeneralTaskArtifact", "subscribeGeneralTasks"];
  return !!value && methods.every(key => typeof (value as Partial<SoarGeneralTaskApi>)[key] === "function");
}
const statuses: Record<GeneralTaskSnapshot["status"], string> = {
  queued: "Ready to start", running: "Working", paused: "Paused", submitted: "Submitted for review", incomplete: "Incomplete", cancelled: "Cancelled",
};
function title(task: GeneralTaskSnapshot) { const line = task.goal.split("\n")[0]; return line.length > 75 ? `${line.slice(0, 75)}…` : line; }
// Backlog item 13a: a local research task's deliverable is a document the claims check can read.
const RESEARCH_DOCUMENT = /\.(md|markdown|txt|html?|docx|pdf)$/iu;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const STAGE_NAMES: Record<GeneralTaskResearchStage["stage"], string> = { index: "Index", plan: "Plan", extract: "Extraction", synthesise: "Synthesis" };
/** The research badge's stage words. A packet with a disclosed gap names how many passages were not resolved, as the writer is told to state it. */
function researchState(research: GeneralTaskResearch): string {
  if (research.stage === "transferred") return research.gap ? `packet ready, with a disclosed gap (${plural(research.gap.chunks, "passage")} not resolved)` : "packet ready";
  return research.stage === "running" ? "reading the sources" : research.stage === "stopped" ? "stopped before the writer" : "not started";
}
// Backlog item 13b: a document review takes exactly one .docx among its input files, as the host checks at creation.
const REVIEW_DOCUMENT = /\.docx$/iu;
/** The review badge's state, from the task's status alone; the deliverables list says which files exist. */
function reviewState(status: GeneralTaskSnapshot["status"]): string {
  return status === "queued" ? "not started" : status === "running" ? "reviewing" : status === "paused" ? "paused" : status === "submitted" ? "deliverables ready" : "stopped";
}
/** One stage's lines, from the counts it recorded and nothing else: no fixed sentence or constant stands in for a count. */
function researchStageLines(row: GeneralTaskResearchStage): string[] {
  const cut = row.truncatedReplies ? `, ${row.truncatedReplies} cut at the output limit` : "";
  const repairs = row.repairCalls ? `; ${plural(row.repairCalls, "repair")}${row.secondRepairCalls ? ` (${row.secondRepairCalls} second${row.secondRepairsComplete !== undefined ? `, ${row.secondRepairsComplete} completing their passage` : ""})` : ""}` : "";
  // A row the stage stopped in holds the calls that settled before the stop; its passage count is the value it was created with.
  if (row.denied) {
    const noun = row.stage === "plan" || row.stage === "synthesise" ? "attempt" : "call";
    return [`${STAGE_NAMES[row.stage]}: stopped ${row.calls ? `after ${plural(row.calls, noun)}` : `before any ${noun} was answered`}${cut}${repairs}.`];
  }
  if (row.stage === "index") return [`Index: ${plural(row.calls, "call")}${cut}.`];
  if (row.stage === "plan") return [`Plan: ${plural(row.calls, "attempt")}${cut}${row.fallback === "host_plan" ? "; none was accepted, so the host's plan was used" : ""}.`];
  if (row.stage === "synthesise") return [`Synthesis: ${plural(row.calls, "attempt")}${cut}${row.fallback === "skeleton" ? "; none was accepted, so the writer gets the evidence skeleton" : ""}.`];
  const read = row.chunksPlanned !== undefined && row.chunksComplete !== undefined ? `${row.chunksComplete} of ${plural(row.chunksPlanned, "source passage")} resolved` : plural(row.calls, "call");
  const gap = row.declaredGaps ? `; ${plural(row.declaredGaps, "passage")} not resolved after ${row.declaredGaps === 1 ? "its" : "their"} repairs, disclosed with the packet` : "";
  const lines = [`Extraction: ${read}${cut}${repairs}${gap}.`];
  // A held passage's first reply lost every quote of a question it marked answered; its repair is optional and comes last.
  if (row.heldChunks !== undefined && row.heldKeptUnrepaired !== undefined && row.heldChunks > 0) {
    const kept = row.heldKeptUnrepaired;
    lines.push(kept ? `${kept} of ${plural(row.heldChunks, "passage")} held for a repair kept ${kept === 1 ? "its" : "their"} first reading: the budget had no room for the optional repair.`
      : `${plural(row.heldChunks, "passage")} held for a repair; ${row.heldChunks === 1 ? "it" : "each"} got its optional repair.`);
  }
  if (row.quotesVerified !== undefined && row.quotesInPacket !== undefined) {
    const left = [row.quotesLeftByCap ? `${row.quotesLeftByCap} left out at the packet's caps${row.quotesLeftByPresentation ? ` (${row.quotesLeftByPresentation} by the presentation guard)` : ""}` : "",
      row.questionsTrimmed ? `${plural(row.questionsTrimmed, "question")} left without a quote in the packet` : ""].filter(Boolean);
    lines.push(`Evidence packet: ${row.quotesInPacket} of ${plural(row.quotesVerified, "verified quote")} kept${left.length ? `; ${left.join("; ")}` : ""}.`);
  }
  if (row.conflictsNoted && row.conflictsInPacket !== undefined) lines.push(`Conflicts: ${row.conflictsInPacket} of ${plural(row.conflictsNoted, "noted conflict")} in the packet.`);
  return lines;
}
function size(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function duration(ms: number) { const seconds = Math.floor(ms / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
function money(value: number) { return Number.isSafeInteger(value) && value >= 0 ? `USD ${Math.floor(value / 1000000)}.${String(value % 1000000).padStart(6, "0")}` : "Unavailable"; }
function matchesConsultation(value: GeneralTaskConsultationPreview, summary: GeneralTaskConsultationSummary): boolean {
  const hash = (text: unknown) => typeof text === "string" && /^[a-f0-9]{64}$/u.test(text);
  return value.proposalId === summary.proposalId && value.proposalSha256 === summary.proposalSha256 && value.state === summary.state
    && value.model === summary.model && value.maxFeeMicrousd === summary.maxFeeMicrousd
    && [value.packetSha256, value.contextSha256, value.checkpointSha256, value.profileSha256].every(hash)
    && typeof value.packet === "string" && new TextEncoder().encode(value.packet).length <= 1024 * 1024
    && Number.isSafeInteger(value.expiresAt) && value.expiresAt > 0
    && Number.isSafeInteger(value.maxFeeMicrousd) && value.maxFeeMicrousd >= 0
    && Number.isSafeInteger(value.maxOutputTokens) && value.maxOutputTokens > 0
    && !!value.destination && [value.destination.id, value.destination.endpoint, value.destination.accountId].every(item => typeof item === "string" && item.length > 0)
    && Number.isSafeInteger(value.destination.credentialVersion) && value.destination.credentialVersion >= 0
    && !!value.prices && [value.prices.inputMicrousdPerMillion, value.prices.outputMicrousdPerMillion,
      ...(value.prices.cachedInputMicrousdPerMillion === undefined ? [] : [value.prices.cachedInputMicrousdPerMillion])].every(item => Number.isSafeInteger(item) && item >= 0)
    && [value.selectedPaths, value.omittedPaths].every(items => Array.isArray(items) && items.every(item => typeof item === "string"));
}

/** Artifact content is inert: no HTML, links, images, embedded frames or scripts. */
function ArtifactContent({ preview }: { preview: GeneralTaskArtifactPreview }) {
  if (preview.kind === "binary") return <p className="general-preview-empty">This file has no text preview. Export it to open it in its native application.</p>;
  return <>
    {preview.truncated && <p className="general-notice" role="note">This preview is truncated. Export the file for its complete contents.</p>}
    <div className="general-preview-body">
      {/\.md(?:own)?$|\.markdown$/iu.test(preview.path) ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
        allowedElements={["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "em", "del", "blockquote", "code", "pre", "hr", "br", "table", "thead", "tbody", "tr", "th", "td", "a"]}
        components={{ a: ({ children }) => <span>{children}</span> }}>
        {preview.text ?? ""}
      </ReactMarkdown> : <pre className="general-preview-text">{preview.text ?? ""}</pre>}
    </div>
  </>;
}

export function GeneralTaskWorkspace({ api: suppliedApi, newTaskRequest = 0, onNewTaskRequestHandled }: { api?: SoarGeneralTaskApi;
  /** A pending request from the shell (⌘N) to open a fresh task form; acknowledged through the callback so plain navigation still opens on the latest task. */
  newTaskRequest?: number; onNewTaskRequestHandled?: () => void }) {
  const candidate = suppliedApi ?? window.soar;
  const api = hasApi(candidate) ? candidate : null;
  const [availability, setAvailability] = useState<GeneralTaskAvailability | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(Boolean(api));
  const [tasks, setTasks] = useState<GeneralTaskSnapshot[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(Boolean(api));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<GeneralTaskInputSelection | null>(null);
  const [goal, setGoal] = useState("");
  const [outputName, setOutputName] = useState("report.md");
  const [attested, setAttested] = useState(false);
  const [sourceUrls, setSourceUrls] = useState("");
  const [dnsResolver, setDnsResolver] = useState<"system" | "cloudflare_v1">("system");
  const [retrievalAllowed, setRetrievalAllowed] = useState(false);
  const [routing, setRouting] = useState<GeneralTaskRouting>("local_only");
  const [profile, setProfile] = useState<"" | "standard" | "heavy">("");
  const [research, setResearch] = useState(false);
  const [review, setReview] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingTask, setLoadingTask] = useState(false);
  const [preview, setPreview] = useState<GeneralTaskArtifactPreview | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [consultationPreview, setConsultationPreview] = useState<{ id: string; value: GeneralTaskConsultationPreview } | null>(null);
  const [loadingConsultation, setLoadingConsultation] = useState(false);
  const [previewTime, setPreviewTime] = useState(Date.now);
  // The owner's verdict form: a decision, whole-number effort fields and the export declaration. No free text.
  const [verdictDecision, setVerdictDecision] = useState<"" | "accept" | "reject">("");
  const [verdictMinutes, setVerdictMinutes] = useState("");
  const [verdictInterventions, setVerdictInterventions] = useState("");
  const [verdictExported, setVerdictExported] = useState(false);
  const mounted = useRef(true), busy = useRef(false);
  const selected = useRef<string | null>(null);
  const selectionEpoch = useRef(0), availabilityEpoch = useRef(0), previewEpoch = useRef(0);
  const consultationEpoch = useRef(0);
  const currentTasks = useRef(new Map<string, GeneralTaskSnapshot>());

  const accept = useCallback((snapshot: GeneralTaskSnapshot) => {
    if (!mounted.current) return;
    const previous = currentTasks.current.get(snapshot.id);
    if (previous && previous.revision > snapshot.revision) return;
    if (previous && previous.revision === snapshot.revision) {
      // Polling may advance elapsed time or expire a resume allowance without a new event.
      const elapsedMs = Math.max(previous.elapsedMs, snapshot.elapsedMs);
      const canResume = previous.canResume && snapshot.canResume;
      if (elapsedMs === previous.elapsedMs && canResume === previous.canResume) return;
      currentTasks.current.set(snapshot.id, { ...previous, elapsedMs, canResume });
    } else currentTasks.current.set(snapshot.id, snapshot);
    setTasks([...currentTasks.current.values()].sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);
  const resetPreview = useCallback(() => {
    previewEpoch.current += 1;
    setPreview(null); setPreviewPath(null); setLoadingPreview(false);
  }, []);
  const resetConsultation = useCallback(() => {
    consultationEpoch.current += 1; setConsultationPreview(null); setLoadingConsultation(false);
  }, []);
  const resetVerdict = useCallback(() => {
    setVerdictDecision(""); setVerdictMinutes(""); setVerdictInterventions(""); setVerdictExported(false);
  }, []);
  // Backlog item 13a: the research option is on only while the host offers it. Every availability the view takes that does not offer it
  // unticks the box, so a later check that withdraws it frees the form, and a check that offers it again does not tick it by itself.
  // Backlog item 13b: the document review option follows the same rule.
  const refreshAvailability = useCallback(async () => {
    if (!api) return;
    const epoch = ++availabilityEpoch.current;
    setCheckingAvailability(true);
    try {
      const next = await api.getGeneralTaskAvailability();
      if (mounted.current && availabilityEpoch.current === epoch) {
        setAvailability(next); if (next.research?.available !== true) setResearch(false); if (next.review?.available !== true) setReview(false);
      }
    } catch {
      if (mounted.current && availabilityEpoch.current === epoch) {
        setAvailability(null); setResearch(false); setReview(false); setError("Task availability could not be checked. Try checking again.");
      }
    } finally { if (mounted.current && availabilityEpoch.current === epoch) setCheckingAvailability(false); }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    if (!api) return () => { mounted.current = false; };
    let active = true;
    void refreshAvailability();
    const unsubscribe = api.subscribeGeneralTasks(accept);
    setLoadingHistory(true);
    void api.listGeneralTasks().then(history => {
      if (!active) return;
      history.forEach(accept);
      if (selectionEpoch.current === 0 && selected.current === null) {
        const latest = [...currentTasks.current.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (latest) { selected.current = latest.id; setSelectedId(latest.id); }
      }
    }).catch(() => { if (active) setError("Saved tasks could not be loaded. Reopen General task to try again."); })
      .finally(() => { if (active) setLoadingHistory(false); });
    return () => { active = false; mounted.current = false; availabilityEpoch.current += 1; previewEpoch.current += 1; consultationEpoch.current += 1; unsubscribe(); };
  }, [api, accept, refreshAvailability]);

  const task = tasks.find(item => item.id === selectedId);
  useEffect(() => {
    if (preview && (preview.id !== task?.id || task.status === "running" || !task.cleanupConfirmed || !task.artifacts.some(file => file.path === preview.path && file.sha256 === preview.sha256))) resetPreview();
  }, [task, preview, resetPreview]);
  useEffect(() => {
    if (!consultationPreview) return;
    if (consultationPreview.id !== task?.id || !task.consultation || !matchesConsultation(consultationPreview.value, task.consultation)) {
      resetConsultation(); return;
    }
    const remaining = consultationPreview.value.expiresAt - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setPreviewTime(Date.now()), Math.min(2147483647, remaining));
    return () => clearTimeout(timer);
  }, [task, consultationPreview, resetConsultation]);

  const newTask = () => {
    selectionEpoch.current += 1; selected.current = null; setSelectedId(null); setLoadingTask(false);
    setError(null); setNotice(null); resetPreview(); resetConsultation(); resetVerdict();
  };
  // Runs during mount too, before the history load can auto-select the latest task.
  useEffect(() => { if (newTaskRequest) { newTask(); onNewTaskRequestHandled?.(); } }, [newTaskRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectTask = async (id: string) => {
    if (!api) return;
    const epoch = ++selectionEpoch.current;
    selected.current = id; setSelectedId(id); setLoadingTask(true); setError(null); setNotice(null); resetPreview(); resetConsultation(); resetVerdict();
    try { const value = await api.getGeneralTask(id); if (mounted.current && epoch === selectionEpoch.current) accept(value); }
    catch { if (mounted.current && epoch === selectionEpoch.current) setError("This task could not be refreshed. Its last saved state is shown."); }
    finally { if (mounted.current && epoch === selectionEpoch.current) setLoadingTask(false); }
  };
  const chooseInputs = async () => {
    if (!api || busy.current) return;
    busy.current = true; setAction("choose"); setError(null);
    // Backlog item 13b: a review's picker asks for the document to review, not for public or synthetic files.
    try { const value = await (review ? api.chooseGeneralTaskInputs({ review: true }) : api.chooseGeneralTaskInputs()); if (mounted.current && value) { setSelection(value); setAttested(false); } }
    catch { if (mounted.current) setError("Files could not be selected. Try opening the file picker again."); }
    finally { busy.current = false; if (mounted.current) setAction(null); }
  };
  const urls = sourceUrls.split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
  // Backlog item 13b: a document review carries no public-or-synthetic declaration, and its output name is fixed to the summary E6 graded.
  const createInput = {
    goal, outputName: review ? GENERAL_TASK_REVIEW_OUTPUT_NAME : outputName, ...(review ? {} : { publicOrSynthetic: attested }),
    ...(profile ? { profile } : {}),
    ...(routing === "ask_before_consulting" ? { routing } : {}),
    ...(selection ? { inputSelectionId: selection.id } : {}),
    ...(urls.length ? { publicSources: { urls, dnsResolver, allowPublicRetrieval: retrievalAllowed } } : {}),
    ...(research ? { research: "local_beta" as const } : {}),
    ...(review ? { review: "local_beta" as const } : {}),
  };
  const startNew = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!api || busy.current || !availability?.available || checkingAvailability || (routing === "ask_before_consulting" && !availability.consultation?.available)) return;
    const input = GeneralTaskCreateInputSchema.safeParse(createInput);
    if (!input.success) { setError(review ? "Enter a goal, and choose exactly one .docx file to review." : "Enter a goal and valid output filename, confirm the public or synthetic declaration, and check any public URLs and retrieval permission."); return; }
    busy.current = true; setAction("create"); setError(null); setNotice(null);
    let saved = false;
    try {
      const created = await api.createGeneralTask(input.data); saved = true;
      if (!mounted.current) return;
      accept(created); selectionEpoch.current += 1; selected.current = created.id; setSelectedId(created.id); resetPreview();
      setGoal(""); setSelection(null); setAttested(false); setOutputName("report.md");
      setSourceUrls(""); setDnsResolver("system"); setRetrievalAllowed(false);
      setRouting("local_only"); setResearch(false); setReview(false); resetConsultation();
      const started = await api.startGeneralTask(created.id); accept(started);
    } catch { if (mounted.current) setError(saved ? "The task was saved but could not start. Use Start task to try starting this saved task." : "The task could not be created. Check your inputs and try again."); }
    finally { busy.current = false; if (mounted.current) setAction(null); }
  };
  const control = async (kind: "start" | "pause" | "resume" | "cancel" | "retryCleanup") => {
    if (!api || !task || busy.current) return;
    if (kind === "resume" && ["pending", "dispatching", "uncertain"].includes(task.consultation?.state ?? "")) return;
    const id = task.id;
    busy.current = true; setAction(kind); setError(null); setNotice(null);
    try {
      const value = await ({ start: api.startGeneralTask, pause: api.pauseGeneralTask, resume: api.resumeGeneralTask, cancel: api.cancelGeneralTask, retryCleanup: api.cancelGeneralTask })[kind].call(api, id);
      accept(value);
      if (mounted.current && selected.current === id && kind === "pause" && value.status === "running") setNotice("Pause requested. The current action must settle and cleanup must finish first.");
    } catch { if (mounted.current && selected.current === id) setError(kind === "retryCleanup" ? "Cleanup could not be retried. The task remains cancelled; refresh its saved state and try again." : `The task could not ${kind}. Its last received state is shown; no replacement task was created.`); }
    finally { busy.current = false; if (mounted.current) setAction(null); }
  };
  const readConsultation = async () => {
    if (!api || !task?.consultation || busy.current || typeof api.previewGeneralTaskConsultation !== "function") return;
    const ref = { id: task.id, proposalId: task.consultation.proposalId, proposalSha256: task.consultation.proposalSha256 };
    const epoch = ++consultationEpoch.current;
    setConsultationPreview(null); setLoadingConsultation(true); setError(null);
    try {
      const value = await api.previewGeneralTaskConsultation(ref), current = currentTasks.current.get(ref.id);
      if (!mounted.current || epoch !== consultationEpoch.current || selected.current !== ref.id) return;
      if (!current?.consultation || !matchesConsultation(value, current.consultation)) {
        setError("The consultation changed or expired. Review the current proposal before deciding."); return;
      }
      setPreviewTime(Date.now()); setConsultationPreview({ id: ref.id, value });
    } catch { if (mounted.current && epoch === consultationEpoch.current) setError("The exact consultation preview is unavailable. No approval was recorded."); }
    finally { if (mounted.current && epoch === consultationEpoch.current) setLoadingConsultation(false); }
  };
  const decideConsultation = async (decision: "approve" | "decline" | "revoke") => {
    if (!api || !task?.consultation || busy.current || typeof api.decideGeneralTaskConsultation !== "function") return;
    const current = currentTasks.current.get(task.id), summary = current?.consultation;
    if (!summary || summary.proposalId !== task.consultation.proposalId || summary.proposalSha256 !== task.consultation.proposalSha256) return;
    if (decision !== "revoke" && (current.status === "running" || !current.cleanupConfirmed)) return;
    if (decision === "approve" && (summary.state !== "pending" || consultationPreview?.id !== task.id || !matchesConsultation(consultationPreview.value, summary) || consultationPreview.value.expiresAt <= Date.now())) return;
    if (decision === "decline" && summary.state !== "pending") return;
    if (decision === "revoke" && !["approved", "dispatching"].includes(summary.state)) return;
    const ref = { id: task.id, proposalId: summary.proposalId, proposalSha256: summary.proposalSha256, decision };
    busy.current = true; setAction("consultation"); setError(null); setNotice(null);
    try {
      const snapshot = await api.decideGeneralTaskConsultation(ref);
      if (snapshot.id !== ref.id) throw new Error("wrong_task");
      accept(snapshot); resetConsultation();
      if (mounted.current && selected.current === ref.id) setNotice(snapshot.consultation?.state === "uncertain"
        ? "The consultation outcome is uncertain. Data already sent cannot be recalled; this task cannot resume."
        : "Decision saved. Use Resume task to continue within the existing allowance. No request was started by this decision.");
    } catch { if (mounted.current && selected.current === ref.id) { resetConsultation(); setError("The decision could not be verified. Refresh the task and review its current proposal before trying again."); } }
    finally { busy.current = false; if (mounted.current) setAction(null); }
  };
  const readArtifact = async (file: GeneralTaskArtifact) => {
    if (!api || !task || task.status === "running" || !task.cleanupConfirmed) return;
    const ref = { id: task.id, path: file.path, sha256: file.sha256 }, epoch = ++previewEpoch.current;
    setPreview(null); setPreviewPath(file.path); setLoadingPreview(true); setError(null);
    try {
      const value = await api.readGeneralTaskArtifact(ref);
      if (!mounted.current || epoch !== previewEpoch.current || selected.current !== ref.id) return;
      const current = currentTasks.current.get(ref.id);
      const stillCurrent = current?.status !== "running" && current?.cleanupConfirmed && current.artifacts.some(item => item.path === ref.path && item.sha256 === ref.sha256);
      if (!stillCurrent || value.id !== ref.id || value.path !== ref.path || value.sha256 !== ref.sha256 || value.bytes !== file.bytes ||
        (value.kind === "text" ? typeof value.text !== "string" : value.kind !== "binary" || value.text !== null)) {
        setError("The artifact changed or its preview could not be verified. Select the current artifact again."); return;
      }
      setPreview(value);
    } catch { if (mounted.current && epoch === previewEpoch.current) setError("This artifact could not be previewed. Try selecting it again."); }
    finally { if (mounted.current && epoch === previewEpoch.current) setLoadingPreview(false); }
  };
  const exportArtifact = async (file: GeneralTaskArtifact) => {
    if (!api || !task || busy.current || task.status === "running" || !task.cleanupConfirmed) return;
    const ref = { id: task.id, path: file.path, sha256: file.sha256 };
    busy.current = true; setAction("export"); setError(null); setNotice(null);
    try { const value = await api.exportGeneralTaskArtifact(ref); if (mounted.current && selected.current === ref.id) setNotice(value.exported ? "Artifact exported." : "Export cancelled."); }
    catch { if (mounted.current && selected.current === ref.id) setError("The artifact could not be exported. Try the native save dialog again."); }
    finally { busy.current = false; if (mounted.current) setAction(null); }
  };
  const exportBundle = async () => {
    if (!api || !task?.bundle || busy.current || typeof api.exportGeneralTaskBundle !== "function") return;
    const current = currentTasks.current.get(task.id);
    if (!current || current.status === "running" || !current.cleanupConfirmed ||
      current.bundle?.manifestSha256 !== task.bundle.manifestSha256) return;
    const ref = { id: task.id, manifestSha256: task.bundle.manifestSha256 };
    busy.current = true; setAction("export-bundle"); setError(null); setNotice(null);
    try {
      const value = await api.exportGeneralTaskBundle(ref);
      if (mounted.current && selected.current === ref.id) setNotice(value.exported ? "ZIP bundle exported." : "ZIP export cancelled.");
    } catch { if (mounted.current && selected.current === ref.id) setError("The ZIP bundle could not be exported. Refresh the task and try the native save dialog again."); }
    finally { busy.current = false; if (mounted.current) setAction(null); }
  };
  const verdictInput = task ? { id: task.id, ...(verdictDecision ? { decision: verdictDecision } : {}),
    ...(verdictMinutes.trim() ? { ownerMinutes: Number(verdictMinutes) } : {}), ...(verdictInterventions.trim() ? { interventions: Number(verdictInterventions) } : {}),
    exportedThroughApp: verdictExported } : null;
  const validVerdict = verdictInput !== null && GeneralTaskVerdictInputSchema.safeParse(verdictInput).success;
  const recordVerdict = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!api || !task || busy.current || typeof api.recordGeneralTaskVerdict !== "function" || task.status !== "submitted" || task.verdict) return;
    const parsed = GeneralTaskVerdictInputSchema.safeParse(verdictInput);
    if (!parsed.success) { setError("Choose Accept or Reject, then enter your minutes (0 to 600) and interventions (0 to 99)."); return; }
    const id = task.id;
    busy.current = true; setAction("verdict"); setError(null); setNotice(null);
    try {
      const value = await api.recordGeneralTaskVerdict(parsed.data);
      if (value.id !== id) throw new Error("wrong_task");
      accept(value);
      if (mounted.current && selected.current === id) { resetVerdict(); setNotice("Verdict recorded. Export the verdict receipt to write its registry row."); }
    } catch { if (mounted.current && selected.current === id) setError("The verdict could not be recorded. Refresh the task: a verdict is accepted once, on a submitted task."); }
    finally { busy.current = false; if (mounted.current) setAction(null); }
  };
  const exportVerdictReceipt = async () => {
    if (!api || !task?.verdict || busy.current || typeof api.exportGeneralTaskVerdictReceipt !== "function") return;
    const id = task.id;
    busy.current = true; setAction("export-receipt"); setError(null); setNotice(null);
    try { const value = await api.exportGeneralTaskVerdictReceipt(id); if (mounted.current && selected.current === id) setNotice(value.exported ? "Verdict receipt exported." : "Receipt export cancelled."); }
    catch { if (mounted.current && selected.current === id) setError("The verdict receipt could not be exported. Try the native save dialog again."); }
    finally { busy.current = false; if (mounted.current) setAction(null); }
  };
  const validOutputName = GeneralTaskCreateInputSchema.shape.outputName.safeParse(outputName).success;
  const validSources = !urls.length || GeneralTaskCreateInputSchema.shape.publicSources.safeParse({ urls, dnsResolver, allowPublicRetrieval: true }).success;
  const validInput = GeneralTaskCreateInputSchema.safeParse(createInput).success && (routing === "local_only" || availability?.consultation?.available === true) &&
    // Backlog item 13a: a research task reads at least one input file and writes a document; the controller refuses anything else.
    (!research || selection !== null && RESEARCH_DOCUMENT.test(outputName)) &&
    // Backlog item 13b: a review takes exactly one .docx among its input files; any other file is context.
    (!review || selection !== null && selection.files.filter(file => REVIEW_DOCUMENT.test(file.path)).length === 1);
  const consultation = task?.consultation;
  const verifiedConsultation = consultationPreview && consultationPreview.id === task?.id && consultation && matchesConsultation(consultationPreview.value, consultation) ? consultationPreview.value : null;
  return <div className="general-workspace">
    <div className="general-topline"><div><h1>General task</h1><p>Describe a goal and create a deliverable.</p></div>
      <button className="general-button" disabled={action === "create"} onClick={newTask}><Files aria-hidden="true" />New general task</button></div>
    {error && <div className="general-notice general-error" role="alert"><WarningCircle aria-hidden="true" /><span>{error}</span></div>}
    {notice && <p className="general-notice" role="status">{notice}</p>}
    <div className="general-layout">
      <aside className="general-history" aria-label="Saved general tasks"><h2>Your tasks</h2>
        {loadingHistory ? <p role="status">Loading saved tasks…</p> : !tasks.length ? <p>No tasks yet. Your progress and artifacts will appear here.</p> : null}
        <ul className="general-history-list">{tasks.map(item => <li key={item.id}><button disabled={action === "create"} onClick={() => void selectTask(item.id)} aria-current={selectedId === item.id ? "true" : undefined}>
          <strong>{title(item)}</strong><small>{statuses[item.status]} · {item.modelCalls} model attempts{item.research ? " · local research" : ""}{item.review ? " · document review" : ""}</small>
        </button></li>)}</ul>
      </aside>
      <div className="general-main">
        <div className="general-readiness" aria-label="General task availability">
          <strong>{!api ? "General tasks are unavailable in this build" : checkingAvailability ? "Checking task runtime…" : availability?.available ? "Ready for a general task" : "Task runtime unavailable"}</strong>
          {availability?.reason && <p>{availability.reason}</p>}
          {/* Backlog item 13b: a document review, ticked in the form or the task shown, declares nothing public or synthetic and retrieves nothing. */}
          <p>{(selectedId ? task?.review : review) ? "A document review sends your goal and its files to the configured owned model server, which may be on another machine, by your waiver: it declares nothing public or synthetic. Sandbox tools stay offline; a review permits no public retrieval."
            : "Your public or synthetic goal and any files go to the configured owned model server, which may be on another machine. Sandbox tools stay offline; public retrieval is limited to explicitly permitted GET requests."}</p>
          {availability?.executionMode === "scripted" && <p role="note"><strong>Scripted test — app mechanics only.</strong> Predetermined actions do not demonstrate model quality.</p>}
          {api && <button className="general-button general-button-quiet" disabled={checkingAvailability || !!action} onClick={() => void refreshAvailability()}>Check availability again</button>}
        </div>
        {!selectedId ? <form className="general-form" aria-label="New general task" onSubmit={startNew}>
          <h2>What would you like to make?</h2>
          <label className="general-field"><span>Task goal</span><textarea value={goal} maxLength={16000} disabled={!!action} placeholder="Describe the result you need. Add files or public sources below if useful." onChange={event => { setGoal(event.target.value); setAttested(false); }} /></label>
          <label className="general-field"><span id="general-consultation-label">Consultation mode</span><select value={routing} disabled={!!action || research || review} onChange={event => setRouting(event.target.value as GeneralTaskRouting)} aria-labelledby="general-consultation-label" aria-describedby="general-consultation-hint">
            <option value="local_only">Local only</option><option value="ask_before_consulting" disabled={!availability?.consultation?.available}>Ask before consulting</option>
          </select><small id="general-consultation-hint">{availability?.consultation?.available
            ? routing === "ask_before_consulting" ? `The local coordinator may pause once to ask ${availability.consultation.model ?? "the configured consultant"}. You must review its exact packet and charge, approve, then Resume. No automatic consultation.` : "Use only the owned local model. No consultant packet or charge will be proposed."
            : availability?.consultation?.reason ?? "Consultation is unavailable. Configure an explicit host consultant profile to enable it; local-only tasks remain available."}</small></label>
          <div className="general-field"><span>Input files (optional)</span><div className="general-actions">
            <button type="button" className="general-button" disabled={!api || !!action} onClick={() => void chooseInputs()}><FolderOpen aria-hidden="true" />{action === "choose" ? "Opening picker…" : selection ? "Change files" : "Choose files"}</button>
            {selection && <button type="button" className="general-button general-button-quiet" disabled={!!action} onClick={() => { setSelection(null); setAttested(false); }}>Clear files</button>}
          </div>{selection ? <ul className="general-selected-files" aria-label="Selected input files">{selection.files.map(file => <li className="general-file-row" key={file.path}><span>{file.name}</span><small>{size(file.bytes)}</small></li>)}</ul> : <small>No files selected. You can start from a goal alone. Selected originals stay unchanged.</small>}</div>
          {availability?.research ? <div className="general-field general-research-option">
            <label className="general-ack"><input type="checkbox" checked={research} disabled={!!action || !availability.research.available || review} aria-describedby="general-research-hint"
              onChange={event => { const on = event.target.checked; setResearch(on); setAttested(false); if (on) { setProfile(""); setRouting("local_only"); setSourceUrls(""); setRetrievalAllowed(false); } }} />
              <span>Local research first (beta): the local model reads every input file in full and builds a cited evidence packet before the writer starts.</span></label>
            <small id="general-research-hint">{availability.research.reason}{availability.research.card ? ` Serving card of ${availability.research.card.date}.` : ""}{research
              ? " Heavy profile and local only, with at least one text input file and a document deliverable (.md, .txt, .html, .docx or .pdf). Pausing or quitting while the research stage runs ends the task." : ""}</small>
          </div> : null}
          {/* Backlog item 13b: the document review option, offered only while the host offers it; never beside research. */}
          {availability?.review ? <div className="general-field general-review-option">
            <label className="general-ack"><input type="checkbox" checked={review} disabled={!!action || !availability.review.available || research} aria-describedby="general-review-hint"
              onChange={event => { const on = event.target.checked; setReview(on); setAttested(false); if (on) { setProfile(""); setRouting("local_only"); setSourceUrls(""); setRetrievalAllowed(false); } }} />
              <span>Review one document (beta): the local model reviews one .docx in a single sample and writes a summary, an edit plan, a redline, a clean copy, an issues list and a hygiene report.</span></label>
            <small id="general-review-hint">{availability.review.reason}{review
              ? ` Heavy profile and local only, with exactly one .docx among the input files; any other file you add is context. The summary is ${GENERAL_TASK_REVIEW_OUTPUT_NAME}. You make no public-or-synthetic declaration for a review.` : ""}</small>
          </div> : null}
          <div className="general-public-inputs">
            <label className="general-field"><span id="general-sources-label">Public source URLs (optional)</span><textarea aria-labelledby="general-sources-label" className="general-source-urls" value={sourceUrls} maxLength={6146} disabled={!!action || research || review} aria-invalid={!validSources} aria-describedby="general-source-hint" placeholder="https://example.org/source" onChange={event => { setSourceUrls(event.target.value); setRetrievalAllowed(false); setAttested(false); }} /><small id="general-source-hint">{validSources ? "Up to three exact HTTPS URLs, one per line. Paths and queries are included. URLs in the goal do not grant network permission." : "Use one to three distinct public HTTPS URLs, with no credentials or fragments. Check each complete address."}</small></label>
            {urls.length > 0 ? <>
              <label className="general-field"><span id="general-dns-label">Hostname lookup</span><select aria-labelledby="general-dns-label" value={dnsResolver} disabled={!!action} aria-describedby="general-dns-hint" onChange={event => { setDnsResolver(event.target.value as "system" | "cloudflare_v1"); setRetrievalAllowed(false); }}><option value="system">System resolver</option><option value="cloudflare_v1">Cloudflare public DNS</option></select><small id="general-dns-hint">{dnsResolver === "cloudflare_v1" ? "Cloudflare receives hostname lookups for these sources. Page requests go to the listed sites. This choice is saved with the task." : "Use the system's configured hostname resolver. This choice is saved with the task."}</small></label>
              <label className="general-ack"><input type="checkbox" checked={retrievalAllowed} disabled={!!action || !validSources} onChange={event => setRetrievalAllowed(event.target.checked)} /><span>Allow SOAR to retrieve only these public URLs through the host, with up to five GET attempts and 64 KiB per response. This permits no other browsing or publication.</span></label>
            </> : <p className="general-hint">No public retrieval will be permitted for this task.</p>}
          </div>
          {availability?.profiles?.length ? <label className="general-field"><span id="general-profile-label">Model profile</span>
            <select value={research || review ? "heavy" : profile} disabled={!!action || research || review} aria-labelledby="general-profile-label" onChange={event => setProfile(event.target.value as "" | "standard" | "heavy")}>
              <option value="">Default ({availability.profile ?? "heavy"})</option>{availability.profiles.map(name => <option key={name} value={name}>{name === "heavy" ? "heavy — thinking on, long outputs" : "standard — thinking off, short outputs"}</option>)}
            </select><small>The profile sets the model's thinking mode, output limit and the task's allowances. It is fixed once the task is created.</small></label> : null}
          <label className="general-field"><span id="general-output-label">Output filename</span><input value={review ? GENERAL_TASK_REVIEW_OUTPUT_NAME : outputName} maxLength={120} disabled={!!action || review} aria-labelledby="general-output-label" aria-invalid={!review && !validOutputName} aria-describedby="general-output-hint" onChange={event => { setOutputName(event.target.value); setAttested(false); }} /><small id="general-output-hint">{review ? `A review's summary is always ${GENERAL_TASK_REVIEW_OUTPUT_NAME}, beside its five other deliverables.` : validOutputName ? "A single filename, such as report.md or presentation.pptx." : "Use one filename starting with a letter or number, with no folders or '..'."}</small></label>
          {/* Backlog item 13b: a document review runs by the owner's waiver and declares nothing public or synthetic. */}
          {!review && <label className="general-ack"><input type="checkbox" checked={attested} disabled={!!action} onChange={event => setAttested(event.target.checked)} /><span>I confirm that my task goal, any selected files and source URLs contain only public or synthetic material. Real private data is not qualified for this pilot.</span></label>}
          <button className="general-button general-button-primary" type="submit" disabled={!api || !availability?.available || checkingAvailability || !!action || !validInput}><Play aria-hidden="true" />{action === "create" ? "Saving and starting…" : "Create and start task"}</button>
          {availability && <p className="general-hint">Up to {availability.limits.modelCalls} model attempts, {availability.limits.toolCalls} tool actions and {duration(availability.limits.elapsedMs)}. Submission still needs your review.</p>}
        </form> : task ? <article aria-label="Selected general task">
          <h2>{title(task)}</h2><p className="general-goal">{task.goal}</p>
          <div className="general-state" role="status">{task.status === "submitted" ? <CheckCircle aria-hidden="true" /> : <Clock aria-hidden="true" />}{statuses[task.status]}{loadingTask ? " · refreshing…" : ""}</div>
          {task.reason && <p className="general-hint">{task.reason.replaceAll("_", " ")}</p>}
          {task.profile && <p className="general-hint">Model profile: {task.profile}</p>}
          {task.research && <p className="general-badge" aria-label="Research route">Local research (beta) · serving card of {task.research.card.date} · {researchState(task.research)}</p>}
          {task.review && <p className="general-badge" aria-label="Review route">Document review (beta) · single sample · {reviewState(task.status)}</p>}
          {task.review && <section className="general-section general-review" aria-label="Review deliverables"><h3>Review deliverables</h3>
            <ul className="general-selected-files">{GENERAL_TASK_REVIEW_DELIVERABLES.map(item => <li className="general-file-row" key={item.path}><span>{item.label} · {item.path}</span>
              <small>{task.artifacts.some(file => file.path === item.path) ? "saved" : "not saved"}</small></li>)}</ul>
            <p className="general-hint">The host flags file stays in this task's record and is never exported; once the review is submitted, its flags show under reported issues.</p>
            <p className="general-hint">A review runs on your own model endpoint, by your waiver of the Tier O safeguards; SOAR gives the document no privacy protection.</p></section>}
          {task.research && <section className="general-section general-research" aria-label="Research stage"><h3>Research stage</h3>
            {task.research.stages.length ? <ul>{task.research.stages.flatMap(row => researchStageLines(row).map((line, i) => <li key={`${row.stage}-${i}`}>{line}</li>))}</ul>
              : <p className="general-hint">The research stage has recorded no work yet.</p>}
            {task.research.gap?.source !== undefined && <p className="general-hint">Disclosed gap: a passage of {task.research.gap.source} was not resolved after its repairs{task.research.gap.questions ? `, for ${plural(task.research.gap.questions, "research question")}` : ""}. The writer was told to state it as an unresolved limitation of this reading.</p>}
            <p className="general-hint">{plural(task.research.requests, "research request")} to the local model, counted apart from the model attempts.</p></section>}
          {task.status === "submitted" && task.reportedIssues?.length ? <section className="general-section general-issues" aria-label="Reported issues"><h3>Submitted with reported issues</h3>
            <p className="general-hint">Host-derived facts about this submission. They do not change its status; judge the deliverable with them in mind.</p>
            <ul>{task.reportedIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></section> : null}
          {(task.plan || task.finishSummary) && <section className="general-section" aria-label="What the agent did"><h3>What the agent did</h3>
            <p className="general-hint">Written by the local model. Untrusted: it is not evidence that the work is correct.</p>
            {task.plan && <><h4>Plan</h4><pre className="general-agent-text">{task.plan}</pre></>}
            {task.finishSummary && <><h4>Finish summary</h4><pre className="general-agent-text">{task.finishSummary}</pre></>}</section>}
          {task.entailment && <section className="general-section" aria-label="Claim judgements"><h3>Claim judgements</h3>
            <p className="general-hint">The host asked the local model, once per verified claim, whether the cited quote supports the sentence. Evidence, not acceptance. A quoted reason is the judge model's own words and is untrusted; an unquoted status is the host's.{task.entailment.truncated ? " The pass stopped early; some claims were not judged." : ""}</p>
            <dl className="general-metrics">{(["supported", "partial", "unsupported", "contradicted", "not_judged"] as const).map(key => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{task.entailment!.counts[key]}</dd></div>)}</dl>
            {task.entailment.claims.some(claim => claim.verdict !== "supported") && <ul className="general-claims">{task.entailment.claims.filter(claim => claim.verdict !== "supported").map(claim => <li key={claim.id}><strong>{claim.id}</strong> · {claim.verdict.replaceAll("_", " ")}{claim.reason ? claim.verdict === "not_judged" ? ` · ${claim.reason.replaceAll("_", " ")}` : <> · <span className="general-agent-text" title="The judge model's own words. Untrusted.">judge says: “{claim.reason}”</span></> : null}</li>)}</ul>}</section>}
          <dl className="general-metrics"><div><dt>Model attempts</dt><dd>{task.modelCalls}</dd></div><div><dt>Tool actions</dt><dd>{task.toolCalls}</dd></div><div><dt>Task time (includes approval wait)</dt><dd>{duration(task.elapsedMs)}</dd></div></dl>
          {task.fees && <dl className="general-metrics"><div><dt>Reserved fees</dt><dd>{money(task.fees.reservedMicrousd)}</dd></div><div><dt>Settled fees</dt><dd>{money(task.fees.settledMicrousd)}</dd></div></dl>}
          <section className="general-section general-consultation" aria-label="Task consultation"><h3>Consultation</h3>
            <p className="general-hint">{task.routing === "ask_before_consulting" ? "Ask before consulting · at most one proposal within this task's existing allowance." : "Local only · no consultant request is permitted."}</p>
            {consultation ? <>
              <p><strong>{consultation.model}</strong> · {consultation.state} · Maximum charge {money(consultation.maxFeeMicrousd)}{consultation.feeMicrousd !== undefined ? ` · Settled ${money(consultation.feeMicrousd)}` : ""}</p>
              {consultation.state === "pending" && <p className="general-hint">The request has not been sent. Review the exact packet before approving. Approval saves permission; Resume starts the next action.</p>}
              {consultation.state === "approved" && <p className="general-hint">Permission is saved. Choose Resume task to continue, or revoke before dispatch.</p>}
              {consultation.state === "dispatching" && <p className="general-notice" role="note">The request is being sent. Revocation can request cancellation, but data already disclosed cannot be recalled.</p>}
              {consultation.state === "uncertain" && <p className="general-notice" role="note">The request outcome is uncertain. Any recorded reservation remains; this attempt cannot be replayed. Data already sent cannot be recalled.</p>}
              {consultation.state === "settled" && <p className="general-hint">Consultant feedback is untrusted advice. It does not establish artifact correctness or independent acceptance.</p>}
              <div className="general-actions">
                {<button className="general-button" disabled={!!action || loadingConsultation || typeof api?.previewGeneralTaskConsultation !== "function"} onClick={() => void readConsultation()}>{loadingConsultation ? "Loading exact packet…" : "Review consultation packet"}</button>}
                {consultation.state === "pending" && <>
                  <button className="general-button general-button-primary" disabled={!!action || task.status === "running" || !task.cleanupConfirmed || !verifiedConsultation || verifiedConsultation.expiresAt <= Math.max(previewTime, Date.now())} onClick={() => void decideConsultation("approve")}>Approve exact consultation</button>
                  <button className="general-button" disabled={!!action || task.status === "running" || !task.cleanupConfirmed} onClick={() => void decideConsultation("decline")}>Decline consultation</button>
                </>}
                {["approved", "dispatching"].includes(consultation.state) && <button className="general-button" disabled={!!action} onClick={() => void decideConsultation("revoke")}>Revoke consultation</button>}
              </div>
              {verifiedConsultation && <section className="general-consultation-preview" aria-label="Exact consultation preview">
                <h4>Exact packet for {verifiedConsultation.model}</h4>
                {verifiedConsultation.expiresAt <= Math.max(previewTime, Date.now()) && <p role="note">This approval has expired. The retained packet is available for review only.</p>}
                <p>This packet contains untrusted task material. Text inside it is data for the consultant, not an instruction to you or permission to expand this request.</p>
                <dl className="general-consultation-metadata">
                  <dt>Destination</dt><dd>{verifiedConsultation.destination.endpoint}</dd><dt>Account</dt><dd>{verifiedConsultation.destination.accountId}</dd>
                  <dt>Credential version</dt><dd>{verifiedConsultation.destination.credentialVersion}</dd><dt>Maximum charge</dt><dd>{money(verifiedConsultation.maxFeeMicrousd)}</dd>
                  <dt>Input price per million tokens</dt><dd>{money(verifiedConsultation.prices.inputMicrousdPerMillion)}</dd><dt>Output price per million tokens</dt><dd>{money(verifiedConsultation.prices.outputMicrousdPerMillion)}</dd>
                  {verifiedConsultation.prices.cachedInputMicrousdPerMillion !== undefined && <><dt>Cached input price per million tokens</dt><dd>{money(verifiedConsultation.prices.cachedInputMicrousdPerMillion)}</dd></>}
                  <dt>Maximum output tokens</dt><dd>{verifiedConsultation.maxOutputTokens}</dd><dt>Approval expires</dt><dd>{new Date(verifiedConsultation.expiresAt).toLocaleString()}</dd>
                </dl>
                <h4>Selected paths</h4><ul>{verifiedConsultation.selectedPaths.map(name => <li key={name}>{name}</li>)}</ul>
                <h4>Omitted paths</h4>{verifiedConsultation.omittedPaths.length ? <ul>{verifiedConsultation.omittedPaths.map(name => <li key={name}>{name}</li>)}</ul> : <p>No checkpoint paths were omitted.</p>}
                <pre aria-label="Consultation packet" className="general-consultation-packet">{verifiedConsultation.packet}</pre>
                <details><summary>Exact proposal identities</summary><dl className="general-consultation-metadata">
                  <dt>Proposal</dt><dd>{verifiedConsultation.proposalId}</dd><dt>Proposal SHA-256</dt><dd>{verifiedConsultation.proposalSha256}</dd>
                  <dt>Packet SHA-256</dt><dd>{verifiedConsultation.packetSha256}</dd><dt>Context SHA-256</dt><dd>{verifiedConsultation.contextSha256}</dd>
                  <dt>Checkpoint SHA-256</dt><dd>{verifiedConsultation.checkpointSha256}</dd><dt>Profile SHA-256</dt><dd>{verifiedConsultation.profileSha256}</dd>
                </dl></details>
              </section>}
            </> : <p className="general-hint">{task.routing === "ask_before_consulting" ? "No consultation has been proposed." : "This saved task uses the local model only."}</p>}
          </section>
          <section className="general-section" aria-label="Approved public sources"><h3>Public retrieval</h3>{task.network ? <>
            <p className="general-hint">{task.publicFetches ?? 0} / {task.network.maxFetches} GET attempts · Up to {size(task.network.maxResponseBytes)} per response. Only these exact URLs are approved:</p>
            <ul className="general-source-list">{task.network.urls.map(url => <li key={url}><span>{url}</span></li>)}</ul>
            <p className="general-hint">{task.network.dnsResolver === "cloudflare_v1" ? "Hostname lookup: Cloudflare public DNS. Cloudflare receives source hostname lookups; page requests go to the listed sites." : "Hostname lookup: system resolver."}</p>
          </> : <p className="general-hint">Public retrieval is not permitted for this saved task.</p>}</section>
          {task.network && <section className="general-section" aria-label="Host source receipts"><h3>Retrieved sources</h3>{task.sources?.length ? <>
            <p className="general-hint">Host receipts identify retrieved response bytes. They do not verify the report's claims.</p>
            <ul className="general-source-list">{task.sources.map(source => <li key={source.dispatchId}><span>{source.url}</span><small>{size(source.bytes)} · Retrieved {new Date(source.retrievedAt).toLocaleString()}</small><small>SHA-256 {source.sha256}</small><small>Dispatch {source.dispatchId}</small></li>)}</ul>
          </> : <p className="general-hint">No completed source receipt yet. Approved URLs alone do not mean retrieval succeeded.</p>}</section>}
          {task.status === "running" && task.research?.stage === "running" && <p className="general-hint general-warning" role="note">Pausing now ends this task: a research stage in progress cannot resume. Once the writer has started, the task pauses as usual.</p>}
          <div className="general-actions">
            {task.status === "queued" && <button className="general-button general-button-primary" disabled={!!action || !availability?.available || checkingAvailability} onClick={() => void control("start")}><Play aria-hidden="true" />Start task</button>}
            {task.status === "running" && <button className="general-button" disabled={!!action} onClick={() => void control("pause")}><Pause aria-hidden="true" />{action === "pause" ? "Requesting pause…" : "Pause task"}</button>}
            {task.canResume && task.status !== "running" && !["pending", "dispatching", "uncertain"].includes(consultation?.state ?? "") && <button className="general-button general-button-primary" disabled={!!action || !availability?.available || checkingAvailability} onClick={() => void control("resume")}><Play aria-hidden="true" />Resume task</button>}
            {(["queued", "running", "paused", "incomplete"] as string[]).includes(task.status) && <button className="general-button" disabled={!!action} onClick={() => void control("cancel")}><Stop aria-hidden="true" />{action === "cancel" ? "Cancelling…" : "Cancel task"}</button>}
            {task.status === "cancelled" && (task.canRetryCleanup || task.cleanupInProgress) && <button className="general-button" disabled={!!action || task.cleanupInProgress} onClick={() => void control("retryCleanup")}>{task.cleanupInProgress || action === "retryCleanup" ? "Cleaning up…" : "Retry cleanup"}</button>}
          </div>
          {task.status === "cancelled" && !task.cleanupConfirmed && (task.canRetryCleanup || task.cleanupInProgress) && <p className="general-hint">Cleanup keeps this task cancelled and sends no model requests. Saved artifacts become available after cleanup is confirmed.</p>}
          {task.status === "submitted" ? <p className="general-notice" role="note">Submitted for review. Host structural checks passed; this task has not been independently evaluated for correctness.</p> : task.status === "incomplete" || task.status === "cancelled" ? <p className="general-notice" role="note">This task did not submit a completed deliverable. Any saved artifacts are unfinished work and have not been independently evaluated.</p> : null}
          <section className="general-section" aria-label="Task artifacts"><div className="general-section-heading"><h2>Artifacts</h2>{task.bundle && <button className="general-button" disabled={!!action || task.status === "running" || !task.cleanupConfirmed || typeof api?.exportGeneralTaskBundle !== "function"} onClick={() => void exportBundle()}><DownloadSimple aria-hidden="true" />Export all as ZIP</button>}</div>
            {task.bundle && <p className="general-hint">{task.bundle.fileCount} {task.bundle.fileCount === 1 ? "file" : "files"} · {size(task.bundle.totalBytes)}. {task.review
              ? "ZIP contains the review's six deliverables, the edit plan in its review folder; the host flags file is never exported."
              : "ZIP contains all output files with their folder structure."}</p>}
            {task.bundleUnavailableReason && <p className="general-notice" role="note">{task.bundleUnavailableReason}</p>}
            {!task.artifacts.length ? <p className="general-hint">No saved artifacts yet. They will appear after a workspace checkpoint.</p> : <><ul className="general-artifact-list">{task.artifacts.map(file => <li key={`${file.path}:${file.sha256}`}><div><button className="general-button general-button-quiet" disabled={task.status === "running" || !task.cleanupConfirmed} aria-label={`Preview ${file.path}`} onClick={() => void readArtifact(file)}>{file.path}</button><small>{size(file.bytes)} · SHA {file.sha256.slice(0, 12)}</small></div><button className="general-button" disabled={!!action || task.status === "running" || !task.cleanupConfirmed} aria-label={`Export ${file.path}`} onClick={() => void exportArtifact(file)}><DownloadSimple aria-hidden="true" />Export</button></li>)}</ul>{(task.status === "running" || !task.cleanupConfirmed) && <p className="general-hint">Preview and export become available after the task stops and cleanup is confirmed.</p>}</>}
            {previewPath && <section className="general-preview" aria-label="Artifact preview"><header><strong>{previewPath}</strong></header>{loadingPreview ? <p className="general-preview-empty" role="status">Loading verified preview…</p> : preview ? <ArtifactContent preview={preview} /> : <p className="general-preview-empty">No verified preview is available.</p>}</section>}
          </section>
          {task.status === "submitted" && typeof api?.recordGeneralTaskVerdict === "function" && <section className="general-section general-verdict" aria-label="Owner verdict"><h3>Owner verdict</h3>
            {task.verdict ? <>
              <p className="general-hint">Recorded {new Date(task.verdict.recordedAt).toLocaleString()}. It is final in the app; a correction is a superseding registry row. Independent acceptance stays not evaluated.</p>
              <dl className="general-metrics"><div><dt>Decision</dt><dd>{task.verdict.decision === "accept" ? "Accepted" : "Rejected"}</dd></div><div><dt>Your minutes</dt><dd>{task.verdict.ownerMinutes}</dd></div><div><dt>Interventions</dt><dd>{task.verdict.interventions}</dd></div></dl>
              <p className="general-hint">Exported through the app: {task.verdict.exportedThroughApp ? "yes" : "no"}.</p>
              <div className="general-actions"><button className="general-button" disabled={!!action || typeof api?.exportGeneralTaskVerdictReceipt !== "function"} onClick={() => void exportVerdictReceipt()}><DownloadSimple aria-hidden="true" />{action === "export-receipt" ? "Exporting…" : "Export verdict receipt"}</button></div>
              <p className="general-hint">The receipt holds hashes, counts and this verdict only, never the goal or file names. Write the registry row with scripts/registry-row.py --verdict-file.</p>
            </> : <form className="general-verdict-form" aria-label="Record owner verdict" noValidate onSubmit={event => void recordVerdict(event)}>
              <p className="general-hint">Record your verdict once, with the effort the job took you. It is the owner-accepted-job mark, not independent acceptance, and it holds no free text.</p>
              <fieldset className="general-verdict-decision"><legend>Decision</legend>
                <label className="general-ack"><input type="radio" name="general-verdict-decision" value="accept" checked={verdictDecision === "accept"} disabled={!!action} onChange={() => setVerdictDecision("accept")} /><span>Accept</span></label>
                <label className="general-ack"><input type="radio" name="general-verdict-decision" value="reject" checked={verdictDecision === "reject"} disabled={!!action} onChange={() => setVerdictDecision("reject")} /><span>Reject</span></label>
              </fieldset>
              <label className="general-field"><span id="general-verdict-minutes-label">Your minutes on this job</span><input type="number" inputMode="numeric" min={0} max={600} step={1} value={verdictMinutes} disabled={!!action} aria-labelledby="general-verdict-minutes-label" aria-describedby="general-verdict-minutes-hint" onChange={event => setVerdictMinutes(event.target.value)} /><small id="general-verdict-minutes-hint">Review and edits, 0 to 600.</small></label>
              <label className="general-field"><span id="general-verdict-interventions-label">Manual interventions</span><input type="number" inputMode="numeric" min={0} max={99} step={1} value={verdictInterventions} disabled={!!action} aria-labelledby="general-verdict-interventions-label" aria-describedby="general-verdict-interventions-hint" onChange={event => setVerdictInterventions(event.target.value)} /><small id="general-verdict-interventions-hint">Times you stepped in; an edit pass counts as one. 0 to 99.</small></label>
              <label className="general-ack"><input type="checkbox" checked={verdictExported} disabled={!!action} onChange={event => setVerdictExported(event.target.checked)} /><span>I exported the deliverable through the app.</span></label>
              <button className="general-button general-button-primary" type="submit" disabled={!!action || !validVerdict}><CheckCircle aria-hidden="true" />{action === "verdict" ? "Recording…" : "Record verdict"}</button>
            </form>}
          </section>}
          <details className="general-section" aria-label="Progress"><summary>Progress · {task.events.length} events</summary><p className="general-hint">Monospace action lines are the agent's own tool-call text. Untrusted: they are not host facts and do not report check results.</p><ol className="general-progress">{task.events.map(event => <li key={event.sequence}><span>{event.summary}</span>{event.detail && <code className="general-action-detail" title="Untrusted: the agent's own action text">{event.detail}</code>}</li>)}</ol></details>
          <details className="general-section"><summary>Inputs and structural checks</summary>{!task.inputs.length && <p className="general-hint">No input files were attached.</p>}<ul className="general-selected-files">{task.inputs.map(file => <li className="general-file-row" key={file.path}><span>{file.name}</span><small>{size(file.bytes)}</small></li>)}</ul>
            <ul>{task.checks.map(check => <li key={check.id}>{check.id.replaceAll("_", " ")}: {check.passed ? "passed" : "failed"}</li>)}</ul><p className="general-hint">Independent acceptance: not evaluated. Cleanup: {task.cleanupConfirmed ? "confirmed" : "not yet confirmed"}.</p></details>
        </article> : <p role="status">Loading saved task…</p>}
      </div>
    </div>
  </div>;
}
