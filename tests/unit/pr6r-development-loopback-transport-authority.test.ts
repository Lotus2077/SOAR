import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const authorityTestOs = vi.hoisted(() => ({
  homeDirectory: "/soar-pr6r-transport-authority-home-not-configured",
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    userInfo: (...args: Parameters<typeof actual.userInfo>) => ({
      ...actual.userInfo(...args),
      homedir: authorityTestOs.homeDirectory,
    }),
  };
});

vi.mock("../../src/main/pr6r-development/loopback-attempt-adapter", () => {
  const consumed = new WeakSet<object>();
  return {
    consumePr6rPreparedLoopbackAttemptAuthority(
      authority: object,
      input: {
        applicationRequest: { requestId?: string };
        reservationId: string;
      },
    ) {
      if (
        consumed.has(authority) ||
        input.applicationRequest.requestId !== "pr6r-a2-request" ||
        input.reservationId !== "pr6r-a2-reservation"
      ) {
        throw new Error("test prepared-attempt authority mismatch");
      }
      const selectedStart = (
        authority as {
          __testOnlySelectedStart?: {
            resolution: unknown;
            events: readonly unknown[];
          };
        }
      ).__testOnlySelectedStart;
      consumed.add(authority);
      return {
        childSessionId: "pr6r-a2-child",
        expectedSequence: 4,
        createdAt: "2026-09-02T00:00:02.000Z",
        campaignId: "pr6r-cal-007-v1",
        attemptId: "pr6r-a2-attempt",
        providerId: "pr6r-loopback-provider-v1",
        pricingSnapshotId: "pr6r-loopback-simulation-pricing-v1",
        costScope: "simulation",
        cloudEgressAdmissionId: "pr6r-a2-egress",
        reservationId: "pr6r-a2-reservation",
        ...(selectedStart === undefined ? {} : { selectedStart }),
      };
    },
  };
});

import {
  buildPr6rCloudSlotBinding,
  claimPr6rCampaignAuthority,
  claimPr6rCloudSlot,
  preparePr6rCloudSlotDispatchArm,
  terminalizePr6rCloudSlot,
} from "../../src/main/pr6r-development/authority-ledger";
import {
  startPr6rLoopbackFixtureServer,
  type Pr6rLoopbackFixtureServer,
} from "../../src/main/pr6r-development/fixture-server";
import { createPr6rDevelopmentRuntimeAuthorityForBuild } from "../../src/main/pr6r-development/runtime-authority";
import {
  Pr6rLoopbackTransportAuthorityError,
  consumePr6rLoopbackDispatchGrant,
  mintPr6rLoopbackDispatchGrant,
  type Pr6rLoopbackDispatchGrant,
} from "../../src/main/pr6r-development/loopback-transport-authority";
import type { SoarDatabase } from "../../src/main/database";
import { createPr6rA2AdmittedSqliteFixture } from "../helpers/pr6r-a2-sqlite-fixture";

