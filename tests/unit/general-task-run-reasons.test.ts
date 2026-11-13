import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJECTION_ONLY_REASONS, RUNNER_CONTRACT_ERRORS, RUN_REASONS, RUN_REASON_SHAPE, TASK_INTEGRITY_ERRORS, TERMINAL_RUN_REASON_PREFIXES,
  TERMINAL_RUN_REASON_SUFFIXES, caughtRunReason, classifiedRunReason, isResumableRunReason, runReasonClass, storedRunReason } from "../../src/main/general-tasks/run-reasons";
import { scanRunReasons } from "../helpers/run-reason-scan";

describe("backlog item 6 (finding A6): the run-reasons table", () => {
  it("reads an exact entry first, then the terminal prefix and suffix rules, then a public-phase form, and treats anything else as terminal", () => {
    expect(runReasonClass("interrupted")).toBe("resumable");
    expect(runReasonClass("runtime_unavailable")).toBe("resumable");
    expect(runReasonClass("task_integrity_failed")).toBe("terminal");
    for (const reason of ["research_stage_not_replayed", "research_cancelled", "research_a_future_code", "session_deadline", "session_stopped",
      "unresolved_dispatch_no_replay", "unresolved_operation_no_replay", "cancelled_before_completion", "deadline_before_completion"]) {
      expect(classifiedRunReason(reason)).toBe("terminal"); expect(isResumableRunReason(reason)).toBe(false);
    }
    // An exact entry wins over a prefix; a public-phase form takes the class of the reason it prefixes.
    expect(classifiedRunReason("research_packet_ready")).toBe("not_a_stop");
    expect(classifiedRunReason("public_model_unavailable")).toBe("resumable");
    expect(classifiedRunReason("public_cancelled_or_deadline")).toBe("resumable");
    expect(classifiedRunReason("public_session_stopped")).toBe("terminal");
    expect(classifiedRunReason("public_retrieval_receipt_missing")).toBe("terminal");
    expect(classifiedRunReason("public_a_reason_no_pull_request_classified")).toBeUndefined();
    // Unclassified, legacy and malformed values are terminal, and a prototype key is never an entry.
    for (const reason of ["incomplete", "a_reason_no_pull_request_classified", "constructor", "toString", "__proto__", "Not A Code", "", "x".repeat(97), "model unavailable"]) {
      expect(isResumableRunReason(reason)).toBe(false); expect(runReasonClass(reason)).toBe("terminal");
    }
    for (const reason of ["a_reason_no_pull_request_classified", "constructor", "hasOwnProperty"]) expect(classifiedRunReason(reason)).toBeUndefined();
  });

  it("pins the resumable set, and no exact resumable entry is one a terminal rule would also cover", () => {
    const resumable = Object.keys(RUN_REASONS).filter(isResumableRunReason).sort();
    expect(resumable).toEqual(["cancelled_or_deadline", "checkpoint_saved", "cleanup_required", "consultation_pending", "consultation_ready",
      "execution_context_unavailable", "interrupted", "job_already_completed", "job_context_busy", "model_output_incomplete", "model_unavailable",
      "one_complete_tool_action_required", "orphan_cleanup_required", "packet_scan_unavailable", "paused", "runtime_failure_progress_preserved", "runtime_unavailable"]);
    for (const reason of resumable) {
      expect(TERMINAL_RUN_REASON_PREFIXES.some(prefix => reason.startsWith(prefix)), reason).toBe(false);
      expect(TERMINAL_RUN_REASON_SUFFIXES.some(suffix => reason.endsWith(suffix)), reason).toBe(false);
    }
    for (const reason of Object.keys(RUN_REASONS)) expect(reason).toMatch(RUN_REASON_SHAPE);
    for (const reason of PROJECTION_ONLY_REASONS) expect(Object.hasOwn(RUN_REASONS, reason)).toBe(false);
  });

  it("stores a code-shaped stop as itself and anything else as the legacy incomplete", () => {
    expect(storedRunReason("runtime_failure_progress_preserved")).toBe("runtime_failure_progress_preserved");
    expect(storedRunReason("a_future_reason")).toBe("a_future_reason");
    expect(storedRunReason(`a${"x".repeat(95)}`)).toBe(`a${"x".repeat(95)}`);
    for (const value of ["Model_unavailable", "model-unavailable", "1_reason"]) expect(storedRunReason(value)).toBe("incomplete");
    // A submitted session result the controller could not confirm (cleanup, uncertainty or a missing submission) is no stop of its own.
    expect(storedRunReason("independent_acceptance_pending")).toBe("incomplete");
    for (const value of ["Some Text", "", "x".repeat(97), "line\nbreak", "interrupted_unknown", "consultation_uncertain", "consultation_failed", 7, undefined, null]) {
      expect(storedRunReason(value)).toBe("incomplete");
    }
  });

  it("records a thrown error as a configuration change, an integrity failure, the session's own code or a resumable runtime_unavailable", () => {
    expect(caughtRunReason(new Error("general_task_configuration_changed"))).toBe("configuration_changed");
    for (const code of TASK_INTEGRITY_ERRORS) expect(caughtRunReason(new Error(code))).toBe("task_integrity_failed");
    expect([...TASK_INTEGRITY_ERRORS].sort()).toEqual(["checkpoint_digest_mismatch", "checkpoint_directory_invalid", "checkpoint_file_invalid",
      "checkpoint_path_invalid", "checkpoint_size_exceeded", "general_task_context_changed", "general_task_input_changed", "general_task_storage_changed",
      "public_source_context_invalid", "public_source_duplicate", "public_source_identity_invalid"]);
    // 6.3: the observation and progress checks wrap environmental errors too (a permission error, a busy store), so their codes stay resumable.
    for (const code of ["execution_observation_integrity_failed", "execution_progress_integrity_failed"]) expect(caughtRunReason(new Error(code))).toBe("runtime_unavailable");
    // Each code is still thrown where the table says, so renaming it there cannot quietly make the failure resumable.
    const thrown = ["src/main/private-agent/checkpoints.ts", "src/main/general-tasks/controller.ts", "src/main/private-agent/public-sources.ts"]
      .map(file => readFileSync(file, "utf8")).join("\n");
    for (const code of TASK_INTEGRITY_ERRORS) expect(thrown, code).toContain(`new Error("${code}")`);
    const runner = readFileSync("src/main/private-agent/runner.ts", "utf8");
    for (const code of RUNNER_CONTRACT_ERRORS) expect(runner, code).toContain(`new Error("${code}")`);
    for (const code of ["session_completed_snapshot_drift", "session_context_drift", "research_producer_unsettled_receipt", "research_presentation_drift"]) {
      expect(caughtRunReason(new Error(code))).toBe(code); expect(runReasonClass(code)).toBe("terminal");
    }
    for (const error of [new Error("session_already_running"), new Error("checkpoint_write_failed"), new Error("general_task_image_unavailable"),
      new Error("general_task_profile_unavailable"), new Error("ENOENT: no such file or directory"), new Error("Session Text"), new Error("session_x free text /tmp/y"),
      "not an error", undefined]) {
      expect(caughtRunReason(error)).toBe("runtime_unavailable");
    }
    expect(isResumableRunReason("runtime_unavailable")).toBe(true);
    // The runner's contract refusals are kept as themselves and are terminal.
    for (const code of RUNNER_CONTRACT_ERRORS) { expect(caughtRunReason(new Error(code))).toBe(code); expect(classifiedRunReason(code)).toBe("terminal"); }
    // A missing file or directory under the storage root is an integrity failure; one elsewhere (the docker CLI, say) is not.
    const missing = (path: string) => Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), { code: "ENOENT", path });
    expect(caughtRunReason(missing("/data/tasks/checkpoints/a/b"), "/data/tasks")).toBe("task_integrity_failed");
    expect(caughtRunReason(missing("/data/tasks"), "/data/tasks")).toBe("task_integrity_failed");
    expect(caughtRunReason(missing("/data/tasks-other/x"), "/data/tasks")).toBe("runtime_unavailable");
    expect(caughtRunReason(missing("/usr/local/bin/docker"), "/data/tasks")).toBe("runtime_unavailable");
    expect(caughtRunReason(missing("/data/tasks/checkpoints/a/b"))).toBe("runtime_unavailable");
  });

  it("classifies every reason the runner, the research pipeline, the session and the controller can record (the run-reasons contract test)", () => {
    const sites = scanRunReasons(), edit = "classify it in src/main/general-tasks/run-reasons.ts";
    for (const site of sites) {
      const where = `${site.file}:${site.line} ${site.reason}`, kind = classifiedRunReason(site.reason);
      expect(kind, `${where}: ${edit}`).toBeDefined();
      if (site.status === "completion") expect(kind, where).toBe("not_a_stop");
      if (site.status === "stop") { expect(kind, where).not.toBe("not_a_stop"); expect(storedRunReason(site.reason), where).toBe(site.reason); }
    }
    // The scan reads what it should: one sentinel from each source and each kind of site.
    const found = new Set(sites.map(site => `${site.status}:${site.reason}`));
    for (const sentinel of ["stop:job_context_busy", "stop:repeated_incomplete_tool_arguments_at_output_limit", "stop:model_unavailable", "stop:research_request_denied",
      "stop:research_cancelled", "stop:session_policy_drift", "stop:session_stopped", "stop:public_model_unavailable", "stop:research_stage_not_replayed",
      "completion:critical_checks_passed", "completion:research_packet_ready", "completion:independent_acceptance_pending",
      "record:interrupted", "record:queued", "record:cleanup_in_progress", "record:task_integrity_failed", "record:runtime_unavailable",
      "stop:public_session_stopped", "record:general_job_contract_invalid"]) expect(found.has(sentinel), sentinel).toBe(true);
  });
});
