import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  CREDENTIAL_AUTHORITY_CAPABILITY_VERSION,
  CredentialOperationKindSchema,
  CredentialOperationProjectionSchema,
  type CredentialOperationKind,
  type CredentialOperationProjection,
  type CredentialOperationRecoveryCode,
} from "../../shared/cloud-setup-contracts";
import type { SoarDatabase } from "../database";

export const CREDENTIAL_OPERATION_RESULT_CODES = [
  "native_success_confirmed",
  "native_failure_confirmed",
  "metadata_match_confirmed",
  "caller_abandoned",
  "process_interrupted",
  "metadata_mismatch",
  "native_completion_unknown",
  "manual_supersession_confirmed",
] as const;
export const CredentialOperationResultCodeSchema = z.enum(
  CREDENTIAL_OPERATION_RESULT_CODES,
);
export type CredentialOperationResultCode = z.infer<
  typeof CredentialOperationResultCodeSchema
>;

export const CREDENTIAL_OPERATION_STATES = [
  "pending",
  "confirmed",
  "outcome_unknown",
  "superseded",
] as const;
export const CredentialOperationStateSchema = z.enum(
  CREDENTIAL_OPERATION_STATES,
);
export type CredentialOperationState = z.infer<
  typeof CredentialOperationStateSchema
>;

const LOWERCASE_UUID_V4_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/**
 * Journal identities are non-secret, fixed-shape identifiers. The literal
 * brands make credential strings, paths, diagnostics, and other caller data
 * structurally impossible to persist in these columns.
 */
export const CredentialOperationIdSchema = z
  .string()
  .regex(new RegExp(`^operation-${LOWERCASE_UUID_V4_PATTERN}$`, "u"))
  .brand<"CredentialOperationId">();
export type CredentialOperationId = z.infer<
  typeof CredentialOperationIdSchema
>;

export const CredentialGenerationIdSchema = z
  .string()
  .regex(new RegExp(`^generation-${LOWERCASE_UUID_V4_PATTERN}$`, "u"))
  .brand<"CredentialGenerationId">();
export type CredentialGenerationId = z.infer<
  typeof CredentialGenerationIdSchema
>;
const canonicalTimestamp = z
  .string()
  .datetime({ offset: false, local: false })
  .refine((value) => new Date(value).toISOString() === value, {
    message: "timestamp must be canonical ISO UTC",
  });

const CredentialOperationRecordSchema = z
  .object({
    operationId: CredentialOperationIdSchema,
    operationKind: CredentialOperationKindSchema,
    requestedGeneration: CredentialGenerationIdSchema.optional(),
    startedAt: canonicalTimestamp,
    updatedAt: canonicalTimestamp,
    state: CredentialOperationStateSchema,
    resultCode: CredentialOperationResultCodeSchema.optional(),
    recoveryCode: z
      .enum(["await_native_completion", "manual_recovery_required"])
      .optional(),
    identityCapabilityVersion: z.literal(
      CREDENTIAL_AUTHORITY_CAPABILITY_VERSION,
    ),
  })
  .strict()
  .superRefine((record, context) => {
    const needsGeneration =
      record.operationKind === "store_protected" ||
      record.operationKind === "replace_protected";
    if (needsGeneration !== (record.requestedGeneration !== undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "store and replace require one non-secret generation; removals forbid it",
        path: ["requestedGeneration"],
      });
    }
    if (record.updatedAt < record.startedAt) {
      context.addIssue({
        code: "custom",
        message: "operation update time cannot precede its start time",
        path: ["updatedAt"],
      });
    }
    const codeShapeIsValid =
      (record.state === "pending" &&
        record.resultCode === undefined &&
        record.recoveryCode === undefined) ||
      (record.state === "confirmed" &&
        (record.resultCode === "native_success_confirmed" ||
          record.resultCode === "native_failure_confirmed" ||
          record.resultCode === "metadata_match_confirmed") &&
        record.recoveryCode === undefined) ||
      (record.state === "outcome_unknown" &&
        ((record.resultCode === "caller_abandoned" ||
          record.resultCode === "native_completion_unknown")
          ? record.recoveryCode === "await_native_completion"
          : (record.resultCode === "process_interrupted" ||
                record.resultCode === "metadata_mismatch") &&
              record.recoveryCode === "manual_recovery_required")) ||
      (record.state === "superseded" &&
        record.resultCode === "manual_supersession_confirmed" &&
        record.recoveryCode === undefined);
    if (!codeShapeIsValid) {
      context.addIssue({
        code: "custom",
        message: "operation state and allow-listed result/recovery codes disagree",
        path: ["state"],
      });
    }
  });

export type CredentialOperationRecord = z.infer<
  typeof CredentialOperationRecordSchema
>;

