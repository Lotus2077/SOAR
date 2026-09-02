import { request, type ClientRequest, type IncomingMessage } from "node:http";

import {
  CloudApplicationRequestV1Schema,
  canonicalPr6rJsonV1,
  type CloudApplicationRequestV1,
} from "../../shared/pr6r-development-contracts";
import {
  PR6R_MAX_LOOPBACK_RESPONSE_BYTES,
  Pr6rLoopbackResponseError,
  parsePr6rLoopbackResponse,
  sha256Pr6rLoopbackBytes,
  type Pr6rLoopbackNormalizedUsage,
  type Pr6rParsedLoopbackResponse,
} from "./loopback-response";
import {
  consumePr6rLoopbackDispatchGrant,
  type Pr6rConsumedLoopbackDispatch,
  type Pr6rLoopbackDispatchGrant,
} from "./loopback-transport-authority";

export const PR6R_LOOPBACK_TOTAL_DEADLINE_MS = 30_000 as const;

export interface Pr6rLoopbackTransportSuccess {
  readonly outcome: "succeeded";
  readonly requestDisposition: "sent";
  readonly stableCode: "completed";
  readonly durationMs: number;
  readonly response: Pr6rParsedLoopbackResponse;
}

export interface Pr6rLoopbackTransportFailure {
  readonly outcome: "failed";
  readonly requestDisposition: "sent" | "unknown";
  readonly stableCode:
    | Pr6rLoopbackResponseError["code"]
    | "loopback.dispatch_unknown"
    | "loopback.timeout";
  readonly durationMs: number;
  readonly responseBodySha256?: string;
  readonly usage?: Pr6rLoopbackNormalizedUsage;
}

export interface Pr6rLoopbackTransportCancellation {
  readonly outcome: "cancelled";
  readonly requestDisposition: "unknown";
  readonly stableCode: "loopback.cancelled_after_dispatch";
  readonly durationMs: number;
}

export type Pr6rLoopbackTransportResult =
  | Pr6rLoopbackTransportSuccess
  | Pr6rLoopbackTransportFailure
  | Pr6rLoopbackTransportCancellation;

type Pr6rLoopbackResponseParser = typeof parsePr6rLoopbackResponse;

/**
 * Classify one complete response body. This pure seam is deliberately not an
 * authority mint: dispatch brands only the result it receives from the live
 * socket path.
 */
export function classifyPr6rCompleteLoopbackResponse(input: {
  readonly applicationRequest: CloudApplicationRequestV1;
  readonly statusCode: number;
  readonly rawHeaders: readonly string[];
  readonly rawTrailers: readonly string[];
  readonly informationalResponseCount: number;
  readonly body: Uint8Array;
  readonly durationMs: number;
  readonly parseResponse?: Pr6rLoopbackResponseParser;
}): Pr6rLoopbackTransportSuccess | Pr6rLoopbackTransportFailure {
  if (input.body.byteLength > PR6R_MAX_LOOPBACK_RESPONSE_BYTES) {
    return Object.freeze({
      outcome: "failed" as const,
      requestDisposition: "sent" as const,
      stableCode: "loopback.response_too_large" as const,
      durationMs: input.durationMs,
    });
  }
  const responseBodySha256 = sha256Pr6rLoopbackBytes(input.body);
  try {
    const parsed = (input.parseResponse ?? parsePr6rLoopbackResponse)({
      applicationRequest: input.applicationRequest,
      statusCode: input.statusCode,
      rawHeaders: input.rawHeaders,
      rawTrailers: input.rawTrailers,
      informationalResponseCount: input.informationalResponseCount,
      body: input.body,
    });
    return Object.freeze({
      outcome: "succeeded" as const,
      requestDisposition: "sent" as const,
      stableCode: "completed" as const,
      durationMs: input.durationMs,
      response: parsed,
    });
  } catch (error) {
    if (!(error instanceof Pr6rLoopbackResponseError)) {
      return Object.freeze({
        outcome: "failed" as const,
        requestDisposition: "sent" as const,
        stableCode: "loopback.invalid_response" as const,
        durationMs: input.durationMs,
        responseBodySha256,
      });
    }
    return Object.freeze({
      outcome: "failed" as const,
      requestDisposition: error.requestDisposition,
      stableCode: error.code,
      durationMs: input.durationMs,
      ...(error.code === "loopback.response_too_large"
        ? {}
        : {
            responseBodySha256:
              error.responseBodySha256 ?? responseBodySha256,
          }),
      ...(error.usage === undefined ? {} : { usage: error.usage }),
    });
  }
}

