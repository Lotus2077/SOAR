import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const authorityTestOs = vi.hoisted(() => ({
  homeDirectory: "/soar-pr6r-authority-test-home-not-configured",
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

import { reviewResultV1ResponseFormat } from "../../src/shared/review-result-contract";
import {
  PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS,
  PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS,
  PR6R_MODEL_SLUG,
  PR6R_REQUESTED_OUTPUT_TOKENS,
  PR6R_SYNTHETIC_UPSTREAM_SLUG,
  buildPr6rCommonCheckpointV1,
  sealCloudApplicationRequestV1,
} from "../../src/shared/pr6r-development-contracts";
import {
  buildPr6rOsAuthorityClaimFromLedger,
  buildPr6rCloudSlotBinding,
  claimPr6rCampaignAuthority,
  claimPr6rCloudSlot as claimPr6rCloudSlotProduction,
  claimPr6rLocalFallback as claimPr6rLocalFallbackProduction,
  inspectPr6rAuthorityLedger as inspectPr6rAuthorityLedgerProduction,
  recoverPr6rCloudSlot,
  recoverPr6rFailedTerminalForFallback,
  terminalizePr6rCloudSlot as terminalizePr6rCloudSlotProduction,
  terminalizeRecoveredPr6rCloudSlot as terminalizeRecoveredPr6rCloudSlotProduction,
  type Pr6rCloudSlotBinding,
  type Pr6rCampaignAuthority,
} from "../../src/main/pr6r-development/authority-ledger";

const REVISION = "a".repeat(40);
const roots: string[] = [];
let activeAuthorityTestClockUsers = 0;
let activeAuthorityTestClockIso: string | undefined;
const PACKET_UTF8 = '{"fixture":"cal-007","scope":"public"}';
const PARENT_SESSION_ID = "pr6r-parent-session";

interface SlotBindingOverrides {
  requestId?: string;
  synthesisSessionId?: string;
  attemptId?: string;
  reservationId?: string;
  origin?: string;
  packetUtf8?: string;
  body?: ReturnType<typeof applicationBody>;
}

function applicationBody() {
  return {
    model: PR6R_MODEL_SLUG,
    messages: [
      { role: "system" as const, content: "Review the frozen public change." },
      { role: "user" as const, content: "Return the strict review result." },
    ],
    max_completion_tokens: PR6R_REQUESTED_OUTPUT_TOKENS,
    temperature: 0,
    stream: false,
    response_format: reviewResultV1ResponseFormat(),
    provider: {
      only: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
      order: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
      allow_fallbacks: false,
      require_parameters: true,
    },
  };
}

function slotBinding(
  slotId: Pr6rCloudSlotBinding["slotId"],
  overrides: SlotBindingOverrides = {},
): Pr6rCloudSlotBinding {
  const digit = slotId === "cloud_synthesis" ? "c" : "d";
  const requestId = overrides.requestId ?? `request-${slotId}`;
  const synthesisSessionId =
    overrides.synthesisSessionId ?? `session-${slotId}`;
  const attemptId = overrides.attemptId ?? `attempt-${slotId}`;
  const body = overrides.body ?? applicationBody();
  const packetUtf8 = overrides.packetUtf8 ?? PACKET_UTF8;
  const checkpoint = buildPr6rCommonCheckpointV1({
    parentSessionId: PARENT_SESSION_ID,
    packetUtf8,
    semanticMessages: body.messages,
  });
  return buildPr6rCloudSlotBinding({
    applicationRequest: sealCloudApplicationRequestV1({
      requestId,
      parentSessionId: PARENT_SESSION_ID,
      synthesisSessionId,
      attemptId,
      slotId,
      commonCheckpoint: checkpoint,
      packetUtf8,
      origin: overrides.origin ?? "http://127.0.0.1:43123",
      body,
    }),
    reservationId: overrides.reservationId ?? `reservation-${digit}`,
  });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function ledgerRoot(): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "soar-pr6r-authority-"));
  roots.push(home);
  return productionLedgerRootForHome(await realpath(home));
}

function productionLedgerRootForHome(homeDirectory: string): string {
  return process.platform === "darwin"
    ? path.join(
        homeDirectory,
        "Library",
        "Application Support",
        "ai.soar.shared-authority",
        "pr6r-v1",
      )
    : path.join(
        homeDirectory,
        ".local",
        "state",
        "SOAR",
        "shared-authority",
        "pr6r-v1",
      );
}

function homeForProductionLedgerRoot(ledgerRoot: string): string {
  const segmentCount = process.platform === "darwin" ? 4 : 5;
  let homeDirectory = ledgerRoot;
  for (let index = 0; index < segmentCount; index += 1) {
    homeDirectory = path.dirname(homeDirectory);
  }
  if (productionLedgerRootForHome(homeDirectory) !== ledgerRoot) {
    throw new Error("Test ledger root is not a fixed production-layout root.");
  }
  return homeDirectory;
}

const pr6rAuthorityTestAccess = Object.freeze({
  async claimAtLedgerRoot(input: {
    implementationRevision: string;
    ledgerRoot: string;
    now?: () => string;
  }) {
    authorityTestOs.homeDirectory = homeForProductionLedgerRoot(
      input.ledgerRoot,
    );
    if (input.now === undefined) {
      return claimPr6rCampaignAuthority({
        implementationRevision: input.implementationRevision,
      });
    }
    return withAuthorityTestTime(input.now, () =>
      claimPr6rCampaignAuthority({
        implementationRevision: input.implementationRevision,
      }),
    );
  },
});

async function withAuthorityTestTime<T>(
  now: (() => string) | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (now === undefined) return operation();
  const instant = new Date(now());
  const instantIso = instant.toISOString();
  if (activeAuthorityTestClockUsers === 0) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instant);
    activeAuthorityTestClockIso = instantIso;
  } else if (activeAuthorityTestClockIso !== instantIso) {
    throw new Error("Concurrent authority test clocks must use one instant.");
  }
  activeAuthorityTestClockUsers += 1;
  try {
    return await operation();
  } finally {
    activeAuthorityTestClockUsers -= 1;
    if (activeAuthorityTestClockUsers === 0) {
      activeAuthorityTestClockIso = undefined;
      vi.useRealTimers();
    }
  }
}

