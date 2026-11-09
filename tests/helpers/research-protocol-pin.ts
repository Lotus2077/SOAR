/**
 * The one pinned value of researchProtocolSha256() at the default budget, which every research test compares against.
 * Tests never hard-code the protocol hash anywhere else: a PR that changes the research protocol re-pins this line and
 * records the old and the new value in its Implemented build-log entry; a PR that must leave the protocol unchanged keeps
 * the tests that compare with it green.
 *
 * Pins so far:
 * - 3453710315d7226ea4d6195ec7401d000f86c5b0d9afa9839a801d5c6d391262: research v4 after the planner contract repair
 *   (BL-20261105-0944), pinned by backlog item 4 (BL-20261107-0923) and unchanged by item 5's exports (BL-20261108-0911) and SC.
 * - f68147d9f9d3f7c829ead9bba026c4f1aa16789f5ac16a3c87435aabdec91262: backlog item 7(b), part 1 (BL-20261109-0334): the
 *   extraction layout, index batches by preview size and the synthesis length cap.
 */
export const RESEARCH_PROTOCOL_SHA256 = "f68147d9f9d3f7c829ead9bba026c4f1aa16789f5ac16a3c87435aabdec91262";
