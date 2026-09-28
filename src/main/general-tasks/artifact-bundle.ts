import { createHash } from "node:crypto";

export interface ArtifactBundleRecord { path: string; bytes: number; sha256: string }
export interface ArtifactBundleFile { path: string; bytes: Buffer }
export interface ArtifactBundleManifest { manifestSha256: string; fileCount: number; totalBytes: number }

const MAX_FILES = 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const UTF8_FLAG = 0x0800;
const DOS_DATE = 0x0021; // 1980-01-01, the earliest representable ZIP date.
const forbidden = /[<>:"|?*\\\x00-\x1f\x7f]/u;
const devices = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$|clock\$)$/iu;
const unpairedSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
function requireValue(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
function exactKeys(value: unknown, keys: string[]): void {
  requireValue(value !== null && typeof value === "object" && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), "artifact_bundle_record_invalid");
}
function collisionKey(value: string): string {
  // Compatibility normalization also catches full-width drive syntax and device names.
  // Upper/lower folding catches multi-character case equivalents such as ß and SS.
  return value.normalize("NFKC").toUpperCase().toLowerCase().normalize("NFC");
}
function archiveName(value: unknown): string {
  requireValue(typeof value === "string" && value.startsWith("output/") && value.length <= 240 && !unpairedSurrogate.test(value), "artifact_bundle_path_invalid");
  const name = value.slice("output/".length), components = name.split("/");
  for (const component of components) {
    const normalized = collisionKey(component);
    requireValue(component.length > 0 && component !== "." && component !== ".." && !forbidden.test(component) && !/[. ]$/u.test(component) &&
      normalized.length > 0 && normalized !== "." && normalized !== ".." && !normalized.includes("/") && !forbidden.test(normalized) && !/[. ]$/u.test(normalized) &&
      !devices.test(normalized.split(".")[0]!.replace(/ +$/u, "")), "artifact_bundle_path_invalid");
  }
  return name;
}
function validate<T extends { path: string; size: number }>(files: T[]): { files: (T & { name: string; encodedName: Buffer })[]; totalBytes: number } {
  requireValue(files.length <= MAX_FILES, "artifact_bundle_size_exceeded");
  let totalBytes = 0;
  const entries = files.map(file => {
    requireValue(Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= MAX_FILE_BYTES, "artifact_bundle_size_exceeded");
    totalBytes += file.size;
    requireValue(totalBytes <= MAX_TOTAL_BYTES, "artifact_bundle_size_exceeded");
    const name = archiveName(file.path);
    return { ...file, name, encodedName: Buffer.from(name, "utf8") };
  });
  const names = new Set<string>(), directories = new Map<string, string>();
  for (const file of entries) {
    const key = collisionKey(file.name);
    requireValue(!names.has(key), "artifact_bundle_path_collision"); names.add(key);
    const components = file.name.split("/");
    for (let i = 1; i < components.length; i++) {
      const directory = components.slice(0, i).join("/"), directoryKey = collisionKey(directory);
      requireValue(!directories.has(directoryKey) || directories.get(directoryKey) === directory, "artifact_bundle_path_collision");
      directories.set(directoryKey, directory);
    }
  }
  requireValue([...directories.keys()].every(directory => !names.has(directory)), "artifact_bundle_path_collision");
  entries.sort((a, b) => Buffer.compare(a.encodedName, b.encodedName));
  return { files: entries, totalBytes };
}

/** Identity of the exact output inventory; input order does not affect the hash. */
export function bundleManifest(records: readonly ArtifactBundleRecord[]): ArtifactBundleManifest {
  requireValue(Array.isArray(records) && records.length <= MAX_FILES, "artifact_bundle_size_exceeded");
  const normalized = records.map(record => {
    exactKeys(record, ["path", "bytes", "sha256"]);
    requireValue(typeof record.sha256 === "string" && /^[a-f0-9]{64}$/u.test(record.sha256), "artifact_bundle_digest_invalid");
    return { path: record.path, size: record.bytes, sha256: record.sha256 };
  });
  const validated = validate(normalized);
  const files = validated.files.map(file => ({ path: file.path, bytes: file.size, sha256: file.sha256 }));
  const manifestSha256 = createHash("sha256").update(JSON.stringify({ version: 1, files })).digest("hex");
  return { manifestSha256, fileCount: files.length, totalBytes: validated.totalBytes };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP32 STORE over already verified checkpoint bytes. No paths are read or extracted. */
export function buildArtifactBundle(input: readonly ArtifactBundleFile[]): Buffer {
  requireValue(Array.isArray(input) && input.length <= MAX_FILES, "artifact_bundle_size_exceeded");
  const normalized = input.map(file => {
    exactKeys(file, ["path", "bytes"]);
    requireValue(Buffer.isBuffer(file.bytes), "artifact_bundle_bytes_invalid");
    return { path: file.path, bytes: file.bytes, size: file.bytes.length };
  });
  const { files, totalBytes } = validate(normalized);
  const namesBytes = files.reduce((sum, file) => sum + file.encodedName.length, 0);
  const centralSize = files.length * 46 + namesBytes;
  const centralOffset = totalBytes + files.length * 30 + namesBytes;
  const archive = Buffer.alloc(centralOffset + centralSize + 22);
  let offset = 0, central = centralOffset;
  for (const file of files) {
    const name = file.encodedName, dataOffset = offset + 30 + name.length;
    name.copy(archive, offset + 30); file.bytes.copy(archive, dataOffset);
    const crc = crc32(archive.subarray(dataOffset, dataOffset + file.size));
    archive.writeUInt32LE(0x04034b50, offset);
    archive.writeUInt16LE(20, offset + 4); archive.writeUInt16LE(UTF8_FLAG, offset + 6);
    archive.writeUInt16LE(DOS_DATE, offset + 12); archive.writeUInt32LE(crc, offset + 14);
    archive.writeUInt32LE(file.size, offset + 18); archive.writeUInt32LE(file.size, offset + 22); archive.writeUInt16LE(name.length, offset + 26);
    archive.writeUInt32LE(0x02014b50, central);
    archive.writeUInt16LE((3 << 8) | 20, central + 4); archive.writeUInt16LE(20, central + 6);
    archive.writeUInt16LE(UTF8_FLAG, central + 8); archive.writeUInt16LE(DOS_DATE, central + 14);
    archive.writeUInt32LE(crc, central + 16); archive.writeUInt32LE(file.size, central + 20); archive.writeUInt32LE(file.size, central + 24);
    archive.writeUInt16LE(name.length, central + 28); archive.writeUInt32LE((0o100644 << 16) >>> 0, central + 38); archive.writeUInt32LE(offset, central + 42);
    name.copy(archive, central + 46);
    offset = dataOffset + file.size; central += 46 + name.length;
  }
  archive.writeUInt32LE(0x06054b50, central);
  archive.writeUInt16LE(files.length, central + 8); archive.writeUInt16LE(files.length, central + 10);
  archive.writeUInt32LE(centralSize, central + 12); archive.writeUInt32LE(centralOffset, central + 16);
  return archive;
}
