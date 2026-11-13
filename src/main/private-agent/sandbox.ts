import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export const PRIVATE_SANDBOX_LIMITS = Object.freeze({
  files: 1024, fileBytes: 64 * 1024 * 1024, importBytes: 128 * 1024 * 1024,
  outputBytes: 256 * 1024, commandBytes: 64 * 1024, commandMs: 600_000, lifetimeSeconds: 7200,
});
/** A command the model runs is stopped inside the container at this exit code; the container survives. */
export const SANDBOX_COMMAND_TIMEOUT_EXIT_CODE = 124;

export const SANDBOX_ERROR_CODES = ["invalid_input", "unavailable", "command_timeout", "cancelled",
  "output_limit", "unsafe_file", "unusable", "busy", "cleanup_failed"] as const;
export type SandboxErrorCode = (typeof SANDBOX_ERROR_CODES)[number];

/** Errors deliberately contain no daemon diagnostics, commands, file contents or host paths. */
export class SandboxError extends Error {
  constructor(readonly code: SandboxErrorCode) { super(`Private sandbox: ${code}`); this.name = "SandboxError"; }
}

/**
 * Why the lister left a workspace entry out of a capture (backlog item 3, BL-20261107-0924, B): a link, a special file, a file
 * over 64 MiB, a name the host path rule refuses (counted, never named), a regular file beyond the 1,024-file cap, and, added by
 * the runner, a file beyond the 128 MiB total. The lister reports instead of dying, so an ordinary workspace (a virtual
 * environment, a clone) no longer destroys the container at capture.
 */
export const LISTER_OMISSION_REASONS = ["symlink", "hard_link", "special", "oversize", "name_invalid", "cap"] as const;
export const WORKSPACE_OMISSION_REASONS = [...LISTER_OMISSION_REASONS, "total_cap"] as const;
export type WorkspaceOmissionReason = (typeof WORKSPACE_OMISSION_REASONS)[number];
/** The walk stops once this many entries have been seen; the report then says it is incomplete. */
export const WORKSPACE_LISTING_MAX_ENTRIES = 4096;
/** At most this many omitted paths are named; every omission is counted per reason. */
export const WORKSPACE_LISTING_MAX_OMITTED_PATHS = 32;
export interface WorkspaceListing {
  files: { path: string; size: number }[];
  omitted: { path: string; reason: WorkspaceOmissionReason }[];
  counts: Record<(typeof LISTER_OMISSION_REASONS)[number], number>;
  /** False when the walk stopped at the entry cap, so more entries may be missing than were counted. */
  complete: boolean;
}

export interface DockerSandboxInput {
  imageId: string;
  jobId: string;
  contextId: string;
  files: { path: string; bytes: Buffer }[];
  /** Trusted host-only daemon binding; never a model tool argument. */
  endpoint?: string;
  /** Independent daemon-side maximum lifetime, including after host failure. */
  lifetimeSeconds?: number;
}
export interface SandboxExecution { exitCode: number; stdout: string; stderr: string }
export interface SandboxEdit { ok: boolean; reason?: string; bytes?: number; occurrences?: number }

function validPath(value: string): boolean {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 240
    && Buffer.from(value).toString("utf8") === value && !/[\\\x00-\x1f\x7f]/u.test(value)
    && value.split("/").every(part => part !== "" && part !== "." && part !== "..")
    && value.split("/").length <= 32;
}

const validIdentity = (value: string) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(value);
const validEndpoint = (value: string) => typeof value === "string" && /^unix:\/\/\/[^\x00-\x20\x7f]+$/u.test(value);

function checkedInput(input: DockerSandboxInput): DockerSandboxInput {
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.imageId)
    || ![input.jobId, input.contextId].every(validIdentity)
    || (input.endpoint !== undefined && !validEndpoint(input.endpoint))
    || (input.lifetimeSeconds !== undefined && (!Number.isInteger(input.lifetimeSeconds) || input.lifetimeSeconds < 1 || input.lifetimeSeconds > PRIVATE_SANDBOX_LIMITS.lifetimeSeconds))
    || !Array.isArray(input.files) || input.files.length > PRIVATE_SANDBOX_LIMITS.files) throw new SandboxError("invalid_input");
  let total = 0;
  const names = new Set<string>();
  const files = input.files.map(file => {
    if (!validPath(file.path) || names.has(file.path) || !Buffer.isBuffer(file.bytes)
      || file.bytes.length > PRIVATE_SANDBOX_LIMITS.fileBytes) throw new SandboxError("invalid_input");
    names.add(file.path); total += file.bytes.length;
    if (total > PRIVATE_SANDBOX_LIMITS.importBytes) throw new SandboxError("invalid_input");
    // The caller cannot change admitted bytes while asynchronous container creation is in progress.
    return { path: file.path, bytes: Buffer.from(file.bytes) };
  });
  for (const name of names) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join("/"))) throw new SandboxError("invalid_input");
  }
  return { imageId: input.imageId, jobId: input.jobId, contextId: input.contextId, files,
    endpoint: input.endpoint, lifetimeSeconds: input.lifetimeSeconds ?? 1800 };
}

