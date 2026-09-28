import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DockerSandbox, PRIVATE_SANDBOX_LIMITS } from "../../src/main/private-agent/sandbox";

const enabled = process.env.SOAR_RUN_PRIVATE_AGENT_RUNTIME === "true";
// This test never pulls/builds an image or accepts a mutable environment override.
const imageId = "sha256:95be0fdf09ef20ff31c5f605108f068422a58edb93b35834c5cfaf45312d3071";
const exec = promisify(execFile);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function containers(jobId: string) {
  return (await exec("docker", ["ps", "--all", "--quiet", "--filter", `label=soar.private-job-id=${jobId}`], { timeout: 10_000 })).stdout.trim().split("\n").filter(Boolean);
}
async function make(jobId: string, files: { path: string; bytes: Buffer }[] = []) {
  return DockerSandbox.create({ imageId, jobId, contextId: randomUUID(), files });
}
function python(source: string) { return `python3 -I - <<'SOAR_SYNTHETIC_PY'\n${source}\nSOAR_SYNTHETIC_PY`; }
async function sawDescendant(jobId: string, contextId?: string): Promise<boolean> {
  const ids = contextId === undefined ? await containers(jobId) : (await exec("docker", ["ps", "--all", "--quiet",
    "--filter", `label=soar.private-job-id=${jobId}`, "--filter", `label=soar.private-context-id=${contextId}`], { timeout: 5000 })).stdout.trim().split("\n").filter(Boolean);
  if (ids.length !== 1) return false;
  for (let n = 0; n < 15; n++) {
    try {
      // Docker's top parser requires a PID column even when the test needs only comm.
      const result = await exec("docker", ["top", ids[0]!, "-eo", "pid,comm"], { timeout: 3000 });
      if (result.stdout.split("\n").some(line => /^\s*\d+\s+sleep\s*$/u.test(line))) return true;
    } catch { return false; }
    await sleep(50);
  }
  return false;
}