export interface Pr6rConsumedLoopbackTransportResult {
  readonly applicationRequest: CloudApplicationRequestV1;
  readonly reservationId: string;
  readonly result: Pr6rLoopbackTransportResult;
  readonly sqliteDispatchChain: Pr6rConsumedLoopbackDispatch["sqliteDispatchChain"];
}

interface TransportResultPrivateState {
  readonly applicationRequest: CloudApplicationRequestV1;
  readonly reservationId: string;
  readonly sqliteDispatchChain: Pr6rConsumedLoopbackDispatch["sqliteDispatchChain"];
  consumed: boolean;
}

const transportResultPrivateState = new WeakMap<
  Pr6rLoopbackTransportResult,
  TransportResultPrivateState
>();

export class Pr6rLoopbackTransportEvidenceError extends Error {
  constructor(
    readonly code:
      | "loopback_transport_evidence_invalid"
      | "loopback_transport_evidence_mismatch"
      | "loopback_transport_evidence_consumed",
  ) {
    super(code);
    this.name = "Pr6rLoopbackTransportEvidenceError";
  }
}

/** Burn and bind one genuine transport outcome before finish/accounting use. */
export function consumePr6rLoopbackTransportResult(
  result: Pr6rLoopbackTransportResult,
  input: {
    readonly applicationRequest: unknown;
    readonly reservationId: string;
  },
): Pr6rConsumedLoopbackTransportResult {
  const state = transportResultPrivateState.get(result);
  if (state === undefined) {
    throw new Pr6rLoopbackTransportEvidenceError(
      "loopback_transport_evidence_invalid",
    );
  }
  if (state.consumed) {
    throw new Pr6rLoopbackTransportEvidenceError(
      "loopback_transport_evidence_consumed",
    );
  }
  const request = CloudApplicationRequestV1Schema.safeParse(
    input.applicationRequest,
  );
  if (
    !request.success ||
    input.reservationId !== state.reservationId ||
    canonicalPr6rJsonV1(request.data) !==
      canonicalPr6rJsonV1(state.applicationRequest)
  ) {
    throw new Pr6rLoopbackTransportEvidenceError(
      "loopback_transport_evidence_mismatch",
    );
  }
  state.consumed = true;
  return Object.freeze({
    applicationRequest: state.applicationRequest,
    reservationId: state.reservationId,
    result,
    sqliteDispatchChain: state.sqliteDispatchChain,
  });
}

function boundedDuration(startedAt: bigint): number {
  const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
  const elapsedMilliseconds = Number(elapsedNanoseconds) / 1_000_000;
  return Math.max(0, Math.min(86_400_000, Math.ceil(elapsedMilliseconds)));
}

/**
 * Consume the nominal dispatch grant synchronously, then construct exactly one
 * direct HTTP request. This function never redirects, retries, or reuses a
 * connection and returns no raw response or socket diagnostics.
 */
