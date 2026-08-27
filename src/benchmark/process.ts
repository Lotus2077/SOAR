import { spawn } from "node:child_process";

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function runBoundedProcess(options: {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    const capture = (target: Buffer[], chunk: Buffer, current: number): number => {
      const remaining = Math.max(0, maxOutputBytes - current);
      if (remaining > 0) target.push(chunk.subarray(0, remaining));
      return current + chunk.length;
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes = capture(stdout, chunk, stdoutBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes = capture(stderr, chunk, stderrBytes);
    });
    child.once("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    timer.unref();
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
      });
    });
  });
}
