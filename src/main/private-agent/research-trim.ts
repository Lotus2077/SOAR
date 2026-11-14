/**
 * Item 7b.2 (BL-20261114-1304-research-priority-trim-design; review finding D4 and section 5.2, principle 5): which verified
 * quotes and conflict notes the packet keeps, and the presentation guard before synthesis. Host steps only, with no model call.
 * Everything the packet leaves out is disclosed in coverage.json and accepted by the ready gate (research-coverage.ts). Bound into
 * researchProtocolSha256 through RESEARCH_TRIM_POLICY. This module imports nothing, so the pipeline and the tests share it.
 */
export const RESEARCH_TRIM_POLICY = Object.freeze({ version: 1,
  /** The order 10.a's T2 packet already uses (research-assist.ts, buildSynthesisAssistPacket). */
  order: "round_robin_over_plan_questions_each_in_given_order_shared_item_once_then_rest_in_given_order",
  quotes: Object.freeze({ given: "evidence_id", packet: "longest_prefix_whose_evidence_md_fits_packet_bytes", rendered: "evidence_id",
    omission: "sourceId_locator_quoteSha256_chunkIds_questionIds", reasons: Object.freeze(["packet_cap", "presentation_cap"]) }),
  conflicts: Object.freeze({ given: "noted", packet: "longest_prefix_within_packet_conflicts_and_bytes", rendered: "noted", chosen: "before_quotes" }),
  outcomes: "kept_quote_evidence_retained_else_omitted_quote_evidence_trimmed_needs_followup_kept",
  presentation: Object.freeze({ checked: "before_synthesis_when_every_chunk_is_complete", argumentReserveBytesPerWord: 8,
    argumentStandIn: "larger_of_host_skeleton_and_reserve", synthesisSection: "every_packet_id_per_question_disposition_unresolved_status_skeleton",
    shrink: "binary_search_on_prefix_length_from_one", noFit: "research_presentation_too_large_before_synthesis",
    reply: "rejected_presentation_too_large_when_its_presentation_exceeds_max_bytes" }) });

/**
 * The trim's priority over items that name plan questions: round-robin over the questions in plan order, each question's items in
 * their given order; an item several questions name is placed once, at its first turn; an item no question names comes last, in
 * given order. Returns indexes into `items`. A packet is then a prefix of this order, so no question loses its first item to
 * another question's second.
 */
export function researchTrimOrder(questionIds: readonly string[], items: readonly { readonly questionIds: readonly string[] }[]): number[] {
  const byQuestion = questionIds.map(id => items.flatMap((item, index) => item.questionIds.includes(id) ? [index] : []));
  const order: number[] = [], taken = new Set<number>();
  for (let round = 0; byQuestion.some(list => list.length > round); round++) for (const list of byQuestion) {
    const index = list[round];
    if (index !== undefined && !taken.has(index)) { taken.add(index); order.push(index); }
  }
  items.forEach((_, index) => { if (!taken.has(index)) order.push(index); });
  return order;
}

/**
 * The largest n in [low, high] for which `fits(n)` holds, by binary search, or undefined when `fits(low)` fails. It is exact when
 * `fits` holds for every n up to some bound and for none above; otherwise it still returns an n that fits.
 */
export function researchLargestFitting(low: number, high: number, fits: (value: number) => boolean): number | undefined {
  if (low > high || !fits(low)) return undefined;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (fits(middle)) low = middle; else high = middle - 1; }
  return low;
}
