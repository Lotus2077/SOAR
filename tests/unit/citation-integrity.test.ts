import { describe, expect, it } from "vitest";

import {
  formatCitationIntegrityError,
  normalizeAnswerCitations,
} from "../../src/main/agent/citation-integrity";
import type {
  CanonicalMessage,
  CanonicalToolCall,
} from "../../src/shared/session-reducer";

function toolCall(
  name: string,
  arguments_: Record<string, unknown>,
  output: Record<string, unknown>,
  status: CanonicalToolCall["status"] = "completed",
): CanonicalToolCall {
  return {
    id: `${name}-test`,
    name,
    arguments: arguments_ as CanonicalToolCall["arguments"],
    status,
    content: JSON.stringify(output),
  };
}

function messages(...toolCalls: CanonicalToolCall[]): CanonicalMessage[] {
  return [
    {
      id: "evidence",
      role: "assistant",
      content: "",
      status: "completed",
      toolCalls,
    },
  ];
}

describe("final-answer citation integrity", () => {
  it("leaves exact evidenced citations and all surrounding text unchanged", () => {
    const content = "See **`src/main/run.ts:7`**, then continue.";
    const result = normalizeAnswerCitations(
      content,
      messages(
        toolCall("search_text", { query: "run" }, {
          ok: true,
          matches: [{ path: "src/main/run.ts", lineNumber: 7, text: "run();" }],
        }),
      ),
    );

    expect(result).toEqual({ content, corrections: [], unresolved: [] });
  });

  it("canonicalizes only uniquely resolvable path suffixes and records correction pairs", () => {
    const content =
      "Bridge: `preload/index.ts:14`; short name: `index.ts:24`; exact: `src/preload/index.ts:14`.";
    const result = normalizeAnswerCitations(
      content,
      messages(
        toolCall("search_text", { query: "cancelSession" }, {
          ok: true,
          matches: [
            { path: "src/preload/index.ts", lineNumber: 14, text: "first" },
            { path: "src/preload/index.ts", lineNumber: 24, text: "second" },
          ],
        }),
      ),
    );

    expect(result.content).toBe(
      "Bridge: `src/preload/index.ts:14`; short name: `src/preload/index.ts:24`; exact: `src/preload/index.ts:14`.",
    );
    expect(result.corrections).toEqual([
      { from: "preload/index.ts:14", to: "src/preload/index.ts:14" },
      { from: "index.ts:24", to: "src/preload/index.ts:24" },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it("fails closed when a suffix matches more than one evidenced workspace path", () => {
    const result = normalizeAnswerCitations(
      "See `index.ts:4`.",
      messages(
        toolCall("list_files", {}, {
          ok: true,
          entries: [
            { path: "src/a/index.ts", type: "file" },
            { path: "src/b/index.ts", type: "file" },
          ],
        }),
        toolCall("search_text", { query: "needle" }, {
          ok: true,
          matches: [{ path: "src/a/index.ts", lineNumber: 4, text: "needle" }],
        }),
      ),
    );

    expect(result.content).toBe("See `index.ts:4`.");
    expect(result.corrections).toEqual([]);
    expect(result.unresolved).toEqual([
      {
        citation: "index.ts:4",
        reason: "ambiguous_path_suffix",
        candidates: ["src/a/index.ts", "src/b/index.ts"],
      },
    ]);
  });

  it("rejects unknown paths and lines that the successful tool evidence cannot support", () => {
    const result = normalizeAnswerCitations(
      "Valid suffix: `read.ts:2`; out of range: `src/read.ts:3`; invented: `missing/file.ts:9`.",
      messages(
        toolCall("read_text_file", { relativePath: "src/read.ts" }, {
          ok: true,
          text: "one\ntwo\n",
          truncated: false,
        }),
      ),
    );

    expect(result.content).toBe(
      "Valid suffix: `read.ts:2`; out of range: `src/read.ts:3`; invented: `missing/file.ts:9`.",
    );
    expect(result.corrections).toEqual([]);
    expect(result.unresolved).toEqual([
      {
        citation: "src/read.ts:3",
        reason: "line_not_in_evidence",
        candidates: ["src/read.ts"],
      },
      {
        citation: "missing/file.ts:9",
        reason: "path_not_in_evidence",
      },
    ]);
    expect(formatCitationIntegrityError(result.unresolved)).toContain(
      '"src/read.ts:3" has no matching line in tool evidence',
    );
  });

  it("ignores failed or malformed tool output instead of treating it as evidence", () => {
    const failed = toolCall(
      "search_text",
      { query: "needle" },
      {
        ok: true,
        matches: [{ path: "src/fake.ts", lineNumber: 1, text: "needle" }],
      },
      "failed",
    );
    const malformed = toolCall("search_text", { query: "needle" }, { ok: false });
    malformed.content = "not-json";

    const result = normalizeAnswerCitations(
      "`src/fake.ts:1` and `src/other.ts:2`",
      messages(failed, malformed),
    );

    expect(result.corrections).toEqual([]);
    expect(result.unresolved.map((entry) => entry.reason)).toEqual([
      "path_not_in_evidence",
      "path_not_in_evidence",
    ]);
  });

  it("does not interpret web URLs or clock times as repository citations", () => {
    const content = "See https://example.com/file.ts:443 at 12:30.";
    expect(normalizeAnswerCitations(content, [])).toEqual({
      content,
      corrections: [],
      unresolved: [],
    });
  });
});
