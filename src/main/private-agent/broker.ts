import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { resolvePublicV4, type PublicDnsEvent } from "./network-resolver";
import { BlockList, isIP } from "node:net";
import {
  canonical, contextFingerprint, digest, exactText, restrictedContext, syntheticContext,
  privateAgentId, ExactApprovalSchema, sha256Schema, type ExactApproval, type PrivateAgentContext, type PrivateJobPolicy,
} from "./contracts";
import { isConfirmedAbort, isRetryableAbort, PrivateAgentStore, type DispatchReceipt, type UnknownRequestDiagnostic } from "./store";

export const BROKER_MAX_BODY_BYTES = 192 * 1024;
/** Ceiling for a destination's own request body cap; profiles choose values below it. */
export const BROKER_MAX_DESTINATION_BODY_BYTES = 4 * 1024 * 1024;
/** Ceiling for a destination's transport timeout. The measured remote cut for one long request was about 947 s. */
export const BROKER_MAX_TIMEOUT_MS = 900_000;

export interface BrokerDestination {
  id: string;
  kind: "local_model" | "cloud_model" | "public_web";
  endpoint: string;
  accountId: string;
  credentialVersion: number;
  apiKey?: string;
  /** A positive deployment decision by the host, not a model/provider label. */
  privateDataAdmitted: boolean;
  /** Development-only remote endpoint allowance, requiring wholly synthetic lineage. */
  syntheticOnly?: boolean;
  /** Explicit controlled-receiver fixture allowance, never a general HTTP setting. */
  loopbackFixture?: boolean;
  /**
   * Phase 2 headless cloud arm only: a synthetic-only cloud destination that serves a wholly synthetic lineage without an
   * exact grant. Refused at construction on any other kind, without syntheticOnly, or together with requireExactGrant,
   * so the desktop consultant (synthetic-only, exact grant required) can never become grant-free by omission.
   */
  grantFreeSynthetic?: boolean;
  /** Explicit host-approved public DNS metadata route; never model-controlled. */
  publicDnsResolver?: "cloudflare_v1";
  /** Optional exact public URL authority, including its path and query. */
  exactUrl?: string;
  maxResponseBytes: number;
  timeoutMs: number;
  /** Optional per-destination request body cap; absent means BROKER_MAX_BODY_BYTES. */
  maxRequestBytes?: number;
  /**
   * Owner decision D4: a zero-fee local request or a public GET may be retried at most twice after a confirmed upstream
   * abort. Never valid on a cloud destination; absent keeps every receipt and fingerprint identical to before.
   */
  recoverable?: boolean;
  requireExactGrant?: boolean;
  approvalPriceProfileSha256?: string;
}

export interface ScanResult {
  complete: boolean;
  blocked: boolean;
  detector: string;
}
export interface LocalPacketScanner {
  scan(text: string): Promise<ScanResult>;
}
export interface BrokerRequest {
  jobId: string;
  contextId: string;
  destinationId: string;
  purpose: string;
  method: "GET" | "POST";
  /** Web requests can choose a path only within the host-admitted origin. */
  url?: string;
  body?: string;
  maxFeeMicrousd: number;
  grantId?: string;
  approval?: ExactApproval;
  signal?: AbortSignal;
}
export interface PacketPreview {
  jobId: string; contextId: string; policyRevision: number; contextSha256: string;
  destinationId: string; destinationSha256: string; packetSha256: string;
  purpose: string;
  approval?: ExactApproval;
  /** Local-only review value. Do not put previews in content telemetry. */
  text: string;
}

export class BrokerError extends Error {
  constructor(readonly code: string) { super(code); this.name = "BrokerError"; }
}

