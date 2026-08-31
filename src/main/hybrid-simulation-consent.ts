import { createHash, randomUUID } from "node:crypto";

import {
  HYBRID_SIMULATION_DISCLOSURE_TEXT,
  HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
  HYBRID_SIMULATION_DISCLOSURE_VERSION,
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_ROUTE,
  HybridSimulationConsentAcknowledgementV1Schema,
  HybridSimulationConsentChallengeV1Schema,
  HybridSimulationSessionAuthorityV1Schema,
  type ConsumedHybridSimulationConsentV1,
  type HybridSimulationConsentAcknowledgementV1,
  type HybridSimulationConsentChallengeV1,
  type HybridSimulationSessionAuthorityV1,
} from "../shared/hybrid-simulation-contracts";

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const MAX_CHALLENGE_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_OUTSTANDING = 128;
const MAX_OUTSTANDING_LIMIT = 1_024;

export type HybridSimulationConsentChallengeErrorCode =
  | "challenge_capacity_exhausted"
  | "challenge_expired"
  | "challenge_mismatch"
  | "challenge_unknown_or_reused";

export class HybridSimulationConsentChallengeError extends Error {
  constructor(readonly code: HybridSimulationConsentChallengeErrorCode) {
    super(
      code === "challenge_capacity_exhausted"
        ? "Hybrid simulation consent is temporarily unavailable."
        : code === "challenge_expired"
          ? "Hybrid simulation consent expired; review the disclosure again."
          : code === "challenge_mismatch"
            ? "Hybrid simulation consent no longer matches this request."
            : "Hybrid simulation consent is unknown or was already used.",
    );
    this.name = "HybridSimulationConsentChallengeError";
  }
}

interface StoredChallenge {
  publicChallenge: HybridSimulationConsentChallengeV1;
  canonicalWorkspaceIdentity: string;
  workspaceDirectoryIdentity: HybridSimulationWorkspaceDirectoryIdentityV1;
  workspaceInvalidationGeneration: number;
}

/**
 * Main-owned filesystem identity captured at challenge issue time. It is never
 * exposed through the renderer challenge or persisted with the session.
 */
export interface HybridSimulationWorkspaceDirectoryIdentityV1 {
  canonicalWorkspaceIdentity: string;
  device: string;
  inode: string;
}

export interface HybridSimulationConsentChallengeStoreOptions {
  authority: HybridSimulationSessionAuthorityV1;
  nowMs?: () => number;
  idFactory?: () => string;
  challengeTtlMs?: number;
  maxOutstanding?: number;
}

function disclosureSha256(): string {
  return createHash("sha256")
    .update(HYBRID_SIMULATION_DISCLOSURE_TEXT, "utf8")
    .digest("hex");
}

