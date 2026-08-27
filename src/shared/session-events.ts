import { z } from "zod";

export const SessionStatusSchema = z.enum([
  "created",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

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

const sessionCreatedSchema = z
  .object({
    type: z.literal("session.created"),
    payload: z
      .object({
        title: z.string().trim().min(1),
        objective: z.string().trim().min(1),
        workspaceRoot: z.string().trim().min(1),
        profile: OptimizationProfileSchema.default("balanced"),
      })
      .strict(),
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

const usageRecordedSchema = z
  .object({
    type: z.literal("usage.recorded"),
    payload: z
      .object({
        inputTokens: nonNegativeInteger,
        outputTokens: nonNegativeInteger,
        reasoningTokens: nonNegativeInteger.default(0),
        costUsd: nonNegativeNumber,
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
