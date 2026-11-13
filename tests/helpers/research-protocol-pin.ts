/**
 * The one pinned value of researchProtocolSha256() at the default budget, which every research test compares against.
 * Tests never hard-code the protocol hash anywhere else: a PR that changes the research protocol re-pins this line and
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
 */
export const RESEARCH_PROTOCOL_SHA256 = "505c385abb05484ecb147c07b12c05893e08733f5a818b567c7b28659f3d4b92";
