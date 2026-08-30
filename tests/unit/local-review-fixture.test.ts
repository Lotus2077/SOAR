import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LOCAL_REVIEW_FIXTURE_ID,
  materializeLocalReviewFixtureV1,
} from "../../src/benchmark/local-review-fixture";
import { inspectGitChanges } from "../../src/main/tools/inspect-git-changes";

const projectRoot = path.resolve(import.meta.dirname, "../..");

describe("local review evaluation fixture", () => {
  it("reproduces the frozen nonempty public change from local objects only", async () => {
    const fixture = await materializeLocalReviewFixtureV1({
      projectRoot,
      sourceRepository: projectRoot,
    });
    try {
      expect(fixture.fixtureId).toBe(LOCAL_REVIEW_FIXTURE_ID);
      expect(fixture.manifestSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(fixture.snapshot.snapshotId).toBe(
        "3c327a17b3b76c8e72570be5d18ff4ae09cd9b28a9cac92fe5b582e13876c1d3",
      );
      expect(fixture.changedPathCount).toBe(2);
      expect(fixture.changedLineCount).toBe(43);
      expect(fixture.snapshot.manifest.map((entry) => entry.newPath)).toEqual([
        "docs/BUILD_LOG.md",
        "docs/plans/HYBRID_LEASE_ROUTER_V0.md",
      ]);
      const replay = await inspectGitChanges({
        workspaceRoot: fixture.workspaceRoot,
        request: { schemaVersion: "inspect-git-changes-v1" },
      });
      expect(replay.snapshot.snapshotId).toBe(fixture.snapshot.snapshotId);
    } finally {
      fixture.cleanup();
    }
  });
});
