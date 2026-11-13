import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, renameSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { DockerSandbox } from "./sandbox";
import type { RunLedger } from "./selection";
import { PrivateAgentStore } from "./store";

/**
 * Backlog item 11, part 3b (BL-20261113-0805-infra-resume-design, decisions (3) and (4)): the H4 loop's lock, its atomic
 * record, and the in-place recovery of a stage's ledger and run claims before the stage is moved aside. Harness only: the
 * desktop never calls these.
 */

/**
 * The loop's lock: an exclusive SQLite transaction on `loop.lock`, taken without waiting and held for the whole invocation.
 * The operating system releases it when the process dies, so a stale lock needs no takeover and a reused process ID cannot
 * pin it. Any failure to take it refuses with `loop_locked` before the loop reads or writes anything else.
 */
export function acquireLoopLock(loopDirectory: string): { release(): void } {
  const path = join(loopDirectory, "loop.lock");
  let database: Database.Database | undefined;
  try {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("loop_locked");
    database = new Database(path, { timeout: 0 });
    database.exec("BEGIN EXCLUSIVE");
  } catch {
    try { database?.close(); } catch { /* the refusal stands */ }
    throw new Error("loop_locked");
  }
  const held = database;
  let released = false;
  return { release: () => {
    if (released) return;
    released = true;
    try { held.exec("ROLLBACK"); } finally { held.close(); }
  } };
}

/** Syncs a directory's entries to disk (a rename's durability); a file system that refuses a directory sync is not an error. */
export function syncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try { descriptor = openSync(directory, "r"); fsyncSync(descriptor); } catch { /* best effort */ } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

/** Writes a file atomically: a temporary file, synced, renamed over the target, and the directory synced. */
export function writeFileAtomically(path: string, text: string): void {
  const temporary = `${path}.tmp`;
  const descriptor = openSync(temporary, "w", 0o600);
  try { writeSync(descriptor, text); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}

/** A directory's identity across a rename: its inode, as a decimal string. */
export function directoryInode(directory: string): string {
  return statSync(directory, { bigint: true }).ino.toString();
}

/**
 * Recovers a stage's ledger in place: one read-write open of its `state.sqlite`, under the loop's lock, so SQLite rolls a hot
 * journal back to the last commit. The broker commits a row before it sends, so a row the rollback removes was never sent.
 * Nothing else is written. A ledger that cannot be opened or read refuses with `loop_stage_ledger_unreadable`.
 */
export function recoverRunLedger(runDirectory: string): void {
  const path = join(runDirectory, "state.sqlite");
  if (!existsSync(path)) return;
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("symbolic link");
    const database = new Database(path, { fileMustExist: true, timeout: 0 });
    try { database.prepare("SELECT count(*) FROM sqlite_master").get(); } finally { database.close(); }
  } catch { throw new Error("loop_stage_ledger_unreadable"); }
}

/** Cleans a sandbox context of a stage whose claim was not released: the sandbox's own cleanup for that job and context. */
export type ContextCleanup = (input: { endpoint: string; jobId: string; contextId: string }) => Promise<void>;
/**
 * Recovers each of a stage's run claims that is not `released` through the store's own recovery path, as the runner's recovery
 * does (runner.ts): `acquireRecovery`, then the sandbox's cleanup, then `releaseRun`. Under the loop's lock the driver that held
 * the claim ran in an earlier invocation that has finished, so no liveness check is needed. The claims table is the only part of
 * the stage's ledger written. A cleanup that fails leaves the claim `cleanup_required` and refuses with `loop_stage_cleanup_required`.
 */
export async function recoverRunClaims(runDirectory: string, ledger: Pick<RunLedger, "freeze" | "claims">,
  cleanup: ContextCleanup = input => DockerSandbox.cleanupOwnedContext(input)): Promise<"confirmed" | "not_needed"> {
  const open = ledger.claims.filter(claim => claim.state !== "released");
  if (open.length === 0) return "not_needed";
  if (!ledger.freeze) throw new Error("loop_stage_mismatch");
  const owner = `loop-recovery-${randomUUID()}`;
  const database = new Database(join(runDirectory, "state.sqlite"), { fileMustExist: true });
  try {
    const store = new PrivateAgentStore(database);
    for (const claim of open) {
      const contextId = String(claim.contextId);
      const recovering = store.acquireRecovery(contextId, String(claim.ownerId), owner);
      let confirmed = false;
      try { await cleanup({ endpoint: recovering.endpoint, jobId: ledger.freeze.jobId, contextId }); confirmed = true; }
      catch { /* recorded below as cleanup_required */ }
      store.releaseRun(contextId, owner, confirmed);
      if (!confirmed) throw new Error("loop_stage_cleanup_required");
    }
  } finally { database.close(); }
  return "confirmed";
}