function claimPr6rCloudSlot(
  authority: Parameters<typeof claimPr6rCloudSlotProduction>[0],
  binding: Parameters<typeof claimPr6rCloudSlotProduction>[1],
  options: { now?: () => string } = {},
) {
  return withAuthorityTestTime(options.now, () =>
    claimPr6rCloudSlotProduction(authority, binding),
  );
}

function terminalizePr6rCloudSlot(
  authority: Parameters<typeof terminalizePr6rCloudSlotProduction>[0],
  input: Parameters<typeof terminalizePr6rCloudSlotProduction>[1] & {
    now?: () => string;
  },
) {
  const { now, ...terminal } = input;
  return withAuthorityTestTime(now, () =>
    terminalizePr6rCloudSlotProduction(authority, terminal),
  );
}

function terminalizeRecoveredPr6rCloudSlot(
  authority: Parameters<
    typeof terminalizeRecoveredPr6rCloudSlotProduction
  >[0],
  options: { now?: () => string } = {},
) {
  return withAuthorityTestTime(options.now, () =>
    terminalizeRecoveredPr6rCloudSlotProduction(authority),
  );
}

function claimPr6rLocalFallback(
  authority: Parameters<typeof claimPr6rLocalFallbackProduction>[0],
  options: { now?: () => string } = {},
) {
  return withAuthorityTestTime(options.now, () =>
    claimPr6rLocalFallbackProduction(authority),
  );
}

function inspectPr6rAuthorityLedger(ledgerRoot?: string) {
  if (ledgerRoot !== undefined) {
    authorityTestOs.homeDirectory = homeForProductionLedgerRoot(ledgerRoot);
  }
  return inspectPr6rAuthorityLedgerProduction();
}

function recordGuardPath(root: string, fileName: string): string {
  return path.join(
    path.dirname(root),
    `${path.basename(root)}.pr6r-record.${fileName}.guard`,
  );
}

