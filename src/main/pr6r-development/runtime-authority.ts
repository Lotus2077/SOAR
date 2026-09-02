import {
  PR6R_COST_SCOPE,
  PR6R_DEVELOPMENT_AUTHORITY_ID,
  PR6R_PHASE,
  PR6R_PLAN_ID,
} from "../../shared/pr6r-development-identity";
import type { BudgetLedger } from "../budget-ledger";

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

/**
 * Process-local proof that this development runtime selected one exact
 * canonical SQLite/BudgetLedger instance. The binding is intentionally not
 * persisted: a fresh process must reopen the canonical database and bind it
 * once before attempting recovery.
 */
export interface Pr6rCanonicalLedgerAuthority {
  readonly kind: "pr6r_canonical_ledger";
  readonly authorityId: typeof PR6R_DEVELOPMENT_AUTHORITY_ID;
}

interface CanonicalLedgerBinding {
  readonly ledger: BudgetLedger;
  readonly authority: Pr6rCanonicalLedgerAuthority;
}

const canonicalLedgerByRuntime = new WeakMap<
  Pr6rDevelopmentRuntimeAuthority,
  CanonicalLedgerBinding
>();
const canonicalLedgerAuthorityState = new WeakMap<
  Pr6rCanonicalLedgerAuthority,
  {
    readonly runtimeAuthority: Pr6rDevelopmentRuntimeAuthority;
    readonly ledger: BudgetLedger;
  }
>();

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

/**
 * Bind exactly one canonical ledger to a genuine runtime lifetime. Repeating
 * the call with the same pair is idempotent; transplanting that runtime to a
 * second ledger fails closed.
 */
export function bindPr6rCanonicalLedgerAuthorityForRuntime(
  runtimeAuthority: Pr6rDevelopmentRuntimeAuthority,
  ledger: BudgetLedger,
): Pr6rCanonicalLedgerAuthority {
  assertPr6rDevelopmentRuntimeAuthority(runtimeAuthority);
  const existing = canonicalLedgerByRuntime.get(runtimeAuthority);
  if (existing !== undefined) {
    if (existing.ledger !== ledger) {
      throw new Error("pr6r_canonical_ledger_runtime_already_bound");
    }
    return existing.authority;
  }
  const authority = Object.freeze({
    kind: "pr6r_canonical_ledger" as const,
    authorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
  });
  const binding = Object.freeze({ ledger, authority });
  canonicalLedgerByRuntime.set(runtimeAuthority, binding);
  canonicalLedgerAuthorityState.set(authority, {
    runtimeAuthority,
    ledger,
  });
  return authority;
}

/** Read-only exact-object assertion used before any restart recovery effect. */
export function assertPr6rCanonicalLedgerAuthority(
  authority: Pr6rCanonicalLedgerAuthority,
  input: { readonly ledger: BudgetLedger },
): void {
  const binding = canonicalLedgerAuthorityState.get(authority);
  if (
    binding === undefined ||
    binding.ledger !== input.ledger ||
    canonicalLedgerByRuntime.get(binding.runtimeAuthority)?.authority !==
      authority ||
    authority.kind !== "pr6r_canonical_ledger" ||
    authority.authorityId !== PR6R_DEVELOPMENT_AUTHORITY_ID
  ) {
    throw new Error("pr6r_canonical_ledger_authority_invalid");
  }
}

/** Require that the canonical ledger belongs to this exact runtime lifetime. */
export function assertPr6rCanonicalLedgerAuthorityForRuntime(
  authority: Pr6rCanonicalLedgerAuthority,
  input: {
    readonly runtimeAuthority: Pr6rDevelopmentRuntimeAuthority;
    readonly ledger: BudgetLedger;
  },
): void {
  assertPr6rDevelopmentRuntimeAuthority(input.runtimeAuthority);
  assertPr6rCanonicalLedgerAuthority(authority, { ledger: input.ledger });
  const binding = canonicalLedgerAuthorityState.get(authority);
  if (binding?.runtimeAuthority !== input.runtimeAuthority) {
    throw new Error("pr6r_canonical_ledger_runtime_mismatch");
  }
}
