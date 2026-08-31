import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  createSecurityCommandRunner,
  KEYCHAIN_COMMAND_MAX_OUTPUT_BYTES,
  KEYCHAIN_COMMAND_TIMEOUT_MS,
  KEYCHAIN_CREDENTIAL_MAX_BYTES,
  KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE,
  KEYCHAIN_KILL_GRACE_MS,
  MACOS_SECURITY_PATH,
  MacOsKeychainCredentialSetupStore,
  type SecurityCommandRequest,
  type SecurityCommandResult,
  type SecurityCommandRunner,
  type SecurityProcessSpawner,
  SETUP_CREDENTIAL_ERROR_CODES,
  SetupCredentialStoreError,
  SOAR_OPENROUTER_KEYCHAIN_ACCOUNT,
  SOAR_OPENROUTER_KEYCHAIN_SERVICE,
} from "../../src/main/providers/macos-keychain-credential-store";

const TEST_SERVICE = "ai.soar.test.keychain";
const TEST_ACCOUNT = "synthetic-test-account";
const SECRET_SENTINEL = "synthetic-secret-never-observe";

function exited(exitCode: number): SecurityCommandResult {
  return { kind: "exited", exitCode };
}

function createCapturingRunner(
  result: SecurityCommandResult = exited(0),
): {
  requests: SecurityCommandRequest[];
  runner: SecurityCommandRunner;
} {
  const requests: SecurityCommandRequest[] = [];
  return {
    requests,
    runner: async (request) => {
      requests.push(request);
      return result;
    },
  };
}

function setupStore(
  runner: SecurityCommandRunner,
): MacOsKeychainCredentialSetupStore {
  return new MacOsKeychainCredentialSetupStore({
    service: TEST_SERVICE,
    account: TEST_ACCOUNT,
    platform: "darwin",
    runner,
    timeoutMs: 4321,
    maxOutputBytes: 9876,
  });
}

async function captureError(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("Expected operation to reject.");
}

type FakeChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
};

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    unref: vi.fn(),
  });
}

function runnerRequest(
  overrides: Partial<SecurityCommandRequest> = {},
): SecurityCommandRequest {
  return {
    args: ["add-generic-password", "-w"],
    stdin: SECRET_SENTINEL,
    timeoutMs: 100,
    maxOutputBytes: 1024,
    ...overrides,
  };
}

