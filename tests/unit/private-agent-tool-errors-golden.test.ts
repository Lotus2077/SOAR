import { describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { GENERIC_TOOL_FAILURE, HOST_TOOL_ERROR_CODES, SANDBOX_TOOL_ERROR_CODES, TOOL_ERROR_FEEDBACK } from "../../src/main/private-agent/tool-errors";
import { captureNotice } from "../../src/main/private-agent/runner";

/**
 * BL-20261107-1006 (8): the fixed tool-error table is accepted by the observation verifier byte for byte, and the capture notice is
 * regenerated from the recorded event on every replay; neither is bound into the prompt protocol, by design (binding would end every
 * paused task in runtime_contract_drift). These pins make a change to either a deliberate, logged decision: move a digest or an object
 * here only with a build-log entry that says which recorded events or replayed conversations the change affects.
 */
describe("the fixed tool-error table and the capture notice are pinned (backlog item 3)", () => {
  it("keeps the table's keys and bytes", () => {
    expect(Object.keys(TOOL_ERROR_FEEDBACK).sort()).toEqual([...HOST_TOOL_ERROR_CODES, ...SANDBOX_TOOL_ERROR_CODES].sort());
    expect(HOST_TOOL_ERROR_CODES).toHaveLength(9); expect(SANDBOX_TOOL_ERROR_CODES).toHaveLength(9);
    expect(digest(canonical(GENERIC_TOOL_FAILURE))).toBe("a2761b0894a45f61ce29ec40e540d924c2f1fb860034da26756bf0fc4117f51b");
    expect(digest(canonical(TOOL_ERROR_FEEDBACK))).toBe("0c1c4267b267cb9f50481f89ba2a9e9432f8d40faeb5206aac44d13a9959960a");
    // `actionInvoked` is stated only where the host knows it (BL-20261107-1006, 6).
    expect(Object.entries(TOOL_ERROR_FEEDBACK).filter(([, item]) => item.actionInvoked === undefined).map(([code]) => code).sort())
      .toEqual(["sandbox_cancelled", "sandbox_cleanup_failed", "sandbox_output_limit", "sandbox_unavailable", "sandbox_unsafe_file", "sandbox_unusable", "verification_unavailable"]);
  });

  it("keeps the notice objects, canonical and identical live and on replay", () => {
    expect(captureNotice({})).toBeUndefined();
    expect(captureNotice({ executionCapture: "retained" })).toBeUndefined();
    expect(JSON.parse(captureNotice({ captureFailure: { code: "sandbox_unavailable" } })!)).toEqual({ error: "workspace_capture_failed", code: "sandbox_unavailable", completed: false, actionInvoked: true,
      instruction: "The action ran, but the host could not capture the workspace afterwards. The workspace was recreated from the last checkpoint, so every change since that checkpoint, this action's included, is not retained; rewrite what you need and verify it. The action's allowance was consumed." });
    expect(JSON.parse(captureNotice({ recheckCaptureFailure: { code: "checkpoint_write_failed" } })!)).toEqual({ recheck: { error: "workspace_capture_failed", code: "checkpoint_write_failed",
      instruction: "Before this action, the host could not capture the workspace to check it for changes; the workspace was recreated from the last checkpoint and the action was started against it (its result says how it ended), so changes made since that checkpoint by background processes were not retained." } });
    // The second recheck form (BL-20261107-1041, 11): after a failed recreation or invalid arguments nothing ran.
    expect(JSON.parse(captureNotice({ recheckCaptureFailure: { code: "sandbox_unavailable" }, executionCapture: "not_invoked" })!)).toEqual({ recheck: { error: "workspace_capture_failed", code: "sandbox_unavailable",
      instruction: "Before this action, the host could not capture the workspace to check it for changes; the host recreates the workspace from the last checkpoint, so changes made since that checkpoint by background processes are not retained. This action did not run, as its result says." } });
    for (const executionCapture of ["unavailable", "retained"]) expect(JSON.parse(captureNotice({ recheckCaptureFailure: { code: "sandbox_unavailable" }, executionCapture })!).recheck.instruction).toContain("the action was started against it");
    const omitted = { total: 2, reasons: { symlink: 1, oversize: 1 }, paths: ["venv/bin/python", "big.bin"], complete: true };
    expect(JSON.parse(captureNotice({ captureOmitted: omitted })!)).toEqual({ warning: "workspace_capture_incomplete", omitted: { ...omitted,
      instruction: "The checkpoint leaves these workspace entries out: links, special files, files over 64 MiB, names the host refuses, and files beyond the 1,024-file or 128 MiB caps are never retained, so a later checkpoint or resume will not have them. Keep required outputs as ordinary files within the caps." } });
    const all = captureNotice({ captureFailure: { code: "capture_failed" }, recheckCaptureFailure: { code: "sandbox_busy" }, captureOmitted: omitted })!;
    expect(all).toBe(canonical(JSON.parse(all)));
    expect(Object.keys(JSON.parse(all))).toEqual(["actionInvoked", "code", "completed", "error", "instruction", "omitted", "recheck", "warning"]);
  });
});
