/**
 * The purposes of research v5's sealed cloud one-shots (docs/PROJECT_REVIEW_2026-11-05.md §5.2, touchpoints T1 and T2), and
 * the predicates the ledger, the pre-checks, the research producer and the harness share for them (backlog item 10, the
 * assist-purpose exception). The strings are distinct from every local stage purpose, so a local plan or synthesis row is
 * never mistaken for an assist. scripts/registry-row.py mirrors them by hand; a test keeps the two in step.
 */
export const PLAN_ASSIST_PURPOSE = "research plan assist";
export const SYNTHESIS_ASSIST_PURPOSE = "research synthesis assist";
export const ASSIST_PURPOSES: readonly string[] = Object.freeze([PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE]);
/** Whether a receipt (or a request) carries an assist purpose; false for an absent or non-string purpose. */
export function isAssistDispatch(receipt: { purpose?: unknown }): boolean {
  return typeof receipt.purpose === "string" && ASSIST_PURPOSES.includes(receipt.purpose);
}
/** The research stage an assist serves: the plan assist stands in for S3, the synthesis assist for S6. */
export function assistStage(purpose: unknown): "plan" | "synthesise" | undefined {
  return purpose === PLAN_ASSIST_PURPOSE ? "plan" : purpose === SYNTHESIS_ASSIST_PURPOSE ? "synthesise" : undefined;
}
