import { describe, expect, it } from "vitest";

import path from "node:path";

import {
  PR6R_FROZEN_FIXTURE_FAILURE,
  materializePr6rDevelopmentFixtureV1,
  pr6rFrozenFixtureTestAccess,
} from "../../src/main/pr6r-development/frozen-fixture";
import {
  PR6R_FIXTURE_BASE_REVISION,
  PR6R_FIXTURE_CHANGE_REVISION,
  PR6R_FIXTURE_ID,
  PR6R_FIXTURE_MATERIALIZATION,
  PR6R_FIXTURE_REPOSITORY,
  PR6R_FIXTURE_SUBJECT,
} from "../../src/shared/pr6r-development-contracts";

const identity = Object.freeze({
  fixtureId: PR6R_FIXTURE_ID,
  repository: PR6R_FIXTURE_REPOSITORY,
  baseRevision: PR6R_FIXTURE_BASE_REVISION,
  changeRevision: PR6R_FIXTURE_CHANGE_REVISION,
  subject: PR6R_FIXTURE_SUBJECT,
  materialization: PR6R_FIXTURE_MATERIALIZATION,
});

describe("PR6R frozen fixture source identity", () => {
  it("accepts only the exact repository, revisions, subject, and protocol", () => {
    expect(() =>
      pr6rFrozenFixtureTestAccess.assertSourceIdentity(identity),
    ).not.toThrow();

    for (const [field, value] of [
      ["repository", "https://example.invalid/other.git"],
      ["baseRevision", "a".repeat(40)],
      ["changeRevision", "b".repeat(40)],
      ["subject", "different subject"],
      ["materialization", "different-protocol"],
    ] as const) {
      expect(() =>
        pr6rFrozenFixtureTestAccess.assertSourceIdentity({
          ...identity,
          [field]: value,
        }),
      ).toThrow(/source identity is not frozen/u);
    }
  });

  it("discards raw path-bearing materialization failures at the PR6R boundary", async () => {
    const privateMissingPath = path.join(
      import.meta.dirname,
      "private-fixture-source-that-must-not-leak",
    );
    let failure: unknown;
    try {
      await materializePr6rDevelopmentFixtureV1({
        projectRoot: privateMissingPath,
        sourceRepository: privateMissingPath,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(PR6R_FROZEN_FIXTURE_FAILURE);
    expect((failure as Error).stack).toBe(
      `Error: ${PR6R_FROZEN_FIXTURE_FAILURE}`,
    );
    expect((failure as Error).message).not.toContain(privateMissingPath);
    expect((failure as Error).message).not.toMatch(/ENOENT|realpath/iu);
    expect((failure as Error).stack).not.toContain(privateMissingPath);
    expect((failure as Error).stack).not.toContain(import.meta.dirname);
  });
});