export interface BeginCredentialOperationInput {
  operationKind: CredentialOperationKind;
  requestedGeneration?: string;
  startedAt?: string;
}

interface CredentialOperationRow {
  operation_id: string;
  operation_kind: CredentialOperationKind;
  requested_generation: string | null;
  started_at: string;
  updated_at: string;
  state: CredentialOperationState;
  result_code: CredentialOperationResultCode | null;
  recovery_code: CredentialOperationRecoveryCode | null;
  identity_capability_version: typeof CREDENTIAL_AUTHORITY_CAPABILITY_VERSION;
}

interface MutationResult {
  changes: number;
}

function exactTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new RangeError("credential operation timestamp must be canonical ISO UTC");
  }
  return value;
}

function createOperationId(): CredentialOperationId {
  return CredentialOperationIdSchema.parse(`operation-${randomUUID()}`);
}

function toRecord(row: CredentialOperationRow): CredentialOperationRecord {
  return CredentialOperationRecordSchema.parse({
    operationId: row.operation_id,
    operationKind: row.operation_kind,
    ...(row.requested_generation === null
      ? {}
      : { requestedGeneration: row.requested_generation }),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    state: row.state,
    ...(row.result_code === null ? {} : { resultCode: row.result_code }),
    ...(row.recovery_code === null
      ? {}
      : { recoveryCode: row.recovery_code }),
    identityCapabilityVersion: row.identity_capability_version,
  });
}

function toProjection(
  record: CredentialOperationRecord | undefined,
): CredentialOperationProjection {
  if (record === undefined) {
    return CredentialOperationProjectionSchema.parse({ state: "none" });
  }
  if (record.state === "outcome_unknown") {
    return CredentialOperationProjectionSchema.parse({
      state: record.state,
      kind: record.operationKind,
      recoveryCode: record.recoveryCode,
    });
  }
  return CredentialOperationProjectionSchema.parse({
    state: record.state,
    kind: record.operationKind,
  });
}

/**
 * SQLite-backed, non-secret credential-operation reconciliation state.
 *
 * Phase B has no production mutation caller. This class exists so fakes can
 * prove timeout, late-completion, restart ambiguity, and duplicate denial
 * before a later phase proposes any real credential mutation.
 */
