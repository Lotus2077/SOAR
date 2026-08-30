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
      readJson("config/providers.readiness.example.json"),
      readJson("config/providers.readiness.schema.json"),
    ]);

    expect(
      validateJsonSchema(example, schema, {
        label: "config/providers.readiness.example.json",
      }),
    ).toEqual([]);
    expect(example).toMatchObject({
      status: "non_runtime_snapshot",
      purpose: "non_runtime_provider_and_campaign_planning_snapshot",
      runtimeProviders: [
        {
          status: "implemented_runtime_input_map",
          id: "local-vllm",
          capabilities: [
            "chat_completions",
            "reasoning_effort",
            "streaming",
            "structured_json_schema",
            "tool_calling",
          ],
        },
      ],
      proposedCloudCampaign: {
        status: "proposed_unapproved_non_runtime",
      },
    });

    const proposedCloudCampaign = (
      example as { proposedCloudCampaign: unknown }
    ).proposedCloudCampaign;
    expect(JSON.stringify(proposedCloudCampaign)).not.toMatch(
      /"[^"]*Env"\s*:|"SOAR_[A-Z0-9_]+"/u,
    );
  });

  it("rejects unknown fields, invalid runtime vocabulary, and cloud environment mappings", async () => {
    const [example, schema] = await Promise.all([
      readJson("config/providers.readiness.example.json"),
      readJson("config/providers.readiness.schema.json"),
    ]);
    const invalid = structuredClone(example) as {
      runtimeProviders: Array<Record<string, unknown>>;
      proposedCloudCampaign: {
        provider: Record<string, unknown>;
        budget: Record<string, unknown>;
      };
    };
    delete invalid.runtimeProviders[0]?.costPolicyEnv;
    if (invalid.runtimeProviders[0]) {
      invalid.runtimeProviders[0].capabilities = ["tool-calling"];
      invalid.runtimeProviders[0].typo = true;
    }
    invalid.proposedCloudCampaign.provider.modelEnv = "SOAR_CLOUD_MODEL";
    invalid.proposedCloudCampaign.budget.campaignUsdEnv =
      "SOAR_CAMPAIGN_BUDGET_USD";

    expect(validateJsonSchema(invalid, schema)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unexpected property "typo"'),
        expect.stringContaining('missing required property "costPolicyEnv"'),
        expect.stringContaining("must be one of"),
        expect.stringContaining('unexpected property "modelEnv"'),
        expect.stringContaining('unexpected property "campaignUsdEnv"'),
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