type TransportFailureCode = Extract<UnknownRequestDiagnostic, { phase: "transport" }>["code"];
class TransportFailure extends Error {
  constructor(readonly code: TransportFailureCode, readonly status?: number) { super(code); }
}
/** Retries of one recoverable packet: the first attempt plus at most two more, with a short pause between them. */
export const BROKER_MAX_ATTEMPTS = 3;
export const BROKER_RETRY_BACKOFF_MS: readonly number[] = Object.freeze([1000, 3000]);
const CONNECTION_FAILURE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME", "ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL"]);
const UPSTREAM_CLOSED_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED"]);
/** Only fixed socket error codes are classified; anything else stays the generic failure. */
function classifySocketError(error: unknown, sent: boolean): TransportFailureCode {
  const code = typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "";
  if (CONNECTION_FAILURE_CODES.has(code)) return "connection_failed";
  if (UPSTREAM_CLOSED_CODES.has(code)) return sent ? "upstream_closed" : "connection_failed";
  return "transport_failed";
}
function backoff(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); resolve(); };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

function deny(code: string): never { throw new BrokerError(code); }

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/** Reject non-global addresses, including mapped IPv4, before public transports. */
const nonPublicV4 = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) {
  nonPublicV4.addSubnet(network, prefix, "ipv4");
}
const globalV6 = new BlockList(), nonPublicV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) nonPublicV6.addSubnet(network, prefix, "ipv6");
export function isPublicAddress(raw: string): boolean {
  const address = raw.toLowerCase().replace(/^\[|\]$/gu, "");
  if (isIP(address) === 4) return !nonPublicV4.check(address, "ipv4");
  if (isIP(address) === 6) return globalV6.check(address, "ipv6") && !nonPublicV6.check(address, "ipv6");
  return false;
}

function destinationFingerprint(destination: BrokerDestination): string {
  const { apiKey: _key, ...identity } = destination;
  return digest(canonical(identity));
}

function normalizeDestination(value: BrokerDestination): BrokerDestination {
  privateAgentId.parse(value.id);
  const endpoint = new URL(exactText(value.endpoint));
  if (endpoint.username || endpoint.password || endpoint.hash ||
      !["https:", "http:"].includes(endpoint.protocol) ||
      !Number.isSafeInteger(value.maxResponseBytes) || value.maxResponseBytes < 1 || value.maxResponseBytes > 16 * 1024 * 1024 ||
      !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > BROKER_MAX_TIMEOUT_MS ||
      (value.maxRequestBytes !== undefined && (!Number.isSafeInteger(value.maxRequestBytes) || value.maxRequestBytes < 4096 || value.maxRequestBytes > BROKER_MAX_DESTINATION_BODY_BYTES)) ||
      !Number.isSafeInteger(value.credentialVersion) || value.credentialVersion < 0 || !value.accountId) deny("destination_invalid");
  if (endpoint.protocol !== "https:" && !(value.loopbackFixture && isLoopback(endpoint.hostname)) &&
      !(value.kind === "local_model" && value.syntheticOnly)) deny("destination_tls_required");
  if (value.loopbackFixture && !isLoopback(endpoint.hostname)) deny("destination_fixture_invalid");
  if ((value.requireExactGrant !== undefined && typeof value.requireExactGrant !== "boolean") ||
      (value.requireExactGrant === true) !== (value.approvalPriceProfileSha256 !== undefined) ||
      (value.approvalPriceProfileSha256 !== undefined && !sha256Schema.safeParse(value.approvalPriceProfileSha256).success)) deny("destination_approval_invalid");
  if (value.kind === "public_web" && value.apiKey) deny("web_ambient_credential_denied");
  if (value.recoverable !== undefined && (typeof value.recoverable !== "boolean" || value.kind === "cloud_model")) deny("destination_recoverable_invalid");
  if (value.grantFreeSynthetic !== undefined && (value.grantFreeSynthetic !== true || value.kind !== "cloud_model" || !value.syntheticOnly || value.requireExactGrant ||
      value.approvalPriceProfileSha256 !== undefined || value.privateDataAdmitted)) deny("destination_grant_free_invalid");
  if (value.publicDnsResolver !== undefined && (value.publicDnsResolver !== "cloudflare_v1" || value.kind !== "public_web" ||
      endpoint.protocol !== "https:" || value.loopbackFixture || isIP(endpoint.hostname.replace(/^\[|\]$/gu, "")))) deny("destination_public_dns_invalid");
  if (value.syntheticOnly && value.privateDataAdmitted) deny("destination_trust_conflict");
  let exactUrl: string | undefined;
  if (value.exactUrl !== undefined) {
    const allowed = new URL(exactText(value.exactUrl));
    if (value.kind !== "public_web" || allowed.origin !== endpoint.origin || allowed.username || allowed.password || allowed.hash ||
        allowed.href.length > 8192 || (allowed.protocol !== "https:" && !value.loopbackFixture)) deny("destination_exact_url_invalid");
    exactUrl = allowed.href;
  }
  return Object.freeze({ ...value, endpoint: endpoint.href, ...(exactUrl === undefined ? {} : { exactUrl }) });
}

