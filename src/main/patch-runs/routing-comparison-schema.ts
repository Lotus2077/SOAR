/** Additive tables: the original C/D/H schema and its migration checksum stay intact. */
export const PATCH_ROUTING_COMPARISON_SCHEMA = `
  CREATE TABLE patch_routing_screens (
    id TEXT PRIMARY KEY,
    manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256) = 64),
    configuration_sha256 TEXT NOT NULL CHECK(length(configuration_sha256) = 64),
    frozen_json TEXT NOT NULL,
    ceiling_microusd INTEGER NOT NULL CHECK(ceiling_microusd = 150000000),
    episode_microusd INTEGER NOT NULL CHECK(episode_microusd = 3000000),
    created_at TEXT NOT NULL
  );
  CREATE TABLE patch_routing_blocks (
    screen_id TEXT NOT NULL REFERENCES patch_routing_screens(id),
    task_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0 AND ordinal < 12),
    arm_order TEXT NOT NULL,
    reservation_microusd INTEGER NOT NULL CHECK(reservation_microusd = 9000000),
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','reserved','completed')),
    PRIMARY KEY(screen_id, task_id), UNIQUE(screen_id, ordinal)
  );
  CREATE TABLE patch_routing_assignments (
    screen_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    arm TEXT NOT NULL CHECK(arm IN ('C','L','E','P')),
    run_id TEXT UNIQUE REFERENCES patch_runs(id),
    dispatch_claimed INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_claimed IN (0,1)),
    evaluation_json TEXT,
    PRIMARY KEY(screen_id, task_id, arm),
    FOREIGN KEY(screen_id, task_id) REFERENCES patch_routing_blocks(screen_id, task_id)
  );
  CREATE TABLE patch_routing_evaluation_claims (
    screen_id TEXT NOT NULL, task_id TEXT NOT NULL,
    arm TEXT NOT NULL CHECK(arm IN ('C','L','E','P')), claimed_at TEXT NOT NULL,
    PRIMARY KEY(screen_id, task_id, arm),
    FOREIGN KEY(screen_id, task_id, arm) REFERENCES patch_routing_assignments(screen_id, task_id, arm)
  );
  CREATE TRIGGER patch_routing_screens_no_update BEFORE UPDATE ON patch_routing_screens BEGIN
    SELECT RAISE(ABORT, 'frozen routing screen is immutable'); END;
  CREATE TRIGGER patch_routing_screens_no_delete BEFORE DELETE ON patch_routing_screens BEGIN
    SELECT RAISE(ABORT, 'frozen routing screen is immutable'); END;
  CREATE TRIGGER patch_routing_blocks_update_guard BEFORE UPDATE ON patch_routing_blocks
  WHEN NEW.screen_id IS NOT OLD.screen_id OR NEW.task_id IS NOT OLD.task_id OR NEW.ordinal IS NOT OLD.ordinal
    OR NEW.arm_order IS NOT OLD.arm_order OR NEW.reservation_microusd IS NOT OLD.reservation_microusd
    OR NOT ((OLD.state = 'pending' AND NEW.state = 'reserved') OR (OLD.state = 'reserved' AND NEW.state = 'completed'))
  BEGIN SELECT RAISE(ABORT, 'routing block admission is monotonic'); END;
  CREATE TRIGGER patch_routing_blocks_no_delete BEFORE DELETE ON patch_routing_blocks BEGIN
    SELECT RAISE(ABORT, 'routing blocks cannot be deleted'); END;
  CREATE TRIGGER patch_routing_assignments_update_guard BEFORE UPDATE ON patch_routing_assignments
  WHEN NEW.screen_id IS NOT OLD.screen_id OR NEW.task_id IS NOT OLD.task_id OR NEW.arm IS NOT OLD.arm
    OR (OLD.run_id IS NOT NULL AND NEW.run_id IS NOT OLD.run_id)
    OR NEW.dispatch_claimed < OLD.dispatch_claimed
    OR (NEW.run_id IS NOT NULL AND NEW.dispatch_claimed <> 1)
    OR (OLD.evaluation_json IS NOT NULL AND NEW.evaluation_json IS NOT OLD.evaluation_json)
  BEGIN SELECT RAISE(ABORT, 'routing assignment is immutable after use'); END;
  CREATE TRIGGER patch_routing_assignments_no_delete BEFORE DELETE ON patch_routing_assignments BEGIN
    SELECT RAISE(ABORT, 'routing assignments cannot be deleted'); END;
  CREATE TRIGGER patch_routing_evaluation_claims_no_update BEFORE UPDATE ON patch_routing_evaluation_claims BEGIN
    SELECT RAISE(ABORT, 'routing evaluation claims are append-only'); END;
  CREATE TRIGGER patch_routing_evaluation_claims_no_delete BEFORE DELETE ON patch_routing_evaluation_claims BEGIN
    SELECT RAISE(ABORT, 'routing evaluation claims are append-only'); END;
  CREATE TRIGGER patch_routing_request_admission BEFORE INSERT ON patch_run_requests
  WHEN EXISTS(SELECT 1 FROM patch_routing_assignments WHERE run_id = NEW.run_id)
  BEGIN
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM patch_routing_assignments a
      JOIN patch_routing_blocks b USING(screen_id, task_id)
      JOIN patch_runs r ON r.id = a.run_id
      WHERE a.run_id = NEW.run_id AND b.state = 'reserved' AND a.dispatch_claimed = 1
        AND a.evaluation_json IS NULL
        AND json_extract(r.snapshot_json, '$.maxCostMicrousd') = 3000000
        AND json_extract(NEW.admission_json, '$.campaignLimitMicrousd') = 150000000
        AND json_extract(r.snapshot_json, '$.policy') = CASE a.arm
          WHEN 'C' THEN 'prepared_cloud' WHEN 'L' THEN 'local_only'
          WHEN 'E' THEN 'local_first' WHEN 'P' THEN 'cloud_plan_local' END
        AND (a.arm <> 'L' OR (NEW.reservation_microusd = 0
          AND json_extract(NEW.admission_json, '$.phase') = 'local'
          AND json_extract(NEW.admission_json, '$.providerLabel') LIKE 'local · %'))
    ) THEN RAISE(ABORT, 'routing request is outside its claimed block or local-only policy') END;
  END;
`;
