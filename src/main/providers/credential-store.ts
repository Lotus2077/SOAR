const credentialReferencePattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

function validateReference(reference: string): void {
  if (!credentialReferencePattern.test(reference)) {
    throw new TypeError("credential reference must be a bounded opaque identifier");
  }
}

function validateCredential(credential: string): void {
  if (
    credential.length === 0 ||
    credential.length > 16_384 ||
    credential.includes("\0") ||
    credential.trim() !== credential
  ) {
    throw new TypeError("credential must be a non-empty bounded exact value");
  }
}

/** Main-process-only storage contract. Renderer IPC is intentionally absent. */
export interface CredentialStore {
  read(reference: string): Promise<string | undefined>;
  write(reference: string, credential: string): Promise<void>;
  delete(reference: string): Promise<boolean>;
}

/** Deterministic test/development double. It must never be used by production bootstrap. */
export class FakeCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  async read(reference: string): Promise<string | undefined> {
    validateReference(reference);
    return this.values.get(reference);
  }

  async write(reference: string, credential: string): Promise<void> {
    validateReference(reference);
    validateCredential(credential);
    this.values.set(reference, credential);
  }

  async delete(reference: string): Promise<boolean> {
    validateReference(reference);
    return this.values.delete(reference);
  }

  /** Test-only metadata that never exposes stored values. */
  references(): string[] {
    return [...this.values.keys()].sort();
  }
}