/**
 * The only network owner for the new private-agent route. The model and sandbox
 * receive tool schemas and observations, never this object or its credentials.
 */
export class PrivateAgentBroker {
  private readonly destinations = new Map<string, BrokerDestination>();
  private readonly active = new Map<string, Set<AbortController>>();
  constructor(readonly store: PrivateAgentStore, destinations: BrokerDestination[], private readonly scanner: LocalPacketScanner) {
    for (const value of destinations) {
      const destination = normalizeDestination(value);
      if (this.destinations.has(destination.id)) deny("destination_duplicate");
      this.destinations.set(destination.id, destination);
    }
  }

  private packet(input: BrokerRequest): { destination: BrokerDestination; url: URL; text: string; preview: PacketPreview } {
    const destination = this.destinations.get(input.destinationId);
    if (!destination) deny("destination_missing");
    const policy = this.store.policy(input.jobId), context = this.store.context(input.contextId);
    if (context.jobId !== policy.id || !input.purpose || input.purpose.length > 500) deny("packet_context_invalid");
    exactText(input.purpose);
    const endpoint = new URL(destination.endpoint), url = new URL(input.url ?? destination.endpoint);
    if (url.username || url.password || url.hash || url.origin !== endpoint.origin ||
        (destination.kind !== "public_web" && url.href !== endpoint.href) ||
        (destination.exactUrl !== undefined && url.href !== destination.exactUrl)) deny("packet_destination_drift");
    if ((destination.kind === "public_web" && (input.method !== "GET" || input.body !== undefined)) ||
        (destination.kind !== "public_web" && input.method !== "POST")) deny("packet_method_denied");
    const body = exactText(input.body ?? "");
    const parsedApproval = input.approval === undefined ? undefined : ExactApprovalSchema.safeParse(input.approval);
    if (parsedApproval && !parsedApproval.success) deny("packet_approval_invalid");
    const approval = parsedApproval?.success ? parsedApproval.data : undefined;
    if (approval && (!destination.requireExactGrant || approval.priceProfileSha256 !== destination.approvalPriceProfileSha256 ||
        approval.maxFeeMicrousd !== input.maxFeeMicrousd)) deny("packet_approval_mismatch");
    if (Buffer.byteLength(body) > (destination.maxRequestBytes ?? BROKER_MAX_BODY_BYTES) || url.href.length > 8192) deny("packet_size_exceeded");
    // All custom headers are host-owned and serialized into the grant preview.
    // The broker injects a service credential only after admission, never as data.
    const text = canonical({ method: input.method, url: url.href,
      headers: input.method === "POST" ? { "content-type": "application/json" } : {}, body });
    if ([...this.destinations.values()].some(item => item.apiKey && text.includes(item.apiKey))) deny("credential_in_packet");
    const preview: PacketPreview = {
      jobId: policy.id, contextId: context.id, policyRevision: policy.revision,
      contextSha256: contextFingerprint(context), destinationId: destination.id,
      destinationSha256: destinationFingerprint(destination), packetSha256: digest(text),
      purpose: input.purpose, text,
      ...(approval ? { approval } : {}),
    };
    return { destination, url, text, preview };
  }

  preview(input: BrokerRequest): PacketPreview { return this.packet(input).preview; }

