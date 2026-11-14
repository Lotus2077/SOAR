/**
 * SC: the shared serving-card reader. The machine-readable serving card (ServingCardV1) is written by
 * `scripts/serving-card.py --policy-out` from one probe run, reviewed, adopted in a reviewed commit and selected by the pair
 * SOAR_SERVING_CARD_FILE and SOAR_SERVING_CARD_SHA256 in the ignored .env.local. The reader is pinned (the file's sha256 must
 * match), reads only adopted cards measured on the configured served alias (and, under flash_next_v1, the configured
 * context), refuses a value the card's own evidence does not back, and fails closed: every value that differs from today's
 * default is refused until the consumer that reads it has merged (serving-card-flags.ts). Every refusal is a
 * ServingCardError whose message is a fixed snake_case code; it never carries card text, a card key or the file path.
 * Without the pair nothing reads a file and consumers use DEFAULT_SERVING_POLICY: exactly today's behaviour.
 */
import { z } from "zod";
import type { SoarConfig } from "../config";
import { canonical, digest, sha256Schema } from "./contracts";
import { pinned } from "./flash-next-admission";
import { COORDINATOR_PROFILES } from "./profiles";
import { ResearchSynthesisSchema } from "./research-coverage";
import { RESEARCH_EXTRACT_JSON_SCHEMA, researchProtocolSha256 } from "./research-pipeline";
import { RESEARCH_PLAN_JSON_SCHEMA } from "./research-plan";
import { DEFAULT_RESEARCH_ROLE_POLICY, MIN_ROLE_OUTPUT_TOKENS, RESEARCH_ROLES, ResearchRolePolicySchema, STRUCTURED_OUTPUT_ROLES, StructuredOutputVariantSchema,
  nonDefaultRoleParameters, type ResearchRolePolicy, type StructuredOutputRole, type StructuredOutputVariant } from "./research-roles";
import { SERVING_CARD_CONSUMED, type ServingCardParameter } from "./serving-card-flags";

export { SERVING_CARD_PARAMETERS, SERVING_CARD_CONSUMED, type ServingCardParameter } from "./serving-card-flags";

export const SERVING_CARD_KIND = "soar_serving_card", SERVING_CARD_VERSION = 1, SERVING_CARD_MAX_BYTES = 64 * 1024, MAX_LOCAL_STREAMS = 8;
/** The profile every research role runs under (the driver refuses the pipeline, a seeded run and the loop under any other). */
export const RESEARCH_ROLE_MAX_OUTPUT_TOKENS = COORDINATOR_PROFILES.heavy.maxOutputTokens;
/** Structured output needs an assessed P10 cell of at least this many calls, at least this share valid (scripts/serving-card.py's constants). */
export const P10_RULE = Object.freeze({ minCalls: 20, minValidPercent: 95 });
export interface ServingCardDescriptor { path: string; sha256: string }

const CONTROL = /[\x00-\x1f\x7f]/u;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
/** The writer's rule (scripts/serving-card.py looks_like_path): a leading /, ~ or ., a backslash, a .. segment or a drive letter. */
export function looksLikePath(text: string): boolean {
  return /^[\/~.]/u.test(text) || text.includes("\\") || text.split("/").includes("..") || /^[A-Za-z]:/u.test(text);
}
const plainText = (value: string) => !CONTROL.test(value) && !LONE_SURROGATE.test(value);
const identityText = (max: number) => z.string().min(1).max(max).refine(value => plainText(value) && !looksLikePath(value));
const calendarDate = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !value.startsWith("0000") && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
});
const count = z.number().int().nonnegative(), positive = z.number().int().positive();
/** Seconds (`S`) or tokens per second (`TokS`), or null where the probe lacks the value. */
const measure = z.number().nonnegative().nullable();
const boundedRecord = <T extends z.ZodType>(key: RegExp, value: T, max: number) =>
  z.record(z.string().regex(key), value).refine(record => Object.keys(record).length <= max);
const PROBE_NAMES = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "adapter"] as const;
const probeNames = z.array(z.enum(PROBE_NAMES)).max(PROBE_NAMES.length).refine(names => new Set(names).size === names.length);

const P10CellSchema = z.object({ variant: StructuredOutputVariantSchema, maxTokens: positive, total: count, valid: count, truncated: count, invalidJson: count,
  schemaInvalid: count, bindingInvalid: count, requestRejected: count, unassessed: count, meanCompletionTokens: measure, meanReasoningTokens: measure }).strict()
  .refine(cell => cell.valid + cell.truncated + cell.invalidJson + cell.schemaInvalid + cell.bindingInvalid + cell.requestRejected + cell.unassessed === cell.total);