interface ProcessResult { exitCode: number; stdout: Buffer; stderr: Buffer; truncated: boolean }
interface ProcessOptions {
  timeoutMs: number; maxBytes: number; signal?: AbortSignal; input?: AsyncIterable<Buffer>;
  /** Keep the first `maxBytes` of both streams and discard the rest instead of failing closed (the model's `execute` only). */
  truncate?: boolean;
}

/**
 * Host-side output bound (backlog item 3, finding A4). Every protocol call fails closed at its cap, since more output than the
 * protocol allows means a malformed reply. The model's `execute` instead keeps the first `maxBytes` of stdout and stderr together
 * in arrival order, cutting the chunk that crosses the cap, and discards the rest while the client stays attached, so the command
 * runs to its own end (or to the in-container timeout), its exit code is its own and the container stays usable. Exported for the
 * unit test; `push` returns false when the caller must fail.
 */
export function boundedOutputCollector(maxBytes: number, truncate: boolean): { push(target: Buffer[], chunk: Buffer): boolean; truncated(): boolean } {
  let size = 0, truncated = false;
  return {
    push(target, chunk) {
      const room = maxBytes - size;
      if (chunk.length <= room) { size += chunk.length; target.push(chunk); return true; }
      if (!truncate) return false;
      truncated = true;
      if (room > 0) { target.push(chunk.subarray(0, room)); size = maxBytes; }
      return true;
    },
    truncated: () => truncated,
  };
}

// These variables configure the trusted Docker client only. None is passed to the container.
function clientEnvironment(pinned: boolean): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT"]) {
    if (pinned && (key === "DOCKER_HOST" || key === "DOCKER_CONTEXT")) continue;
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  return result;
}

function docker(args: string[], options: ProcessOptions): Promise<ProcessResult> {
  if (options.signal?.aborted) return Promise.reject(new SandboxError("cancelled"));
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { env: clientEnvironment(args[0] === "--host"), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let settled = false;
    const bound = boundedOutputCollector(options.maxBytes, options.truncate === true);
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", cancelled); };
    const fail = (code: SandboxErrorCode) => {
      if (settled) return;
      settled = true; cleanup(); child.stdin.destroy(); child.kill("SIGKILL");
      reject(new SandboxError(code));
    };
    const cancelled = () => fail("cancelled");
    const timer = setTimeout(() => fail("command_timeout"), options.timeoutMs);
    options.signal?.addEventListener("abort", cancelled, { once: true });
    // An abort between the initial check and listener registration must not escape the gate.
    if (options.signal?.aborted) cancelled();
    const collect = (target: Buffer[], chunk: Buffer) => {
      if (settled) return;
      if (!bound.push(target, chunk)) fail("output_limit");
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", () => fail("unavailable"));
    child.stdin.on("error", () => { /* Close/exit below owns the outcome; EPIPE must not leak an unhandled error. */ });
    child.once("close", code => {
      if (settled) return;
      settled = true; cleanup();
      if (code === null) reject(new SandboxError("unavailable"));
      else resolve({ exitCode: code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), truncated: bound.truncated() });
    });
    void (async () => {
      try {
        if (options.input) for await (const chunk of options.input) {
          if (settled) return;
          await new Promise<void>((yes, no) => child.stdin.write(chunk, error => error ? no(error) : yes()));
        }
        if (!settled) child.stdin.end();
      } catch { if (!settled) fail("unavailable"); }
    })();
  });
}

