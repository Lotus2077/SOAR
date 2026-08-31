import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";

export const MACOS_SECURITY_PATH = "/usr/bin/security" as const;
export const SOAR_OPENROUTER_KEYCHAIN_SERVICE = "ai.soar.openrouter" as const;
export const SOAR_OPENROUTER_KEYCHAIN_ACCOUNT = "default" as const;

export const KEYCHAIN_COMMAND_TIMEOUT_MS = 10_000;
export const KEYCHAIN_COMMAND_MAX_OUTPUT_BYTES = 16 * 1024;
export const KEYCHAIN_CREDENTIAL_MAX_BYTES = 16 * 1024;
export const KEYCHAIN_KILL_GRACE_MS = 1_000;

/** `/usr/bin/security` reports errSecItemNotFound as shell status 44. */
export const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;

export type SetupCredentialStatus = Readonly<{
  state: "stored" | "not_stored";
}>;

/**
 * Setup-only credential capability used by PR6A.
 *
 * Deliberately has no raw-secret read or resolve method. A future runtime
 * credential resolver requires a separately approved interface and adapter.
 */
export interface SetupOnlyCredentialStore {
  status(): Promise<SetupCredentialStatus>;
  has(): Promise<boolean>;
  write(credential: string): Promise<void>;
  replace(credential: string): Promise<void>;
  delete(): Promise<boolean>;
}

export const SETUP_CREDENTIAL_ERROR_CODES = [
  "unsupported_platform",
  "invalid_credential",
  "keychain_unavailable",
  "keychain_timeout",
  "keychain_output_limit",
  "keychain_status_failed",
  "keychain_write_failed",
  "keychain_replace_failed",
  "keychain_delete_failed",
] as const;

