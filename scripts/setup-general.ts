import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { QUALIFIED_IMAGE } from "../src/main/private-agent/capabilities";
import { DockerSandbox } from "../src/main/private-agent/sandbox";
import { loadEnvironmentFiles, vllmEndpointPolicyIssue } from "../src/main/config";
import { COORDINATOR_PROFILES, DEFAULT_COORDINATOR_PROFILE, isCoordinatorProfileName } from "../src/main/private-agent/profiles";
import { loadServingCard, looksLikePath, servingCardRefusal, type LoadedServingCard, type ServingCardExpectation } from "../src/main/private-agent/serving-card";

/**
 * `pnpm setup:general`: a read-only doctor for the general task runtime, plus `--write` to record the
 * qualified image id and the profile in the app's user-data `.env.local` without touching present keys.
 * The report never prints the endpoint or a key; the endpoint appears only as a digest. It reports the endpoint's
 * identity (served alias, model root basename, engine version, context window) as probe P1 derives it, checks the
 * window against the profile's assumption and, when the serving-card pair is set, compares the identity with the
 * adopted card through the pinned reader; never the card's path.
 */
export const GENERAL_SETUP_KEYS = ["SOAR_VLLM_BASE_URL", "SOAR_VLLM_MODEL", "SOAR_VLLM_API_KEY", "SOAR_VLLM_COST_POLICY", "SOAR_ALLOW_INSECURE_VLLM_HTTP", "SOAR_GENERAL_TASK_IMAGE_ID", "SOAR_GENERAL_TASK_PROFILE",
  "SOAR_VLLM_REPLY_CONTRACT", "SOAR_VLLM_CONTEXT_TOKENS", "SOAR_SERVING_CARD_FILE", "SOAR_SERVING_CARD_SHA256"] as const;
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
  model: { configured: boolean; endpointSha256?: string; modelsOk: boolean; modelListed: boolean; completionOk: boolean; completionMs?: number; reason?: string;
    /** Printable values only: an unsafe value (path, URL, address, host:port, the configured host) is withheld as null. */
    identity?: EndpointIdentity;
    /** The window against the profile's assumption; ok is null when the endpoint reports no max_model_len. */
    window?: { requiredTokens: number; ok: boolean | null; reason?: string } };
  card: { configured: boolean; sha256?: string; date?: string; entry?: string; status?: "matches" | "differs" | "refused" | "unchecked" | "incomplete";
    code?: string; fields?: IdentityComparison[]; reason?: string };
  ready: boolean;
}
export const IDENTITY_FIELDS = ["servedModel", "modelRootBasename", "engineVersion", "contextTokens"] as const;
export type IdentityField = typeof IDENTITY_FIELDS[number];
export interface EndpointIdentity { servedModel: string | null; modelRootBasename: string | null; engineVersion: string | null; contextTokens: number | null }
/** card_unknown: the card recorded null; endpoint_unknown: the card has a value the endpoint no longer reports (blocks). */
export interface IdentityComparison { field: IdentityField; state: "match" | "differs" | "card_unknown" | "endpoint_unknown"; card: string | number | null; endpoint: string | number | null }
type RawIdentity = { [K in IdentityField]?: K extends "contextTokens" ? number : string };

/** The profile's own context assumption (profiles.ts): its request body cap at 3 bytes per token, plus its output limit. */
export function profileContextTokens(profile: { maxRequestBytes: number; maxOutputTokens: number }): number {
  return Math.ceil(profile.maxRequestBytes / 3) + profile.maxOutputTokens;
}
const CONTROL = /[\x00-\x1f\x7f]/u, IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/u, IPV6 = /[0-9a-f]{0,4}:[0-9a-f]{0,4}:[0-9a-f]{0,4}/iu, HOST_PORT = /[A-Za-z0-9.-]+:\d{2,5}\b/u;
/**
 * An identity value safe to print, else null: plain text within `max`, with no URL, IPv4 or IPv6 literal, host:port, backslash
 * or the configured host; a basename has no slash, other text is not path-like (the serving-card writer's rule).
 */
