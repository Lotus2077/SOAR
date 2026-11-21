import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { digest } from "../../src/main/private-agent/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateAgentBroker, type BrokerDestination } from "../../src/main/private-agent/broker";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function store(): PrivateAgentStore {
  const directory = mkdtempSync(join(tmpdir(), "soar-broker-waiver-")); cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = new Database(join(directory, "state.sqlite")); cleanups.push(() => db.close());
  return new PrivateAgentStore(db);
}
/** Building a broker validates every destination it is given; this returns the refusal's code, or "accepted". */
function construct(destination: Record<string, unknown>): string {
  try { new PrivateAgentBroker(store(), [destination as unknown as BrokerDestination], { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) }); return "accepted"; }
  catch (error) { return error instanceof Error ? (error as Error & { code?: string }).code ?? error.message : String(error); }
}
/** The desktop review's destination: a local model on a plain-HTTP, non-loopback address that admits private data. */
const review = { id: "desktop_local", kind: "local_model", endpoint: "http://192.0.2.10:8000/v1/chat/completions", accountId: "owner_declared_local_server",
  credentialVersion: 1, privateDataAdmitted: true, syntheticOnly: false, maxResponseBytes: 262144, timeoutMs: 900000 };

describe("the owner's transport waiver for the desktop document review (backlog item 13b, part 1)", () => {
  it("lets the one destination that admits private data, a local model that is not synthetic-only, use plain HTTP, and only with the flag", () => {
    expect(construct({ ...review, ownerWaivedTransport: true })).toBe("accepted");
    expect(construct(review)).toBe("destination_tls_required");
    // Over HTTPS the destination needs no waiver; the flag stays valid on it, as the review sets it whatever the endpoint.
    expect(construct({ ...review, endpoint: "https://models.example.test/v1/chat/completions" })).toBe("accepted");
    expect(construct({ ...review, endpoint: "https://models.example.test/v1/chat/completions", ownerWaivedTransport: true })).toBe("accepted");
  });

  it("refuses the flag with its own code on any other destination, so plain HTTP stays refused everywhere else", () => {
    const synthetic = { ...review, privateDataAdmitted: false, syntheticOnly: true };
    const crafted: [string, Record<string, unknown>][] = [
      ["a synthetic-only local model (the research beta's and E5's)", { ...synthetic, ownerWaivedTransport: true }],
      ["a local model that admits no private data", { ...review, privateDataAdmitted: false, ownerWaivedTransport: true }],
      // Both at once is the broker's own trust conflict; the flag is refused first, by its own code.
      ["a local model both synthetic-only and admitting private data", { ...review, syntheticOnly: true, ownerWaivedTransport: true }],
      ["a cloud model", { ...review, id: "cloud", kind: "cloud_model", endpoint: "http://192.0.2.20/v1/chat/completions", ownerWaivedTransport: true }],
      ["a cloud model over HTTPS", { ...review, id: "cloud", kind: "cloud_model", endpoint: "https://api.example.test/v1/chat/completions", ownerWaivedTransport: true }],
      ["a public web source", { id: "web", kind: "public_web", endpoint: "http://example.test/a", exactUrl: "http://example.test/a", accountId: "user_approved_public_source",
        credentialVersion: 0, privateDataAdmitted: false, maxResponseBytes: 65536, timeoutMs: 15000, ownerWaivedTransport: true }],
      ["a false flag", { ...review, ownerWaivedTransport: false }],
      ["a flag that is not true", { ...review, ownerWaivedTransport: "yes" }],
    ];
    for (const [name, destination] of crafted) expect(construct(destination), name).toBe("destination_transport_waiver_invalid");
    // Without the flag, nothing changes: a synthetic-only local model may use plain HTTP, as today, and nothing else may.
    expect(construct(synthetic)).toBe("accepted");
    expect(construct({ ...review, id: "cloud", kind: "cloud_model", endpoint: "http://192.0.2.20/v1/chat/completions", privateDataAdmitted: false, syntheticOnly: true })).toBe("destination_tls_required");
    expect(construct({ ...review, privateDataAdmitted: false })).toBe("destination_tls_required");
  });

  it("binds the flag into the destination's fingerprint, so the same endpoint with and without the waiver is another destination", () => {
    const shared = store(), jobId = randomUUID(), contextId = randomUUID();
    shared.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["desktop_local"], maxRequests: 4, maxFeeMicrousd: 0 });
    shared.createContext({ id: contextId, jobId, sources: [{ id: "original", version: digest("owner document"), classification: "private", synthetic: false }] });
    const https = { ...review, endpoint: "https://models.example.test/v1/chat/completions" };
    const sha = (destination: Record<string, unknown>) => new PrivateAgentBroker(shared, [destination as unknown as BrokerDestination], { scan: async () => ({ complete: true, blocked: false, detector: "fixture" }) })
      .preview({ jobId, contextId, destinationId: "desktop_local", purpose: "agent reasoning and tool selection", method: "POST", body: "{}", maxFeeMicrousd: 0 }).destinationSha256;
    expect(sha({ ...https, ownerWaivedTransport: true })).toMatch(/^[a-f0-9]{64}$/u);
    expect(sha({ ...https, ownerWaivedTransport: true })).not.toBe(sha(https));
    expect(sha(https)).toBe(sha({ ...https }));
  });

  it("is set in one place only: the desktop controller's destination for a document review, never in settings, scripts or another route", () => {
    const repository = resolve(import.meta.dirname, "..", "..");
    const files = (directory: string): string[] => readdirSync(directory).flatMap(name => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|mts|js|mjs|py)$/u.test(name) ? [path] : [];
    });
    const mentions = ["src", "scripts"].flatMap(directory => files(join(repository, directory)))
      .filter(path => readFileSync(path, "utf8").includes("ownerWaivedTransport")).map(path => relative(repository, path).split("\\").join("/")).sort();
    // The broker declares and validates the field; the controller alone sets it.
    expect(mentions).toEqual(["src/main/general-tasks/controller.ts", "src/main/private-agent/broker.ts"]);
    const controller = readFileSync(join(repository, "src/main/general-tasks/controller.ts"), "utf8");
    expect(controller.match(/ownerWaivedTransport/gu)).toHaveLength(1);
    expect(controller).toContain("...(record.review ? { privateDataAdmitted: true, syntheticOnly: false, ownerWaivedTransport: true as const } : { privateDataAdmitted: false, syntheticOnly: true }),");
    expect(readFileSync(join(repository, "src/main/private-agent/broker.ts"), "utf8")).not.toMatch(/ownerWaivedTransport\s*:\s*true/u);
  });
});
