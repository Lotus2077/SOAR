import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSoarDatabase } from "../../src/main/database";
import { PatchRunStore } from "../../src/main/patch-runs/store";
import type { PatchRuntimeConfig } from "../../src/main/patch-runs/config";
import { PatchRunCreateInputSchema } from "../../src/shared/patch-run-contracts";
import { validateEvaluationObjectiveBinding } from "../../src/main/patch-runs/evaluation-binding";

const runtime = vi.hoisted(() => ({ launch: vi.fn(), remove: vi.fn(), materialize: vi.fn() }));
vi.mock("../../src/main/patch-runs/workspace", () => ({
  inspectPatchWorkspace: async (root: string) => ({ root, revision: "a".repeat(40) }),
  materializePatchWorkspace: runtime.materialize,
}));
vi.mock("../../src/main/patch-runs/worker", () => ({ launchPatchWorker: runtime.launch, removeRunContainers: runtime.remove }));
import { PatchRunController } from "../../src/main/patch-runs/controller";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const bind = (raw: Uint8Array, snapshotObjective: string, expectedRawSha256 = sha(raw)) =>
  validateEvaluationObjectiveBinding({ rawObjective: raw, expectedRawSha256, snapshotObjective });

describe("frozen evaluator objective attribution", () => {
  it.each(["Fix addition.\n", "\t Fix addition.\r\n", "\uFEFFFix addition.\u00a0", "Fix addition."])(
    "uses the actual controller/store create boundary for %j", async (objective) => {
      const db = createSoarDatabase();
      const store = new PatchRunStore(db);
      const config: PatchRuntimeConfig = {
        mode: "scripted", enabled: true, python: "unused", workerPath: "/fixture/unused-worker.py",
        image: "unused", storageRoot: "/fixture/unused-storage", episodeCapMicrousd: 3_000_000,
        campaignCapMicrousd: 150_000_000, stepLimit: 8, wallTimeSeconds: 600, maxOutputTokens: 8192, maxInputBytes: 256000,
      };
      const controller = new PatchRunController(store, config, () => {}, { recoveryRunIds: [] });
      try {
        const raw = Buffer.from(objective);
        // Do not pre-normalize or fabricate the snapshot: controller.create and
        // the real SQLite store must perform their production input handling.
        const snapshot = await controller.create({ workspaceRoot: "/fixture/public", objective: raw.toString("utf8"),
          policy: "local_only", publicSourceAcknowledged: true });
        expect(snapshot.objective).toBe(PatchRunCreateInputSchema.shape.objective.parse(objective));
        expect(snapshot.objective).toBe("Fix addition.");
        expect(bind(raw, snapshot.objective)).toEqual({ rawObjectiveSha256: sha(raw), admittedObjectiveSha256: sha(snapshot.objective),
          rawBytes: raw.length, admittedBytes: Buffer.byteLength(snapshot.objective) });
        if (objective !== snapshot.objective) expect(sha(raw)).not.toBe(sha(snapshot.objective));
        expect(snapshot.status).toBe("created");
        expect(store.replay(snapshot.id)).toEqual(snapshot);
      } finally { await controller.close(); db.close(); }
      expect(runtime.launch).not.toHaveBeenCalled(); expect(runtime.remove).not.toHaveBeenCalled();
      expect(runtime.materialize).not.toHaveBeenCalled();
    },
  );

  it("verifies exact raw bytes even when altered whitespace would admit the same text", () => {
    const frozen = Buffer.from("Fix addition.\n");
    expect(() => bind(Buffer.from("Fix addition.\r\n"), "Fix addition.", sha(frozen))).toThrow("hash mismatch");
    expect(() => bind(frozen, "Fix addition.", sha("Fix addition."))).toThrow("hash mismatch");
    expect(() => bind(frozen, "Fix addition.", "invalid")).toThrow("binding is invalid");
  });

  it("requires exact admitted text and preserves internal whitespace and Unicode", () => {
    const raw = Buffer.from("  Fix  addition.\nKeep 中文 and e\u0301.  \n");
    const expected = "Fix  addition.\nKeep 中文 and e\u0301.";
    expect(bind(raw, expected).admittedObjectiveSha256).toBe(sha(expected));
    for (const changed of [expected + "\n", expected.replace("addition", "subtraction"),
      expected.replace("  ", " "), expected.replace("e\u0301", "é")]) {
      expect(() => bind(raw, changed)).toThrow("Snapshot objective differs");
    }
  });

  it.each([[0xc3, 0x28], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xff]])(
    "rejects malformed UTF-8 with a matching frozen byte hash: %j", (...values) => {
      const raw = Uint8Array.from(values);
      expect(() => bind(raw, Buffer.from(raw).toString("utf8"))).toThrow("not valid UTF-8");
    },
  );

  it("accepts a valid encoded replacement character without treating it as malformed bytes", () => {
    const raw = Buffer.from("Preserve the literal \uFFFD character.\n");
    expect(bind(raw, "Preserve the literal \uFFFD character.").rawObjectiveSha256).toBe(sha(raw));
  });

  it("uses the create schema's nonempty and length requirements after normalization", () => {
    for (const text of [" \n\t", "x".repeat(20_001)]) {
      expect(() => bind(Buffer.from(text), text)).toThrow("create contract");
    }
    const text = "x".repeat(20_000);
    expect(bind(Buffer.from(text + "\n"), text).admittedBytes).toBe(20_000);
  });
});
