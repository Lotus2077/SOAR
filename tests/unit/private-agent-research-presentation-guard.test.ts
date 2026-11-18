import { describe, expect, it, vi } from "vitest";
import type { PrivateAgentModel } from "../../src/main/private-agent/model";
import { runResearchPipeline } from "../../src/main/private-agent/research-pipeline";
import { researchV4Reply, researchV4Sources, RESEARCH_V4_TEST_BRIEF } from "../helpers/research-v4-fixture";

/**
 * 7(c) (the research v5 design entry, decision 13): the pipeline builds the writer's presentation before it calls a packet ready,
 * because session.ts builds it only after the transfer is durable, where a refusal would wedge every resume. A real oversized
 * packet needs about 40 sources and hundreds of quotes tagged to most questions (the design review's repro), so this file stubs
 * the builder to pin the wiring: the refusal's code ends the stage, and any other refusal maps to one fixed code.
 */
const refusal = vi.hoisted(() => ({ message: "" }));
vi.mock("../../src/main/private-agent/research-presentation", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/main/private-agent/research-presentation")>(),
  buildResearchPresentation: () => { throw new Error(refusal.message); },
}));

describe("7(c): the presentation check before a packet is called ready", () => {
  it("ends the stage with the presentation's refusal instead of returning a packet the writer could never receive", async () => {
    const model = { complete: async (messages: { content: string }[]) => ({ content: researchV4Reply(messages[0]!.content, messages[1]!.content), finishReason: "stop" }) } as unknown as PrivateAgentModel;
    const run = () => runResearchPipeline({ brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), models: { reader: model, planner: model, synthesiser: model }, signal: new AbortController().signal, record: () => {} });
    refusal.message = "research_presentation_too_large";
    expect(await run()).toMatchObject({ status: "incomplete", reason: "research_presentation_too_large" });
    refusal.message = "an unexpected failure with free text";
    expect(await run()).toMatchObject({ status: "incomplete", reason: "research_presentation_invalid" });
  });
});