describe("MacOsKeychainCredentialSetupStore", () => {
  it("exposes setup operations but no raw-secret read or resolve capability", () => {
    const { runner } = createCapturingRunner();
    const store = setupStore(runner);
    const methods = Object.getOwnPropertyNames(
      MacOsKeychainCredentialSetupStore.prototype,
    );

    expect(methods).toEqual(
      expect.arrayContaining(["status", "has", "write", "replace", "delete"]),
    );
    expect(methods).not.toEqual(expect.arrayContaining(["read", "resolve"]));
    expect("read" in store).toBe(false);
    expect("resolve" in store).toBe(false);
  });

  it("derives stored status and presence from metadata-only exit status", async () => {
    const { runner, requests } = createCapturingRunner(exited(0));
    const store = setupStore(runner);

    await expect(store.status()).resolves.toEqual({ state: "stored" });
    await expect(store.has()).resolves.toBe(true);

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request).toEqual({
        args: [
          "find-generic-password",
          "-a",
          TEST_ACCOUNT,
          "-s",
          TEST_SERVICE,
        ],
        timeoutMs: 4321,
        maxOutputBytes: 9876,
      });
      expect(request.args).not.toContain("-w");
      expect(request.args).not.toContain("-g");
      expect(request.stdin).toBeUndefined();
    }
  });

  it("maps Keychain item-not-found status to metadata-only absence", async () => {
    const { runner } = createCapturingRunner(
      exited(KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE),
    );
    const store = setupStore(runner);

    await expect(store.status()).resolves.toEqual({ state: "not_stored" });
    await expect(store.has()).resolves.toBe(false);
  });

  it("passes add and replace credentials only through the runner stdin field", async () => {
    const { runner, requests } = createCapturingRunner();
    const store = setupStore(runner);

    await store.write(SECRET_SENTINEL);
    await store.replace(SECRET_SENTINEL);

    expect(requests).toEqual([
      {
        args: [
          "add-generic-password",
          "-a",
          TEST_ACCOUNT,
          "-s",
          TEST_SERVICE,
          "-w",
        ],
        stdin: SECRET_SENTINEL,
        timeoutMs: 4321,
        maxOutputBytes: 9876,
      },
      {
        args: [
          "add-generic-password",
          "-U",
          "-a",
          TEST_ACCOUNT,
          "-s",
          TEST_SERVICE,
          "-w",
        ],
        stdin: SECRET_SENTINEL,
        timeoutMs: 4321,
        maxOutputBytes: 9876,
      },
    ]);
    for (const request of requests) {
      expect(request.args.at(-1)).toBe("-w");
      expect(request.args).not.toContain(SECRET_SENTINEL);
    }
  });

  it("deletes by fixed metadata and treats an absent item as a no-op", async () => {
    const results = [
      exited(0),
      exited(KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE),
    ];
    const requests: SecurityCommandRequest[] = [];
    const store = setupStore(async (request) => {
      requests.push(request);
      return results.shift() ?? exited(1);
    });

    await expect(store.delete()).resolves.toBe(true);
    await expect(store.delete()).resolves.toBe(false);
    expect(requests).toEqual([
      {
        args: [
          "delete-generic-password",
          "-a",
          TEST_ACCOUNT,
          "-s",
          TEST_SERVICE,
        ],
        timeoutMs: 4321,
        maxOutputBytes: 9876,
      },
      {
        args: [
          "delete-generic-password",
          "-a",
          TEST_ACCOUNT,
          "-s",
          TEST_SERVICE,
        ],
        timeoutMs: 4321,
        maxOutputBytes: 9876,
      },
    ]);
  });

  it("fails closed off macOS before invoking the process runner", async () => {
    const { runner, requests } = createCapturingRunner();
    const store = new MacOsKeychainCredentialSetupStore({
      platform: "linux",
      runner,
    });

    for (const operation of [
      () => store.status(),
      () => store.has(),
      () => store.write(SECRET_SENTINEL),
      () => store.replace(SECRET_SENTINEL),
      () => store.delete(),
    ]) {
      const error = await captureError(operation());
      expect(error).toMatchObject({ code: "unsupported_platform" });
      expect(error.message).not.toContain(SECRET_SENTINEL);
    }
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["empty", ""],
    ["leading whitespace", ` ${SECRET_SENTINEL}`],
    ["trailing whitespace", `${SECRET_SENTINEL} `],
    ["NUL", `${SECRET_SENTINEL}\0suffix`],
    ["carriage return", `${SECRET_SENTINEL}\rsuffix`],
    ["newline", `${SECRET_SENTINEL}\nsuffix`],
    ["over the UTF-8 byte bound", "x".repeat(KEYCHAIN_CREDENTIAL_MAX_BYTES + 1)],
  ])("rejects an invalid %s credential before process execution", async (_name, value) => {
    const { runner, requests } = createCapturingRunner();
    const store = setupStore(runner);

    for (const operation of [
      () => store.write(value),
      () => store.replace(value),
    ]) {
      const error = await captureError(operation());
      expect(error).toMatchObject({ code: "invalid_credential" });
      if (value.length > 0) expect(error.message).not.toContain(value);
    }
    expect(requests).toHaveLength(0);
  });

  it("accepts a credential exactly at the UTF-8 byte bound", async () => {
    const { runner, requests } = createCapturingRunner();
    const store = setupStore(runner);
    const value = "x".repeat(KEYCHAIN_CREDENTIAL_MAX_BYTES);

    await expect(store.write(value)).resolves.toBeUndefined();
    expect(requests[0]?.stdin).toBe(value);
  });

  it.each([
    ["spawn_error", "keychain_unavailable"],
    ["timeout", "keychain_timeout"],
    ["output_limit", "keychain_output_limit"],
  ] as const)(
    "maps %s to a stable secret-free error for every setup operation",
    async (kind, code) => {
      const runner: SecurityCommandRunner = async () => ({ kind });
      const store = setupStore(runner);
      const operations = [
        () => store.status(),
        () => store.has(),
        () => store.write(SECRET_SENTINEL),
        () => store.replace(SECRET_SENTINEL),
        () => store.delete(),
      ];

      for (const operation of operations) {
        const error = await captureError(operation());
        expect(error).toBeInstanceOf(SetupCredentialStoreError);
        expect(error).toMatchObject({ code });
        expect(error.message).not.toContain(SECRET_SENTINEL);
        expect(JSON.stringify(error)).not.toContain(SECRET_SENTINEL);
      }
    },
  );

  it.each([
    ["status", "keychain_status_failed"],
    ["has", "keychain_status_failed"],
    ["write", "keychain_write_failed"],
    ["replace", "keychain_replace_failed"],
    ["delete", "keychain_delete_failed"],
  ] as const)("maps a nonzero %s exit to %s", async (method, code) => {
    const store = setupStore(async () => exited(7));
    const operation =
      method === "write" || method === "replace"
        ? store[method](SECRET_SENTINEL)
        : store[method]();
    const error = await captureError(operation);

    expect(error).toBeInstanceOf(SetupCredentialStoreError);
    expect(error).toMatchObject({ code });
    expect(error.message).not.toContain(SECRET_SENTINEL);
  });

  it("serializes setup operations, including continuation after a failure", async () => {
    const requests: SecurityCommandRequest[] = [];
    const releases: Array<(result: SecurityCommandResult) => void> = [];
    const runner: SecurityCommandRunner = (request) => {
      requests.push(request);
      return new Promise((resolve) => releases.push(resolve));
    };
    const store = setupStore(runner);

    const first = store.write("first-synthetic-secret");
    const second = store.replace("second-synthetic-secret");
    const third = store.delete();
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    releases.shift()?.(exited(9));
    await expect(first).rejects.toMatchObject({
      code: "keychain_write_failed",
    });
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    releases.shift()?.(exited(0));
    await expect(second).resolves.toBeUndefined();
    await vi.waitFor(() => expect(requests).toHaveLength(3));

    releases.shift()?.(exited(KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE));
    await expect(third).resolves.toBe(false);
  });

  it("rejects invalid references and execution bounds at construction", () => {
    expect(
      () => new MacOsKeychainCredentialSetupStore({ service: "../escape" }),
    ).toThrow(/bounded opaque identifiers/u);
    expect(
      () => new MacOsKeychainCredentialSetupStore({ account: "contains space" }),
    ).toThrow(/bounded opaque identifiers/u);
    expect(
      () => new MacOsKeychainCredentialSetupStore({ timeoutMs: 0 }),
    ).toThrow(/positive bounded integer/u);
    expect(
      () => new MacOsKeychainCredentialSetupStore({ timeoutMs: 60_001 }),
    ).toThrow(/positive bounded integer/u);
    expect(
      () => new MacOsKeychainCredentialSetupStore({ maxOutputBytes: 0 }),
    ).toThrow(/positive bounded integer/u);
    expect(
      () => new MacOsKeychainCredentialSetupStore({ maxOutputBytes: 1_048_577 }),
    ).toThrow(/positive bounded integer/u);
  });

  it("uses fixed production metadata and bounded defaults", async () => {
    const { runner, requests } = createCapturingRunner();
    const store = new MacOsKeychainCredentialSetupStore({
      platform: "darwin",
      runner,
    });

    await store.status();
    expect(requests).toEqual([
      {
        args: [
          "find-generic-password",
          "-a",
          SOAR_OPENROUTER_KEYCHAIN_ACCOUNT,
          "-s",
          SOAR_OPENROUTER_KEYCHAIN_SERVICE,
        ],
        timeoutMs: KEYCHAIN_COMMAND_TIMEOUT_MS,
        maxOutputBytes: KEYCHAIN_COMMAND_MAX_OUTPUT_BYTES,
      },
    ]);
  });

  it("keeps the stable public error-code set explicit", () => {
    expect(SETUP_CREDENTIAL_ERROR_CODES).toEqual([
      "unsupported_platform",
      "invalid_credential",
      "keychain_unavailable",
      "keychain_timeout",
      "keychain_output_limit",
      "keychain_status_failed",
      "keychain_write_failed",
      "keychain_replace_failed",
      "keychain_delete_failed",
    ]);
  });
});

