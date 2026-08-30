import { describe, expect, it } from "vitest";

import { invokeProviderWithAbortRace } from "../../src/main/agent/provider-invocation";
import { ProviderAbortedError } from "../../src/main/providers/types";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("invokeProviderWithAbortRace", () => {
  it("returns a normal provider result unchanged", async () => {
    const user = new AbortController();
    const timeout = new AbortController();
    const result = { content: "complete" };
    let observedSignal: AbortSignal | undefined;

    await expect(
      invokeProviderWithAbortRace({
        userSignal: user.signal,
        timeoutSignal: timeout.signal,
        getPartialContent: () => "",
        invoke: async (signal) => {
          observedSignal = signal;
          return result;
        },
      }),
    ).resolves.toBe(result);
    expect(observedSignal?.aborted).toBe(false);
  });

  it("settles a non-cooperative provider as a timeout with its partial output", async () => {
    const user = new AbortController();
    const timeout = new AbortController();
    let partial = "";
    const invocation = invokeProviderWithAbortRace({
      userSignal: user.signal,
      timeoutSignal: timeout.signal,
      getPartialContent: () => partial,
      invoke: async () => {
        partial = "bounded partial";
        return new Promise<string>(() => undefined);
      },
    });

    timeout.abort();

    await expect(invocation).rejects.toMatchObject({
      name: "ProviderAbortedError",
      abortKind: "timeout",
      partialContent: "bounded partial",
    } satisfies Partial<ProviderAbortedError>);
  });

  it("gives an already-observed user cancellation precedence over timeout", async () => {
    const user = new AbortController();
    const timeout = new AbortController();
    user.abort();
    timeout.abort();

    await expect(
      invokeProviderWithAbortRace({
        userSignal: user.signal,
        timeoutSignal: timeout.signal,
        getPartialContent: () => "cancelled partial",
        invoke: () => new Promise<string>(() => undefined),
      }),
    ).rejects.toMatchObject({
      name: "ProviderAbortedError",
      abortKind: "cancelled",
      partialContent: "cancelled partial",
    } satisfies Partial<ProviderAbortedError>);
  });

  it("returns a provider result that resolved while cancellation was signalled", async () => {
    const user = new AbortController();
    const timeout = new AbortController();
    const result = { costUsd: 1 };

    await expect(
      invokeProviderWithAbortRace({
        userSignal: user.signal,
        timeoutSignal: timeout.signal,
        getPartialContent: () => "",
        invoke: async () => {
          user.abort();
          return result;
        },
      }),
    ).resolves.toBe(result);
  });

  it("observes a provider rejection that arrives after the abort race settled", async () => {
    const user = new AbortController();
    const timeout = new AbortController();
    const provider = deferred<string>();
    const invocation = invokeProviderWithAbortRace({
      userSignal: user.signal,
      timeoutSignal: timeout.signal,
      getPartialContent: () => "",
      invoke: () => provider.promise,
    });

    timeout.abort();
    await expect(invocation).rejects.toMatchObject({ abortKind: "timeout" });

    provider.reject(new Error("late provider rejection"));
    await Promise.resolve();
  });
});
