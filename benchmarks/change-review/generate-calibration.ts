import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  CALIBRATION_SOURCE_DIFF_PROTOCOL_V1,
  ChangeReviewCalibrationSetV1Schema,
  ChangeReviewEvalProtocolV1Schema,
  frozenReviewRiskProtocolSignals,
} from "../../src/shared/review-risk-evaluation";
import { deriveVerifiedCalibrationSourceDiffV1 } from "../../src/main/review-risk";
import { acquireMaterializedChangeSnapshot } from "./validate-materialization";
import { createIsolatedGitEnvironment } from "../../src/main/tools/git-command-policy";

const FROZEN_AT = "2026-08-29T13:48:00Z";
const projectRoot = path.resolve(import.meta.dirname, "../..");
const calibrationPath = path.join(import.meta.dirname, "calibration-v1.json");
const protocolPath = path.join(import.meta.dirname, "protocol-v1.json");

interface Candidate {
  id: string;
  repositoryId: "flask" | "pytest" | "soar";
  repositoryUrl: string;
  repositoryWebUrl: string;
  changeRevision: string;
  reviewAttention: "heightened" | "routine";
  rationale: string;
}

const candidates: readonly Candidate[] = [
  {
    id: "cal-001-soar-plan-approval",
    repositoryId: "soar",
    repositoryUrl: "https://github.com/Lotus2077/SOAR.git",
    repositoryWebUrl: "https://github.com/Lotus2077/SOAR",
    changeRevision: "4b9419b19bcc6bbe25c858ae48f176cfa33a6a65",
    reviewAttention: "routine",
    rationale: "Two-file approval-ledger update with no runtime path.",
  },
  {
    id: "cal-002-soar-repeat-step-guard",
    repositoryId: "soar",
    repositoryUrl: "https://github.com/Lotus2077/SOAR.git",
    repositoryWebUrl: "https://github.com/Lotus2077/SOAR",
    changeRevision: "aee5c176a362589c449929ae0d2898786ff08c82",
    reviewAttention: "routine",
    rationale: "Small runner guard accompanied by focused integration tests.",
  },
  {
    id: "cal-003-soar-scheduled-rounds",
    repositoryId: "soar",
    repositoryUrl: "https://github.com/Lotus2077/SOAR.git",
    repositoryWebUrl: "https://github.com/Lotus2077/SOAR",
    changeRevision: "33562c65e07741eaf0ccf6fc9e334e1137e990e0",
    reviewAttention: "heightened",
    rationale: "Thirteen-file agent-loop and scheduling change spanning runtime and tests.",
  },
  {
    id: "cal-004-flask-query-route",
    repositoryId: "flask",
    repositoryUrl: "https://github.com/pallets/flask.git",
    repositoryWebUrl: "https://github.com/pallets/flask",
    changeRevision: "89992954ec71b594b1b911f98977cdc8ad46a057",
    reviewAttention: "routine",
    rationale: "Focused route-decorator addition with documentation and a targeted test.",
  },
  {
    id: "cal-005-flask-ipv6-server-name",
    repositoryId: "flask",
    repositoryUrl: "https://github.com/pallets/flask.git",
    repositoryWebUrl: "https://github.com/pallets/flask",
    changeRevision: "7203feabf723edae0286ae5dc64fec8ac4c91735",
    reviewAttention: "routine",
    rationale: "Two-file IPv6 parsing correction paired with its regression test.",
  },
  {
    id: "cal-006-flask-teardown-callbacks",
    repositoryId: "flask",
    repositoryUrl: "https://github.com/pallets/flask.git",
    repositoryWebUrl: "https://github.com/pallets/flask",
    changeRevision: "fbb6f0bc4c60a0bada0e03c3480d0ccf30a3c1df",
    reviewAttention: "heightened",
    rationale: "Ten-file lifecycle-semantics change across core context code and multiple tests.",
  },
  {
    id: "cal-007-flask-jinja-name",
    repositoryId: "flask",
    repositoryUrl: "https://github.com/pallets/flask.git",
    repositoryWebUrl: "https://github.com/pallets/flask",
    changeRevision: "d8259eb11900285af9b80b0fa47f841174c054e3",
    reviewAttention: "heightened",
    rationale: "Nine-file terminology change touching template runtime and user-facing documentation.",
  },
  {
    id: "cal-008-flask-drop-eol-python",
    repositoryId: "flask",
    repositoryUrl: "https://github.com/pallets/flask.git",
    repositoryWebUrl: "https://github.com/pallets/flask",
    changeRevision: "52df9eed45d0b19c588662ed8492d8fbaa0e7098",
    reviewAttention: "heightened",
    rationale: "Compatibility-boundary change across eleven packaging, runtime, CI, and test files.",
  },
  {
    id: "cal-009-flask-development-dependencies",
    repositoryId: "flask",
    repositoryUrl: "https://github.com/pallets/flask.git",
    repositoryWebUrl: "https://github.com/pallets/flask",
    changeRevision: "11c45eeba3b5bcf06b84f4e864862f1019a3faa3",
    reviewAttention: "heightened",
    rationale: "Eleven-file dependency and CI update that also changes an application runtime path.",
  },
  {
    id: "cal-010-pytest-source-line-memoization",
    repositoryId: "pytest",
    repositoryUrl: "https://github.com/pytest-dev/pytest.git",
    repositoryWebUrl: "https://github.com/pytest-dev/pytest",
    changeRevision: "122512401b8dc6747569d204da3704d28a593265",
    reviewAttention: "heightened",
    rationale: "Parser-source memoization changes cache semantics despite its compact three-file scope.",
  },
  {
    id: "cal-011-pytest-invalid-config-usage-error",
    repositoryId: "pytest",
    repositoryUrl: "https://github.com/pytest-dev/pytest.git",
    repositoryWebUrl: "https://github.com/pytest-dev/pytest",
    changeRevision: "13dd9d24529339b537b7070baebd127c373bdd7d",
    reviewAttention: "heightened",
    rationale: "Eight-file configuration error-semantics change across multiple core subsystems.",
  },
  {
    id: "cal-012-pytest-truncation-budget",
    repositoryId: "pytest",
    repositoryUrl: "https://github.com/pytest-dev/pytest.git",
    repositoryWebUrl: "https://github.com/pytest-dev/pytest",
    changeRevision: "fbdae4e7ef2bbb87a7e4b75f6bf445528c0c7157",
    reviewAttention: "heightened",
    rationale: "Eight-file assertion-formatting budget change affecting several core comparison paths.",
  },
];

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function git(repositoryRoot: string, ...arguments_: string[]): string {
  return execFileSync(
    "/usr/bin/git",
    ["--no-pager", "-c", "protocol.allow=never", "-C", repositoryRoot, ...arguments_],
    {
      encoding: "utf8",
      env: createIsolatedGitEnvironment(),
      maxBuffer: 64 * 1024 * 1024,
    },
  ).trimEnd();
}

