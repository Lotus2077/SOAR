import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_REVIEW_AUTHORITY_PLAN_ID,
  localReviewAuthorityInternals,
  releaseLocalReviewLiveAuthorityAfterNoDispatch,
  type ClaimedLocalReviewAuthority,
} from "../../src/benchmark/local-review-authority";

const temporaryDirectories: string[] = [];
const revision = "a".repeat(40);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const canonicalTemporaryDirectory = await realpath(tmpdir());
  const root = await mkdtemp(
    path.join(canonicalTemporaryDirectory, "soar-authority-test-"),
  );
  temporaryDirectories.push(root);
  return root;
}

function requireClaimed(
  value: Awaited<ReturnType<typeof localReviewAuthorityInternals.claimAtLedgerRoot>>,
): ClaimedLocalReviewAuthority {
  expect(value.status).toBe("claimed");
  if (value.status !== "claimed") throw new Error("Expected an authority claim.");
  return value;
}

describe("local-review live authority ledger", () => {
  it("derives the production ledger only from the OS home directory", () => {
    expect(
      localReviewAuthorityInternals.fixedLedgerRoot({
        platform: "darwin",
        homeDirectory: "/Users/example",
      }),
    ).toBe(
      "/Users/example/Library/Application Support/soar/evaluation-ledger",
    );
    expect(
      localReviewAuthorityInternals.fixedLedgerRoot({
        platform: "linux",
        homeDirectory: "/home/example",
      }),
    ).toBe("/home/example/.local/state/SOAR/evaluation-ledger");
  });

  it("does not let HOME relocate the production ledger", async () => {
    const originalHome = process.env.HOME;
    const expected = localReviewAuthorityInternals.productionLedgerRoot();
    const attackerControlledHome = path.join(
      await temporaryRoot(),
      "alternate-home",
    );
    try {
      process.env.HOME = attackerControlledHome;
      expect(localReviewAuthorityInternals.productionLedgerRoot()).toBe(
        expected,
      );
      expect(expected).not.toContain(attackerControlledHome);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("uses one plan authority across independent artifact-output labels", async () => {
    const root = await temporaryRoot();
    const stateRoot = path.join(root, "state");
    const soarRoot = path.join(stateRoot, "SOAR");
    const ledgerRoot = path.join(soarRoot, "evaluation-ledger");
    const first = await localReviewAuthorityInternals.claimAtLedgerRoot(
      { runId: "artifact-output-a", implementationRevision: revision },
      { ledgerRoot },
    );
    const second = await localReviewAuthorityInternals.claimAtLedgerRoot(
      { runId: "artifact-output-b", implementationRevision: revision },
      { ledgerRoot },
    );

    expect(first.status).toBe("claimed");
    expect(second).toEqual({
      status: "already_consumed",
      planId: LOCAL_REVIEW_AUTHORITY_PLAN_ID,
    });

    const authorityPath = localReviewAuthorityInternals.authorityFilePath(
      ledgerRoot,
    );
    const record = JSON.parse(await readFile(authorityPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(record).sort()).toEqual([
      "claimedAt",
      "implementationRevision",
      "planId",
      "runId",
      "schemaVersion",
    ]);
    expect(record).toMatchObject({
      planId: LOCAL_REVIEW_AUTHORITY_PLAN_ID,
      runId: "artifact-output-a",
      implementationRevision: revision,
    });
    expect(JSON.stringify(record)).not.toContain(root);
    for (const directory of [stateRoot, soarRoot, ledgerRoot]) {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    }
    expect((await stat(authorityPath)).mode & 0o777).toBe(0o600);
  });

  it("claims beneath a pre-existing canonical Darwin app-state directory", async () => {
    const root = await temporaryRoot();
    const applicationStateRoot = path.join(
      root,
      "Library",
      "Application Support",
      "soar",
    );
    await mkdir(applicationStateRoot, { recursive: true, mode: 0o755 });
    const ledgerRoot = localReviewAuthorityInternals.fixedLedgerRoot({
      platform: "darwin",
      homeDirectory: root,
    });

    const first = requireClaimed(
      await localReviewAuthorityInternals.claimAtLedgerRoot(
        { runId: "darwin-canonical-first", implementationRevision: revision },
        { ledgerRoot },
      ),
    );
    const authorityPath = localReviewAuthorityInternals.authorityFilePath(
      ledgerRoot,
    );
    expect((await stat(ledgerRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(authorityPath)).mode & 0o777).toBe(0o600);

    await releaseLocalReviewLiveAuthorityAfterNoDispatch(first, {
      inferenceAttempts: [],
    });
    const second = await localReviewAuthorityInternals.claimAtLedgerRoot(
      { runId: "darwin-canonical-second", implementationRevision: revision },
      { ledgerRoot },
    );
    expect(second.status).toBe("claimed");
  });

  it("grants exactly one concurrent exclusive claim", async () => {
    const root = await temporaryRoot();
    const ledgerRoot = path.join(root, "ledger");
    const results = await Promise.all([
      localReviewAuthorityInternals.claimAtLedgerRoot(
        { runId: "concurrent-a", implementationRevision: revision },
        { ledgerRoot },
      ),
      localReviewAuthorityInternals.claimAtLedgerRoot(
        { runId: "concurrent-b", implementationRevision: revision },
        { ledgerRoot },
      ),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "already_consumed",
      "claimed",
    ]);
  });

  it("rejects a symlink anywhere in the requested ledger chain", async () => {
    const root = await temporaryRoot();
    const target = path.join(root, "target");
    const linked = path.join(root, "linked");
    await mkdir(target, { mode: 0o700 });
    await symlink(target, linked, "dir");

    await expect(
      localReviewAuthorityInternals.claimAtLedgerRoot(
        { runId: "symlink-chain", implementationRevision: revision },
        { ledgerRoot: path.join(linked, "evaluation-ledger") },
      ),
    ).rejects.toMatchObject({ code: "authority_path_unsafe" });
    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
  });

  it("rejects a symlinked canonical Darwin app-state directory", async () => {
    const root = await temporaryRoot();
    const applicationSupport = path.join(root, "Library", "Application Support");
    const target = path.join(root, "target");
    await mkdir(applicationSupport, { recursive: true });
    await mkdir(target, { mode: 0o700 });
    await symlink(target, path.join(applicationSupport, "soar"), "dir");
    const ledgerRoot = localReviewAuthorityInternals.fixedLedgerRoot({
      platform: "darwin",
      homeDirectory: root,
    });

    await expect(
      localReviewAuthorityInternals.claimAtLedgerRoot(
        { runId: "darwin-symlink", implementationRevision: revision },
        { ledgerRoot },
      ),
    ).rejects.toMatchObject({ code: "authority_path_unsafe" });
  });

  it("releases only an owned definitely-undispatched claim and permits reclaim", async () => {
    const root = await temporaryRoot();
    const ledgerRoot = path.join(root, "ledger");
    const first = requireClaimed(
      await localReviewAuthorityInternals.claimAtLedgerRoot(
        { runId: "preflight-first", implementationRevision: revision },
        { ledgerRoot },
      ),
    );

    for (const inferenceAttempts of [
      [{ finished: { requestDisposition: "sent" as const } }],
      [{ finished: { requestDisposition: "unknown" as const } }],
      [{}],
    ]) {
      await expect(
        releaseLocalReviewLiveAuthorityAfterNoDispatch(first, {
          inferenceAttempts,
        }),
      ).rejects.toMatchObject({ code: "authority_release_not_permitted" });
    }

    await releaseLocalReviewLiveAuthorityAfterNoDispatch(first, {
      inferenceAttempts: [],
    });

    const second = await localReviewAuthorityInternals.claimAtLedgerRoot(
      { runId: "preflight-second", implementationRevision: revision },
      { ledgerRoot },
    );
    expect(second.status).toBe("claimed");
    await expect(
      releaseLocalReviewLiveAuthorityAfterNoDispatch(first, {
        inferenceAttempts: [],
      }),
    ).rejects.toMatchObject({ code: "authority_release_not_permitted" });
  });
});
