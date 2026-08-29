import { constants as fsConstants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import type {
  ChangeManifestOmissionCode,
  ChangeSideIdentityV1,
} from "../../shared/change-review-contracts";
import {
  isIgnoredRelativePath,
  isWithinRoot,
  throwIfAborted,
} from "./workspace-policy";

export const MAX_CHANGE_SOURCE_BYTES_PER_SIDE = 256 * 1024;

export interface AdmittedChangeSide {
  identity: ChangeSideIdentityV1;
  text: string | null;
  omissionCodes: ChangeManifestOmissionCode[];
  filesystemFingerprint: string | null;
}

interface StableStat {
  dev: bigint;
  ino: bigint;
  mode: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

function stableStat(stat: {
  dev: bigint;
  ino: bigint;
  mode: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}): StableStat {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

function fingerprint(stat: StableStat): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs]
    .map(String)
    .join(":");
}

function sameStableStat(left: StableStat, right: StableStat): boolean {
  return fingerprint(left) === fingerprint(right);
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function decodeText(content: Uint8Array): string | null {
  if (content.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

function regularMode(mode: bigint): "100644" | "100755" {
  // Git's executable bit is the owner's execute bit. Group/other execute bits
  // alone do not change the regular-file mode recorded in the index.
  return (mode & 0o100n) !== 0n ? "100755" : "100644";
}

function emptySide(
  mode: ChangeSideIdentityV1["mode"],
  sizeBytes: number,
  omissionCodes: ChangeManifestOmissionCode[],
  filesystemFingerprint: string | null,
): AdmittedChangeSide {
  return {
    identity: { mode, sizeBytes, admittedContentSha256: null },
    text: null,
    omissionCodes: [...new Set(omissionCodes)].sort(),
    filesystemFingerprint,
  };
}

export function admitGitBlobSide(
  mode: ChangeSideIdentityV1["mode"],
  content: Uint8Array | null,
  options: { sensitive?: boolean } = {},
): AdmittedChangeSide {
  if (mode === "160000") return emptySide(mode, 0, ["submodule"], null);
  if (content === null) return emptySide(mode, 0, ["unreadable"], null);
  const sizeBytes = content.byteLength;
  if (mode === "120000") return emptySide(mode, sizeBytes, ["symlink"], null);
  if (options.sensitive) return emptySide(mode, sizeBytes, ["unsafe_path"], null);
  if (sizeBytes > MAX_CHANGE_SOURCE_BYTES_PER_SIDE) {
    return emptySide(mode, sizeBytes, ["oversized"], null);
  }
  const text = decodeText(content);
  if (text === null) return emptySide(mode, sizeBytes, ["binary"], null);
  return {
    identity: { mode, sizeBytes, admittedContentSha256: sha256(content) },
    text,
    omissionCodes: [],
    filesystemFingerprint: null,
  };
}

function safeLinkTarget(canonicalRoot: string, lexicalPath: string, target: string): boolean {
  if (path.isAbsolute(target)) return false;
  return isWithinRoot(canonicalRoot, path.resolve(path.dirname(lexicalPath), target));
}

async function readBoundedHandle(
  handle: Awaited<ReturnType<typeof open>>,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  let position = 0;
  while (true) {
    throwIfAborted(signal);
    const capacity = Math.min(64 * 1024, maximumBytes + 1 - total);
    if (capacity <= 0) return null;
    const chunk = Buffer.allocUnsafe(capacity);
    const result = await handle.read(chunk, 0, capacity, position);
    if (result.bytesRead === 0) break;
    chunks.push(chunk.subarray(0, result.bytesRead));
    total += result.bytesRead;
    position += result.bytesRead;
    if (total > maximumBytes) return null;
  }
  return Buffer.concat(chunks, total);
}

export async function readWorkingTreeSide(input: {
  canonicalRoot: string;
  relativePath: string;
  remainingAdmissionBytes?: number;
  signal?: AbortSignal;
}): Promise<AdmittedChangeSide> {
  throwIfAborted(input.signal);
  const lexicalPath = path.join(input.canonicalRoot, ...input.relativePath.split("/"));
  if (!isWithinRoot(input.canonicalRoot, lexicalPath)) {
    return emptySide("100644", 0, ["unsafe_path"], null);
  }
  let before;
  try {
    before = stableStat(await lstat(lexicalPath, { bigint: true }));
  } catch {
    return emptySide("100644", 0, ["unreadable"], null);
  }

  if ((before.mode & BigInt(fsConstants.S_IFMT)) === BigInt(fsConstants.S_IFLNK)) {
    let target = "";
    try {
      target = await readlink(lexicalPath, "utf8");
    } catch {
      return emptySide("120000", Number(before.size), ["symlink", "unreadable"], fingerprint(before));
    }
    const codes: ChangeManifestOmissionCode[] = ["symlink"];
    if (!safeLinkTarget(input.canonicalRoot, lexicalPath, target)) codes.push("unsafe_path");
    return emptySide(
      "120000",
      Buffer.byteLength(target, "utf8"),
      codes,
      `${fingerprint(before)}:${sha256(Buffer.from(target, "utf8"))}`,
    );
  }
  if ((before.mode & BigInt(fsConstants.S_IFMT)) !== BigInt(fsConstants.S_IFREG)) {
    return emptySide("100644", Number(before.size), ["unreadable"], fingerprint(before));
  }
  const mode = regularMode(before.mode);
  if (isIgnoredRelativePath(input.relativePath, "file")) {
    return emptySide(mode, Number(before.size), ["unsafe_path"], fingerprint(before));
  }
  if (before.size > BigInt(MAX_CHANGE_SOURCE_BYTES_PER_SIDE)) {
    return emptySide(mode, Number(before.size), ["oversized"], fingerprint(before));
  }
  const remainingAdmissionBytes = Math.max(
    0,
    Math.min(
      MAX_CHANGE_SOURCE_BYTES_PER_SIDE,
      input.remainingAdmissionBytes ?? MAX_CHANGE_SOURCE_BYTES_PER_SIDE,
    ),
  );
  if (before.size > BigInt(remainingAdmissionBytes)) {
    return emptySide(mode, Number(before.size), ["total_byte_limit"], fingerprint(before));
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = await realpath(lexicalPath);
  } catch {
    throwIfAborted(input.signal);
    return emptySide(mode, Number(before.size), ["unreadable"], fingerprint(before));
  }
  if (!isWithinRoot(input.canonicalRoot, canonicalTarget)) {
    return emptySide(mode, Number(before.size), ["unsafe_path"], fingerprint(before));
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(lexicalPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = stableStat(await handle.stat({ bigint: true }));
    if (!sameStableStat(before, opened)) {
      return emptySide(mode, Number(opened.size), ["unreadable"], fingerprint(opened));
    }
    const content = await readBoundedHandle(handle, remainingAdmissionBytes, input.signal);
    const after = stableStat(await handle.stat({ bigint: true }));
    const current = stableStat(await lstat(lexicalPath, { bigint: true }));
    const currentRealpath = await realpath(lexicalPath);
    if (
      content === null ||
      !sameStableStat(opened, after) ||
      !sameStableStat(after, current) ||
      currentRealpath !== canonicalTarget ||
      !isWithinRoot(input.canonicalRoot, currentRealpath)
    ) {
      return emptySide(
        mode,
        Number(after.size),
        content === null
          ? [
              remainingAdmissionBytes < MAX_CHANGE_SOURCE_BYTES_PER_SIDE
                ? "total_byte_limit"
                : "oversized",
            ]
          : ["unreadable"],
        fingerprint(after),
      );
    }
    const text = decodeText(content);
    if (text === null) {
      return emptySide(mode, content.byteLength, ["binary"], fingerprint(after));
    }
    return {
      identity: {
        mode,
        sizeBytes: content.byteLength,
        admittedContentSha256: sha256(content),
      },
      text,
      omissionCodes: [],
      filesystemFingerprint: fingerprint(after),
    };
  } catch {
    throwIfAborted(input.signal);
    return emptySide(mode, Number(before.size), ["unreadable"], fingerprint(before));
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