function repositoryRoots(): Record<Candidate["repositoryId"], string> {
  const flask = argumentValue("--flask-repo");
  const pytest = argumentValue("--pytest-repo");
  if (!flask || !pytest) {
    throw new Error("--flask-repo and --pytest-repo are required.");
  }
  return { soar: projectRoot, flask: path.resolve(flask), pytest: path.resolve(pytest) };
}

export async function generateFrozenCalibration(
  roots: Record<Candidate["repositoryId"], string>,
): Promise<unknown> {
  const changes = [];
  for (const candidate of candidates) {
    const sourceRoot = roots[candidate.repositoryId];
    const baseRevision = git(sourceRoot, "rev-parse", `${candidate.changeRevision}^`);
    const [committedAt, subject] = git(
      sourceRoot,
      "show",
      "-s",
      "--format=%cI%x00%s",
      candidate.changeRevision,
    ).split("\0");
    if (!committedAt || !subject) throw new Error(`Missing metadata for ${candidate.id}.`);
    const acquired = await acquireMaterializedChangeSnapshot(
      sourceRoot,
      baseRevision,
      candidate.changeRevision,
    );
    if (!acquired.risk.complete || acquired.risk.score === null || acquired.risk.classification === "incomplete") {
      throw new Error(`${candidate.id} did not produce complete bounded acquisition.`);
    }
    const sourceDiff = deriveVerifiedCalibrationSourceDiffV1(
      acquired.snapshot,
    );
    changes.push({
      schemaVersion: "change-review-calibration-change-v1",
      id: candidate.id,
      source: {
        repository: candidate.repositoryUrl,
        baseRevision,
        changeRevision: candidate.changeRevision,
        changeUrl: `${candidate.repositoryWebUrl}/commit/${candidate.changeRevision}`,
        committedAt,
        subject,
      },
      fixtureMode: "pinned_git_patch_to_index",
      materialization: {
        protocol: "git-patch-to-index-v1",
        steps: [
          "clone_public_repository",
          "verify_base_and_change_objects",
          "checkout_base_revision_detached",
          "generate_binary_full_index_patch_base_to_change",
          "apply_patch_to_index",
          "run_host_change_acquisition",
          "verify_snapshot_identity_and_feature_facts",
        ],
        patchApplication: "git_diff_binary_full_index_then_git_apply_index_v1",
      },
      acquisition: {
        status: "verified_change_snapshot_v1",
        inspectorContractVersion: "inspect-git-changes-v1",
        acquisitionComplete: true,
        incompleteReasons: [],
        snapshotId: acquired.snapshot.snapshotId,
        indexSha256: acquired.snapshot.indexSha256,
        discoverySha256: acquired.snapshot.discoverySha256,
        sourceDiffProtocol: CALIBRATION_SOURCE_DIFF_PROTOCOL_V1,
        sourceDiff,
        verifiedFeatureFacts: acquired.risk.facts,
        verifiedScore: acquired.risk.score,
        verifiedClassification: acquired.risk.classification,
      },
      label: {
        reviewAttention: candidate.reviewAttention,
        provenance: "curator_scope_judgment_v1",
        rationale: candidate.rationale,
      },
    });
  }
  return ChangeReviewCalibrationSetV1Schema.parse({
    schemaVersion: "change-review-calibration-set-v1",
    setId: "change-review-calibration-v1",
    status: "frozen",
    frozenAt: FROZEN_AT,
    selectionProtocol: "real_public_changes_balanced_by_curator_review_attention_v1",
    labelSemantics: "review_attention_only_not_defect_correctness_or_quality_gold",
    changes,
  });
}