// This fixed host protocol never evaluates a path or file as code. Every opened component
// uses dir_fd + O_NOFOLLOW, including against malicious background descendants.
const FILE_HELPERS = String.raw`
import os, sys, stat, json
def die():
    sys.exit(53)
def valid(p):
    try:
        return isinstance(p, str) and 0 < len(p.encode('utf-8')) <= 240 and len(p.split('/')) <= 32 and all(x not in ('', '.', '..') for x in p.split('/')) and not any(ord(c) < 32 or ord(c) == 127 or c == '\\' for c in p)
    except UnicodeEncodeError:
        return False
def root():
    return os.open('/workspace', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
def parent(p, create=False):
    if not valid(p): die()
    fd = root()
    try:
        parts = p.split('/')
        for part in parts[:-1]:
            if create:
                try: os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError: pass
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise
def regular(s):
    return stat.S_ISREG(s.st_mode) and s.st_nlink == 1
`;

const IMPORT_FILES = FILE_HELPERS + String.raw`
try:
    header = sys.stdin.buffer.readline(1048577)
    if len(header) > 1048576 or not header.endswith(b'\n'): die()
    rows = json.loads(header)
    if not isinstance(rows, list) or len(rows) > 1024: die()
    total = 0
    for p, n in rows:
        if not valid(p) or type(n) is not int or n < 0 or n > 67108864: die()
        total += n
        if total > 134217728: die()
        fd, name = parent(p, True)
        try:
            out = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            with os.fdopen(out, 'wb') as stream:
                remaining = n
                while remaining:
                    data = sys.stdin.buffer.read(min(65536, remaining))
                    if not data: die()
                    stream.write(data)
                    remaining -= len(data)
        finally: os.close(fd)
    if sys.stdin.buffer.read(1): die()
except BaseException:
    die()
`;

const READ_FILE = FILE_HELPERS + String.raw`
try:
    p, limit = json.loads(sys.argv[1])
    fd, name = parent(p)
    try: source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    finally: os.close(fd)
    with os.fdopen(source, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not regular(before) or before.st_size > limit: die()
        remaining = before.st_size
        while remaining:
            data = stream.read(min(65536, remaining))
            if not data: die()
            sys.stdout.buffer.write(data)
            remaining -= len(data)
        after = os.fstat(stream.fileno())
        if stream.read(1) or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns): die()
except BaseException:
    die()
`;

/**
 * Backlog item 3 (BL-20261107-0924, B): the lister walks /workspace in sorted order through dir_fd + O_NOFOLLOW, never follows
 * a link, and reports what it leaves out instead of dying: a symlink, a multi-link file, a FIFO, socket or device, a file over
 * 64 MiB, a name the host path rule refuses (counted, never named: its name fails that very rule) and a regular file beyond the
 * 1,024-file cap. Once 4,096 entries have been seen the walk stops and the report says it is incomplete. die() (exit 53) remains
 * only for the walk's own failure, which the host maps to unsafe_file as before. Exported for the host-side unit test, which
 * runs it under the machine's python3 against a temporary directory in place of /workspace.
 *
 * E1-L (BL-20261109-0423): the first stdin line is a JSON array of at most 1,024 host-pinned paths. Before the walk each is looked up from
 * the root without following a link (a missing, linked or non-directory component skips it); a regular, single-link file of at most
 * 64 MiB is kept first, in the host's order and within the cap. The walk then skips the files already kept, so they are neither listed
 * twice nor counted against the cap, and a directory that sorts first can no longer push them out. The pinned pass does not count toward
 * the 4,096-entry walk limit.
 */
