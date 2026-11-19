import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { researchProtocolSha256 } from "../../src/main/private-agent/research-pipeline";
import { loadServingCard, servingCardExpectation } from "../../src/main/private-agent/serving-card";
import { localScreenCardResearch } from "../../scripts/private-agent-local-screen";
import { ADOPTED_CARD_RESEARCH_PROTOCOL_SHA256, RESEARCH_PROTOCOL_SHA256 } from "../helpers/research-protocol-pin";

const ROOT = resolve(__dirname, "..", "..");

describe("the research protocol under the adopted serving card of 2026-11-18", () => {
  it("binds the card's roles and admission to the pinned hash, and the default stays pinned", () => {
    const path = resolve(ROOT, "docs", "experiments", "serving-card-2026-11-18.json"), bytes = readFileSync(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(sha256).toBe("9cd65c4e6f4872758098a6177bd66fd971e3fe0b4e81906b2542ee2c46b963ca");
    // The card is read as a run reads it: with the expectation its own P10 request settings give.
    const settings = JSON.parse(bytes.toString("utf8")).evidence.p10.requestSettings;
    const config = { vllm: { model: settings.model, localReplyContract: settings.localReplyContract ?? undefined, localContextTokens: settings.localContextTokens ?? undefined },
      streamingEnabled: settings.streaming } as Parameters<typeof servingCardExpectation>[0];
    const card = loadServingCard({ path, sha256 }, servingCardExpectation(config, settings.cacheSalt));
    const research = localScreenCardResearch(card, "local");
    expect(research.pipeline.protocolSha256).toBe(ADOPTED_CARD_RESEARCH_PROTOCOL_SHA256);
    expect(research.pipeline.admission?.basis).toBe("serving_card");
    expect(researchProtocolSha256()).toBe(RESEARCH_PROTOCOL_SHA256);
  });
});