export class CredentialOperationJournal {
  constructor(
    private readonly database: SoarDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  begin(input: BeginCredentialOperationInput): CredentialOperationRecord {
    const startedAt = exactTimestamp(input.startedAt ?? this.clock().toISOString());
    const candidate = CredentialOperationRecordSchema.parse({
      operationId: createOperationId(),
      operationKind: input.operationKind,
      ...(input.requestedGeneration === undefined
        ? {}
        : { requestedGeneration: input.requestedGeneration }),
      startedAt,
      updatedAt: startedAt,
      state: "pending",
      identityCapabilityVersion: CREDENTIAL_AUTHORITY_CAPABILITY_VERSION,
    });
    const insert = this.database.prepare(
      `INSERT INTO credential_operation_journal (
         operation_id, operation_kind, requested_generation, started_at,
         updated_at, state, result_code, recovery_code,
         identity_capability_version
       ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)`,
    );
    this.database.transaction(() => {
      insert.run(
        candidate.operationId,
        candidate.operationKind,
        candidate.requestedGeneration ?? null,
        candidate.startedAt,
        candidate.updatedAt,
        candidate.identityCapabilityVersion,
      );
    }).immediate();
    return this.require(candidate.operationId);
  }

  get(operationId: string): CredentialOperationRecord | undefined {
    const canonicalId = CredentialOperationIdSchema.parse(operationId);
    const row = this.database
      .prepare(
        `SELECT operation_id, operation_kind, requested_generation, started_at,
                updated_at, state, result_code, recovery_code,
                identity_capability_version
         FROM credential_operation_journal
         WHERE operation_id = ?`,
      )
      .get(canonicalId) as CredentialOperationRow | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  require(operationId: string): CredentialOperationRecord {
    const record = this.get(operationId);
    if (record === undefined) {
      throw new Error("credential operation was not found");
    }
    return record;
  }

  latest(): CredentialOperationRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT operation_id, operation_kind, requested_generation, started_at,
                updated_at, state, result_code, recovery_code,
                identity_capability_version
         FROM credential_operation_journal
         ORDER BY updated_at DESC, operation_id DESC
         LIMIT 1`,
      )
      .get() as CredentialOperationRow | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  unresolved(): CredentialOperationRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT operation_id, operation_kind, requested_generation, started_at,
                updated_at, state, result_code, recovery_code,
                identity_capability_version
         FROM credential_operation_journal
         WHERE state IN ('pending', 'outcome_unknown')
         LIMIT 1`,
      )
      .get() as CredentialOperationRow | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  latestProjection(): CredentialOperationProjection {
    return toProjection(this.latest());
  }

  markCallerAbandoned(
    operationId: string,
    updatedAt = this.clock().toISOString(),
  ): CredentialOperationRecord {
    return this.transition(
      operationId,
      ["pending"],
      "outcome_unknown",
      "caller_abandoned",
      "await_native_completion",
      updatedAt,
    );
  }

  markNativeCompletionUnknown(
    operationId: string,
    updatedAt = this.clock().toISOString(),
  ): CredentialOperationRecord {
    return this.transition(
      operationId,
      ["pending"],
      "outcome_unknown",
      "native_completion_unknown",
      "await_native_completion",
      updatedAt,
    );
  }

  confirmFromLiveCompletion(
    operationId: string,
    outcome: "success" | "failure",
    updatedAt = this.clock().toISOString(),
  ): CredentialOperationRecord {
    const current = this.require(operationId);
    if (
      current.state !== "pending" &&
      !(
        current.state === "outcome_unknown" &&
        current.recoveryCode === "await_native_completion"
      )
    ) {
      throw new Error("credential operation cannot accept a live completion");
    }
    return this.transition(
      operationId,
      [current.state],
      "confirmed",
      outcome === "success"
        ? "native_success_confirmed"
        : "native_failure_confirmed",
      undefined,
      updatedAt,
    );
  }

  confirmFromExactGeneration(
    operationId: string,
    observedGeneration: string,
    updatedAt = this.clock().toISOString(),
  ): CredentialOperationRecord {
    const current = this.require(operationId);
    const generation = CredentialGenerationIdSchema.parse(observedGeneration);
    if (
      current.state !== "outcome_unknown" ||
      current.requestedGeneration === undefined ||
      current.requestedGeneration !== generation
    ) {
      throw new Error(
        "credential operation generation does not prove this unknown outcome",
      );
    }
    return this.transition(
      operationId,
      ["outcome_unknown"],
      "confirmed",
      "metadata_match_confirmed",
      undefined,
      updatedAt,
    );
  }

  markMetadataMismatch(
    operationId: string,
    updatedAt = this.clock().toISOString(),
  ): CredentialOperationRecord {
    const current = this.require(operationId);
    if (current.state !== "outcome_unknown") {
      throw new Error("only an unknown credential operation can stay ambiguous");
    }
    if (current.recoveryCode === "manual_recovery_required") return current;
    return this.transition(
      operationId,
      ["outcome_unknown"],
      "outcome_unknown",
      "metadata_mismatch",
      "manual_recovery_required",
      updatedAt,
    );
  }

  /**
   * A restarted process cannot know whether securityd committed an operation.
   * It therefore escalates every observer-dependent unresolved row without
   * treating missing or mismatched metadata as proof of failure.
   */
  recoverAfterRestart(
    updatedAt = this.clock().toISOString(),
  ): CredentialOperationRecord | undefined {
    const at = exactTimestamp(updatedAt);
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE credential_operation_journal
           SET state = 'outcome_unknown',
               result_code = 'process_interrupted',
               recovery_code = 'manual_recovery_required',
               updated_at = CASE
                 WHEN updated_at > ? THEN updated_at
                 ELSE ?
               END
           WHERE state = 'pending'
              OR (
                state = 'outcome_unknown'
                AND recovery_code = 'await_native_completion'
              )`,
        )
        .run(at, at);
    }).immediate();
    return this.unresolved();
  }

  listForTest(): CredentialOperationRecord[] {
    const rows = this.database
      .prepare(
        `SELECT operation_id, operation_kind, requested_generation, started_at,
                updated_at, state, result_code, recovery_code,
                identity_capability_version
         FROM credential_operation_journal
         ORDER BY started_at ASC, operation_id ASC`,
      )
      .all() as CredentialOperationRow[];
    return rows.map(toRecord);
  }

  private transition(
    operationId: string,
    fromStates: readonly CredentialOperationState[],
    state: CredentialOperationState,
    resultCode: CredentialOperationResultCode,
    recoveryCode: CredentialOperationRecoveryCode | undefined,
    updatedAt: string,
  ): CredentialOperationRecord {
    const canonicalId = CredentialOperationIdSchema.parse(operationId);
    const at = exactTimestamp(updatedAt);
    const placeholders = fromStates.map(() => "?").join(", ");
    const result = this.database
      .prepare(
        `UPDATE credential_operation_journal
         SET state = ?, result_code = ?, recovery_code = ?, updated_at = ?
         WHERE operation_id = ? AND state IN (${placeholders})`,
      )
      .run(
        state,
        resultCode,
        recoveryCode ?? null,
        at,
        canonicalId,
        ...fromStates,
      ) as MutationResult;
    if (result.changes !== 1) {
      throw new Error("credential operation transition was denied");
    }
    return this.require(canonicalId);
  }
}
