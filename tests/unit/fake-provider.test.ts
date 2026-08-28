import { describe, expect, it, vi } from "vitest";

import { FakeProvider } from "../../src/main/providers/fake-provider";
import type { ProviderAbortedError } from "../../src/main/providers/types";

function toolResultMessages(text = "probe") {
  return [
    {
      role: "tool" as const,
      content: JSON.stringify({ text }),
      tool_call_id: "read-probe",
    },
  ];
}

describe("FakeProvider", () => {
  it("removes abort listeners after each completed delay", async () => {
    const signal = new AbortController().signal;
    const addListener = vi.spyOn(signal, "addEventListener");
    const removeListener = vi.spyOn(signal, "removeEventListener");
    const deltas: string[] = [];

    const result = await new FakeProvider({ delayMs: 0 }).complete({
      messages: toolResultMessages(),
      signal,
      onDelta: (delta) => deltas.push(delta),
    });

    expect(result.content).toBe("The workspace marker is probe.");
    expect(deltas.join("")).toBe(result.content);
    expect(addListener).toHaveBeenCalledTimes(3);
    expect(removeListener).toHaveBeenCalledTimes(3);
  });

  it("rejects an already-aborted completion without streaming output", async () => {
    const controller = new AbortController();
    controller.abort();
    const onDelta = vi.fn();

    await expect(
      new FakeProvider({ delayMs: 0 }).complete({
        messages: toolResultMessages(),
        signal: controller.signal,
        onDelta,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProviderAbortedError>>({
        name: "ProviderAbortedError",
        partialContent: "",
        abortKind: "cancelled",
      }),
    );
    expect(onDelta).not.toHaveBeenCalled();
  });
});
