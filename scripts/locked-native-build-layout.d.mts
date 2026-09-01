export const projectRoot: string;
export const lockedNativeSourceRoot: string;
export const lockedNativeInstalledRoot: string;
export const lockedNativeBinaryPath: string;
export const LOCKED_NATIVE_BUILD_INPUTS: readonly string[];

export function syncLockedNativeBuildInputs(options?: {
  sourceRoot?: string;
  installedRoot?: string;
}): Promise<void>;
