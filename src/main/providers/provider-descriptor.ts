import { z } from "zod";

export const PROVIDER_CAPABILITIES = [
  "chat_completions",
  "streaming",
  "tool_calling",
  "reasoning_effort",
  "structured_json_schema",
] as const;

export const ProviderCapabilitySchema = z.enum(PROVIDER_CAPABILITIES);
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

const positiveTokenCount = z.number().int().positive().safe().max(16_777_216);
const nonNegativeTokenCount = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .max(16_777_216);
const microusdRate = z
  .number()
  .int()
  .positive()
  .safe()
  .max(1_000_000_000_000);

export const ProviderAccountingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local_zero_cost") }).strict(),
  z
    .object({
      kind: z.literal("metered"),
      inputMicrousdPerMillionTokens: microusdRate,
      outputMicrousdPerMillionTokens: microusdRate,
      cacheReadMicrousdPerMillionTokens: microusdRate.optional(),
      pricingVerifiedAt: z.string().datetime({ offset: true }),
      pricingSource: z.string().url().max(2_048),
    })
    .strict(),
]);

export type ProviderAccounting = z.infer<typeof ProviderAccountingSchema>;

export const ProviderDescriptorSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    adapter: z.literal("openai-compatible"),
    locality: z.enum(["local", "cloud"]),
    model: z.string().trim().min(1).max(256),
    enabled: z.boolean(),
    capabilities: z.array(ProviderCapabilitySchema).min(1).max(32),
    contextWindowTokens: positiveTokenCount,
    maxOutputTokens: positiveTokenCount,
    requestReserveTokens: nonNegativeTokenCount,
    accounting: ProviderAccountingSchema,
  })
  .strict()
  .superRefine((descriptor, context) => {
    const sortedCapabilities = [...descriptor.capabilities].sort();
    if (
      new Set(descriptor.capabilities).size !== descriptor.capabilities.length ||
      sortedCapabilities.some(
        (capability, index) => capability !== descriptor.capabilities[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "provider capabilities must be sorted and unique",
      });
    }
    if (!descriptor.capabilities.includes("chat_completions")) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "provider must support chat_completions",
      });
    }
    if (!descriptor.capabilities.includes("streaming")) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "provider must support streaming",
      });
    }
    if (
      descriptor.maxOutputTokens + descriptor.requestReserveTokens >=
      descriptor.contextWindowTokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["contextWindowTokens"],
        message:
          "contextWindowTokens must exceed maxOutputTokens plus requestReserveTokens",
      });
    }
    if (
      descriptor.locality === "local" &&
      descriptor.accounting.kind !== "local_zero_cost"
    ) {
      context.addIssue({
        code: "custom",
        path: ["accounting"],
        message: "v0 local providers require explicit local_zero_cost accounting",
      });
    }
    if (
      descriptor.locality === "cloud" &&
      descriptor.accounting.kind !== "metered"
    ) {
      context.addIssue({
        code: "custom",
        path: ["accounting"],
        message: "v0 cloud providers require explicit metered accounting",
      });
    }
  });

export type ProviderDescriptor = z.infer<typeof ProviderDescriptorSchema>;

export const PAID_PRICING_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export interface ProviderAccountingFreshnessInput {
  /** Replayable selection/admission time. Callers must not hide a live clock here. */
  asOf: Date | string | number;
  maxAgeMs?: number;
}

export function parseProviderDescriptor(value: unknown): ProviderDescriptor {
  const descriptor = ProviderDescriptorSchema.parse(value);
  Object.freeze(descriptor.capabilities);
  Object.freeze(descriptor.accounting);
  return Object.freeze(descriptor);
}

function timestampMilliseconds(value: Date | string | number, label: string): number {
  const milliseconds =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  return milliseconds;
}

/**
 * Admission-time validation for paid metadata. Descriptor parsing stays
 * timeless so persisted inputs can be replayed without consulting a clock.
 */
export function assertProviderAccountingFresh(
  descriptor: ProviderDescriptor,
  input: ProviderAccountingFreshnessInput,
): void {
  if (descriptor.accounting.kind !== "metered") return;

  const asOfMs = timestampMilliseconds(input.asOf, "pricing as-of time");
  const verifiedAtMs = timestampMilliseconds(
    descriptor.accounting.pricingVerifiedAt,
    "pricing verification time",
  );
  const maxAgeMs = input.maxAgeMs ?? PAID_PRICING_MAX_AGE_MS;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new RangeError("pricing maximum age must be a positive safe integer");
  }

  const ageMs = asOfMs - verifiedAtMs;
  if (ageMs < 0) {
    throw new Error(
      `paid pricing for provider ${descriptor.id} is verified in the future`,
    );
  }
  if (ageMs >= maxAgeMs) {
    throw new Error(`paid pricing for provider ${descriptor.id} is stale`);
  }
}

export function hasProviderCapabilities(
  descriptor: ProviderDescriptor,
  required: readonly ProviderCapability[],
): boolean {
  const available = new Set(descriptor.capabilities);
  return required.every((capability) => available.has(capability));
}
