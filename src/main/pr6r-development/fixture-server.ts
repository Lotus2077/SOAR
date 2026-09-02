import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  PR6R_LOOPBACK_CHAT_COMPLETIONS_PATH,
  PR6R_MAX_CANONICAL_APPLICATION_BODY_BYTES,
} from "../../shared/pr6r-development-contracts";

const DEFAULT_MAX_REQUESTS = 2;
const SERVER_TIMEOUT_MS = 30_000;

export type Pr6rLoopbackHost = "127.0.0.1" | "::1";

export interface Pr6rFixtureListenerCapability {
  readonly origin: string;
  readonly host: Pr6rLoopbackHost;
  readonly port: number;
}

export interface Pr6rCapturedFixtureRequest {
  readonly method: string;
  readonly path: string;
  readonly rawHeaders: readonly string[];
  readonly body: Uint8Array;
}

export interface Pr6rFixtureResponse {
  readonly statusCode?: number;
  readonly headers?: readonly (readonly [string, string])[];
  readonly body: Uint8Array;
  readonly trailers?: readonly (readonly [string, string])[];
  readonly stallAfterHeaders?: boolean;
  readonly bodyPrefixBytes?: number;
}

export interface Pr6rLoopbackFixtureServer {
  readonly listenerCapability: Pr6rFixtureListenerCapability;
  readonly requests: readonly Pr6rCapturedFixtureRequest[];
  /** Every parsed inbound request, including invalid and over-limit requests. */
  readonly observedRequestCount: number;
  close(): Promise<void>;
}

interface ListenerPrivateState {
  readonly server: ReturnType<typeof createServer>;
  readonly origin: string;
  readonly host: Pr6rLoopbackHost;
  readonly port: number;
  active: boolean;
}

const listenerPrivateState = new WeakMap<
  Pr6rFixtureListenerCapability,
  ListenerPrivateState
>();

export class Pr6rFixtureServerError extends Error {
  constructor(
    readonly code:
      | "fixture_listener_invalid"
      | "fixture_listener_unavailable"
      | "fixture_request_invalid",
  ) {
    super(code);
    this.name = "Pr6rFixtureServerError";
  }
}

export interface Pr6rFixtureListenerBinding {
  readonly origin: string;
  readonly host: Pr6rLoopbackHost;
  readonly port: number;
}

/** Revalidate a nominal capability without exposing its server handle. */
export function readPr6rFixtureListenerBinding(
  capability: Pr6rFixtureListenerCapability,
): Pr6rFixtureListenerBinding {
  const state = listenerPrivateState.get(capability);
  if (state === undefined) {
    throw new Pr6rFixtureServerError("fixture_listener_invalid");
  }
  if (!state.active || !state.server.listening) {
    throw new Pr6rFixtureServerError("fixture_listener_unavailable");
  }
  return Object.freeze({
    origin: state.origin,
    host: state.host,
    port: state.port,
  });
}

function defaultResponseHeaders(
  bodyByteLength: number,
): readonly (readonly [string, string])[] {
  return [
    ["Content-Type", "application/json"],
    ["Content-Length", String(bodyByteLength)],
    ["Connection", "close"],
  ];
}

function writeFixtureResponse(
  response: ServerResponse,
  fixtureResponse: Pr6rFixtureResponse,
): void {
  const statusCode = fixtureResponse.statusCode ?? 200;
  const headers =
    fixtureResponse.headers ??
    defaultResponseHeaders(fixtureResponse.body.byteLength);
  response.sendDate = false;
  response.writeHead(statusCode, headers.map(([name, value]) => [name, value]).flat());
  if (fixtureResponse.stallAfterHeaders === true) {
    const prefixLength = fixtureResponse.bodyPrefixBytes ?? 0;
    if (
      !Number.isSafeInteger(prefixLength) ||
      prefixLength < 0 ||
      prefixLength > fixtureResponse.body.byteLength
    ) {
      response.destroy(new Pr6rFixtureServerError("fixture_request_invalid"));
      return;
    }
    response.flushHeaders();
    if (prefixLength > 0) {
      response.write(fixtureResponse.body.subarray(0, prefixLength));
    }
    return;
  }
  if (fixtureResponse.trailers !== undefined) {
    response.addTrailers(Object.fromEntries(fixtureResponse.trailers));
  }
  response.end(fixtureResponse.body);
}

