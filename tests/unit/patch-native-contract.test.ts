import { describe, expect, it } from "vitest";
import { admitPreparedRequest } from "../../src/main/patch-runs/worker";
import { validateNativeCodingBody } from "../../src/main/patch-runs/native-contract";
import { nativeBody, nativePair, nativeRuntime, preparedNative, checkpoint } from "../helpers/patch-native-fixture";

const requestId = "a".repeat(32);
const local = { policy: "local_only" as const, phase: "local_solver" as const,
  checkpoint: checkpoint(undefined, { policy: "local_only", eventId: requestId, reason: "local_request_started",
    localCalls: 1, remainingLocalCalls: 23, evidence: { requestId, maxLocalCalls: 24, finishReserve: 2 } }) };
describe("native coding admission", () => {
  it("admits the exact checkpoint tools independently of the lower scout allowance", () => {
    expect(admitPreparedRequest(preparedNative(), nativeRuntime, local)).toMatchObject({ phase: "local", reservation: 0 });
    const body = nativeBody(); body.messages = [...body.messages as unknown[], ...nativePair()];
    expect(admitPreparedRequest(preparedNative(body), nativeRuntime, local).phase).toBe("local");
    expect(nativeRuntime.local!.maxOutputTokens).toBe(2048);
    expect(() => admitPreparedRequest(preparedNative({ ...body, max_tokens: 2048 }), nativeRuntime, local)).toThrow(/configuration/);
  });
  it("admits only the configured medium profile while preserving tools and historical evidence", () => {
    const { chat_template_kwargs: _disabled, ...medium } = nativeBody();
    medium.reasoning_effort = "medium";
    medium.messages = [...medium.messages as unknown[], ...nativePair()];
    const config = { ...nativeRuntime, localCodingThinking: "medium" as const };
    expect(admitPreparedRequest(preparedNative(medium), config, local).phase).toBe("local");
    validateNativeCodingBody(medium, config.workerPath, local.checkpoint.allowedActions, "medium");
    expect(() => admitPreparedRequest(preparedNative(medium), nativeRuntime, local)).toThrow();
    expect(() => admitPreparedRequest(preparedNative(), config, local)).toThrow();
    expect(() => admitPreparedRequest(preparedNative(medium), config, { ...local, policy: "local_first" })).toThrow(/local_only/);
    const mutations = [
      (body: any) => { delete body.reasoning_effort; },
      (body: any) => { body.reasoning_effort = "high"; },
      (body: any) => { body.chat_template_kwargs = { enable_thinking: false }; },
      (body: any) => { body.chat_template_kwargs = { enable_thinking: true }; },
      (body: any) => { body.chat_template_kwargs = null; },
      (body: any) => { body.thinking = { type: "enabled" }; },
      (body: any) => { body.max_tokens = 8193; },
      (body: any) => { body.messages[2].reasoning_content = "hidden fixture reasoning"; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(medium); mutate(changed);
      expect(() => admitPreparedRequest(preparedNative(changed), config, local)).toThrow();
    }
    expect(() => validateNativeCodingBody(medium, config.workerPath, local.checkpoint.allowedActions, "unknown" as never)).toThrow(/profile/);
  });
  it("uses canonical mask order without invalidating earlier command history", () => {
    for (const actions of [["run_command", "run_visible_checks", "request_help"], ["run_visible_checks", "request_help"], ["submit_task", "request_help"]]) {
      const body = nativeBody(actions); body.messages = [...body.messages as unknown[], ...nativePair()];
      validateNativeCodingBody(body, nativeRuntime.workerPath, [...actions].reverse());
      for (const mutate of [(value: any) => value.tools.reverse(), (value: any) => value.tools.pop(),
        (value: any) => value.tools.push(value.tools[0]), (value: any) => value.tools[0].function.description += " changed"]) {
        const changed = structuredClone(body); mutate(changed);
        expect(() => validateNativeCodingBody(changed, nativeRuntime.workerPath, actions)).toThrow();
      }
    }
    for (const actions of [[], ["unknown"], ["request_help", "request_help"]]) {
      expect(() => validateNativeCodingBody(nativeBody(), nativeRuntime.workerPath, actions)).toThrow();
    }
    const full = nativeBody(["run_command", "submit_task", "run_visible_checks", "request_help"]);
    validateNativeCodingBody(full, nativeRuntime.workerPath); // standalone calibration compatibility
    expect(() => admitPreparedRequest(preparedNative(full), nativeRuntime, local)).toThrow(/tools/);
  });
  it("rejects absent, foreign, stale and modified request checkpoint authority", () => {
    const initial = checkpoint(undefined, { policy: "local_only" });
    for (const cp of [undefined, initial, { ...local.checkpoint, policy: "local_first" as const },
      { ...local.checkpoint, eventId: "b".repeat(32) }, { ...local.checkpoint, allowedActions: ["request_help" as const] }]) {
      expect(() => admitPreparedRequest(preparedNative(), nativeRuntime, { ...local, checkpoint: cp })).toThrow();
    }
  });
  it("rejects schema, system, thinking, role, and raw-argument changes before dispatch", () => {
    const mutations: ((body: Record<string, unknown>) => void)[] = [
      (body) => { body.tools = []; }, (body) => { body.chat_template_kwargs = { enable_thinking: true }; },
      (body) => { body.parallel_tool_calls = true; }, (body) => { (body.messages as any[])[0].content += " Extra authority"; },
      (body) => { body.messages = [...body.messages as unknown[], { role: "tool", tool_call_id: "orphan", content: "x" }]; },
      (body) => { const pair = nativePair(); pair[1]!.tool_call_id = "other"; body.messages = [...body.messages as unknown[], ...pair]; },
      (body) => { body.messages = [...body.messages as unknown[], ...nativePair(), ...nativePair()]; },
      (body) => { body.messages = [...body.messages as unknown[], ...nativePair("call", "run_command", '{"command":"safe","command":"unsafe"}')]; },
      (body) => { body.messages = [...body.messages as unknown[], ...nativePair("call", "request_help", JSON.stringify({ reason: "中".repeat(400) }))]; },
      (body) => { body.messages = [...body.messages as unknown[], ...nativePair("call", "submit_task", "{}")]; },
      (body) => { const pair = nativePair(); (pair[0] as any).reasoning_content = "secret reasoning"; body.messages = [...body.messages as unknown[], ...pair]; },
    ];
    for (const mutate of mutations) {
      const body = nativeBody(); mutate(body);
      expect(() => validateNativeCodingBody(body, nativeRuntime.workerPath)).toThrow();
    }
  });
  it("never admits local native tools to cloud, planner, or scout phases", () => {
    for (const authority of [{ policy: "cloud", phase: "cloud_solver" }, { policy: "hybrid", phase: "local_investigation" },
      { policy: "cloud_plan_local", phase: "cloud_planner" }] as const) {
      expect(() => admitPreparedRequest(preparedNative(), nativeRuntime, authority)).toThrow(/phase/);
    }
    const input = preparedNative();
    expect(() => admitPreparedRequest({ ...input, phase: "cloud" }, nativeRuntime, { ...local, phase: "cloud_solver", cloudRecoveryCount: 1 })).toThrow(/phase/);
  });
  it("rejects either configured credential in local input and oversized native requests", () => {
    for (const text of [nativeRuntime.cloud!.apiKey, nativeRuntime.local!.apiKey, "x".repeat(256001)]) {
      const body = nativeBody(); (body.messages as any[])[1].content = text;
      expect(() => admitPreparedRequest(preparedNative(body), nativeRuntime, local)).toThrow();
    }
  });
  it("matches the independently emitted Python initial checkpoint hash", () => {
    expect(checkpoint().evidenceId).toBe("9c7171a3ec77973ec722af8e069193d93673d2de192e7b8dd5771bef7fc249ea");
  });
});
