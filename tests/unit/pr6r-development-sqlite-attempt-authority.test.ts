import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../src/main/pr6r-development/loopback-attempt-adapter",
  () => {
    const consumedStarts = new WeakSet<object>();
    const consumedFinishes = new WeakSet<object>();
    return {
      consumePr6rPreparedLoopbackAttemptAuthority(
        authority: object,
        input: { applicationRequest: { requestId?: string }; reservationId: string },
      ) {
        if (
          consumedStarts.has(authority) ||
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
        consumedStarts.add(authority);
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
      consumePr6rPreparedLoopbackFinishAuthority(
        authority: object,
        input: { applicationRequest: { requestId?: string }; reservationId: string },
      ) {
        const binding = (
          authority as {
            __testOnlyBinding?: {
              childSessionId: string;
              attemptId: string;
              reservationId: string;
              terminal: {
                terminalOutcome: "completed" | "failed" | "cancelled";
                requestDisposition: "sent" | "unknown";
                stableCode: string;
              };
              events: readonly unknown[];
              sqliteDispatchChain: {
                kind: "pr6r_sqlite_dispatch_chain";
                attemptId: string;
                reservationId: string;
              };
            };
          }
        ).__testOnlyBinding;
        if (
          consumedFinishes.has(authority) ||
          input.applicationRequest.requestId !== "pr6r-a2-request" ||
          input.reservationId !== "pr6r-a2-reservation" ||
          binding === undefined
        ) {
          throw new Error("test prepared-finish authority mismatch");
        }
        consumedFinishes.add(authority);
        return binding;
      },
    };
  },
);

import {
  commitPr6rOpenAttemptRecovery,
  commitPr6rPreReservationCancellation,
  consumePr6rSqliteDispatchAuthority,
  consumePr6rSqliteTerminalReceipt,
  consumePr6rSqliteTerminalReceiptForReconciliation,
  recoverPr6rSqliteTerminalReceipt,
  revalidatePr6rSqliteTerminalWitness,
  type Pr6rSqliteDispatchAuthority,
  type Pr6rSqliteTerminalReceipt,
} from "../../src/main/pr6r-development/sqlite-attempt-authority";
import type { SoarDatabase } from "../../src/main/database";
import type { SessionEventData } from "../../src/shared/session-events";
import {
  createPr6rA2AdmittedSqliteFixture,
  createPr6rA2DeniedSqliteFixture,
  createPr6rA2ImportedSqliteFixture,
  finishPr6rA2FixtureAfterDispatchCancellation,
  finishPr6rA2FixtureSuccessfully,
} from "../helpers/pr6r-a2-sqlite-fixture";

const databases: SoarDatabase[] = [];

function testOnlyPreparedAttemptAuthority() {
  return Object.freeze({
    kind: "pr6r_prepared_loopback_attempt" as const,
    childSessionId: "pr6r-a2-child",
    attemptId: "pr6r-a2-attempt",
    reservationId: "pr6r-a2-reservation",
  });
}

function track<T extends { database: SoarDatabase }>(fixture: T): T {
  databases.push(fixture.database);
  return fixture;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("PR6R SQLite attempt authority", () => {
  it("consumes a genuine admitted authority once after exact persistence revalidation", () => {
    const fixture = track(createPr6rA2AdmittedSqliteFixture());
    const binding = consumePr6rSqliteDispatchAuthority(
      fixture.dispatchAuthority,
      {
        applicationRequest: fixture.applicationRequest,
        reservationId: fixture.reservationId,
      },
    );

    expect(binding).toMatchObject({
      requestId: fixture.applicationRequest.requestId,
      synthesisSessionId: fixture.applicationRequest.synthesisSessionId,
      attemptId: fixture.applicationRequest.attemptId,
      reservationId: fixture.reservationId,
      providerId: "pr6r-loopback-provider-v1",
    });
    expect(binding.projectedMicrousd).toBeGreaterThan(0);
    expect(() =>
      consumePr6rSqliteDispatchAuthority(fixture.dispatchAuthority, {
        applicationRequest: fixture.applicationRequest,
        reservationId: fixture.reservationId,
      }),
    ).toThrow(/already consumed/u);
  });

  it("rejects a generic-valid start batch that differs from the nominal prepared batch", () => {
    expect(() =>
      createPr6rA2AdmittedSqliteFixture({
        testOnlyMutateCommittedStartEvents: (events) =>
          events.map((event): SessionEventData => {
            if (event.type === "assistant.message.started") {
              return {
                ...event,
                payload: { ...event.payload, messageId: "mutated-message" },
              };
            }
            if (event.type === "context.compiled") {
              return {
                ...event,
                payload: { ...event.payload, messageId: "mutated-message" },
              };
            }
            if (event.type === "inference.attempt.started") {
              return {
                ...event,
                payload: { ...event.payload, messageId: "mutated-message" },
              };
            }
            return event;
          }),
      }),
    ).toThrow(/does not match the PR6R request/u);
  });

  it("rejects an admitted authority after its open attempt becomes terminal", () => {
    const fixture = track(createPr6rA2AdmittedSqliteFixture());
    finishPr6rA2FixtureSuccessfully(fixture);

    expect(() =>
      consumePr6rSqliteDispatchAuthority(fixture.dispatchAuthority, {
        applicationRequest: fixture.applicationRequest,
        reservationId: fixture.reservationId,
      }),
    ).toThrow();
  });

  it("rejects an admitted authority after its persisted start event is deleted", () => {
    const fixture = track(createPr6rA2AdmittedSqliteFixture());
    fixture.database.exec("DROP TRIGGER session_events_no_delete");
    fixture.database
      .prepare("DELETE FROM session_events WHERE session_id = ? AND sequence = ?")
      .run(fixture.applicationRequest.synthesisSessionId, 10);

    expect(() =>
      consumePr6rSqliteDispatchAuthority(fixture.dispatchAuthority, {
        applicationRequest: fixture.applicationRequest,
        reservationId: fixture.reservationId,
      }),
    ).toThrow();
  });

  it("consumes exact budget-denial and successful terminal receipts once", () => {
    const denied = track(createPr6rA2DeniedSqliteFixture());
    const deniedBinding = consumePr6rSqliteTerminalReceipt(
      denied.terminalReceipt,
      {
        applicationRequest: denied.applicationRequest,
        reservationId: denied.reservationId,
      },
    );
    expect(deniedBinding).toMatchObject({
      terminalOutcome: "failed",
      requestDisposition: "not_sent",
      stableCode: "loopback.budget_denied",
    });
    expect(deniedBinding.attemptEvidence).toBeUndefined();
    expect(deniedBinding.reservationProjectedMicrousd).toBeUndefined();
    expect(deniedBinding.terminalBudgetEntry).toBeUndefined();

    const admitted = track(createPr6rA2AdmittedSqliteFixture());
    consumePr6rSqliteDispatchAuthority(admitted.dispatchAuthority, {
      applicationRequest: admitted.applicationRequest,
      reservationId: admitted.reservationId,
    });
    const terminalReceipt = finishPr6rA2FixtureSuccessfully(admitted);
    const terminal = consumePr6rSqliteTerminalReceipt(terminalReceipt, {
      applicationRequest: admitted.applicationRequest,
      reservationId: admitted.reservationId,
    });
    expect(terminal).toMatchObject({
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
      reservationProjectedMicrousd: expect.any(Number),
      attemptEvidence: {
        outcome: "succeeded",
        requestDisposition: "sent",
        stableCode: "completed",
        usage: {
          inputTokens: admitted.applicationRequest.estimatedInputTokens,
          outputTokens: 1,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reported: true,
        },
        cost: {
          amountMicrousd:
            admitted.applicationRequest.estimatedInputTokens + 4,
          provenance: "host_pricing_snapshot",
          reservationId: admitted.reservationId,
          costScope: "simulation",
        },
        latencyMs: 1,
        responseBodySha256: "a".repeat(64),
        reviewResultSha256: "b".repeat(64),
      },
      terminalBudgetEntry: {
        rowType: "settlement",
        costScope: "simulation",
        requestDisposition: "sent",
      },
    });
    expect(() =>
      consumePr6rSqliteTerminalReceipt(terminalReceipt, {
        applicationRequest: admitted.applicationRequest,
        reservationId: admitted.reservationId,
      }),
    ).toThrow(/already consumed/u);
  });

  it("rejects a terminal receipt when a durable event is deleted after mint", () => {
    const fixture = track(createPr6rA2DeniedSqliteFixture());
    fixture.database.exec("DROP TRIGGER session_events_no_delete");
    fixture.database
      .prepare("DELETE FROM session_events WHERE session_id = ? AND sequence = ?")
      .run(fixture.applicationRequest.synthesisSessionId, 9);

    expect(() =>
      consumePr6rSqliteTerminalReceipt(fixture.terminalReceipt, {
        applicationRequest: fixture.applicationRequest,
        reservationId: fixture.reservationId,
      }),
    ).toThrow();
  });

  it("revalidates post-dispatch cancellation through its reserved attempt", () => {
    const fixture = track(createPr6rA2AdmittedSqliteFixture());
    consumePr6rSqliteDispatchAuthority(fixture.dispatchAuthority, {
      applicationRequest: fixture.applicationRequest,
      reservationId: fixture.reservationId,
    });
    const receipt = finishPr6rA2FixtureAfterDispatchCancellation(fixture);
    expect(
      consumePr6rSqliteTerminalReceipt(receipt, {
        applicationRequest: fixture.applicationRequest,
        reservationId: fixture.reservationId,
      }),
    ).toMatchObject({
      terminalOutcome: "cancelled",
      requestDisposition: "unknown",
      stableCode: "loopback.cancelled_after_dispatch",
      terminalBudgetEntry: {
        rowType: "settlement",
        costProvenance: "reserved_unknown",
      },
    });
  });

  it("rejects a finish token transplanted from a byte-identical separate ledger", () => {
    const source = track(createPr6rA2AdmittedSqliteFixture());
    const copy = track(createPr6rA2AdmittedSqliteFixture());
    expect(() =>
      finishPr6rA2FixtureSuccessfully(copy, {
        sqliteDispatchChain: source.dispatchAuthority.dispatchChain,
      }),
    ).toThrow(/dispatch chain|terminal budget row/u);
    expect(copy.ledger.listOutstandingReservations()).toEqual([]);
    expect(
      copy.store.replay(copy.applicationRequest.synthesisSessionId)
        .inferenceAttempts.at(-1)?.finished?.outcome,
    ).toBe("succeeded");
  });

  it("revalidates a nominal terminal witness and rejects later deletion", () => {
    const fixture = track(createPr6rA2DeniedSqliteFixture());
    const reconciled = consumePr6rSqliteTerminalReceiptForReconciliation(
      fixture.terminalReceipt,
      {
        applicationRequest: fixture.applicationRequest,
        reservationId: fixture.reservationId,
      },
    );
    expect(reconciled.binding.stableCode).toBe("loopback.budget_denied");
    expect(
      revalidatePr6rSqliteTerminalWitness(reconciled.witness, {
        applicationRequest: fixture.applicationRequest,
        reservationId: fixture.reservationId,
      }).stableCode,
    ).toBe("loopback.budget_denied");
    expect(() =>
      revalidatePr6rSqliteTerminalWitness(
        { ...reconciled.witness },
        {
          applicationRequest: fixture.applicationRequest,
          reservationId: fixture.reservationId,
        },
      ),
    ).toThrow(/forged/u);

    fixture.database.exec("DROP TRIGGER session_events_no_delete");
    fixture.database
      .prepare("DELETE FROM session_events WHERE session_id = ? AND sequence = ?")
      .run(fixture.applicationRequest.synthesisSessionId, 9);
    expect(() =>
      revalidatePr6rSqliteTerminalWitness(reconciled.witness, {
        applicationRequest: fixture.applicationRequest,
        reservationId: fixture.reservationId,
      }),
    ).toThrow();
  });

  it("atomically persists pre-reservation cancellation and recovers exact terminals", () => {
    const cancelled = track(createPr6rA2ImportedSqliteFixture());
    const cancellationReceipt = commitPr6rPreReservationCancellation({
      ledger: cancelled.ledger,
      preparedAttemptAuthority: testOnlyPreparedAttemptAuthority(),
      applicationRequest: cancelled.applicationRequest,
      reservationId: cancelled.reservationId,
      reason: "cancelled by the A2 test",
      eventId: "pr6r-a2-cancelled",
      createdAt: "2026-09-02T00:00:02.000Z",
    });
    expect(
      consumePr6rSqliteTerminalReceipt(cancellationReceipt, {
        applicationRequest: cancelled.applicationRequest,
        reservationId: cancelled.reservationId,
      }),
    ).toMatchObject({
      terminalOutcome: "cancelled",
      requestDisposition: "not_sent",
      stableCode: "loopback.cancelled_before_dispatch",
    });
    expect(cancelled.ledger.listOutstandingReservations()).toEqual([]);

    const rolledBack = track(createPr6rA2ImportedSqliteFixture());
    expect(() =>
      commitPr6rPreReservationCancellation({
        ledger: rolledBack.ledger,
        preparedAttemptAuthority: testOnlyPreparedAttemptAuthority(),
        applicationRequest: rolledBack.applicationRequest,
        reservationId: rolledBack.reservationId,
        reason: "must roll back",
        eventId: "pr6r-a2-imported",
        createdAt: "2026-09-02T00:00:02.000Z",
      }),
    ).toThrow();
    expect(
      rolledBack.store.replay(
        rolledBack.applicationRequest.synthesisSessionId,
      ).status,
    ).toBe("running");
    expect(rolledBack.ledger.listOutstandingReservations()).toEqual([]);

    const denied = track(createPr6rA2DeniedSqliteFixture());
    const recoveredDenial = recoverPr6rSqliteTerminalReceipt({
      ledger: denied.ledger,
      applicationRequest: denied.applicationRequest,
      reservationId: denied.reservationId,
    });
    expect(recoveredDenial.status).toBe("terminal");
    if (recoveredDenial.status !== "terminal") return;
    expect(
      consumePr6rSqliteTerminalReceipt(recoveredDenial.receipt, {
        applicationRequest: denied.applicationRequest,
        reservationId: denied.reservationId,
      }),
    ).toMatchObject({ stableCode: "loopback.budget_denied" });

    const open = track(createPr6rA2AdmittedSqliteFixture());
    expect(
      recoverPr6rSqliteTerminalReceipt({
        ledger: open.ledger,
        applicationRequest: open.applicationRequest,
        reservationId: open.reservationId,
      }),
    ).toEqual({ status: "blocked", reason: "admitted_attempt_open" });
    const recoveredOpenReceipt = commitPr6rOpenAttemptRecovery({
      ledger: open.ledger,
      applicationRequest: open.applicationRequest,
      reservationId: open.reservationId,
      createdAt: "2026-09-02T00:00:03.000Z",
      eventIds: ["pr6r-a2-recovery-finish", "pr6r-a2-recovery-interrupted"],
      terminalLedgerEntryId: "pr6r-a2-recovery-settlement",
    });
    expect(
      consumePr6rSqliteTerminalReceipt(recoveredOpenReceipt, {
        applicationRequest: open.applicationRequest,
        reservationId: open.reservationId,
      }),
    ).toMatchObject({
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.recovery_required",
      terminalBudgetEntry: {
        rowType: "settlement",
        costProvenance: "reserved_unknown",
        requestDisposition: "unknown",
      },
    });
    expect(open.ledger.listOutstandingReservations()).toEqual([]);

    const recoveryRollback = track(createPr6rA2AdmittedSqliteFixture());
    expect(() =>
      commitPr6rOpenAttemptRecovery({
        ledger: recoveryRollback.ledger,
        applicationRequest: recoveryRollback.applicationRequest,
        reservationId: recoveryRollback.reservationId,
        createdAt: "2026-09-02T00:00:03.000Z",
        eventIds: ["pr6r-a2-imported", "pr6r-a2-recovery-rollback"],
        terminalLedgerEntryId: "pr6r-a2-recovery-rollback-settlement",
      }),
    ).toThrow();
    expect(
      recoveryRollback.store.replay(
        recoveryRollback.applicationRequest.synthesisSessionId,
      ).inferenceAttempts.at(-1)?.finished,
    ).toBeUndefined();
    expect(
      recoveryRollback.ledger.listOutstandingReservations({
        sessionId: recoveryRollback.applicationRequest.synthesisSessionId,
      }),
    ).toHaveLength(1);

    const completed = track(createPr6rA2AdmittedSqliteFixture());
    finishPr6rA2FixtureSuccessfully(completed);
    const recoveredCompleted = recoverPr6rSqliteTerminalReceipt({
      ledger: completed.ledger,
      applicationRequest: completed.applicationRequest,
      reservationId: completed.reservationId,
    });
    expect(recoveredCompleted.status).toBe("terminal");
    if (recoveredCompleted.status !== "terminal") return;
    expect(
      consumePr6rSqliteTerminalReceipt(recoveredCompleted.receipt, {
        applicationRequest: completed.applicationRequest,
        reservationId: completed.reservationId,
      }),
    ).toMatchObject({
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    });
  });

  it("rejects structurally forged nominal objects", () => {
    const fixture = track(createPr6rA2AdmittedSqliteFixture());
    const forgedDispatch = {
      ...fixture.dispatchAuthority,
    } as Pr6rSqliteDispatchAuthority;
    expect(() =>
      consumePr6rSqliteDispatchAuthority(forgedDispatch, {
        applicationRequest: fixture.applicationRequest,
        reservationId: fixture.reservationId,
      }),
    ).toThrow(/forged/u);

    const denied = track(createPr6rA2DeniedSqliteFixture());
    const forgedTerminal = {
      ...denied.terminalReceipt,
    } as Pr6rSqliteTerminalReceipt;
    expect(() =>
      consumePr6rSqliteTerminalReceipt(forgedTerminal, {
        applicationRequest: denied.applicationRequest,
        reservationId: denied.reservationId,
      }),
    ).toThrow(/forged/u);
  });
});