const AcceptanceSchema = z.object({ strict: z.boolean(), nonStrict: z.boolean() }).strict();
const P10EvidenceSchema = z.object({
  callsPerCell: positive, strictRequested: z.boolean(),
  /** The role export's protocol hash (schemas_protocol_sha256); the assessor's own hash and verdict sit in `assessed`. */
  protocolSha256: sha256Schema.nullable(),
  schemaSha256: z.object({ plan: sha256Schema, extract: sha256Schema, synthesis: sha256Schema }).strict(),
  assessed: z.object({ protocolSha256: sha256Schema, schemasProtocolMatch: z.boolean() }).strict().nullable(),
  acceptance: z.object({ plan: AcceptanceSchema.optional(), extract: AcceptanceSchema.optional(), synthesis: AcceptanceSchema.optional() }).strict(),
  cells: z.object({ "plan/on": P10CellSchema.optional(), "plan/off": P10CellSchema.optional(), "extract/on": P10CellSchema.optional(),
    "extract/off": P10CellSchema.optional(), "synthesis/on": P10CellSchema.optional(), "synthesis/off": P10CellSchema.optional() }).strict(),
}).strict().refine(p10 => p10.assessed === null || p10.assessed.schemasProtocolMatch === (p10.protocolSha256 !== null && p10.assessed.protocolSha256 === p10.protocolSha256));
const P11SizeSchema = z.object({ ok: z.boolean(), promptTokens: count.nullable(), completionTokens: count.nullable(), ttftS: measure, prefillTokS: measure,
  decodeTokS: measure, tokensPerWord: measure }).strict();
const P11LayoutSchema = z.object({ cacheSaltAccepted: z.boolean(),
  requests: z.array(z.object({ promptTokens: count.nullable(), cachedTokens: count.nullable(), ttftS: measure }).strict()).max(8) }).strict();
/** One K burst: decode concurrency on the probe's one-sentence prompt only, never at extraction-size prompts. */
const P11BurstSchema = z.object({ streams: positive, errors: count, medianDecodeTokS: measure, aggregateTokS: measure, maxTtftS: measure, maxTotalS: measure,
  runningMax: measure }).strict().refine(burst => burst.errors <= burst.streams);
const P11EvidenceSchema = z.object({ tokensPerWordAssumed: z.number().positive(), maxTokens: positive,
  sizes: boundedRecord(/^[1-9][0-9]{0,6}$/u, P11SizeSchema, 16), sizesRefused: z.array(positive).max(16),
  cacheLayouts: z.object({ packetBytes: count, chunkBytes: z.array(count).max(8), layouts: boundedRecord(/^[a-z_]{1,32}$/u, P11LayoutSchema, 8) }).strict().nullable(),
  kStreams: boundedRecord(/^[1-9][0-9]{0,2}$/u, P11BurstSchema, 16) }).strict();
/** The Markdown's derived ceilings; zero or negative when the prefill exceeds the clock. Informational: no gate reads them. */
const RoleBoundSchema = z.object({ promptTokensAssumed: positive, ceiling300s: z.number().int().nullable(), ceiling900s: z.number().int().nullable() }).strict();

export const ServingCardV1Schema = z.object({
  kind: z.literal(SERVING_CARD_KIND), version: z.literal(SERVING_CARD_VERSION), date: calendarDate,
  decision: z.object({ status: z.enum(["proposed", "adopted"]), entry: z.string().regex(/^BL-\d{8}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/u).nullable() }).strict(),
  /** Enough to match the endpoint, never an address, a path or a key. */
  identity: z.object({ servedModel: identityText(256), engineVersion: identityText(128).nullable(), contextTokens: positive.nullable(),
    modelRootBasename: z.string().min(1).max(256).refine(value => plainText(value) && !value.includes("/") && !value.includes("\\")).nullable() }).strict(),
  probe: z.object({ probeVersion: z.literal(2), sha256: sha256Schema, probesRun: probeNames, probesSkipped: probeNames, probesFailed: probeNames }).strict(),
  roles: ResearchRolePolicySchema,
  concurrency: z.object({ localStreams: z.number().int().min(1).max(MAX_LOCAL_STREAMS) }).strict(),
  admission: z.object({ basis: z.enum(["none", "serving_card"]) }).strict(),
  evidence: z.object({ p10: P10EvidenceSchema.nullable(), p11: P11EvidenceSchema.nullable(),
    bounds: z.object({ index: RoleBoundSchema, plan: RoleBoundSchema, extract: RoleBoundSchema, synthesis: RoleBoundSchema }).strict().nullable(),
    adapter: z.object({ legacyConsistent: z.boolean(), flashNextV1Consistent: z.boolean(), tokenizeParity: z.boolean().nullable() }).strict().nullable() }).strict(),
}).strict();
export type ServingCardV1 = z.infer<typeof ServingCardV1Schema>;

