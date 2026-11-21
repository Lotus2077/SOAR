import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DESKTOP_REVIEW_ARM, DESKTOP_REVIEW_OUTPUT_NAME, DESKTOP_REVIEW_ROUTE, DESKTOP_REVIEW_TRANSPORT, desktopReviewAvailability, isDesktopReviewRecord,
  reviewInputsCheck } from "../../src/main/general-tasks/review-route";
import { GeneralTaskCreateInputSchema } from "../../src/shared/general-task-contracts";

const root = resolve(__dirname, "..", "..");

describe("desktop document review route (backlog item 13b, part 1)", () => {
  it("records the route and the owner's transport waiver and nothing else, and names the summary and the arm E6's rows give review-1", () => {
    expect([DESKTOP_REVIEW_ROUTE, DESKTOP_REVIEW_TRANSPORT]).toEqual(["local_beta", "owner_waived"]);
    expect(isDesktopReviewRecord({ route: "local_beta", transport: "owner_waived" })).toBe(true);
    for (const value of [undefined, null, "local_beta", {}, { route: "local_beta" }, { route: "cloud", transport: "owner_waived" }, { route: "local_beta", transport: "tls" },
      { route: "local_beta", transport: "owner_waived", extra: 1 }, { route: "local_beta", transport: "owner_waived", cardSha256: "a".repeat(64) }]) {
      expect(isDesktopReviewRecord(value), JSON.stringify(value)).toBe(false);
    }
    // The summary E6 graded, as its grading brief lists the six deliverables; the arm E6's six review-1 rows carry.
    expect(DESKTOP_REVIEW_OUTPUT_NAME).toBe("review-summary.md");
    expect(readFileSync(resolve(root, "docs/experiments/e6-grading-brief.md"), "utf8")).toContain("`output/review-summary.md`");
    // Pinned by id, so a later --supersedes row (a correction appended beside the original) cannot change what is checked.
    const rows = readFileSync(resolve(root, "docs/experiments/registry.jsonl"), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as { id?: string; batch?: string; arm?: string });
    const ids = ["pd1-maintenance-contract", "pd2-expenses-policy", "pd3-programme-report"].flatMap(task => ["r1", "r2"].map(repeat => `e6-${task}-review1-${repeat}`));
    for (const id of ids) expect(rows.find(row => row.id === id), id).toMatchObject({ batch: "e6-20261119", arm: DESKTOP_REVIEW_ARM });
  });

  it("reviews exactly one .docx among a task's input files", () => {
    const file = (path: string) => ({ path });
    expect(reviewInputsCheck([file("input/01-contract.docx")])).toBe("fit");
    expect(reviewInputsCheck([file("input/01-notes.md"), file("input/02-Contract.DOCX")])).toBe("fit");
    for (const files of [[], [file("input/01-notes.md")], [file("input/01-a.docx"), file("input/02-b.docx")], [file("input/01-a.doc")]]) {
      expect(reviewInputsCheck(files), JSON.stringify(files)).toBe("review_input_invalid");
    }
  });

  it("is offered only while its flag is on, says where the document goes and over what, by the owner's waiver, and promises no privacy protection", () => {
    const http = { vllm: { baseUrl: "http://192.0.2.10:8000/v1" } }, https = { vllm: { baseUrl: "https://models.example.test/v1" } };
    expect(desktopReviewAvailability(http)).toBeUndefined();
    expect(desktopReviewAvailability({ ...http, documentReviewBeta: false })).toBeUndefined();
    const plain = desktopReviewAvailability({ ...http, documentReviewBeta: true })!;
    expect(plain).toEqual({ available: true, reason: expect.stringContaining("sends the .docx, with any other file you add, in full, to your own model endpoint over plain HTTP, and to nothing else: no cloud and no consultation") });
    expect(plain.reason).toContain("by your waiver of PLAN.md's Tier O safeguards for this review, so SOAR gives it no privacy protection");
    expect(desktopReviewAvailability({ ...https, documentReviewBeta: true })!.reason).toContain("over HTTPS, and to nothing else");
    for (const reason of [plain.reason, desktopReviewAvailability({ ...https, documentReviewBeta: true })!.reason]) {
      expect(reason).not.toMatch(/\b(secure|encrypted|protected|safe|private)\b/iu);
    }
  });

  it("takes no public-or-synthetic declaration on a review, still requires it on every other task, and refuses research beside a review", () => {
    const base = { goal: "Review the contract.", outputName: "review-summary.md" };
    expect(GeneralTaskCreateInputSchema.safeParse({ ...base, review: "local_beta" }).success).toBe(true);
    expect(GeneralTaskCreateInputSchema.safeParse({ ...base, review: "local_beta", publicOrSynthetic: true }).success).toBe(false);
    expect(GeneralTaskCreateInputSchema.safeParse({ ...base, publicOrSynthetic: true }).success).toBe(true);
    expect(GeneralTaskCreateInputSchema.safeParse(base).success).toBe(false);
    expect(GeneralTaskCreateInputSchema.safeParse({ ...base, review: "local_beta", research: "local_beta" }).success).toBe(false);
    expect(GeneralTaskCreateInputSchema.safeParse({ ...base, review: "cloud" }).success).toBe(false);
    // The renderer still reads the object's own fields.
    expect(GeneralTaskCreateInputSchema.shape.outputName.safeParse("review-summary.md").success).toBe(true);
  });
});
