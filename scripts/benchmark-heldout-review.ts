#!/usr/bin/env -S node --no-warnings --experimental-strip-types

import { createPublicKey, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { z } from "zod";

import {
  HeldOutReviewAggregateV1Schema,
  HeldOutReviewEvaluationError,
  evaluateHeldOutReviewV1,
  type HeldOutReviewAggregateV1,
} from "../src/benchmark/heldout-review-evaluator.ts";
import {
  HeldOutReviewPublicationError,
  publishHeldOutReviewAggregateV1,
  type HeldOutReviewPublicationSummaryV1,
} from "../src/benchmark/heldout-review-publication.ts";
import { canonicalHeldOutJsonV1 } from "../src/shared/heldout-review-runner-contracts.ts";

export const MAX_HELD_OUT_REVIEW_CONTROL_BYTES = 64 * 1024;
const MAX_PRIVATE_JSON_BYTES = 16 * 1024 * 1024;
const MAX_PUBLIC_KEY_BYTES = 16 * 1024;

const absolutePath = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => path.isAbsolute(value), "Expected an absolute path.");
const safePublicationId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);

export const HeldOutReviewEvaluatorControlV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-review-evaluator-control-v1"),
    runnerPath: absolutePath,
    oraclePath: absolutePath,
    commitmentMaterialPath: absolutePath,
    runManifestPath: absolutePath,
    runResultsPath: absolutePath,
    privateFindingsPath: absolutePath,
    adjudicationPacketsPath: absolutePath,
    judgmentsPath: absolutePath,
    coordinatorAttestationsPath: absolutePath,
    resolutionsPath: absolutePath,
    coordinatorPublicKeyPath: absolutePath,
    outputRoot: absolutePath,
    publicationId: safePublicationId,
    sensitiveValues: z.array(z.string().max(16_384)).max(256).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const canonicalBytes = Buffer.byteLength(
      canonicalHeldOutJsonV1(value),
      "utf8",
    );
    if (canonicalBytes > MAX_HELD_OUT_REVIEW_CONTROL_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Canonical control JSON must not exceed ${MAX_HELD_OUT_REVIEW_CONTROL_BYTES} UTF-8 bytes.`,
      });
    }
  });

export type HeldOutReviewEvaluatorControlV1 = z.infer<
  typeof HeldOutReviewEvaluatorControlV1Schema
>;

const PrivateFindingsFileV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-private-findings-file-v1"),
    privateFindings: z.array(z.unknown()).max(1_536),
  })
  .strict();

const AdjudicationPacketsFileV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-adjudication-packets-file-v1"),
    adjudicationPackets: z.array(z.unknown()).max(1_536),
  })
  .strict();

const JudgmentsFileV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-adjudicator-judgments-file-v1"),
    judgments: z.array(z.unknown()).max(3_072),
  })
  .strict();

const CoordinatorAttestationsFileV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-coordinator-attestations-file-v1"),
    coordinatorAttestations: z.array(z.unknown()).max(3_072),
  })
  .strict();

const ResolutionsFileV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-adjudication-resolutions-file-v1"),
    resolutions: z.array(z.unknown()).max(1_536),
  })
  .strict();

export type HeldOutReviewCliErrorCode =
  | "argument_forbidden"
  | "control_invalid"
  | "private_input_unavailable"
  | "private_input_invalid"
  | HeldOutReviewEvaluationError["code"]
  | HeldOutReviewPublicationError["code"];

export class HeldOutReviewCliError extends Error {
  readonly code: HeldOutReviewCliErrorCode;

  constructor(code: HeldOutReviewCliErrorCode) {
    super(code);
    this.code = code;
    this.name = "HeldOutReviewCliError";
  }
}

export interface HeldOutReviewEvaluatorSummaryV1 {
  schemaVersion: "heldout-review-evaluator-summary-v1";
  assessmentStatus: HeldOutReviewAggregateV1["assessmentStatus"];
  semanticStatusReason: HeldOutReviewAggregateV1["semanticStatusReason"];
  publication: HeldOutReviewPublicationSummaryV1;
}

function cliError(code: HeldOutReviewCliErrorCode): HeldOutReviewCliError {
  return new HeldOutReviewCliError(code);
}

async function readBoundedFile(
  filePath: string,
  maximumBytes: number,
): Promise<Buffer> {
  let handle;
  try {
    handle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const information = await handle.stat();
    if (
      !information.isFile() ||
      information.size < 0 ||
      information.size > maximumBytes
    ) {
      throw cliError("private_input_invalid");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maximumBytes) {
      throw cliError("private_input_invalid");
    }
    return bytes;
  } catch (error) {
    if (error instanceof HeldOutReviewCliError) throw error;
    throw cliError("private_input_unavailable");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readBoundedJson(
  filePath: string,
  maximumBytes = MAX_PRIVATE_JSON_BYTES,
): Promise<unknown> {
  const bytes = await readBoundedFile(filePath, maximumBytes);
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw cliError("private_input_invalid");
  }
}

export function parseHeldOutReviewEvaluatorControlV1(
  value: unknown,
): HeldOutReviewEvaluatorControlV1 {
  const parsed = HeldOutReviewEvaluatorControlV1Schema.safeParse(value);
  if (!parsed.success) throw cliError("control_invalid");
  return parsed.data;
}

/** Accept only the canonical SPKI PEM encoding of an Ed25519 public key. */
export function parseCoordinatorPublicKeyV1(bytes: Buffer): KeyObject {
  try {
    const pem = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (pem.includes("PRIVATE KEY")) throw new TypeError();
    const key = createPublicKey(pem);
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      throw new TypeError();
    }
    const canonicalBytes = Buffer.from(
      key.export({ format: "pem", type: "spki" }),
    );
    if (!canonicalBytes.equals(bytes)) throw new TypeError();
    return key;
  } catch {
    throw cliError("private_input_invalid");
  }
}

export async function runHeldOutReviewEvaluatorControlV1(
  controlInput: unknown,
): Promise<HeldOutReviewEvaluatorSummaryV1> {
  const control = parseHeldOutReviewEvaluatorControlV1(controlInput);
  // Preserve stable error precedence regardless of filesystem timing.
  const runner = await readBoundedJson(control.runnerPath);
  const oracle = await readBoundedJson(control.oraclePath);
  const commitmentMaterial = await readBoundedJson(
    control.commitmentMaterialPath,
  );
  const manifest = await readBoundedJson(control.runManifestPath);
  const runResults = await readBoundedJson(control.runResultsPath);
  const privateFindingsInput = await readBoundedJson(
    control.privateFindingsPath,
  );
  const packetsInput = await readBoundedJson(control.adjudicationPacketsPath);
  const judgmentsInput = await readBoundedJson(control.judgmentsPath);
  const attestationsInput = await readBoundedJson(
    control.coordinatorAttestationsPath,
  );
  const resolutionsInput = await readBoundedJson(control.resolutionsPath);
  const coordinatorPublicKey = parseCoordinatorPublicKeyV1(
    await readBoundedFile(
      control.coordinatorPublicKeyPath,
      MAX_PUBLIC_KEY_BYTES,
    ),
  );

  let privateFindings;
  let adjudicationPackets;
  let judgments;
  let coordinatorAttestations;
  let resolutions;
  try {
    privateFindings = PrivateFindingsFileV1Schema.parse(
      privateFindingsInput,
    ).privateFindings;
    adjudicationPackets = AdjudicationPacketsFileV1Schema.parse(
      packetsInput,
    ).adjudicationPackets;
    judgments = JudgmentsFileV1Schema.parse(judgmentsInput).judgments;
    coordinatorAttestations = CoordinatorAttestationsFileV1Schema.parse(
      attestationsInput,
    ).coordinatorAttestations;
    resolutions = ResolutionsFileV1Schema.parse(resolutionsInput).resolutions;
  } catch {
    throw cliError("private_input_invalid");
  }

  let aggregate: HeldOutReviewAggregateV1;
  try {
    aggregate = HeldOutReviewAggregateV1Schema.parse(
      evaluateHeldOutReviewV1({
        runner,
        oracle,
        commitmentMaterial,
        manifest,
        runResults,
        privateFindings,
        adjudicationPackets,
        judgments,
        coordinatorAttestations,
        resolutions,
        coordinatorPublicKey,
      }),
    );
  } catch (error) {
    if (error instanceof HeldOutReviewEvaluationError) {
      throw cliError(error.code);
    }
    throw cliError("private_input_invalid");
  }

  try {
    const publication = await publishHeldOutReviewAggregateV1({
      outputRoot: control.outputRoot,
      publicationId: control.publicationId,
      aggregate,
      sensitiveValues: control.sensitiveValues,
    });
    return {
      schemaVersion: "heldout-review-evaluator-summary-v1",
      assessmentStatus: aggregate.assessmentStatus,
      semanticStatusReason: aggregate.semanticStatusReason,
      publication,
    };
  } catch (error) {
    if (error instanceof HeldOutReviewPublicationError) {
      throw cliError(error.code);
    }
    throw cliError("publication_io_failed");
  }
}

async function readStdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_HELD_OUT_REVIEW_CONTROL_BYTES + 2) {
      throw cliError("control_invalid");
    }
    chunks.push(buffer);
  }
  if (bytes === 0) throw cliError("control_invalid");
  const serialized = Buffer.concat(chunks);
  const hasPermittedTerminalLineEnding =
    bytes <= MAX_HELD_OUT_REVIEW_CONTROL_BYTES ||
    (bytes === MAX_HELD_OUT_REVIEW_CONTROL_BYTES + 1 &&
      serialized.at(-1) === 0x0a) ||
    (bytes === MAX_HELD_OUT_REVIEW_CONTROL_BYTES + 2 &&
      serialized.at(-2) === 0x0d &&
      serialized.at(-1) === 0x0a);
  if (!hasPermittedTerminalLineEnding) throw cliError("control_invalid");
  try {
    return JSON.parse(serialized.toString("utf8")) as unknown;
  } catch {
    throw cliError("control_invalid");
  }
}

function printJson(stream: NodeJS.WritableStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

export function heldOutReviewEvaluatorExitCode(
  status: HeldOutReviewAggregateV1["assessmentStatus"],
): number {
  return status === "complete" ? 0 : 2;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    if (argv.length !== 0) throw cliError("argument_forbidden");
    const summary = await runHeldOutReviewEvaluatorControlV1(
      await readStdinJson(),
    );
    printJson(process.stdout, summary);
    return heldOutReviewEvaluatorExitCode(summary.assessmentStatus);
  } catch (error) {
    const code =
      error instanceof HeldOutReviewCliError
        ? error.code
        : ("private_input_invalid" as const);
    printJson(process.stderr, {
      schemaVersion: "heldout-review-evaluator-error-v1",
      status: "error",
      code,
    });
    return 1;
  }
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === import.meta.filename;
if (invokedAsScript) {
  process.exitCode = await main();
}
