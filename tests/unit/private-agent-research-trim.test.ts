import { describe, expect, it } from "vitest";
import { RESEARCH_TRIM_POLICY, researchLargestFitting, researchTrimOrder } from "../../src/main/private-agent/research-trim";

const items = (...questionIds: string[][]) => questionIds.map(ids => ({ questionIds: ids }));

describe("item 7b.2: the trim's priority and prefix search (BL-20261114-1304-research-priority-trim-design)", () => {
  it("goes round-robin over the questions in plan order, each in given order, and places a shared item once at its first turn", () => {
    // Q1 names 0, 1 and 3; Q2 names 2, 3 and 4. Round 0: 0, 2. Round 1: 1, 3. Round 2: Q1's 3 is placed already; Q2's 4.
    expect(researchTrimOrder(["Q1", "Q2"], items(["Q1"], ["Q1"], ["Q2"], ["Q1", "Q2"], ["Q2"]))).toEqual([0, 2, 1, 3, 4]);
    // A question's turn in a round is its item of that rank, even when that item came in through another question.
    expect(researchTrimOrder(["Q1", "Q2"], items(["Q1", "Q2"], ["Q2"], ["Q1"]))).toEqual([0, 2, 1]);
    // Plan order, not item order, sets the turns.
    expect(researchTrimOrder(["Q2", "Q1"], items(["Q1"], ["Q2"]))).toEqual([1, 0]);
  });
  it("puts an item no plan question names last, in given order, and returns every index once", () => {
    expect(researchTrimOrder(["Q1"], items(["Q9"], ["Q1"], ["Q8"]))).toEqual([1, 0, 2]);
    expect(researchTrimOrder(["Q1"], [])).toEqual([]);
    const many = items(...Array.from({ length: 50 }, (_, i) => [`Q${(i % 3) + 1}`, ...(i % 7 ? [] : ["Q2"])]));
    expect([...researchTrimOrder(["Q1", "Q2", "Q3"], many)].sort((a, b) => a - b)).toEqual(many.map((_, i) => i));
  });
  it("finds the largest fitting prefix when the predicate holds up to a bound, and refuses when nothing fits", () => {
    for (const bound of [0, 1, 7, 99, 100]) expect(researchLargestFitting(0, 100, n => n <= bound)).toBe(bound);
    expect(researchLargestFitting(1, 100, () => false)).toBeUndefined();
    expect(researchLargestFitting(1, 0, () => true)).toBeUndefined();
    // A predicate that is not monotone still yields a value that fits.
    const fits = (n: number) => n % 2 === 1 || n === 2; const found = researchLargestFitting(1, 10, fits);
    expect(found).toBeDefined(); expect(fits(found!)).toBe(true);
  });
  it("records the policy the protocol binds: the order, both caps' reasons and the guard's reservation", () => {
    expect(RESEARCH_TRIM_POLICY).toMatchObject({ version: 1, quotes: { reasons: ["packet_cap", "presentation_cap"] }, presentation: { argumentReserveBytesPerWord: 8 } });
    expect(Object.isFrozen(RESEARCH_TRIM_POLICY) && Object.isFrozen(RESEARCH_TRIM_POLICY.presentation)).toBe(true);
  });
});
