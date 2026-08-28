import { z } from "zod";

export const SESSION_STATUSES = [
  "created",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export const SessionStatusSchema = z.enum(SESSION_STATUSES);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const APP_TASK_TRACKS = ["repository-investigator-v1"] as const;

export const AppTaskTrackSchema = z.enum(APP_TASK_TRACKS);

export type AppTaskTrack = z.infer<typeof AppTaskTrackSchema>;

export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

export const AssistantCompletionStateSchema = z.enum(["complete", "incomplete"]);

export type AssistantCompletionState = z.infer<
  typeof AssistantCompletionStateSchema
>;

export const CitationCorrectionSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

export type CitationCorrection = z.infer<typeof CitationCorrectionSchema>;

export const COMPLETION_OBLIGATION_TOOL_NAMES = [
  "list_files",
  "search_text",
  "read_text_file",
] as const;

export const CompletionObligationToolNameSchema = z.enum(
  COMPLETION_OBLIGATION_TOOL_NAMES,
);

export type CompletionObligationToolName = z.infer<
  typeof CompletionObligationToolNameSchema
>;

const maximumAgenticPolicySteps = 32;

const orderedRequiredToolsSchema = z
  .array(CompletionObligationToolNameSchema)
  .max(maximumAgenticPolicySteps);

const maximumVerifiedPathLineCitations = 100;

export const CompletionObligationsSchema = z
  .object({
    requiredSuccessfulTools: orderedRequiredToolsSchema,
    minimumVerifiedPathLineCitations: z
      .number()
      .int()
      .nonnegative()
      .safe()
      .max(maximumVerifiedPathLineCitations),
  })
  .strict();

export type CompletionObligations = z.infer<
  typeof CompletionObligationsSchema
>;

export const AgenticExecutionPolicySchema = z
  .object({
    schemaVersion: z.literal("agentic-execution-v1"),
    inferenceRounds: z
      .number()
      .int()
      .min(1)
      .max(maximumAgenticPolicySteps)
      .safe(),
    toolCalls: z
      .number()
      .int()
      .min(1)
      .max(maximumAgenticPolicySteps)
      .safe(),
  })
  .strict();

export type AgenticExecutionPolicy = z.infer<
  typeof AgenticExecutionPolicySchema
>;

export const CompletionObligationOutcomeSchema = z.enum([
  "accepted",
  "retry",
  "exhausted",
]);

export type CompletionObligationOutcome = z.infer<
  typeof CompletionObligationOutcomeSchema
>;

export const CONTEXT_COMPILATION_MODES = ["working", "finalization"] as const;
export const ContextCompilationModeSchema = z.enum(CONTEXT_COMPILATION_MODES);
export type ContextCompilationMode = z.infer<
  typeof ContextCompilationModeSchema
>;

export const CONTEXT_COMPILATION_REASONS = [
  "session_start",
  "tool_result_boundary",
  "obligation_retry_boundary",
  "no_progress_boundary",
  "finalization_boundary",
  "no_progress_finalization_boundary",
] as const;
export const ContextCompilationReasonSchema = z.enum(
  CONTEXT_COMPILATION_REASONS,
);
export type ContextCompilationReason = z.infer<
  typeof ContextCompilationReasonSchema
>;

export const OptimizationProfileSchema = z.enum([
  "quality",
  "balanced",
  "economy",
  "fast",
]);

export type OptimizationProfile = z.infer<typeof OptimizationProfileSchema>;

export const SessionEventTypeSchema = z.enum([
  "session.created",
  "session.started",
  "user.message",
  "route.assigned",
  "assistant.message.started",
  "assistant.message.delta",
  "assistant.message.completed",
  "tool.call.requested",
  "tool.call.completed",
  "context.compiled",
  "completion.obligations.checked",
  "usage.recorded",
  "session.completed",
  "session.failed",
  "session.cancelled",
  "session.interrupted",
]);

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const requiredId = z.string().trim().min(1);
const nonNegativeInteger = z.number().int().nonnegative();
const nonNegativeNumber = z.number().finite().nonnegative();
const safeNonNegativeInteger = z.number().int().nonnegative().safe();
const safePositiveInteger = z.number().int().positive().safe();

const sessionCreatedSchema = z
  .object({
    type: z.literal("session.created"),
    payload: z
      .object({
        title: z.string().trim().min(1),
        objective: z.string().trim().min(1),
        workspaceRoot: z.string().trim().min(1),
        profile: OptimizationProfileSchema.default("balanced"),
        taskTrack: AppTaskTrackSchema.optional(),
        completionObligations: CompletionObligationsSchema.optional(),
        executionPolicy: AgenticExecutionPolicySchema.optional(),
      })
      .strict()
      .superRefine((payload, context) => {
        const obligations = payload.completionObligations;
        const active =
          obligations !== undefined &&
          (obligations.requiredSuccessfulTools.length > 0 ||
            obligations.minimumVerifiedPathLineCitations > 0);
        if (active && payload.executionPolicy === undefined) {
          context.addIssue({
            code: "custom",
            message:
              "active completion obligations require agentic-execution-v1 policy",
            path: ["executionPolicy"],
          });
        }
        if (active && payload.executionPolicy !== undefined) {
          const minimumToolRounds = Math.max(
            obligations?.requiredSuccessfulTools.length ?? 0,
            (obligations?.minimumVerifiedPathLineCitations ?? 0) > 0 ? 1 : 0,
          );
          if (payload.executionPolicy.toolCalls < minimumToolRounds) {
            context.addIssue({
              code: "custom",
              message:
                "execution policy needs enough tool calls for the completion obligations",
              path: ["executionPolicy", "toolCalls"],
            });
          }
          if (
            payload.executionPolicy.inferenceRounds <
            minimumToolRounds + 1
          ) {
            context.addIssue({
              code: "custom",
              message:
                "execution policy needs one inference round per required tool plus final synthesis",
              path: ["executionPolicy", "inferenceRounds"],
            });
          }
        }
      }),
  })
  .strict();

const sessionStartedSchema = z
  .object({
    type: z.literal("session.started"),
    payload: z.object({}).strict(),
  })
  .strict();

const userMessageSchema = z
  .object({
    type: z.literal("user.message"),
    payload: z
      .object({
        messageId: requiredId,
        content: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const routeAssignedSchema = z
  .object({
    type: z.literal("route.assigned"),
    payload: z
      .object({
        providerId: requiredId,
        model: requiredId,
        reason: z.string().trim().min(1),
        leaseId: requiredId.optional(),
      })
      .strict(),
  })
  .strict();

const assistantMessageStartedSchema = z
  .object({
    type: z.literal("assistant.message.started"),
    payload: z
      .object({
        messageId: requiredId,
        providerId: requiredId,
        model: requiredId,
      })
      .strict(),
  })
  .strict();

const assistantMessageDeltaSchema = z
  .object({
    type: z.literal("assistant.message.delta"),
    payload: z
      .object({
        messageId: requiredId,
        delta: z.string(),
      })
      .strict(),
  })
  .strict();

const assistantMessageCompletedSchema = z
  .object({
    type: z.literal("assistant.message.completed"),
    payload: z
      .object({
        messageId: requiredId,
        content: z.string().optional(),
        stopReason: z.string().trim().min(1).nullable().optional(),
        completionState: AssistantCompletionStateSchema.optional(),
        citationCorrections: z.array(CitationCorrectionSchema).optional(),
      })
      .strict(),
  })
  .strict();

const toolCallRequestedSchema = z
  .object({
    type: z.literal("tool.call.requested"),
    payload: z
      .object({
        toolCallId: requiredId,
        name: requiredId,
        arguments: JsonValueSchema,
        messageId: requiredId.optional(),
      })
      .strict(),
  })
  .strict();

const toolCallCompletedSchema = z
  .object({
    type: z.literal("tool.call.completed"),
    payload: z
      .object({
        toolCallId: requiredId,
        name: requiredId,
        content: z.string(),
        isError: z.boolean().default(false),
        durationMs: nonNegativeNumber.optional(),
      })
      .strict(),
  })
  .strict();

const contextCompiledSchema = z
  .object({
    type: z.literal("context.compiled"),
    payload: z
      .object({
        checkpointId: requiredId,
        compilerVersion: z.literal("context-compiler-v1"),
        reason: ContextCompilationReasonSchema,
        mode: ContextCompilationModeSchema,
        providerId: requiredId,
        model: requiredId,
        maxTokens: safePositiveInteger,
        estimatedTokens: safeNonNegativeInteger,
        estimator: z.literal("utf8-bytes-v1"),
        reservedInputTokens: safeNonNegativeInteger,
        effectiveInputTokenBudget: safeNonNegativeInteger,
        sourceMessageCount: safeNonNegativeInteger,
        messageCount: safeNonNegativeInteger,
        evidenceCount: safeNonNegativeInteger,
        deduplicatedEvidenceCount: safeNonNegativeInteger,
        omittedEvidenceCount: safeNonNegativeInteger,
        packetSha256: z.string().regex(/^[a-f0-9]{64}$/),
        messagesSha256: z.string().regex(/^[a-f0-9]{64}$/),
        safetyMargin: z.number().finite().min(0).lt(1),
      })
      .strict()
      .superRefine((payload, context) => {
        const expectedEffectiveBudget =
          payload.maxTokens -
          Math.ceil(payload.maxTokens * payload.safetyMargin) -
          payload.reservedInputTokens;
        if (
          expectedEffectiveBudget < 0 ||
          payload.effectiveInputTokenBudget !== expectedEffectiveBudget
        ) {
          context.addIssue({
            code: "custom",
            message:
              "effectiveInputTokenBudget must equal maxTokens minus the safety margin and reservedInputTokens",
            path: ["effectiveInputTokenBudget"],
          });
        }
        if (payload.estimatedTokens > payload.effectiveInputTokenBudget) {
          context.addIssue({
            code: "custom",
            message:
              "estimatedTokens must not exceed effectiveInputTokenBudget",
            path: ["estimatedTokens"],
          });
        }
      }),
  })
  .strict();

const verifiedPathLineCitationSchema = z
  .string()
  .min(3)
  .max(4_096)
  .regex(/^[^\r\n]+:[1-9][0-9]*$/u);

const canonicalVerifiedCitationListSchema = z
  .array(verifiedPathLineCitationSchema)
  .max(maximumVerifiedPathLineCitations)
  .superRefine((citations, context) => {
    for (let index = 1; index < citations.length; index += 1) {
      const previous = citations[index - 1];
      const current = citations[index];
      if (previous !== undefined && current !== undefined && previous >= current) {
        context.addIssue({
          code: "custom",
          message: "verified path-line citations must be sorted and unique",
          path: [index],
        });
      }
    }
  });

export const CompletionObligationCheckPayloadSchema = z
  .object({
    checkId: requiredId,
    messageId: requiredId,
    round: safePositiveInteger,
    remainingRounds: safeNonNegativeInteger,
    successfulRequiredTools: orderedRequiredToolsSchema,
    missingRequiredTools: orderedRequiredToolsSchema,
    verifiedPathLineCitations: canonicalVerifiedCitationListSchema,
    unresolvedCitationCount: safeNonNegativeInteger,
    outcome: CompletionObligationOutcomeSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.outcome === "accepted" &&
      (payload.missingRequiredTools.length > 0 ||
        payload.unresolvedCitationCount > 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "accepted obligation checks cannot have missing tools or unresolved citations",
        path: ["outcome"],
      });
    }
    if (payload.outcome === "retry" && payload.remainingRounds === 0) {
      context.addIssue({
        code: "custom",
        message: "retry obligation checks require at least one remaining round",
        path: ["remainingRounds"],
      });
    }
    if (payload.outcome === "exhausted" && payload.remainingRounds !== 0) {
      context.addIssue({
        code: "custom",
        message: "exhausted obligation checks cannot have remaining rounds",
        path: ["remainingRounds"],
      });
    }
  });

export type CompletionObligationCheckPayload = z.infer<
  typeof CompletionObligationCheckPayloadSchema
>;

const completionObligationsCheckedSchema = z
  .object({
    type: z.literal("completion.obligations.checked"),
    payload: CompletionObligationCheckPayloadSchema,
  })
  .strict();

const usageRecordedSchema = z
  .object({
    type: z.literal("usage.recorded"),
    payload: z
      .object({
        inputTokens: nonNegativeInteger,
        outputTokens: nonNegativeInteger,
        reasoningTokens: nonNegativeInteger.default(0),
        reported: z.boolean().optional(),
        costUsd: nonNegativeNumber,
        costProvenance: z
          .enum(["provider_reported", "local_zero_cost_policy", "unreported"])
          .optional(),
        servedModel: requiredId.optional(),
        latencyMs: nonNegativeNumber.optional(),
        ttftMs: nonNegativeNumber.optional(),
      })
      .strict(),
  })
  .strict();

const sessionCompletedSchema = z
  .object({
    type: z.literal("session.completed"),
    payload: z
      .object({
        result: z.string().optional(),
      })
      .strict(),
  })
  .strict();

const sessionFailedSchema = z
  .object({
    type: z.literal("session.failed"),
    payload: z
      .object({
        error: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

const sessionCancelledSchema = z
  .object({
    type: z.literal("session.cancelled"),
    payload: z
      .object({
        reason: z.string().trim().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const sessionInterruptedSchema = z
  .object({
    type: z.literal("session.interrupted"),
    payload: z
      .object({
        reason: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export const SessionEventDataSchema = z.discriminatedUnion("type", [
  sessionCreatedSchema,
  sessionStartedSchema,
  userMessageSchema,
  routeAssignedSchema,
  assistantMessageStartedSchema,
  assistantMessageDeltaSchema,
  assistantMessageCompletedSchema,
  toolCallRequestedSchema,
  toolCallCompletedSchema,
  contextCompiledSchema,
  completionObligationsCheckedSchema,
  usageRecordedSchema,
  sessionCompletedSchema,
  sessionFailedSchema,
  sessionCancelledSchema,
  sessionInterruptedSchema,
]);

export type SessionEventData = z.infer<typeof SessionEventDataSchema>;
export type SessionEventType = z.infer<typeof SessionEventTypeSchema>;

export const StoredSessionEventSchema = z
  .object({
    id: requiredId,
    sessionId: requiredId,
    sequence: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
    type: SessionEventTypeSchema,
    payload: z.record(z.string(), JsonValueSchema),
  })
  .strict();

export type StoredSessionEvent = Omit<
  z.infer<typeof StoredSessionEventSchema>,
  "type" | "payload"
> &
  SessionEventData;

export function parseSessionEventData(value: unknown): SessionEventData {
  return SessionEventDataSchema.parse(value);
}

export function parseStoredSessionEvent(value: unknown): StoredSessionEvent {
  const envelope = StoredSessionEventSchema.parse(value);
  const data = parseSessionEventData({
    type: envelope.type,
    payload: envelope.payload,
  });

  return {
    id: envelope.id,
    sessionId: envelope.sessionId,
    sequence: envelope.sequence,
    createdAt: envelope.createdAt,
    ...data,
  };
}
