import type { PrivateCheckpointStore, WorkspaceSnapshot } from "../private-agent/checkpoints";
import { digest } from "../private-agent/contracts";
import { caughtRunReason } from "./run-reasons";

/**
 * Backlog item 6, plan 6.3 (BL-20261110-0715-runner-storage-integrity-design): whether a blob that a private context's records reference is
 * missing or no longer matches. The runner's catch keeps only an error's class, and its observation and progress checks wrap every failure in
 * one code each, so a damaged blob would read as a resumable runtime failure. The controller verifies the blobs itself instead:
 * - each checkpoint's snapshot;
 * - each retained execution observation;
 * - each retained public source;
 * - a consultation's proposal checkpoint and its response, whose content must still match its recorded digest, as the runner checks.
 * Each distinct blob is read once, one snapshot at a time. Only a checkpoint store refusal or a missing file under the storage root counts.
 * An environmental error (a permission error, EIO) and a record it cannot read are left alone. It never writes.
 */
export function storageIntegrityFailed(events: readonly Record<string, unknown>[], contextId: string, checkpoints: PrivateCheckpointStore, storageRoot: string): boolean {
  const damaged = (error: unknown) => caughtRunReason(error, storageRoot) === "task_integrity_failed";
  const snapshots: unknown[] = [], responses: Record<string, unknown>[] = [];
  for (const event of events) {
    if (event.contextId !== contextId) continue;
    if (event.type === "checkpoint" || event.type === "public_source_retained") snapshots.push(event.snapshot);
    else if (event.type === "tool_finished" && event.executionCapture === "retained") snapshots.push((event.executionObservation as { snapshot?: unknown } | undefined)?.snapshot);
    else if (event.type === "consultation_proposed") snapshots.push((event.proposal as { checkpoint?: unknown } | undefined)?.checkpoint);
    else if (event.type === "consultation_response") responses.push(event);
  }
  const verified = new Set<string>();
  for (const snapshot of snapshots) {
    if (!Array.isArray(snapshot)) continue;
    const fresh = (snapshot as { sha256?: unknown }[]).filter(row => typeof row?.sha256 !== "string" || !verified.has(row.sha256));
    if (!fresh.length) continue;
    try { checkpoints.load(fresh as WorkspaceSnapshot); for (const row of fresh) verified.add(String(row.sha256)); }
    catch (error) { if (damaged(error)) return true; }
  }
  for (const response of responses) {
    if (!Array.isArray(response.response)) continue;
    try {
      const content = checkpoints.load(response.response as WorkspaceSnapshot)[0]?.bytes;
      if (!content || digest(content) !== response.contentSha256) return true;
    } catch (error) { if (damaged(error)) return true; }
  }
  return false;
}
