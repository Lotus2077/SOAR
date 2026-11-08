import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { diagnosticRetention, restrictedContext, syntheticContext, type PrivateAgentContext, type PrivateAgentSource } from "../../src/main/private-agent/contracts";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

const h = (n: string) => n.repeat(64);
const source = (id: string, classification: PrivateAgentSource["classification"], synthetic: boolean): PrivateAgentSource => ({ id, version: h("a"), classification, synthetic });
const context = (...sources: PrivateAgentSource[]): PrivateAgentContext => ({ id: "ctx", jobId: "job", sources });
const PUBLIC = source("public", "public", false), SYNTHETIC = source("synthetic", "private", true), LABELLED = source("labelled", "private", false), CREDENTIAL = source("credential", "credential", true);

describe("backlog item 4: diagnostic retention is a function of the persisted context alone", () => {
  it.each([
    ["wholly public sources", [PUBLIC], "raw"],
    ["synthetic-attested private sources (the headless driver's lineage)", [SYNTHETIC], "raw"],
    ["public beside synthetic", [PUBLIC, SYNTHETIC], "raw"],
    ["one labelled source", [LABELLED], "hash_only"],
    ["public beside one labelled source", [PUBLIC, LABELLED], "hash_only"],
    ["synthetic beside one labelled source", [SYNTHETIC, LABELLED], "hash_only"],
    ["a credential source, even one marked synthetic", [PUBLIC, CREDENTIAL], "hash_only"],
  ] as const)("%s -> %s", (_name, sources, expected) => {
    const value = context(...sources);
    expect(diagnosticRetention(value)).toBe(expected);
    // The predicate is exactly the synthetic-lineage predicate the broker already applies: raw iff syntheticContext.
    expect(diagnosticRetention(value) === "raw").toBe(syntheticContext(value));
  });
  it("is not the restricted predicate: a synthetic-attested private context is restricted and still raw", () => {
    expect(restrictedContext(context(SYNTHETIC))).toBe(true); expect(diagnosticRetention(context(SYNTHETIC))).toBe("raw");
    expect(restrictedContext(context(PUBLIC))).toBe(false); expect(diagnosticRetention(context(PUBLIC))).toBe("raw");
  });
  it("is monotonic through the store: a labelled source added later makes a raw context hash-only for good", () => {
    const db = new Database(":memory:"), store = new PrivateAgentStore(db);
    try {
      store.createJob({ version: 1, id: "job", mode: "private", revision: 0, cancelled: false, destinations: ["owned"], maxRequests: 10, maxFeeMicrousd: 0 });
      store.createContext({ id: "ctx", jobId: "job", sources: [SYNTHETIC] });
      expect(diagnosticRetention(store.context("ctx"))).toBe("raw");
      store.addSources("ctx", [PUBLIC]);
      expect(diagnosticRetention(store.context("ctx"))).toBe("raw");
      store.addSources("ctx", [LABELLED]);
      expect(diagnosticRetention(store.context("ctx"))).toBe("hash_only");
      // Nothing removes a source: re-adding the synthetic and public ones changes nothing, and the taint stays.
      store.addSources("ctx", [SYNTHETIC, PUBLIC]);
      expect(diagnosticRetention(store.context("ctx"))).toBe("hash_only");
      expect(store.context("ctx").sources.map(item => item.id)).toEqual(["synthetic", "public", "labelled"]);
    } finally { db.close(); }
  });
});
