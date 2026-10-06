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
  GeneralTaskCreateInputSchema,
  type GeneralTaskArtifact,
  type GeneralTaskArtifactPreview,
  type GeneralTaskAvailability,
  type GeneralTaskConsultationPreview,
  type GeneralTaskConsultationSummary,
  type GeneralTaskRouting,
  type GeneralTaskInputSelection,
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
  const refreshAvailability = useCallback(async () => {
    if (!api) return;
    const epoch = ++availabilityEpoch.current;
    setCheckingAvailability(true);
    try {
      const next = await api.getGeneralTaskAvailability();
      if (mounted.current && availabilityEpoch.current === epoch) setAvailability(next);
    } catch {
      if (mounted.current && availabilityEpoch.current === epoch) {
        setAvailability(null); setError("Task availability could not be checked. Try checking again.");
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
    setError(null); setNotice(null); resetPreview(); resetConsultation();
  };
  // Runs during mount too, before the history load can auto-select the latest task.
  useEffect(() => { if (newTaskRequest) { newTask(); onNewTaskRequestHandled?.(); } }, [newTaskRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectTask = async (id: string) => {
    if (!api) return;
    const epoch = ++selectionEpoch.current;
    selected.current = id; setSelectedId(id); setLoadingTask(true); setError(null); setNotice(null); resetPreview(); resetConsultation();
    try { const value = await api.getGeneralTask(id); if (mounted.current && epoch === selectionEpoch.current) accept(value); }
    catch { if (mounted.current && epoch === selectionEpoch.current) setError("This task could not be refreshed. Its last saved state is shown."); }
    finally { if (mounted.current && epoch === selectionEpoch.current) setLoadingTask(false); }
  };
  const chooseInputs = async () => {
    if (!api || busy.current) return;
    busy.current = true; setAction("choose"); setError(null);
    try { const value = await api.chooseGeneralTaskInputs(); if (mounted.current && value) { setSelection(value); setAttested(false); } }
    catch { if (mounted.current) setError("Files could not be selected. Try opening the file picker again."); }
    finally { busy.current = false; if (mounted.current) setAction(null); }
  };
  const urls = sourceUrls.split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
  const createInput = {
    goal, outputName, publicOrSynthetic: attested,
    ...(profile ? { profile } : {}),
    ...(routing === "ask_before_consulting" ? { routing } : {}),
    ...(selection ? { inputSelectionId: selection.id } : {}),
    ...(urls.length ? { publicSources: { urls, dnsResolver, allowPublicRetrieval: retrievalAllowed } } : {}),
  };
  const startNew = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!api || busy.current || !availability?.available || checkingAvailability || (routing === "ask_before_consulting" && !availability.consultation?.available)) return;
    const input = GeneralTaskCreateInputSchema.safeParse(createInput);
    if (!input.success) { setError("Enter a goal and valid output filename, confirm the public or synthetic declaration, and check any public URLs and retrieval permission."); return; }
    busy.current = true; setAction("create"); setError(null); setNotice(null);
    let saved = false;
    try {
      const created = await api.createGeneralTask(input.data); saved = true;
      if (!mounted.current) return;
      accept(created); selectionEpoch.current += 1; selected.current = created.id; setSelectedId(created.id); resetPreview();
      setGoal(""); setSelection(null); setAttested(false); setOutputName("report.md");
      setSourceUrls(""); setDnsResolver("system"); setRetrievalAllowed(false);
      setRouting("local_only"); resetConsultation();
      const started = await api.startGeneralTask(created.id); accept(started);
    } catch { if (mounted.current) setError(saved ? "The task was saved but could not start. Use Start task to try starting this saved task." : "The task could not be created. Check your inputs and try again."); }
    finally { busy.current = false; if (mounted.current) setAction(null); }
  };
  const control = async (kind: "start" | "pause" | "resume" | "cancel") => {
    if (!api || !task || busy.current) return;
    if (kind === "resume" && ["pending", "dispatching", "uncertain"].includes(task.consultation?.state ?? "")) return;
    const id = task.id;
    busy.current = true; setAction(kind); setError(null); setNotice(null);
    try {
      const value = await ({ start: api.startGeneralTask, pause: api.pauseGeneralTask, resume: api.resumeGeneralTask, cancel: api.cancelGeneralTask })[kind].call(api, id);
      accept(value);
      if (mounted.current && selected.current === id && kind === "pause" && value.status === "running") setNotice("Pause requested. The current action must settle and cleanup must finish first.");
    } catch { if (mounted.current && selected.current === id) setError(`The task could not ${kind}. Its last received state is shown; no replacement task was created.`); }
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
  const validOutputName = GeneralTaskCreateInputSchema.shape.outputName.safeParse(outputName).success;
  const validSources = !urls.length || GeneralTaskCreateInputSchema.shape.publicSources.safeParse({ urls, dnsResolver, allowPublicRetrieval: true }).success;
  const validInput = GeneralTaskCreateInputSchema.safeParse(createInput).success && (routing === "local_only" || availability?.consultation?.available === true);
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
          <strong>{title(item)}</strong><small>{statuses[item.status]} · {item.modelCalls} model attempts</small>
        </button></li>)}</ul>
      </aside>
      <div className="general-main">
        <div className="general-readiness" aria-label="General task availability">
          <strong>{!api ? "General tasks are unavailable in this build" : checkingAvailability ? "Checking task runtime…" : availability?.available ? "Ready for a general task" : "Task runtime unavailable"}</strong>
          {availability?.reason && <p>{availability.reason}</p>}
          <p>Your public or synthetic goal and any files go to the configured owned model server, which may be on another machine. Sandbox tools stay offline; public retrieval is limited to explicitly permitted GET requests.</p>
          {availability?.executionMode === "scripted" && <p role="note"><strong>Scripted test — app mechanics only.</strong> Predetermined actions do not demonstrate model quality.</p>}
          {api && <button className="general-button general-button-quiet" disabled={checkingAvailability || !!action} onClick={() => void refreshAvailability()}>Check availability again</button>}
        </div>
        {!selectedId ? <form className="general-form" aria-label="New general task" onSubmit={startNew}>
          <h2>What would you like to make?</h2>
          <label className="general-field"><span>Task goal</span><textarea value={goal} maxLength={16000} disabled={!!action} placeholder="Describe the result you need. Add files or public sources below if useful." onChange={event => { setGoal(event.target.value); setAttested(false); }} /></label>
          <label className="general-field"><span id="general-consultation-label">Consultation mode</span><select value={routing} disabled={!!action} onChange={event => setRouting(event.target.value as GeneralTaskRouting)} aria-labelledby="general-consultation-label" aria-describedby="general-consultation-hint">
            <option value="local_only">Local only</option><option value="ask_before_consulting" disabled={!availability?.consultation?.available}>Ask before consulting</option>
          </select><small id="general-consultation-hint">{availability?.consultation?.available
            ? routing === "ask_before_consulting" ? `The local coordinator may pause once to ask ${availability.consultation.model ?? "the configured consultant"}. You must review its exact packet and charge, approve, then Resume. No automatic consultation.` : "Use only the owned local model. No consultant packet or charge will be proposed."
            : availability?.consultation?.reason ?? "Consultation is unavailable. Configure an explicit host consultant profile to enable it; local-only tasks remain available."}</small></label>
          <div className="general-field"><span>Input files (optional)</span><div className="general-actions">
            <button type="button" className="general-button" disabled={!api || !!action} onClick={() => void chooseInputs()}><FolderOpen aria-hidden="true" />{action === "choose" ? "Opening picker…" : selection ? "Change files" : "Choose files"}</button>
            {selection && <button type="button" className="general-button general-button-quiet" disabled={!!action} onClick={() => { setSelection(null); setAttested(false); }}>Clear files</button>}
          </div>{selection ? <ul className="general-selected-files" aria-label="Selected input files">{selection.files.map(file => <li className="general-file-row" key={file.path}><span>{file.name}</span><small>{size(file.bytes)}</small></li>)}</ul> : <small>No files selected. You can start from a goal alone. Selected originals stay unchanged.</small>}</div>
          <div className="general-public-inputs">
            <label className="general-field"><span id="general-sources-label">Public source URLs (optional)</span><textarea aria-labelledby="general-sources-label" className="general-source-urls" value={sourceUrls} maxLength={6146} disabled={!!action} aria-invalid={!validSources} aria-describedby="general-source-hint" placeholder="https://example.org/source" onChange={event => { setSourceUrls(event.target.value); setRetrievalAllowed(false); setAttested(false); }} /><small id="general-source-hint">{validSources ? "Up to three exact HTTPS URLs, one per line. Paths and queries are included. URLs in the goal do not grant network permission." : "Use one to three distinct public HTTPS URLs, with no credentials or fragments. Check each complete address."}</small></label>
            {urls.length > 0 ? <>
              <label className="general-field"><span id="general-dns-label">Hostname lookup</span><select aria-labelledby="general-dns-label" value={dnsResolver} disabled={!!action} aria-describedby="general-dns-hint" onChange={event => { setDnsResolver(event.target.value as "system" | "cloudflare_v1"); setRetrievalAllowed(false); }}><option value="system">System resolver</option><option value="cloudflare_v1">Cloudflare public DNS</option></select><small id="general-dns-hint">{dnsResolver === "cloudflare_v1" ? "Cloudflare receives hostname lookups for these sources. Page requests go to the listed sites. This choice is saved with the task." : "Use the system's configured hostname resolver. This choice is saved with the task."}</small></label>
              <label className="general-ack"><input type="checkbox" checked={retrievalAllowed} disabled={!!action || !validSources} onChange={event => setRetrievalAllowed(event.target.checked)} /><span>Allow SOAR to retrieve only these public URLs through the host, with up to five GET attempts and 64 KiB per response. This permits no other browsing or publication.</span></label>
            </> : <p className="general-hint">No public retrieval will be permitted for this task.</p>}
          </div>
          {availability?.profiles?.length ? <label className="general-field"><span id="general-profile-label">Model profile</span>
            <select value={profile} disabled={!!action} aria-labelledby="general-profile-label" onChange={event => setProfile(event.target.value as "" | "standard" | "heavy")}>
              <option value="">Default ({availability.profile ?? "heavy"})</option>{availability.profiles.map(name => <option key={name} value={name}>{name === "heavy" ? "heavy — thinking on, long outputs" : "standard — thinking off, short outputs"}</option>)}
            </select><small>The profile sets the model's thinking mode, output limit and the task's allowances. It is fixed once the task is created.</small></label> : null}
          <label className="general-field"><span id="general-output-label">Output filename</span><input value={outputName} maxLength={120} disabled={!!action} aria-labelledby="general-output-label" aria-invalid={!validOutputName} aria-describedby="general-output-hint" onChange={event => { setOutputName(event.target.value); setAttested(false); }} /><small id="general-output-hint">{validOutputName ? "A single filename, such as report.md or presentation.pptx." : "Use one filename starting with a letter or number, with no folders or '..'."}</small></label>
          <label className="general-ack"><input type="checkbox" checked={attested} disabled={!!action} onChange={event => setAttested(event.target.checked)} /><span>I confirm that my task goal, any selected files and source URLs contain only public or synthetic material. Real private data is not qualified for this pilot.</span></label>
          <button className="general-button general-button-primary" type="submit" disabled={!api || !availability?.available || checkingAvailability || !!action || !validInput}><Play aria-hidden="true" />{action === "create" ? "Saving and starting…" : "Create and start task"}</button>
          {availability && <p className="general-hint">Up to {availability.limits.modelCalls} model attempts, {availability.limits.toolCalls} tool actions and {duration(availability.limits.elapsedMs)}. Submission still needs your review.</p>}
        </form> : task ? <article aria-label="Selected general task">
          <h2>{title(task)}</h2><p className="general-goal">{task.goal}</p>
          <div className="general-state" role="status">{task.status === "submitted" ? <CheckCircle aria-hidden="true" /> : <Clock aria-hidden="true" />}{statuses[task.status]}{loadingTask ? " · refreshing…" : ""}</div>
          {task.reason && <p className="general-hint">{task.reason.replaceAll("_", " ")}</p>}
          {task.profile && <p className="general-hint">Model profile: {task.profile}</p>}
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
          <div className="general-actions">
            {task.status === "queued" && <button className="general-button general-button-primary" disabled={!!action || !availability?.available || checkingAvailability} onClick={() => void control("start")}><Play aria-hidden="true" />Start task</button>}
            {task.status === "running" && <button className="general-button" disabled={!!action} onClick={() => void control("pause")}><Pause aria-hidden="true" />{action === "pause" ? "Requesting pause…" : "Pause task"}</button>}
            {task.canResume && task.status !== "running" && !["pending", "dispatching", "uncertain"].includes(consultation?.state ?? "") && <button className="general-button general-button-primary" disabled={!!action || !availability?.available || checkingAvailability} onClick={() => void control("resume")}><Play aria-hidden="true" />Resume task</button>}
            {(["queued", "running", "paused", "incomplete"] as string[]).includes(task.status) && <button className="general-button" disabled={!!action} onClick={() => void control("cancel")}><Stop aria-hidden="true" />{action === "cancel" ? "Cancelling…" : "Cancel task"}</button>}
          </div>
          {task.status === "submitted" ? <p className="general-notice" role="note">Submitted for review. Host structural checks passed; this task has not been independently evaluated for correctness.</p> : task.status === "incomplete" || task.status === "cancelled" ? <p className="general-notice" role="note">This task did not submit a completed deliverable. Any saved artifacts are unfinished work and have not been independently evaluated.</p> : null}
          <section className="general-section" aria-label="Task artifacts"><div className="general-section-heading"><h2>Artifacts</h2>{task.bundle && <button className="general-button" disabled={!!action || task.status === "running" || !task.cleanupConfirmed || typeof api?.exportGeneralTaskBundle !== "function"} onClick={() => void exportBundle()}><DownloadSimple aria-hidden="true" />Export all as ZIP</button>}</div>
            {task.bundle && <p className="general-hint">{task.bundle.fileCount} {task.bundle.fileCount === 1 ? "file" : "files"} · {size(task.bundle.totalBytes)}. ZIP contains all output files with their folder structure.</p>}
            {task.bundleUnavailableReason && <p className="general-notice" role="note">{task.bundleUnavailableReason}</p>}
            {!task.artifacts.length ? <p className="general-hint">No saved artifacts yet. They will appear after a workspace checkpoint.</p> : <><ul className="general-artifact-list">{task.artifacts.map(file => <li key={`${file.path}:${file.sha256}`}><div><button className="general-button general-button-quiet" disabled={task.status === "running" || !task.cleanupConfirmed} aria-label={`Preview ${file.path}`} onClick={() => void readArtifact(file)}>{file.path}</button><small>{size(file.bytes)} · SHA {file.sha256.slice(0, 12)}</small></div><button className="general-button" disabled={!!action || task.status === "running" || !task.cleanupConfirmed} aria-label={`Export ${file.path}`} onClick={() => void exportArtifact(file)}><DownloadSimple aria-hidden="true" />Export</button></li>)}</ul>{(task.status === "running" || !task.cleanupConfirmed) && <p className="general-hint">Preview and export become available after the task stops and cleanup is confirmed.</p>}</>}
            {previewPath && <section className="general-preview" aria-label="Artifact preview"><header><strong>{previewPath}</strong></header>{loadingPreview ? <p className="general-preview-empty" role="status">Loading verified preview…</p> : preview ? <ArtifactContent preview={preview} /> : <p className="general-preview-empty">No verified preview is available.</p>}</section>}
          </section>
          <details className="general-section" aria-label="Progress"><summary>Progress · {task.events.length} events</summary><p className="general-hint">Monospace action lines are the agent's own tool-call text. Untrusted: they are not host facts and do not report check results.</p><ol className="general-progress">{task.events.map(event => <li key={event.sequence}><span>{event.summary}</span>{event.detail && <code className="general-action-detail" title="Untrusted: the agent's own action text">{event.detail}</code>}</li>)}</ol></details>
          <details className="general-section"><summary>Inputs and structural checks</summary>{!task.inputs.length && <p className="general-hint">No input files were attached.</p>}<ul className="general-selected-files">{task.inputs.map(file => <li className="general-file-row" key={file.path}><span>{file.name}</span><small>{size(file.bytes)}</small></li>)}</ul>
            <ul>{task.checks.map(check => <li key={check.id}>{check.id.replaceAll("_", " ")}: {check.passed ? "passed" : "failed"}</li>)}</ul><p className="general-hint">Independent acceptance: not evaluated. Cleanup: {task.cleanupConfirmed ? "confirmed" : "not yet confirmed"}.</p></details>
        </article> : <p role="status">Loading saved task…</p>}
      </div>
    </div>
  </div>;
}
