import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// R3 (SC), part way: the state after item 7(a)'s caps-and-thinking PR alone, the state each consumer PR creates. Only the
// maxOutputTokens and thinking flags are true here, by mocking the flags module; every later value must still be refused.
vi.mock("../../src/main/private-agent/serving-card-flags", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/main/private-agent/serving-card-flags")>();
  return { ...original, SERVING_CARD_CONSUMED: Object.freeze({ maxOutputTokens: true, thinking: true, structuredOutput: false, localStreams: false, admission: false }) };
});

import { SERVING_CARD_CONSUMED, ServingCardError, loadServingCard, type ServingCardV1 } from "../../src/main/private-agent/serving-card";
import { ADOPTING_ENTRY, adopt, proposedServingCard, writeCard } from "../helpers/serving-card-fixture";
import { SYNTHETIC_P10_REQUEST_SETTINGS } from "../helpers/serving-probe-fixture";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
let writerCard: ServingCardV1 | undefined;
/** An adopted all-default card of the writer's, edited by `edit`, whose evidence passes every gate the edits below reach. */
function card(edit: (card: any) => void): ServingCardV1 {
  const value = adopt(structuredClone(writerCard ??= proposedServingCard()), ADOPTING_ENTRY, { defaults: true }); edit(value); return value;
}
function load(value: ServingCardV1) {
  const root = mkdtempSync(join(tmpdir(), "soar-card-partial-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return loadServingCard(writeCard(root, value), { model: "RM-01 VLM", requestSettings: { ...SYNTHETIC_P10_REQUEST_SETTINGS } });
}
function refusal(value: ServingCardV1): ServingCardError {
  try { load(value); } catch (error) { if (error instanceof ServingCardError) return error; throw error; }
  throw new Error("expected a ServingCardError");
}
const caps = (value: any) => { value.roles.plan.maxOutputTokens = [4096, 8192]; value.roles.synthesis.thinking = ["disabled", "model"]; };

describe("serving-card reader with only item 7(a)'s flags flipped (flags mocked)", () => {
  it("R3: accepts consumed caps and thinking, and still refuses each later unconsumed value behind them", () => {
    expect(SERVING_CARD_CONSUMED).toEqual({ maxOutputTokens: true, thinking: true, structuredOutput: false, localStreams: false, admission: false });
    expect(load(card(caps)).policy.roles).toMatchObject({ plan: { maxOutputTokens: [4096, 8192] }, synthesis: { thinking: ["disabled", "model"] } });
    // Every unconsumed value is refused, not only the first non-default one: the caps come first in the reader's order.
    const later: [string, (value: any) => void][] = [
      ["roles.extract.structuredOutput", value => { value.roles.extract.structuredOutput = { variant: "strict", thinkingOff: true, thinkingOn: false }; }],
      ["concurrency.localStreams", value => { value.concurrency.localStreams = 4; }],
      ["admission.basis", value => { value.admission.basis = "serving_card"; }],
    ];
    for (const [at, edit] of later) {
      expect(refusal(card(value => { caps(value); edit(value); }))).toMatchObject({ code: "serving_card_parameter_unconsumed", parameter: at });
      expect(refusal(card(edit))).toMatchObject({ code: "serving_card_parameter_unconsumed", parameter: at });
    }
  });
});
