import { constants, mkdirSync, openSync, closeSync, writeSync, fsyncSync, readFileSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";
import { z } from "zod";
import { canonical, digest, privateAgentId, sha256Schema } from "./contracts";

const SnapshotSchema = z.array(z.object({ path: z.string().min(1).max(240), sha256: sha256Schema,
  bytes: z.number().int().nonnegative().max(64 * 1024 * 1024) }).strict()).max(1024);
export type WorkspaceSnapshot = z.infer<typeof SnapshotSchema>;

function safeArtifactPath(value: string): boolean {
  return !/[\\\x00-\x1f\x7f]/u.test(value) && value.split("/").every(part => part && part !== "." && part !== "..");
}

/** Host-only content-addressed storage. Model paths are metadata, never host paths. */
export class PrivateCheckpointStore {
  private readonly directory: string;
  constructor(root: string, jobId: string) {
    privateAgentId.parse(jobId);
    this.directory = join(resolve(root), jobId);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (lstatSync(this.directory).isSymbolicLink() || !lstatSync(this.directory).isDirectory()) throw new Error("checkpoint_directory_invalid");
  }

  save(files: { path: string; bytes: Buffer }[]): WorkspaceSnapshot {
    if (files.length > 1024 || new Set(files.map(file => file.path)).size !== files.length ||
        files.reduce((sum, file) => sum + file.bytes.length, 0) > 128 * 1024 * 1024) throw new Error("checkpoint_size_exceeded");
    const snapshot = SnapshotSchema.parse(files.map(file => ({ path: file.path, sha256: digest(file.bytes), bytes: file.bytes.length })));
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!, record = snapshot[i]!;
      if (!safeArtifactPath(record.path)) throw new Error("checkpoint_path_invalid");
      const target = join(this.directory, record.sha256);
      let descriptor: number;
      try { descriptor = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("checkpoint_write_failed");
        this.load([record]); continue;
      }
      try { let offset = 0; while (offset < file.bytes.length) offset += writeSync(descriptor, file.bytes, offset); fsyncSync(descriptor); }
      finally { closeSync(descriptor); }
    }
    const directory = openSync(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return snapshot;
  }

  load(value: WorkspaceSnapshot): { path: string; bytes: Buffer }[] {
    const snapshot = SnapshotSchema.parse(value);
    if (snapshot.reduce((sum, item) => sum + item.bytes, 0) > 128 * 1024 * 1024) throw new Error("checkpoint_size_exceeded");
    return snapshot.map(record => {
      if (!safeArtifactPath(record.path)) throw new Error("checkpoint_path_invalid");
      const target = join(this.directory, record.sha256), info = lstatSync(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== record.bytes) throw new Error("checkpoint_file_invalid");
      const descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try { bytes = readFileSync(descriptor); } finally { closeSync(descriptor); }
      if (bytes.length !== record.bytes || digest(bytes) !== record.sha256) throw new Error("checkpoint_digest_mismatch");
      return { path: record.path, bytes };
    });
  }

  fingerprint(snapshot: WorkspaceSnapshot): string { return digest(canonical(SnapshotSchema.parse(snapshot))); }
}