  private eligible(policy: PrivateJobPolicy, context: PrivateAgentContext, destination: BrokerDestination, grantId?: string): void {
    if (policy.cancelled) deny("job_cancelled");
    if (destination.requireExactGrant && !grantId) deny("exact_grant_required");
    if (destination.publicDnsResolver && restrictedContext(context)) deny("public_dns_requires_public_context");
    if (context.sources.some(source => source.classification === "credential")) deny("credential_context_denied");
    if (policy.mode === "offline" && !(destination.kind === "local_model" && isLoopback(new URL(destination.endpoint).hostname))) deny("offline_network_denied");
    if (destination.kind === "cloud_model" && policy.mode !== "cloud_help") deny("cloud_mode_denied");
    if (destination.syntheticOnly && !syntheticContext(context)) deny("synthetic_destination_private_data_denied");
    if (destination.kind === "local_model") {
      if (restrictedContext(context) && !destination.privateDataAdmitted &&
          !(destination.syntheticOnly && syntheticContext(context))) deny("local_destination_unverified");
    } else if (restrictedContext(context) && !grantId &&
        // Only a destination constructed as grant-free (the headless Phase 2 arm) serves a wholly synthetic lineage without a grant;
        // the desktop consultant is synthetic-only too but carries an exact-grant binding and is denied above and here.
        !(destination.grantFreeSynthetic === true && syntheticContext(context))) deny("private_disclosure_requires_exact_grant");
  }

