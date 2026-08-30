import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  REQUIRED_BUILD_LOG_FIELDS,
  validateAppendOnlyBuildLog,
  validateBuildLog,
  validateMaterialChangeBuildLogEntry,
} from "../../scripts/validate-build-log";

function entry(input: {
  id: string;
  date: string;
  title?: string;
  status?: string;
  decisions?: string;
  references?: string;
}): string {
  const values: Record<string, string> = {
    Status: `\`${input.status ?? "Implemented"}\``,
    "Scope or hypothesis": "Test the ledger contract.",
    Decisions: input.decisions ?? "Keep the test deterministic.",
    Changes: "Fixture only.",
    Evidence: "Validator unit test.",
    "Failures or blockers": "None.",
    "Limitations and non-claims": "This is only a fixture.",
    "Paid exposure": "$0.",
    "Next gate": "Run the test.",
    References: input.references ?? "None.",
  };
  return [
    `### ${input.id} -- ${input.date} -- ${input.title ?? "Fixture"}`,
    "",
    ...REQUIRED_BUILD_LOG_FIELDS.flatMap((field) => [
      `${field}: ${values[field]}`,
      "",
    ]),
  ].join("\n");
}

function log(...entries: readonly string[]): string {
  return [
    "# Fixture build log",
    "",
    "## Backfilled project history",
    "",
    ...entries,
  ].join("\n");
}