export const LIST_FILES = FILE_HELPERS + String.raw`
try:
    header = sys.stdin.buffer.readline(1048577)
    if len(header) > 1048576 or not header.endswith(b'\n'): die()
    wanted = json.loads(header)
    if not isinstance(wanted, list) or len(wanted) > 1024 or not all(isinstance(p, str) for p in wanted): die()
    files, omitted, seen, complete, kept = [], [], [0], [True], set()
    counts = {'symlink': 0, 'hard_link': 0, 'special': 0, 'oversize': 0, 'name_invalid': 0, 'cap': 0}
    def omit(p, reason):
        counts[reason] += 1
        if p is not None and len(omitted) < 32: omitted.append([p, reason])
    def pinned(p):
        if not valid(p): return None
        try: fd, name = parent(p)
        except OSError: return None
        try: s = os.stat(name, dir_fd=fd, follow_symlinks=False)
        except OSError: return None
        finally: os.close(fd)
        return s if regular(s) and s.st_size <= 67108864 else None
    for p in wanted:
        if p in kept or len(files) >= 1024: continue
        s = pinned(p)
        if s is not None:
            files.append([p, s.st_size])
            kept.add(p)
    def walk(fd, prefix=''):
        for entry in sorted(os.scandir(fd), key=lambda e: e.name):
            if seen[0] >= 4096:
                complete[0] = False
                return
            seen[0] += 1
            p = prefix + entry.name
            if p in kept: continue
            if not valid(p):
                omit(None, 'name_invalid')
                continue
            s = entry.stat(follow_symlinks=False)
            if stat.S_ISDIR(s.st_mode):
                sub = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try: walk(sub, p + '/')
                finally: os.close(sub)
                if not complete[0]: return
            elif stat.S_ISLNK(s.st_mode): omit(p, 'symlink')
            elif not stat.S_ISREG(s.st_mode): omit(p, 'special')
            elif s.st_nlink != 1: omit(p, 'hard_link')
            elif s.st_size > 67108864: omit(p, 'oversize')
            elif len(files) >= 1024: omit(p, 'cap')
            else: files.append([p, s.st_size])
    fd = root()
    try: walk(fd)
    finally: os.close(fd)
    files.sort()
    print(json.dumps({'files': files, 'omitted': omitted, 'counts': counts, 'complete': complete[0]}, ensure_ascii=True))
except BaseException:
    die()
`;

/**
 * The lister's first stdin line (E1-L): the host's pinned paths, each once and in order, only those the host path rule admits, at most
 * 1,024. It never throws for a path, so no pinned path can make a capture fail. Exported for the unit test.
 */
export function pinnedListingHeader(pinned: readonly string[]): Buffer {
  return Buffer.from(`${JSON.stringify([...new Set(pinned)].filter(path => typeof path === "string" && validPath(path)).slice(0, PRIVATE_SANDBOX_LIMITS.files))}\n`);
}

/**
 * Parses and validates the lister's reply; any other shape is refused as unsafe_file (the container is then closed, and the
 * runner recreates it from the last checkpoint). Exported for the unit test.
 */
export function parseWorkspaceListing(raw: Buffer | string): WorkspaceListing {
  const refuse = () => new SandboxError("unsafe_file");
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch { throw refuse(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join() !== "complete,counts,files,omitted") throw refuse();
  const { files, omitted, counts, complete } = parsed as Record<string, unknown>;
  if (typeof complete !== "boolean" || !Array.isArray(files) || files.length > PRIVATE_SANDBOX_LIMITS.files || !Array.isArray(omitted) || omitted.length > WORKSPACE_LISTING_MAX_OMITTED_PATHS ||
      !counts || typeof counts !== "object" || Array.isArray(counts) || Object.keys(counts).sort().join() !== [...LISTER_OMISSION_REASONS].sort().join()) throw refuse();
  const sizes = Object.values(counts as Record<string, unknown>);
  if (!sizes.every(count => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) throw refuse();
  const names = new Set<string>();
  const listed = files.map(item => {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" || !validPath(item[0]) || names.has(item[0]) ||
        typeof item[1] !== "number" || !Number.isSafeInteger(item[1]) || item[1] < 0 || item[1] > PRIVATE_SANDBOX_LIMITS.fileBytes) throw refuse();
    names.add(item[0]); return { path: item[0], size: item[1] };
  });
  // E1-L: the pinned pass and the walk are two passes, so a pinned file whose parent directory became a file between them would be listed
  // beside that file. DockerSandbox.create refuses such a pair for good, so it is refused here, the way today's races already end. (A pinned
  // file that became a directory is skipped by the walk before it is opened, and its read then fails as any changed file's does.)
  for (const name of names) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join("/"))) throw refuse();
  }
  const left = omitted.map(item => {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" || !validPath(item[0]) || names.has(item[0]) ||
        typeof item[1] !== "string" || !(LISTER_OMISSION_REASONS as readonly string[]).includes(item[1])) throw refuse();
    names.add(item[0]); return { path: item[0], reason: item[1] as WorkspaceOmissionReason };
  });
  return { files: listed, omitted: left, counts: counts as WorkspaceListing["counts"], complete };
}

