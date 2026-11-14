/**
 * E0 judge fixture (review section 5.6, E0: the local judge runs "on a fixed claim set labelled by a separate session" against
 * an agreement level the E0 card sets beforehand; criteria 3 and 8 become thresholds only if it reaches that level). It sends
 * today's entailment judgement (claims.ts: ENTAILMENT_SYSTEM_PROMPT through entailmentMessages, thinking off,
 * ENTAILMENT_OUTPUT_TOKENS) in model.ts's non-streaming form for every claim of a claim set that a committed hashes-only
 * manifest pins, POSTs each request directly to the owner's endpoint (outside the broker, by design: public or synthetic
 * claims at zero fee, no dispatch rows), parses each reply exactly as judgeClaims does, retains every raw reply under a new
 * out directory with mode 0o600, and scores the verdicts against the labeller's labels (a cloud model through its API, as
 * the owner decided for E0; the protocol says what it may receive). The labels never reach a
 * request. The endpoint and its reply contract come from loadConfig, so the app's endpoint policy applies, the activation
 * cell is the J1 condition of that contract, and the address is never printed.
 *
 *   pnpm fixture:judge -- harvest --runs <runDir>[,<runDir>...] --task <name> --out .soar/experiments/e0-judge/claims.json
 *   pnpm fixture:judge -- --claims <claims.json> --labels <labels.json> [--manifest docs/experiments/e0-judge-fixture-v1.json]
 *     [--out <dir>] [--cache-salt] [--dry-run]
 *
 * The labelling protocol is docs/experiments/E0_JUDGE_LABELLING_PROTOCOL.md. The conditions, repeats, per-class minimum and
 * agreement level come only from the manifest, which the E0 card pins before the fixture runs. The code refuses a template, an
 * unpinned or mismatched input and a design without the activation cell before any request, and records the manifest's
 * digest, so that the manifest was committed before the run stays checkable; the commit itself is procedural.
 */
import Database from "better-sqlite3";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadConfig, loadEnvironmentFiles } from "../src/main/config";
import { ClaimsVerifiedClaimSchema, ENTAILMENT_OUTPUT_TOKENS, ENTAILMENT_PROMPT_VERSION, ENTAILMENT_SYSTEM_PROMPT, ENTAILMENT_VERDICTS, EntailmentReplySchema,
  entailmentMessages, type EntailmentVerdict } from "../src/main/private-agent/claims";
import { canonical, digest, sha256Schema } from "../src/main/private-agent/contracts";
import { vllmCacheSalt } from "../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../src/main/private-agent/profiles";

export const JUDGE_CONDITIONS = ["j1-legacy", "j1-flash", "j1-legacy-reversed", "j1-flash-reversed"] as const;
export type JudgeCondition = (typeof JUDGE_CONDITIONS)[number];
export const FIXTURE_JOB_ID = "e0-judge-fixture";
export const LABELLING_PROTOCOL = "e0-judge-labelling-v1";
/** The prompt version the reversed-order derivation was written for; another version refuses the reversed conditions. */
export const REVERSAL_PROMPT_VERSION = 1;
/** One judgement is short (one JSON verdict and one sentence); this is the standard profile's request timeout. */
export const JUDGE_REQUEST_TIMEOUT_MS = COORDINATOR_PROFILES.standard.requestTimeoutMs;

const claimId = z.string().regex(/^C[0-9]{1,3}$/u), count = z.number().int().nonnegative();
/**
 * A claim as the pass receives it (ClaimsVerifiedClaimSchema's bounds) with a non-empty context, and nothing else: no provenance,
 * which the harvest writes to a sidecar the labeller does not receive, since a run's id leads to its own judge verdicts.
 */
export const FixtureClaimSchema = z.object({ id: claimId, sentence: z.string(), quote: z.string(), context: z.string().min(1) }).strict()
  .refine(claim => ClaimsVerifiedClaimSchema.safeParse({ id: claim.id, sentence: claim.sentence, quote: claim.quote, context: claim.context }).success,
    "outside the bounds the entailment pass accepts");
export type FixtureClaim = z.infer<typeof FixtureClaimSchema>;
const unique = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length;
export const ClaimsFileSchema = z.object({ version: z.literal(1), task: z.string().min(1).max(200), claims: z.array(FixtureClaimSchema).min(1).max(999) }).strict()
  .refine(file => unique(file.claims), "claim ids must be unique");
