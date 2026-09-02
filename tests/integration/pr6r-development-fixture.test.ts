import path from "node:path";
import { access } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { materializePr6rDevelopmentFixtureV1 } from "../../src/main/pr6r-development/frozen-fixture";
import {
  PR6R_FIXTURE_CHANGED_LINE_COUNT,
  PR6R_FIXTURE_CHANGED_PATHS,
  PR6R_FIXTURE_SNAPSHOT_ID,
} from "../../src/shared/pr6r-development-contracts";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const sourceRepository = process.env.SOAR_PR6R_FLASK_REPO?.trim();
const proofRequired = process.env.SOAR_PR6R_FIXTURE_PROOF_REQUIRED === "true";

describe("PR6R cal-007 frozen public fixture", () => {
  it.skipIf(
    !proofRequired && (sourceRepository === undefined || sourceRepository === ""),
  )(
    "reproduces the exact nine-path high-risk change from local Git objects only",
    async () => {
      if (sourceRepository === undefined || sourceRepository === "") {
        throw new Error(
          "SOAR_PR6R_FLASK_REPO is required for the explicit cal-007 proof gate.",
        );
      }
      const fixture = await materializePr6rDevelopmentFixtureV1({
        projectRoot,
        sourceRepository,
      });
      const workspaceRoot = fixture.workspaceRoot;
      try {
        expect(fixture.snapshot.snapshotId).toBe(PR6R_FIXTURE_SNAPSHOT_ID);
        expect(fixture.changedLineCount).toBe(PR6R_FIXTURE_CHANGED_LINE_COUNT);
        expect(fixture.snapshot.manifest.map((entry) => entry.newPath)).toEqual(
          PR6R_FIXTURE_CHANGED_PATHS,
        );
        expect(fixture.snapshot.omittedPathCount).toBe(0);
        expect(fixture.snapshot.omittedHunkCount).toBe(0);
      } finally {
        fixture.cleanup();
      }
      await expect(access(workspaceRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
    30_000,
  );
});
