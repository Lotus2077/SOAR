import { describe, expect, it } from "vitest";

import { SessionRunner } from "../../src/main/agent/run-session";
import { loadConfig } from "../../src/main/config";
import { createSoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { OpenAICompatibleProvider } from "../../src/main/providers/openai-compatible";

const runLive = process.env.SOAR_RUN_LIVE_VLLM === "true";

describe.skipIf(!runLive)("live local vLLM canary", () => {
  it("streams through a workspace tool call and records a zero-cost route", async () => {
    const config = loadConfig();
    const database = createSoarDatabase();
    const store = new EventStore(database);
    const session = store.createSession({
      title: "Read the local probe",
      objective:
        "Use read_text_file to read SOAR_PROBE.txt. Return the exact marker from the file and no invented value.",
      workspaceRoot: new URL("../fixtures/workspace", import.meta.url).pathname,
    });
    const deltas: string[] = [];
    const runner = new SessionRunner({
      store,
      provider: new OpenAICompatibleProvider(config.vllm),
      limits: config.limits,
      onUpdate: (update) => {
        if (update.kind === "stream") deltas.push(update.delta);
      },
    });

    await runner.startSession(session.id);

    const final = store.requireSession(session.id);
    const events = store.getEvents(session.id);
    expect(final.status).toBe("completed");
    expect(final.result).toContain("SOAR-LOCAL-TOOL-PROBE-6F4A2C");
    expect(events.some((event) => event.type === "tool.call.completed")).toBe(true);
    expect(events.some((event) => event.type === "route.assigned")).toBe(true);
    const usage = events.filter((event) => event.type === "usage.recorded");
    expect(usage).not.toHaveLength(0);
    expect(
      usage.every(
        (event) =>
          event.payload.costUsd === 0 &&
          event.payload.costProvenance === "local_zero_cost_policy",
      ),
    ).toBe(true);
    expect(final.totalCostUsd).toBe(0);
    expect(deltas.join("")).toContain("SOAR-LOCAL-TOOL-PROBE-6F4A2C");
    database.close();
  });
});
