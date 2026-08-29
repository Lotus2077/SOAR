export interface SecretPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

export const secretPatterns: readonly SecretPattern[];
