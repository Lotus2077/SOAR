import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudCredentialStatusService } from "../../src/main/cloud-credential-service";
import type { SoarConfig } from "../../src/main/config";
import { FakeCredentialLeaseAuthority } from "../../src/main/credentials/fake-credential-lease-authority";
import { CredentialOperationJournal } from "../../src/main/credentials/credential-operation-journal";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";
import { createRuntimeProviderCatalog } from "../../src/main/providers/runtime-catalog";

const databases: SoarDatabase[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.close();
});

function config(overrides: Partial<SoarConfig> = {}): SoarConfig {
  return {
    providerMode: "local",
    hybridSimulationEnabled: false,
    fakeCloudScenario: "success",
    fakeDelayMs: 0,
    vllm: {
      baseUrl: "https://local-provider.example/v1",
      apiKey: "test-local-value",
      model: "configured-local-model",
      costPolicy: "local_zero_cost",
      maxOutputTokens: 8_192,
      timeoutMs: 30_000,
    },
    limits: { inferenceRounds: 24, toolCalls: 24 },
    context: { maxInputTokens: 16_384, safetyMargin: 0.2 },
    ...overrides,
  };
}

describe("credential authority provider isolation", () => {
  it("cannot register, select, invoke, budget, or dispatch a provider", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    const journal = new CredentialOperationJournal(database);
    const authority = new FakeCredentialLeaseAuthority({
      protectedGeneration: "generation-1",
    });
    const service = new CloudCredentialStatusService(authority, journal);
    const catalog = createRuntimeProviderCatalog(config());
    const descriptorsBefore = catalog.registry.listDescriptors({
      includeDisabled: true,
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const status = await service.getStatus();
    const acquired = await authority.acquireLease({
      purpose: "phase_b_state_machine_test",
      ttlMs: 1_000,
      generation: "generation-1",
      nonce: "nonce-1",
    });
    expect(acquired.state).toBe("active");
    if (acquired.state === "active") {
      await authority.consumeLease({
        handle: acquired.handle,
        expectedPurpose: "phase_b_state_machine_test",
        nonce: "nonce-1",
      });
    }

    expect(status).toMatchObject({
      providerCheck: { state: "not_run" },
      dispatch: { state: "locked" },
      providerContact: { state: "not_contacted" },
    });
    expect(catalog.registry.listDescriptors({ includeDisabled: true })).toEqual(
      descriptorsBefore,
    );
    expect(catalog.registry.listDescriptors()).toHaveLength(1);
    expect(catalog.registry.getDescriptor("openrouter-deepseek-v4-flash-0731"))
      .toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM sessions").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM session_events").get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM budget_ledger_entries")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("does not alter the exact Fake Hybrid simulation authority", async () => {
    const database = createSoarDatabase();
    databases.push(database);
    const authority = new FakeCredentialLeaseAuthority();
    const service = new CloudCredentialStatusService(
      authority,
      new CredentialOperationJournal(database),
    );
    const catalog = createRuntimeProviderCatalog(
      config({ providerMode: "fake", hybridSimulationEnabled: true }),
    );
    const runtimeBefore = catalog.hybridSimulationRuntime;

    await service.getStatus();
    authority.setProtectedGenerationForTest("generation-1");
    await service.getStatus();

    expect(catalog.hybridSimulationRuntime).toBe(runtimeBefore);
    expect(catalog.registry.listDescriptors().map(({ id }) => id)).toEqual([
      "fake-cloud-review",
      "local-vllm",
    ]);
    expect(runtimeBefore).toMatchObject({
      kind: "hybrid-simulation-runtime-v1",
      credentialAvailable: true,
    });
  });

  it("keeps the status projector free of provider, runner, egress, and budget imports", () => {
    const source = readFileSync(
      new URL("../../src/main/cloud-credential-service.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /provider-registry|runtime-catalog|run-session|cloud-egress|budget-ledger|openai-compatible/u,
    );
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });
});
