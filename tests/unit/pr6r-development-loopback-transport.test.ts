import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const authorityTestOs = vi.hoisted(() => ({
  homeDirectory: "/soar-pr6r-transport-home-not-configured",
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

import type { SoarDatabase } from "../../src/main/database";
import {
  buildPr6rCloudSlotBinding,
  claimPr6rCampaignAuthority,
  claimPr6rCloudSlot,
  preparePr6rCloudSlotDispatchArm,
} from "../../src/main/pr6r-development/authority-ledger";
import {
  startPr6rLoopbackFixtureServer,
  type Pr6rCapturedFixtureRequest,
  type Pr6rFixtureResponse,
  type Pr6rLoopbackFixtureServer,
  type Pr6rLoopbackHost,
} from "../../src/main/pr6r-development/fixture-server";
import {
  PR6R_MAX_LOOPBACK_RESPONSE_BYTES,
  buildCanonicalPr6rLoopbackResponseBody,
} from "../../src/main/pr6r-development/loopback-response";
import { createPr6rDevelopmentRuntimeAuthorityForBuild } from "../../src/main/pr6r-development/runtime-authority";
import { mintPr6rLoopbackDispatchGrant } from "../../src/main/pr6r-development/loopback-transport-authority";
import {
  PR6R_LOOPBACK_TOTAL_DEADLINE_MS,
  Pr6rLoopbackTransportEvidenceError,
  classifyPr6rCompleteLoopbackResponse,
  consumePr6rLoopbackTransportResult,
  dispatchPr6rLoopbackRequest,
} from "../../src/main/pr6r-development/loopback-transport";
import {
  PR6R_FIXTURE_SNAPSHOT_ID,
  canonicalPr6rJsonV1,
  canonicalPr6rReviewResultSha256,
} from "../../src/shared/pr6r-development-contracts";
import { createPr6rA2AdmittedSqliteFixture } from "../helpers/pr6r-a2-sqlite-fixture";

const REVISION = "a".repeat(40);
const homes: string[] = [];
const servers: Pr6rLoopbackFixtureServer[] = [];
const databases: SoarDatabase[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

function reviewResult() {
  return {
    schemaVersion: "change-review-result-v1" as const,
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    summary: "The bounded synthetic response is valid.",
    conclusion: "no_blocking_findings" as const,
    evidenceSetId: "e".repeat(64),
    omissions: [],
    findings: [],
  };
}

type ReadyTransport = Awaited<ReturnType<typeof createReadyTransport>>;

async function createReadyTransport(input: {
  host?: Pr6rLoopbackHost;
  maxRequests?: number;
  respond: (
    request: Pr6rCapturedFixtureRequest,
    ready: {
      applicationRequest: ReturnType<
        typeof createPr6rA2AdmittedSqliteFixture
      >["applicationRequest"];
    },
  ) => Pr6rFixtureResponse | Promise<Pr6rFixtureResponse>;
}) {
  let applicationRequest:
    | ReturnType<
        typeof createPr6rA2AdmittedSqliteFixture
      >["applicationRequest"]
    | undefined;
  const fixture = await startPr6rLoopbackFixtureServer({
    host: input.host,
    maxRequests: input.maxRequests,
    respond: (request) => {
      if (applicationRequest === undefined) {
        throw new Error("Transport fixture was observed before setup completed");
      }
      return input.respond(request, { applicationRequest });
    },
  });
  servers.push(fixture);
  const sqlite = createPr6rA2AdmittedSqliteFixture({
    origin: fixture.listenerCapability.origin,
  });
  databases.push(sqlite.database);
  applicationRequest = sqlite.applicationRequest;

  const home = await realpath(
    await mkdtemp(path.join(tmpdir(), "soar-pr6r-loopback-transport-")),
  );
  homes.push(home);
  authorityTestOs.homeDirectory = home;
  const campaign = await claimPr6rCampaignAuthority({
    implementationRevision: REVISION,
  });
  const slot = await claimPr6rCloudSlot(
    campaign,
    buildPr6rCloudSlotBinding({
      applicationRequest: sqlite.applicationRequest,
      reservationId: sqlite.reservationId,
    }),
  );
  if (slot.status !== "claimed") throw new Error("Expected a fresh OS slot");
  const arm = await preparePr6rCloudSlotDispatchArm(slot);
  const grant = mintPr6rLoopbackDispatchGrant({
    runtimeAuthority: createPr6rDevelopmentRuntimeAuthorityForBuild(),
    listenerCapability: fixture.listenerCapability,
    osDispatchArm: arm,
    sqliteDispatchAuthority: sqlite.dispatchAuthority,
    applicationRequest: sqlite.applicationRequest,
    reservationId: sqlite.reservationId,
  });
  return { fixture, sqlite, grant };
}

function validResponseBody(
  applicationRequest: ReadyTransport["sqlite"]["applicationRequest"],
): Uint8Array {
  return buildCanonicalPr6rLoopbackResponseBody({
    requestId: applicationRequest.requestId,
    content: canonicalPr6rJsonV1(reviewResult()),
    promptTokens: applicationRequest.estimatedInputTokens,
    completionTokens: 17,
    cachedTokens: 3,
    reasoningTokens: 5,
  });
}

function dispatch(ready: ReadyTransport, signal?: AbortSignal) {
  return dispatchPr6rLoopbackRequest({
    grant: ready.grant,
    applicationRequest: ready.sqlite.applicationRequest,
    signal,
  });
}

function rawHeaderMap(rawHeaders: readonly string[]): Map<string, string[]> {
  const headers = new Map<string, string[]>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]?.toLowerCase();
    const value = rawHeaders[index + 1];
    if (name === undefined || value === undefined) continue;
    headers.set(name, [...(headers.get(name) ?? []), value]);
  }
  return headers;
}

describe("PR6R direct loopback transport", () => {
  it("retains the complete bounded body hash for unexpected parser failures", () => {
    const sqlite = createPr6rA2AdmittedSqliteFixture();
    databases.push(sqlite.database);
    const body = Buffer.from("{}", "utf8");
    expect(
      classifyPr6rCompleteLoopbackResponse({
        applicationRequest: sqlite.applicationRequest,
        statusCode: 200,
        rawHeaders: [
          "Content-Type",
          "application/json",
          "Content-Length",
          String(body.byteLength),
        ],
        rawTrailers: [],
        informationalResponseCount: 0,
        body,
        durationMs: 1,
        parseResponse: () => {
          throw new Error("forced unexpected parser failure");
        },
      }),
    ).toEqual({
      outcome: "failed",
      requestDisposition: "sent",
      stableCode: "loopback.invalid_response",
      durationMs: 1,
      responseBodySha256: createHash("sha256").update(body).digest("hex"),
    });
  });

  for (const host of ["127.0.0.1", "::1"] as const) {
    it(`sends one exact ${host} request and returns nominal parsed evidence`, async () => {
      const ready = await createReadyTransport({
        host,
        respond: (_request, state) => ({
          body: validResponseBody(state.applicationRequest),
        }),
      });
      const result = await dispatch(ready);
      expect(result).toMatchObject({
        outcome: "succeeded",
        requestDisposition: "sent",
        stableCode: "completed",
        response: {
          reviewResult: reviewResult(),
          usage: {
            inputTokens: ready.sqlite.applicationRequest.estimatedInputTokens,
            cacheReadTokens: 3,
            cacheWriteTokens: 0,
            reasoningTokens: 5,
            outputTokens: 12,
          },
          reviewResultSha256: canonicalPr6rReviewResultSha256(reviewResult()),
        },
      });
      expect(ready.fixture.requests).toHaveLength(1);
      expect(ready.fixture.observedRequestCount).toBe(1);
      const captured = ready.fixture.requests[0]!;
      expect(captured.method).toBe("POST");
      expect(captured.path).toBe(ready.sqlite.applicationRequest.path);
      expect(Buffer.from(captured.body).toString("utf8")).toBe(
        ready.sqlite.applicationRequest.canonicalBodyUtf8,
      );
      expect(createHash("sha256").update(captured.body).digest("hex")).toBe(
        ready.sqlite.applicationRequest.canonicalBodySha256,
      );
      const headers = rawHeaderMap(captured.rawHeaders);
      expect([...headers.keys()].sort()).toEqual([
        "accept",
        "connection",
        "content-length",
        "content-type",
        "host",
      ]);
      expect(headers).toEqual(
        new Map([
          ["accept", ["application/json"]],
          ["connection", ["close"]],
          [
            "content-length",
            [String(ready.sqlite.applicationRequest.canonicalBodyByteLength)],
          ],
          ["content-type", ["application/json"]],
          [
            "host",
            [
              host === "::1"
                ? `[::1]:${ready.fixture.listenerCapability.port}`
                : `127.0.0.1:${ready.fixture.listenerCapability.port}`,
            ],
          ],
        ]),
      );

      expect(() =>
        consumePr6rLoopbackTransportResult(
          { ...result },
          {
            applicationRequest: ready.sqlite.applicationRequest,
            reservationId: ready.sqlite.reservationId,
          },
        ),
      ).toThrowError(Pr6rLoopbackTransportEvidenceError);
      expect(
        consumePr6rLoopbackTransportResult(result, {
          applicationRequest: ready.sqlite.applicationRequest,
          reservationId: ready.sqlite.reservationId,
        }),
      ).toMatchObject({ result, reservationId: ready.sqlite.reservationId });
      expect(() =>
        consumePr6rLoopbackTransportResult(result, {
          applicationRequest: ready.sqlite.applicationRequest,
          reservationId: ready.sqlite.reservationId,
        }),
      ).toThrow("loopback_transport_evidence_consumed");
    });
  }

  it("does not follow or retry a redirect", async () => {
    const ready = await createReadyTransport({
      maxRequests: 2,
      respond: () => ({ statusCode: 302, body: new Uint8Array() }),
    });
    await expect(dispatch(ready)).resolves.toMatchObject({
      outcome: "failed",
      requestDisposition: "sent",
      stableCode: "loopback.http_error",
      responseBodySha256: createHash("sha256").update("").digest("hex"),
    });
    expect(ready.fixture.requests).toHaveLength(1);
    expect(ready.fixture.observedRequestCount).toBe(1);
  });

  it("classifies complete malformed and oversized bodies without retaining raw bytes", async () => {
    const malformed = await createReadyTransport({
      respond: () => ({ body: Buffer.from("{}") }),
    });
    const malformedResult = await dispatch(malformed);
    expect(malformedResult).toMatchObject({
      outcome: "failed",
      requestDisposition: "sent",
      stableCode: "loopback.protocol_invalid",
      responseBodySha256: createHash("sha256").update("{}").digest("hex"),
    });
    expect(JSON.stringify(malformedResult)).not.toContain("rawHeaders");

    const oversized = await createReadyTransport({
      respond: () => ({
        body: Buffer.alloc(PR6R_MAX_LOOPBACK_RESPONSE_BYTES + 1, 0x20),
      }),
    });
    const oversizedResult = await dispatch(oversized);
    expect(oversizedResult).toMatchObject({
      outcome: "failed",
      requestDisposition: "sent",
      stableCode: "loopback.response_too_large",
    });
    expect(oversizedResult).not.toHaveProperty("responseBodySha256");
  });

  it("treats incomplete declared framing and a closed stalled socket as unknown", async () => {
    const incomplete = await createReadyTransport({
      respond: (_request, state) => {
        const body = validResponseBody(state.applicationRequest);
        return {
          headers: [
            ["Content-Type", "application/json"],
            ["Content-Length", String(body.byteLength + 1)],
            ["Connection", "close"],
          ],
          body,
        };
      },
    });
    const incompleteResult = await dispatch(incomplete);
    expect(incompleteResult).toMatchObject({
      outcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.dispatch_unknown",
    });
    expect(incompleteResult).not.toHaveProperty("responseBodySha256");

    let observed!: () => void;
    const requestObserved = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const stalled = await createReadyTransport({
      respond: (_request, state) => {
        observed();
        return {
          body: validResponseBody(state.applicationRequest),
          stallAfterHeaders: true,
        };
      },
    });
    const stalledResult = dispatch(stalled);
    await requestObserved;
    await stalled.fixture.close();
    const closedStallResult = await stalledResult;
    expect(closedStallResult).toMatchObject({
      outcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.dispatch_unknown",
    });
    expect(closedStallResult).not.toHaveProperty("responseBodySha256");
  });

  it("brands a socket failure that occurs before any response", async () => {
    let closeFixture!: () => Promise<void>;
    const ready = await createReadyTransport({
      respond: async () => {
        await closeFixture();
        return { body: Buffer.from("{}") };
      },
    });
    closeFixture = () => ready.fixture.close();
    const result = await dispatch(ready);
    expect(result).toMatchObject({
      outcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.dispatch_unknown",
    });
    expect(
      consumePr6rLoopbackTransportResult(result, {
        applicationRequest: ready.sqlite.applicationRequest,
        reservationId: ready.sqlite.reservationId,
      }),
    ).toMatchObject({ result, reservationId: ready.sqlite.reservationId });
    expect(() =>
      consumePr6rLoopbackTransportResult(result, {
        applicationRequest: ready.sqlite.applicationRequest,
        reservationId: ready.sqlite.reservationId,
      }),
    ).toThrow("loopback_transport_evidence_consumed");
  });

  it("keeps headers-then-stall timeout and cancellation unknown with no body hash", async () => {
    let observed!: () => void;
    const requestObserved = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const timeoutReady = await createReadyTransport({
      respond: (_request, state) => {
        observed();
        return {
          body: validResponseBody(state.applicationRequest),
          stallAfterHeaders: true,
          bodyPrefixBytes: 17,
        };
      },
    });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const timeoutResult = dispatch(timeoutReady);
    await requestObserved;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(PR6R_LOOPBACK_TOTAL_DEADLINE_MS);
    const timedOut = await timeoutResult;
    expect(timedOut).toMatchObject({
      outcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.timeout",
    });
    expect(Number.isSafeInteger(timedOut.durationMs)).toBe(true);
    expect(timedOut.durationMs).toBeGreaterThanOrEqual(0);
    expect(timedOut).not.toHaveProperty("responseBodySha256");
    vi.useRealTimers();

    let cancelObserved!: () => void;
    const cancellationObserved = new Promise<void>((resolve) => {
      cancelObserved = resolve;
    });
    const cancellationReady = await createReadyTransport({
      respond: (_request, state) => {
        cancelObserved();
        return {
          body: validResponseBody(state.applicationRequest),
          stallAfterHeaders: true,
        };
      },
    });
    const controller = new AbortController();
    const cancellationResult = dispatch(cancellationReady, controller.signal);
    await cancellationObserved;
    controller.abort();
    const cancelled = await cancellationResult;
    expect(cancelled).toMatchObject({
      outcome: "cancelled",
      requestDisposition: "unknown",
      stableCode: "loopback.cancelled_after_dispatch",
    });
    expect(cancelled).not.toHaveProperty("responseBodySha256");
  });

  it("does not consume genuine result evidence on a mismatched binding", async () => {
    const ready = await createReadyTransport({
      respond: (_request, state) => ({
        body: validResponseBody(state.applicationRequest),
      }),
    });
    const result = await dispatch(ready);
    expect(() =>
      consumePr6rLoopbackTransportResult(result, {
        applicationRequest: ready.sqlite.applicationRequest,
        reservationId: "different-reservation",
      }),
    ).toThrow("loopback_transport_evidence_mismatch");
    expect(() =>
      consumePr6rLoopbackTransportResult(result, {
        applicationRequest: ready.sqlite.applicationRequest,
        reservationId: ready.sqlite.reservationId,
      }),
    ).not.toThrow();
  });
});
