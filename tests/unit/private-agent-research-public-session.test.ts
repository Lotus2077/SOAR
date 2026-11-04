import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { publicSourceWorkspacePath } from "../../src/main/private-agent/claims";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { retainPublicSource } from "../../src/main/private-agent/public-sources";
import { RESEARCH_FILES } from "../../src/main/private-agent/research-contract";
import { validateReadyResearchPacket } from "../../src/main/private-agent/research-coverage";
import { validateResearchPresentation } from "../../src/main/private-agent/research-presentation";
import { GeneralAgentSession, sessionFileManifest, sessionPhaseIdentity, type GeneralSessionOptions,
  type PublicSessionPhase, type SessionPhase } from "../../src/main/private-agent/session";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { researchV4Reply } from "../helpers/research-v4-fixture";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const publicUrl = "https://research.invalid/fixture.md";
const publicBytes = Buffer.from("# Public orchard\nThe public orchard recorded nine ripe pears during the summer survey.\n");
const privateBytes = Buffer.from("# Private orchard\nThe private orchard recorded six ripe pears during the spring survey.\n");

/** Production session/pipeline/serializer, synthetic receipts and a mock writer; no socket or sandbox is opened. */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "soar-public-research-v4-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = new Database(":memory:"); cleanups.push(() => db.close());
  const store = new PrivateAgentStore(db), jobId = "public-research-v4";
  const checkpoints = new PrivateCheckpointStore(directory, jobId);
  const broker = new PrivateAgentBroker(store, [
    { id: "public", kind: "public_web", endpoint: publicUrl, accountId: "fixture", credentialVersion: 0,
      privateDataAdmitted: false, maxResponseBytes: 65536, timeoutMs: 1000 },
    { id: "model", kind: "local_model", endpoint: "http://127.0.0.1:1/v1/chat/completions", accountId: "fixture",
      credentialVersion: 0, privateDataAdmitted: true, loopbackFixture: true, maxResponseBytes: 65536, timeoutMs: 1000 },
  ], { scan: async () => { throw new Error("No external scan or transport is allowed in this CPU fixture."); } });
  const bodies: { system: string; user: string }[] = [];
  vi.spyOn(broker, "request").mockImplementation(async (input, settle) => {
    let bytes: Buffer;
    if (input.destinationId === "public") {
      expect(input.method).toBe("GET"); expect(input.url).toBe(publicUrl); expect(input.body).toBeUndefined();
      bytes = publicBytes;
    } else {
      const body = JSON.parse(String(input.body)) as { messages: { content: string }[] };
      const system = body.messages[0]!.content, user = body.messages[1]!.content; bodies.push({ system, user });
      bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content: researchV4Reply(system, user) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 30 } }));
    }
    const { text: _text, ...preview } = broker.preview(input);
    const row = store.commit({ ...preview, reservedFeeMicrousd: 0, scan: { status: "not_required_inside_boundary" } }, () => {});
    store.settle(row.id, settle ? settle(bytes) : 0, digest(bytes));
    return { bytes, receipt: store.dispatch(row.id) };
  });
  const privatePhase: SessionPhase = { files: [{ path: "input/private.md", bytes: privateBytes }],
    checks: [{ id: "private_fixture", python: "# fixed CPU fixture" }],
    contract: { version: 1, goal: "Compare the supplied orchard observations and their limitations.",
      requiredArtifacts: [{ path: "output/report.md", description: "Comparison" }], requiredChecks: ["private_fixture"],
      maxModelCalls: 4, maxToolCalls: 4, maxElapsedMs: 60000 } };
  const publicBase: SessionPhase = { files: [{ path: "public-brief.md", bytes: Buffer.from("Retrieve the approved orchard page.") }],
    checks: [{ id: "public_fixture", python: "# fixed CPU fixture" }],
    contract: { version: 1, goal: "Retrieve the approved public orchard page.",
      requiredArtifacts: [{ path: "output/public.md", description: "Public notes" }], requiredChecks: ["public_fixture"],
      maxModelCalls: 2, maxToolCalls: 2, maxElapsedMs: 60000 } };
  const publicPhase: PublicSessionPhase = { ...publicBase, webDestinations: ["public"],
    transfer: [{ from: "output/public.md", to: "context/public.md" }],
    approval: { goalSha256: digest(publicBase.contract.goal), fileManifestSha256: digest(canonical(sessionFileManifest(publicBase.files))),
      phaseSha256: sessionPhaseIdentity(publicBase), webDestinationsSha256: digest(canonical(["public"])) } };
  const model = (contextId: string) => new PrivateAgentModel(broker, { destinationId: "model", model: "cpu-fixture",
    maxOutputTokens: 16384, maxRequestBytes: 640 * 1024, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "medium" }, jobId, contextId);
  const writes: SessionPhase[] = [];
  const options: GeneralSessionOptions = { jobId, store, broker, checkpoints, imageId: `sha256:${"a".repeat(64)}`,
    privatePhase, publicPhase, limits: { maxRequests: 100, maxElapsedMs: 120000 },
    syntheticInputApproval: { privatePhaseSha256: sessionPhaseIdentity(privatePhase), authoritySha256: digest("invented CPU fixture") },
    trustedHostModelFactory: model, research: { models: contextId => ({ reader: model(contextId), planner: model(contextId), synthesiser: model(contextId) }) },
    trustedHostRunnerFactory: input => ({ pause() {}, cancel() {}, async run(signal) {
      if (input.webDestinations?.length) {
        expect(input.files.some(file => file.bytes.equals(privateBytes))).toBe(false);
        const response = await broker.request({ jobId, contextId: input.contextId, destinationId: "public", purpose: "public source retrieval",
          method: "GET", url: publicUrl, maxFeeMicrousd: 0, signal });
        retainPublicSource(store, checkpoints, { jobId, contextId: input.contextId, url: publicUrl, bytes: response.bytes, receipt: response.receipt });
      } else { writes.push(input); validateResearchPresentation(input.initialEvidence, input.files); }
      const snapshot = checkpoints.save([...input.files, ...input.contract.requiredArtifacts.map(artifact => ({ path: artifact.path, bytes: Buffer.from("Invented CPU result; independent acceptance remains pending.") }))]);
      const checks = input.checks.map(check => ({ id: check.id, passed: true }));
      store.append(jobId, { type: "completed", contextId: input.contextId, snapshot, checks, verifiedSnapshotSha256: checkpoints.fingerprint(snapshot) });
      return { status: "completed", reason: "fixture", snapshot, checks, modelCalls: 0 };
    } }) };
  return { options, bodies, writes, store, jobId };
}