export const SERVING_CARD_CODES = ["serving_card_pin_drift", "serving_card_version_unsupported", "serving_card_invalid", "serving_card_not_adopted",
  "serving_card_model_mismatch", "serving_card_context_mismatch", "serving_card_cap_out_of_range", "serving_card_structured_output_unassessed",
  "serving_card_p10_protocol_drift", "serving_card_schema_drift", "serving_card_structured_output_variant_mismatch",
  "serving_card_structured_output_below_rule", "serving_card_streams_unproven", "serving_card_parameter_unconsumed"] as const;
export type ServingCardCode = (typeof SERVING_CARD_CODES)[number];

/**
 * Every key path a refusal may carry, built from the fixed role and mode names; never a card key, card text or the file path.
 * A frozen array, because Object.freeze leaves a Set's contents mutable; the lookup Set stays private to this module.
 */
export const SERVING_CARD_PARAMETER_PATHS: readonly string[] = Object.freeze([
  "decision", "identity.servedModel", "identity.contextTokens",
  ...RESEARCH_ROLES.flatMap(role => [`roles.${role}.maxOutputTokens`, `roles.${role}.maxOutputTokens[0]`, `roles.${role}.maxOutputTokens[1]`, `roles.${role}.thinking`]),
  ...STRUCTURED_OUTPUT_ROLES.flatMap(role => [`roles.${role}.structuredOutput`, `roles.${role}.structuredOutput.thinkingOff`, `roles.${role}.structuredOutput.thinkingOn`]),
  "concurrency.localStreams", "admission.basis",
]);
const PARAMETER_PATHS: ReadonlySet<string> = new Set(SERVING_CARD_PARAMETER_PATHS);
export function isServingCardParameterPath(value: unknown): value is string { return typeof value === "string" && PARAMETER_PATHS.has(value); }

/** The message is the code. The three file-level codes carry no key path; the others carry one from SERVING_CARD_PARAMETER_PATHS. */
export class ServingCardError extends Error {
  readonly parameter?: string;
  constructor(readonly code: ServingCardCode, parameter?: string) {
    super(code); this.name = "ServingCardError";
    if (isServingCardParameterPath(parameter)) this.parameter = parameter;
  }
}
function refuse(code: ServingCardCode, parameter?: string): never { throw new ServingCardError(code, parameter); }

/**
 * What a failure line may print about a serving-card refusal: its fixed code and allowlisted key path, both checked again here
 * because they are printed; undefined for any other error, so that error's line keeps its earlier bytes.
 */
export function servingCardRefusal(error: unknown): { code: ServingCardCode; parameter?: string } | undefined {
  if (!(error instanceof ServingCardError) || !(SERVING_CARD_CODES as readonly string[]).includes(error.code)) return undefined;
  return { code: error.code, ...(isServingCardParameterPath(error.parameter) ? { parameter: error.parameter } : {}) };
}

/** What a consumer reads: never the raw card. */
export interface ServingPolicy { roles: ResearchRolePolicy; localStreams: number; admission: { basis: "none" | "serving_card" } }

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
}
/** Today's caps and thinking on both attempts, no structured output, K 1 and admission none. */
export const DEFAULT_SERVING_POLICY: Readonly<ServingPolicy> = deepFreeze({ roles: structuredClone(DEFAULT_RESEARCH_ROLE_POLICY) as ResearchRolePolicy, localStreams: 1,
  admission: { basis: "none" as const } });

/** SOAR_VLLM_MODEL, and SOAR_VLLM_CONTEXT_TOKENS only under flash_next_v1. */
export interface ServingCardExpectation { model: string; contextTokens?: number }
export function servingCardExpectation(config: Pick<SoarConfig, "vllm">): ServingCardExpectation {
  return { model: config.vllm.model,
    ...(config.vllm.localReplyContract === "flash_next_v1" && config.vllm.localContextTokens !== undefined ? { contextTokens: config.vllm.localContextTokens } : {}) };
}

