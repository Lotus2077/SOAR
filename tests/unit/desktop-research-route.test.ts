import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SoarConfig } from "../../src/main/config";
import { DESKTOP_RESEARCH_ROUTE, desktopResearchAvailability, isDesktopResearchRecord, readDesktopResearchCard, researchInputsCheck } from "../../src/main/general-tasks/research-route";
import { RESEARCH_COVERAGE_POLICY, RESEARCH_PIPELINE_BUDGET } from "../../src/main/private-agent/research-contract";
import { loadServingCard, servingCardExpectation, type ServingCardV1 } from "../../src/main/private-agent/serving-card";
import { adopt, proposedServingCard, writeCard } from "../helpers/serving-card-fixture";
import { SYNTHETIC_P10_REQUEST_SETTINGS } from "../helpers/serving-probe-fixture";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
function workspace(): string { const root = mkdtempSync(join(tmpdir(), "soar-desktop-research-")); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; }

let writerCard: ServingCardV1 | undefined;
/** The writer's proposed card for the synthetic probe, written once and copied per use. */
const proposed = (): ServingCardV1 => structuredClone(writerCard ??= proposedServingCard());
/** The run settings the synthetic P10 recorded (its model alias, streaming on), with the beta flag and the card pair as given. */
function config(servingCard?: { path: string; sha256: string }, localResearchBeta = true): Pick<SoarConfig, "vllm" | "streamingEnabled" | "localResearchBeta"> {
  return { localResearchBeta, streamingEnabled: SYNTHETIC_P10_REQUEST_SETTINGS.streaming,
    vllm: { baseUrl: "http://127.0.0.1:9999/v1", apiKey: "unit-key", model: SYNTHETIC_P10_REQUEST_SETTINGS.model, costPolicy: "local_zero_cost", maxOutputTokens: 8192,
      timeoutMs: 300000, ...(servingCard ? { servingCard } : {}) } };
}
const text = (path: string, body = "A line of public text about the river.\n") => ({ path, bytes: Buffer.from(body) });

describe("desktop local research route (backlog item 13a)", () => {
  it("reads the configured card pair with the driver's pinned reader, always salted, and reports a refusal by its code only", () => {
    const dir = workspace(), card = adopt(proposed()), written = writeCard(dir, card);
    expect(readDesktopResearchCard(config())).toEqual({ accepted: false, code: "serving_card_unconfigured" });
    const read = readDesktopResearchCard(config(written));
    expect(read).toMatchObject({ accepted: true, card: { sha256: written.sha256, date: card.date } });
    // The very load the headless driver makes for a salted run.
    expect(read.accepted && read.card.policy).toEqual(loadServingCard(written, servingCardExpectation(config(written), true)).policy);
    // A card whose P10 was measured unsalted serves an unsalted reader, but not this one: research tasks always run salted.
    const unsalted = writeCard(dir, adopt(proposedServingCard(probe => { probe.P10.request_settings.cacheSalt = false; })), "unsalted.json");
    expect(() => loadServingCard(unsalted, servingCardExpectation(config(unsalted), false))).not.toThrow();
    expect(readDesktopResearchCard(config(unsalted))).toEqual({ accepted: false, code: "serving_card_p10_settings_drift" });
    // Every other refusal is the reader's own code, and nothing else: not the path, not the card's text.
    expect(readDesktopResearchCard(config({ path: written.path, sha256: "0".repeat(64) }))).toEqual({ accepted: false, code: "serving_card_pin_drift" });
    expect(readDesktopResearchCard(config(writeCard(dir, proposed(), "proposed.json")))).toEqual({ accepted: false, code: "serving_card_not_adopted" });
    const other = config(written); other.vllm.model = "another-model";
    expect(readDesktopResearchCard(other)).toEqual({ accepted: false, code: "serving_card_model_mismatch" });
  });

  it("decides the stage's refusals that are knowable before start on the input files, with the pipeline's own functions", () => {
    expect(researchInputsCheck([])).toBe("research_inputs_required");
    expect(researchInputsCheck([text("output/report.md")])).toBe("research_inputs_required");
    expect(researchInputsCheck([text("input/01-notes.md"), text("input/02-data.csv", "value\n21\n")])).toBe("fit");
    // The stage requires every source read in full, so one PDF, DOCX or binary input refuses the task.
    expect(researchInputsCheck([text("input/01-notes.md"), { path: "input/02-paper.pdf", bytes: Buffer.from("%PDF-1.7\n") }])).toBe("research_source_unreadable");
    expect(researchInputsCheck([text("input/01-notes.md"), { path: "input/02-blob.bin", bytes: Buffer.from([0x41, 0x00, 0x42]) }])).toBe("research_source_unreadable");
    expect(researchInputsCheck([text("input/01-notes.md"), text("input/01-notes.md")])).toBe("research_input_invalid");
    // The mandatory work must fit the pipeline's budget: as many extraction chunks as it has calls fit, one more does not.
    const { chunkBytes, overlapBytes } = RESEARCH_COVERAGE_POLICY, fits = chunkBytes + (RESEARCH_PIPELINE_BUDGET.extractionCalls - 1) * (chunkBytes - overlapBytes);
    expect(researchInputsCheck([{ path: "input/01-long.txt", bytes: Buffer.alloc(fits, 0x61) }])).toBe("fit");
    expect(researchInputsCheck([{ path: "input/01-long.txt", bytes: Buffer.alloc(fits + 1, 0x61) }])).toBe("research_mandatory_budget_exceeded");
  });

  it("offers the beta only while the flag is on, and says why it is or is not available without naming the card's path", () => {
    const dir = workspace(), card = adopt(proposed()), written = writeCard(dir, card);
    expect(desktopResearchAvailability(config(written, false))).toBeUndefined();
    expect(desktopResearchAvailability({ ...config(written), localResearchBeta: undefined })).toBeUndefined();
    expect(desktopResearchAvailability(config(written))).toEqual({ available: true, card: { date: card.date, sha256: written.sha256 },
      reason: "Local research (beta) reads your text files with the adopted serving card, on the local model only." });
    expect(desktopResearchAvailability(config())).toEqual({ available: false, code: "serving_card_unconfigured", reason: "Local research (beta) is off: no serving card is configured." });
    const refused = desktopResearchAvailability(config({ path: written.path, sha256: "0".repeat(64) }));
    expect(refused).toEqual({ available: false, code: "serving_card_pin_drift", reason: "Local research (beta) is off: the serving card was refused (serving_card_pin_drift)." });
    expect(JSON.stringify(refused)).not.toContain(dir);
  });

  it("recognises only the exact research record: the route, the card's hash and its date", () => {
    const record = { route: DESKTOP_RESEARCH_ROUTE, cardSha256: "a".repeat(64), cardDate: "2026-11-17" };
    expect(isDesktopResearchRecord(record)).toBe(true);
    for (const bad of [undefined, null, "local_beta", { ...record, route: "cloud" }, { ...record, cardSha256: "A".repeat(64) }, { ...record, cardSha256: "a".repeat(63) },
      { ...record, cardDate: "17 November 2026" }, { ...record, path: "card.json" }, { route: record.route, cardSha256: record.cardSha256 }]) {
      expect(isDesktopResearchRecord(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
