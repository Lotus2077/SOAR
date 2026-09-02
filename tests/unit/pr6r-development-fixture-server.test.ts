import { request } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  Pr6rFixtureServerError,
  readPr6rFixtureListenerBinding,
  startPr6rLoopbackFixtureServer,
  type Pr6rLoopbackFixtureServer,
} from "../../src/main/pr6r-development/fixture-server";
import { PR6R_LOOPBACK_CHAT_COMPLETIONS_PATH } from "../../src/shared/pr6r-development-contracts";

const servers: Pr6rLoopbackFixtureServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function send(input: {
  origin: string;
  body: string;
}): Promise<{ statusCode: number | undefined; body: string }> {
  const origin = new URL(input.origin);
  const hostname = origin.hostname === "[::1]" ? "::1" : origin.hostname;
  return new Promise((resolve, reject) => {
    const transportRequest = request(
      {
        protocol: "http:",
        hostname,
        port: Number(origin.port),
        family: hostname === "::1" ? 6 : 4,
        method: "POST",
        path: PR6R_LOOPBACK_CHAT_COMPLETIONS_PATH,
        agent: false,
        setHost: false,
        headers: {
          Accept: "application/json",
          Connection: "close",
          "Content-Length": String(Buffer.byteLength(input.body)),
          "Content-Type": "application/json",
          Host: origin.host,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () =>
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    transportRequest.once("error", reject);
    transportRequest.end(input.body);
  });
}

describe("PR6R bounded loopback fixture server", () => {
  for (const host of ["127.0.0.1", "::1"] as const) {
    it(`owns a port-zero ${host} listener and captures one bounded request`, async () => {
      const fixture = await startPr6rLoopbackFixtureServer({
        host,
        respond: () => ({ body: Buffer.from('{"ok":true}') }),
      });
      servers.push(fixture);
      const binding = readPr6rFixtureListenerBinding(
        fixture.listenerCapability,
      );
      expect(binding).toMatchObject({ host, port: expect.any(Number) });
      expect(binding.origin).toBe(fixture.listenerCapability.origin);
      expect(binding.port).toBeGreaterThan(0);

      await expect(
        send({ origin: binding.origin, body: '{"request":1}' }),
      ).resolves.toEqual({ statusCode: 200, body: '{"ok":true}' });
      expect(fixture.requests).toHaveLength(1);
      expect(fixture.observedRequestCount).toBe(1);
      expect(fixture.requests[0]).toMatchObject({
        method: "POST",
        path: PR6R_LOOPBACK_CHAT_COMPLETIONS_PATH,
        body: new TextEncoder().encode('{"request":1}'),
      });
    });
  }

  it("rejects forged listener objects and invalidates the capability on close", async () => {
    const fixture = await startPr6rLoopbackFixtureServer({
      respond: () => ({ body: Buffer.from("{}") }),
    });
    servers.push(fixture);
    expect(() =>
      readPr6rFixtureListenerBinding({ ...fixture.listenerCapability }),
    ).toThrowError(Pr6rFixtureServerError);
    await fixture.close();
    expect(() =>
      readPr6rFixtureListenerBinding(fixture.listenerCapability),
    ).toThrow("fixture_listener_unavailable");
  });

  it("bounds the listener to at most the frozen two campaign requests", async () => {
    const fixture = await startPr6rLoopbackFixtureServer({
      respond: () => ({ body: Buffer.from("{}") }),
    });
    servers.push(fixture);
    const origin = fixture.listenerCapability.origin;
    await send({ origin, body: "{}" });
    await send({ origin, body: "{}" });
    await expect(send({ origin, body: "{}" })).resolves.toMatchObject({
      statusCode: 400,
    });
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.observedRequestCount).toBe(3);
  });
});