describe.skipIf(!enabled)("real credential-free isolated private-agent tools", () => {
  it("executes and exchanges bounded files while keeping separate context filesystems", async () => {
    const jobId = randomUUID();
    const bytes = Buffer.from("synthetic public bytes\n".repeat(20_000));
    const sandbox = await make(jobId, [{ path: "inputs/source.txt", bytes }, { path: "inputs/数据.txt", bytes: Buffer.from("测试") }]);
    let other: DockerSandbox | undefined;
    try {
      expect(await sandbox.readFile("inputs/source.txt", bytes.length)).toEqual(bytes);
      expect(await sandbox.readFile("inputs/数据.txt", 100)).toEqual(Buffer.from("测试"));
      expect(await sandbox.execute(python("from pathlib import Path\np=Path('out'); p.mkdir()\np.joinpath('report.txt').write_text(Path('inputs/数据.txt').read_text() + ':done')\nprint('completed')"), { timeoutMs: 10_000 })).toEqual({ exitCode: 0, stdout: "completed\n", stderr: "" });
      expect((await sandbox.readFile("out/report.txt", 100)).toString("utf8")).toBe("测试:done");
      expect(await sandbox.listFiles()).toEqual(["inputs/source.txt", "inputs/数据.txt", "out/report.txt"]);
      expect((await sandbox.execute("exit 7", { timeoutMs: 5000 })).exitCode).toBe(7);
      other = await make(jobId);
      expect(await other.listFiles()).toEqual([]);
      expect((await other.execute("test ! -e inputs/source.txt", { timeoutMs: 5000 })).exitCode).toBe(0);
      const ids = await containers(jobId);
      expect(ids).toHaveLength(2);
      for (const id of ids) {
        const info = JSON.parse((await exec("docker", ["inspect", id], { timeout: 10_000 })).stdout)[0];
        expect(info.Image).toBe(imageId);
        expect(info.Config.User).toBe("65534:65534");
        expect(info.HostConfig).toMatchObject({ NetworkMode: "none", ReadonlyRootfs: true, Privileged: false,
          CapDrop: ["ALL"], PidsLimit: 256, Memory: 4 * 1024 ** 3, MemorySwap: 4 * 1024 ** 3, NanoCpus: 2_000_000_000 });
        expect(info.HostConfig.SecurityOpt).toContain("no-new-privileges");
        expect(info.HostConfig.Binds ?? []).toEqual([]);
        expect(info.Mounts.every((mount: { Type: string }) => mount.Type === "tmpfs")).toBe(true);
      }
      const identity = await sandbox.execute(python("import os\nassert os.getuid() == 65534\ntry:\n open('/system-write-probe', 'w').write('x')\n raise AssertionError('root filesystem writable')\nexcept OSError:\n pass\nstatus=open('/proc/self/status').read()\nassert 'NoNewPrivs:\\t1' in status\nassert 'CapEff:\\t0000000000000000' in status\nprint('isolation-flags-ok')"), { timeoutMs: 5000 });
      expect(identity).toEqual({ exitCode: 0, stdout: "isolation-flags-ok\n", stderr: "" });
    } finally { await sandbox.close(); await other?.close(); expect(await containers(jobId)).toEqual([]); }
  }, 90_000);

  it("denies real descendant networking, ambient credentials, host paths and Docker socket", async () => {
    const jobId = randomUUID(), directory = await mkdtemp(path.join(tmpdir(), "soar-private-canary-"));
    const canary = path.join(directory, "host-only.txt"), secret = "synthetic-host-credential-" + randomUUID();
    await writeFile(canary, secret);
    const previous = process.env.SOAR_PRIVATE_TEST_SECRET;
    process.env.SOAR_PRIVATE_TEST_SECRET = secret;
    let requests = 0, sandbox: DockerSandbox | undefined;
    const server = createServer((_request, response) => { requests++; response.end("unauthorized"); });
    await new Promise<void>(resolve => server.listen(0, "0.0.0.0", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Synthetic receiver failed to start");
    try {
      sandbox = await make(jobId);
      const deepest = `import socket, os, pathlib, json\nassert 'SOAR_PRIVATE_TEST_SECRET' not in os.environ\nassert 'OPENAI_API_KEY' not in os.environ and 'SOAR_PATCH_API_KEY' not in os.environ\nassert b'SOAR_PRIVATE_TEST_SECRET=' not in pathlib.Path('/proc/1/environ').read_bytes()\nfor p in ${JSON.stringify([canary, "/var/run/docker.sock", "/run/docker.sock"])}:\n try:\n  open(p, 'rb').read(1)\n  raise AssertionError('host resource visible')\n except OSError:\n  pass\nblocked = []\nfor host in ['127.0.0.1', '::1', 'host.docker.internal', '192.168.65.254', '172.17.0.1']:\n try:\n  conn=socket.create_connection((host, ${address.port}), timeout=0.3)\n  conn.sendall(b'GET /synthetic-denial HTTP/1.0\\r\\n\\r\\n')\n  conn.close()\n  raise AssertionError('worker network escape')\n except OSError:\n  blocked.append(host)\nassert len(blocked) == 5\nassert not any(p.name != 'lo' for p in pathlib.Path('/sys/class/net').iterdir())\nprint('five-network-attempts-and-host-access-denied')`;
      const child = `import subprocess,sys\nsubprocess.run([sys.executable, '-I', '-c', ${JSON.stringify(deepest)}], check=True)`;
      const result = await sandbox.execute(python(`import subprocess,sys\nsubprocess.run([sys.executable, '-I', '-c', ${JSON.stringify(child)}], check=True)`), { timeoutMs: 15_000 });
      expect(result).toEqual({ exitCode: 0, stdout: "five-network-attempts-and-host-access-denied\n", stderr: "" });
      expect(requests).toBe(0);
      await expect(sandbox.readFile("../host-only.txt", 100)).rejects.toMatchObject({ code: "invalid_input" });
    } finally {
      if (previous === undefined) delete process.env.SOAR_PRIVATE_TEST_SECRET; else process.env.SOAR_PRIVATE_TEST_SECRET = previous;
      await sandbox?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true }); expect(await containers(jobId)).toEqual([]);
    }
  }, 90_000);

  it("clears proxy credentials from an isolated synthetic Docker config and PID1", async () => {
    const jobId = randomUUID(), directory = await mkdtemp(path.join(tmpdir(), "soar-synthetic-docker-config-"));
    // Resolve only the daemon socket through the normal client. Never inspect or
    // modify the contents of the user's Docker configuration or its proxy values.
    const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT ? process.env.DOCKER_HOST
      : (await exec("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { timeout: 10_000 })).stdout.trim();
    const keys = ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"] as const;
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const marker = "synthetic-proxy-credential-never-admitted";
    const proxy = `http://${marker}@proxy.invalid:3128`;
    await writeFile(path.join(directory, "config.json"), JSON.stringify({ proxies: { default: {
      httpProxy: proxy, httpsProxy: proxy, ftpProxy: proxy, allProxy: proxy, noProxy: marker,
    } } }));
    let sandbox: DockerSandbox | undefined;
    const controlName = `soar-proxy-injection-control-${randomUUID()}`;
    try {
      process.env.DOCKER_HOST = endpoint; process.env.DOCKER_CONFIG = directory; delete process.env.DOCKER_CONTEXT;
      // Positive control: the same synthetic config really is injected by the
      // ordinary CLI. This control is created/inspected only, never started.
      await exec("docker", ["create", "--pull", "never", "--network", "none", "--name", controlName, imageId, "true"], { timeout: 10_000 });
      const control = JSON.parse((await exec("docker", ["inspect", controlName], { timeout: 10_000 })).stdout)[0];
      expect(control.Config.Env.join("\n")).toContain(marker);
      await exec("docker", ["rm", controlName], { timeout: 10_000 });
      sandbox = await make(jobId);
      const ids = await containers(jobId); expect(ids).toHaveLength(1);
      const info = JSON.parse((await exec("docker", ["inspect", ids[0]!], { timeout: 10_000 })).stdout)[0];
      expect(info.Config.Env.join("\n")).not.toContain(marker);
      for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "ftp_proxy", "no_proxy", "all_proxy"]) {
        expect(info.Config.Env).toContain(`${key}=`);
      }
      const result = await sandbox.execute(python("import pathlib,os,subprocess,sys\nenv=pathlib.Path('/proc/1/environ').read_bytes().split(b'\\x00')\nassert not any(b'proxy' in value.lower() for value in env)\nassert not any('proxy' in key.lower() for key in os.environ)\nsubprocess.run([sys.executable,'-I','-c',\"import os; assert not any('proxy' in k.lower() for k in os.environ)\"],check=True)\nprint('proxy-credentials-absent')"), { timeoutMs: 5000 });
      expect(result).toEqual({ exitCode: 0, stdout: "proxy-credentials-absent\n", stderr: "" });
    } finally {
      try { await sandbox?.close(); expect(await containers(jobId)).toEqual([]); }
      finally {
        await exec("docker", ["rm", "--force", controlName], { timeout: 10_000 }).catch(() => undefined);
        for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
        await rm(directory, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it.each(["file-symlink", "directory-symlink", "fifo", "hardlink"])("rejects %s during artifact export and destroys the context", async kind => {
    const jobId = randomUUID(), sandbox = await make(jobId, [{ path: "source", bytes: Buffer.from("synthetic") }]);
    try {
      const command = kind === "file-symlink" ? "ln -s /etc/passwd output" : kind === "directory-symlink" ? "ln -s /etc output"
        : kind === "fifo" ? "mkfifo output" : "ln source output";
      expect((await sandbox.execute(command, { timeoutMs: 5000 })).exitCode).toBe(0);
      await expect(kind === "directory-symlink" ? sandbox.listFiles() : sandbox.readFile("output", 10000)).rejects.toMatchObject({ code: "unsafe_file" });
      await expect(sandbox.listFiles()).rejects.toMatchObject({ code: "unusable" });
      expect(await containers(jobId)).toEqual([]);
    } finally { await sandbox.close(); }
  }, 60_000);

  it.each(["timeout", "cancel"])("kills observed command descendants on %s and confirms cleanup", async reason => {
    const jobId = randomUUID(), sandbox = await make(jobId), controller = new AbortController();
    try {
      const completion = sandbox.execute("sleep 60 & wait", { timeoutMs: reason === "timeout" ? 4000 : 20_000, signal: controller.signal }).catch(error => error);
      expect(await sawDescendant(jobId)).toBe(true);
      await expect(sandbox.listFiles()).rejects.toMatchObject({ code: "busy" });
      if (reason === "cancel") controller.abort();
      expect(await completion).toMatchObject({ code: reason === "timeout" ? "command_timeout" : "cancelled" });
      expect(await containers(jobId)).toEqual([]);
      await expect(sandbox.execute("true", { timeoutMs: 1000 })).rejects.toMatchObject({ code: "unusable" });
    } finally { await sandbox.close(); }
  }, 60_000);

  it("bounds output and removes the emitting process before reporting overflow", async () => {
    const jobId = randomUUID(), sandbox = await make(jobId);
    try {
      await expect(sandbox.execute(`python3 -I -c 'print("x" * ${PRIVATE_SANDBOX_LIMITS.outputBytes + 1})'`, { timeoutMs: 5000 })).rejects.toMatchObject({ code: "output_limit" });
      expect(await containers(jobId)).toEqual([]);
    } finally { await sandbox.close(); }
  }, 60_000);

  it("recovers only the exact owned context on the pinned daemon", async () => {
    const endpoint = await DockerSandbox.currentEndpoint(), jobId = randomUUID(), contextId = randomUUID();
    const target = await DockerSandbox.create({ imageId, jobId, contextId, endpoint, files: [] });
    const otherContext = await make(jobId), otherJob = await DockerSandbox.create({ imageId, jobId: randomUUID(), contextId, endpoint, files: [] });
    try {
      expect(target.endpoint).toBe(endpoint);
      expect((await target.execute("sleep 60 >/dev/null 2>&1 < /dev/null &", { timeoutMs: 5000 })).exitCode).toBe(0);
      expect(await sawDescendant(jobId, contextId)).toBe(true);
      await DockerSandbox.cleanupOwnedContext({ endpoint, jobId, contextId });
      expect(await containers(jobId)).toHaveLength(1);
      expect((await otherContext.execute("printf still-running", { timeoutMs: 5000 })).stdout).toBe("still-running");
      expect((await otherJob.execute("printf other-job", { timeoutMs: 5000 })).stdout).toBe("other-job");
      await DockerSandbox.cleanupOwnedContext({ endpoint, jobId, contextId }); // Idempotent empty recovery.
    } finally { await target.close(); await otherContext.close(); await otherJob.close(); expect(await containers(jobId)).toEqual([]); }
  }, 90_000);

  it("fails cleanup closed before deleting anything when namespace identity is forged", async () => {
    const jobId = randomUUID(), contextId = randomUUID(), endpoint = await DockerSandbox.currentEndpoint();
    const sandbox = await DockerSandbox.create({ imageId, jobId, contextId, endpoint, files: [] });
    const controlName = `soar-forged-cleanup-control-${randomUUID()}`;
    try {
      await exec("docker", ["--host", endpoint, "create", "--pull", "never", "--network", "none", "--name", controlName,
        "--label", `soar.private-job-id=${jobId}`, "--label", `soar.private-context-id=${contextId}`,
        "--label", "soar.private-sandbox-id=forged", imageId, "true"], { timeout: 10_000 });
      await expect(DockerSandbox.cleanupOwnedContext({ endpoint, jobId, contextId })).rejects.toMatchObject({ code: "cleanup_failed" });
      expect(await containers(jobId)).toHaveLength(2);
      expect((await sandbox.execute("printf preserved", { timeoutMs: 5000 })).stdout).toBe("preserved");
    } finally {
      await sandbox.close(); await exec("docker", ["--host", endpoint, "rm", "--force", controlName], { timeout: 10_000 });
      expect(await containers(jobId)).toEqual([]);
    }
  }, 60_000);

  it("expires PID1 and a real descendant independently of the host command timer", async () => {
    const jobId = randomUUID(), sandbox = await DockerSandbox.create({ imageId, jobId, contextId: randomUUID(), files: [], lifetimeSeconds: 4 });
    try {
      const ids = await containers(jobId); expect(ids).toHaveLength(1);
      // Deliberately bypass the adapter's command timeout in this host-only fixture;
      // the daemon-side PID1 lifetime must terminate this otherwise 60-second exec.
      const began = Date.now();
      const command = exec("docker", ["exec", "--user", "65534:65534", ids[0]!, "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "/bin/sh", "-c", "sleep 60 & wait"], { timeout: 12_000 }).catch(error => error);
      expect(await sawDescendant(jobId)).toBe(true);
      const result = await command;
      expect(result.code).toBe(137);
      expect(Date.now() - began).toBeLessThan(10_000);
      const state = JSON.parse((await exec("docker", ["inspect", "--format", "{{json .State}}", ids[0]!], { timeout: 5000 })).stdout);
      expect(state.Running).toBe(false); expect(state.Pid).toBe(0);
      await DockerSandbox.cleanupOwnedContext({ endpoint: sandbox.endpoint, jobId, contextId: sandbox.contextId });
      expect(await containers(jobId)).toEqual([]);
    } finally { await sandbox.close(); }
  }, 60_000);
});
