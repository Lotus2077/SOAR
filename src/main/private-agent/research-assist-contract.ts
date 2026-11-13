/**
 * The hook between the research pipeline and backlog item 10's assist wrapper (docs/PROJECT_REVIEW_2026-11-05.md §5.2,
 * touchpoints T1 and T2; BL-20261113-0920-assist-wrapper-design, decision 11). Types only: no runtime value lives here, so
 * the pipeline (item 7(c)) and the wrapper (research-assist.ts) both import it without a runtime import cycle.
 *
 * A request is host data inside the process, real source ids, paths, texts and hashes included. Only the wrapper turns a
 * request into a cloud packet, and it sends none of those: it carries the authored brief, opaque source ids and the
 * allowlisted fields of the touchpoint table.
 */
import type { BriefUnit, ResearchCoverage, ResearchEvidence, ResearchPlan } from "./research-coverage";
import type { ResearchSourceIdentity } from "./research-contract";
import type { ResearchIndexEntry } from "./research-index";
import type { ResearchPlanAttempt } from "./research-plan";

/** Local-first fires an assist only on a deterministic host signal; the forced split fires it in place of the local stage. */
export type ResearchAssistFiring = "local_first" | "forced_split";
export type ResearchAssistTouchpoint = "T1" | "T2";
/** The four counters a research stage sums: the same shape as research-pipeline.ts's ResearchUsage. */
export interface ResearchAssistUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
/** The index document the pipeline writes to index.json and gives the local planner. */
export interface ResearchAssistIndexDocument { readonly version: 2; readonly sources: readonly ResearchIndexEntry[] }

interface ResearchAssistRequestBase {
  /** The composed goal the pipeline runs on. The wrapper sends only the authored brief it was configured with, a prefix of this. */
  readonly brief: string;
  readonly units: readonly BriefUnit[];
  /** The source inventory in its own order (coverage.sources), which is the order of the opaque ids S1, S2, ... */
  readonly sources: readonly ResearchSourceIdentity[];
  /**
   * Each source's whole text, in the same order (research-coverage.ts researchSourceText): the audit's reference for copied
   * source text. `undefined` for a source with no readable text (a PDF, a .docx or a binary file), as researchSourceText answers.
   */
  readonly sourceTexts: readonly (string | undefined)[];
  readonly sourceIndex: ResearchAssistIndexDocument;
  /**
   * The session's wall deadline in `performance.now()` milliseconds (finding A8): a priced call the deadline could cut is not
   * started. Required: an assist without one stops (`assist_deadline_missing`). A test without a session passes Infinity.
   */
  readonly deadlineMs: number;
}
/** T1, the plan assist (S3c). */
export interface ResearchAssistPlanRequest extends ResearchAssistRequestBase {
  readonly mandatorySourceChunks: number;
  readonly extractionCallBudget: number;
  /** The stage's earlier plan attempts (local-first): the wrapper sends their safe codes and schema paths, never a hash or a reply. */
  readonly priorAttempts: readonly ResearchPlanAttempt[];
}
/** T2, the synthesis assist (S6c), or its one retry after a truncated reply. */
export interface ResearchAssistSynthesisRequest extends ResearchAssistRequestBase {
  /** The host-validated plan, a T1 plan included (review §5.1, rule 6). */
  readonly plan: ResearchPlan;
  readonly evidence: ResearchEvidence;
  readonly coverage: ResearchCoverage;
  /** True only for T2's one retry, after a first T2 reply that settled truncated. */
  readonly retryAfterTruncation: boolean;
}

