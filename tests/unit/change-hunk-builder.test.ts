import { describe, expect, it } from "vitest";

import { buildTextHunks } from "../../src/main/tools/change-hunk-builder";

describe("change hunk builder", () => {
  it("builds side-aware, content-addressed hunks", () => {
    const result = buildTextHunks({
      oldPath: "src/a.ts",
      newPath: "src/a.ts",
      oldText: "one\ntwo\nthree\n",
      newText: "one\nchanged\nthree\n",
      maxHunks: 10,
    });

    expect(result.omissionCodes).toEqual([]);
    expect(result.omittedHunkCount).toBe(0);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]).toMatchObject({
      oldPath: "src/a.ts",
      newPath: "src/a.ts",
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      lines: [
        { kind: "context", content: "one", oldLine: 1, newLine: 1 },
        { kind: "deletion", content: "two", oldLine: 2, newLine: null },
        { kind: "addition", content: "changed", oldLine: null, newLine: 2 },
        { kind: "context", content: "three", oldLine: 3, newLine: 3 },
      ],
    });
    expect(result.hunks[0]?.hunkSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("preserves line terminators and exposes terminator-only changes", () => {
    const result = buildTextHunks({
      oldPath: "a.txt",
      newPath: "a.txt",
      oldText: "one\r\ntwo\r",
      newText: "one\ntwo",
      maxHunks: 10,
    });
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]?.lines).toEqual([
      {
        kind: "deletion",
        content: "one",
        terminator: "crlf",
        oldLine: 1,
        newLine: null,
      },
      {
        kind: "deletion",
        content: "two",
        terminator: "cr",
        oldLine: 2,
        newLine: null,
      },
      {
        kind: "addition",
        content: "one",
        terminator: "lf",
        oldLine: null,
        newLine: 1,
      },
      {
        kind: "addition",
        content: "two",
        terminator: "none",
        oldLine: null,
        newLine: 2,
      },
    ]);
  });

  it("builds added and deleted hunks with valid zero-side ranges", () => {
    const added = buildTextHunks({
      oldPath: null,
      newPath: "new.txt",
      oldText: "",
      newText: "new\n",
      maxHunks: 10,
    });
    expect(added.hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
    });

    const deleted = buildTextHunks({
      oldPath: "old.txt",
      newPath: null,
      oldText: "old\n",
      newText: "",
      maxHunks: 10,
    });
    expect(deleted.hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 0,
    });
  });

  it("omits whole hunks deterministically when the hunk budget is zero", () => {
    const result = buildTextHunks({
      oldPath: "a.txt",
      newPath: "a.txt",
      oldText: "old\n",
      newText: "new\n",
      maxHunks: 0,
    });
    expect(result.hunks).toEqual([]);
    expect(result.omittedHunkCount).toBe(1);
    expect(result.omissionCodes).toEqual(["hunk_count_limit"]);
  });

  it("observes cancellation before diffing", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      buildTextHunks({
        oldPath: "a.txt",
        newPath: "a.txt",
        oldText: "old",
        newText: "new",
        maxHunks: 10,
        signal: controller.signal,
      }),
    ).toThrow(/cancelled/u);
  });
});
