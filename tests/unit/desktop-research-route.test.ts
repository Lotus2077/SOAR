import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SoarConfig } from "../../src/main/config";
import { DESKTOP_RESEARCH_ROUTE, DESKTOP_RESEARCH_WRITE_BOUND, desktopResearchAvailability, desktopResearchSession, isDesktopResearchRecord, readDesktopResearchCard,
  researchInputsCheck, researchStageView, researchWriteLimits } from "../../src/main/general-tasks/research-route";
import { GENERAL_TASK_BUDGETS } from "../../src/main/private-agent/profiles";
import { LOCAL_SCREEN_WRITE_BOUNDS } from "../../scripts/private-agent-local-screen";
import { RESEARCH_COVERAGE_POLICY, RESEARCH_PIPELINE_BUDGET } from "../../src/main/private-agent/research-contract";
import { researchRepairReserve } from "../../src/main/private-agent/research-admission";
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
    for (const cardAdmission of [false, true]) {
      expect(researchInputsCheck([], cardAdmission)).toBe("research_inputs_required");
      expect(researchInputsCheck([text("output/report.md")], cardAdmission)).toBe("research_inputs_required");
      expect(researchInputsCheck([text("input/01-notes.md"), text("input/02-data.csv", "value\n21\n")], cardAdmission)).toBe("fit");
      // The stage requires every source read in full, so one PDF, DOCX or binary input refuses the task.
      expect(researchInputsCheck([text("input/01-notes.md"), { path: "input/02-paper.pdf", bytes: Buffer.from("%PDF-1.7\n") }], cardAdmission)).toBe("research_source_unreadable");
      expect(researchInputsCheck([text("input/01-notes.md"), { path: "input/02-blob.bin", bytes: Buffer.from([0x41, 0x00, 0x42]) }], cardAdmission)).toBe("research_source_unreadable");
      expect(researchInputsCheck([text("input/01-notes.md"), text("input/01-notes.md")], cardAdmission)).toBe("research_input_invalid");
    }
    // The mandatory work must fit the pipeline's budget: as many extraction chunks as it has calls, or, under a card whose admission basis is
    // serving_card, as many as leave room for the stage's repair reserve (researchCardAdmission). One chunk more is refused either way.
    const { chunkBytes, overlapBytes } = RESEARCH_COVERAGE_POLICY, calls = RESEARCH_PIPELINE_BUDGET.extractionCalls;
    const long = (chunks: number, extra = 0) => [{ path: "input/01-long.txt", bytes: Buffer.alloc(chunkBytes + (chunks - 1) * (chunkBytes - overlapBytes) + extra, 0x61) }];
    let reserved = calls; while (reserved + researchRepairReserve(reserved) > calls) reserved--;
    expect(reserved).toBeLessThan(calls);
    expect(researchInputsCheck(long(calls), false)).toBe("fit");
    expect(researchInputsCheck(long(calls, 1), false)).toBe("research_mandatory_budget_exceeded");
    expect(researchInputsCheck(long(reserved), true)).toBe("fit");
    expect(researchInputsCheck(long(reserved, 1), true)).toBe("research_mandatory_budget_exceeded");
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

  it("keeps a research task's write phase in one named setting: the heavy profile's own by default, E2's twelve-call bound as the driver sets it", () => {
    const heavy = GENERAL_TASK_BUDGETS.heavy;
    expect(DESKTOP_RESEARCH_WRITE_BOUND).toBe("profile");
    expect(researchWriteLimits("profile", heavy)).toEqual({ modelCalls: heavy.modelCalls, toolCalls: heavy.toolCalls, elapsedMs: heavy.elapsedMs });
    const twelve = LOCAL_SCREEN_WRITE_BOUNDS["twelve-call"];
    expect(researchWriteLimits("twelve-call", heavy)).toEqual({ modelCalls: twelve.maxModelCalls, toolCalls: twelve.maxToolCalls, elapsedMs: twelve.maxElapsedMs });
    expect(twelve).toEqual({ maxModelCalls: 12, maxToolCalls: 12, maxElapsedMs: 1_200_000 });
  });

  it("gives the session the card's roles, its admission rates only under a serving_card basis, and its K, and nothing else", () => {
    const dir = workspace(), models = () => { throw new Error("not called"); };
    const plain = adopt(proposed(), undefined, { defaults: true }), read = readDesktopResearchCard(config(writeCard(dir, plain, "plain.json")));
    if (!read.accepted) throw new Error("card refused");
    expect(desktopResearchSession(read.card, models)).toEqual({ research: { models, roles: read.card.policy.roles }, localStreams: 1 });
    const admitted = adopt(proposed(), undefined, { defaults: true });
    (admitted as { admission: { basis: string } }).admission.basis = "serving_card"; admitted.concurrency.localStreams = 2;
    const second = readDesktopResearchCard(config(writeCard(dir, admitted, "admitted.json")));
    if (!second.accepted || second.card.policy.admission.basis !== "serving_card") throw new Error("card refused");
    expect(desktopResearchSession(second.card, models)).toEqual({ research: { models, roles: second.card.policy.roles, admission: second.card.policy.admission.rates }, localStreams: 2 });
  });

  it("shows the stage from its own events: not started, running, transferred or stopped, each stage's latest row, and the stage's requests", () => {
    const record = { route: DESKTOP_RESEARCH_ROUTE, cardSha256: "a".repeat(64), cardDate: "2026-11-17" }, card = { date: record.cardDate, sha256: record.cardSha256 };
    const input = { type: "research_input", contextId: "reader" };
    expect(researchStageView(record, [], [], false)).toEqual({ route: "local_beta", card, stage: "not_started", stages: [], requests: 0 });
    expect(researchStageView(record, [input], [], true)).toMatchObject({ stage: "not_started" });
    const plan = (calls: number, extra = {}) => ({ type: "research_stage", contextId: "reader", stage: "plan", calls, ...extra });
    const events = [input, { type: "research_stage", contextId: "reader", stage: "index", calls: 1, usage: {} }, plan(1), plan(2, { truncatedReplies: 2, fallback: "host_plan" }),
      { type: "research_stage", contextId: "reader", stage: "extract", calls: 5, chunksPlanned: 3, chunksComplete: 2, fallback: "other" },
      { type: "research_stage", contextId: "elsewhere", stage: "synthesise", calls: 9 }];
    const dispatches = [{ contextId: "reader" }, { contextId: "reader" }, { contextId: "writer" }];
    expect(researchStageView(record, events, dispatches, true)).toEqual({ route: "local_beta", card, stage: "running", requests: 2, stages: [
      { stage: "index", calls: 1 }, { stage: "plan", calls: 2, truncatedReplies: 2, fallback: "host_plan" }, { stage: "extract", calls: 5, chunksPlanned: 3, chunksComplete: 2 }] });
    expect(researchStageView(record, events, dispatches, false).stage).toBe("stopped");
    // A refused admission is a stage that stopped before any call.
    expect(researchStageView(record, [input, { type: "research_admission", contextId: "reader", admission: {} }], [], false).stage).toBe("stopped");
    expect(researchStageView(record, [...events, { type: "research_transfer", contextId: "reader" }], dispatches, false).stage).toBe("transferred");
    // Every count a stage records reaches the view, the proposed held counts included; the reserved gap is never set from the records.
    const all = { chunksPlanned: 7, chunksComplete: 6, repairCalls: 3, secondRepairCalls: 1, secondRepairsComplete: 1, quotesVerified: 9, quotesInPacket: 8, quotesLeftByCap: 1,
      quotesLeftByPresentation: 1, questionsTrimmed: 1, conflictsNoted: 2, conflictsInPacket: 1, heldChunks: 7, heldKeptUnrepaired: 6 };
    const full = researchStageView(record, [input, { type: "research_stage", contextId: "reader", stage: "extract", calls: 9, ...all, gap: { chunks: 1 } }], [], false);
    expect(full.stages).toEqual([{ stage: "extract", calls: 9, ...all }]); expect(full).not.toHaveProperty("gap");
    // Malformed counts are left out, never shown as numbers.
    expect(researchStageView(record, [input, { type: "research_stage", contextId: "reader", stage: "index", calls: -1, truncatedReplies: 1.5 }], [], false).stages).toEqual([{ stage: "index", calls: 0 }]);
  });
});