  async request(input: BrokerRequest, settleFee: (bytes: Buffer) => number = () => 0, validateAtCommit?: () => void): Promise<{ bytes: Buffer; receipt: DispatchReceipt }> {
    if (input.signal?.aborted) deny("request_cancelled");
    // Snapshot every model-derived value before an asynchronous scan can yield.
    const frozen: BrokerRequest = { ...input };
    const packet = this.packet(frozen);
    if (packet.destination.requireExactGrant && !packet.preview.approval) deny("exact_grant_required");
    this.eligible(this.store.policy(frozen.jobId), this.store.context(frozen.contextId), packet.destination, frozen.grantId);
    let scanReceipt: DispatchReceipt["scan"];
    if (packet.destination.kind === "local_model" && (packet.destination.privateDataAdmitted || packet.destination.syntheticOnly)) {
      // Detector failure cannot stop permitted computation within the admitted
      // boundary. Known credentials and provenance are still enforced above and
      // revalidated at commit. Synthetic deployment is recorded distinctly.
      scanReceipt = { status: packet.destination.privateDataAdmitted ? "not_required_inside_boundary" : "not_required_for_synthetic_local_test" };
    } else {
      let scan: ScanResult;
      try { scan = await this.scanner.scan(packet.text); } catch { return deny("packet_scan_failed"); }
      if (!scan || scan.complete !== true || scan.blocked !== false || typeof scan.detector !== "string" || !scan.detector) deny("packet_scan_incomplete_or_blocked");
      scanReceipt = { status: "complete", detector: scan.detector };
    }
    if (frozen.signal?.aborted) deny("request_cancelled");
    const { text: _text, ...identity } = packet.preview;
    // A zero-risk packet can be re-sent without cost or side effect: a zero-fee local request or a public GET without a grant.
    const zeroRisk = frozen.grantId === undefined && !packet.preview.approval &&
      ((packet.destination.kind === "local_model" && frozen.maxFeeMicrousd === 0) || (packet.destination.kind === "public_web" && frozen.method === "GET"));
    // D4: only such a packet, on a destination flagged recoverable, is retried, and only after a confirmed abort.
    const recoverable = packet.destination.recoverable === true && zeroRisk;
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1 && frozen.signal?.aborted) deny("request_cancelled");
      // Each attempt is its own committed row: it re-checks eligibility and consumes one session request.
      let receipt: DispatchReceipt;
      try {
        receipt = this.store.commit({ ...identity, reservedFeeMicrousd: frozen.maxFeeMicrousd, scan: scanReceipt },
          (policy, context) => { this.eligible(policy, context, packet.destination, frozen.grantId); validateAtCommit?.(); }, frozen.grantId);
      } catch (error) {
        // The fee or request allowance refused the row inside the transaction: nothing was inserted or sent.
        if (error instanceof Error && error.message === "private_agent_budget_denied") deny("budget_denied");
        throw error;
      }
      const controller = new AbortController();
      const group = this.active.get(frozen.jobId) ?? new Set<AbortController>();
      group.add(controller); this.active.set(frozen.jobId, group);
      const cancel = () => controller.abort();
      frozen.signal?.addEventListener("abort", cancel, { once: true });
      if (frozen.signal?.aborted) controller.abort();
      const started = performance.now();
      let phase: "transport" | "response_validation" | "fee_settlement" = "transport";
      try {
        const bytes = await transport(packet.destination, packet.url, frozen.method, frozen.body, controller.signal, event => {
          this.store.append(frozen.jobId, { ...event, contextId: frozen.contextId, dispatchId: receipt.id });
        });
        phase = "response_validation";
        const fee = settleFee(bytes);
        phase = "fee_settlement";
        this.store.settle(receipt.id, fee, digest(bytes));
        return { bytes, receipt: this.store.dispatch(receipt.id) };
      } catch (error) {
        // Timing is monotonic, excludes pre-commit scanning, and saturates at one
        // hour rather than admitting arbitrary numeric diagnostics into storage.
        const timing = { elapsedMs: Math.min(3_600_000, Math.max(0, Math.floor(performance.now() - started))), timeoutMs: packet.destination.timeoutMs,
          ...(recoverable ? { attempt } : {}) };
        // Only a status the diagnostic schema admits is recorded; a malformed one leaves no status.
        const status = error instanceof TransportFailure && error.status !== undefined && error.status >= 100 && error.status <= 599 ? { status: error.status } : {};
        const failure: UnknownRequestDiagnostic = phase === "transport"
          ? { phase: "transport", code: error instanceof TransportFailure ? error.code : "transport_failed", ...status, ...timing }
          : { phase: "settlement", code: phase === "response_validation" ? "response_or_usage_invalid" : "fee_settlement_failed", ...timing };
        if (!isConfirmedAbort(failure, zeroRisk)) {
          this.store.unknown(receipt.id, failure);
          // Never expose provider text, private URL, system exception or API key.
          return deny("transport_or_settlement_unknown");
        }
        // Another attempt needs a free session request; the committed row only becomes `superseded` once the retry is certain.
        const admissible = this.store.dispatches(frozen.jobId).length < this.store.policy(frozen.jobId).maxRequests;
        if (recoverable && isRetryableAbort(failure) && attempt < BROKER_MAX_ATTEMPTS && admissible && !frozen.signal?.aborted) {
          await backoff(BROKER_RETRY_BACKOFF_MS[attempt - 1] ?? BROKER_RETRY_BACKOFF_MS.at(-1)!, frozen.signal);
          if (!frozen.signal?.aborted) { this.store.resolveFailure(receipt.id, "superseded", failure, zeroRisk); continue; }
        }
        // A confirmed abort with no attempt to follow is a resolved failure: the ledger stays replay-safe and never blocks.
        this.store.resolveFailure(receipt.id, "failed", failure, zeroRisk);
        return deny("request_failed");
      } finally {
        frozen.signal?.removeEventListener("abort", cancel);
        group.delete(controller);
        if (!group.size) this.active.delete(frozen.jobId);
      }
    }
  }

  cancelJob(jobId: string): void {
    // Durable acknowledgement precedes cancellation of requests already committed.
    this.store.cancel(jobId);
    this.active.get(jobId)?.forEach(controller => controller.abort());
  }
}