export const LabelsFileSchema = z.object({ version: z.literal(1), protocol: z.literal(LABELLING_PROTOCOL), labeller: z.string().min(1).max(200),
  labels: z.array(z.object({ id: claimId, label: z.enum(ENTAILMENT_VERDICTS), planted: z.boolean(), note: z.string().max(400).optional() }).strict()).min(1).max(999) }).strict()
  .refine(file => unique(file.labels), "label ids must be unique");
export type LabelsFile = z.infer<typeof LabelsFileSchema>;
const LabelCountsSchema = z.object({ supported: count, partial: count, unsupported: count, contradicted: count }).strict();

export const JudgeFixtureManifestSchema = z.object({
  schemaVersion: z.literal(1), name: z.string().min(1), status: z.enum(["template", "pinned"]), note: z.string().optional(),
  task: z.string().min(1), exposure: z.enum(["exposed", "fresh"]), promptVersion: z.number().int().positive(),
  claimsSha256: sha256Schema.nullable(), labelsSha256: sha256Schema.nullable(), claimCount: z.number().int().positive().nullable(),
  labelCounts: LabelCountsSchema.nullable(), plantedCount: count.nullable(), minimumPerClass: z.number().int().min(1).max(200),
  /** The E0 card's activation test: exact four-way agreement, or agreement on established (supported or partial) versus not. */
  agreement: z.object({ measure: z.enum(["exact", "established"]), level: z.number().min(0).max(1) }).strict().nullable(),
  conditions: z.array(z.enum(JUDGE_CONDITIONS)).min(1), repeats: z.number().int().min(1).max(10),
}).strict();
export type JudgeFixtureManifest = z.infer<typeof JudgeFixtureManifestSchema>;

export interface JudgeFixtureInputs { claims: Buffer; labels: Buffer; manifest: unknown }
export interface VerifiedJudgeFixture { manifest: JudgeFixtureManifest; claims: FixtureClaim[]; labels: Map<string, { label: EntailmentVerdict; planted: boolean }>;
  claimsSha256: string; labelsSha256: string; labelCounts: Record<EntailmentVerdict, number>; plantedCount: number }

const decode = (bytes: Buffer) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
/** Every refusal here happens before any request is built or sent. */
export function verifyJudgeFixtureInputs(inputs: JudgeFixtureInputs): VerifiedJudgeFixture {
  const manifest = JudgeFixtureManifestSchema.parse(inputs.manifest);
  if (manifest.status === "template" || manifest.claimsSha256 === null || manifest.labelsSha256 === null || manifest.claimCount === null ||
      manifest.labelCounts === null || manifest.plantedCount === null || manifest.agreement === null) throw new Error("judge_fixture_manifest_template");
  if (manifest.promptVersion !== ENTAILMENT_PROMPT_VERSION) throw new Error("judge_fixture_prompt_version_mismatch");
  const claimsSha256 = digest(inputs.claims), labelsSha256 = digest(inputs.labels);
  if (claimsSha256 !== manifest.claimsSha256) throw new Error("judge_fixture_claims_mismatch");
  if (labelsSha256 !== manifest.labelsSha256) throw new Error("judge_fixture_labels_mismatch");
  let claimsFile: z.infer<typeof ClaimsFileSchema>, labelsFile: LabelsFile;
  try { claimsFile = ClaimsFileSchema.parse(decode(inputs.claims)); } catch { throw new Error("judge_fixture_claims_invalid"); }
  try { labelsFile = LabelsFileSchema.parse(decode(inputs.labels)); } catch { throw new Error("judge_fixture_labels_invalid"); }
  if (claimsFile.task !== manifest.task) throw new Error("judge_fixture_task_mismatch");
  const labels = new Map(labelsFile.labels.map(item => [item.id, { label: item.label, planted: item.planted }]));
  if (labels.size !== claimsFile.claims.length || claimsFile.claims.some(claim => !labels.has(claim.id))) throw new Error("judge_fixture_labels_incomplete");
  const labelCounts = { supported: 0, partial: 0, unsupported: 0, contradicted: 0 };
  for (const item of labels.values()) labelCounts[item.label]++;
  const plantedCount = labelsFile.labels.filter(item => item.planted).length;
  if (claimsFile.claims.length !== manifest.claimCount || plantedCount !== manifest.plantedCount || canonical(labelCounts) !== canonical(manifest.labelCounts)) throw new Error("judge_fixture_counts_mismatch");
  if (Object.values(labelCounts).some(value => value < manifest.minimumPerClass)) throw new Error("judge_fixture_class_below_minimum");
  if (manifest.conditions.some(condition => condition.endsWith("-reversed"))) reversedSystemPrompt();
  return { manifest, claims: claimsFile.claims, labels, claimsSha256, labelsSha256, labelCounts, plantedCount };
}

