import { z } from "zod";
import { canonical, digest, privateAgentId, restrictedContext, sha256Schema } from "./contracts";
import type { PrivateAgentStore, DispatchReceipt } from "./store";
import type { PrivateCheckpointStore } from "./checkpoints";

export const PUBLIC_SOURCE_MAX_BYTES = 64 * 1024;
export const PUBLIC_SOURCE_OBSERVATION_BYTES = 32 * 1024;
const SourceEventSchema = z.object({
  type: z.literal("public_source_retained"), contextId: privateAgentId, dispatchId: privateAgentId,
  destinationId: privateAgentId, url: z.string().url().max(8192), sha256: sha256Schema,
  bytes: z.number().int().nonnegative().max(PUBLIC_SOURCE_MAX_BYTES), retrievedAt: z.number().int().nonnegative().safe(),
  snapshot: z.array(z.object({ path: z.string(), sha256: sha256Schema, bytes: z.number().int().nonnegative() }).strict()).length(1),
}).strict();
type SourceEvent = z.infer<typeof SourceEventSchema>;
export interface PublicSource { dispatchId: string; url: string; sha256: string; bytes: number; retrievedAt: number }

function verifiedSource(store: PrivateAgentStore, checkpoints: PrivateCheckpointStore, jobId: string, raw: unknown): PublicSource {
  const event = SourceEventSchema.parse(raw), receipt = store.dispatch(event.dispatchId), context = store.context(event.contextId);
  const url = new URL(event.url), item = event.snapshot[0]!;
  if (context.jobId !== jobId || restrictedContext(context) || receipt.jobId !== jobId || receipt.contextId !== event.contextId ||
      receipt.destinationId !== event.destinationId || receipt.status !== "settled" || receipt.purpose !== "public source retrieval" ||
      receipt.feeMicrousd !== 0 || receipt.reservedFeeMicrousd !== 0 || receipt.responseSha256 !== event.sha256 ||
      event.retrievedAt < receipt.committedAt || url.href !== event.url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash ||
      receipt.packetSha256 !== digest(canonical({ method: "GET", url: event.url, headers: {}, body: "" })) ||
      item.path !== `public-sources/${event.dispatchId}.bin` || item.sha256 !== event.sha256 || item.bytes !== event.bytes) {
    throw new Error("public_source_identity_invalid");
  }
  checkpoints.load(event.snapshot);
  return { dispatchId: event.dispatchId, url: event.url, sha256: event.sha256, bytes: event.bytes, retrievedAt: event.retrievedAt };
}

/** Host-only evidence; a candidate's citation or workspace file is never a source receipt. */
export function readPublicSources(store: PrivateAgentStore, checkpoints: PrivateCheckpointStore, jobId: string, contextId?: string): PublicSource[] {
  privateAgentId.parse(jobId);
  if (contextId !== undefined && store.context(privateAgentId.parse(contextId)).jobId !== jobId) throw new Error("public_source_context_invalid");
  const events = store.events(jobId).filter(event => event.type === "public_source_retained" && (contextId === undefined || event.contextId === contextId));
  const sources = events.map(event => verifiedSource(store, checkpoints, jobId, event));
  if (new Set(sources.map(source => source.dispatchId)).size !== sources.length) throw new Error("public_source_duplicate");
  return sources;
}

export interface PublicSourceFile { dispatchId: string; url: string; sha256: string; bytes: Buffer }
/** Retained sources with their bytes, for host-owned checks and for carrying them into a later phase; never a model-written file. */
export function readPublicSourceFiles(store: PrivateAgentStore, checkpoints: PrivateCheckpointStore, jobId: string, contextId?: string): PublicSourceFile[] {
  return readPublicSources(store, checkpoints, jobId, contextId).map(source => {
    const event = store.events(jobId).find(row => row.type === "public_source_retained" && row.dispatchId === source.dispatchId);
    const file = checkpoints.load(SourceEventSchema.parse(event).snapshot)[0]!;
    if (digest(file.bytes) !== source.sha256) throw new Error("public_source_identity_invalid");
    return { dispatchId: source.dispatchId, url: source.url, sha256: source.sha256, bytes: file.bytes };
  });
}

export function retainPublicSource(store: PrivateAgentStore, checkpoints: PrivateCheckpointStore, input: {
  jobId: string; contextId: string; url: string; bytes: Buffer; receipt: DispatchReceipt;
}): PublicSource {
  if (input.bytes.length > PUBLIC_SOURCE_MAX_BYTES) throw new Error("public_source_size_exceeded");
  if (store.events(input.jobId).some(event => event.type === "public_source_retained" && event.dispatchId === input.receipt.id)) throw new Error("public_source_duplicate");
  const snapshot = checkpoints.save([{ path: `public-sources/${input.receipt.id}.bin`, bytes: input.bytes }]);
  const event: SourceEvent = { type: "public_source_retained", contextId: input.contextId, dispatchId: input.receipt.id,
    destinationId: input.receipt.destinationId, url: new URL(input.url).href, sha256: digest(input.bytes), bytes: input.bytes.length, retrievedAt: Date.now(), snapshot };
  const source = verifiedSource(store, checkpoints, input.jobId, event);
  store.append(input.jobId, event);
  return source;
}
