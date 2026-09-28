import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { Code } from "@phosphor-icons/react/dist/csr/Code";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { Stop } from "@phosphor-icons/react/dist/csr/Stop";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import React, { useCallback, useEffect, useRef, useState } from "react";

import type { SoarRendererApi } from "../../shared/contracts";
import {
  isPatchRunTerminal,
  isNativePatchPolicy,
  patchPolicyNeedsCloud,
  patchPolicyNeedsLocal,
  type PatchRunAvailability,
  type PatchRunLocalInvestigation,
  type PatchRunRequestedPolicy,
  type PatchRunSnapshot,
  type SoarPatchRunApi,
} from "../../shared/patch-run-contracts";
import "./patch-run.css";

type PatchWorkspaceApi = SoarPatchRunApi & Pick<SoarRendererApi, "chooseWorkspace">;

function hasPatchRunApi(api: Partial<PatchWorkspaceApi>): api is PatchWorkspaceApi {
  const methods: (keyof PatchWorkspaceApi)[] = [
    "chooseWorkspace", "getPatchRunAvailability", "createPatchRun", "listPatchRuns",
    "getPatchRun", "startPatchRun", "cancelPatchRun", "exportPatchRun",
    "decidePatchRun", "subscribePatchRuns",
  ];
  return methods.every((method) => typeof api[method] === "function");
}

const phaseLabels: Record<PatchRunSnapshot["phase"], string> = {
  pending: "Waiting to start",
  preparing: "Preparing isolated workspace",
  local_investigation: "Investigating locally",
  local_solver: "Implementing locally",
  cloud_planner: "Planning with cloud",
  cloud_solver: "Solving the task",
  cloud_critic: "Reviewing the local draft",
  checking: "Running visible checks",
  finished: "Run finished",
};

const policyLabels: Record<PatchRunRequestedPolicy, string> = {
  automatic: "Automatic",
  cloud: "Cloud",
  prepared_cloud: "Cloud with host preparation",
  hybrid: "Local investigation + Cloud",
  local_only: "Local only",
  local_first: "Local first + Cloud recovery",
  cloud_plan_local: "Cloud plan + Local",
  cloud_plan_local_review: "Cloud plan + Local + Cloud review",
  local_critic_repair: "Local + Cloud critique + Local repair",
};

function money(microusd: number): string {
  const value = microusd / 1_000_000;
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
}

function duration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function localOutcomeReason(reason: PatchRunLocalInvestigation["fallbackReason"], providerOutputError?: PatchRunLocalInvestigation["providerOutputError"]): string {
  switch (reason) {
    case "scout_limit_or_format_failure":
      if (providerOutputError === "provider_output_empty") return "The local provider returned no usable text.";
      if (providerOutputError === "provider_output_truncated") return "The local provider marked its response as truncated.";
      return "The local investigation could not continue. The exact cause was not recorded.";
    case "scout_no_evidence": return "The local investigation produced no usable source excerpts.";
    case "input_limit_exceeded": return "The local input allowance was exhausted before another request was admitted.";
    case "scout_path_denied": return "A requested source path was outside the allowed scope.";
    case "scout_action_denied": return "The local model requested an action outside read-only investigation.";
    case "container_command_timeout": return "A source-read command timed out.";
    case "invalid_action": return "The local model returned an invalid action.";
    case "run_deadline_exceeded": return "The local investigation reached its time limit.";
    case "cancelled": return "The task was cancelled.";
    case "provider_outcome_unknown": return "The provider outcome is unknown; the task cannot continue.";
    case "scout_stopped": return "The local investigation could not finish.";
    default: return "";
  }
}

function newerSnapshot(previous: PatchRunSnapshot | undefined, incoming: PatchRunSnapshot): PatchRunSnapshot {
  if (!previous) return incoming;
  const oldSequence = previous.events.at(-1)?.sequence ?? 0;
  const newSequence = incoming.events.at(-1)?.sequence ?? 0;
  if (newSequence < oldSequence) return previous;
  if (newSequence === oldSequence && incoming.updatedAt < previous.updatedAt) return previous;
  return incoming;
}

function runLabel(run: PatchRunSnapshot): string {
  if (isPatchRunTerminal(run.status) && run.patch?.kind === "recovered") {
    const outcome = run.status.charAt(0).toUpperCase() + run.status.slice(1);
    return run.status === "completed" ? "Unfinished work recovered" : `${outcome} · unfinished work recovered`;
  }
  if (run.status === "completed") return run.patch?.text.trim() ? "Ready for review" : "Finished without a patch";
  if (run.status === "running" && run.events.some((event) => event.type === "run.cancel_requested")) return "Stopping task";
  if (run.status === "running") return run.policy === "cloud_plan_local_review" && run.phase === "cloud_solver"
    ? "Reviewing and refining with cloud" : phaseLabels[run.phase];
  return run.status.charAt(0).toUpperCase() + run.status.slice(1);
}

