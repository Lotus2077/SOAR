import { describe, expect, it } from "vitest";

import {
  GitChangeParseError,
  parseGitIndexStage,
  parseGitNumstat,
  parseGitRawDiff,
  parseGitStatusPorcelainV2,
} from "../../src/main/tools/git-change-parsers";

function nul(...records: Array<string | Uint8Array>): Buffer {
  return Buffer.concat(
    records.flatMap((record) => [Buffer.from(record), Buffer.from([0])]),
  );
}

const oidA = "a".repeat(40);
const oidB = "b".repeat(40);

describe("Git change machine-output parsers", () => {
  it("parses ordinary, renamed, and untracked porcelain-v2 records", () => {
    const parsed = parseGitStatusPorcelainV2(
      nul(
        `1 .M N... 100644 100644 100644 ${oidA} ${oidA} src/a file.ts`,
        `2 R. N... 100644 100644 100644 ${oidA} ${oidB} R087 src/new.ts`,
        "src/old.ts",
        "? notes/new.txt",
      ),
    );

    expect(parsed.unsafePaths).toEqual([]);
    expect(parsed.unsafeTrackedEntryCount).toBe(0);
    expect(parsed.unsafeUntrackedEntryCount).toBe(0);
    expect(parsed.entries).toMatchObject([
      {
        changeKind: "modified",
        oldPath: "src/a file.ts",
        newPath: "src/a file.ts",
        staged: false,
        unstaged: true,
      },
      {
        changeKind: "renamed",
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        staged: true,
        unstaged: false,
        renameScore: 87,
      },
      {
        changeKind: "untracked",
        oldPath: null,
        newPath: "notes/new.txt",
        staged: false,
        unstaged: true,
      },
    ]);
  });

  it("rejects unmerged state and records unsafe paths without decoding the whole stream", () => {
    expect(() =>
      parseGitStatusPorcelainV2(
        nul(`u UU N... 100644 100644 100644 100644 ${oidA} ${oidA} ${oidB} path.ts`),
      ),
    ).toThrow(/Unmerged/u);

    const parsed = parseGitStatusPorcelainV2(
      nul(Buffer.concat([Buffer.from("? bad/"), Buffer.from([0xff])])),
    );
    expect(parsed.entries).toEqual([]);
    expect(parsed.unsafePaths).toHaveLength(1);
    expect(parsed.unsafePaths[0]?.reason).toBe("invalid_utf8");
    expect(parsed.unsafeTrackedEntryCount).toBe(0);
    expect(parsed.unsafeUntrackedEntryCount).toBe(1);
  });

  it("counts an unsafe two-sided rename as one changed entry", () => {
    const invalidOldPath = Buffer.concat([
      Buffer.from("src/old-"),
      Buffer.from([0xff]),
    ]);
    const invalidNewPath = Buffer.concat([
      Buffer.from("src/new-"),
      Buffer.from([0xfe]),
    ]);
    const status = parseGitStatusPorcelainV2(
      nul(
        Buffer.concat([
          Buffer.from(
            `2 R. N... 100644 100644 100644 ${oidA} ${oidB} R100 `,
          ),
          invalidNewPath,
        ]),
        invalidOldPath,
      ),
    );
    const raw = parseGitRawDiff(
      nul(
        `:100644 100644 ${oidA} ${oidB} R100`,
        invalidOldPath,
        invalidNewPath,
      ),
    );
    const numstat = parseGitNumstat(
      nul("0\t0\t", invalidOldPath, invalidNewPath),
    );

    expect(status.unsafePaths).toHaveLength(2);
    expect(status.unsafeTrackedEntryCount).toBe(1);
    expect(status.unsafeUntrackedEntryCount).toBe(0);
    expect(raw.unsafePaths).toHaveLength(2);
    expect(raw.unsafeEntryCount).toBe(1);
    expect(numstat.unsafePaths).toHaveLength(2);
    expect(numstat.unsafeEntryCount).toBe(1);
  });

  it("parses index stages and preserves full object IDs", () => {
    const parsed = parseGitIndexStage(
      nul(`100644 ${oidA} 0\tsrc/a.ts`, `160000 ${oidB} 0\tvendor/sub`),
    );
    expect(parsed.entries).toEqual([
      { mode: "100644", objectId: oidA, stage: 0, path: "src/a.ts" },
      { mode: "160000", objectId: oidB, stage: 0, path: "vendor/sub" },
    ]);
  });

  it("parses raw additions, deletions, and rename pairs", () => {
    const parsed = parseGitRawDiff(
      nul(
        `:000000 100644 ${"0".repeat(40)} ${"0".repeat(40)} A`,
        "src/added.ts",
        `:100644 000000 ${oidA} ${"0".repeat(40)} D`,
        "src/deleted.ts",
        `:100644 100644 ${oidA} ${"0".repeat(40)} R100`,
        "src/old.ts",
        "src/new.ts",
      ),
    );
    expect(parsed.entries).toMatchObject([
      { oldPath: null, newPath: "src/added.ts", status: "A" },
      { oldPath: "src/deleted.ts", newPath: null, status: "D", oldObjectId: oidA },
      { oldPath: "src/old.ts", newPath: "src/new.ts", status: "R", score: 100 },
    ]);
  });

  it("parses normal, binary, and rename numstat records", () => {
    const parsed = parseGitNumstat(
      nul("3\t2\tsrc/a.ts", "-\t-\timage.bin", "0\t0\t", "src/old.ts", "src/new.ts"),
    );
    expect(parsed.entries).toEqual([
      { additions: 3, deletions: 2, oldPath: "src/a.ts", newPath: "src/a.ts" },
      { additions: null, deletions: null, oldPath: "image.bin", newPath: "image.bin" },
      { additions: 0, deletions: 0, oldPath: "src/old.ts", newPath: "src/new.ts" },
    ]);
  });

  it("rejects truncated and non-NUL-terminated records", () => {
    expect(() => parseGitRawDiff(Buffer.from(`:100644 100644 ${oidA}`))).toThrow(
      GitChangeParseError,
    );
    expect(() => parseGitNumstat(nul("x\t0\ta.ts"))).toThrow(/invalid line count/u);
  });
});