const DEFINITION = /(supported|partial|unsupported|contradicted): [^.]*\./gu;
/**
 * ENTAILMENT_SYSTEM_PROMPT with its verdicts in reverse order, in the JSON alternatives and in the four definitions; every other
 * byte is unchanged. It measures option-order sensitivity only and is never the judge SOAR runs.
 */
export function reversedSystemPrompt(): string {
  const forward = `"${ENTAILMENT_VERDICTS.join('"|"')}"`, definitions = [...ENTAILMENT_SYSTEM_PROMPT.matchAll(DEFINITION)];
  if (ENTAILMENT_PROMPT_VERSION !== REVERSAL_PROMPT_VERSION || ENTAILMENT_SYSTEM_PROMPT.split(forward).length !== 2 || definitions.length !== ENTAILMENT_VERDICTS.length ||
      definitions.some((match, index) => match[1] !== ENTAILMENT_VERDICTS[index])) throw new Error("judge_fixture_reversal_unsupported");
  const first = definitions[0]!.index!, last = definitions.at(-1)!, end = last.index! + last[0].length;
  const block = ENTAILMENT_SYSTEM_PROMPT.slice(first, end), reordered = definitions.map(match => match[0]).reverse().join(" ");
  if (block !== definitions.map(match => match[0]).join(" ")) throw new Error("judge_fixture_reversal_unsupported");
  return `${ENTAILMENT_SYSTEM_PROMPT.slice(0, first)}${reordered}${ENTAILMENT_SYSTEM_PROMPT.slice(end)}`
    .replace(forward, `"${[...ENTAILMENT_VERDICTS].reverse().join('"|"')}"`);
}

/** The pass's own messages for the claim; a reversed condition swaps only the system prompt. */
export function buildJudgeMessages(condition: JudgeCondition, claim: FixtureClaim): { role: "system" | "user"; content: string }[] {
  const messages = entailmentMessages({ id: claim.id, sentence: claim.sentence, quote: claim.quote, context: claim.context }) as { role: "system" | "user"; content: string }[];
  return condition.endsWith("-reversed") ? [{ role: "system", content: reversedSystemPrompt() }, messages[1]!] : messages;
}

/**
 * The vLLM body model.ts sends for the owned destination with the pass's overrides (thinking off, ENTAILMENT_OUTPUT_TOKENS, no
 * tools), in its non-streaming form. The driver's judge streams by default and salts per job; that changes the transport and
 * the prefix-cache key, not the prompt. `cacheSalt` is the fixture's own salt (vllmCacheSalt of FIXTURE_JOB_ID).
 */
export function buildJudgeBody(condition: JudgeCondition, model: string, messages: readonly { role: string; content: string }[], options: { cacheSalt?: string } = {}): string {
  const flash = condition.startsWith("j1-flash");
  return canonical({ model, messages, stream: false, max_tokens: ENTAILMENT_OUTPUT_TOKENS,
    chat_template_kwargs: flash ? { enable_thinking: false, preserve_thinking: false } : { enable_thinking: false },
    ...(options.cacheSalt ? { cache_salt: options.cacheSalt } : {}) });
}

export type JudgeVerdict = EntailmentVerdict | "not_judged";
/** judgeClaims's own reply parse: the outermost braces, EntailmentReplySchema; anything else is not judged. */
export function parseJudgeReply(content: string): JudgeVerdict {
  try {
    const text = String(content).trim(), json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return EntailmentReplySchema.parse(JSON.parse(json)).verdict;
  } catch { return "not_judged"; }
}

