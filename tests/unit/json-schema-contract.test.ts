import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateJsonSchema } from "../../scripts/json-schema-contract.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8"));
}

describe("checked-in JSON Schema contracts", () => {
  it("accepts the public provider example including its schema pointer", async () => {
    const [example, schema] = await Promise.all([
      readJson("config/providers.example.json"),
      readJson("config/providers.schema.json"),
    ]);

    expect(
      validateJsonSchema(example, schema, {
        label: "config/providers.example.json",
      }),
    ).toEqual([]);
  });

  it("rejects unknown provider fields and missing zero-cost provenance", async () => {
    const schema = await readJson("config/providers.schema.json");
    const invalid = {
      providers: [
        {
          id: "invalid-local",
          adapter: "openai-compatible",
          baseUrlEnv: "LOCAL_BASE_URL",
          modelEnv: "LOCAL_MODEL",
          marginalPriceUsdPerMillionTokens: { input: 0, output: 0 },
          capabilities: ["tool-calling"],
          typo: true,
        },
      ],
      budget: {
        campaignUsdEnv: "CAMPAIGN_BUDGET",
        automaticStopUsdEnv: "AUTOMATIC_STOP",
        maxPaidEpisodeUsdEnv: "EPISODE_BUDGET",
        denyWhenProjectedCostExceedsRemainingBudget: true,
      },
    };

    expect(validateJsonSchema(invalid, schema)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unexpected property "typo"'),
        expect.stringContaining('missing required property "costPolicyEnv"'),
      ]),
    );
  });

  it("enforces workload enum, uniqueness, and additional-property rules", async () => {
    const schema = await readJson("benchmarks/workload.schema.json");
    const invalid = {
      id: "invalid-workload",
      track: "research",
      source: {
        dataset: "example/dataset",
        recordId: "id=1",
        url: "https://example.invalid/dataset",
        revision: "revision",
      },
      task: { delivery: "A result", fixture: "A fixture" },
      evaluator: { kind: "unknown", commandOrProtocol: "Run it" },
      tags: ["duplicate", "duplicate"],
      typo: true,
    };

    expect(validateJsonSchema(invalid, schema)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must be one of"),
        expect.stringContaining("items 0 and 1 must be unique"),
        expect.stringContaining('unexpected property "typo"'),
      ]),
    );
  });

  it("fails closed when a published schema adopts an unsupported keyword", () => {
    expect(() =>
      validateJsonSchema("value", { type: "string", maxLength: 5 }),
    ).toThrow(/unsupported schema keyword "maxLength"/u);
  });
});
