import { randomUUID } from "node:crypto";

import type { InferenceProvider } from "../providers/types";

export interface LocalRouteAssignment {
  providerId: string;
  model: string;
  reason: "MVP_LOCAL_PROOF";
  leaseId: string;
}

export function assignLocalRoute(provider: InferenceProvider): LocalRouteAssignment {
  return {
    providerId: provider.id,
    model: provider.model,
    reason: "MVP_LOCAL_PROOF",
    leaseId: randomUUID(),
  };
}
