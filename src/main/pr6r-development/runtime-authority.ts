import {
  PR6R_COST_SCOPE,
  PR6R_DEVELOPMENT_AUTHORITY_ID,
  PR6R_PHASE,
  PR6R_PLAN_ID,
} from "../../shared/pr6r-development-identity";

/**
 * This exact marker is forbidden by the normal build and package verifiers.
 * Keep it as a retained authority field so importing the authority factory into
 * another runtime graph cannot silently tree-shake the isolation sentinel.
 */
export const PR6R_DEVELOPMENT_RUNTIME_BUILD_MARKER =
  "SOAR_PR6R_DEVELOPMENT_CANARY_V1" as const;

/**
 * Nominal capability constructed only by the compile-time PR6R development
 * entry graph. It carries no credential, endpoint, configured-provider, or
 * actual-paid authority.
 */
export interface Pr6rDevelopmentRuntimeAuthority {
  readonly buildMarker: typeof PR6R_DEVELOPMENT_RUNTIME_BUILD_MARKER;
  readonly planId: typeof PR6R_PLAN_ID;
  readonly phase: typeof PR6R_PHASE;
  readonly authorityId: typeof PR6R_DEVELOPMENT_AUTHORITY_ID;
  readonly buildFlavor: "pr6r-development-canary";
  readonly costScope: typeof PR6R_COST_SCOPE;
  readonly actualPaidAuthority: false;
}

const genuineAuthorities = new WeakSet<Pr6rDevelopmentRuntimeAuthority>();

export function createPr6rDevelopmentRuntimeAuthorityForBuild(): Pr6rDevelopmentRuntimeAuthority {
  const authority = Object.freeze({
    buildMarker: PR6R_DEVELOPMENT_RUNTIME_BUILD_MARKER,
    planId: PR6R_PLAN_ID,
    phase: PR6R_PHASE,
    authorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
    buildFlavor: "pr6r-development-canary" as const,
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false as const,
  });
  genuineAuthorities.add(authority);
  return authority;
}

export function assertPr6rDevelopmentRuntimeAuthority(
  value: Pr6rDevelopmentRuntimeAuthority,
): void {
  if (!genuineAuthorities.has(value)) {
    throw new Error("pr6r_development_runtime_authority_invalid");
  }
}
