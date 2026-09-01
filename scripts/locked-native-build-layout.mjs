import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
export const lockedNativeSourceRoot = path.join(
  projectRoot,
  "native",
  "macos-credential-lease",
);
export const lockedNativeInstalledRoot = path.join(
  projectRoot,
  "node_modules",
  "@soar",
  "macos-credential-lease",
);
export const lockedNativeBinaryPath = path.join(
  lockedNativeInstalledRoot,
  "build",
  "Release",
  "soar_macos_credential_lease.node",
);

export const LOCKED_NATIVE_BUILD_INPUTS = Object.freeze([
  "package.json",
  "locked-flavor.json",
  "binding.gyp",
  "src/addon.mm",
  "src/identity-policy.cc",
  "src/identity-policy.hpp",
  "src/lease-state-machine.cc",
  "src/lease-state-machine.hpp",
  "src/secure-zero.hpp",
]);

/**
 * pnpm installs a `file:` dependency as a copied package, not a live source
 * link. Refresh the exact reviewed build inputs before every native rebuild so
 * a contributor can never package a stale addon after editing `native/`.
 */
export async function syncLockedNativeBuildInputs(options = {}) {
  const sourceRoot = options.sourceRoot ?? lockedNativeSourceRoot;
  const installedRoot = options.installedRoot ?? lockedNativeInstalledRoot;
  for (const relativePath of LOCKED_NATIVE_BUILD_INPUTS) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const metadata = await stat(sourcePath);
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > 1024 * 1024) {
      throw new Error(
        `Locked native build input is missing, empty, or oversized: ${relativePath}`,
      );
    }
    const destinationPath = path.join(installedRoot, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }
}
