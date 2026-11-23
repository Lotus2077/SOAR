import { describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { INDEXED_SUBMISSION_REVIEW, submissionReviewPacket, submissionReviewProtocol } from "../../src/main/private-agent/submission-review";

describe("indexed source-review verdict parsing", () => {
  const html = "<p>Confirm capacity.</p>", source = "Capacity requires confirmation.", sourcePath = "input/source.txt";
  const packet = submissionReviewPacket(INDEXED_SUBMISSION_REVIEW, "Summarize capacity.", [{ path: sourcePath, bytes: Buffer.from(source) }], Buffer.from(html));
  const evidence = { html, sourcePath, source };

  it("retries duplicate fields before a later value can approve the export", () => {
    for (const args of [
      '{"artifactId":"H1","sourceId":"S1","issues":["Repair the promise."],"issues":[]}',
      '{"artifactId":"H1","sourceId":"S1","issues":["Repair the promise."],"\\u0069ssues":[]}',
      '{"artifactId":"unissued","artifactId":"H1","sourceId":"S1","issues":[]}',
    ]) expect(packet.verdict(args)).toEqual({ retry: "invalid_arguments" });
  });

  it("retries repair text that the host cannot serialize to the writer", () => {
    for (const issue of ["Check\u0000authority", "Check\ud800authority", "Check\udc00authority"]) {
      const args = JSON.stringify({ artifactId: "H1", sourceId: "S1", issues: [issue] });
      expect(packet.verdict(args)).toEqual({ retry: "invalid_arguments" });
    }
  });

  it("preserves the pinned packet, tool schema, protocol and valid approval and repair results", () => {
    const protocol = submissionReviewProtocol(INDEXED_SUBMISSION_REVIEW);
    expect(digest(canonical({ messages: packet.messages, tool: packet.tool, protocol }))).toBe("cc0ea675cd3937770c4dbfd2ee65056186591f785bd2e175c03e304693c8afa9");
    expect(packet.verdict(' { "issues": [], "sourceId":"S1", "\\u0061rtifactId":"H1" }\n')).toEqual({ verdict: { issues: [], evidence } });
    const issues = ['Show the literal "issues": [] as quoted text.', "Verify capacity 🧪.\nRetain the source wording."];
    expect(packet.verdict(JSON.stringify({ artifactId: "H1", sourceId: "S1", issues, comparison: "A supporting note." })))
      .toEqual({ verdict: { issues, evidence } });
  });
});