/** sha256(canonical(schema)) of the three schemas the role export gives P10 (scripts/export-role-schemas.ts); computed on call. */
export function currentRoleSchemaSha256(): Readonly<Record<StructuredOutputRole, string>> {
  return Object.freeze({ plan: digest(canonical(RESEARCH_PLAN_JSON_SCHEMA)), extract: digest(canonical(RESEARCH_EXTRACT_JSON_SCHEMA)),
    synthesis: digest(canonical(z.toJSONSchema(ResearchSynthesisSchema))) });
}

const JSON_WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
/**
 * True when one object of `text` repeats a key, compared after unescaping. `text` is JSON that JSON.parse has accepted, which
 * keeps only a repeated key's last value: a reviewer reading the file from the top would then see another value than the
 * reader resolves, and the bytes kept in the run directory would hold an unvalidated value.
 */
function repeatsKey(text: string): boolean {
  const open: (Set<string> | undefined)[] = [];
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "{") open.push(new Set());
    else if (char === "[") open.push(undefined);
    else if (char === "}" || char === "]") open.pop();
    else if (char === "\"") {
      let end = at + 1;
      while (end < text.length && text[end] !== "\"") end += text[end] === "\\" ? 2 : 1;
      let next = end + 1;
      while (JSON_WHITESPACE.has(text[next] ?? "")) next++;
      // In valid JSON a string is a key exactly when it sits directly in an object and a colon follows it.
      const keys = open[open.length - 1];
      if (keys && text[next] === ":") {
        const key = JSON.parse(text.slice(at, end + 1)) as string;
        if (keys.has(key)) return true;
        keys.add(key);
      }
      at = end;
    }
  }
  return false;
}

/**
 * Syntax only (tests, round trips); no consumer reads a value from its result, and a guard test (R10) refuses any production
 * module other than this one that names it or ServingCardV1Schema. A `__proto__` key, which zod would drop silently, and a
 * key repeated within one object, which JSON.parse would resolve to its last value, are invalid.
 */
export function parseServingCard(bytes: Uint8Array): ServingCardV1 {
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text, (key, item: unknown) => {
      if (key === "__proto__") throw new Error("serving_card_invalid");
      return item;
    });
    if (repeatsKey(text)) throw new Error("serving_card_invalid");
  } catch { return refuse("serving_card_invalid"); }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const head = value as { kind?: unknown; version?: unknown };
    if (head.kind === SERVING_CARD_KIND && typeof head.version === "number" && head.version !== SERVING_CARD_VERSION) refuse("serving_card_version_unsupported");
  }
  const parsed = ServingCardV1Schema.safeParse(value);
  return parsed.success ? parsed.data : refuse("serving_card_invalid");
}

/** Role values from nonDefaultRoleParameters, then K other than 1, then admission other than none. */
export function nonDefaultParameters(policy: ServingPolicy): { parameter: ServingCardParameter; at: string }[] {
  return [...nonDefaultRoleParameters(policy.roles),
    ...(policy.localStreams !== DEFAULT_SERVING_POLICY.localStreams ? [{ parameter: "localStreams" as const, at: "concurrency.localStreams" }] : []),
    ...(policy.admission.basis !== DEFAULT_SERVING_POLICY.admission.basis ? [{ parameter: "admission" as const, at: "admission.basis" }] : [])];
}

/**
 * Steps 4-10 of the reader against SERVING_CARD_CONSUMED: adopted, the served alias and (under flash_next_v1) the context,
 * every cap within [128, the heavy profile's limit], the evidence for each flagged structured-output mode, the burst for
 * K > 1, then fail closed. Pure; there is no override argument.
 */