/** settled: a reply; skipped: the row stayed unknown; failed: a confirmed failure after dispatch; refused: no dispatch; stopped: the stage ends. */
export type ResearchAssistAttemptOutcome = "settled" | "skipped" | "failed" | "refused" | "stopped";
export interface ResearchAssistAttemptUsage extends ResearchAssistUsage { thinkingTokens?: number }
/** What the packet held, as counts only: never a matched string, a name or an offset. */
export interface ResearchAssistPacketRecord {
  briefBytes: number; units: number; sources: number; priorAttempts?: number;
  gistsTrimmed?: number; gistMaxChars?: number;
  quotesInPacket?: number; quotesTrimmed?: number; conflictsInPacket?: number; evidenceBytes?: number;
  /** Each packet field's serialized bytes, so the unique bytes disclosed across T1, T2 and the retry can be counted (review §5.1 rule 2). */
  fieldBytes?: Partial<Record<"authoritativeSchema" | "brief" | "units" | "sources" | "budget" | "priorAttempts" | "plan" | "evidenceText" | "coverage" | "repairReason", number>>;
  /**
   * Replacements made before serialization: source identities by field (brief, units, gists, plan, quotes); then, in any
   * field, host file names and file paths (`files`), URLs (`urls`) and digests (`digests`).
   */
  substitutions: { brief: number; units: number; gists: number; plan: number; quotes: number; digests: number; urls: number; files: number };
  auditFinding?: "source_identity" | "digest" | "url_or_path" | "literal_text";
}
/** One assist call as the wrapper saw it; 10.b sums these into the stage summary's assist record. */
export interface ResearchAssistAttemptRecord {
  version: 1; touchpoint: ResearchAssistTouchpoint; ordinal: 1 | 2; retryAfterTruncation: boolean;
  outcome: ResearchAssistAttemptOutcome;
  /** The fixed code of any outcome but `settled`. */
  code?: string;
  /** Whether the call committed a ledger row (one call may commit up to three: the Anthropic retries); the ledger holds the rows. */
  dispatched: boolean;
  /** The exact request body's bytes, when a body was built. */
  requestBytes?: number;
  /** The fee the call reserved for that body (model.ts `reservationMicrousd`), when a body was built. */
  reservedFeeMicrousd?: number;
  /**
   * Settled only. Thinking tokens appear where the provider reports them (the Anthropic shape). `cacheWriteReported` is true
   * only when the reply itself carried the provider's write count: without it, `cacheWriteTokens` 0 proves nothing.
   */
  usage?: ResearchAssistAttemptUsage & { cacheWriteReported: boolean };
  finish?: "stop" | "length" | "content_filter" | "other";
  /** The settled row's fee. */
  feeMicrousd?: number;
  packet?: ResearchAssistPacketRecord;
}

export type ResearchAssistOutcome =
  /**
   * A settled reply, which the pipeline validates like a stage reply and counts as one of the stage's calls. A plan reply
   * names sources by opaque id: `sourceAliases` maps each id the packet used to the real source id, and the pipeline must
   * assess it with `assessResearchPlanReply({ ..., sourceAliases })`. A synthesis reply may cite only `evidenceIds`, the
   * evidence ids its packet carried: the pipeline must refuse any other citation.
   */
  | { kind: "reply"; content: string; usage: ResearchAssistUsage; truncated: boolean; sourceAliases?: Readonly<Record<string, string>>; evidenceIds?: readonly string[]; record?: ResearchAssistAttemptRecord }
  /** No reply: the stage continues as the firing policy says (the local stage, then the host fallback). */
  | { kind: "no_reply"; outcome: "skipped" | "failed" | "refused"; code: string; record?: ResearchAssistAttemptRecord }
  /** The stage ends: a cancel, a configuration error or an unexpected failure. */
  | { kind: "stop"; code: string; record?: ResearchAssistAttemptRecord };

export interface ResearchAssists {
  readonly firing: ResearchAssistFiring;
  plan?(request: ResearchAssistPlanRequest, signal: AbortSignal): Promise<ResearchAssistOutcome>;
  synthesis?(request: ResearchAssistSynthesisRequest, signal: AbortSignal): Promise<ResearchAssistOutcome>;
}