export type SetupCredentialErrorCode =
  (typeof SETUP_CREDENTIAL_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<SetupCredentialErrorCode, string>> =
  Object.freeze({
    unsupported_platform:
      "Cloud credential setup requires macOS Keychain.",
    invalid_credential:
      "The cloud credential must be one bounded single-line exact value.",
    keychain_unavailable:
      "macOS Keychain is unavailable for cloud credential setup.",
    keychain_timeout:
      "macOS Keychain did not finish the credential operation in time.",
    keychain_output_limit:
      "macOS Keychain returned more diagnostic output than SOAR permits.",
    keychain_status_failed:
      "SOAR could not determine whether the cloud credential is stored.",
    keychain_write_failed:
      "SOAR could not store the cloud credential in macOS Keychain.",
    keychain_replace_failed:
      "SOAR could not replace the cloud credential in macOS Keychain.",
    keychain_delete_failed:
      "SOAR could not remove the cloud credential from macOS Keychain.",
  });

/** Stable, allow-listed error that never retains a subprocess error or output. */
export class SetupCredentialStoreError extends Error {
  constructor(readonly code: SetupCredentialErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "SetupCredentialStoreError";
  }
}

export interface SecurityCommandRequest {
  readonly args: readonly string[];
  /**
   * Credential written only to child stdin; callers must never copy it into
   * args or env. The runner repeats this exact value for both `security`
   * password prompts.
   */
  readonly stdin?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export type SecurityCommandResult =
  | Readonly<{ kind: "exited"; exitCode: number }>
  | Readonly<{
      kind: "spawn_error" | "timeout" | "output_limit";
    }>;

export type SecurityCommandRunner = (
  request: SecurityCommandRequest,
) => Promise<SecurityCommandResult>;

export type SecurityProcessSpawner = typeof spawn;

function byteLength(chunk: unknown): number {
  if (Buffer.isBuffer(chunk)) return chunk.byteLength;
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  return Buffer.byteLength(String(chunk), "utf8");
}

function exited(exitCode: number): SecurityCommandResult {
  return Object.freeze({ kind: "exited" as const, exitCode });
}

function terminal(
  kind: Exclude<SecurityCommandResult["kind"], "exited">,
): SecurityCommandResult {
  return Object.freeze({ kind });
}

/**
 * Create the bounded `/usr/bin/security` process runner.
 *
 * It discards stdout/stderr content, retains no subprocess Error, uses a fixed
 * executable with `shell: false`, and supplies only a minimal non-secret
 * environment. Its result contains an exit status or one stable terminal kind.
 */
export function createSecurityCommandRunner(
  spawnProcess: SecurityProcessSpawner = spawn,
): SecurityCommandRunner {
  return (request) =>
    new Promise<SecurityCommandResult>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnProcess(MACOS_SECURITY_PATH, [...request.args], {
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: {
            LANG: "C",
            LC_ALL: "C",
          },
        });
      } catch {
        resolve(terminal("spawn_error"));
        return;
      }

      let settled = false;
      let outputBytes = 0;
      let commandTimeout: ReturnType<typeof setTimeout> | undefined;
      let killGraceTimeout: ReturnType<typeof setTimeout> | undefined;
      let pendingTermination: SecurityCommandResult | undefined;

      const discardLateError = (): void => {
        // A child that missed the bounded close grace must not surface a later
        // raw process or pipe error after the operation has already failed.
      };

      const cleanup = (closeObserved: boolean): void => {
        if (commandTimeout !== undefined) clearTimeout(commandTimeout);
        if (killGraceTimeout !== undefined) clearTimeout(killGraceTimeout);
        child.removeListener("error", onProcessError);
        child.removeListener("close", onClose);
        child.stdin.removeListener("error", onInputError);
        child.stdout.removeListener("data", onOutput);
        child.stdout.removeListener("error", onOutputError);
        child.stderr.removeListener("data", onOutput);
        child.stderr.removeListener("error", onOutputError);

        if (!closeObserved) {
          // The public operation is bounded even if the OS never confirms
          // child close. Destroy every pipe, detach the process handle, and
          // swallow only late transport errors without retaining their detail.
          child.on("error", discardLateError);
          child.stdin.on("error", discardLateError);
          child.stdout.on("error", discardLateError);
          child.stderr.on("error", discardLateError);
          try {
            child.stdout.destroy();
          } catch {
            // Never retain raw stream errors.
          }
          try {
            child.stderr.destroy();
          } catch {
            // Never retain raw stream errors.
          }
          try {
            child.unref();
          } catch {
            // A synthetic child or an already-closed handle may not detach.
          }
        }
      };

      const finish = (
        result: SecurityCommandResult,
        closeObserved: boolean,
      ): void => {
        if (settled) return;
        settled = true;
        cleanup(closeObserved);
        resolve(result);
      };

      const requestTermination = (
        kind: "timeout" | "output_limit" | "spawn_error",
      ): void => {
        if (settled || pendingTermination !== undefined) return;
        pendingTermination = terminal(kind);
        if (commandTimeout !== undefined) {
          clearTimeout(commandTimeout);
          commandTimeout = undefined;
        }

        killGraceTimeout = setTimeout(() => {
          const result = pendingTermination ?? terminal("spawn_error");
          finish(result, false);
        }, KEYCHAIN_KILL_GRACE_MS);

        // Stop any further secret/input delivery before requesting SIGKILL.
        try {
          child.stdin.destroy();
        } catch {
          // Never retain a raw stdin teardown error.
        }
        try {
          // `false` means no signal was delivered. In either case, keep the
          // operation pending until close is observed or kill grace expires.
          child.kill("SIGKILL");
        } catch {
          // The child may already have exited. Never retain the raw kill error.
        }
      };

      function onProcessError(): void {
        requestTermination("spawn_error");
      }

      function onInputError(): void {
        requestTermination("spawn_error");
      }

      function onOutputError(): void {
        requestTermination("spawn_error");
      }

      function onClose(code: number | null): void {
        if (pendingTermination !== undefined) {
          finish(pendingTermination, true);
          return;
        }
        if (code === null || !Number.isSafeInteger(code) || code < 0) {
          finish(terminal("spawn_error"), true);
          return;
        }
        finish(exited(code), true);
      }

      function onOutput(chunk: unknown): void {
        if (pendingTermination !== undefined) return;
        outputBytes += byteLength(chunk);
        if (
          !Number.isSafeInteger(outputBytes) ||
          outputBytes > request.maxOutputBytes
        ) {
          requestTermination("output_limit");
        }
      }

      child.on("error", onProcessError);
      child.on("close", onClose);
      child.stdin.on("error", onInputError);
      child.stdout.on("data", onOutput);
      child.stdout.on("error", onOutputError);
      child.stderr.on("data", onOutput);
      child.stderr.on("error", onOutputError);

      commandTimeout = setTimeout(
        () => requestTermination("timeout"),
        request.timeoutMs,
      );

      try {
        if (request.stdin === undefined) {
          child.stdin.end();
        } else {
          // With `-w` final, `/usr/bin/security add-generic-password` prompts
          // for the new password and then asks to retype it. Newlines are
          // rejected by credential validation, so repeating is unambiguous.
          child.stdin.end(`${request.stdin}\n${request.stdin}\n`, "utf8");
        }
      } catch {
        requestTermination("spawn_error");
      }
    });
}

const opaqueReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function validateReference(value: string): string {
  if (!opaqueReferencePattern.test(value)) {
    throw new TypeError(
      "Keychain service and account must be bounded opaque identifiers.",
    );
  }
  return value;
}

