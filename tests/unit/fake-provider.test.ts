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
  it("uses the newest grounded packet evidence after cross-evidence compaction", async () => {
    const packet = {
      evidence: [
        {
          kind: "tool_evidence",
          content: "Exact returned matches are represented by citationSnippets.",
          citationSnippets: [
            {
              citation: "SOAR_PROBE.txt:1",
              text: "SOAR-E2E-PROBE-91D7",
            },
          ],
        },
        {
          kind: "tool_evidence",
          content: "Complete file lines are represented by citationSnippets.",
        },
      ],
    };
    const result = await new FakeProvider({ delayMs: 0 }).complete({
      messages: [
        {
          role: "user",
          content: `SOAR_CONTEXT_PACKET_V1\n${JSON.stringify(packet)}`,
        },
      ],
      signal: new AbortController().signal,
      allowTools: false,
      onDelta: vi.fn(),
    });

    expect(result.content).toBe(
      "The workspace marker at SOAR_PROBE.txt:1 is SOAR-E2E-PROBE-91D7.",
    );
  });

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

    expect(result.content).toBe(
      "The workspace marker at SOAR_PROBE.txt:1 is probe.",
    );
    expect(deltas.join("")).toBe(result.content);
    expect(addListener).toHaveBeenCalledTimes(3);
    expect(removeListener).toHaveBeenCalledTimes(3);
  });

  it("honors the scheduler-selected Repository Investigator tool", async () => {
    const result = await new FakeProvider({ delayMs: 0 }).complete({
      messages: [],
      signal: new AbortController().signal,
      allowTools: true,
      allowedToolNames: ["search_text"],
      onDelta: vi.fn(),
    });

    expect(result.toolCalls).toEqual([
      {
        id: "fake-search_text",
        type: "function",
        function: {
          name: "search_text",
          arguments: JSON.stringify({ query: "SOAR" }),
        },
      },
    ]);
  });

  it("does not emit a fallback tool call when tools are disabled", async () => {
    const result = await new FakeProvider({ delayMs: 0 }).complete({
      messages: [],
      signal: new AbortController().signal,
      allowTools: false,
      onDelta: vi.fn(),
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("stop");
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
