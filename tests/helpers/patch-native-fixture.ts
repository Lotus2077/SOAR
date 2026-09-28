import { createHash } from "node:crypto";
import path from "node:path";
import type { PatchRunCheckpoint } from "../../src/shared/patch-run-contracts";
import type { PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import { canonicalRequest, loadNativeCodingContract } from "../../src/main/patch-runs/native-contract";

export const nativeRuntime: PatchRuntimeConfig = {
  mode: "live", enabled: true, python: "test-python", workerPath: path.join(process.cwd(), "runtime/patch-worker/worker.py"),
  image: "test-image", storageRoot: "/test/runs", episodeCapMicrousd: 5_000_000, campaignCapMicrousd: 70_000_000,
  stepLimit: 40, wallTimeSeconds: 600, maxOutputTokens: 4096, maxInputBytes: 512000,
  cloud: { id: "openai", protocol: "openai", endpoint: "https://cloud.invalid/chat/completions", model: "cloud-fixture", apiKey: "test-cloud-private",
    allowInsecureHttp: false, inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
  local: { id: "local", protocol: "openai", endpoint: "http://127.0.0.1:9999/chat/completions", model: "RM-01 VLM", apiKey: "test-local-private",
    allowInsecureHttp: true, inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxOutputTokens: 2048, maxInputBytes: 64000 },
};
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function nativeBody(allowedActions: readonly string[] = ["run_command", "run_visible_checks", "request_help"]): Record<string, unknown> {
  const contract = loadNativeCodingContract(nativeRuntime.workerPath);
  return { model: nativeRuntime.local!.model, messages: [{ role: "system", content: contract.system }, { role: "user", content: "Fix the public fixture." }],
    tools: contract.tools.filter(tool => allowedActions.includes(tool.function.name)), ...contract.requestProfile, max_tokens: 8192 };
}
export function preparedNative(body = nativeBody(), requestId = "a".repeat(32)) {
  const provider = nativeRuntime.local!;
  const encoded = canonicalRequest(body); const digest = hash(encoded);
  return { phase: "local", model: provider.model, requestId, maxOutputTokens: 8192,
    estimatedInputTokens: Buffer.byteLength(encoded), bodySha256: digest,
    provider: { id: provider.id, protocol: provider.protocol, endpoint: provider.endpoint },
    preparedRequest: { method: "POST", url: provider.endpoint, body, bodySha256: digest } };
}
export function nativePair(id = "call-1", name = "run_command", args = '{"command":"cat calculator.py"}') {
  return [{ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: args } }] },
    { role: "tool", tool_call_id: id, content: 'Exit code: 0\n{"returncode":0,"output":"public source"}' }];
}
export function checkpoint(previous?: PatchRunCheckpoint, overrides: Partial<PatchRunCheckpoint> = {}): PatchRunCheckpoint {
  const { evidenceId: _ignored, ...changes } = overrides;
  const value = { sequence: (previous?.sequence ?? 0) + 1, eventId: previous ? `event-${previous.sequence + 1}` : "initial",
    previousEvidenceId: previous?.evidenceId ?? null, policy: "local_first", state: "local", decision: "continue", reason: "initialized",
    localCalls: 0, remainingLocalCalls: 24, sourceSha256: "a".repeat(64), checkSourceSha256: null,
    failedChecks: 0, duplicateObservations: 0, handoffUsed: false, handoffCandidate: false,
    allowedActions: ["run_command", "run_visible_checks", "request_help"],
    evidence: { duplicateLimit: 3, failedCheckLimit: 2, finishReserve: 2, maxLocalCalls: 24,
      visibleCommandSha256: hash("python public_cases.py") }, ...changes } as Omit<PatchRunCheckpoint, "evidenceId">;
  if (overrides.allowedActions === undefined) {
    value.allowedActions = [];
    const remaining = value.remainingLocalCalls + (value.reason === "local_request_started" ? 1 : 0);
    if (value.state === "local" && remaining > 0) {
      if (remaining > 2) value.allowedActions.push("run_command");
      if (remaining >= 2) value.allowedActions.push("run_visible_checks");
      if (value.checkSourceSha256 === value.sourceSha256) value.allowedActions.push("submit_task");
      value.allowedActions.push("request_help");
    }
  }
  return { ...value, evidenceId: hash(canonicalRequest(value)) };
}
