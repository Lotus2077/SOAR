import { isDeepStrictEqual } from "node:util";

import {
  materializeFrozenReviewFixtureV1,
  type MaterializedFrozenReviewFixtureV1,
} from "../../benchmark/local-review-fixture";
import {
  PR6R_FIXTURE_CHANGED_LINE_COUNT,
  PR6R_FIXTURE_CHANGED_PATH_COUNT,
  PR6R_FIXTURE_CHANGED_PATHS,
  PR6R_FIXTURE_CLASSIFICATION,
  PR6R_FIXTURE_BASE_REVISION,
  PR6R_FIXTURE_CHANGE_REVISION,
  PR6R_FIXTURE_DISCOVERY_SHA256,
  PR6R_FIXTURE_ID,
  PR6R_FIXTURE_INDEX_SHA256,
  PR6R_FIXTURE_MATERIALIZATION,
  PR6R_FIXTURE_REPOSITORY,
  PR6R_FIXTURE_RISK_SCORE,
  PR6R_FIXTURE_SNAPSHOT_ID,
  PR6R_FIXTURE_SUBJECT,
} from "../../shared/pr6r-development-contracts";
import { extractVerifiedReviewRiskV1 } from "../review-risk";

export type MaterializedPr6rDevelopmentFixtureV1 =
  MaterializedFrozenReviewFixtureV1<typeof PR6R_FIXTURE_ID>;

export const PR6R_FROZEN_FIXTURE_FAILURE =
  "pr6r_frozen_fixture_materialization_failed" as const;

function stablePr6rFrozenFixtureFailure(): Error {
  const failure = new Error(PR6R_FROZEN_FIXTURE_FAILURE);
  // Error stacks normally retain the absolute source/check-out path at the
  // construction site. Keep the whole public error boundary host-authored and
  // stable, not only its message.
  failure.stack = `Error: ${PR6R_FROZEN_FIXTURE_FAILURE}`;
  return failure;
}

type Pr6rFrozenSourceIdentity = Pick<
  MaterializedPr6rDevelopmentFixtureV1,
  | "fixtureId"
  | "repository"
  | "baseRevision"
  | "changeRevision"
  | "subject"
  | "materialization"
>;

function assertPr6rFrozenSourceIdentity(
  fixture: Pr6rFrozenSourceIdentity,
): void {
  if (
    fixture.fixtureId !== PR6R_FIXTURE_ID ||
    fixture.repository !== PR6R_FIXTURE_REPOSITORY ||
    fixture.baseRevision !== PR6R_FIXTURE_BASE_REVISION ||
    fixture.changeRevision !== PR6R_FIXTURE_CHANGE_REVISION ||
    fixture.subject !== PR6R_FIXTURE_SUBJECT ||
    fixture.materialization !== PR6R_FIXTURE_MATERIALIZATION
  ) {
    throw new Error("The materialized PR6R source identity is not frozen.");
  }
}

/**
 * Materialize the one approved public fixture from explicit local Git objects.
 * The generic materializer disables lazy fetch, removes the cloned remote, and
 * never resolves or fetches a repository URL.
 */
export async function materializePr6rDevelopmentFixtureV1(options: {
  projectRoot: string;
  sourceRepository: string;
}): Promise<MaterializedPr6rDevelopmentFixtureV1> {
  let fixture: MaterializedPr6rDevelopmentFixtureV1 | undefined;
  try {
    fixture = await materializeFrozenReviewFixtureV1({
      ...options,
      fixtureId: PR6R_FIXTURE_ID,
    });
    assertPr6rFrozenSourceIdentity(fixture);
    const risk = extractVerifiedReviewRiskV1(fixture.snapshot);
    const changedPaths = fixture.snapshot.manifest.map((entry) => entry.newPath);
    if (
      fixture.snapshot.snapshotId !== PR6R_FIXTURE_SNAPSHOT_ID ||
      fixture.snapshot.indexSha256 !== PR6R_FIXTURE_INDEX_SHA256 ||
      fixture.snapshot.discoverySha256 !== PR6R_FIXTURE_DISCOVERY_SHA256 ||
      fixture.changedPathCount !== PR6R_FIXTURE_CHANGED_PATH_COUNT ||
      fixture.changedLineCount !== PR6R_FIXTURE_CHANGED_LINE_COUNT ||
      !isDeepStrictEqual(changedPaths, [...PR6R_FIXTURE_CHANGED_PATHS]) ||
      !risk.complete ||
      risk.score !== PR6R_FIXTURE_RISK_SCORE ||
      risk.classification !== PR6R_FIXTURE_CLASSIFICATION ||
      fixture.snapshot.omittedPathCount !== 0 ||
      fixture.snapshot.omittedHunkCount !== 0 ||
      fixture.snapshot.manifestOmissionCodes.length !== 0
    ) {
      throw new Error("The materialized PR6R fixture does not match its frozen identity.");
    }
    return fixture;
  } catch {
    try {
      fixture?.cleanup();
    } catch {
      // Cleanup diagnostics can contain host paths. The PR6R boundary exposes
      // only the stable host-authored failure below.
    }
    throw stablePr6rFrozenFixtureFailure();
  }
}

export const pr6rFrozenFixtureTestAccess = Object.freeze({
  assertSourceIdentity: assertPr6rFrozenSourceIdentity,
});
