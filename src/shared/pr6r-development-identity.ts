/**
 * Minimal PR6R-A identity surface. Keep this module dependency-free so the
 * structural development-canary authority cannot pull normal session, routing,
 * provider, or credential contracts into its build graph.
 */
export const PR6R_PLAN_ID =
  "pr6r-development-real-provider-slice-v1-plan-1" as const;
export const PR6R_PHASE = "r-a" as const;
export const PR6R_DEVELOPMENT_AUTHORITY_ID =
  "pr6r-cal-007-loopback-authority-v1" as const;
export const PR6R_COST_SCOPE = "simulation" as const;
