import { createHash } from "node:crypto";
import { PatchRunCreateInputSchema } from "../../shared/patch-run-contracts";

export interface EvaluationObjectiveBindingInput {
  rawObjective: Uint8Array;
  expectedRawSha256: string;
  snapshotObjective: string;
}

/** Verify frozen bytes first, then compare the objective admitted by the create
 * contract. This pure check neither grants candidate eligibility nor runs an
 * evaluator. Hashes identify raw evidence and normalized input separately. */
export function validateEvaluationObjectiveBinding(input: EvaluationObjectiveBindingInput) {
  if (!(input.rawObjective instanceof Uint8Array) || typeof input.expectedRawSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(input.expectedRawSha256)) {
    throw new Error("Frozen objective binding is invalid.");
  }
  const raw = Buffer.from(input.rawObjective);
  const rawObjectiveSha256 = createHash("sha256").update(raw).digest("hex");
  if (rawObjectiveSha256 !== input.expectedRawSha256) throw new Error("Frozen objective hash mismatch.");
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) throw new Error("Frozen objective is not valid UTF-8.");
  const admitted = PatchRunCreateInputSchema.shape.objective.safeParse(text);
  if (!admitted.success) throw new Error("Frozen objective does not satisfy the create contract.");
  if (input.snapshotObjective !== admitted.data) throw new Error("Snapshot objective differs from the admitted frozen objective.");
  return {
    rawObjectiveSha256,
    admittedObjectiveSha256: createHash("sha256").update(admitted.data).digest("hex"),
    rawBytes: raw.length,
    admittedBytes: Buffer.byteLength(admitted.data),
  };
}