export function resolveServingCard(card: ServingCardV1, expectation: ServingCardExpectation): ServingPolicy {
  if (card.decision.status !== "adopted" || card.decision.entry === null) refuse("serving_card_not_adopted", "decision");
  if (card.identity.servedModel !== expectation.model) refuse("serving_card_model_mismatch", "identity.servedModel");
  if (expectation.contextTokens !== undefined && card.identity.contextTokens !== expectation.contextTokens) refuse("serving_card_context_mismatch", "identity.contextTokens");
  for (const role of RESEARCH_ROLES) {
    card.roles[role].maxOutputTokens.forEach((cap, attempt) => {
      if (cap < MIN_ROLE_OUTPUT_TOKENS || cap > RESEARCH_ROLE_MAX_OUTPUT_TOKENS) refuse("serving_card_cap_out_of_range", `roles.${role}.maxOutputTokens[${attempt}]`);
    });
  }
  let protocol: string | undefined, schemas: Readonly<Record<StructuredOutputRole, string>> | undefined;
  for (const role of STRUCTURED_OUTPUT_ROLES) {
    const flag = card.roles[role].structuredOutput;
    if (flag === null) continue;
    for (const mode of ["off", "on"] as const) {
      if (!(mode === "off" ? flag.thinkingOff : flag.thinkingOn)) continue;
      const at = `roles.${role}.structuredOutput.${mode === "off" ? "thinkingOff" : "thinkingOn"}`, p10 = card.evidence.p10;
      if (p10 === null || p10.assessed === null) refuse("serving_card_structured_output_unassessed", at);
      // The value today's role export would send: P10 evidence measured under another protocol does not describe today's requests.
      protocol ??= researchProtocolSha256();
      if (p10.protocolSha256 !== protocol || p10.assessed.protocolSha256 !== protocol) refuse("serving_card_p10_protocol_drift", at);
      schemas ??= currentRoleSchemaSha256();
      if (p10.schemaSha256[role] !== schemas[role]) refuse("serving_card_schema_drift", at);
      const cell = p10.cells[`${role}/${mode}`];
      if (cell === undefined || cell.unassessed !== 0) refuse("serving_card_structured_output_unassessed", at);
      const requested: StructuredOutputVariant = p10.strictRequested ? "strict" : "non_strict";
      if (flag.variant !== requested || cell.variant !== flag.variant) refuse("serving_card_structured_output_variant_mismatch", at);
      if (cell.total < P10_RULE.minCalls || cell.valid * 100 < P10_RULE.minValidPercent * cell.total) refuse("serving_card_structured_output_below_rule", at);
    }
  }
  const streams = card.concurrency.localStreams;
  if (streams > 1) {
    const bursts = card.evidence.p11?.kStreams, burst = bursts && Object.hasOwn(bursts, String(streams)) ? bursts[String(streams)] : undefined;
    if (burst === undefined || burst.streams !== streams || burst.errors !== 0) refuse("serving_card_streams_unproven", "concurrency.localStreams");
  }
  const policy: ServingPolicy = { roles: structuredClone(card.roles), localStreams: streams, admission: { basis: card.admission.basis } };
  const unconsumed = nonDefaultParameters(policy).find(item => !SERVING_CARD_CONSUMED[item.parameter]);
  if (unconsumed) refuse("serving_card_parameter_unconsumed", unconsumed.at);
  return policy;
}

export interface LoadedServingCard {
  readonly sha256: string; readonly version: 1; readonly date: string; readonly entry: string;
  readonly identity: Readonly<ServingCardV1["identity"]>; readonly evidence: Readonly<ServingCardV1["evidence"]>;
  readonly policy: Readonly<ServingPolicy>;
  /** The pinned bytes, only for the run directory's copy; nothing parses them. No key repeats, so every value in them was validated. */
  readonly bytes: Buffer;
}

function readPinned(descriptor: ServingCardDescriptor): Buffer {
  try { return pinned(descriptor.path, descriptor.sha256, false, SERVING_CARD_MAX_BYTES); } catch { return refuse("serving_card_pin_drift"); }
}

/**
 * The pinned read (an absolute path, no symlink, a regular file of at most 64 KiB opened without blocking, unchanged during
 * the read, an equal sha256), the parse, then resolveServingCard. Synchronous, no network. Never exposes the path, nor the raw
 * roles, concurrency or admission: only the resolved policy.
 */
export function loadServingCard(descriptor: ServingCardDescriptor, expectation: ServingCardExpectation): LoadedServingCard {
  const bytes = readPinned(descriptor), card = parseServingCard(bytes), policy = resolveServingCard(card, expectation);
  return Object.freeze({ sha256: descriptor.sha256, version: SERVING_CARD_VERSION, date: card.date, entry: card.decision.entry as string,
    identity: deepFreeze(card.identity), evidence: deepFreeze(card.evidence), policy: deepFreeze(policy), bytes: Buffer.from(bytes) });
}

/**
 * 8.2b: `localStreams` is the card's K, which the driver passes to the session in every run with a card: the research loops and the claims
 * judge run K calls at a time on a zero-risk local model, and one at a time otherwise (ASSIST-M2's default: freeze.json, not yet the registry).
 */
export interface ServingCardFreeze { sha256: string; version: 1; date: string; entry: string; localStreams: number }
/** The freeze.json fragment: {} without a card; never the path. */
export function servingCardFreeze(loaded: LoadedServingCard | undefined): { servingCard?: ServingCardFreeze } {
  return loaded ? { servingCard: { sha256: loaded.sha256, version: loaded.version, date: loaded.date, entry: loaded.entry, localStreams: loaded.policy.localStreams } } : {};
}
