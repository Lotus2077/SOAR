import https from "node:https";
import { checkServerIdentity } from "node:tls";
import { isIP } from "node:net";
import { createHash } from "node:crypto";

const RESOLVER = "cloudflare_v1" as const;
const MAX_BYTES = 16 * 1024;
type Failure = "public_dns_response_invalid" | "public_dns_address_denied" | "public_dns_transport_failed" | "public_dns_cancelled";
export class PublicDnsError extends Error {
  constructor(readonly code: Failure) { super(code); }
}
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export type PublicDnsEvent = {
  type: "public_dns_started" | "public_dns_finished";
  resolverId: typeof RESOLVER;
  queryHostnameSha256: string;
  queryType: "A";
  status: "started" | "settled" | "failed";
  responseSha256?: string;
  addressCount?: number;
  elapsedMs?: number;
  errorCode?: Failure;
};
function name(raw: unknown): string {
  if (typeof raw !== "string") throw new PublicDnsError("public_dns_response_invalid");
  const value = raw.toLowerCase().replace(/\.$/u, "");
  if (value.length > 253 || value.split(".").length < 2 || value.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
    throw new PublicDnsError("public_dns_response_invalid");
  }
  return value;
}

/** Provider-specific, bounded A answer; every alias/address must belong to this question. */
export function parsePublicDnsAnswer(bytes: Buffer, hostname: string, isPublicAddress: (address: string) => boolean): { address: string; family: 4 }[] {
  const expected = name(hostname);
  let response: Record<string, unknown>;
  try { response = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new PublicDnsError("public_dns_response_invalid"); }
  if (bytes.length > MAX_BYTES || !response || typeof response !== "object" || response.Status !== 0 || response.TC !== false ||
      !Array.isArray(response.Question) || response.Question.length !== 1 || response.Question[0]?.type !== 1 || name(response.Question[0]?.name) !== expected ||
      !Array.isArray(response.Answer) || response.Answer.length < 1 || response.Answer.length > 64) throw new PublicDnsError("public_dns_response_invalid");
  const aliases = new Map<string, string>(), addresses: { owner: string; address: string; family: 4 }[] = [];
  for (const row of response.Answer) {
    if (!row || typeof row !== "object" || !Number.isSafeInteger(row.TTL) || row.TTL < 0 || row.TTL > 2147483647) throw new PublicDnsError("public_dns_response_invalid");
    const owner = name(row.name);
    if (row.type === 5) {
      if (aliases.has(owner)) throw new PublicDnsError("public_dns_response_invalid");
      aliases.set(owner, name(row.data));
    } else if (row.type === 1) {
      if (typeof row.data !== "string" || isIP(row.data) !== 4 || !isPublicAddress(row.data)) throw new PublicDnsError("public_dns_address_denied");
      addresses.push({ owner, address: row.data, family: 4 });
    } else throw new PublicDnsError("public_dns_response_invalid");
  }
  let terminal = expected; const seen = new Set<string>();
  while (aliases.has(terminal)) {
    if (seen.has(terminal) || seen.size >= 8) throw new PublicDnsError("public_dns_response_invalid");
    seen.add(terminal); terminal = aliases.get(terminal)!;
  }
  if (seen.size !== aliases.size || !addresses.length || addresses.some(row => row.owner !== terminal) ||
      new Set(addresses.map(row => row.address)).size !== addresses.length) throw new PublicDnsError("public_dns_response_invalid");
  return addresses.map(({ address, family }) => ({ address, family }));
}

function query(hostname: string, signal: AbortSignal): Promise<Buffer> {
  if (signal.aborted) throw new PublicDnsError("public_dns_cancelled");
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.search = new URLSearchParams({ name: hostname, type: "A", cd: "false" }).toString();
  return new Promise<Buffer>((resolve, reject) => {
    const request = https.request(url, { method: "GET", agent: false, family: 4, signal,
      headers: { accept: "application/dns-json" }, servername: "cloudflare-dns.com", rejectUnauthorized: true,
      checkServerIdentity: (_hostname, certificate) => checkServerIdentity("cloudflare-dns.com", certificate),
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [{ address: "1.1.1.1", family: 4 }]);
        else callback(null, "1.1.1.1", 4);
      },
    }, response => {
      if (response.statusCode !== 200 || response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/dns-json") {
        response.destroy(); reject(new PublicDnsError("public_dns_transport_failed")); return;
      }
      const length = response.headers["content-length"];
      if (length && (!/^\d+$/u.test(length) || Number(length) > MAX_BYTES)) { response.destroy(); reject(new PublicDnsError("public_dns_response_invalid")); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { response.destroy(); reject(new PublicDnsError("public_dns_response_invalid")); }
        else chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", () => reject(new PublicDnsError("public_dns_transport_failed")));
      response.on("aborted", () => reject(new PublicDnsError("public_dns_transport_failed")));
    });
    request.on("error", () => reject(new PublicDnsError(signal.aborted ? "public_dns_cancelled" : "public_dns_transport_failed")));
    request.end();
  });
}

/** One explicit metadata exchange, no cache, retry, alternate resolver, or OS DNS fallback. */
export async function resolvePublicV4(hostname: string, signal: AbortSignal, isPublicAddress: (address: string) => boolean,
  emit: (event: PublicDnsEvent) => void): Promise<{ address: string; family: 4 }[]> {
  const normalized = name(hostname), startedAt = performance.now();
  const identity = { resolverId: RESOLVER, queryHostnameSha256: hash(normalized), queryType: "A" as const };
  if (signal.aborted) throw new PublicDnsError("public_dns_cancelled");
  emit({ ...identity, type: "public_dns_started", status: "started" });
  let result: { address: string; family: 4 }[] | undefined, failure: Failure | undefined, responseSha256: string | undefined;
  try {
    const bytes = await query(normalized, AbortSignal.any([signal, AbortSignal.timeout(10000)]));
    responseSha256 = hash(bytes); result = parsePublicDnsAnswer(bytes, normalized, isPublicAddress);
  } catch (error) { failure = error instanceof PublicDnsError ? error.code : "public_dns_transport_failed"; }
  emit({ ...identity, type: "public_dns_finished", status: failure ? "failed" : "settled", elapsedMs: performance.now() - startedAt,
    ...(responseSha256 ? { responseSha256 } : {}), ...(result ? { addressCount: result.length } : {}), ...(failure ? { errorCode: failure } : {}) });
  if (failure || !result) throw new PublicDnsError(failure ?? "public_dns_transport_failed");
  return result;
}
