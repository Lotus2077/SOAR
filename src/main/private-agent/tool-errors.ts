import { SANDBOX_ERROR_CODES, type SandboxErrorCode } from "./sandbox";

/**
 * Backlog item 3 (finding B5, BL-20261107-0901): the fixed, host-authored feedback a tool failure returns to the model, keyed on
 * a code, so the model gets a repair signal instead of one generic error. Every object is a host constant: no message, path,
 * command or provider text ever enters one. `actionInvoked` is stated only where the host knows it. None of these objects is
 * bound into the prompt protocol (binding would move `promptProtocolSha256` and end every paused task in `runtime_contract_drift`),
 * exactly like the generic object and the fetch-failure object before them. The observation verifier accepts the sandbox and
 * read_observation objects byte for byte (observations.ts), so their text is part of the persisted-event contract.
 */
export const GENERIC_TOOL_FAILURE = Object.freeze({ error: "action_failed_or_not_permitted", completed: false });

/** The host's own refusals: thrown by the runner and the observation module, mapped to their fixed object in the action catch. */
export const HOST_TOOL_ERROR_CODES = ["tool_unknown", "destination_denied", "consultation_unavailable", "observation_not_authorized", "observation_range_invalid",
  "public_fetch_limit_reached", "path_invalid", "execution_context_unavailable"] as const;
export type HostToolErrorCode = (typeof HOST_TOOL_ERROR_CODES)[number];
export type SandboxToolErrorCode = `sandbox_${SandboxErrorCode}`;
export type ToolErrorCode = HostToolErrorCode | SandboxToolErrorCode;
export const SANDBOX_TOOL_ERROR_CODES = SANDBOX_ERROR_CODES.map(code => `sandbox_${code}` as SandboxToolErrorCode);

/** A host-detected tool failure with a fixed code; the action catch maps it to its fixed feedback object. */
export class ToolError extends Error {
  constructor(readonly code: HostToolErrorCode) { super(code); this.name = "ToolError"; }
}

export interface ToolErrorFeedback { readonly error: ToolErrorCode; readonly completed: false; readonly actionInvoked?: boolean; readonly instruction?: string }
const feedback = (error: ToolErrorCode, instruction: string | undefined, actionInvoked?: boolean): ToolErrorFeedback =>
  Object.freeze({ error, completed: false as const, ...(actionInvoked === undefined ? {} : { actionInvoked }), ...(instruction === undefined ? {} : { instruction }) });
const RECREATED = "The host recreates the workspace from the last checkpoint, so changes since that checkpoint are not retained.";

export const TOOL_ERROR_FEEDBACK: Readonly<Record<ToolErrorCode, ToolErrorFeedback>> = Object.freeze({
  tool_unknown: feedback("tool_unknown", "This tool is not available in this task; nothing was invoked. Use only the tools defined in this request.", false),
  destination_denied: feedback("destination_denied", "That destinationId is not an admitted public retrieval destination of this context; nothing was sent. Use an admitted destination ID, or state the evidence limit.", false),
  consultation_unavailable: feedback("consultation_unavailable", "No consultation is configured for this task; nothing was sent. Continue with local work.", false),
  observation_not_authorized: feedback("observation_not_authorized", "No retained execute observation of this task matches that observationId and sha256; nothing was read. Use both exactly as the execute result reported them.", false),
  observation_range_invalid: feedback("observation_range_invalid", "The offset lies past the end of that stream; nothing was read. Use an offset of at most the stream's totalBytes.", false),
  // Unchanged from the pre-item-3 object (no instruction), so every recorded fetch refusal keeps its bytes.
  public_fetch_limit_reached: feedback("public_fetch_limit_reached", undefined, false),
  path_invalid: feedback("path_invalid", "The sandbox refused that path; nothing was changed. Use a workspace-relative path without a leading slash, '.', '..' or empty parts, at most 32 parts and 240 bytes, with no control characters or backslashes.", false),
  execution_context_unavailable: feedback("execution_context_unavailable", "The execution container could not be prepared from the last checkpoint, so nothing was invoked. The host tries again on the next action; repeat it.", false),
  sandbox_invalid_input: feedback("sandbox_invalid_input", "The sandbox refused the command before running it: a command must be valid UTF-8 without NUL characters and at most 65536 bytes. Nothing was executed.", false),
  sandbox_busy: feedback("sandbox_busy", "The sandbox was busy with another host operation; nothing was executed. Repeat the action.", false),
  sandbox_unusable: feedback("sandbox_unusable", `The execution container was no longer usable, so nothing was executed. ${RECREATED}`, false),
  sandbox_unavailable: feedback("sandbox_unavailable", `The container runtime failed during the action, and the host cannot tell whether the action ran. ${RECREATED} Redo the action and verify its result.`),
  sandbox_command_timeout: feedback("sandbox_command_timeout", `The action exceeded the host's deadline and was stopped; its effects may be partial. ${RECREATED}`, true),
  sandbox_cancelled: feedback("sandbox_cancelled", `The action was stopped by a host cancel or deadline, and the host cannot tell how far it ran. ${RECREATED}`),
  sandbox_output_limit: feedback("sandbox_output_limit", `A sandbox protocol reply exceeded its size limit and was refused. ${RECREATED}`),
  sandbox_unsafe_file: feedback("sandbox_unsafe_file", `The sandbox refused the file operation: the target was not a regular file, or the protocol reply was malformed. ${RECREATED}`),
  sandbox_cleanup_failed: feedback("sandbox_cleanup_failed", `The sandbox could not be cleaned up after a failure. ${RECREATED}`),
});