describe("build-log validator", () => {
  it("accepts the repository ledger and ignores its fenced entry template", () => {
    const result = validateBuildLog(
      readFileSync(new URL("../../docs/BUILD_LOG.md", import.meta.url), "utf8"),
    );

    expect(result.errors).toEqual([]);
    expect(result.entries.length).toBeGreaterThanOrEqual(9);
    expect(result.entries[0]?.id).toBe("BL-0001");
  });

  it("rejects duplicate IDs, invalid statuses, and missing fields", () => {
    const malformed = log(
      entry({ id: "BL-0001", date: "2026-08-27" }),
      entry({
        id: "BL-0001",
        date: "2026-08-28",
        status: "Done",
      }).replace("References: None.\n", ""),
    );
    const result = validateBuildLog(malformed);

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("duplicate entry ID"),
        expect.stringContaining("invalid Status"),
        expect.stringContaining("missing required field References"),
      ]),
    );
  });

  it("rejects an appended entry whose heading is malformed", () => {
    const malformed = `${log(
      entry({ id: "BL-0001", date: "2026-08-27" }),
    )}\n### BL-invalid heading\nStatus: \`Implemented\`\n`;

    expect(validateBuildLog(malformed).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("malformed build-log entry heading"),
      ]),
    );
  });

  it("ignores pseudo entries and fields inside Markdown and HTML blocks", () => {
    const real = entry({ id: "BL-0001", date: "2026-08-27" });
    const noisy = [
      "# Fixture build log",
      "",
      "## Backfilled project history",
      "",
      "```text",
      "### BL-0009 -- 2026-08-27 -- Fenced pseudo entry",
      "Status: `Failed`",
      "```",
      "<!--",
      "### BL-0010 -- 2026-08-27 -- Comment pseudo entry",
      "Status: `Failed`",
      "-->",
      "<div>",
      "### BL-0011 -- 2026-08-27 -- HTML pseudo entry",
      "Status: `Failed`",
      "</div>",
      "<textarea>",
      "### BL-0013 -- 2026-08-27 -- Raw HTML pseudo entry",
      "Status: `Failed`",
      "</textarea>",
      "> ### BL-0012 -- 2026-08-27 -- Quote pseudo entry",
      "> Status: `Failed`",
      real,
      "```text",
      "Status: `Reverted`",
      "```",
    ].join("\n");

    const result = validateBuildLog(noisy);
    expect(result.errors).toEqual([]);
    expect(result.entries.map((item) => item.id)).toEqual(["BL-0001"]);
    expect(result.entries[0]?.fields.Status).toBe("`Implemented`");
  });

  it("requires chronological timestamp IDs and valid prior correction references", () => {
    const result = validateBuildLog(
      log(
        entry({ id: "BL-0001", date: "2026-08-27" }),
        entry({
          id: "BL-20260829-1200-first",
          date: "2026-08-29",
        }),
        entry({
          id: "BL-20260829-1159-correction",
          date: "2026-08-29",
          title: "Correction without a prior target",
          references: "BL-20260829-1300-future.",
        }),
      ),
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("timestamp precedes"),
        expect.stringContaining("is not an earlier entry"),
      ]),
    );
  });

  it("allows one explicit correction to reset a legacy timestamp sequence to UTC", () => {
    const result = validateBuildLog(
      log(
        entry({ id: "BL-0001", date: "2026-08-27" }),
        entry({
          id: "BL-20260829-2000-local-clock",
          date: "2026-08-29",
        }),
        entry({
          id: "BL-20260829-1200-utc-reset",
          date: "2026-08-29",
          title: "Correction: restore the UTC timestamp basis",
          decisions:
            "Timestamp sequence reset after: `BL-20260829-2000-local-clock`.",
          references: "BL-20260829-2000-local-clock.",
        }),
        entry({
          id: "BL-20260829-1201-after-reset",
          date: "2026-08-29",
        }),
      ),
    );

    expect(result.errors).toEqual([]);
  });

  it.each([
    {
      label: "a non-correction title",
      title: "Restore the UTC timestamp basis",
      status: "Implemented",
      decisions:
        "Timestamp sequence reset after: `BL-20260829-2000-local-clock`.",
    },
    {
      label: "a non-implemented status",
      title: "Correction: restore the UTC timestamp basis",
      status: "Approved",
      decisions:
        "Timestamp sequence reset after: `BL-20260829-2000-local-clock`.",
    },
    {
      label: "a non-immediate target",
      title: "Correction: restore the UTC timestamp basis",
      status: "Implemented",
      decisions: "Timestamp sequence reset after: `BL-0001`.",
    },
    {
      label: "a malformed marker",
      title: "Correction: restore the UTC timestamp basis",
      status: "Implemented",
      decisions:
        "Timestamp sequence reset after: BL-20260829-2000-local-clock.",
    },
    {
      label: "an additional malformed marker",
      title: "Correction: restore the UTC timestamp basis",
      status: "Implemented",
      decisions: [
        "Timestamp sequence reset after: `BL-20260829-2000-local-clock`.",
        "Timestamp sequence reset after: malformed.",
      ].join("\n"),
    },
  ])("rejects a backward timestamp reset with $label", ({
    title,
    status,
    decisions,
  }) => {
    const result = validateBuildLog(
      log(
        entry({ id: "BL-0001", date: "2026-08-27" }),
        entry({
          id: "BL-20260829-2000-local-clock",
          date: "2026-08-29",
        }),
        entry({
          id: "BL-20260829-1200-invalid-reset",
          date: "2026-08-29",
          title,
          status,
          decisions,
          references: "BL-20260829-2000-local-clock.",
        }),
      ),
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("timestamp sequence reset marker is invalid"),
        expect.stringContaining("timestamp precedes"),
      ]),
    );
  });

  it("rejects an unnecessary reset marker and a second backward reset", () => {
    const unnecessary = validateBuildLog(
      log(
        entry({ id: "BL-0001", date: "2026-08-27" }),
        entry({
          id: "BL-20260829-1200-first",
          date: "2026-08-29",
        }),
        entry({
          id: "BL-20260829-1201-unnecessary-reset",
          date: "2026-08-29",
          title: "Correction: unnecessary reset",
          decisions:
            "Timestamp sequence reset after: `BL-20260829-1200-first`.",
          references: "BL-20260829-1200-first.",
        }),
      ),
    );
    expect(unnecessary.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("timestamp sequence reset marker is invalid"),
      ]),
    );

    const secondReset = validateBuildLog(
      log(
        entry({ id: "BL-0001", date: "2026-08-27" }),
        entry({
          id: "BL-20260829-2000-local-clock",
          date: "2026-08-29",
        }),
        entry({
          id: "BL-20260829-1200-first-reset",
          date: "2026-08-29",
          title: "Correction: first UTC reset",
          decisions:
            "Timestamp sequence reset after: `BL-20260829-2000-local-clock`.",
          references: "BL-20260829-2000-local-clock.",
        }),
        entry({
          id: "BL-20260829-1300-forward",
          date: "2026-08-29",
        }),
        entry({
          id: "BL-20260829-1259-second-reset",
          date: "2026-08-29",
          title: "Correction: second UTC reset",
          decisions:
            "Timestamp sequence reset after: `BL-20260829-1300-forward`.",
          references: "BL-20260829-1300-forward.",
        }),
      ),
    );
    expect(secondReset.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("timestamp sequence reset marker is invalid"),
        expect.stringContaining("timestamp precedes"),
      ]),
    );
  });

  it("keeps enforcing monotonic timestamps after the one-time reset", () => {
    const result = validateBuildLog(
      log(
        entry({ id: "BL-0001", date: "2026-08-27" }),
        entry({
          id: "BL-20260829-2000-local-clock",
          date: "2026-08-29",
        }),
        entry({
          id: "BL-20260829-1200-utc-reset",
          date: "2026-08-29",
          title: "Correction: restore the UTC timestamp basis",
          decisions:
            "Timestamp sequence reset after: `BL-20260829-2000-local-clock`.",
          references: "BL-20260829-2000-local-clock.",
        }),
        entry({
          id: "BL-20260829-1159-late-entry",
          date: "2026-08-29",
        }),
      ),
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("timestamp precedes")]),
    );
  });

  it("accepts only a byte-for-byte base prefix in append-only mode", () => {
    const base = "first\nsecond\n";
    expect(
      validateAppendOnlyBuildLog(
        base,
        `${base}\n### BL-20260829-1200-third -- 2026-08-29 -- Third\n`,
      ),
    ).toEqual([]);
    expect(validateAppendOnlyBuildLog(base, `${base}more references\n`)).toEqual([
      expect.stringContaining("complete new entry heading"),
    ]);
    expect(
      validateAppendOnlyBuildLog(
        base,
        `${base}more references\n### BL-20260829-1200-third -- 2026-08-29 -- Third\n`,
      ),
    ).toEqual([expect.stringContaining("complete new entry heading")]);
    expect(validateAppendOnlyBuildLog(base, "first\nchanged\n")).toEqual([
      expect.stringContaining("line is 2"),
    ]);
    expect(validateAppendOnlyBuildLog(base, "first\n")).toEqual([
      expect.stringContaining("line is 2"),
    ]);
  });

  it("requires a new entry when material paths changed", () => {
    const base = log(entry({ id: "BL-0001", date: "2026-08-27" }));
    const appended = `${base}\n${entry({
      id: "BL-20260829-1200-runtime",
      date: "2026-08-29",
    })}`;

    expect(
      validateMaterialChangeBuildLogEntry(base, base, ["src/main/index.ts"]),
    ).toEqual([expect.stringContaining("material changes require")]);
    expect(
      validateMaterialChangeBuildLogEntry(base, appended, [
        "src/main/index.ts",
      ]),
    ).toEqual([]);
    expect(
      validateMaterialChangeBuildLogEntry(base, base, ["docs/typo.md"]),
    ).toEqual([]);
    expect(
      validateMaterialChangeBuildLogEntry(base, base, [
        "docs/adr/9999-contract.md",
        "docs/plans/router.md",
      ]),
    ).toEqual([expect.stringContaining("material changes require")]);
  });
});
