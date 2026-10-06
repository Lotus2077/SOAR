import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { QUALIFIED_IMAGE } from "../src/main/private-agent/capabilities";
import { DockerSandbox } from "../src/main/private-agent/sandbox";

/**
 * `pnpm setup:general`: a read-only doctor for the general task runtime, plus `--write` to record the
 * qualified image id and the profile in the app's user-data `.env.local` without touching present keys.
 * The report never prints the endpoint or a key; the endpoint appears only as a digest.
 */
export const GENERAL_SETUP_KEYS = ["SOAR_VLLM_BASE_URL", "SOAR_VLLM_MODEL", "SOAR_VLLM_API_KEY", "SOAR_GENERAL_TASK_IMAGE_ID", "SOAR_GENERAL_TASK_PROFILE"] as const;
export type GeneralSetupKey = typeof GENERAL_SETUP_KEYS[number];
export const REQUIRED_NODE_MAJOR = 22;
export const SETUP_PROBE_TIMEOUT_MS = 30_000;

export interface GeneralSetupProbes {
  dockerEndpoint: () => Promise<string>;
  /** Returns the image id Docker reports for `imageId`, or undefined when it is not installed. */
  imageId: (endpoint: string, imageId: string) => Promise<string | undefined>;
  fetchJson: (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json: unknown }>;
}
export interface GeneralSetupReport {
  node: { version: string; ok: boolean };
  settings: { file: string; present: GeneralSetupKey[]; wrote: GeneralSetupKey[] };
  docker: { ok: boolean; reason?: string };
  image: { qualifiedId: string; installed: boolean; configuredMatchesQualified: boolean };
  model: { configured: boolean; endpointSha256?: string; modelsOk: boolean; modelListed: boolean; completionOk: boolean; completionMs?: number; reason?: string };
  ready: boolean;
}

/** `KEY=VALUE` lines; quotes are not interpreted, matching the app's own loader. */
export function parseEnvFile(text: string): Partial<Record<GeneralSetupKey, string>> {
  const values: Partial<Record<GeneralSetupKey, string>> = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim(); if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("="); if (index <= 0) continue;
    const key = line.slice(0, index).trim() as GeneralSetupKey;
    if ((GENERAL_SETUP_KEYS as readonly string[]).includes(key) && values[key] === undefined) values[key] = line.slice(index + 1).trim();
  }
  return values;
}
/** Precedence mirrors the app: process env, then the user-data file, then the working directory's `.env.local`. */
export function resolveSettings(env: NodeJS.ProcessEnv, userDataFile: string, cwdFile: string): Partial<Record<GeneralSetupKey, string>> {
  const files = [userDataFile, cwdFile].map(file => existsSync(file) ? parseEnvFile(readFileSync(file, "utf8")) : {});
  const resolved: Partial<Record<GeneralSetupKey, string>> = {};
  for (const key of GENERAL_SETUP_KEYS) resolved[key] = env[key] ?? files[0]![key] ?? files[1]![key];
  return resolved;
}
export function userDataEnvFile(home = homedir(), platform = process.platform): string {
  const base = platform === "darwin" ? join(home, "Library", "Application Support", "SOAR") : platform === "win32" ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "SOAR") : join(home, ".config", "SOAR");
  return join(base, ".env.local");
}

