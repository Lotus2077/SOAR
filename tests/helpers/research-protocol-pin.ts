/**
 * The pinned values of researchProtocolSha256() at the default budget: the default, which every research test compares against,
 * and, at the end of this file, the four an assist's firing binds, with and without a card's admission policy.
 * Tests never hard-code the protocol hash anywhere else: a PR that changes the research protocol re-pins these lines and
 * records the old and the new value in its Implemented build-log entry; a PR that must leave the protocol unchanged keeps
 * the tests that compare with it green.
 *
 * Pins so far:
 * - 3453710315d7226ea4d6195ec7401d000f86c5b0d9afa9839a801d5c6d391262: research v4 after the planner contract repair
 *   (BL-20261105-0944), pinned by backlog item 4 (BL-20261107-0923) and unchanged by item 5's exports (BL-20261108-0911) and SC.
 * - 01ca01a41c13410012bc386fa85bb32bdfbfaa3ec402482f8d29b8edfcaa6107: backlog item 7(b), part 1 (BL-20261109-0334, implemented in
 *   BL-20261109-0442): the extraction layout, index batches by preview size and the synthesis length cap.
 * - f03119bfd0c7d37adf12155453f9530d1281ae9ead60019b97e9b95e2ca0f413: backlog item 7(a), part 1 (BL-20261109-0447, implemented in BL-20261109-0552): per-quote drop, host-derived
 *   outcomes, complete attempts only, unencodable text refused and heading normalisation.
 * - d4ec0c3a1bafedbe154ddf2e4d612508fdb68ee80c3c41ad97729e6bc112cf34: the correction to 7(b), part 1 (BL-20261110-0625), as first committed;
 *   superseded by the next pin before any run.
 * - 925433f9ba8e9c531b51150b769b6bec382331b6d0824d37d151d1f9fdfbea88: its follow-up (BL-20261110-0709): the word-limit
 *   parser reads a part named by a heading or a parenthesis, and more part nouns, as a part's limit, reads no limit when its guards
 *   drop the largest one, and against 7b.1 only ever drops a limit.
 * - 679e623f02795ec66f06349af4bde5ff8db83fd1d5054465c1da492d6847d3f5: backlog item 7(a), part 1, merged onto the 7(b) corrections
 *   (re-pinned in BL-20261110-0712-correction-research-tolerance-repin): the same 7a.1 code on the corrected word-limit parser.
 * - 396a15f3aca0c7b758fe4b052ee744911f0a5943dd805d518a70d9b6799ac2aa: 7(a), part 1, with owner question 3's corner settled (BL-20261110-0726): a first attempt that
 *   dropped every quote of a found question is held and its chunk repaired while the budget lasts.
 * - 9066d7de5d1c52e1cb0616a4b68ea157638749810ac5fabbd8863db6a288c6d3: the delta review's rules A (comma chains) and B (the sentence before)
 *   (BL-20261110-0848): a part named there marks a part's limit too.
 * - 05f342b25f3483574cca4f1bad53468219e63e94578927c069a8c831289e93a8: 7(a), part 1, merged onto rules A and B (re-pinned in BL-20261110-0900): the same 7a.1 code on the
 *   parser of BL-20261110-0848.
 * - 505c385abb05484ecb147c07b12c05893e08733f5a818b567c7b28659f3d4b92: backlog item 7(c), research v5 (BL-20261113-0927-research-v5-design;
 *   BL-20261113-0928-research-v5-implemented recorded 35a622eecf83... on #76's bd876d9), the same value on #76's 2fe1ec8 and on main
 *   after merge train 1: assist slots, host fallbacks, coverage v2, the presentation check, and encodable index fields and plans.
 * - 7100b7a2584b8afaea9ea8b79a31d676204448a1a203a4d9ef7206cda3c24aa5: item 7b.2 (BL-20261115-1939-research-priority-trim-design): the priority trim with
 *   disclosed omissions the ready gate accepts, coverage v3, the presentation guard, and the synthesis and writer instructions on trimmed evidence.
 * - e3e08871227d0b467f27d02344443f15c72386c479d41a2553bda88c59838c4c: item (ii) (BL-20261117-1143-research-second-repair-design): coverage v4, whose
 *   chunks may hold a third attempt (a second repair, sent only under a card's admission rates). It moves the default for every run.
 * - a46bfb55d2f841f1dbf426f2c8be6a03fa5cf27d9e61b1e6421ef85c83d73de0: the owner's answer of 2026-11-18 (#166): coverage v5 and its optional
 *   `gaps`, the one chunk a ready packet may hold whose last reply, after every repair, declared questions unresolved; the coverage
 *   policy that says so; and the writer's sentence on gaps. It moves the default for every run.
 * - 4bb74c03239942d786ec9100d65b462ffe8378629c8ab3cd2eff32e26dd31636: the synthesis evidence-id tolerance (the E0 card's Amendment 7
 *   addendum): tolerance policy version 2, coverage v6 and its optional `synthesis.corrections` (dropped ids by reason, and
 *   downgrades), and the writer's sentence on corrections. It moves the default for every run.
 */
export const RESEARCH_PROTOCOL_SHA256 = "4bb74c03239942d786ec9100d65b462ffe8378629c8ab3cd2eff32e26dd31636";
/**
 * 10.b's second review: a run whose reading stage has an assist hook, by firing (`researchProtocolSha256(budget, undefined, false,
 * firing)`), and one that also runs under a card's admission rates (`..., true, firing`). They move with the default, and with the
 * assist protocol block or the admission policy; pinned on 10.b's merge with 7b.3 and item (ii)
 * (BL-20261117-1216-correction-assist-wiring-card-admission-merge).
 * The synthesis evidence-id tolerance moved all four with the default.
 */
export const RESEARCH_PROTOCOL_SHA256_ASSIST = Object.freeze({ forced_split: "15f1e00fd054ac3c4a4deb79989cc2af5f53ca7d4c2bf763f09ee55cfbd75252",
  local_first: "c020b75e06dd1fe4571857a30b0ddc9946bb788b7886f821b02968b22dfea3bd" });
export const RESEARCH_PROTOCOL_SHA256_ADMISSION_ASSIST = Object.freeze({ forced_split: "ac059d632984cc1cf2bbaa85cebfcf2b77f72531c9a2df202fe4680237376769",
  local_first: "a2685a5994da3409da747eac64bbf0107b7d6a80cf78e708f74cede7c116a536" });