function assertBoundedPositiveInteger(
  value: number,
  label: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${label} must be a positive safe integer <= ${maximum}`);
  }
  return value;
}

function parseWorkspaceIdentity(value: string): string {
  const parsed = HybridSimulationConsentAcknowledgementV1Schema.shape
    .canonicalWorkspaceIdentity.parse(value);
  if (parsed !== parsed.trim()) {
    throw new TypeError("canonical workspace identity must be trimmed");
  }
  return parsed;
}

function parseWorkspaceDirectoryIdentity(
  value: HybridSimulationWorkspaceDirectoryIdentityV1,
  expectedCanonicalWorkspaceIdentity: string,
): HybridSimulationWorkspaceDirectoryIdentityV1 {
  const canonicalWorkspaceIdentity = parseWorkspaceIdentity(
    value.canonicalWorkspaceIdentity,
  );
  const boundedIntegerIdentity = (candidate: string, label: string): string => {
    if (!/^(?:0|[1-9][0-9]{0,63})$/u.test(candidate)) {
      throw new TypeError(`${label} must be a bounded unsigned decimal integer`);
    }
    return candidate;
  };
  if (canonicalWorkspaceIdentity !== expectedCanonicalWorkspaceIdentity) {
    throw new TypeError(
      "workspace directory identity must match its canonical workspace",
    );
  }
  return {
    canonicalWorkspaceIdentity,
    device: boundedIntegerIdentity(value.device, "workspace device identity"),
    inode: boundedIntegerIdentity(value.inode, "workspace inode identity"),
  };
}

function sameWorkspaceDirectoryIdentity(
  left: HybridSimulationWorkspaceDirectoryIdentityV1,
  right: HybridSimulationWorkspaceDirectoryIdentityV1,
): boolean {
  return (
    left.canonicalWorkspaceIdentity === right.canonicalWorkspaceIdentity &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

/**
 * Main-process-only, in-memory consent store. Challenges never survive restart,
 * and a known challenge is deleted before any acknowledgement result is returned.
 */
export class HybridSimulationConsentChallengeStore {
  private readonly authority: HybridSimulationSessionAuthorityV1;
  private readonly nowMs: () => number;
  private readonly idFactory: () => string;
  private readonly challengeTtlMs: number;
  private readonly maxOutstanding: number;
  private readonly byId = new Map<string, StoredChallenge>();
  private readonly idByWorkspace = new Map<string, string>();
  // A consent nonce is single-use for the lifetime of this main-process store,
  // even after invalidation, expiry, or clear(). This turns an injected/random
  // ID collision into a fail-closed issue instead of letting an old renderer
  // acknowledgement consume a later challenge.
  private readonly issuedIds = new Set<string>();
  private invalidationGeneration = 0;
  private readonly invalidationGenerationByWorkspace = new Map<string, number>();

  constructor(options: HybridSimulationConsentChallengeStoreOptions) {
    if (disclosureSha256() !== HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256) {
      throw new Error("Hybrid simulation disclosure hash constant is stale");
    }
    this.authority = structuredClone(
      HybridSimulationSessionAuthorityV1Schema.parse(options.authority),
    );
    this.nowMs = options.nowMs ?? Date.now;
    this.idFactory = options.idFactory ?? randomUUID;
    this.challengeTtlMs = assertBoundedPositiveInteger(
      options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS,
      "challengeTtlMs",
      MAX_CHALLENGE_TTL_MS,
    );
    this.maxOutstanding = assertBoundedPositiveInteger(
      options.maxOutstanding ?? DEFAULT_MAX_OUTSTANDING,
      "maxOutstanding",
      MAX_OUTSTANDING_LIMIT,
    );
  }

  captureIssueGeneration(): number {
    return this.invalidationGeneration;
  }

  issue(
    canonicalWorkspaceIdentityValue: string,
    workspaceDirectoryIdentityValue: HybridSimulationWorkspaceDirectoryIdentityV1,
    expectedInvalidationGeneration: number,
  ): HybridSimulationConsentChallengeV1 {
    const canonicalWorkspaceIdentity = parseWorkspaceIdentity(
      canonicalWorkspaceIdentityValue,
    );
    if (
      !Number.isSafeInteger(expectedInvalidationGeneration) ||
      expectedInvalidationGeneration < 0 ||
      expectedInvalidationGeneration !== this.invalidationGeneration
    ) {
      throw new HybridSimulationConsentChallengeError(
        "challenge_unknown_or_reused",
      );
    }
    const workspaceDirectoryIdentity = parseWorkspaceDirectoryIdentity(
      workspaceDirectoryIdentityValue,
      canonicalWorkspaceIdentity,
    );
    const now = this.nowMs();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new RangeError("consent challenge clock returned an invalid time");
    }
    this.purgeExpired(now);
    this.invalidateWorkspace(canonicalWorkspaceIdentity);
    if (this.byId.size >= this.maxOutstanding) {
      throw new HybridSimulationConsentChallengeError(
        "challenge_capacity_exhausted",
      );
    }

    const challengeId = this.idFactory();
    if (
      challengeId !== challengeId.trim() ||
      challengeId.length === 0 ||
      challengeId.length > 256 ||
      this.issuedIds.has(challengeId)
    ) {
      throw new Error("consent challenge ID factory returned an invalid ID");
    }
    const expiresAtMs = now + this.challengeTtlMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new RangeError("consent challenge expiry exceeds the safe range");
    }
    const publicChallenge = HybridSimulationConsentChallengeV1Schema.parse({
      schemaVersion: "hybrid-simulation-consent-challenge-v1",
      challengeId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      disclosureText: HYBRID_SIMULATION_DISCLOSURE_TEXT,
      disclosureVersion: HYBRID_SIMULATION_DISCLOSURE_VERSION,
      disclosureTextSha256: HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
      route: HYBRID_SIMULATION_ROUTE,
      maxSimulatedSpendMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    });
    this.issuedIds.add(challengeId);
    this.byId.set(challengeId, {
      publicChallenge,
      canonicalWorkspaceIdentity,
      workspaceDirectoryIdentity,
      workspaceInvalidationGeneration:
        this.workspaceInvalidationGeneration(canonicalWorkspaceIdentity),
    });
    this.idByWorkspace.set(canonicalWorkspaceIdentity, challengeId);
    return structuredClone(publicChallenge);
  }

  async consume(
    acknowledgementValue: unknown,
    resolveCurrentWorkspaceDirectoryIdentity: (
      canonicalWorkspaceIdentity: string,
    ) => Promise<HybridSimulationWorkspaceDirectoryIdentityV1>,
  ): Promise<ConsumedHybridSimulationConsentV1> {
    const attemptedChallengeId =
      typeof acknowledgementValue === "object" &&
      acknowledgementValue !== null &&
      "challengeId" in acknowledgementValue &&
      typeof acknowledgementValue.challengeId === "string"
        ? acknowledgementValue.challengeId
        : undefined;
    const stored =
      attemptedChallengeId === undefined
        ? undefined
        : this.byId.get(attemptedChallengeId);
    if (attemptedChallengeId === undefined || stored === undefined) {
      throw new HybridSimulationConsentChallengeError(
        "challenge_unknown_or_reused",
      );
    }

    const consumptionGeneration = this.invalidationGeneration;
    const workspaceConsumptionGeneration =
      stored.workspaceInvalidationGeneration;

    // Delete before parsing or validating the known record. A malformed
    // acknowledgement, mismatch, expiry, exception, or later session-creation
    // failure always requires a fresh acknowledgement.
    this.deleteStored(attemptedChallengeId, stored);
    const parsed = HybridSimulationConsentAcknowledgementV1Schema.safeParse(
      acknowledgementValue,
    );
    if (!parsed.success) {
      throw new HybridSimulationConsentChallengeError("challenge_mismatch");
    }
    const acknowledgement: HybridSimulationConsentAcknowledgementV1 =
      parsed.data;
    const now = this.nowMs();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now >= Date.parse(stored.publicChallenge.expiresAt)
    ) {
      throw new HybridSimulationConsentChallengeError("challenge_expired");
    }
    if (
      acknowledgement.canonicalWorkspaceIdentity !==
        stored.canonicalWorkspaceIdentity ||
      acknowledgement.route !== stored.publicChallenge.route ||
      stored.publicChallenge.disclosureText !==
        HYBRID_SIMULATION_DISCLOSURE_TEXT ||
      stored.publicChallenge.disclosureVersion !==
        this.authority.disclosureVersion ||
      stored.publicChallenge.disclosureTextSha256 !==
        this.authority.disclosureTextSha256 ||
      stored.publicChallenge.maxSimulatedSpendMicrousd !==
        this.authority.maxSimulatedSpendMicrousd
    ) {
      throw new HybridSimulationConsentChallengeError("challenge_mismatch");
    }

    let currentWorkspaceDirectoryIdentity: HybridSimulationWorkspaceDirectoryIdentityV1;
    try {
      currentWorkspaceDirectoryIdentity = parseWorkspaceDirectoryIdentity(
        await resolveCurrentWorkspaceDirectoryIdentity(
          stored.canonicalWorkspaceIdentity,
        ),
        stored.canonicalWorkspaceIdentity,
      );
    } catch {
      throw new HybridSimulationConsentChallengeError("challenge_mismatch");
    }
    if (
      consumptionGeneration !== this.invalidationGeneration ||
      workspaceConsumptionGeneration !==
        this.workspaceInvalidationGeneration(
          stored.canonicalWorkspaceIdentity,
        ) ||
      !sameWorkspaceDirectoryIdentity(
        currentWorkspaceDirectoryIdentity,
        stored.workspaceDirectoryIdentity,
      )
    ) {
      throw new HybridSimulationConsentChallengeError("challenge_mismatch");
    }

    return {
      schemaVersion: "consumed-hybrid-simulation-consent-v1",
      canonicalWorkspaceIdentity: stored.canonicalWorkspaceIdentity,
      authority: structuredClone(this.authority),
    };
  }

  invalidateWorkspace(canonicalWorkspaceIdentityValue: string): boolean {
    const canonicalWorkspaceIdentity = parseWorkspaceIdentity(
      canonicalWorkspaceIdentityValue,
    );
    this.incrementWorkspaceInvalidationGeneration(canonicalWorkspaceIdentity);
    const challengeId = this.idByWorkspace.get(canonicalWorkspaceIdentity);
    if (challengeId === undefined) return false;
    const stored = this.byId.get(challengeId);
    if (stored === undefined) {
      this.idByWorkspace.delete(canonicalWorkspaceIdentity);
      return false;
    }
    this.deleteStored(challengeId, stored);
    return true;
  }

  /**
   * Burn a renderer-referenced challenge without parsing or echoing any other
   * renderer fields. This is used when the outer IPC envelope itself is forged.
   */
  burnKnownChallenge(challengeIdValue: unknown): boolean {
    if (typeof challengeIdValue !== "string") {
      return false;
    }
    const challengeId = challengeIdValue.trim();
    if (challengeId.length === 0 || challengeId.length > 256) return false;
    const stored = this.byId.get(challengeId);
    if (stored === undefined) return false;
    this.incrementWorkspaceInvalidationGeneration(
      stored.canonicalWorkspaceIdentity,
    );
    this.deleteStored(challengeId, stored);
    return true;
  }

  clear(): void {
    this.byId.clear();
    this.idByWorkspace.clear();
    if (this.invalidationGeneration === Number.MAX_SAFE_INTEGER) {
      throw new RangeError("consent invalidation generation is exhausted");
    }
    this.invalidationGeneration += 1;
  }

  private purgeExpired(now: number): void {
    for (const [challengeId, stored] of this.byId) {
      if (now >= Date.parse(stored.publicChallenge.expiresAt)) {
        this.deleteStored(challengeId, stored);
      }
    }
  }

  private deleteStored(challengeId: string, stored: StoredChallenge): void {
    this.byId.delete(challengeId);
    if (
      this.idByWorkspace.get(stored.canonicalWorkspaceIdentity) === challengeId
    ) {
      this.idByWorkspace.delete(stored.canonicalWorkspaceIdentity);
    }
  }

  private workspaceInvalidationGeneration(
    canonicalWorkspaceIdentity: string,
  ): number {
    return this.invalidationGenerationByWorkspace.get(
      canonicalWorkspaceIdentity,
    ) ?? 0;
  }

  private incrementWorkspaceInvalidationGeneration(
    canonicalWorkspaceIdentity: string,
  ): void {
    const current = this.workspaceInvalidationGeneration(
      canonicalWorkspaceIdentity,
    );
    if (current === Number.MAX_SAFE_INTEGER) {
      throw new RangeError("workspace consent invalidation generation is exhausted");
    }
    this.invalidationGenerationByWorkspace.set(
      canonicalWorkspaceIdentity,
      current + 1,
    );
  }
}
