import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BudgetLedger } from "../../src/main/budget-ledger";
import { createSoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import {
  PR6R_DEVELOPMENT_RUNTIME_BUILD_MARKER,
  assertPr6rCanonicalLedgerAuthority,
  assertPr6rDevelopmentRuntimeAuthority,
  bindPr6rCanonicalLedgerAuthorityForRuntime,
  createPr6rDevelopmentRuntimeAuthorityForBuild,
  type Pr6rCanonicalLedgerAuthority,
  type Pr6rDevelopmentRuntimeAuthority,
} from "../../src/main/pr6r-development/runtime-authority";

describe("PR6R nominal development runtime authority", () => {
  it("admits only a nominal simulation-scoped build capability", () => {
    const authority = createPr6rDevelopmentRuntimeAuthorityForBuild();
    expect(() => assertPr6rDevelopmentRuntimeAuthority(authority)).not.toThrow();
    expect(authority).toMatchObject({
      buildMarker: PR6R_DEVELOPMENT_RUNTIME_BUILD_MARKER,
      buildFlavor: "pr6r-development-canary",
      costScope: "simulation",
      actualPaidAuthority: false,
    });
    expect(Object.isFrozen(authority)).toBe(true);
  });

  it("rejects a structurally identical forged capability", () => {
    const genuine = createPr6rDevelopmentRuntimeAuthorityForBuild();
    const forged = { ...genuine } as Pr6rDevelopmentRuntimeAuthority;
    expect(() => assertPr6rDevelopmentRuntimeAuthority(forged)).toThrow(
      "pr6r_development_runtime_authority_invalid",
    );
  });

  it("retains the forbidden build marker in every genuine authority", () => {
    const authority = createPr6rDevelopmentRuntimeAuthorityForBuild();
    expect(JSON.stringify(authority)).toContain(
      "SOAR_PR6R_DEVELOPMENT_CANARY_V1",
    );
  });

  it("binds one exact canonical ledger per runtime and rejects clones or transplants", () => {
    const directory = mkdtempSync(join(tmpdir(), "soar-pr6r-ledger-bind-"));
    const canonicalPath = join(directory, "canonical.sqlite");
    const copiedPath = join(directory, "copied.sqlite");
    createSoarDatabase(canonicalPath).close();
    copyFileSync(canonicalPath, copiedPath);
    const firstDatabase = createSoarDatabase(canonicalPath);
    const secondDatabase = createSoarDatabase(copiedPath);
    try {
      const runtimeAuthority = createPr6rDevelopmentRuntimeAuthorityForBuild();
      const firstLedger = new BudgetLedger(new EventStore(firstDatabase));
      const copiedLedger = new BudgetLedger(new EventStore(secondDatabase));
      const authority = bindPr6rCanonicalLedgerAuthorityForRuntime(
        runtimeAuthority,
        firstLedger,
      );

      expect(
        bindPr6rCanonicalLedgerAuthorityForRuntime(
          runtimeAuthority,
          firstLedger,
        ),
      ).toBe(authority);
      expect(() =>
        assertPr6rCanonicalLedgerAuthority(authority, {
          ledger: firstLedger,
        }),
      ).not.toThrow();
      expect(() =>
        assertPr6rCanonicalLedgerAuthority(
          { ...authority } as Pr6rCanonicalLedgerAuthority,
          { ledger: firstLedger },
        ),
      ).toThrow("pr6r_canonical_ledger_authority_invalid");
      expect(() =>
        assertPr6rCanonicalLedgerAuthority(authority, {
          ledger: copiedLedger,
        }),
      ).toThrow("pr6r_canonical_ledger_authority_invalid");
      expect(() =>
        bindPr6rCanonicalLedgerAuthorityForRuntime(
          runtimeAuthority,
          copiedLedger,
        ),
      ).toThrow("pr6r_canonical_ledger_runtime_already_bound");
    } finally {
      firstDatabase.close();
      secondDatabase.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
