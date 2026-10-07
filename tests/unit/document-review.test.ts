import { execFileSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { digest } from "../../src/main/private-agent/contracts";
import { DOCUMENT_REVIEW_APPLIER_PATH, DOCUMENT_REVIEW_APPLIER_SHA256, DOCUMENT_REVIEW_ARTIFACTS, DOCUMENT_REVIEW_CHECK_ID, DOCUMENT_REVIEW_EDITS_PATH,
  documentReviewApplierFile, documentReviewCheck, documentReviewInstructions, withDocumentReview } from "../../src/main/private-agent/document-review";
import { checkCommand } from "../../src/main/private-agent/runner";
import { PRIVATE_SANDBOX_LIMITS } from "../../src/main/private-agent/sandbox";
import type { SessionPhase } from "../../src/main/private-agent/session";

const phase = (files: string[]): SessionPhase => ({ files: files.map(path => ({ path, bytes: Buffer.from(`bytes of ${path}`) })), checks: [{ id: "base_check", python: "pass" }],
  contract: { version: 1, goal: "Review the agreement.", requiredArtifacts: [{ path: "output/summary.md", description: "Summary" }], requiredChecks: ["base_check"],
    maxModelCalls: 10, maxToolCalls: 10, maxElapsedMs: 60_000 } });

describe("document review (PR-I)", () => {
  it("adds the pinned applier, the plan and outputs, the instructions and the fidelity check for the one source document", () => {
    const reviewed = withDocumentReview(phase(["input/agreement.docx", "input/notes.txt"]));
    expect(reviewed.files.map(file => file.path)).toEqual(["input/agreement.docx", "input/notes.txt", DOCUMENT_REVIEW_APPLIER_PATH]);
    expect(digest(reviewed.files.at(-1)!.bytes)).toBe(DOCUMENT_REVIEW_APPLIER_SHA256);
    expect(reviewed.contract.requiredArtifacts.map(artifact => artifact.path)).toEqual(["output/summary.md", ...DOCUMENT_REVIEW_ARTIFACTS.map(artifact => artifact.path)]);
    expect(reviewed.contract.requiredChecks).toEqual(["base_check", DOCUMENT_REVIEW_CHECK_ID]);
    expect(reviewed.contract.goal).toContain(`python3 -I ${DOCUMENT_REVIEW_APPLIER_PATH} 'input/agreement.docx' ${DOCUMENT_REVIEW_EDITS_PATH} output`);
    const python = reviewed.checks.at(-1)!.python;
    const params = JSON.parse(Buffer.from(python.match(/json\.loads\(base64\.b64decode\("([A-Za-z0-9+/=]+)"\)\)/u)![1]!, "base64").toString("utf8"));
    expect(params).toEqual({ source: "input/agreement.docx", sourceSha256: digest(Buffer.from("bytes of input/agreement.docx")), applierSha256: DOCUMENT_REVIEW_APPLIER_SHA256 });
    // The applier rides in the check once, compressed, and is exactly the workspace copy.
    const embedded = inflateSync(Buffer.from(python.match(/zlib\.decompress\(base64\.b64decode\("([A-Za-z0-9+/=]+)"\)\)/u)![1]!, "base64"));
    expect(digest(embedded)).toBe(DOCUMENT_REVIEW_APPLIER_SHA256); expect(python).not.toContain("__");
  });
  it("refuses a phase without exactly one source document, a nested or foreign source path, or a reserved path already in use", () => {
    expect(() => withDocumentReview(phase(["input/notes.txt"]))).toThrow("document_review_source_invalid");
    expect(() => withDocumentReview(phase(["input/a.docx", "input/b.docx"]))).toThrow("document_review_source_invalid");
    expect(() => withDocumentReview(phase(["input/a.docx", DOCUMENT_REVIEW_APPLIER_PATH]))).toThrow("document_review_path_taken");
    expect(() => withDocumentReview(phase(["input/a.docx", "output/redline.docx"]))).toThrow("document_review_path_taken");
    // Any second .docx under input/, nested or not, makes the source ambiguous; a nested one alone is not a source.
    expect(() => withDocumentReview(phase(["input/agreement.docx", "input/exhibits/schedule.docx"]))).toThrow("document_review_source_invalid");
    expect(() => withDocumentReview(phase(["input/exhibits/schedule.docx"]))).toThrow("document_review_source_invalid");
    expect(withDocumentReview(phase(["input/MSA.DOCX"])).contract.requiredChecks).toContain(DOCUMENT_REVIEW_CHECK_ID);
    // The added artifacts and goal text must fit the job contract, refused before any caller writes state.
    const crowded = phase(["input/a.docx"]);
    crowded.contract.requiredArtifacts = Array.from({ length: 26 }, (_, i) => ({ path: `output/a${i}.md`, description: "x" }));
    expect(() => withDocumentReview(crowded)).toThrow("document_review_contract_limits");
    for (const sourcePath of ["input/../a.docx", "input/sub/a.docx", "output/a.docx", "input/a.doc", "input/a\nb.docx"]) {
      expect(() => documentReviewCheck({ sourcePath, sourceSha256: "a".repeat(64) })).toThrow("document_review_source_invalid");
    }
    expect(() => documentReviewCheck({ sourcePath: "input/a.docx", sourceSha256: "nothex" })).toThrow("document_review_source_invalid");
  });
  it("ships Python that parses, and an applier that matches its published hash", () => {
    const parse = (source: string) => execFileSync("python3", ["-I", "-c", "import ast, sys; ast.parse(sys.stdin.read())"], { input: source });
    expect(() => parse(documentReviewApplierFile().bytes.toString("utf8"))).not.toThrow();
    expect(() => parse(documentReviewCheck({ sourcePath: "input/a.docx", sourceSha256: "a".repeat(64) }).python)).not.toThrow();
    expect(documentReviewInstructions("input/a.docx")).toContain(`--list 'input/a.docx'`);
    // File names reach the shell quoted.
    expect(documentReviewInstructions("input/Smith & Co's MSA.docx")).toContain(`--list 'input/Smith & Co'\\''s MSA.docx'`);
  });
  it("keeps the whole check command well under the sandbox's command cap, even for the longest source path", () => {
    const longest = `input/${"x".repeat(195)}.docx`;
    const bytes = Buffer.byteLength(checkCommand(documentReviewCheck({ sourcePath: longest, sourceSha256: "a".repeat(64) })));
    expect(bytes).toBeLessThan(PRIVATE_SANDBOX_LIMITS.commandBytes - 24 * 1024);
  });
});