const REVISION = "a".repeat(40);
const homes: string[] = [];
const servers: Pr6rLoopbackFixtureServer[] = [];
const databases: SoarDatabase[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

async function createReadyAuthorities() {
  const fixture = await startPr6rLoopbackFixtureServer({
    respond: () => ({ body: Buffer.from("{}") }),
  });
  servers.push(fixture);
  const sqlite = createPr6rA2AdmittedSqliteFixture({
    origin: fixture.listenerCapability.origin,
  });
  databases.push(sqlite.database);
  const home = await realpath(
    await mkdtemp(path.join(tmpdir(), "soar-pr6r-transport-authority-")),
  );
  homes.push(home);
  authorityTestOs.homeDirectory = home;
  const campaign = await claimPr6rCampaignAuthority({
    implementationRevision: REVISION,
  });
  const binding = buildPr6rCloudSlotBinding({
    applicationRequest: sqlite.applicationRequest,
    reservationId: sqlite.reservationId,
  });
  const slot = await claimPr6rCloudSlot(campaign, binding);
  if (slot.status !== "claimed") throw new Error("Expected a fresh OS slot");
  const arm = await preparePr6rCloudSlotDispatchArm(slot);
  const runtimeAuthority = createPr6rDevelopmentRuntimeAuthorityForBuild();
  return { fixture, sqlite, slot, arm, runtimeAuthority };
}

function mint(
  ready: Awaited<ReturnType<typeof createReadyAuthorities>>,
): Pr6rLoopbackDispatchGrant {
  return mintPr6rLoopbackDispatchGrant({
    runtimeAuthority: ready.runtimeAuthority,
    listenerCapability: ready.fixture.listenerCapability,
    osDispatchArm: ready.arm,
    sqliteDispatchAuthority: ready.sqlite.dispatchAuthority,
    applicationRequest: ready.sqlite.applicationRequest,
    reservationId: ready.sqlite.reservationId,
  });
}

describe("PR6R loopback transport authority", () => {
  it("mints one exact grant from genuine runtime, listener, OS, and SQLite authority", async () => {
    const ready = await createReadyAuthorities();
    const grant = mint(ready);
    expect(grant).toMatchObject({
      status: "ready",
      requestId: ready.sqlite.applicationRequest.requestId,
      slotId: "cloud_synthesis",
      reservationId: ready.sqlite.reservationId,
    });
    expect(
      consumePr6rLoopbackDispatchGrant(
        grant,
        ready.sqlite.applicationRequest,
      ),
    ).toMatchObject({
      applicationRequest: ready.sqlite.applicationRequest,
      reservationId: ready.sqlite.reservationId,
      host: "127.0.0.1",
      port: ready.fixture.listenerCapability.port,
    });
    expect(() =>
      consumePr6rLoopbackDispatchGrant(grant, ready.sqlite.applicationRequest),
    ).toThrow("loopback_authority_consumed");
    expect(() =>
      consumePr6rLoopbackDispatchGrant(
        { ...grant },
        ready.sqlite.applicationRequest,
      ),
    ).toThrow("loopback_authority_invalid");
  });

  it("allows exactly one concurrent grant mint and excludes raw terminalization", async () => {
    const ready = await createReadyAuthorities();
    const attempts = await Promise.allSettled([
      Promise.resolve().then(() => mint(ready)),
      Promise.resolve().then(() => mint(ready)),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    await expect(
      terminalizePr6rCloudSlot(ready.slot, {
        terminalOutcome: "completed",
        requestDisposition: "sent",
        stableCode: "completed",
      }),
    ).rejects.toMatchObject({ code: "authority_slot_consumed" });
  });

  it("does not burn authorities for a forged runtime or mismatched listener", async () => {
    const ready = await createReadyAuthorities();
    const other = await startPr6rLoopbackFixtureServer({
      respond: () => ({ body: Buffer.from("{}") }),
    });
    servers.push(other);
    expect(() =>
      mintPr6rLoopbackDispatchGrant({
        runtimeAuthority: { ...ready.runtimeAuthority },
        listenerCapability: ready.fixture.listenerCapability,
        osDispatchArm: ready.arm,
        sqliteDispatchAuthority: ready.sqlite.dispatchAuthority,
        applicationRequest: ready.sqlite.applicationRequest,
        reservationId: ready.sqlite.reservationId,
      }),
    ).toThrowError(Pr6rLoopbackTransportAuthorityError);
    expect(() =>
      mintPr6rLoopbackDispatchGrant({
        runtimeAuthority: ready.runtimeAuthority,
        listenerCapability: other.listenerCapability,
        osDispatchArm: ready.arm,
        sqliteDispatchAuthority: ready.sqlite.dispatchAuthority,
        applicationRequest: ready.sqlite.applicationRequest,
        reservationId: ready.sqlite.reservationId,
      }),
    ).toThrow("loopback_authority_mismatch");
    expect(mint(ready)).toMatchObject({ status: "ready" });
  });

  it("burns a grant on request mismatch and rejects a listener closed after mint", async () => {
    const mismatched = await createReadyAuthorities();
    const mismatchGrant = mint(mismatched);
    const alteredRequest = {
      ...mismatched.sqlite.applicationRequest,
      requestId: "different-request-id",
    };
    expect(() =>
      consumePr6rLoopbackDispatchGrant(mismatchGrant, alteredRequest),
    ).toThrow("loopback_authority_mismatch");
    expect(() =>
      consumePr6rLoopbackDispatchGrant(
        mismatchGrant,
        mismatched.sqlite.applicationRequest,
      ),
    ).toThrow("loopback_authority_consumed");

    const stale = await createReadyAuthorities();
    const staleGrant = mint(stale);
    await stale.fixture.close();
    expect(() =>
      consumePr6rLoopbackDispatchGrant(
        staleGrant,
        stale.sqlite.applicationRequest,
      ),
    ).toThrow("loopback_authority_invalid");
  });
});
