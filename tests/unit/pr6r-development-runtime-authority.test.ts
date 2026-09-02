import { describe, expect, it } from "vitest";

import {
  PR6R_DEVELOPMENT_RUNTIME_BUILD_MARKER,
  assertPr6rDevelopmentRuntimeAuthority,
  createPr6rDevelopmentRuntimeAuthorityForBuild,
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
});
