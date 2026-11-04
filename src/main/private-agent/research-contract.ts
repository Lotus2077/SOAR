/** Versioned, model-independent contracts shared by the pipeline and writer presentation. */
export const RESEARCH_PIPELINE_VERSION = 4;
export const RESEARCH_CONTEXT_DIR = "context/research";
export const RESEARCH_FILES = Object.freeze({ index: `${RESEARCH_CONTEXT_DIR}/index.json`, plan: `${RESEARCH_CONTEXT_DIR}/plan.json`,
  evidence: `${RESEARCH_CONTEXT_DIR}/evidence.json`, evidenceText: `${RESEARCH_CONTEXT_DIR}/evidence.md`, argument: `${RESEARCH_CONTEXT_DIR}/argument.md`,
  summary: `${RESEARCH_CONTEXT_DIR}/summary.json`, coverage: `${RESEARCH_CONTEXT_DIR}/coverage.json` });
export interface ResearchBudget { indexCalls: number; extractionCalls: number; plannerCalls: number; synthesisCalls: number }
export const RESEARCH_PIPELINE_BUDGET: Readonly<ResearchBudget> = Object.freeze({ indexCalls: 24, extractionCalls: 40, plannerCalls: 2, synthesisCalls: 2 });
export interface ResearchSourceIdentity { id: string; path: string; sha256: string; bytes: number }
export const RESEARCH_COVERAGE_POLICY = Object.freeze({ version: 1, briefSegmentation: "exact_numbered_spans_or_whole", sourceOrder: "id_utf16_ascending", chunkBytes: 65536,
  overlapBytes: 2048, mandatoryBeforeRepair: true, indexRepairsPerBatch: 1, extractionRepairsPerChunk: 1, readyRequiresAllReadable: true,
  readyRequiresAllChunks: true, readyRequiresNoVerifiedQuoteOmissions: true, readyRequiresNoConflictOmissions: true, packetBytes: 65536, maxQuestions: 12, semanticAcceptance: "independent_review_required" });
export const RESEARCH_PRESENTATION_POLICY = Object.freeze({ version: 1, maxBytes: 196608, policy: "complete_untrusted_packet_once", encoding: "json_string_complete_utf8",
  files: [RESEARCH_FILES.argument, RESEARCH_FILES.evidenceText, RESEARCH_FILES.plan, RESEARCH_FILES.coverage], sourceInstructions: "data_only", oversize: "refuse_without_trimming" });
