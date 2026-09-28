import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export const PRIVATE_SANDBOX_LIMITS = Object.freeze({
  files: 1024, fileBytes: 64 * 1024 * 1024, importBytes: 128 * 1024 * 1024,
  outputBytes: 256 * 1024, commandBytes: 64 * 1024, commandMs: 600_000,
});

export type SandboxErrorCode = "invalid_input" | "unavailable" | "command_timeout" | "cancelled"
  | "output_limit" | "unsafe_file" | "unusable" | "busy" | "cleanup_failed";

/** Errors deliberately contain no daemon diagnostics, commands, file contents or host paths. */
export class SandboxError extends Error {
  constructor(readonly code: SandboxErrorCode) { super(`Private sandbox: ${code}`); this.name = "SandboxError"; }
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
    || (input.lifetimeSeconds !== undefined && (!Number.isInteger(input.lifetimeSeconds) || input.lifetimeSeconds < 1 || input.lifetimeSeconds > 1800))
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

interface ProcessResult { exitCode: number; stdout: Buffer; stderr: Buffer }
interface ProcessOptions { timeoutMs: number; maxBytes: number; signal?: AbortSignal; input?: AsyncIterable<Buffer> }

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
    let settled = false, size = 0;
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
      size += chunk.length;
      if (size > options.maxBytes) { fail("output_limit"); return; }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", () => fail("unavailable"));
    child.stdin.on("error", () => { /* Close/exit below owns the outcome; EPIPE must not leak an unhandled error. */ });
    child.once("close", code => {
      if (settled) return;
      settled = true; cleanup();
      if (code === null) reject(new SandboxError("unavailable"));
      else resolve({ exitCode: code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
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
    return isinstance(p, str) and 0 < len(p.encode('utf-8')) <= 240 and len(p.split('/')) <= 32 and all(x not in ('', '.', '..') for x in p.split('/')) and not any(ord(c) < 32 or ord(c) == 127 or c == '\\' for c in p)
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

const LIST_FILES = FILE_HELPERS + String.raw`
try:
    paths, seen = [], [0]
    def walk(fd, prefix=''):
        for entry in os.scandir(fd):
            seen[0] += 1
            p = prefix + entry.name
            if seen[0] > 4096 or not valid(p): die()
            s = entry.stat(follow_symlinks=False)
            if stat.S_ISDIR(s.st_mode):
                sub = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try: walk(sub, p + '/')
                finally: os.close(sub)
            elif regular(s) and s.st_size <= 67108864:
                paths.append(p)
                if len(paths) > 1024: die()
            else: die()
    fd = root()
    try: walk(fd)
    finally: os.close(fd)
    print(json.dumps(sorted(paths), ensure_ascii=True))
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
      const result = await this.call(["exec", "-i", "--user", "65534:65534", "--workdir", "/workspace", this.name,
        "/usr/bin/env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "LANG=C.UTF-8", "PYTHONDONTWRITEBYTECODE=1",
        "/bin/sh", "-c", command], { timeoutMs: options.timeoutMs, maxBytes: PRIVATE_SANDBOX_LIMITS.outputBytes, signal: options.signal });
      if (!this.usable) throw new SandboxError("unusable");
      return { exitCode: result.exitCode, stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") };
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

  async listFiles(): Promise<string[]> {
    return this.operation(async () => {
      const result = await this.call(this.python(LIST_FILES), { timeoutMs: 30_000, maxBytes: 512 * 1024 });
      if (result.exitCode !== 0) throw new SandboxError("unsafe_file");
      const paths: unknown = JSON.parse(result.stdout.toString("utf8"));
      if (!Array.isArray(paths) || paths.length > PRIVATE_SANDBOX_LIMITS.files
        || !paths.every(item => typeof item === "string" && validPath(item)) || new Set(paths).size !== paths.length) throw new SandboxError("unsafe_file");
      if (!this.usable) throw new SandboxError("unusable");
      return paths;
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