describe("public-source research handoff", () => {
  it("binds the composed brief and retained public bytes, then resumes without repeating retrieval, research or writing", async () => {
    const f = fixture();
    expect(await new GeneralAgentSession(f.options).run()).toMatchObject({ status: "submitted", independentAcceptanceRequired: true, artifactAccepted: null });
    expect(f.writes).toHaveLength(1);
    const phase = f.writes[0]!, events = f.store.events(f.jobId);
    const input = events.find(event => event.type === "research_input")!.input as { originalGoalSha256: string; sourceManifest: unknown[] };
    const request = JSON.parse(f.bodies.find(body => body.system.startsWith("You plan"))!.user) as { brief: string };
    expect(request.brief).toContain(f.options.privatePhase.contract.goal);
    expect(request.brief).toContain("A separately isolated public retrieval phase supplied");
    expect(input.originalGoalSha256).toBe(digest(request.brief));
    expect(input.originalGoalSha256).not.toBe(digest(f.options.privatePhase.contract.goal));
    expect(input.sourceManifest).toEqual(expect.arrayContaining([
      { id: publicUrl, path: publicSourceWorkspacePath(publicUrl), bytes: publicBytes.length, sha256: digest(publicBytes) },
      { id: "input/private.md", path: "input/private.md", bytes: privateBytes.length, sha256: digest(privateBytes) },
    ]));
    const packet = validateReadyResearchPacket(phase.files.filter(file => (Object.values(RESEARCH_FILES) as readonly string[]).includes(file.path)));
    expect(packet.coverage.briefSha256).toBe(input.originalGoalSha256);
    expect(phase.initialEvidence!.originalGoalSha256).toBe(input.originalGoalSha256);
    expect(phase.initialEvidence!.rendered).toContain("nine ripe pears");
    expect(phase.initialEvidence!.rendered).toContain("six ripe pears");
    expect(phase.contract.goal).not.toContain("BEGIN HOST-RETAINED RESEARCH DATA");
    expect(f.bodies).toHaveLength(5); // index, plan, both mandatory source chunks, synthesis
    expect(f.store.dispatches(f.jobId)).toHaveLength(6); // plus the retained public fetch
    const before = canonical(f.store.dispatches(f.jobId));
    expect(await new GeneralAgentSession(f.options).run()).toMatchObject({ status: "submitted" });
    expect(canonical(f.store.dispatches(f.jobId))).toBe(before); expect(f.writes).toHaveLength(1);
    expect(f.store.events(f.jobId).filter(event => event.type === "research_transfer")).toHaveLength(1);
  });

  it("refuses a changed private source before a resumed request even when the host attestation is rebound", async () => {
    const f = fixture();
    expect((await new GeneralAgentSession(f.options).run()).status).toBe("submitted");
    const before = canonical(f.store.dispatches(f.jobId));
    const privatePhase = { ...f.options.privatePhase, files: [{ path: "input/private.md", bytes: Buffer.from("Altered source identity.") }] };
    const changed = { ...f.options, privatePhase, syntheticInputApproval: { ...f.options.syntheticInputApproval!, privatePhaseSha256: sessionPhaseIdentity(privatePhase) } };
    expect(await new GeneralAgentSession(changed).run()).toMatchObject({ status: "incomplete", reason: "session_contract_drift" });
    expect(canonical(f.store.dispatches(f.jobId))).toBe(before); expect(f.writes).toHaveLength(1);
  });
});