const EDIT_FILE = FILE_HELPERS + String.raw`
def soft(reason, **extra):
    print(json.dumps(dict(ok=False, reason=reason, **extra)))
    sys.exit(54)
def read_exact(n):
    buf = bytearray()
    while len(buf) < n:
        data = sys.stdin.buffer.read(min(65536, n - len(buf)))
        if not data: die()
        buf += data
    return bytes(buf)
try:
    spec = json.loads(sys.argv[1])
    mode, p = spec[0], spec[1]
    if mode not in ('write', 'append', 'replace') or not valid(p): die()
    try: fd, name = parent(p, True)
    except (NotADirectoryError, FileExistsError, PermissionError): soft('path_not_writable')
    try:
        try:
            st = os.stat(name, dir_fd=fd, follow_symlinks=False)
            exists = True
            if not regular(st): soft('path_not_regular_file')
        except FileNotFoundError:
            exists, st = False, None
        if mode == 'replace':
            n_old, n_new = spec[2], spec[3]
            if type(n_old) is not int or type(n_new) is not int or n_old < 1 or n_new < 0 or n_old + n_new > 2097152: die()
            old, new = read_exact(n_old), read_exact(n_new)
            if sys.stdin.buffer.read(1): die()
            if not exists: soft('file_missing')
            if st.st_size > 67108864: soft('file_too_large')
            src = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
            with os.fdopen(src, 'rb') as stream: data = stream.read()
            count = data.count(old)
            if count != 1: soft('occurrences_not_one', occurrences=count)
            data = data.replace(old, new, 1)
            if len(data) > 67108864: soft('file_too_large')
            tmp = name + '.soar-edit-tmp'
            try:
                out = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                with os.fdopen(out, 'wb') as stream: stream.write(data)
                os.replace(tmp, name, src_dir_fd=fd, dst_dir_fd=fd)
            except OSError:
                try: os.unlink(tmp, dir_fd=fd)
                except OSError: pass
                soft('write_failed')
            print(json.dumps(dict(ok=True, bytes=len(data)))); sys.exit(0)
        n = spec[2]
        if type(n) is not int or n < 0 or n > 67108864: die()
        payload = read_exact(n)
        if sys.stdin.buffer.read(1): die()
        if mode == 'append' and exists and st.st_size + n > 67108864: soft('file_too_large')
        flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | (os.O_APPEND if mode == 'append' else os.O_TRUNC)
        try:
            out = os.open(name, flags, 0o600, dir_fd=fd)
            with os.fdopen(out, 'wb') as stream: stream.write(payload)
        except OSError: soft('write_failed')
        print(json.dumps(dict(ok=True, bytes=os.stat(name, dir_fd=fd, follow_symlinks=False).st_size))); sys.exit(0)
    finally: os.close(fd)
except SystemExit:
    raise
except BaseException:
    die()
`;

export class DockerSandbox {
  readonly imageId: string;
  readonly jobId: string;
  readonly contextId: string;
  private readonly name = `soar-private-${randomUUID()}`;
  private readonly label = `soar.private-sandbox-id=${this.name}`;
  private host = "";
  private usable = false;
  private busy = false;
  private closing?: Promise<void>;

  get endpoint(): string { return this.host; }

  private constructor(input: DockerSandboxInput) {
    this.imageId = input.imageId; this.jobId = input.jobId; this.contextId = input.contextId;
  }