async function main(): Promise<void> {
  const calibration = await generateFrozenCalibration(repositoryRoots());
  const calibrationBytes = `${JSON.stringify(calibration, null, 2)}\n`;
  const previousProtocol = JSON.parse(await readFile(protocolPath, "utf8")) as Record<string, unknown>;
  const { preparedAt: _preparedAt, ...protocolBase } = previousProtocol;
  const protocol = ChangeReviewEvalProtocolV1Schema.parse({
    ...protocolBase,
    status: "frozen",
    frozenAt: FROZEN_AT,
    riskPolicy: {
      policyId: "review-risk-v1",
      changedLineProtocol: CALIBRATION_SOURCE_DIFF_PROTOCOL_V1,
      threshold: 3,
      lowRiskPredicate: "complete_evidence_and_score_less_than_3",
      incompletePredicate: "incomplete_oversized_binary_submodule_or_unreadable_evidence",
      signals: frozenReviewRiskProtocolSignals(),
    },
    calibration: {
      setId: "change-review-calibration-v1",
      status: "verified_change_snapshots_v1",
      manifestPath: "benchmarks/change-review/calibration-v1.json",
      manifestSha256: createHash("sha256").update(calibrationBytes).digest("hex"),
      fixtureCount: 12,
      labelsAreRoutingCalibrationOnly: true,
    },
    acquisitionProfile: {
      requestSchemaVersion: "inspect-git-changes-v1",
      resultSchemaVersion: "inspect-git-changes-result-v1",
      diffEngine: "diff@9.0.0",
      maxChangedPaths: 200,
      maxSourceBytesPerSide: 262144,
      maxTotalSourceBytes: 4194304,
      maxHunks: 200,
      maxResultBytes: 196608,
    },
  });
  if (process.argv.includes("--write")) {
    await writeFile(calibrationPath, calibrationBytes, "utf8");
    await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`, "utf8");
  } else {
    process.stdout.write(`${JSON.stringify({ calibration, protocol }, null, 2)}\n`);
  }
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