async function systemLookup(host: string, signal: AbortSignal) {
  if (signal.aborted) deny("transport_cancelled");
  let abort: (() => void) | undefined;
  try {
    // The OS lookup itself is not cancellable. Stop awaiting it at the request
    // boundary and consume any late result/rejection without dispatch or retry.
    return await Promise.race([lookup(host, { all: true, verbatim: true }), new Promise<never>((_, reject) => {
      abort = () => reject(new BrokerError("transport_cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { if (abort) signal.removeEventListener("abort", abort); }
}

async function transport(destination: BrokerDestination, url: URL, method: "GET" | "POST", body: string | undefined,
  signal: AbortSignal, recordDns: (event: PublicDnsEvent) => void): Promise<Buffer> {
  const controller = new AbortController();
  // Latch the first abort source. A later task cancel cannot relabel an already
  // fired request timer, and an external signal's arbitrary reason is ignored.
  let abortCause: "request_timeout" | "cancelled" | undefined;
  const externalAbort = () => { abortCause ??= "cancelled"; controller.abort(); };
  signal.addEventListener("abort", externalAbort, { once: true });
  if (signal.aborted) externalAbort();
  const timeout = setTimeout(() => { abortCause ??= "request_timeout"; controller.abort(); }, destination.timeoutMs);
  const joined = controller.signal;
  const transportError = () => new TransportFailure(abortCause ?? "transport_failed");
  try {
    const host = url.hostname.replace(/^\[|\]$/gu, "");
    // Resolve once, validate every answer and pin the selected address to prevent
    // re-resolution/DNS rebinding between policy evaluation and connection.
    let addresses: { address: string; family: number }[];
    try {
      addresses = destination.publicDnsResolver === "cloudflare_v1"
        ? await resolvePublicV4(host, joined, isPublicAddress, recordDns)
        : isIP(host) ? [{ address: host, family: isIP(host) }] : await systemLookup(host, joined);
    } catch (error) {
      // Nothing was sent: a failed lookup is a confirmed non-dispatch unless SOAR itself aborted it.
      if (error instanceof TransportFailure) throw error;
      throw abortCause ? transportError() : new TransportFailure("connection_failed");
    }
    if (joined.aborted) throw transportError();
    const allowPrivate = destination.kind === "local_model" || destination.loopbackFixture;
    // Nothing was sent, so a denied address is a confirmed non-dispatch.
    if (!addresses.length || (!allowPrivate && addresses.some(item => !isPublicAddress(item.address)))) throw new TransportFailure("connection_failed");
    const selected = addresses[0]!;
    return await new Promise<Buffer>((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (method === "POST") { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(body ?? "")); }
      if (destination.apiKey) headers.authorization = `Bearer ${destination.apiKey}`;
      const request = (url.protocol === "https:" ? https : http).request(url, {
        method, headers, signal: joined, agent: false,
        ...(destination.publicDnsResolver ? { servername: host, rejectUnauthorized: true } : {}),
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all) callback(null, [{ address: selected.address, family: selected.family }]);
          else callback(null, selected.address, selected.family);
        },
      }, response => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new TransportFailure("http_rejected", response.statusCode)); response.destroy(); return;
        }
        const length = response.headers["content-length"];
        if (length && (!/^\d+$/u.test(length) || Number(length) > destination.maxResponseBytes)) {
          reject(new TransportFailure("response_oversize")); response.destroy(); return;
        }
        const chunks: Buffer[] = []; let count = 0;
        response.on("data", (chunk: Buffer) => {
          count += chunk.length;
          if (count > destination.maxResponseBytes) { reject(new TransportFailure("response_oversize")); response.destroy(); }
          else chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
        // The response had started: the upstream executed the request, so this is confirmed only for a zero-risk packet.
        response.on("error", () => reject(abortCause ? transportError() : new TransportFailure("response_interrupted")));
        response.on("aborted", () => reject(abortCause ? transportError() : new TransportFailure("response_interrupted")));
      });
      let sent = false;
      request.on("socket", socket => socket.once("connect", () => { sent = true; }));
      request.on("error", error => reject(abortCause ? transportError() : new TransportFailure(classifySocketError(error, sent))));
      request.end(body);
    });
  } catch (error) {
    // Preserve a fixed error observed at the transport boundary; never map an
    // arbitrary exception message or a later settlement error into this phase.
    if (error instanceof TransportFailure) throw error;
    throw abortCause ? transportError() : new TransportFailure(classifySocketError(error, false));
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", externalAbort); }
}