describe("PR6R development authority ledger", () => {
  it("accepts every canonical cancellation reason under its matching disposition", async () => {
    const cancellationCases = [
      ["not_sent", PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS],
      ["unknown", PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS],
    ] as const;

    for (const [requestDisposition, stableCodes] of cancellationCases) {
      for (const stableCode of stableCodes) {
        const root = await ledgerRoot();
        const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
          implementationRevision: REVISION,
          ledgerRoot: root,
        });
        const claim = await claimPr6rCloudSlot(
          authority,
          slotBinding("cloud_synthesis"),
        );
        if (claim.status !== "claimed") {
          throw new Error("slot must be claimable");
        }
        await expect(
          terminalizePr6rCloudSlot(claim, {
            terminalOutcome: "cancelled",
            requestDisposition,
            stableCode,
          }),
        ).resolves.toMatchObject({
          terminalOutcome: "cancelled",
          requestDisposition,
          stableCode,
        });
      }
    }
  });

  it("projects the persisted campaign and guard identities only from a live ledger handle", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const claim = await buildPr6rOsAuthorityClaimFromLedger(authority);
    expect(claim).toMatchObject({
      implementationRevision: REVISION,
      claimedAt: "2026-09-02T00:00:00.000Z",
      ledgerCampaignRecordSha256: authority.recordSha256,
      ledgerGuardRecordSha256: authority.guardRecordSha256,
    });
    await expect(
      buildPr6rOsAuthorityClaimFromLedger({ ...authority }),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
  });

  it("durably claims one campaign and each loopback slot at most once", async () => {
    const root = await ledgerRoot();
    const first = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    expect(first.status).toBe("claimed");
    const [rootState, guardState, campaignState] = await Promise.all([
      stat(root),
      stat(`${root}.pr6r-authority.guard.json`),
      stat(path.join(root, "campaign.json")),
    ]);
    expect(rootState.mode & 0o777).toBe(0o700);
    expect(guardState.mode & 0o777).toBe(0o600);
    expect(campaignState.mode & 0o777).toBe(0o600);
    const resumed = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:01.000Z",
    });
    expect(resumed).toMatchObject({
      status: "resumed",
      claimedAt: "2026-09-02T00:00:00.000Z",
    });

    const [left, right] = await Promise.all([
      claimPr6rCloudSlot(first, slotBinding("cloud_synthesis"), {
        now: () => "2026-09-02T00:00:02.000Z",
      }),
      claimPr6rCloudSlot(resumed, slotBinding("cloud_synthesis"), {
        now: () => "2026-09-02T00:00:02.000Z",
      }),
    ]);
    expect([left.status, right.status].sort()).toEqual([
      "already_consumed",
      "claimed",
    ]);
    const claimed =
      left.status === "claimed"
        ? left
        : right.status === "claimed"
          ? right
          : undefined;
    expect(claimed).toBeDefined();
    if (claimed === undefined) throw new Error("one slot claim must win");
    await terminalizePr6rCloudSlot(claimed, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
      now: () => "2026-09-02T00:00:03.000Z",
    });

    const snapshot = await inspectPr6rAuthorityLedger(root);
    expect(snapshot?.slots.cloud_synthesis).toMatchObject({
      claim: { slotId: "cloud_synthesis" },
      terminal: {
        requestDisposition: "sent",
        stableCode: "completed",
      },
    });
  });

  it("does not restore authority when unrelated app state is deleted", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    expect(
      await claimPr6rCloudSlot(
        authority,
        slotBinding("cloud_synthesis"),
      ),
    ).toMatchObject({ status: "claimed" });

    const unrelated = await mkdtemp(path.join(tmpdir(), "soar-pr6r-app-state-"));
    roots.push(unrelated);
    await writeFile(path.join(unrelated, "app.sqlite"), "not the authority\n");
    await rm(unrelated, { recursive: true, force: true });
    const resumed = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    expect(
      await claimPr6rCloudSlot(
        resumed,
        slotBinding("cloud_synthesis"),
      ),
    ).toMatchObject({ status: "already_consumed" });
  });

  it("fails closed when the ledger directory is deleted but its durable guard remains", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    expect(
      await claimPr6rCloudSlot(authority, slotBinding("cloud_synthesis")),
    ).toMatchObject({ status: "claimed" });

    await rm(root, { recursive: true });
    expect(await readFile(`${root}.pr6r-authority.guard.json`, "utf8")).toContain(
      '"recordType":"authority_guard"',
    );
    await expect(inspectPr6rAuthorityLedger(root)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: REVISION,
        ledgerRoot: root,
      }),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("does not recreate a slot after one copy of its claim record is deleted", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const binding = slotBinding("cloud_synthesis");
    expect(await claimPr6rCloudSlot(authority, binding)).toMatchObject({
      status: "claimed",
    });
    await rm(path.join(root, "slot.cloud_synthesis.claimed.json"));
    expect(
      await readFile(
        recordGuardPath(root, "slot.cloud_synthesis.claimed.json"),
        "utf8",
      ),
    ).toContain('"recordType":"slot_claimed"');
    await expect(inspectPr6rAuthorityLedger(root)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      claimPr6rCloudSlot(authority, binding),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("does not recreate the campaign-wide fallback after one record copy is deleted", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const slot = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (slot.status !== "claimed") throw new Error("slot must be claimed");
    const terminal = await terminalizePr6rCloudSlot(slot, {
      terminalOutcome: "failed",
      requestDisposition: "sent",
      stableCode: "loopback.http_error",
    });
    expect(await claimPr6rLocalFallback(terminal)).toMatchObject({
      status: "claimed",
    });
    await rm(path.join(root, "fallback.claimed.json"));
    expect(
      await readFile(recordGuardPath(root, "fallback.claimed.json"), "utf8"),
    ).toContain('"recordType":"fallback_claimed"');
    await expect(inspectPr6rAuthorityLedger(root)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(claimPr6rLocalFallback(terminal)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
  });

  it("does not rewrite a terminal after one copy of its record is deleted", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const binding = slotBinding("cloud_synthesis");
    const slot = await claimPr6rCloudSlot(authority, binding);
    if (slot.status !== "claimed") throw new Error("slot must be claimed");
    await terminalizePr6rCloudSlot(slot, {
      terminalOutcome: "failed",
      requestDisposition: "sent",
      stableCode: "loopback.http_error",
    });
    await rm(path.join(root, "slot.cloud_synthesis.terminal.json"));
    expect(
      await readFile(
        recordGuardPath(root, "slot.cloud_synthesis.terminal.json"),
        "utf8",
      ),
    ).toContain('"recordType":"slot_terminal"');
    await expect(inspectPr6rAuthorityLedger(root)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      recoverPr6rCloudSlot(authority, binding),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("requires the Cloud slot to reach a durable terminal before Hybrid can be claimed", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    await expect(
      claimPr6rCloudSlot(
        authority,
        slotBinding("hybrid_cloud_if_selected"),
      ),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });

    const cloudBinding = slotBinding("cloud_synthesis");
    const cloud = await claimPr6rCloudSlot(authority, cloudBinding);
    if (cloud.status !== "claimed") throw new Error("Cloud slot must be claimed");
    await terminalizePr6rCloudSlot(cloud, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    });
    for (const overrides of [
      { requestId: cloudBinding.requestId },
      { synthesisSessionId: cloudBinding.synthesisSessionId },
      { attemptId: cloudBinding.attemptId },
      { reservationId: cloudBinding.reservationId },
      { origin: "http://127.0.0.1:43124" },
      { packetUtf8: '{"fixture":"cal-007","scope":"different"}' },
      {
        body: {
          ...applicationBody(),
          messages: [
            applicationBody().messages[0],
            { role: "user" as const, content: "Different admitted messages." },
          ],
        },
      },
    ]) {
      await expect(
        claimPr6rCloudSlot(
          authority,
          slotBinding("hybrid_cloud_if_selected", overrides),
        ),
      ).rejects.toMatchObject({ code: "authority_input_invalid" });
    }
    await expect(
      claimPr6rCloudSlot(
        authority,
        slotBinding("hybrid_cloud_if_selected"),
      ),
    ).resolves.toMatchObject({ status: "claimed" });
  });

  it("rejects contradictory terminal outcome, disposition, and code combinations", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const claim = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (claim.status !== "claimed") throw new Error("slot must be claimed");

    for (const terminal of [
      {
        terminalOutcome: "completed" as const,
        requestDisposition: "not_sent" as const,
        stableCode: "completed",
      },
      {
        terminalOutcome: "completed" as const,
        requestDisposition: "sent" as const,
        stableCode: "loopback.http_error",
      },
      {
        terminalOutcome: "failed" as const,
        requestDisposition: "not_sent" as const,
        stableCode: "loopback.http_error",
      },
      {
        terminalOutcome: "failed" as const,
        requestDisposition: "not_sent" as const,
        stableCode: "loopback.authority_invalid",
      },
    ]) {
      await expect(
        terminalizePr6rCloudSlot(claim, terminal),
      ).rejects.toMatchObject({ code: "authority_input_invalid" });
    }
    await expect(
      terminalizePr6rCloudSlot(claim, {
        terminalOutcome: "completed",
        requestDisposition: "sent",
        stableCode: "completed",
      }),
    ).resolves.toMatchObject({ stableCode: "completed" });
  });

  it("ratchets one campaign-wide Local fallback", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const cloudClaim = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (cloudClaim.status !== "claimed") throw new Error("slot must be claimed");
    const cloudFailure = await terminalizePr6rCloudSlot(cloudClaim, {
      terminalOutcome: "failed",
      requestDisposition: "sent",
      stableCode: "loopback.http_error",
    });
    const fallback = await claimPr6rLocalFallback(cloudFailure);
    expect(fallback).toMatchObject({
      status: "claimed",
      triggerSlotId: "cloud_synthesis",
      triggerTerminalSha256: cloudFailure.recordSha256,
      fallbackClaimSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });

    const hybridClaim = await claimPr6rCloudSlot(
      authority,
      slotBinding("hybrid_cloud_if_selected"),
    );
    if (hybridClaim.status !== "claimed") throw new Error("slot must be claimed");
    const hybridFailure = await terminalizePr6rCloudSlot(hybridClaim, {
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.dispatch_unknown",
    });
    expect(await claimPr6rLocalFallback(hybridFailure)).toMatchObject({
      status: "already_consumed",
      triggerSlotId: "cloud_synthesis",
      triggerTerminalSha256: cloudFailure.recordSha256,
      fallbackClaimSha256:
        fallback.status === "claimed"
          ? fallback.fallbackClaimSha256
          : undefined,
    });
  });

  it("rejects fallback without a genuine failed terminal", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const claim = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (claim.status !== "claimed") throw new Error("slot must be claimed");
    const completed = await terminalizePr6rCloudSlot(claim, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    });
    await expect(claimPr6rLocalFallback(completed)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      claimPr6rLocalFallback({ ...completed }),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
  });

  it("recovers a failed terminal for the one campaign-wide fallback", async () => {
    const root = await ledgerRoot();
    const binding = slotBinding("cloud_synthesis");
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const claim = await claimPr6rCloudSlot(authority, binding);
    if (claim.status !== "claimed") throw new Error("slot must be claimed");
    await terminalizePr6rCloudSlot(claim, {
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.dispatch_unknown",
    });

    const resumed = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const recoveredTerminal = await recoverPr6rFailedTerminalForFallback(
      resumed,
      binding,
    );
    expect(await claimPr6rLocalFallback(recoveredTerminal)).toMatchObject({
      status: "claimed",
      triggerSlotId: "cloud_synthesis",
    });
  });

  it("fails closed when a terminal record is orphaned from its slot claim", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const claim = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (claim.status !== "claimed") throw new Error("slot must be claimable");
    await terminalizePr6rCloudSlot(claim, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    });

    await rm(path.join(root, "slot.cloud_synthesis.claimed.json"));

    await expect(inspectPr6rAuthorityLedger(root)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      claimPr6rCloudSlot(authority, slotBinding("cloud_synthesis")),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("refuses to terminalize a deleted or replaced persisted claim", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const claim = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (claim.status !== "claimed") throw new Error("slot must be claimable");
    await rm(path.join(root, "slot.cloud_synthesis.claimed.json"));

    await expect(
      terminalizePr6rCloudSlot(claim, {
        terminalOutcome: "cancelled",
        requestDisposition: "not_sent",
        stableCode: "loopback.cancelled_before_dispatch",
      }),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("recovers only an exactly bound consumed slot for terminalization", async () => {
    const root = await ledgerRoot();
    const binding = slotBinding("cloud_synthesis");
    const first = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    expect(await claimPr6rCloudSlot(first, binding)).toMatchObject({
      status: "claimed",
      requestId: binding.requestId,
      reservationId: binding.reservationId,
    });

    const resumed = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    await expect(
      recoverPr6rCloudSlot(
        resumed,
        slotBinding("cloud_synthesis", {
          reservationId: "reservation-mismatch",
        }),
      ),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });

    const recovery = await recoverPr6rCloudSlot(resumed, binding);
    expect(recovery).toMatchObject({
      status: "recovery_only",
      requestId: binding.requestId,
      attemptId: binding.attemptId,
    });
    if (recovery.status !== "recovery_only") {
      throw new Error("slot must require recovery terminalization");
    }
    const recoveredTerminal = await terminalizeRecoveredPr6rCloudSlot(
      recovery,
      {
        now: () => "2099-09-02T00:00:04.000Z",
        terminalOutcome: "completed",
        requestDisposition: "not_sent",
        stableCode: "fabricated_completion",
      } as { now: () => string },
    );
    expect(recoveredTerminal).toMatchObject({
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.recovery_required",
    });
    expect(await recoverPr6rCloudSlot(resumed, binding)).toMatchObject({
      status: "already_terminalized",
    });
  });

  it("rejects a terminal transplanted from a differently bound claim", async () => {
    const firstRoot = await ledgerRoot();
    const secondRoot = await ledgerRoot();
    const firstBinding = slotBinding("cloud_synthesis");
    const secondBinding = slotBinding("cloud_synthesis", {
      requestId: "request-second",
      synthesisSessionId: "session-second",
      attemptId: "attempt-second",
      reservationId: "reservation-second",
    });
    const first = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: firstRoot,
    });
    const second = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: secondRoot,
    });
    const firstClaim = await claimPr6rCloudSlot(first, firstBinding);
    const secondClaim = await claimPr6rCloudSlot(second, secondBinding);
    if (firstClaim.status !== "claimed" || secondClaim.status !== "claimed") {
      throw new Error("both isolated slots must be claimed");
    }
    await terminalizePr6rCloudSlot(firstClaim, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    });
    await terminalizePr6rCloudSlot(secondClaim, {
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.dispatch_unknown",
    });

    const firstTerminal = await readFile(
      path.join(firstRoot, "slot.cloud_synthesis.terminal.json"),
    );
    await writeFile(
      path.join(secondRoot, "slot.cloud_synthesis.terminal.json"),
      firstTerminal,
      { mode: 0o600 },
    );
    await expect(inspectPr6rAuthorityLedger(secondRoot)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      recoverPr6rCloudSlot(second, secondBinding),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("rejects slot and terminal records transplanted from another campaign claim", async () => {
    const firstRoot = await ledgerRoot();
    const secondRoot = await ledgerRoot();
    const first = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: firstRoot,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const second = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: secondRoot,
      now: () => "2026-09-02T00:00:00.500Z",
    });
    const cloud = await claimPr6rCloudSlot(
      first,
      slotBinding("cloud_synthesis"),
      { now: () => "2026-09-02T00:00:01.000Z" },
    );
    if (cloud.status !== "claimed") throw new Error("slot must be claimed");
    await terminalizePr6rCloudSlot(cloud, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
      now: () => "2026-09-02T00:00:02.000Z",
    });

    for (const fileName of [
      "slot.cloud_synthesis.claimed.json",
      "slot.cloud_synthesis.terminal.json",
    ]) {
      await writeFile(
        path.join(secondRoot, fileName),
        await readFile(path.join(firstRoot, fileName)),
        { mode: 0o600 },
      );
    }
    await expect(inspectPr6rAuthorityLedger(secondRoot)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      claimPr6rCloudSlot(
        second,
        slotBinding("hybrid_cloud_if_selected"),
        { now: () => "2026-09-02T00:00:03.000Z" },
      ),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("enforces campaign, slot, terminal, and fallback chronology", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T10:00:00.000Z",
    });
    await expect(
      claimPr6rCloudSlot(authority, slotBinding("cloud_synthesis"), {
        now: () => "2026-09-02T09:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "authority_input_invalid" });
    const cloud = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
      { now: () => "2026-09-02T11:00:00.000Z" },
    );
    if (cloud.status !== "claimed") throw new Error("slot must be claimed");
    await expect(
      terminalizePr6rCloudSlot(cloud, {
        terminalOutcome: "failed",
        requestDisposition: "unknown",
        stableCode: "loopback.dispatch_unknown",
        now: () => "2026-09-02T10:30:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "authority_input_invalid" });
    const failed = await terminalizePr6rCloudSlot(cloud, {
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.dispatch_unknown",
      now: () => "2026-09-02T12:00:00.000Z",
    });
    await expect(
      claimPr6rLocalFallback(failed, {
        now: () => "2026-09-02T11:30:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "authority_input_invalid" });
    await expect(
      claimPr6rLocalFallback(failed, {
        now: () => "2026-09-02T13:00:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "claimed" });
  });

  it("rejects forged handles, revision drift, symlinks, and corrupt records", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const forged = {
      ...authority,
    } as Pr6rCampaignAuthority;
    await expect(
      claimPr6rCloudSlot(forged, slotBinding("cloud_synthesis")),
    ).rejects.toMatchObject({
      code: "authority_handle_invalid",
    });
    await expect(
      pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: "b".repeat(40),
        ledgerRoot: root,
      }),
    ).rejects.toMatchObject({
      code: "authority_record_invalid",
    });

    const parent = await mkdtemp(path.join(tmpdir(), "soar-pr6r-symlink-"));
    roots.push(parent);
    const canonicalParent = await realpath(parent);
    const real = path.join(canonicalParent, "real");
    const linked = path.join(
      canonicalParent,
      process.platform === "darwin" ? "Library" : ".local",
    );
    await mkdir(real);
    await symlink(real, linked);
    await expect(
      pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: REVISION,
        ledgerRoot: productionLedgerRootForHome(canonicalParent),
      }),
    ).rejects.toMatchObject({
      code: "authority_path_unsafe",
    });

    await writeFile(path.join(root, "slot.cloud_synthesis.claimed.json"), "{}\n", {
      mode: 0o600,
    });
    await expect(
      claimPr6rCloudSlot(authority, slotBinding("cloud_synthesis")),
    ).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
  });

  it("maps caller validation failures to stable input errors", async () => {
    const root = await ledgerRoot();
    await expect(
      pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: "not-a-revision",
        ledgerRoot: root,
      }),
    ).rejects.toMatchObject({ code: "authority_input_invalid" });

    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const genuine = slotBinding("cloud_synthesis");
    await expect(
      claimPr6rCloudSlot(authority, { ...genuine }),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
    expect(() =>
      buildPr6rCloudSlotBinding({
        applicationRequest: {},
        reservationId: "reservation-invalid",
      }),
    ).toThrow("authority_input_invalid");
  });

  it("rejects a parent-session synthesis binding before consuming slot authority", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const checkpoint = buildPr6rCommonCheckpointV1({
      parentSessionId: PARENT_SESSION_ID,
      packetUtf8: PACKET_UTF8,
      semanticMessages: applicationBody().messages,
    });
    const genuineRequest = sealCloudApplicationRequestV1({
      requestId: "request-parent-session-adversary",
      parentSessionId: PARENT_SESSION_ID,
      synthesisSessionId: "session-parent-session-adversary",
      attemptId: "attempt-parent-session-adversary",
      slotId: "cloud_synthesis",
      commonCheckpoint: checkpoint,
      packetUtf8: PACKET_UTF8,
      origin: "http://127.0.0.1:43123",
      body: applicationBody(),
    });

    expect(() =>
      buildPr6rCloudSlotBinding({
        applicationRequest: {
          ...genuineRequest,
          synthesisSessionId: PARENT_SESSION_ID,
        },
        reservationId: "reservation-parent-session-adversary",
      }),
    ).toThrow("authority_input_invalid");

    expect(
      await claimPr6rCloudSlot(
        authority,
        buildPr6rCloudSlotBinding({
          applicationRequest: genuineRequest,
          reservationId: "reservation-parent-session-adversary",
        }),
      ),
    ).toMatchObject({ status: "claimed" });
  });
});
