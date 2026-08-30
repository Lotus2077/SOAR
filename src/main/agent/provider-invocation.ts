import { ProviderAbortedError } from "../providers/types";

export interface InvokeProviderWithAbortRaceOptions<T> {
  userSignal: AbortSignal;
  timeoutSignal: AbortSignal;
  getPartialContent: () => string;
  invoke: (signal: AbortSignal) => Promise<T>;
}

/**
 * Await one provider invocation without trusting the provider to observe abort.
 *
 * Timer ownership, dispatch bookkeeping, and post-resolution precedence remain
 * with the caller. In particular, an already-resolved provider result is
 * returned unchanged even when an abort signal raced with that resolution.
 */
export async function invokeProviderWithAbortRace<T>(
  options: InvokeProviderWithAbortRaceOptions<T>,
): Promise<T> {
  const signal = AbortSignal.any([
    options.userSignal,
    options.timeoutSignal,
  ]);
  const completion = options.invoke(signal);
  // Observe a provider that rejects after the abort race has already settled so
  // its late rejection cannot become unhandled.
  void completion.catch(() => undefined);

  let rejectOnAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => {
      const cancelled = options.userSignal.aborted;
      reject(
        new ProviderAbortedError(
          cancelled ? "Inference cancelled" : "Inference timed out",
          options.getPartialContent(),
          cancelled ? "cancelled" : "timeout",
        ),
      );
    };
    if (signal.aborted) rejectOnAbort();
    else signal.addEventListener("abort", rejectOnAbort, { once: true });
  });

  try {
    return await Promise.race([completion, aborted]);
  } finally {
    if (rejectOnAbort !== undefined) {
      signal.removeEventListener("abort", rejectOnAbort);
    }
  }
}