function visibleStepSummary(event: PatchRunSnapshot["events"][number]): string {
  if (event.type === "source.admitted") return "Committed public snapshot admitted for this task.";
  if (event.type === "runtime.admitted") return "The isolated worker is ready.";
  if (event.type === "destination.admitted") return "The selected model destination is admitted.";
  return event.summary;
}

function ScriptedNotice() {
  return (
    <p className="patch-notice patch-scripted" role="note">
      <Code aria-hidden="true" />
      <span><strong>Scripted test — mechanics only.</strong> Predetermined output tests the app flow. No model quality, routing benefit, or live provider execution is demonstrated.</span>
    </p>
  );
}

export function PatchRunWorkspace({ api: suppliedApi }: { api?: PatchWorkspaceApi }) {
  const api = suppliedApi ?? window.soar;
  const supported = hasPatchRunApi(api);
  const [availability, setAvailability] = useState<PatchRunAvailability | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(supported);
  const [runs, setRuns] = useState<PatchRunSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<{ path: string; name: string } | null>(null);
  const [objective, setObjective] = useState("");
  const [policy, setPolicy] = useState<PatchRunRequestedPolicy>("cloud");
  const [visibleTestCommand, setVisibleTestCommand] = useState("");
  const [budgetUsd, setBudgetUsd] = useState("5");
  const [acknowledged, setAcknowledged] = useState(false);
  const [action, setAction] = useState<"starting" | "cancel" | "export" | "decision" | "choose" | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(Date.now());
  const selectedRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const selectionOrdinal = useRef(0);
  const availabilityOrdinal = useRef(0);
  const receivedAt = useRef(new Map<string, number>());

  const acceptSnapshot = useCallback((incoming: PatchRunSnapshot) => {
    if (!mounted.current) return;
    setRuns((current) => {
      const previous = current.find((run) => run.id === incoming.id);
      const accepted = newerSnapshot(previous, incoming);
      if (accepted === previous) return current;
      receivedAt.current.set(incoming.id, Date.now());
      return [accepted, ...current.filter((run) => run.id !== incoming.id)]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  const refreshAvailability = useCallback(async () => {
    if (!supported) return;
    const ordinal = ++availabilityOrdinal.current;
    setLoadingAvailability(true);
    setAcknowledged(false);
    try {
      const next = await api.getPatchRunAvailability();
      if (!mounted.current || ordinal !== availabilityOrdinal.current) return;
      setAvailability(next);
      if (!next.localReady) setPolicy((current) => current === "hybrid" ? "cloud" : current);
      if (next.maxEpisodeCostMicrousd > 0) {
        const ceiling = next.maxEpisodeCostMicrousd / 1_000_000;
        setBudgetUsd((current) => {
          const value = Number(current);
          return Number.isFinite(value) && value > ceiling ? String(ceiling) : current;
        });
      }
    } catch {
      if (!mounted.current || ordinal !== availabilityOrdinal.current) return;
      setAvailability(null);
      setError("Coding readiness could not be checked. Retry before starting a task.");
    } finally {
      if (mounted.current && ordinal === availabilityOrdinal.current) setLoadingAvailability(false);
    }
  }, [api, supported]);

  useEffect(() => {
    mounted.current = true;
    if (!supported) return () => { mounted.current = false; };
    void refreshAvailability();
    let active = true;
    const unsubscribe = api.subscribePatchRuns(acceptSnapshot);
    void api.listPatchRuns().then((history) => {
      if (!active) return;
      history.forEach(acceptSnapshot);
    }).catch(() => {
      if (active) setError("Previous coding tasks could not be loaded. New tasks remain available when the runner is ready.");
    });
    return () => {
      active = false;
      mounted.current = false;
      availabilityOrdinal.current += 1;
      unsubscribe();
    };
  }, [acceptSnapshot, api, refreshAvailability, supported]);

  const run = runs.find((candidate) => candidate.id === selectedId);
  const activeRun = runs.find((candidate) => candidate.status === "running");
  const running = run?.status === "running";
  const stopping = action === "cancel" || Boolean(running && run?.events.some((event) => event.type === "run.cancel_requested"));
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  const chooseWorkspace = async () => {
    setAction("choose");
    setError(null);
    try {
      const choice = await api.chooseWorkspace();
      if (mounted.current && choice) {
        setWorkspace(choice);
        setAcknowledged(false);
      }
    } catch {
      if (mounted.current) setError("The repository picker could not open.");
    } finally {
      if (mounted.current) setAction(null);
    }
  };

  const selectRun = async (id: string) => {
    if (!supported) return;
    const ordinal = ++selectionOrdinal.current;
    selectedRef.current = id;
    setSelectedId(id);
    setLoadingRun(true);
    setError(null);
    setNotice(null);
    try {
      const snapshot = await api.getPatchRun(id);
      if (mounted.current && ordinal === selectionOrdinal.current) acceptSnapshot(snapshot);
    } catch {
      if (mounted.current && ordinal === selectionOrdinal.current) setError("This coding task could not be refreshed. The last received state is shown.");
    } finally {
      if (mounted.current && ordinal === selectionOrdinal.current) setLoadingRun(false);
    }
  };

  const newRun = () => {
    selectionOrdinal.current += 1;
    selectedRef.current = null;
    setSelectedId(null);
    setLoadingRun(false);
    setAcknowledged(false);
    setError(null);
    setNotice(null);
    void refreshAvailability();
  };

  const scripted = availability?.executionMode === "scripted";
  const budget = Number(budgetUsd);
  const validBudget = scripted || (Number.isFinite(budget) && budget > 0 && budget * 1_000_000 <= (availability?.maxEpisodeCostMicrousd ?? 0));
  const needsCloud = policy === "automatic" || patchPolicyNeedsCloud(policy);
  const needsLocal = policy !== "automatic" && patchPolicyNeedsLocal(policy);
  const ready = Boolean(availability?.ready && (policy !== "automatic" || (!scripted && availability.cloudReady)) &&
    (!needsCloud || scripted || availability.cloudReady) &&
    (!needsLocal || availability.localReady || (scripted && isNativePatchPolicy(policy))));
  const canStart = ready && !loadingAvailability && Boolean(workspace && objective.trim() && acknowledged && validBudget) && !action && !activeRun;

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supported || !canStart || !workspace) return;
    setAction("starting");
    setError(null);
    setNotice(null);
    try {
      const created = await api.createPatchRun({
        workspaceRoot: workspace.path,
        objective: objective.trim(),
        policy,
        publicSourceAcknowledged: true,
        ...(visibleTestCommand.trim() ? { visibleTestCommand: visibleTestCommand.trim() } : {}),
        ...(!scripted ? { episodeBudgetUsd: budget } : {}),
      });
      acceptSnapshot(created);
      if (!mounted.current) return;
      selectedRef.current = created.id;
      selectionOrdinal.current += 1;
      setSelectedId(created.id);
      setAcknowledged(false);
      const started = await api.startPatchRun(created.id);
      acceptSnapshot(started);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "The coding task could not start.");
    } finally {
      if (mounted.current) setAction(null);
    }
  };

  const actOnRun = async (operation: "cancel" | "export" | "keep" | "reject") => {
    if (!supported || !run) return;
    const id = run.id;
    setAction(operation === "keep" || operation === "reject" ? "decision" : operation);
    setError(null);
    setNotice(null);
    try {
      if (operation === "export") {
        const result = await api.exportPatchRun(id);
        if (mounted.current && selectedRef.current === id && result.exported) setNotice(run.patch?.kind === "recovered"
          ? "Unfinished patch exported. It was not submitted or checked. Your source checkout has not been changed."
          : "Patch exported. Your source checkout has not been changed.");
      } else {
        const next = operation === "cancel"
          ? await api.cancelPatchRun(id)
          : await api.decidePatchRun({ id, decision: operation });
        acceptSnapshot(next);
      }
    } catch (reason) {
      if (mounted.current && selectedRef.current === id) setError(reason instanceof Error ? reason.message : "The action could not be completed.");
    } finally {
      if (mounted.current) setAction(null);
    }
  };

  const displayedElapsed = run ? run.elapsedMs + (running ? Math.max(0, tick - (receivedAt.current.get(run.id) ?? tick)) : 0) : 0;
  const hasPatch = Boolean(run?.patch?.text.trim());
  const recoveredPatch = run?.patch?.kind === "recovered";
  const terminal = run ? isPatchRunTerminal(run.status) : false;

  return (
    <div className="patch-workspace">
      <div className="patch-workspace-topline">
        <span className="review-kicker">Coding pilot</span>
        {selectedId ? <button className="review-text-button" onClick={newRun} disabled={action !== null}>New coding task</button> : null}
      </div>

      {error ? <div className="patch-notice patch-error" role="alert"><WarningCircle aria-hidden="true" /><span>{error}</span></div> : null}
      {notice ? <p className="patch-notice" role="status">{notice}</p> : null}

      {!selectedId ? (
        <>
          <header className="review-setup-heading">
            <h1>Fix a repository</h1>
            <p>Describe a small fix. Review the patch and the checks before deciding whether to keep it.</p>
          </header>
          {scripted ? <ScriptedNotice /> : null}
          <section className="patch-readiness" aria-label="Coding readiness" aria-busy={loadingAvailability}>
            <strong>{loadingAvailability ? "Checking coding readiness…" : ready ? "Ready for a coding task" : "Coding is unavailable"}</strong>
            {!supported ? <p>This build does not include the coding runner.</p> : null}
            {availability ? <>
              <p>{scripted ? "Scripted worker" : [needsCloud ? availability.cloudLabel || "Cloud model not configured" : null,
                needsLocal || (policy === "automatic" && availability.localReady) ? availability.localLabel || "Local model not configured" : null].filter(Boolean).join(" · ")}</p>
              {!scripted && needsCloud && !availability.cloudReady ? <p>This policy requires a cloud model and session key. Local-only work can use a configured local model.</p> : null}
              {availability.blockedReasons.length ? <ul>{availability.blockedReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul> : null}
              {!availability.dockerReady ? <p>The isolated execution environment is not ready.</p> : null}
            </> : null}
            {supported ? <button className="review-text-button" type="button" onClick={() => void refreshAvailability()} disabled={loadingAvailability || action !== null}>Recheck readiness</button> : null}
          </section>
          {activeRun ? <p className="patch-notice">A coding task is still running. <button className="review-text-button" onClick={() => void selectRun(activeRun.id)}>View running task</button></p> : null}
          <form className="patch-form" onSubmit={(event) => void start(event)} aria-label="New coding task">
            <div className="review-setting-row">
              <FolderOpen aria-hidden="true" />
              <div className="review-setting-copy"><strong>{workspace?.name || "Choose a public repository"}</strong><small>{workspace?.path || "An isolated snapshot will be used for solving."}</small></div>
              <button type="button" className="review-text-button" onClick={() => void chooseWorkspace()} disabled={action !== null}>{workspace ? "Change repository" : "Choose repository"}</button>
            </div>
            <p className="patch-accounting-note">The task uses committed HEAD. Uncommitted edits are excluded, and your source checkout stays unchanged.</p>
            <label className="patch-field"><span>What should change?</span><textarea value={objective} maxLength={20_000} rows={4} placeholder="Describe the behavior that is wrong and the expected result." onChange={(event) => { setObjective(event.target.value); setAcknowledged(false); }} disabled={action !== null} /></label>
            <fieldset className="patch-policy" disabled={action !== null}>
              <legend>Execution</legend>
              <label><input type="radio" name="patch-policy" value="cloud" checked={policy === "cloud"} onChange={() => { setPolicy("cloud"); setAcknowledged(false); }} /><span>Cloud</span></label>
              <label><input type="radio" name="patch-policy" value="automatic" checked={policy === "automatic"} disabled={scripted || !availability?.cloudReady}
                onChange={() => { setPolicy("automatic"); setAcknowledged(false); }} /><span>Automatic <small>Experimental</small></span></label>
              {(["local_only", "local_first", "cloud_plan_local", "cloud_plan_local_review", "local_critic_repair"] as const).map((option) => <label key={option}>
                <input type="radio" name="patch-policy" value={option} checked={policy === option} disabled={option === "local_critic_repair" ? !availability?.criticReady : !scripted && (!availability?.localReady || (option !== "local_only" && !availability?.cloudReady))}
                  onChange={() => { setPolicy(option); setAcknowledged(false); }} />
                <span>{policyLabels[option]} <small>Experimental{option === "local_critic_repair" && !availability?.criticReady ? " · compatible live model setup required" : !scripted && !availability?.localReady ? " · local model unavailable" : !scripted && option !== "local_only" && !availability?.cloudReady ? " · cloud model unavailable" : ""}</small></span>
              </label>)}
              <label><input type="radio" name="patch-policy" value="hybrid" checked={policy === "hybrid"} disabled={!availability?.localReady} onChange={() => { setPolicy("hybrid"); setAcknowledged(false); }} /><span>Local investigation + Cloud <small>Experimental{!availability?.localReady ? " · local model unavailable" : ""}</small></span></label>
              <details><summary>Comparison option</summary><label><input type="radio" name="patch-policy" value="prepared_cloud" checked={policy === "prepared_cloud"} onChange={() => { setPolicy("prepared_cloud"); setAcknowledged(false); }} /><span>Cloud with host preparation</span></label><p>Uses a host-generated inventory to compare preparation with local investigation.</p></details>
            </fieldset>
            {policy === "automatic" ? <p className="patch-accounting-note">Small repositories can use local drafting with one cloud critique. Larger repositories, or tasks without a compatible local setup and budget, use cloud. The selected route is recorded before work starts.</p> : null}
            {policy !== "automatic" && isNativePatchPolicy(policy) ? <p className="patch-accounting-note">{policy === "local_only"
              ? "The local model implements the change. If it cannot finish, the task stops and preserves unfinished work. No cloud request is admitted."
              : policy === "local_first" ? "Start locally. A recorded help or progress checkpoint may hand the patch and check evidence to cloud once."
              : policy === "local_critic_repair" ? "Local drafts the change, cloud critiques it once, and local can make a bounded repair. The complete task shares one budget."
              : policy === "cloud_plan_local_review" ? "Cloud plans the change, local implements it, then cloud reviews and may repair the patch. Cloud review is required even when local checks pass; every phase shares the same budget."
              : "One cloud response supplies a plan, then the local model implements it. A recorded checkpoint may admit one cloud recovery phase."}
              {" "}The final two local calls are reserved for checking, submission or help. Visible checks remain separate from independent acceptance.</p> : null}
            <label className="patch-field"><span id="patch-test-label">Visible test command <small>Optional</small></span><input aria-labelledby="patch-test-label" aria-describedby="patch-test-help" value={visibleTestCommand} maxLength={4_096} placeholder="python -m unittest discover -s tests -v" onChange={(event) => { setVisibleTestCommand(event.target.value); setAcknowledged(false); }} disabled={action !== null} /><small id="patch-test-help">Blank uses python -m unittest discover -s tests -v inside the isolated workspace. Passing these checks does not independently establish correctness.</small></label>
            {!scripted ? <label className="patch-field patch-budget"><span id="patch-budget-label">Episode ceiling (USD)</span><input aria-labelledby="patch-budget-label" aria-describedby="patch-budget-help" type="number" min="0.01" step="0.01" max={(availability?.maxEpisodeCostMicrousd ?? 5_000_000) / 1_000_000} value={budgetUsd} onChange={(event) => { setBudgetUsd(event.target.value); setAcknowledged(false); }} disabled={action !== null} /><small id="patch-budget-help">All local, planning and cloud requests share this ceiling. Failed requests still count.</small></label> : null}
            <label className="patch-acknowledgment"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={action !== null} /><span>I confirm this repository snapshot and task are public and may be sent to the displayed model destinations.</span></label>
            <button className="patch-primary-button" type="submit" disabled={!canStart}>{action === "starting" ? "Starting…" : scripted ? "Start scripted task" : "Start coding task"}</button>
          </form>
        </>
      ) : run ? (
        <article className="patch-run" aria-label="Selected coding task" aria-busy={loadingRun}>
          <header className="review-setup-heading"><h1>{run.title}</h1><p>{run.workspaceLabel} · base <code>{run.baseRevision || "Not yet prepared"}</code></p></header>
          {run.executionMode === "scripted" ? <ScriptedNotice /> : null}
          {run.objective !== run.title ? <p className="patch-objective">{run.objective}</p> : null}
          <div className="patch-run-state">
            <span role="status" className={`patch-state patch-state-${recoveredPatch ? "interrupted" : run.status}`}>{run.status === "completed" && !recoveredPatch ? <CheckCircle aria-hidden="true" /> : <Clock aria-hidden="true" />}{runLabel(run)}</span>
            {!terminal ? <button className="patch-secondary-button" type="button" onClick={() => void actOnRun("cancel")} disabled={stopping}><Stop aria-hidden="true" />{stopping ? "Stopping…" : "Cancel task"}</button> : null}
          </div>
          {run.error ? <div className="patch-notice patch-error" role="alert">{run.error}</div> : null}
          {run.status === "interrupted" ? <p className="patch-notice">This run was interrupted. No automatic retry was started; any available patch is preserved below.</p> : null}
          <dl className="patch-metrics">
            <div><dt>Model</dt><dd>{run.providerLabel || "Not yet dispatched"}</dd></div>
            <div><dt>Policy</dt><dd>{run.routingSelection ? "Automatic → " : ""}{policyLabels[run.policy]}</dd></div>
            <div><dt>Known spend</dt><dd>{money(run.spentMicrousd)}</dd></div>
            <div><dt>Reserved exposure</dt><dd>{money(run.reservedMicrousd)}</dd></div>
            <div><dt>Episode ceiling</dt><dd>{money(run.maxCostMicrousd)}</dd></div>
            <div><dt>Elapsed</dt><dd>{duration(displayedElapsed)}</dd></div>
          </dl>
          {run.routingSelection ? <p className="patch-accounting-note" aria-label="Automatic route reason">{
            { baseline_within_critic_hard_limits: "The committed repository is within the local draft and cloud critique size limits. The final draft still needs to fit the critic's context.",
              baseline_exceeds_critic_hard_limits: "Cloud was selected because the committed repository exceeds the critic's source size limits.",
              critic_profile_unavailable: "Cloud was selected because a compatible local draft and cloud critique setup is unavailable.",
              critic_budget_unavailable: "Cloud was selected because the episode budget cannot reserve the required critique." }[run.routingSelection.reason]
          }</p> : null}
          {run.reservedMicrousd > 0 ? <p className="patch-accounting-note">Reserved exposure is not settled spend. A sent request may still be billed after cancellation.</p> : null}
          <section className="patch-section" aria-label="Run steps"><details className="patch-run-steps" open={!terminal}><summary>Run steps <small>{run.events.length} recorded</small></summary>{run.events.length ? <ol className="patch-steps">{run.events.map((event) => <li key={event.sequence}><span>{visibleStepSummary(event)}</span><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></li>)}</ol> : <p>No steps have been recorded yet.</p>}{run.events.some((event) => event.type === "runtime.admitted") ? <details className="patch-runtime-details"><summary>Execution configuration</summary><pre className="patch-output">{run.events.filter((event) => event.type === "runtime.admitted" || event.type === "destination.admitted").map((event) => event.summary).join("\n")}</pre></details> : null}</details></section>
          {run.phaseUsage ? <section className="patch-section" aria-label="Usage by phase"><h2>Usage by phase</h2>
            {(["scout", "planner", "local", "critic", "cloud"] as const).map((phase) => {
              const usage = run.phaseUsage?.[phase];
              if (!usage) return null;
              const label = phase === "cloud" && run.policy === "cloud_plan_local_review" ? "Cloud review and repair"
                : { scout: "Local investigation", planner: "Cloud planner", local: "Local solver", critic: "Cloud critique", cloud: "Cloud solver" }[phase];
              return <div key={phase} aria-label={`${label} usage`}>
                <h3>{label}</h3><p>{usage.providerLabel}</p>
                <dl className="patch-metrics">
                  <div><dt>Requests</dt><dd>{usage.requestCount}</dd></div>
                  <div><dt>Usage receipts</dt><dd>{usage.usageReceipts} / {usage.requestCount}</dd></div>
                  <div><dt>Input / output tokens</dt><dd>{usage.usageReceipts ? `${usage.inputTokens} / ${usage.outputTokens}` : "No usage receipt"}</dd></div>
                  <div><dt>Token fees accounted</dt><dd>{money(usage.spentMicrousd)}</dd></div>
                  <div><dt>Unresolved exposure</dt><dd>{money(usage.reservedMicrousd)}</dd></div>
                </dl>
                {usage.reasoningTokens > 0 ? <p className="patch-accounting-note">Output includes {usage.reasoningTokens} reasoning tokens.</p> : null}
                {usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0 ? <p className="patch-accounting-note">Reported cache tokens: {usage.cacheReadTokens} read / {usage.cacheWriteTokens} written.</p> : null}
                {usage.unknownRequests > 0 ? <p className="patch-accounting-note">{usage.unknownRequests} request outcome(s) remain unknown. Token totals include received usage only.</p> : null}
              </div>;
            })}
            {run.phaseUsage.scout || run.phaseUsage.local ? <p className="patch-accounting-note">Local token fees exclude the machine, energy and operating costs. Zero API fees do not mean zero total cost.</p> : null}
          </section> : null}
          {run.checkpoint ? <section className="patch-section" aria-label="Routing checkpoint"><h2>Routing checkpoint</h2>
            <p>{run.checkpoint.decision === "escalate" ? run.policy === "cloud_plan_local_review"
              ? "The required cloud review and repair phase was admitted." : "A cloud recovery phase was explicitly admitted."
              : run.checkpoint.reason === "review_required" ? "The local candidate passed its visible check and is waiting for required cloud review."
              : run.checkpoint.reason === "review_time_reserve" ? "Local work paused to leave time for the required cloud review."
              : run.checkpoint.reason === "critic_required" ? "The local draft passed its visible check and is waiting for a critique."
              : run.checkpoint.decision === "checkpoint" ? "Local execution reached a checkpoint. Cloud continuation has not yet been admitted."
              : run.checkpoint.decision === "submit" ? "The local model submitted after a source-bound visible check."
              : run.checkpoint.decision === "stop" ? "The checkpoint stopped this route." : "Local route progress recorded."}</p>
            <p>Reason: {run.checkpoint.reason.replaceAll("_", " ")}. Local calls: {run.checkpoint.localCalls} / {run.policy === "local_critic_repair" ? 12 : run.checkpoint.localCalls + run.checkpoint.remainingLocalCalls}.
              {run.policy === "local_critic_repair" ? ` Critiques: ${run.phaseUsage?.critic?.requestCount ?? 0} / 1.`
                : <> {run.policy === "cloud_plan_local_review" ? "Cloud review and repair phases" : "Cloud recovery phases"}: {run.cloudRecoveryCount ?? 0} / {run.policy === "local_only" ? 0 : 1}.</>}</p>
            <p>Checkpoint decisions use visible execution evidence. They do not establish independent acceptance or an owner Keep decision.</p>
          </section> : null}
          {run.critic ? <section className="patch-section" aria-label="Draft critique"><h2>Draft critique</h2>
            <p>{run.critic.result.summary}</p>
            {run.critic.result.findings.map((finding, index) => <p key={index}><code>{finding.path}:{finding.startLine}</code> — {finding.issue} {finding.repair}</p>)}
            <p>{run.criticCurrent ? "This feedback applies to the current draft." : "This feedback applies to an earlier draft; inspect the final diff and checks below."} A critique does not establish independent acceptance.</p>
          </section> : null}
          {run.checkpointCheck ? <section className="patch-section" aria-label="Latest local checkpoint check"><h2>Latest local checkpoint check</h2>
            <p>{run.checkpointCheck.passed ? "Exact visible check passed." : "Exact visible check failed or changed its verification snapshot."}
              {" "}{run.checkpointCheck.fresh ? "The recorded source identity still matches this check." : "This check is stale for later work; a fresh check is required."}</p>
            <code className="patch-command">{run.checkpointCheck.command}</code><p>Exit code: {run.checkpointCheck.exitCode} · {duration(run.checkpointCheck.elapsedMs)}</p>
            <pre className="patch-output" tabIndex={0}>{run.checkpointCheck.output}</pre>
          </section> : null}
          {run.cloudPlan ? <details className="patch-section"><summary>Cloud plan supplied to local</summary><p>Model-authored plan; execution and checks determine its usefulness.</p><pre className="patch-output">{run.cloudPlan.summary}</pre></details> : null}
          {run.cloudPlan?.checks ? <details className="patch-section"><summary>Planner-generated tests</summary>
            <p>Checks derived from the public task. They can miss defects or contain mistakes; passing them is not independent acceptance.</p>
            <pre className="patch-output" tabIndex={0}>{run.cloudPlan.checks.source}</pre>
          </details> : null}
          {run.plannerCheck ? <section className="patch-section" aria-label="Latest planner-generated check result"><h2>Planner-generated check result</h2>
            <p>{run.plannerCheck.passed ? "Generated checks passed." : "Generated checks failed or did not complete."}
              {" "}{run.plannerCheck.fresh ? "The checked source is unchanged." : "This result is stale for later work."}</p>
            <p>{run.plannerCheck.stage === "final" ? "Final verification" : "Local checkpoint"} · {duration(run.plannerCheck.elapsedMs)}
              {run.plannerCheck.result ? ` · ${run.plannerCheck.result.testsRun}/${run.plannerCheck.result.expectedTests} tests executed` : ""}</p>
            <pre className="patch-output" tabIndex={0}>{run.plannerCheck.result?.detail || (run.plannerCheck.passed ? "No failures reported." : "No complete passing result was recorded.")}</pre>
          </section> : null}
          {run.handoff ? <details className="patch-section"><summary>Local work prepared for cloud</summary><p>{run.handoff.bytes} patch bytes with source and check identities. The handoff itself does not establish acceptance.</p><pre className="patch-output">{run.handoff.summary}</pre></details> : null}
          {run.localSummary || run.localInvestigation ? <details className="patch-section"><summary>Local investigation evidence</summary>
            {run.localInvestigation ? <><p>Local investigation elapsed: {duration(run.localInvestigation.elapsedMs)}.</p>
              <p>{run.localInvestigation.outcome === "completed"
                ? run.localSummary?.trim() ? "Host-captured read-only observations prepared for cloud." : "The local investigation finished without usable source evidence. Cloud preparation uses the host inventory only."
                : run.localInvestigation.outcome === "partial" ? "The local step limit was reached. Partial source observations were prepared for cloud; the investigation did not finish."
                : run.localInvestigation.outcome === "fallback" ? "Local investigation fell back. Cloud preparation uses the host inventory only." : "Local investigation stopped. Its observations were not handed to cloud."}</p>
              {run.localInvestigation.fallbackReason ? <p>{localOutcomeReason(run.localInvestigation.fallbackReason, run.localInvestigation.providerOutputError)}</p> : null}</> : <p>Local timing and outcome were not recorded for this older run.</p>}
            {run.localSummary ? <pre className="patch-output">{run.localSummary}</pre> : null}<p>Located source evidence does not independently verify a diagnosis.</p></details> : null}
          <section className="patch-section" aria-label="Visible checks">
            <h2>Visible checks</h2>
            <p>{run.checks.status === "passed" ? "Visible checks passed. Independent task acceptance has not been established by these checks." : run.checks.status === "failed" ? "Visible checks failed. Review the output before keeping this patch." : run.checks.status === "error" ? "The visible checks could not complete." : "Visible checks have not run."}</p>
            {run.checks.sourceSha256 && run.checks.sourceAfterSha256 !== run.checks.sourceSha256 ? <p>The verification command changed its source snapshot. Its exit code cannot establish a passing check for the exported patch.</p> : null}
            {run.checks.command ? <code className="patch-command">{run.checks.command}</code> : null}
            {run.checks.exitCode !== null ? <p>Exit code: {run.checks.exitCode}</p> : null}
            {run.checks.output ? <pre className="patch-output" tabIndex={0}>{run.checks.output}</pre> : null}
          </section>
          <section className="patch-section" aria-label="Patch preview">
            <div className="patch-section-heading"><h2>Patch preview</h2>{hasPatch && terminal ? <button className="patch-secondary-button" type="button" onClick={() => void actOnRun("export")} disabled={action !== null}><DownloadSimple aria-hidden="true" />Export patch</button> : null}</div>
            {recoveredPatch ? <p className="patch-notice" role="note"><strong>Recovered unfinished work.</strong> The solver did not submit this patch, and it has not been checked. Inspect it before using it.</p> : null}
            {hasPatch && run.patch ? <><p>{run.patch.files.join(", ")}</p>{run.patch.truncated ? <p className="patch-notice">This preview is truncated. Export the patch to inspect it in full.</p> : null}<pre className="patch-diff" tabIndex={0} aria-label="Proposed diff">{run.patch.text}</pre></> : <p>{terminal ? "No patch was produced." : "The patch will appear after the solver submits its work."}</p>}
          </section>
          {hasPatch && terminal ? <section className="patch-section patch-decision" aria-label="Patch decision"><h2>Your decision</h2><p>Keeping a patch records your decision. Export it for use; your source checkout is unchanged.</p>{run.decision ? <p role="status">{run.decision === "keep" ? "Patch kept" : "Patch rejected"}</p> : <div className="patch-decision-actions"><button className="patch-primary-button" onClick={() => void actOnRun("keep")} disabled={action !== null}>Keep patch</button><button className="patch-secondary-button" onClick={() => void actOnRun("reject")} disabled={action !== null}>Reject patch</button></div>}</section> : null}
        </article>
      ) : <p role="status">Loading coding task…</p>}

      {runs.length ? <section className="patch-history" aria-label="Coding task history"><h2>Recent coding tasks</h2>{runs.map((item) => <button type="button" key={item.id} className={`patch-history-row ${item.id === selectedId ? "is-active" : ""}`} onClick={() => void selectRun(item.id)} disabled={action !== null} aria-current={item.id === selectedId ? "page" : undefined}><span><strong>{item.title}</strong><small>{item.workspaceLabel}{item.executionMode === "scripted" ? " · Scripted test" : ""}</small></span><span>{runLabel(item)}</span></button>)}</section> : null}
    </div>
  );
}
