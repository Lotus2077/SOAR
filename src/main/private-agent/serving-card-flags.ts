/**
 * The serving card's consumed flags (SC). A leaf module that imports research-roles.ts only. The reader refuses every
 * value that differs from today's default with `serving_card_parameter_unconsumed` while that value's flag is false, so a
 * card can never set a value no merged code reads. No production code path overrides a flag; tests flip them only by
 * mocking this module.
 */
import { ROLE_PARAMETERS } from "./research-roles";

export const SERVING_CARD_PARAMETERS = [...ROLE_PARAMETERS, "localStreams", "admission"] as const;
export type ServingCardParameter = (typeof SERVING_CARD_PARAMETERS)[number];
/**
 * Flipped to true only by the consumer PR that makes the value reach a request or a decision, in that PR, with a test of the
 * value applied: item 7(a)'s caps-and-thinking PR (maxOutputTokens, thinking), item 9 (structuredOutput), item 8's loop PR
 * (localStreams) and item 7(b)'s admission PR (admission). 7a.2 (BL-20261114-1346-research-role-policy-design) flipped the caps
 * and thinking: the research pipeline sends them to each local role's attempts. Item 9 (BL-20261114-1650-research-structured-output-design)
 * flipped structured output: a local plan, extract or synthesis call whose effective thinking mode a flag names sends `response_format`.
 */
export const SERVING_CARD_CONSUMED: Readonly<Record<ServingCardParameter, boolean>> =
  Object.freeze({ maxOutputTokens: true, thinking: true, structuredOutput: true, localStreams: false, admission: false });
