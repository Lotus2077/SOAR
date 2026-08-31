import type {
  SetupCredentialStatus,
  SetupOnlyCredentialStore,
} from "./macos-keychain-credential-store";

/**
 * Deterministic fake-mode setup store.
 *
 * This adapter deliberately remembers only a presence bit. It never retains
 * the supplied credential and is constructed only when SOAR_PROVIDER_MODE is
 * `fake`, so Electron tests cannot read or modify the user's real Keychain.
 */
export class EphemeralSetupCredentialStore
  implements SetupOnlyCredentialStore
{
  private stored = false;

  status(): Promise<SetupCredentialStatus> {
    return Promise.resolve(
      Object.freeze({ state: this.stored ? "stored" : "not_stored" }),
    );
  }

  has(): Promise<boolean> {
    return Promise.resolve(this.stored);
  }

  write(_credential: string): Promise<void> {
    this.stored = true;
    return Promise.resolve();
  }

  replace(_credential: string): Promise<void> {
    this.stored = true;
    return Promise.resolve();
  }

  delete(): Promise<boolean> {
    const existed = this.stored;
    this.stored = false;
    return Promise.resolve(existed);
  }
}