const round = (value: number | null) => value === null || !Number.isFinite(value) ? null : Math.round(value * 10_000) / 10_000;
const ratio = (numerator: number, denominator: number) => denominator > 0 ? round(numerator / denominator) : null;
const established = (verdict: JudgeVerdict) => verdict === "supported" || verdict === "partial";
const ORDINAL: Record<EntailmentVerdict, number> = { supported: 0, partial: 1, unsupported: 2, contradicted: 3 };
export interface ScoredRow { label: EntailmentVerdict; planted: boolean; verdict: JudgeVerdict }
export interface JudgeMetrics {
  claims: number; judged: number; exactAgreement: number | null; establishedAgreement: number | null; judgedExactAgreement: number | null; kappa: number | null;
  /** The unrounded numerators behind the two agreements, so a level is compared exactly. */
  exactCount: number; establishedCount: number;
  establishedRecall: number | null; notEstablishedRecall: number | null; contradictedRecall: number | null;
  /** Planted claims labelled not established that the judge also called not established; planted partials are not in it. */
  plantedNotEstablished: number | null;
  /** Exact agreement on every planted claim, planted partials included. */
  plantedExactAgreement: number | null;
  aurocNotEstablished: number | null; verdictCounts: Record<JudgeVerdict, number>; confusion: Record<EntailmentVerdict, Record<JudgeVerdict, number>>;
}
/**
 * Agreement over every claim (a claim not judged disagrees), agreement on criterion 8's established split, recall per side,
 * Cohen's kappa and AUROC for "not established" over judged claims, the AUROC on the verdict's order supported < partial <
 * unsupported < contradicted, with ties counted half.
 */
