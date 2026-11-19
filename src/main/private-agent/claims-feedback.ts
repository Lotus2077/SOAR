import { CLAIMS_MAX, CLAIMS_QUOTE_MAX_CHARS, CLAIMS_QUOTE_MIN_CHARS, CLAIMS_SENTENCE_MAX_CHARS, REQUIRED_REPORT_SECTIONS } from "./claims";

/**
 * What the host's claims-ledger check found, in the form the model and the run's records receive it when the check fails at finish, at
 * a bounded run's final validation, or in the check a twelve-call writer gets when output/claims.json first appears: claim ids, the
 * check's codes and its fixed limits. Never a sentence, a quote, a source window or a locator, so it carries no task or source text.
 */
export interface ClaimsLedgerFeedback {
  /** The check's own verdict (its exit status where the host ran it). */
  passed: boolean;
  /** The check's output was not its JSON object, so nothing more is known. */
  resultUnreadable?: true;
  /** A failure that stopped the check before it finished: the ledger or the report as a whole, or one entry. */
  stoppedBy?: string;
  /** For claim_id, claim_sentence and claim_quote: the 1-based position in the ledger of the entry the check stopped at. */
  stoppedAtEntry?: number;
  /** Claims whose quote the check could not verify, by id and code. */
  failedClaims?: { id: string; code: string }[];
  /** Report citations with no claim of that id in the ledger. */
  citedWithoutClaim?: string[];
  /** Ledger claims the report never cites. */
  claimsNotCited?: string[];
  /** Required report sections the check did not find. */
  missingSections?: string[];
  /** The fixed meaning of each code above. */
  codes?: Record<string, string>;
}

/** The check's codes, each with the rule it enforces (claims.ts, claimsLedgerCheck). */
export const CLAIMS_LEDGER_CODE_TEXT: Readonly<Record<string, string>> = Object.freeze({
  invalid_path: "A path the check reads is not a plain relative path inside the workspace.",
  invalid_file: "A file the check reads (the ledger, the report or a source) is missing, linked or unreadable.",
  ledger_size_limit: "The ledger is larger than 262144 bytes.",
  ledger_schema: `The ledger must be {"version":1,"claims":[...]} with 1 to ${CLAIMS_MAX} claims.`,
  ledger_invalid: "The ledger is not valid UTF-8 JSON, or a file the check reads could not be parsed.",
  claim_id: "Each claim needs its own id, C1 to C999.",
  claim_sentence: `Each claim's sentence must be a non-empty string of at most ${CLAIMS_SENTENCE_MAX_CHARS} characters.`,
  claim_quote: `Each claim's quote must be a non-empty string of at most ${CLAIMS_QUOTE_MAX_CHARS} characters.`,
  unknown_source: "The claim's sourceId is not one of the job's sources.",
  source_tampered: "The source's bytes differ from the host's retained copy.",
  quote_too_short: `The claim's quote is shorter than ${CLAIMS_QUOTE_MIN_CHARS} characters.`,
  quote_not_found: "The claim's quote does not occur verbatim in its source.",
});

const CLAIM_ID = /^C[0-9]{1,3}$/u, CODE = /^[a-z_]{1,40}$/u;
/** The check raises these before it records the entry, so the entry is the one after every claim it recorded. */
const STOPPED_AT_ENTRY = new Set(["claim_id", "claim_sentence", "claim_quote"]);
const record = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && CLAIM_ID.test(id)))].slice(0, CLAIMS_MAX) : [];

/** Reads the check's printed JSON object (its last non-empty line) into feedback. `exitedZero` is the host's verdict when it ran the check. */
export function claimsLedgerFeedback(stdout: string, exitedZero?: boolean): ClaimsLedgerFeedback {
  let result: Record<string, unknown> | undefined;
  try { result = record(JSON.parse(stdout.trim().split("\n").at(-1) ?? "")); } catch { result = undefined; }
  if (!result) return { passed: exitedZero === true, resultUnreadable: true };
  const claims = Array.isArray(result.claims) ? result.claims.map(record).filter(claim => claim !== undefined) : [];
  const stoppedBy = typeof result.code === "string" && CODE.test(result.code) ? result.code : undefined;
  const failedClaims = claims.filter(claim => claim.found === false && typeof claim.id === "string" && CLAIM_ID.test(claim.id) && typeof claim.code === "string" && CODE.test(claim.code))
    .map(claim => ({ id: claim.id as string, code: claim.code as string })).slice(0, CLAIMS_MAX);
  const report = record(result.report), citations = record(report?.citations), sections = record(report?.sections);
  const citedWithoutClaim = ids(citations?.unknown), claimsNotCited = ids(citations?.missing);
  const missingSections = REQUIRED_REPORT_SECTIONS.filter(title => sections !== undefined && sections[title] === false);
  const codes = Object.fromEntries([...new Set([...(stoppedBy ? [stoppedBy] : []), ...failedClaims.map(claim => claim.code)])]
    .filter(code => Object.hasOwn(CLAIMS_LEDGER_CODE_TEXT, code)).map(code => [code, CLAIMS_LEDGER_CODE_TEXT[code]!]));
  return { passed: exitedZero ?? result.passed === true,
    ...(stoppedBy ? { stoppedBy } : {}), ...(stoppedBy && STOPPED_AT_ENTRY.has(stoppedBy) ? { stoppedAtEntry: claims.length + 1 } : {}),
    ...(failedClaims.length ? { failedClaims } : {}), ...(citedWithoutClaim.length ? { citedWithoutClaim } : {}),
    ...(claimsNotCited.length ? { claimsNotCited } : {}), ...(missingSections.length ? { missingSections } : {}),
    ...(Object.keys(codes).length ? { codes } : {}) };
}
