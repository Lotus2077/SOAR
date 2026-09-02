export function packagedOutputText(
  archivePath: string,
  entries: readonly string[],
): string;

export function verifyLockedMacPackage(appPath: string): Promise<void>;
