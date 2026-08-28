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
  let authenticOutput = output;
  if (output.ok === true && name === "list_files" && Array.isArray(output.entries)) {
    authenticOutput = {
      count: output.entries.length,
      skipped: { ignored: 0, unreadable: 0 },
      truncated: false,
      outputBytes: 1,
      ...output,
    };
  } else if (
    output.ok === true &&
    name === "search_text" &&
    Array.isArray(output.matches)
  ) {
    const matches = output.matches.map((value) => ({
      ...(value as Record<string, unknown>),
      textTruncated:
        (value as Record<string, unknown>).textTruncated ?? false,
    }));
    authenticOutput = {
      count: matches.length,
      filesSearched: 1,
      bytesScanned: 1,
      skipped: {
        binary: 0,
        ignored: 0,
        symlink: 0,
        tooLarge: 0,
        unreadable: 0,
      },
      truncated: false,
      outputBytes: 1,
      ...output,
      matches,
    };
  } else if (
    output.ok === true &&
    name === "read_text_file" &&
    typeof output.text === "string"
  ) {
    authenticOutput = {
      ...output,
      bytes: new TextEncoder().encode(output.text).length,
      truncated: false,
    };
  }
  return {
    id: `${name}-test`,
    name,
    arguments: arguments_ as CanonicalToolCall["arguments"],
    status,
    content: JSON.stringify(authenticOutput),
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
          matches: [
            {
              path: "src/main/run.ts",
              lineNumber: 7,
              text: "run();",
              textTruncated: false,
            },
          ],
          truncated: false,
        }),
      ),
    );

    expect(result).toEqual({
      content,
      corrections: [],
      unresolved: [],
      verifiedCitations: ["src/main/run.ts:7"],
    });
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
            {
              path: "src/preload/index.ts",
              lineNumber: 14,
              text: "cancelSession first",
              textTruncated: false,
            },
            {
              path: "src/preload/index.ts",
              lineNumber: 24,
              text: "cancelSession second",
              textTruncated: false,
            },
          ],
          truncated: false,
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
    expect(result.verifiedCitations).toEqual([
      "src/preload/index.ts:14",
      "src/preload/index.ts:24",
    ]);
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
          truncated: false,
        }),
        toolCall("search_text", { query: "needle" }, {
          ok: true,
          matches: [
            {
              path: "src/a/index.ts",
              lineNumber: 4,
              text: "needle",
              textTruncated: false,
            },
          ],
          truncated: false,
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
    expect(result.verifiedCitations).toEqual([]);
  });

  it("rejects unknown paths and lines that the successful tool evidence cannot support", () => {
    const result = normalizeAnswerCitations(
      "Valid suffix: `read.ts:2`; out of range: `src/read.ts:3`; invented: `missing/file.ts:9`.",
      messages(
        toolCall("read_text_file", { relativePath: "src/read.ts" }, {
          ok: true,
          text: "one\ntwo\n",
          bytes: 8,
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
    expect(result.verifiedCitations).toEqual(["src/read.ts:2"]);
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
    expect(result.verifiedCitations).toEqual([]);
  });

  it("does not interpret web URLs or clock times as repository citations", () => {
    const content =
      'See https://example.com/file.ts:443, `https://example.com/code.ts:444`, and "https://example.com/quoted.ts:445" at 12:30.';
    expect(normalizeAnswerCitations(content, [])).toEqual({
      content,
      corrections: [],
      unresolved: [],
      verifiedCitations: [],
    });
  });

  it("does not extract evidenced path tails from URI query, fragment, or opaque schemes", () => {
    const evidence = messages(
      toolCall("read_text_file", { relativePath: "src/a.ts" }, {
        ok: true,
        text: "export const a = true;\n",
        truncated: false,
      }),
    );
    const content = [
      "Valid src/a.ts:1.",
      "Query https://example.com/?path=src/a.ts:1.",
      "Fragment https://example.com/#src/a.ts:1.",
      "Opaque mailto:src/a.ts:1 and urn:src/a.ts:1.",
      "Custom vscode:src/a.ts:1 and file:src/a.ts:1.",
      "Markdown [source](https://example.com/?file=src/a.ts:1).",
      "Assigned URL=https://example.com/?file=src/a.ts:1.",
      "Adjacent See:https://example.com/#src/a.ts:1 and—https://example.com/#src/a.ts:1.",
    ].join(" ");

    expect(normalizeAnswerCitations(content, evidence)).toEqual({
      content,
      corrections: [],
      unresolved: [],
      verifiedCitations: ["src/a.ts:1"],
    });
  });

  it("supports Unicode and quoted paths with spaces without accepting citation prefixes", () => {
    const evidence = messages(
      toolCall("read_text_file", { relativePath: "src/设计 文件.ts" }, {
        ok: true,
        text: "第一行\n第二行\n",
        bytes: 22,
        truncated: false,
      }),
      toolCall("search_text", { query: "入口" }, {
        ok: true,
        matches: [
          {
            path: "src/入口.ts",
            lineNumber: 3,
            text: "export const 入口 = true;",
            textTruncated: false,
          },
        ],
        truncated: false,
      }),
    );

    expect(
      normalizeAnswerCitations(
        "See `src/设计 文件.ts:2` and src/入口.ts:3.",
        evidence,
      ).verifiedCitations,
    ).toEqual(["src/入口.ts:3", "src/设计 文件.ts:2"]);
    for (const malformed of [
      "src/入口.ts:3extra",
      "src/入口.ts:3.5",
      "src/入口.ts:3-999",
      "src/入口.ts:3/fake",
      "src/入口.ts:3:999",
      "src/入口.ts:3,999",
      "src/入口.ts:3!fake",
      "src/入口.ts:3?fake",
    ]) {
      expect(normalizeAnswerCitations(`Malformed ${malformed}.`, evidence)).toEqual({
        content: `Malformed ${malformed}.`,
        corrections: [],
        unresolved: [],
        verifiedCitations: [],
      });
    }
  });
});