export function scoreVerdicts(rows: readonly ScoredRow[]): JudgeMetrics {
  const judged = rows.filter(row => row.verdict !== "not_judged") as (ScoredRow & { verdict: EntailmentVerdict })[];
  const verdictCounts = { supported: 0, partial: 0, unsupported: 0, contradicted: 0, not_judged: 0 };
  const confusion = Object.fromEntries(ENTAILMENT_VERDICTS.map(label => [label, { supported: 0, partial: 0, unsupported: 0, contradicted: 0, not_judged: 0 }])) as JudgeMetrics["confusion"];
  for (const row of rows) { verdictCounts[row.verdict]++; confusion[row.label][row.verdict]++; }
  const exact = judged.filter(row => row.verdict === row.label).length, establishedCount = judged.filter(row => established(row.verdict) === established(row.label)).length;
  const negatives = rows.filter(row => !established(row.label)), positives = rows.filter(row => established(row.label)), planted = rows.filter(row => row.planted);
  const plantedNegatives = planted.filter(row => !established(row.label));
  let kappa: number | null = null;
  if (judged.length) {
    const expected = ENTAILMENT_VERDICTS.reduce((sum, verdict) => sum + (judged.filter(row => row.label === verdict).length / judged.length) * (judged.filter(row => row.verdict === verdict).length / judged.length), 0);
    kappa = expected < 1 ? round((exact / judged.length - expected) / (1 - expected)) : null;
  }
  const scoredPositives = judged.filter(row => !established(row.label)).map(row => ORDINAL[row.verdict]), scoredNegatives = judged.filter(row => established(row.label)).map(row => ORDINAL[row.verdict]);
  let auroc: number | null = null;
  if (scoredPositives.length && scoredNegatives.length) {
    let wins = 0;
    for (const p of scoredPositives) for (const n of scoredNegatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
    auroc = round(wins / (scoredPositives.length * scoredNegatives.length));
  }
  return { claims: rows.length, judged: judged.length, exactAgreement: ratio(exact, rows.length),
    establishedAgreement: ratio(establishedCount, rows.length), judgedExactAgreement: ratio(exact, judged.length), kappa, exactCount: exact, establishedCount,
    establishedRecall: ratio(positives.filter(row => row.verdict !== "not_judged" && established(row.verdict)).length, positives.length),
    notEstablishedRecall: ratio(negatives.filter(row => row.verdict !== "not_judged" && !established(row.verdict)).length, negatives.length),
    contradictedRecall: ratio(rows.filter(row => row.label === "contradicted" && row.verdict === "contradicted").length, rows.filter(row => row.label === "contradicted").length),
    plantedNotEstablished: ratio(plantedNegatives.filter(row => row.verdict !== "not_judged" && !established(row.verdict)).length, plantedNegatives.length),
    plantedExactAgreement: ratio(planted.filter(row => row.verdict === row.label).length, planted.length),
    aurocNotEstablished: auroc, verdictCounts, confusion };
}
/**
 * The card's activation test on the unrounded agreement: agreeing claims over all claims (a claim not judged disagrees), at or
 * above the level. The reported ratios are rounded to four places; this comparison is not.
 */
export function meetsAgreementLevel(metrics: Pick<JudgeMetrics, "claims" | "exactCount" | "establishedCount">, agreement: { measure: "exact" | "established"; level: number }): boolean {
  return metrics.claims > 0 && (agreement.measure === "exact" ? metrics.exactCount : metrics.establishedCount) / metrics.claims >= agreement.level;
}
/** Share of claims judged in both lists whose verdict (or established side) differs; the lists are in the same claim order. */
export function flipRate(a: readonly JudgeVerdict[], b: readonly JudgeVerdict[]): { judgedInBoth: number; verdictFlips: number | null; establishedFlips: number | null } {
  const both = a.map((verdict, index) => [verdict, b[index]!] as const).filter(([x, y]) => x !== "not_judged" && y !== "not_judged");
  return { judgedInBoth: both.length, verdictFlips: ratio(both.filter(([x, y]) => x !== y).length, both.length), establishedFlips: ratio(both.filter(([x, y]) => established(x) !== established(y)).length, both.length) };
}

export interface JudgeCallRecord {
  condition: JudgeCondition; repeat: number; claimId: string; status: number | null; elapsedMs: number; replyFile: string | null; bodySha256: string | null; bodyBytes: number;
  finishReason?: string | null; usage?: unknown; reasoningBytes?: number; transportError?: string;
  verdict: JudgeVerdict; failure?: "request_rejected" | "transport_failed" | "malformed_reply" | "judge_reply_invalid";
}
export interface JudgeFixtureSummary {
  version: 1; startedUtc: string; finishedUtc?: string; model: string; promptVersion: number; promptSha256: string; dryRun: boolean;
  /** The configured reply contract and the J1 condition that is therefore the activation cell. */
  replyContract: "legacy" | "flash_next_v1"; activationCondition: "j1-legacy" | "j1-flash";
  /** `sha256` is digest(canonical(manifest)): compare it with the committed manifest to show the run used the pinned design. */
  manifest: { sha256: string; name: string; task: string; exposure: string; claimsSha256: string; labelsSha256: string; claimCount: number; labelCounts: Record<EntailmentVerdict, number>;
    plantedCount: number; minimumPerClass: number; agreement: { measure: "exact" | "established"; level: number } };
  conditions: JudgeCondition[]; repeats: number;
  requests: Record<string, { requestSetSha256: string; requests: number; maxTokens: number; systemPromptSha256: string }>;
  calls: JudgeCallRecord[];
  /** Per condition, per repeat ("r1", ...). `meetsLevel` applies the manifest's measure and level; the card names the activation cell. */
  metrics: Record<string, Record<string, JudgeMetrics & { meetsLevel: boolean }>>;
  flips: Record<string, Record<string, ReturnType<typeof flipRate>>>;
  /** With more than one repeat: over the claims judged in every repeat, the share with the same verdict in all of them. */
  consistency: Record<string, { judgedInEveryRepeat: number; agreement: number | null } | null>;
}
export interface JudgeEndpoint { baseUrl: string; apiKey?: string; model: string; timeoutMs?: number }
export interface JudgeFixtureRunOptions { endpoint: JudgeEndpoint; inputs: JudgeFixtureInputs; out: string; cacheSalt?: boolean; dryRun?: boolean;
  /** The configured reply contract (SOAR_VLLM_REPLY_CONTRACT); absent is the legacy shape. */
  replyContract?: "flash_next_v1" }

function writePrivate(path: string, data: Buffer | string, flag = "w"): void {
  const handle = openSync(path, flag, 0o600);
  try { writeSync(handle, typeof data === "string" ? Buffer.from(data) : data); } finally { closeSync(handle); }
}

export async function runJudgeFixture(options: JudgeFixtureRunOptions): Promise<JudgeFixtureSummary> {
  const fixture = verifyJudgeFixtureInputs(options.inputs), { manifest } = fixture;
  const conditions = [...new Set(manifest.conditions)], cacheSalt = options.cacheSalt ? vllmCacheSalt(FIXTURE_JOB_ID) : undefined;
  // The activation cell is the body today's judge sends on this endpoint; a design without it could only measure another body.
  const replyContract = options.replyContract ?? "legacy", activationCondition = replyContract === "flash_next_v1" ? "j1-flash" : "j1-legacy";
  if (!conditions.includes(activationCondition)) throw new Error("judge_fixture_activation_condition_missing");
  // A run never replaces an earlier result: the out directory must be new.
  if (!options.dryRun && existsSync(options.out)) throw new Error("judge_fixture_out_exists");
  const bodies = new Map(conditions.map(condition => [condition, fixture.claims.map(claim => buildJudgeBody(condition, options.endpoint.model, buildJudgeMessages(condition, claim), { cacheSalt }))]));
  const summary: JudgeFixtureSummary = { version: 1, startedUtc: new Date().toISOString(), model: options.endpoint.model, promptVersion: ENTAILMENT_PROMPT_VERSION,
    promptSha256: digest(ENTAILMENT_SYSTEM_PROMPT), dryRun: options.dryRun === true, replyContract, activationCondition,
    manifest: { sha256: digest(canonical(options.inputs.manifest)), name: manifest.name, task: manifest.task, exposure: manifest.exposure, claimsSha256: fixture.claimsSha256, labelsSha256: fixture.labelsSha256, claimCount: fixture.claims.length,
      labelCounts: fixture.labelCounts, plantedCount: fixture.plantedCount, minimumPerClass: manifest.minimumPerClass, agreement: manifest.agreement! },
    conditions, repeats: manifest.repeats,
    requests: Object.fromEntries(conditions.map(condition => [condition, { requestSetSha256: digest(canonical(bodies.get(condition)!.map(body => digest(body)))),
      requests: fixture.claims.length * manifest.repeats, maxTokens: ENTAILMENT_OUTPUT_TOKENS,
      systemPromptSha256: digest(condition.endsWith("-reversed") ? reversedSystemPrompt() : ENTAILMENT_SYSTEM_PROMPT) }])),
    calls: [], metrics: {}, flips: {}, consistency: {} };
  if (options.dryRun) return summary;
  const replies = join(options.out, "replies");
  mkdirSync(replies, { recursive: true, mode: 0o700 });
  const headers: Record<string, string> = { "content-type": "application/json", ...(options.endpoint.apiKey ? { authorization: `Bearer ${options.endpoint.apiKey}` } : {}) };
  const timeoutMs = options.endpoint.timeoutMs ?? JUDGE_REQUEST_TIMEOUT_MS;
  for (const condition of conditions) {
    for (let repeat = 1; repeat <= manifest.repeats; repeat++) {
      for (const [index, claim] of fixture.claims.entries()) {
        const started = performance.now();
        const record: JudgeCallRecord = { condition, repeat, claimId: claim.id, status: null, elapsedMs: 0, replyFile: null, bodySha256: null, bodyBytes: 0, verdict: "not_judged", failure: "transport_failed" };
        try {
          const response = await fetch(`${options.endpoint.baseUrl}/chat/completions`, { method: "POST", headers, body: bodies.get(condition)![index], redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
          const bytes = Buffer.from(await response.arrayBuffer());
          record.elapsedMs = Math.round(performance.now() - started); record.status = response.status;
          record.replyFile = `${condition}-r${repeat}-${claim.id}.json`; record.bodySha256 = digest(bytes); record.bodyBytes = bytes.length;
          writePrivate(join(replies, record.replyFile), bytes, "wx");
          if (response.status !== 200) record.failure = "request_rejected";
          else {
            let reply: { choices?: { message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }[]; usage?: unknown } | undefined;
            try { reply = JSON.parse(bytes.toString("utf8")); } catch { reply = undefined; }
            const choice = reply?.choices?.[0], message = choice?.message, content = typeof message?.content === "string" ? message.content : undefined;
            if (content === undefined) record.failure = "malformed_reply";
            else {
              record.finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null; record.usage = reply?.usage ?? null;
              record.reasoningBytes = (["reasoning", "reasoning_content"] as const).reduce((n, field) => n + (typeof message?.[field] === "string" ? Buffer.byteLength(message[field] as string) : 0), 0);
              record.verdict = parseJudgeReply(content);
              if (record.verdict === "not_judged") record.failure = "judge_reply_invalid"; else delete record.failure;
            }
          }
        } catch (error) {
          record.elapsedMs = Math.round(performance.now() - started); record.transportError = error instanceof Error ? error.name : "unknown";
        }
        summary.calls.push(record);
      }
    }
  }
  // One index over the calls, and each (condition, repeat) verdict list built once, in claim order.
  const byCall = new Map(summary.calls.map(call => [`${call.condition}|${call.repeat}|${call.claimId}`, call.verdict]));
  const lists = new Map<string, JudgeVerdict[]>();
  const verdicts = (condition: JudgeCondition, repeat: number) => {
    const key = `${condition}|${repeat}`;
    if (!lists.has(key)) lists.set(key, fixture.claims.map(claim => byCall.get(`${key}|${claim.id}`) ?? "not_judged"));
    return lists.get(key)!;
  };
  const { measure, level } = manifest.agreement!;
  for (const condition of conditions) {
    summary.metrics[condition] = {};
    for (let repeat = 1; repeat <= manifest.repeats; repeat++) {
      const list = verdicts(condition, repeat);
      const scored = scoreVerdicts(fixture.claims.map((claim, index) => ({ ...fixture.labels.get(claim.id)!, verdict: list[index]! })));
      summary.metrics[condition][`r${repeat}`] = { ...scored, meetsLevel: meetsAgreementLevel(scored, { measure, level }) };
    }
    const reversed = `${condition}-reversed` as JudgeCondition;
    if (conditions.includes(reversed)) {
      summary.flips[`${condition}|${reversed}`] = Object.fromEntries(Array.from({ length: manifest.repeats }, (_, i) => [`r${i + 1}`, flipRate(verdicts(condition, i + 1), verdicts(reversed, i + 1))]));
    }
    if (manifest.repeats < 2) { summary.consistency[condition] = null; continue; }
    const perClaim = fixture.claims.map((_, index) => Array.from({ length: manifest.repeats }, (__, i) => verdicts(condition, i + 1)[index]!));
    const judgedEverywhere = perClaim.filter(values => values.every(value => value !== "not_judged"));
    summary.consistency[condition] = { judgedInEveryRepeat: judgedEverywhere.length,
      agreement: ratio(judgedEverywhere.filter(values => new Set(values).size === 1).length, judgedEverywhere.length) };
  }
  summary.finishedUtc = new Date().toISOString();
  writePrivate(join(options.out, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`, "wx");
  return summary;
}

/**
 * Reads each run directory's state.sqlite read-only and takes, per job and context, the last claims_verified event: the claims
 * the host's finish-time check verified with their source windows, exactly what the pass judged (session.ts takes the same
 * event). Claims without a window are skipped (the pass never judges them), as is a stored claim the schema no longer accepts,
 * and repeated (sentence, quote, context) triples are kept once. New ids C1, C2, ...; `origins` maps each new id to the run
 * directory's basename and the original id, for a sidecar the labeller does not receive. Nothing is sent anywhere.
 */
export interface ClaimOrigin { id: string; run: string; claimId: string }
export function harvestClaims(runDirectories: readonly string[], task: string): { file: z.infer<typeof ClaimsFileSchema>; origins: ClaimOrigin[]; skipped: number; duplicates: number; runsWithoutClaims: number } {
  const claims: FixtureClaim[] = [], origins: ClaimOrigin[] = [], seen = new Set<string>();
  let skipped = 0, duplicates = 0, runsWithoutClaims = 0;
  for (const directory of runDirectories) {
    let rows: { job_id: string; value: string }[];
    // A fixed code, never the path: the directory may be a local path the owner would not paste anywhere.
    try {
      const db = new Database(join(directory, "state.sqlite"), { readonly: true, fileMustExist: true });
      try { rows = db.prepare("SELECT job_id, value FROM private_agent_events ORDER BY job_id, sequence").all() as { job_id: string; value: string }[]; } finally { db.close(); }
    } catch { throw new Error("judge_fixture_harvest_unreadable"); }
    const last = new Map<string, unknown[]>();
    for (const row of rows) {
      const event = JSON.parse(row.value) as { type?: unknown; contextId?: unknown; claims?: unknown };
      if (event.type === "claims_verified" && Array.isArray(event.claims)) last.set(`${row.job_id}\u0000${String(event.contextId ?? "")}`, event.claims);
    }
    const found = [...last.values()].flat();
    if (!found.length) runsWithoutClaims++;
    for (const raw of found) {
      const parsed = ClaimsVerifiedClaimSchema.safeParse(raw);
      if (!parsed.success || !parsed.data.context) { skipped++; continue; }
      const key = canonical([parsed.data.sentence, parsed.data.quote, parsed.data.context]);
      if (seen.has(key)) { duplicates++; continue; }
      seen.add(key);
      const id = `C${claims.length + 1}`;
      claims.push({ id, sentence: parsed.data.sentence, quote: parsed.data.quote, context: parsed.data.context });
      origins.push({ id, run: basename(resolve(directory)).slice(0, 200), claimId: parsed.data.id });
    }
  }
  if (claims.length > 999) throw new Error("judge_fixture_harvest_too_many_claims");
  return { file: ClaimsFileSchema.parse({ version: 1, task, claims }), origins, skipped, duplicates, runsWithoutClaims };
}
/** The provenance sidecar beside a claim set: claims.json -> claims.origin.json. */
export function originSidecarPath(claimsPath: string): string { return claimsPath.endsWith(".json") ? `${claimsPath.slice(0, -5)}.origin.json` : `${claimsPath}.origin.json`; }

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
/**
 * The command's own arguments. pnpm 10 passes the `--` of `pnpm fixture:judge -- harvest ...` through to the script (as
 * scripts/serving-card.py notes), so one leading `--` is dropped before the subcommand is read. Flags are found by name, so
 * dropping it changes no invocation that worked before.
 */
export function commandArguments(argv: readonly string[]): string[] { const rest = argv.slice(2); return rest[0] === "--" ? rest.slice(1) : rest; }

async function main(): Promise<number> {
  if (commandArguments(process.argv)[0] === "harvest") {
    const runs = argument("--runs"), task = argument("--task"), out = argument("--out");
    if (!runs || !task || !out) { process.stderr.write("usage: harvest --runs <runDir>[,<runDir>...] --task <name> --out <claims.json>\n"); return 2; }
    const harvested = harvestClaims(runs.split(",").map(item => item.trim()).filter(Boolean), task), sidecar = originSidecarPath(out);
    // "wx": an existing claim set or sidecar is never overwritten, so a labelled set cannot be replaced by a fresh harvest.
    // Failures are fixed codes: the paths are the owner's local paths.
    if (existsSync(out) || existsSync(sidecar)) throw new Error("judge_fixture_claims_exist");
    try {
      mkdirSync(dirname(resolve(out)), { recursive: true, mode: 0o700 });
      writePrivate(out, `${JSON.stringify(harvested.file, null, 1)}\n`, "wx");
      writePrivate(sidecar, `${JSON.stringify({ version: 1, task, origins: harvested.origins }, null, 1)}\n`, "wx");
    } catch { throw new Error("judge_fixture_claims_unwritable"); }
    process.stdout.write(`${JSON.stringify({ claims: harvested.file.claims.length, skipped: harvested.skipped, duplicates: harvested.duplicates,
      runsWithoutClaims: harvested.runsWithoutClaims, sha256: digest(readFileSync(out)) })}\n`);
    return 0;
  }
  const claims = argument("--claims"), labels = argument("--labels"), manifest = argument("--manifest") ?? "docs/experiments/e0-judge-fixture-v1.json";
  if (!claims || !labels) { process.stderr.write("usage: --claims <claims.json> --labels <labels.json> [--manifest <json>] [--out <dir>] [--cache-salt] [--dry-run]\n"); return 2; }
  const environment = loadEnvironmentFiles({});
  if (!environment.SOAR_VLLM_BASE_URL) { process.stderr.write("SOAR_VLLM_BASE_URL is not set (environment or .env.local).\n"); return 2; }
  const config = loadConfig();
  const out = argument("--out") ?? join(".soar", "experiments", `e0-judge-fixture-${new Date().toISOString().replace(/[:.]/gu, "")}`);
  const summary = await runJudgeFixture({ endpoint: { baseUrl: config.vllm.baseUrl, apiKey: config.vllm.apiKey, model: config.vllm.model },
    inputs: { claims: readFileSync(claims), labels: readFileSync(labels), manifest: JSON.parse(readFileSync(manifest, "utf8")) },
    out, cacheSalt: process.argv.includes("--cache-salt"), dryRun: process.argv.includes("--dry-run"),
    ...(config.vllm.localReplyContract ? { replyContract: config.vllm.localReplyContract } : {}) });
  // Aggregates only: no claim text, label or reply; the per-call records stay in the retained summary.json.
  const brief = Object.fromEntries(Object.entries(summary.metrics).map(([condition, repeats]) => [condition, Object.fromEntries(Object.entries(repeats).map(([repeat, m]) =>
    [repeat, { exactAgreement: m.exactAgreement, establishedAgreement: m.establishedAgreement, kappa: m.kappa, notEstablishedRecall: m.notEstablishedRecall,
      contradictedRecall: m.contradictedRecall, aurocNotEstablished: m.aurocNotEstablished, judged: m.judged, meetsLevel: m.meetsLevel }]))]));
  process.stdout.write(`${JSON.stringify({ dryRun: summary.dryRun, manifestSha256: summary.manifest.sha256, replyContract: summary.replyContract,
    activationCondition: summary.activationCondition, conditions: summary.conditions, repeats: summary.repeats, claims: summary.manifest.claimCount,
    agreement: summary.manifest.agreement, requests: summary.requests, metrics: brief, flips: summary.flips, consistency: summary.consistency,
    retained: summary.dryRun ? null : `${basename(out)}/replies` })}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error instanceof Error ? error.message : "judge_fixture_failed"}\n`); process.exitCode = 2; });
}
