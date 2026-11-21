import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DESKTOP_REVIEW_ARM, DESKTOP_REVIEW_DELIVERABLES, DESKTOP_REVIEW_OUTPUT_NAME, DESKTOP_REVIEW_ROUTE, DESKTOP_REVIEW_TRANSPORT, desktopReviewAvailability,
  isDesktopReviewRecord, reviewInputsCheck } from "../../src/main/general-tasks/review-route";
import { DOCUMENT_REVIEW_ARTIFACTS, DOCUMENT_REVIEW_EDITS_PATH } from "../../src/main/private-agent/document-review";
import { DOCUMENT_REVIEW_FLAGS_PATH } from "../../src/main/private-agent/document-review-flags";
import { GENERAL_TASK_REVIEW_DELIVERABLES, GENERAL_TASK_REVIEW_EDITS_PATH, GENERAL_TASK_REVIEW_OUTPUT_NAME, GeneralTaskArtifactRefSchema,
  GeneralTaskChooseInputsOptionsSchema, GeneralTaskCreateInputSchema } from "../../src/shared/general-task-contracts";

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
    expect(plain).toEqual({ available: true, reason: expect.stringContaining("sends the .docx, with any other file you add, in full, to your own model endpoint at 192.0.2.10:8000 over plain HTTP, and to nothing else: no cloud and no consultation") });
    expect(plain.reason).toContain("by your waiver of PLAN.md's Tier O safeguards for this review, so SOAR gives it no privacy protection");
    expect(desktopReviewAvailability({ ...https, documentReviewBeta: true })!.reason).toContain("to your own model endpoint at models.example.test over HTTPS, and to nothing else");
    // Part 3: the endpoint is named by its host and port alone, never its path or any user name or key in the address.
    const keyed = new URL("http://192.0.2.10:8000/v1/"); keyed.username = "owner"; keyed.password = "k".repeat(12);
    const named = desktopReviewAvailability({ vllm: { baseUrl: keyed.href }, documentReviewBeta: true })!.reason;
    expect(named).toContain("at 192.0.2.10:8000 over plain HTTP"); expect(named).not.toContain("/v1"); expect(named).not.toContain("owner"); expect(named).not.toContain("k".repeat(12));
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

describe("desktop document review exports (backlog item 13b, part 2)", () => {
  it("exports exactly the six deliverables E6 graded, as its grading brief and the blind-bundle tool list them, and never the host flags file", () => {
    expect([...DESKTOP_REVIEW_DELIVERABLES]).toEqual(["output/review-summary.md", "review/edits.json", "output/redline.docx", "output/clean.docx", "output/issues.xlsx",
      "output/hygiene.json"]);
    expect(DESKTOP_REVIEW_DELIVERABLES).not.toContain(DOCUMENT_REVIEW_FLAGS_PATH);
    expect(Object.isFrozen(DESKTOP_REVIEW_DELIVERABLES)).toBe(true);
    // The grading brief's sentence on what goes in a blind bundle, read in its own order.
    const brief = readFileSync(resolve(root, "docs/experiments/e6-grading-brief.md"), "utf8");
    const start = brief.indexOf("Six deliverables:"), end = brief.indexOf("Never `output/review-flags.json`", start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    expect([...brief.slice(start, end).matchAll(/`([^`]+)`/gu)].map(match => match[1])).toEqual([...DESKTOP_REVIEW_DELIVERABLES]);
    // The blind-bundle tool adds the review's five files to the task's required summary, and leaves the flags file out.
    const tool = readFileSync(resolve(root, "scripts/phase2-blind.py"), "utf8");
    const tuple = /^DOCUMENT_REVIEW_ARTIFACTS = \(([^)]*)\)$/mu.exec(tool);
    expect(tuple).not.toBeNull();
    expect(["output/review-summary.md", ...[...tuple![1]!.matchAll(/"([^"]+)"/gu)].map(match => match[1])]).toEqual([...DESKTOP_REVIEW_DELIVERABLES]);
  });

  it("admits the review's edit plan, and no other path outside output/, to an artifact reference", () => {
    expect(GENERAL_TASK_REVIEW_EDITS_PATH).toBe(DOCUMENT_REVIEW_EDITS_PATH);
    const ref = (path: string) => GeneralTaskArtifactRefSchema.safeParse({ id: randomUUID(), path, sha256: "a".repeat(64) }).success;
    for (const path of ["review/edits.json", "output/review-summary.md", "output/review-flags.json"]) expect(ref(path), path).toBe(true);
    for (const path of ["review/other.json", "review/edits.json/x", "review/edits.json.bak", "review/", "review", "Review/edits.json", "review/EDITS.json",
      "review/../output/a.md", "./review/edits.json", "/review/edits.json", "review/edits.json ", "work/review/edits.json", "input/01-contract.docx"]) {
      expect(ref(path), path).toBe(false);
    }
  });
});

describe("desktop document review in the view (backlog item 13b, part 3)", () => {
  it("lists for the view the same six deliverables the exports take, which are the summary and the driver's own outputs less the flags file", () => {
    expect(GENERAL_TASK_REVIEW_OUTPUT_NAME).toBe(DESKTOP_REVIEW_OUTPUT_NAME);
    expect(GENERAL_TASK_REVIEW_DELIVERABLES.map(item => item.path)).toEqual([...DESKTOP_REVIEW_DELIVERABLES]);
    // Pinned to the driver: a change to what the review phase requires fails here before it changes what a review exports.
    expect([...DESKTOP_REVIEW_DELIVERABLES]).toEqual([`output/${DESKTOP_REVIEW_OUTPUT_NAME}`,
      ...DOCUMENT_REVIEW_ARTIFACTS.map(artifact => artifact.path).filter(path => path !== DOCUMENT_REVIEW_FLAGS_PATH)]);
    expect(Object.isFrozen(GENERAL_TASK_REVIEW_DELIVERABLES)).toBe(true);
    expect(GENERAL_TASK_REVIEW_DELIVERABLES.every(item => Object.isFrozen(item))).toBe(true);
    const labels = GENERAL_TASK_REVIEW_DELIVERABLES.map(item => item.label);
    expect(new Set(labels).size).toBe(6);
    for (const label of labels) { expect(label.length).toBeGreaterThan(0); expect(label).not.toMatch(/\b(secure|encrypted|protected|safe|private)\b/iu); }
  });

  it("gives the file picker one option, a review, and nothing else", () => {
    expect(GeneralTaskChooseInputsOptionsSchema.safeParse({ review: true }).success).toBe(true);
    for (const value of [undefined, {}, { review: false }, { review: "true" }, { review: true, paths: ["/a"] }, { paths: ["/a"] }, "review", true, null]) {
      expect(GeneralTaskChooseInputsOptionsSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });
});