function validatePositiveBoundedInteger(
  value: number,
  label: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${label} must be a positive bounded integer.`);
  }
  return value;
}

function validateCredential(credential: string): void {
  const bytes = Buffer.byteLength(credential, "utf8");
  if (
    credential.length === 0 ||
    bytes > KEYCHAIN_CREDENTIAL_MAX_BYTES ||
    credential.trim() !== credential ||
    credential.includes("\0") ||
    credential.includes("\r") ||
    credential.includes("\n")
  ) {
    throw new SetupCredentialStoreError("invalid_credential");
  }
}

function commandFailureCode(
  operation:
    | "status"
    | "write"
    | "replace"
    | "delete",
): SetupCredentialErrorCode {
  return `keychain_${operation}_failed`;
}

export interface MacOsKeychainCredentialSetupStoreOptions {
  /** Fixed in production; injectable only for isolated synthetic tests. */
  service?: string;
  /** Fixed in production; injectable only for isolated synthetic tests. */
  account?: string;
  platform?: NodeJS.Platform;
  runner?: SecurityCommandRunner;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/**
 * Direct setup-only macOS Keychain adapter.
 *
 * The class intentionally does not implement the runtime CredentialStore and
 * has no method capable of returning a stored credential.
 */
export class MacOsKeychainCredentialSetupStore
  implements SetupOnlyCredentialStore
{
  private readonly service: string;
  private readonly account: string;
  private readonly platform: NodeJS.Platform;
  private readonly runner: SecurityCommandRunner;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(options: MacOsKeychainCredentialSetupStoreOptions = {}) {
    this.service = validateReference(
      options.service ?? SOAR_OPENROUTER_KEYCHAIN_SERVICE,
    );
    this.account = validateReference(
      options.account ?? SOAR_OPENROUTER_KEYCHAIN_ACCOUNT,
    );
    this.platform = options.platform ?? process.platform;
    this.runner = options.runner ?? createSecurityCommandRunner();
    this.timeoutMs = validatePositiveBoundedInteger(
      options.timeoutMs ?? KEYCHAIN_COMMAND_TIMEOUT_MS,
      "Keychain command timeout",
      60_000,
    );
    this.maxOutputBytes = validatePositiveBoundedInteger(
      options.maxOutputBytes ?? KEYCHAIN_COMMAND_MAX_OUTPUT_BYTES,
      "Keychain command output limit",
      1024 * 1024,
    );
  }

  status(): Promise<SetupCredentialStatus> {
    return this.serialize(() => this.statusUnlocked());
  }

  has(): Promise<boolean> {
    return this.serialize(async () => {
      const status = await this.statusUnlocked();
      return status.state === "stored";
    });
  }

  async write(credential: string): Promise<void> {
    validateCredential(credential);
    await this.serialize(async () => {
      await this.runSuccessfulWrite("write", credential, false);
    });
  }

  async replace(credential: string): Promise<void> {
    validateCredential(credential);
    await this.serialize(async () => {
      await this.runSuccessfulWrite("replace", credential, true);
    });
  }

  delete(): Promise<boolean> {
    return this.serialize(async () => {
      const result = await this.run([
        "delete-generic-password",
        "-a",
        this.account,
        "-s",
        this.service,
      ]);
      if (result.kind === "exited") {
        if (result.exitCode === 0) return true;
        if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) return false;
      }
      throw this.toStoreError(result, "delete");
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertMacOs(): void {
    if (this.platform !== "darwin") {
      throw new SetupCredentialStoreError("unsupported_platform");
    }
  }

  private async statusUnlocked(): Promise<SetupCredentialStatus> {
    const result = await this.run([
      "find-generic-password",
      "-a",
      this.account,
      "-s",
      this.service,
    ]);
    if (result.kind === "exited") {
      if (result.exitCode === 0) return Object.freeze({ state: "stored" });
      if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
        return Object.freeze({ state: "not_stored" });
      }
    }
    throw this.toStoreError(result, "status");
  }

  private async runSuccessfulWrite(
    operation: "write" | "replace",
    credential: string,
    update: boolean,
  ): Promise<void> {
    const result = await this.run(
      [
        "add-generic-password",
        ...(update ? ["-U"] : []),
        "-a",
        this.account,
        "-s",
        this.service,
        "-w",
      ],
      credential,
    );
    if (result.kind === "exited" && result.exitCode === 0) return;
    throw this.toStoreError(result, operation);
  }

  private run(
    args: readonly string[],
    stdin?: string,
  ): Promise<SecurityCommandResult> {
    this.assertMacOs();
    return this.runner({
      args: Object.freeze([...args]),
      ...(stdin === undefined ? {} : { stdin }),
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
    });
  }

  private toStoreError(
    result: SecurityCommandResult,
    operation: "status" | "write" | "replace" | "delete",
  ): SetupCredentialStoreError {
    switch (result.kind) {
      case "timeout":
        return new SetupCredentialStoreError("keychain_timeout");
      case "output_limit":
        return new SetupCredentialStoreError("keychain_output_limit");
      case "spawn_error":
        return new SetupCredentialStoreError("keychain_unavailable");
      case "exited":
        return new SetupCredentialStoreError(commandFailureCode(operation));
    }
  }
}
