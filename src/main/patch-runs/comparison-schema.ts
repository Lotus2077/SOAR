import type { SoarDatabase } from "../database";

export const PATCH_COMPARISON_SCHEMA = `
  CREATE TABLE patch_comparison_screens (
    id TEXT PRIMARY KEY,
    manifest_sha256 TEXT NOT NULL,
    configuration_sha256 TEXT NOT NULL,
    frozen_json TEXT NOT NULL,
    ceiling_microusd INTEGER NOT NULL CHECK (ceiling_microusd > 0 AND ceiling_microusd <= 180000000),
    episode_microusd INTEGER NOT NULL CHECK (episode_microusd > 0 AND episode_microusd <= 5000000),
    created_at TEXT NOT NULL
  );
  CREATE TABLE patch_comparison_blocks (
    screen_id TEXT NOT NULL REFERENCES patch_comparison_screens(id),
    task_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    arm_order TEXT NOT NULL,
    reservation_microusd INTEGER NOT NULL CHECK (reservation_microusd > 0),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','reserved','completed')),
    PRIMARY KEY (screen_id, task_id), UNIQUE(screen_id, ordinal)
  );
  CREATE TABLE patch_comparison_assignments (
    screen_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    arm TEXT NOT NULL CHECK (arm IN ('C','D','H')),
    run_id TEXT UNIQUE REFERENCES patch_runs(id),
    dispatch_claimed INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_claimed IN (0,1)),
    evaluation_json TEXT,
    PRIMARY KEY(screen_id, task_id, arm),
    FOREIGN KEY(screen_id, task_id) REFERENCES patch_comparison_blocks(screen_id, task_id)
  );
  CREATE TRIGGER patch_comparison_screens_no_update BEFORE UPDATE ON patch_comparison_screens BEGIN
    SELECT RAISE(ABORT, 'frozen comparison screen is immutable'); END;
  CREATE TRIGGER patch_comparison_screens_no_delete BEFORE DELETE ON patch_comparison_screens BEGIN
    SELECT RAISE(ABORT, 'frozen comparison screen is immutable'); END;
  CREATE TRIGGER patch_comparison_blocks_update_guard BEFORE UPDATE ON patch_comparison_blocks
  WHEN NEW.screen_id IS NOT OLD.screen_id OR NEW.task_id IS NOT OLD.task_id OR NEW.ordinal IS NOT OLD.ordinal
    OR NEW.arm_order IS NOT OLD.arm_order OR NEW.reservation_microusd IS NOT OLD.reservation_microusd
    OR NOT ((OLD.state = 'pending' AND NEW.state = 'reserved') OR (OLD.state = 'reserved' AND NEW.state = 'completed'))
  BEGIN SELECT RAISE(ABORT, 'comparison block admission is monotonic'); END;
  CREATE TRIGGER patch_comparison_blocks_no_delete BEFORE DELETE ON patch_comparison_blocks BEGIN
    SELECT RAISE(ABORT, 'comparison blocks cannot be deleted'); END;
  CREATE TRIGGER patch_comparison_assignments_update_guard BEFORE UPDATE ON patch_comparison_assignments
  WHEN NEW.screen_id IS NOT OLD.screen_id OR NEW.task_id IS NOT OLD.task_id OR NEW.arm IS NOT OLD.arm
    OR (OLD.run_id IS NOT NULL AND NEW.run_id IS NOT OLD.run_id)
    OR NEW.dispatch_claimed < OLD.dispatch_claimed
    OR (OLD.evaluation_json IS NOT NULL AND NEW.evaluation_json IS NOT OLD.evaluation_json)
  BEGIN SELECT RAISE(ABORT, 'comparison assignment is immutable after use'); END;
  CREATE TRIGGER patch_comparison_assignments_no_delete BEFORE DELETE ON patch_comparison_assignments BEGIN
    SELECT RAISE(ABORT, 'comparison assignments cannot be deleted'); END;
`;

/** Claim before starting a hidden evaluator. A missing outcome after a crash
 * remains unknown and must never silently rerun the same terminal submission. */
export const PATCH_COMPARISON_EVALUATION_CLAIM_SCHEMA = `
  CREATE TABLE patch_comparison_evaluation_claims (
    screen_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    arm TEXT NOT NULL CHECK (arm IN ('C','D','H')),
    claimed_at TEXT NOT NULL,
    PRIMARY KEY(screen_id, task_id, arm),
    FOREIGN KEY(screen_id, task_id, arm) REFERENCES patch_comparison_assignments(screen_id, task_id, arm)
  );
  CREATE TRIGGER patch_comparison_evaluation_claims_no_update BEFORE UPDATE ON patch_comparison_evaluation_claims BEGIN
    SELECT RAISE(ABORT, 'evaluation claims are append-only'); END;
  CREATE TRIGGER patch_comparison_evaluation_claims_no_delete BEFORE DELETE ON patch_comparison_evaluation_claims BEGIN
    SELECT RAISE(ABORT, 'evaluation claims are append-only'); END;
`;

/** Open blocks reserve all three episode caps, including their in-flight costs.
 * Their request costs must not be counted twice. Closed blocks revert to the
 * ordinary durable run totals, including unresolved maximum exposure.
 */
export function patchCampaignExposure(database: SoarDatabase): { microusd: number; coveredRunIds: Set<string> } {
  const covered = database.prepare(`SELECT a.run_id,'legacy/' || a.screen_id AS screen_id,a.task_id FROM patch_comparison_assignments a
    JOIN patch_comparison_blocks b USING(screen_id, task_id) WHERE b.state = 'reserved' AND a.run_id IS NOT NULL
    UNION ALL SELECT a.run_id,'routing/' || a.screen_id AS screen_id,a.task_id FROM patch_routing_assignments a
    JOIN patch_routing_blocks b USING(screen_id, task_id) WHERE b.state = 'reserved' AND a.run_id IS NOT NULL`).all() as { run_id: string; screen_id: string; task_id: string }[];
  const coveredRunIds = new Set(covered.map((row) => row.run_id));
  if (coveredRunIds.size !== covered.length) throw new Error("A run cannot be covered by multiple comparison blocks.");
  const holds = database.prepare(`SELECT 'legacy/' || screen_id AS screen_id,task_id,reservation_microusd FROM patch_comparison_blocks WHERE state = 'reserved'
    UNION ALL SELECT 'routing/' || screen_id AS screen_id,task_id,reservation_microusd FROM patch_routing_blocks WHERE state = 'reserved'`)
    .all() as { screen_id: string; task_id: string; reservation_microusd: number }[];
  const runBlocks = new Map(covered.map((row) => [row.run_id, `${row.screen_id}/${row.task_id}`]));
  const actuals = new Map<string, number>();
  const rows = database.prepare("SELECT id,snapshot_json FROM patch_runs").all() as { id: string; snapshot_json: string }[];
  let microusd = 0;
  for (const row of rows) {
    const run = JSON.parse(row.snapshot_json) as { spentMicrousd: number; reservedMicrousd: number };
    const exposure = run.spentMicrousd + run.reservedMicrousd;
    const block = runBlocks.get(row.id);
    if (block) actuals.set(block, (actuals.get(block) ?? 0) + exposure);
    else microusd += exposure;
  }
  for (const hold of holds) microusd += Math.max(hold.reservation_microusd, actuals.get(`${hold.screen_id}/${hold.task_id}`) ?? 0);
  if (!Number.isSafeInteger(microusd) || microusd < 0) throw new Error("Invalid campaign exposure.");
  return { microusd, coveredRunIds };
}