  static async currentEndpoint(): Promise<string> {
    // Pin the selected local socket once. A later Docker context/config change cannot
    // redirect this context to another daemon. Remote TCP/SSH daemons are ineligible.
    let endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT ? process.env.DOCKER_HOST : undefined;
    if (!endpoint) {
      const result = await docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { timeoutMs: 10_000, maxBytes: 4096 });
      if (result.exitCode !== 0) throw new SandboxError("unavailable");
      endpoint = result.stdout.toString("utf8").trim();
    }
    if (!validEndpoint(endpoint)) throw new SandboxError("unavailable");
    return endpoint;
  }

  /** Call only after the trusted host has acquired durable recovery authority. */
  static async cleanupOwnedContext(input: { endpoint: string; jobId: string; contextId: string }): Promise<void> {
    const { endpoint, jobId, contextId } = input;
    if (!validEndpoint(endpoint) || ![jobId, contextId].every(validIdentity)) throw new SandboxError("invalid_input");
    const filters = ["--filter", "label=soar.private-sandbox-id", "--filter", `label=soar.private-job-id=${jobId}`,
      "--filter", `label=soar.private-context-id=${contextId}`];
    const call = (args: string[]) => docker(["--host", endpoint, ...args], { timeoutMs: 20_000, maxBytes: 64 * 1024 });
    try {
      const found = await call(["container", "ls", "--all", "--quiet", "--no-trunc", ...filters]);
      if (found.exitCode !== 0) throw new SandboxError("cleanup_failed");
      const ids = found.stdout.toString("utf8").trim().split("\n").filter(Boolean);
      if (ids.length > 16 || new Set(ids).size !== ids.length || !ids.every(id => /^[a-f0-9]{64}$/u.test(id))) throw new SandboxError("cleanup_failed");
      if (ids.length) {
        const inspected = await call(["inspect", "--format", '{"Id":{{json .Id}},"Name":{{json .Name}},"Labels":{{json .Config.Labels}}}', ...ids]);
        if (inspected.exitCode !== 0) throw new SandboxError("cleanup_failed");
        const rows = inspected.stdout.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
        if (rows.length !== ids.length || rows.some((row, index) => row.Id !== ids[index]
          || !/^\/soar-private-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(row.Name)
          || row.Labels?.["soar.private-sandbox-id"] !== row.Name.slice(1)
          || row.Labels?.["soar.private-job-id"] !== jobId || row.Labels?.["soar.private-context-id"] !== contextId)) throw new SandboxError("cleanup_failed");
        const removed = await call(["rm", "--force", ...ids]);
        if (removed.exitCode !== 0) throw new SandboxError("cleanup_failed");
      }
      const remaining = await call(["container", "ls", "--all", "--quiet", "--no-trunc", ...filters]);
      if (remaining.exitCode !== 0 || remaining.stdout.toString("utf8").trim()) throw new SandboxError("cleanup_failed");
    } catch { throw new SandboxError("cleanup_failed"); }
  }

  static async create(raw: DockerSandboxInput): Promise<DockerSandbox> {
    const input = checkedInput(raw), sandbox = new DockerSandbox(input);
    sandbox.host = input.endpoint ?? await DockerSandbox.currentEndpoint();
    try {
      const image = await sandbox.call(["image", "inspect", "--format", '{"Id":{{json .Id}},"Os":{{json .Os}},"Volumes":{{json (index .Config "Volumes")}}}', input.imageId], { timeoutMs: 10_000, maxBytes: 4096 });
      if (image.exitCode !== 0) throw new SandboxError("unavailable");
      const imageConfig = JSON.parse(image.stdout.toString("utf8"));
      if (imageConfig.Id !== input.imageId || imageConfig.Os !== "linux" || Object.keys(imageConfig.Volumes ?? {}).length > 0) throw new SandboxError("unavailable");
      await sandbox.checked(["create", "--pull", "never", "--name", sandbox.name,
        "--label", sandbox.label, "--label", `soar.private-job-id=${input.jobId}`, "--label", `soar.private-context-id=${input.contextId}`,
        // Docker otherwise injects proxy URLs (possibly authenticated) from the
        // host CLI configuration. Never copy those values into container state.
        ...["HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "ftp_proxy", "no_proxy", "all_proxy"]
          .flatMap(key => ["--env", `${key}=`]),
        "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--user", "65534:65534", "--read-only", "--pids-limit", "256", "--memory", "4g", "--memory-swap", "4g", "--cpus", "2",
        "--ulimit", "nofile=256:256", "--ulimit", "fsize=67108864:67108864", "--ulimit", "core=0:0",
        "--tmpfs", "/workspace:rw,nosuid,nodev,size=536870912,uid=65534,gid=65534,mode=0700",
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=67108864,mode=1777", "--shm-size", "16m",
        "--workdir", "/workspace", "--entrypoint", "/usr/bin/env", input.imageId,
        "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "LANG=C.UTF-8", "PYTHONDONTWRITEBYTECODE=1",
        "/usr/local/bin/python3", "-I", "-c", `import time; time.sleep(${input.lifetimeSeconds})`], 20_000, 4096);
      await sandbox.checked(["start", sandbox.name], 20_000, 4096);
      async function* bytes() {
        yield Buffer.from(JSON.stringify(input.files.map(file => [file.path, file.bytes.length])) + "\n");
        for (const file of input.files) for (let offset = 0; offset < file.bytes.length; offset += 65536) yield file.bytes.subarray(offset, offset + 65536);
      }
      const imported = await sandbox.call(sandbox.python(IMPORT_FILES), { timeoutMs: 30_000, maxBytes: 4096, input: bytes() });
      if (imported.exitCode !== 0) throw new SandboxError("unsafe_file");
      sandbox.usable = true;
      return sandbox;
    } catch (error) {
      await sandbox.close();
      throw error instanceof SandboxError ? error : new SandboxError("unavailable");
    }
  }

  private call(args: string[], options: ProcessOptions): Promise<ProcessResult> { return docker(["--host", this.host, ...args], options); }
  private async checked(args: string[], timeoutMs: number, maxBytes: number, expected?: string): Promise<void> {
    const result = await this.call(args, { timeoutMs, maxBytes });
    if (result.exitCode !== 0 || (expected !== undefined && result.stdout.toString("utf8").trim() !== expected)) throw new SandboxError("unavailable");
  }
  private python(script: string, ...args: string[]): string[] {
    return ["exec", "-i", "--user", "65534:65534", "--workdir", "/workspace", this.name,
      "/usr/bin/env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "LANG=C.UTF-8", "PYTHONDONTWRITEBYTECODE=1",
      "/usr/local/bin/python3", "-I", "-c", script, ...args];
  }
  private async operation<T>(action: () => Promise<T>): Promise<T> {
    if (!this.usable || this.closing) throw new SandboxError("unusable");
    if (this.busy) throw new SandboxError("busy");
    this.busy = true;
    try { return await action(); }
    catch (error) {
      // Killing the Docker CLI alone does not kill exec descendants. Destroy the
      // whole restricted context before returning any abnormal transport outcome.
      await this.close();
      throw error instanceof SandboxError ? error : new SandboxError("unavailable");
    } finally { this.busy = false; }
  }

  async execute(command: string, options: { signal?: AbortSignal; timeoutMs: number }): Promise<SandboxExecution> {
    if (typeof command !== "string" || !command || command.includes("\0") || Buffer.from(command).toString("utf8") !== command
      || Buffer.byteLength(command) > PRIVATE_SANDBOX_LIMITS.commandBytes || !Number.isInteger(options.timeoutMs)
      || options.timeoutMs < 1 || options.timeoutMs > PRIVATE_SANDBOX_LIMITS.commandMs) throw new SandboxError("invalid_input");
    return this.operation(async () => {
      // coreutils timeout stops the command inside the container (exit 124) so a slow
      // command becomes an observation; the Docker-side deadline is only a backstop.
      const seconds = Math.max(1, Math.floor(options.timeoutMs / 1000));
      const startedAt = performance.now();
      // Backlog item 3 (finding A4): output beyond the cap is discarded, never a reason to fail the exec and destroy the container.
      const result = await this.call(["exec", "-i", "--user", "65534:65534", "--workdir", "/workspace", this.name,
        "/usr/bin/env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "LANG=C.UTF-8", "PYTHONDONTWRITEBYTECODE=1",
        "/usr/bin/timeout", "-k", "5", String(seconds), "/bin/sh", "-c", command],
      { timeoutMs: options.timeoutMs + 15_000, maxBytes: PRIVATE_SANDBOX_LIMITS.outputBytes, signal: options.signal, truncate: true });
      if (!this.usable) throw new SandboxError("unusable");
      // 137 after the deadline means the command ignored SIGTERM and took the SIGKILL.
      const killed = result.exitCode === 137 && performance.now() - startedAt >= seconds * 1000;
      const note = result.exitCode === SANDBOX_COMMAND_TIMEOUT_EXIT_CODE ? `\n[host] The command was stopped after ${seconds} s (exit ${SANDBOX_COMMAND_TIMEOUT_EXIT_CODE}); the workspace remains usable.`
        : killed ? `\n[host] The command ignored the stop signal and was killed after ${seconds} s (exit 137); the workspace remains usable.` : "";
      // A fixed note, like the timeout's, so the observation blob's strict schema and the progress hash are unchanged.
      const overflow = result.truncated ? `\n[host] The command's output exceeded ${PRIVATE_SANDBOX_LIMITS.outputBytes} bytes; only the first ${PRIVATE_SANDBOX_LIMITS.outputBytes} bytes of stdout and stderr together, in arrival order, were retained and the rest was discarded. The workspace remains usable: write large output to a file under /workspace and inspect it in parts.` : "";
      return { exitCode: result.exitCode, stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") + note + overflow };
    });
  }

  async readFile(relativePath: string, maxBytes: number): Promise<Buffer> {
    if (!validPath(relativePath) || !Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > PRIVATE_SANDBOX_LIMITS.fileBytes) throw new SandboxError("invalid_input");
    return this.operation(async () => {
      const result = await this.call(this.python(READ_FILE, JSON.stringify([relativePath, maxBytes])), { timeoutMs: 30_000, maxBytes: maxBytes + 4096 });
      if (result.exitCode !== 0 || result.stdout.length > maxBytes) throw new SandboxError("unsafe_file");
      if (!this.usable) throw new SandboxError("unusable");
      return result.stdout;
    });
  }

  /**
   * The regular files the next capture can read, with their sizes, and what the lister left out and why (BL-20261107-0924, B). `pinned` are
   * host-owned paths the lister keeps first (E1-L): only paths the host path rule admits, each once, at most 1,024; never model-supplied.
   */
  async listFiles(pinned: readonly string[] = []): Promise<WorkspaceListing> {
    const header = pinnedListingHeader(pinned);
    async function* input() { yield header; }
    return this.operation(async () => {
      const result = await this.call(this.python(LIST_FILES), { timeoutMs: 30_000, maxBytes: 512 * 1024, input: input() });
      if (result.exitCode !== 0) throw new SandboxError("unsafe_file");
      const listing = parseWorkspaceListing(result.stdout);
      if (!this.usable) throw new SandboxError("unusable");
      return listing;
    });
  }

  /**
   * Write, append or replace exactly one occurrence through the fixed host
   * protocol: no shell quoting, intermediate directories created, symlinks and
   * special files refused. Soft refusals return ok=false without closing the sandbox.
   */
  async editFile(mode: "write" | "append" | "replace", relativePath: string, payload: Buffer, replacement?: Buffer): Promise<SandboxEdit> {
    if (!["write", "append", "replace"].includes(mode) || !validPath(relativePath) || !Buffer.isBuffer(payload) || payload.length > PRIVATE_SANDBOX_LIMITS.fileBytes
      || (mode === "replace" ? (!Buffer.isBuffer(replacement) || payload.length < 1 || payload.length + replacement.length > 2 * 1024 * 1024) : replacement !== undefined)) {
      throw new SandboxError("invalid_input");
    }
    const spec = mode === "replace" ? [mode, relativePath, payload.length, replacement!.length] : [mode, relativePath, payload.length];
    const chunks = mode === "replace" ? [payload, replacement!] : [payload];
    async function* input() { for (const chunk of chunks) for (let offset = 0; offset < chunk.length; offset += 65536) yield chunk.subarray(offset, offset + 65536); }
    return this.operation(async () => {
      const result = await this.call(this.python(EDIT_FILE, JSON.stringify(spec)), { timeoutMs: 60_000, maxBytes: 4096, input: input() });
      if (!this.usable) throw new SandboxError("unusable");
      if (result.exitCode !== 0 && result.exitCode !== 54) throw new SandboxError("unsafe_file");
      let parsed: { ok?: unknown; reason?: unknown; bytes?: unknown; occurrences?: unknown };
      try { parsed = JSON.parse(result.stdout.toString("utf8")); } catch { throw new SandboxError("unsafe_file"); }
      if (typeof parsed.ok !== "boolean" || parsed.ok !== (result.exitCode === 0)) throw new SandboxError("unsafe_file");
      return { ok: parsed.ok, ...(typeof parsed.reason === "string" ? { reason: parsed.reason.slice(0, 64) } : {}),
        ...(Number.isSafeInteger(parsed.bytes) ? { bytes: parsed.bytes as number } : {}),
        ...(Number.isSafeInteger(parsed.occurrences) ? { occurrences: parsed.occurrences as number } : {}) };
    });
  }

  async close(): Promise<void> {
    this.usable = false;
    if (!this.closing) this.closing = (async () => {
      try {
        // The name was chosen before create, so even an uncertain create/start
        // response has an exact cleanup target. No caller-supplied container IDs.
        await this.call(["rm", "--force", this.name], { timeoutMs: 20_000, maxBytes: 4096 });
        const remaining = await this.call(["container", "ls", "--all", "--quiet", "--filter", `label=${this.label}`], { timeoutMs: 10_000, maxBytes: 4096 });
        if (remaining.exitCode !== 0 || remaining.stdout.toString("utf8").trim() !== "") throw new SandboxError("cleanup_failed");
      } catch { throw new SandboxError("cleanup_failed"); }
    })();
    return this.closing;
  }
}