function captureRequest(
  request: IncomingMessage,
  maximumBodyBytes: number,
): Promise<Pr6rCapturedFixtureRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on("data", (chunk: Buffer | string) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += buffer.byteLength;
      if (bytes > maximumBodyBytes) {
        request.destroy();
        reject(new Pr6rFixtureServerError("fixture_request_invalid"));
        return;
      }
      chunks.push(buffer);
    });
    request.once("aborted", () =>
      reject(new Pr6rFixtureServerError("fixture_request_invalid")),
    );
    request.once("error", () =>
      reject(new Pr6rFixtureServerError("fixture_request_invalid")),
    );
    request.once("end", () => {
      const body = Buffer.concat(chunks, bytes);
      resolve(
        Object.freeze({
          method: request.method ?? "",
          path: request.url ?? "",
          rawHeaders: Object.freeze([...request.rawHeaders]),
          body: Uint8Array.from(body),
        }),
      );
    });
  });
}

export async function startPr6rLoopbackFixtureServer(input: {
  readonly host?: Pr6rLoopbackHost;
  readonly maxRequests?: number;
  readonly respond: (
    request: Pr6rCapturedFixtureRequest,
  ) => Pr6rFixtureResponse | Promise<Pr6rFixtureResponse>;
}): Promise<Pr6rLoopbackFixtureServer> {
  const host = input.host ?? "127.0.0.1";
  const maxRequests = input.maxRequests ?? DEFAULT_MAX_REQUESTS;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 2) {
    throw new Pr6rFixtureServerError("fixture_request_invalid");
  }
  const requests: Pr6rCapturedFixtureRequest[] = [];
  let acceptedRequests = 0;
  let observedRequestCount = 0;
  const sockets = new Set<{ destroy(): void }>();
  const server = createServer(
    {
      joinDuplicateHeaders: false,
      maxHeaderSize: 8_192,
      requireHostHeader: false,
    },
    (request, response) => {
      observedRequestCount += 1;
      void (async () => {
        if (acceptedRequests >= maxRequests) {
          response.sendDate = false;
          response.writeHead(400, {
            Connection: "close",
            "Content-Length": "0",
          });
          response.end();
          return;
        }
        acceptedRequests += 1;
        if (
          request.method !== "POST" ||
          request.url !== PR6R_LOOPBACK_CHAT_COMPLETIONS_PATH
        ) {
          response.sendDate = false;
          response.writeHead(400, {
            Connection: "close",
            "Content-Length": "0",
          });
          response.end();
          return;
        }
        try {
          const captured = await captureRequest(
            request,
            PR6R_MAX_CANONICAL_APPLICATION_BODY_BYTES,
          );
          requests.push(captured);
          writeFixtureResponse(response, await input.respond(captured));
        } catch {
          if (!response.headersSent) {
            response.sendDate = false;
            response.writeHead(400, {
              Connection: "close",
              "Content-Length": "0",
            });
            response.end();
          } else {
            response.destroy();
          }
        }
      })();
    },
  );
  server.requestTimeout = SERVER_TIMEOUT_MS;
  server.headersTimeout = SERVER_TIMEOUT_MS;
  server.keepAliveTimeout = 1;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (): void => {
      server.off("listening", onListening);
      reject(new Pr6rFixtureServerError("fixture_listener_unavailable"));
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({
      host,
      port: 0,
      exclusive: true,
      ...(host === "::1" ? { ipv6Only: true } : {}),
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string" || address.port < 1) {
    server.close();
    throw new Pr6rFixtureServerError("fixture_listener_unavailable");
  }
  const origin =
    host === "::1"
      ? `http://[::1]:${address.port}`
      : `http://127.0.0.1:${address.port}`;
  const capability = Object.freeze({
    origin,
    host,
    port: address.port,
  });
  const privateState: ListenerPrivateState = {
    server,
    origin,
    host,
    port: address.port,
    active: true,
  };
  listenerPrivateState.set(capability, privateState);

  let closePromise: Promise<void> | undefined;
  const fixture: Pr6rLoopbackFixtureServer = Object.freeze({
    listenerCapability: capability,
    get requests() {
      return Object.freeze([...requests]);
    },
    get observedRequestCount() {
      return observedRequestCount;
    },
    close(): Promise<void> {
      if (closePromise !== undefined) return closePromise;
      privateState.active = false;
      closePromise = new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
      return closePromise;
    },
  });
  return fixture;
}
