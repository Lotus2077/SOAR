import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// R3 (SC): the consumer PRs' view. Every consumed flag is true here, by mocking the flags module, the only way to flip one;
// no production code path can override a flag.
vi.mock("../../src/main/private-agent/serving-card-flags", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/main/private-agent/serving-card-flags")>();
  return { ...original, SERVING_CARD_CONSUMED: Object.freeze({ maxOutputTokens: true, thinking: true, structuredOutput: true, localStreams: true, admission: true }) };
});

import { SERVING_CARD_CONSUMED, ServingCardError, loadServingCard, type ServingCardV1 } from "../../src/main/private-agent/serving-card";
import { ADOPTING_ENTRY, adopt, proposedServingCard, writeCard } from "../helpers/serving-card-fixture";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
let writerCard: ServingCardV1 | undefined;
function card(edit: (card: any) => void): ServingCardV1 {
  const value = adopt(structuredClone(writerCard ??= proposedServingCard()), ADOPTING_ENTRY, { defaults: true }); edit(value); return value;
}
function load(value: ServingCardV1) {
  const root = mkdtempSync(join(tmpdir(), "soar-card-consumed-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return loadServingCard(writeCard(root, value), { model: "RM-01 VLM" });
}
function code(value: ServingCardV1): string | undefined {
  try { load(value); return undefined; } catch (error) { if (error instanceof ServingCardError) return error.code; throw error; }
}

describe("serving-card reader once every consumer has merged (flags mocked true)", () => {
  it("R3: resolves accepted caps, per-attempt thinking, structured output, K and admission into the policy", () => {
    expect(Object.values(SERVING_CARD_CONSUMED).every(Boolean)).toBe(true);
    const loaded = load(card(value => {
      value.roles.plan.maxOutputTokens = [4096, 8192]; value.roles.plan.thinking = ["disabled", "model"];
      value.roles.extract.structuredOutput = { variant: "strict", thinkingOff: true, thinkingOn: true };
      value.concurrency.localStreams = 4; value.admission.basis = "serving_card";
    }));
    expect(loaded.policy.roles.plan).toEqual({ maxOutputTokens: [4096, 8192], thinking: ["disabled", "model"], structuredOutput: null });
    expect(loaded.policy.roles.extract.structuredOutput).toEqual({ variant: "strict", thinkingOff: true, thinkingOn: true });
    expect(loaded.policy).toMatchObject({ localStreams: 4, admission: { basis: "serving_card" } });
  });

  it("R3: the boundaries hold: 19/20 passes and 18/20 fails, 20 calls pass and 19 fail, caps 128 and 16,384 pass and 127 and 16,385 fail", () => {
    const flagged = (counts: Record<string, number>) => card(value => {
      value.roles.extract.structuredOutput = { variant: "strict", thinkingOff: true, thinkingOn: false };
      Object.assign(value.evidence.p10.cells["extract/off"], counts);
    });
    expect(code(flagged({ total: 20, valid: 19, truncated: 1 }))).toBeUndefined();
    expect(code(flagged({ total: 20, valid: 18, truncated: 2 }))).toBe("serving_card_structured_output_below_rule");
    expect(code(flagged({ total: 20, valid: 20 }))).toBeUndefined();
    expect(code(flagged({ total: 19, valid: 19 }))).toBe("serving_card_structured_output_below_rule");
    const capped = (caps: [number, number]) => card(value => { value.roles.index.maxOutputTokens = caps; });
    expect(load(capped([128, 16_384])).policy.roles.index.maxOutputTokens).toEqual([128, 16_384]);
    expect(code(capped([127, 1536]))).toBe("serving_card_cap_out_of_range");
    expect(code(capped([1536, 16_385]))).toBe("serving_card_cap_out_of_range");
    // The evidence gates still refuse what the flags would admit.
    expect(code(card(value => { value.concurrency.localStreams = 4; value.evidence.p11.kStreams["4"].errors = 1; }))).toBe("serving_card_streams_unproven");
  });
});
