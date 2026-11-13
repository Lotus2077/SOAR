/** Versioned, model-independent contracts shared by the pipeline and writer presentation. */
/** 5 since backlog item 7(c) (BL-20261113-0817-research-v5-design): slot schedules, host fallbacks, coverage v2. */
export const RESEARCH_PIPELINE_VERSION = 5;
export const RESEARCH_CONTEXT_DIR = "context/research";
export const RESEARCH_FILES = Object.freeze({ index: `${RESEARCH_CONTEXT_DIR}/index.json`, plan: `${RESEARCH_CONTEXT_DIR}/plan.json`,
  evidence: `${RESEARCH_CONTEXT_DIR}/evidence.json`, evidenceText: `${RESEARCH_CONTEXT_DIR}/evidence.md`, argument: `${RESEARCH_CONTEXT_DIR}/argument.md`,
  summary: `${RESEARCH_CONTEXT_DIR}/summary.json`, coverage: `${RESEARCH_CONTEXT_DIR}/coverage.json` });
export interface ResearchBudget { indexCalls: number; extractionCalls: number; plannerCalls: number; synthesisCalls: number }
export const RESEARCH_PIPELINE_BUDGET: Readonly<ResearchBudget> = Object.freeze({ indexCalls: 24, extractionCalls: 40, plannerCalls: 2, synthesisCalls: 2 });
/**
 * 7(c): the assist slots beside the budget's stage attempts. A settled assist reply is one of its stage's calls, so the ready
 * gate's ceilings are the budget plus these: plan calls at most plannerCalls + 1, synthesis calls at most synthesisCalls + 2.
 * The budget and its schemas stay as they are; item 10.b adds these slots to the session's request pool when it wires the hook.
 */
export const RESEARCH_SLOT_POLICY = Object.freeze({ version: 1, plan: Object.freeze({ assist: 1 }), synthesis: Object.freeze({ assist: 1, assistRetryOnTruncation: 1 }),
  assistPosition: "first_under_forced_split_else_after_every_stage_attempt", stageAfterAssist: "fresh_without_repair_context" });
export interface ResearchSourceIdentity { id: string; path: string; sha256: string; bytes: number }
export const RESEARCH_COVERAGE_POLICY = Object.freeze({ version: 1, briefSegmentation: "exact_numbered_spans_or_whole", sourceOrder: "id_utf16_ascending", chunkBytes: 65536,
  overlapBytes: 2048, mandatoryBeforeRepair: true, indexRepairsPerBatch: 1, extractionRepairsPerChunk: 1, readyRequiresAllReadable: true,
  readyRequiresAllChunks: true, readyRequiresNoVerifiedQuoteOmissions: true, readyRequiresNoConflictOmissions: true, packetBytes: 65536, maxQuestions: 12, semanticAcceptance: "independent_review_required" });
export const RESEARCH_PRESENTATION_POLICY = Object.freeze({ version: 1, maxBytes: 196608, policy: "complete_untrusted_packet_once", encoding: "json_string_complete_utf8",
  files: [RESEARCH_FILES.argument, RESEARCH_FILES.evidenceText, RESEARCH_FILES.plan, RESEARCH_FILES.coverage], sourceInstructions: "data_only", oversize: "refuse_without_trimming" });
/**
 * Backlog item 7(a), part 1 (BL-20261109-0447-research-tolerance-design): what a settled reply may lose and still be accepted,
 * and how the synthesis argument's section headings are normalised. Bound into researchProtocolSha256; the diagnostics sink is
 * no part of it. The heading rule is claims.ts's section_present over the lines claims.ts keeps: Python's whitespace class
 * (str.isspace), lines ending at CRLF, CR or LF (universal newlines) with their separators kept, fenced code removed before
 * HTML comments are searched. The pipeline builds its scanner from these values, so the policy is the definition.
 */
export const RESEARCH_TOLERANCE_POLICY = Object.freeze({ version: 1,
  extraction: Object.freeze({ incompleteWhen: Object.freeze(["truncated", "invalid_json", "schema_invalid", "question_set_mismatch", "needs_followup"]),
    contributes: "complete_attempt_only",
    quoteDrops: Object.freeze(["quote_length", "quote_unencodable", "quote_not_located", "duplicate_question_id", "unknown_question_id"]),
    conflictDrops: Object.freeze(["duplicate_question_id", "unknown_question_id", "note_unencodable"]), unencodableQuoteNote: "cleared",
    /** canonical()'s exactText (contracts.ts): text holding a NUL or a lone surrogate cannot be encoded. */
    unencodable: "exact_text_refuses_nul_or_lone_surrogate",
    questionOutcome: "from_verified_quotes_except_needs_followup",
    /** BL-20261110-0726 (owner question 3's corner): a first attempt that lost every quote of a question it marked evidence_found. */
    allQuotesOfAFoundQuestionDropped: "first_attempt_held_repaired_after_other_repairs_while_budget_lasts_else_kept" }),
  /** 7(c): a model-written index field canonical() cannot encode makes its row schema-invalid (literal card or repair). */
  index: Object.freeze({ unencodableField: "row_schema_invalid" }),
  synthesis: Object.freeze({ rejectWhen: Object.freeze(["argument_unencodable"]) }),
  synthesisHeadings: Object.freeze({ titles: Object.freeze(["Conflicting evidence", "Unanswered questions"]), target: "## {title}",
    /** claims.ts reads a Markdown report with Path.read_text (universal newlines), so CRLF, CR and LF all end a line; separators are kept. */
    lineBreaks: "universal_newlines", separators: "kept",
    whitespace: "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000", leadingStrip: "#*_", trailingStrip: "*_:", strip: "linear_scan", compare: "to_lower_case_equality",
    fenceOpen: "^[ \\t]*```", fenceClose: "^[ \\t]*```[ \\t]*$", commentOpen: "<!--", commentClose: "-->", order: "fences_then_comments",
    lineTouchedBySpan: "unchanged", exactHeading: "^## {title}\\s*$", exactHeadingFlags: "mu",
    setextBlockedBy: "^[ \\t]*(?:#|[*+-][ \\t])", setextUnderline: "^ {0,3}(?:=+|-+)[ \\t]*$" }) });
