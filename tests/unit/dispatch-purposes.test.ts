import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSULTATION_PURPOSE } from "../../src/main/private-agent/consultation";
import { ENTAILMENT_PURPOSE } from "../../src/main/private-agent/claims";
import { exactText } from "../../src/main/private-agent/contracts";
import { ASSIST_PURPOSES, PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE, assistStage, isAssistDispatch } from "../../src/main/private-agent/dispatch-purposes";
import { isBlockingDispatch, isResolvedDispatch, type DispatchStatus } from "../../src/main/private-agent/store";

const STAGE_PURPOSES = ["research source index", "research plan", "research evidence extraction", "research synthesis", "agent reasoning and tool selection", "public source retrieval"];

describe("assist dispatch purposes (backlog item 10)", () => {
  it("names two exact, distinct purposes that collide with no other purpose in use", () => {
    expect(ASSIST_PURPOSES).toEqual([PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE]);
    for (const purpose of ASSIST_PURPOSES) { expect(exactText(purpose)).toBe(purpose); expect(STAGE_PURPOSES).not.toContain(purpose); }
    expect(ASSIST_PURPOSES).not.toContain(ENTAILMENT_PURPOSE); expect(ASSIST_PURPOSES).not.toContain(CONSULTATION_PURPOSE);
    expect(new Set(ASSIST_PURPOSES).size).toBe(2);
  });
  it("recognises an assist row by its purpose only, and maps it to the stage it serves", () => {
    expect(isAssistDispatch({ purpose: PLAN_ASSIST_PURPOSE })).toBe(true); expect(isAssistDispatch({ purpose: SYNTHESIS_ASSIST_PURPOSE })).toBe(true);
    for (const purpose of [...STAGE_PURPOSES, ENTAILMENT_PURPOSE, undefined, null, 7, "Research Plan Assist", " research plan assist"]) expect(isAssistDispatch({ purpose })).toBe(false);
    expect(isAssistDispatch({})).toBe(false);
    expect(assistStage(PLAN_ASSIST_PURPOSE)).toBe("plan"); expect(assistStage(SYNTHESIS_ASSIST_PURPOSE)).toBe("synthesise");
    for (const purpose of [...STAGE_PURPOSES, undefined, ""]) expect(assistStage(purpose)).toBeUndefined();
  });
  it("blocks later work on every unresolved row except an unknown assist row", () => {
    const statuses: DispatchStatus[] = ["committed", "settled", "unknown", "superseded", "failed"];
    for (const status of statuses) {
      const resolved = isResolvedDispatch({ status });
      expect(isBlockingDispatch({ status, purpose: "research plan" })).toBe(!resolved);
      expect(isBlockingDispatch({ status, purpose: PLAN_ASSIST_PURPOSE })).toBe(!resolved && status !== "unknown");
    }
    expect(isBlockingDispatch({ status: "unknown" })).toBe(true);
    // With the writer's own context named, only another context's (the reading stage's) skipped assist is exempt.
    const skipped = { status: "unknown" as const, purpose: SYNTHESIS_ASSIST_PURPOSE, contextId: "reader" };
    expect(isBlockingDispatch(skipped, "writer")).toBe(false); expect(isBlockingDispatch(skipped, "reader")).toBe(true); expect(isBlockingDispatch(skipped)).toBe(false);
    expect(isBlockingDispatch({ ...skipped, status: "committed" }, "writer")).toBe(true);
  });
  it("is mirrored byte for byte by the registry row script", () => {
    const script = readFileSync(resolve(__dirname, "..", "..", "scripts", "registry-row.py"), "utf8");
    expect(script).toContain(`ASSIST_PURPOSES = ("${PLAN_ASSIST_PURPOSE}", "${SYNTHESIS_ASSIST_PURPOSE}")`);
  });
});