export function printableIdentity(value: unknown, max: number, host: string, kind: "text" | "basename" = "text"): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL.test(value)) return null;
  if (value.includes("://") || IPV4.test(value) || IPV6.test(value) || HOST_PORT.test(value) || value.includes("\\")) return null;
  if (host && value.toLowerCase().includes(host.toLowerCase())) return null;
  return (kind === "basename" ? value.includes("/") : looksLikePath(value)) ? null : value;
}
/** Probe P1's basename: `root` without trailing slashes, after the last slash; empty means unknown. */
function rootBasename(root: unknown): string | undefined {
  if (typeof root !== "string") return undefined;
  return root.replace(/\/+$/u, "").split("/").pop() || undefined;
}
/** What the reader expects (servingCardExpectation): the configured alias and, under flash_next_v1, the configured context. */
function cardExpectation(settings: Partial<Record<GeneralSetupKey, string>>): ServingCardExpectation {
  const context = Number(settings.SOAR_VLLM_CONTEXT_TOKENS);
  return { model: settings.SOAR_VLLM_MODEL ?? "",
    ...(settings.SOAR_VLLM_REPLY_CONTRACT === "flash_next_v1" && Number.isSafeInteger(context) && context > 0 ? { contextTokens: context } : {}) };
}
/** Compares raw endpoint values with the adopted card's identity; prints only the card's values and the printable endpoint values. */
export function compareIdentity(card: LoadedServingCard["identity"], raw: RawIdentity, printable: EndpointIdentity): IdentityComparison[] {
  return IDENTITY_FIELDS.map(field => {
    const recorded = card[field], live = raw[field];
    const state = recorded === null ? "card_unknown" : live === undefined ? "endpoint_unknown" : live === recorded ? "match" : "differs";
    return { field, state, card: recorded, endpoint: printable[field] };
  });
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
/** Exactly the app's own loader and precedence (SOAR_ENV_FILE, user data, cwd, app path), so the doctor sees what the app sees. */
export function resolveSettings(env: NodeJS.ProcessEnv, userDataFile: string, cwdFile: string): Partial<Record<GeneralSetupKey, string>> {
  const merged = loadEnvironmentFiles({ cwd: dirname(cwdFile), appPath: dirname(cwdFile), userDataPath: dirname(userDataFile), environment: env });
  const resolved: Partial<Record<GeneralSetupKey, string>> = {};
  for (const key of GENERAL_SETUP_KEYS) if (merged[key] !== undefined) resolved[key] = merged[key];
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
  const profileName = isCoordinatorProfileName(settings.SOAR_GENERAL_TASK_PROFILE) ? settings.SOAR_GENERAL_TASK_PROFILE : DEFAULT_COORDINATOR_PROFILE;
  const coordinator = COORDINATOR_PROFILES[profileName];
  let raw: RawIdentity | undefined;
  // The app's endpoint acknowledgments apply before any request or key leaves this machine.
  const policyIssue = model.configured ? vllmEndpointPolicyIssue(settings) : undefined;
  if (policyIssue) model.reason = policyIssue;
  else if (model.configured) {
    const base = settings.SOAR_VLLM_BASE_URL!.replace(/\/+$/u, ""), headers: Record<string, string> = { accept: "application/json" };
    if (settings.SOAR_VLLM_API_KEY) headers.authorization = `Bearer ${settings.SOAR_VLLM_API_KEY}`;
    model.endpointSha256 = createHash("sha256").update(base).digest("hex");
    // The policy check above has parsed the URL; the host only screens printed values, the origin serves /version.
    const endpointUrl = new URL(base), host = endpointUrl.hostname.replace(/^\[|\]$/gu, "");
    try {
      const models = await input.probes.fetchJson(`${base}/models`, { method: "GET", headers });
      const data = (models.json as { data?: unknown })?.data;
      const rows = Array.isArray(data) ? data.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object") : [];
      model.modelsOk = models.status === 200; model.modelListed = rows.map(row => String(row.id ?? "")).includes(settings.SOAR_VLLM_MODEL!);
      if (model.modelsOk) {
        // Probe P1's derivation for the configured alias's row: the alias, the basename of `root`, and `max_model_len`.
        const row = rows.find(item => item.id === settings.SOAR_VLLM_MODEL), basename = rootBasename(row?.root), context = row?.max_model_len;
        raw = { ...(row ? { servedModel: settings.SOAR_VLLM_MODEL! } : {}), ...(basename !== undefined ? { modelRootBasename: basename } : {}),
          ...(typeof context === "number" && Number.isSafeInteger(context) && context > 0 ? { contextTokens: context } : {}) };
      }
    } catch { model.reason = "The model list could not be fetched."; }
    if (raw) {
      // GET /version at the origin, as probe P1 does; any failure leaves the engine version unknown.
      try {
        const version = await input.probes.fetchJson(`${endpointUrl.origin}/version`, { method: "GET", headers });
        const value = (version.json as { version?: unknown })?.version;
        if (version.status === 200 && typeof value === "string" && value) raw.engineVersion = value;
      } catch { /* the engine version stays unknown */ }
      model.identity = { servedModel: printableIdentity(raw.servedModel, 256, host), modelRootBasename: printableIdentity(raw.modelRootBasename, 256, host, "basename"),
        engineVersion: printableIdentity(raw.engineVersion, 128, host), contextTokens: raw.contextTokens ?? null };
      const requiredTokens = profileContextTokens(coordinator);
      model.window = raw.contextTokens === undefined
        ? { requiredTokens, ok: null, reason: "The endpoint reports no max_model_len, so the profile's context assumption is unchecked." }
        : raw.contextTokens >= requiredTokens ? { requiredTokens, ok: true }
        : { requiredTokens, ok: false, reason: `The endpoint's context window (${raw.contextTokens} tokens) is smaller than the ${profileName} profile assumes (${requiredTokens} tokens).` };
    }
    if (model.modelsOk) {
      const started = Date.now();
      try {
        // The exact shape the agent loop sends for the profile in effect: one tool definition and the profile's thinking settings.
        const completion = await input.probes.fetchJson(`${base}/chat/completions`, { method: "POST", headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ model: settings.SOAR_VLLM_MODEL, messages: [{ role: "user", content: "Reply with the word ok." }],
            tools: [{ type: "function", function: { name: "noop", description: "Does nothing.", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
            tool_choice: "auto", parallel_tool_calls: false, stream: false, max_tokens: 1,
            ...(coordinator.thinking === "disabled" ? { chat_template_kwargs: { enable_thinking: false } } : { reasoning_effort: "medium", ...(coordinator.sampling ?? {}) }) }) });
        const usage = (completion.json as { usage?: { completion_tokens?: unknown } })?.usage;
        model.completionOk = completion.status === 200 && typeof usage?.completion_tokens === "number" && usage.completion_tokens <= 1;
        model.completionMs = Date.now() - started;
      } catch { model.reason = "The one-token completion probe failed."; }
    }
  } else model.reason = "Set SOAR_VLLM_BASE_URL and SOAR_VLLM_MODEL in the user-data .env.local (never in the repository).";
  const card = checkServingCard(settings, model.configured, raw, model.identity);
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
  // A window below the profile's assumption, or a set card pair that is refused, unchecked or differs, is not ready; an unknown window is not.
  const ready = node.ok && docker.ok && installed && (image.configuredMatchesQualified || wrote.includes("SOAR_GENERAL_TASK_IMAGE_ID")) && model.modelsOk && model.modelListed && model.completionOk
    && model.window?.ok !== false && (!card.configured || card.status === "matches");
  return { node, settings: { file: input.userDataFile, present, wrote }, docker, image, model, card, ready };
}

/**
 * The pair as the app reads it, through the pinned reader the headless driver uses (loadServingCard), then a field-by-field
 * comparison with the endpoint. Reports the card's sha256, date and adopting entry, a fixed refusal code or field names; never
 * the path.
 */
function checkServingCard(settings: Partial<Record<GeneralSetupKey, string>>, configured: boolean, raw: RawIdentity | undefined, printable: EndpointIdentity | undefined): GeneralSetupReport["card"] {
  const file = settings.SOAR_SERVING_CARD_FILE, sha256 = settings.SOAR_SERVING_CARD_SHA256;
  if (file === undefined && sha256 === undefined) return { configured: false };
  if (!file || !sha256 || !/^[a-f0-9]{64}$/u.test(sha256)) {
    return { configured: true, status: "incomplete", reason: "Set SOAR_SERVING_CARD_FILE (an absolute path) and SOAR_SERVING_CARD_SHA256 together, or neither." };
  }
  if (!configured) return { configured: true, sha256, status: "unchecked", reason: "The model endpoint is not configured, so the card was not read." };
  let loaded: LoadedServingCard;
  try { loaded = loadServingCard({ path: file, sha256 }, cardExpectation(settings)); }
  catch (error) {
    const code = servingCardRefusal(error)?.code ?? "serving_card_unreadable";
    return { configured: true, sha256, status: "refused", code, reason: `The serving-card reader refuses the pinned card (${code}), as the headless driver would.` };
  }
  const head = { configured: true, sha256, date: loaded.date, entry: loaded.entry };
  if (!raw || !printable) return { ...head, status: "unchecked", reason: "The endpoint's identity is unknown, so the card was not compared." };
  const fields = compareIdentity(loaded.identity, raw, printable);
  const differing = fields.filter(item => item.state === "differs" || item.state === "endpoint_unknown").map(item => item.field);
  return differing.length ? { ...head, status: "differs", fields, reason: `The endpoint differs from the adopted serving card in: ${differing.join(", ")}.` }
    : { ...head, status: "matches", fields };
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