export function dispatchPr6rLoopbackRequest(input: {
  readonly grant: Pr6rLoopbackDispatchGrant;
  readonly applicationRequest: CloudApplicationRequestV1;
  readonly signal?: AbortSignal;
}): Promise<Pr6rLoopbackTransportResult> {
  const dispatch = consumePr6rLoopbackDispatchGrant(
    input.grant,
    input.applicationRequest,
  );
  const startedAt = process.hrtime.bigint();

  return new Promise((resolve) => {
    let settled = false;
    let transportRequest: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let informationalResponseCount = 0;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (result: Pr6rLoopbackTransportResult): void => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
      transportResultPrivateState.set(result, {
        applicationRequest: dispatch.applicationRequest,
        reservationId: dispatch.reservationId,
        sqliteDispatchChain: dispatch.sqliteDispatchChain,
        consumed: false,
      });
      resolve(result);
    };
    const finishUnknown = (
      stableCode: "loopback.dispatch_unknown" | "loopback.timeout",
    ): void => {
      finish(
        Object.freeze({
          outcome: "failed" as const,
          requestDisposition: "unknown" as const,
          stableCode,
          durationMs: boundedDuration(startedAt),
        }),
      );
    };
    const onAbort = (): void => {
      finish(
        Object.freeze({
          outcome: "cancelled" as const,
          requestDisposition: "unknown" as const,
          stableCode: "loopback.cancelled_after_dispatch" as const,
          durationMs: boundedDuration(startedAt),
        }),
      );
      response?.destroy();
      transportRequest?.destroy();
    };

    timeout = setTimeout(() => {
      finishUnknown("loopback.timeout");
      response?.destroy();
      transportRequest?.destroy();
    }, PR6R_LOOPBACK_TOTAL_DEADLINE_MS);
    timeout.unref();

    if (input.signal?.aborted === true) {
      onAbort();
      return;
    }
    input.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const requestBody = Buffer.from(
        dispatch.applicationRequest.canonicalBodyUtf8,
      );
      if (
        requestBody.byteLength !==
          dispatch.applicationRequest.canonicalBodyByteLength ||
        sha256Pr6rLoopbackBytes(requestBody) !==
          dispatch.applicationRequest.canonicalBodySha256
      ) {
        finishUnknown("loopback.dispatch_unknown");
        return;
      }
      transportRequest = request(
        {
          protocol: "http:",
          hostname: dispatch.host,
          port: dispatch.port,
          family: dispatch.host === "::1" ? 6 : 4,
          method: "POST",
          path: dispatch.applicationRequest.path,
          agent: false,
          setHost: false,
          setDefaultHeaders: false,
          joinDuplicateHeaders: false,
          maxHeaderSize: 8_192,
          insecureHTTPParser: false,
          headers: {
            Accept: dispatch.applicationRequest.headers.accept,
            Connection: "close",
            "Content-Length": String(requestBody.byteLength),
            "Content-Type": dispatch.applicationRequest.headers["content-type"],
            Host:
              dispatch.host === "::1"
                ? `[::1]:${dispatch.port}`
                : `127.0.0.1:${dispatch.port}`,
          },
        },
        (incoming) => {
          if (settled) {
            incoming.destroy();
            return;
          }
          response = incoming;
          const chunks: Buffer[] = [];
          let responseBytes = 0;
          incoming.on("data", (chunk: Buffer | string) => {
            if (settled) return;
            const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
            responseBytes += buffer.byteLength;
            if (responseBytes > PR6R_MAX_LOOPBACK_RESPONSE_BYTES) {
              finish(
                Object.freeze({
                  outcome: "failed" as const,
                  requestDisposition: "sent" as const,
                  stableCode: "loopback.response_too_large" as const,
                  durationMs: boundedDuration(startedAt),
                }),
              );
              incoming.destroy();
              return;
            }
            chunks.push(buffer);
          });
          incoming.once("aborted", () => {
            if (!settled) finishUnknown("loopback.dispatch_unknown");
          });
          incoming.once("error", () => {
            if (!settled) finishUnknown("loopback.dispatch_unknown");
          });
          incoming.once("end", () => {
            if (settled) return;
            if (!incoming.complete) {
              finishUnknown("loopback.dispatch_unknown");
              return;
            }
            const body = Buffer.concat(chunks, responseBytes);
            finish(
              classifyPr6rCompleteLoopbackResponse({
                applicationRequest: dispatch.applicationRequest,
                statusCode: incoming.statusCode ?? 0,
                rawHeaders: incoming.rawHeaders,
                rawTrailers: incoming.rawTrailers,
                informationalResponseCount,
                body,
                durationMs: boundedDuration(startedAt),
              }),
            );
          });
        },
      );
      transportRequest.once("information", () => {
        informationalResponseCount += 1;
      });
      transportRequest.once("error", () => {
        if (!settled) finishUnknown("loopback.dispatch_unknown");
      });
      if (
        requestBody.byteLength !==
          dispatch.applicationRequest.canonicalBodyByteLength ||
        sha256Pr6rLoopbackBytes(requestBody) !==
          dispatch.applicationRequest.canonicalBodySha256
      ) {
        finishUnknown("loopback.dispatch_unknown");
        transportRequest.destroy();
        return;
      }
      transportRequest.end(requestBody);
    } catch {
      transportRequest?.destroy();
      finishUnknown("loopback.dispatch_unknown");
    }
  });
}