describe("createSecurityCommandRunner", () => {
  it("uses fixed shell-free execution and supplies the same secret to both prompts", async () => {
    const child = fakeChild();
    let invocation: unknown[] | undefined;
    let stdin = "";
    child.stdin.on("data", (chunk: Buffer) => {
      stdin += chunk.toString("utf8");
    });
    const spawnProcess = ((...args: unknown[]) => {
      invocation = args;
      return child;
    }) as unknown as SecurityProcessSpawner;
    const runner = createSecurityCommandRunner(spawnProcess);

    const pending = runner(runnerRequest());
    child.emit("close", 0, null);

    await expect(pending).resolves.toEqual({ kind: "exited", exitCode: 0 });
    expect(invocation).toEqual([
      MACOS_SECURITY_PATH,
      ["add-generic-password", "-w"],
      {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { LANG: "C", LC_ALL: "C" },
      },
    ]);
    expect(stdin).toBe(`${SECRET_SENTINEL}\n${SECRET_SENTINEL}\n`);
    expect(JSON.stringify(invocation)).not.toContain(SECRET_SENTINEL);
  });

  it("closes stdin without data for metadata-only commands", async () => {
    const child = fakeChild();
    let stdin = "";
    child.stdin.on("data", (chunk: Buffer) => {
      stdin += chunk.toString("utf8");
    });
    const runner = createSecurityCommandRunner(
      (() => child) as unknown as SecurityProcessSpawner,
    );

    const pending = runner(runnerRequest({ stdin: undefined }));
    child.emit("close", 44, null);

    await expect(pending).resolves.toEqual({ kind: "exited", exitCode: 44 });
    expect(stdin).toBe("");
    expect(child.stdin.writableEnded).toBe(true);
  });

  it("discards subprocess output and exposes only the exit code", async () => {
    const child = fakeChild();
    const runner = createSecurityCommandRunner(
      (() => child) as unknown as SecurityProcessSpawner,
    );

    const pending = runner(runnerRequest());
    child.stdout.write(`stdout-${SECRET_SENTINEL}`);
    child.stderr.write(`stderr-${SECRET_SENTINEL}`);
    child.emit("close", 5, null);
    const result = await pending;

    expect(result).toEqual({ kind: "exited", exitCode: 5 });
    expect(JSON.stringify(result)).not.toContain(SECRET_SENTINEL);
  });

  it("waits for observed child close after output exceeds the byte bound", async () => {
    const child = fakeChild();
    const runner = createSecurityCommandRunner(
      (() => child) as unknown as SecurityProcessSpawner,
    );

    const pending = runner(runnerRequest({ maxOutputBytes: 5 }));
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    child.stdout.write("123");
    child.stderr.write("456");
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(child.stdin.destroyed).toBe(true);

    child.emit("close", null, "SIGKILL");
    await expect(pending).resolves.toEqual({ kind: "output_limit" });
    expect(settled).toBe(true);
  });

  it("waits for observed child close after the command timeout", async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const runner = createSecurityCommandRunner(
        (() => child) as unknown as SecurityProcessSpawner,
      );
      const pending = runner(runnerRequest({ timeoutMs: 25 }));
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(25);

      expect(settled).toBe(false);
      expect(child.kill).toHaveBeenCalledOnce();
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(child.stdin.destroyed).toBe(true);

      child.emit("close", null, "SIGKILL");
      await expect(pending).resolves.toEqual({ kind: "timeout" });
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps synchronous spawn exceptions without retaining the raw error", async () => {
    const runner = createSecurityCommandRunner(
      (() => {
        throw new Error(`spawn-${SECRET_SENTINEL}`);
      }) as unknown as SecurityProcessSpawner,
    );

    const result = await runner(runnerRequest());

    expect(result).toEqual({ kind: "spawn_error" });
    expect(JSON.stringify(result)).not.toContain(SECRET_SENTINEL);
  });

  it.each(["process", "stdin"] as const)(
    "maps an asynchronous %s error without retaining it",
    async (source) => {
      const child = fakeChild();
      const runner = createSecurityCommandRunner(
        (() => child) as unknown as SecurityProcessSpawner,
      );
      const pending = runner(runnerRequest());

      if (source === "process") {
        child.emit("error", new Error(`process-${SECRET_SENTINEL}`));
      } else {
        child.stdin.emit("error", new Error(`stdin-${SECRET_SENTINEL}`));
      }

      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(child.stdin.destroyed).toBe(true);
      child.emit("close", null, "SIGKILL");

      const result = await pending;
      expect(result).toEqual({ kind: "spawn_error" });
      expect(JSON.stringify(result)).not.toContain(SECRET_SENTINEL);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    },
  );

  it("maps a signal-only close to a stable spawn error", async () => {
    const child = fakeChild();
    const runner = createSecurityCommandRunner(
      (() => child) as unknown as SecurityProcessSpawner,
    );
    const pending = runner(runnerRequest());

    child.emit("close", null, "SIGTERM");

    await expect(pending).resolves.toEqual({ kind: "spawn_error" });
  });

  it.each([true, false])(
    "fails closed at bounded kill grace when kill returns %s and close is never observed",
    async (killResult) => {
      vi.useFakeTimers();
      try {
        const child = fakeChild();
        child.kill.mockReturnValue(killResult);
        const runner = createSecurityCommandRunner(
          (() => child) as unknown as SecurityProcessSpawner,
        );
        const pending = runner(runnerRequest({ timeoutMs: 25 }));
        let settled = false;
        void pending.then(() => {
          settled = true;
        });

        await vi.advanceTimersByTimeAsync(25);
        expect(settled).toBe(false);
        expect(child.kill).toHaveBeenCalledWith("SIGKILL");
        expect(child.stdin.destroyed).toBe(true);

        await vi.advanceTimersByTimeAsync(KEYCHAIN_KILL_GRACE_MS - 1);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);

        await expect(pending).resolves.toEqual({ kind: "timeout" });
        expect(settled).toBe(true);
        expect(child.stdout.destroyed).toBe(true);
        expect(child.stderr.destroyed).toBe(true);
        expect(child.unref).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