export async function runGeneralSetup(input: { env: NodeJS.ProcessEnv; cwd: string; userDataFile: string; write: boolean; nodeVersion: string; probes: GeneralSetupProbes }): Promise<GeneralSetupReport> {
  const settings = resolveSettings(input.env, input.userDataFile, join(input.cwd, ".env.local"));
  const present = GENERAL_SETUP_KEYS.filter(key => settings[key] !== undefined);
  const major = Number(input.nodeVersion.replace(/^v/u, "").split(".")[0]);
  const node = { version: input.nodeVersion, ok: major === REQUIRED_NODE_MAJOR };
  let docker: GeneralSetupReport["docker"] = { ok: false }, installed = false, endpoint: string | undefined;
  try { endpoint = await input.probes.dockerEndpoint(); docker = { ok: true }; }
  catch { docker = { ok: false, reason: "Docker is not reachable. Start Docker Desktop (or the configured context) and run this again." }; }
  if (endpoint) { try { installed = (await input.probes.imageId(endpoint, QUALIFIED_IMAGE)) === QUALIFIED_IMAGE; } catch { installed = false; } }
  const image = { qualifiedId: QUALIFIED_IMAGE, installed, configuredMatchesQualified: settings.SOAR_GENERAL_TASK_IMAGE_ID === QUALIFIED_IMAGE };
  const model: GeneralSetupReport["model"] = { configured: Boolean(settings.SOAR_VLLM_BASE_URL && settings.SOAR_VLLM_MODEL), modelsOk: false, modelListed: false, completionOk: false };
  if (model.configured) {
    const base = settings.SOAR_VLLM_BASE_URL!.replace(/\/+$/u, ""), headers: Record<string, string> = { accept: "application/json" };
    if (settings.SOAR_VLLM_API_KEY) headers.authorization = `Bearer ${settings.SOAR_VLLM_API_KEY}`;
    model.endpointSha256 = createHash("sha256").update(base).digest("hex");
    try {
      const models = await input.probes.fetchJson(`${base}/models`, { method: "GET", headers });
      const ids = ((models.json as { data?: { id?: unknown }[] })?.data ?? []).map(row => String(row.id ?? ""));
      model.modelsOk = models.status === 200; model.modelListed = ids.includes(settings.SOAR_VLLM_MODEL!);
    } catch { model.reason = "The model list could not be fetched."; }
    if (model.modelsOk) {
      const started = Date.now();
      try {
        const completion = await input.probes.fetchJson(`${base}/chat/completions`, { method: "POST", headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ model: settings.SOAR_VLLM_MODEL, messages: [{ role: "user", content: "Reply with the word ok." }], max_tokens: 1, stream: false, chat_template_kwargs: { enable_thinking: false } }) });
        const usage = (completion.json as { usage?: { completion_tokens?: unknown } })?.usage;
        model.completionOk = completion.status === 200 && typeof usage?.completion_tokens === "number" && usage.completion_tokens <= 1;
        model.completionMs = Date.now() - started;
      } catch { model.reason = "The one-token completion probe failed."; }
    }
  } else model.reason = "Set SOAR_VLLM_BASE_URL and SOAR_VLLM_MODEL in the user-data .env.local (never in the repository).";
  const wrote: GeneralSetupKey[] = [];
  if (input.write) {
    const additions: [GeneralSetupKey, string][] = [];
    if (installed && settings.SOAR_GENERAL_TASK_IMAGE_ID === undefined) additions.push(["SOAR_GENERAL_TASK_IMAGE_ID", QUALIFIED_IMAGE]);
    if (settings.SOAR_GENERAL_TASK_PROFILE === undefined) additions.push(["SOAR_GENERAL_TASK_PROFILE", "heavy"]);
    if (additions.length) {
      mkdirSync(join(input.userDataFile, ".."), { recursive: true });
      const existing = existsSync(input.userDataFile) ? readFileSync(input.userDataFile, "utf8") : "";
      appendFileSync(input.userDataFile, `${existing && !existing.endsWith("\n") ? "\n" : ""}${additions.map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
      wrote.push(...additions.map(([key]) => key));
    }
  }
  const ready = node.ok && docker.ok && installed && (image.configuredMatchesQualified || wrote.includes("SOAR_GENERAL_TASK_IMAGE_ID")) && model.modelsOk && model.modelListed && model.completionOk;
  return { node, settings: { file: input.userDataFile, present, wrote }, docker, image, model, ready };
}

const exec = promisify(execFile);
export const liveProbes: GeneralSetupProbes = {
  dockerEndpoint: () => DockerSandbox.currentEndpoint(),
  async imageId(endpoint, imageId) {
    const result = await exec("docker", ["--host", endpoint, "image", "inspect", "--format", "{{.Id}}", imageId], { timeout: SETUP_PROBE_TIMEOUT_MS });
    return result.stdout.trim() || undefined;
  },
  async fetchJson(url, init) {
    const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(SETUP_PROBE_TIMEOUT_MS) });
    const text = await response.text();
    let json: unknown = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: response.status, json };
  },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--write")) { process.stderr.write("Usage: pnpm setup:general [--write]\n"); process.exitCode = 2; }
  else {
    const report = await runGeneralSetup({ env: process.env, cwd: process.cwd(), userDataFile: userDataEnvFile(), write: args.includes("--write"), nodeVersion: process.version, probes: liveProbes });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ready ? 0 : 2;
  }
}
