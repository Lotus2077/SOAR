import type { BrokerDestination } from "../private-agent/broker";
import { canonical, digest } from "../private-agent/contracts";
import { consultantPriceProfileSha256, type ConsultantTextConfig } from "../private-agent/consultant-model";

/** Host-only credentials. Never serialize this object into a task, IPC or log. */
export interface ConsultantProfile {
  destination: BrokerDestination;
  model: ConsultantTextConfig;
  identity: string;
  maxFeeMicrousd: number;
}
const prefix = "SOAR_GENERAL_CONSULTANT_";
const required = ["ENDPOINT", "MODEL", "ACCOUNT_ID", "CREDENTIAL_VERSION", "API_KEY", "MAX_OUTPUT_TOKENS",
  "INPUT_MICROUSD_PER_MILLION", "OUTPUT_MICROUSD_PER_MILLION", "TIMEOUT_MS", "MAX_FEE_MICROUSD"] as const;
type ProfileField = typeof required[number] | "CACHED_INPUT_MICROUSD_PER_MILLION" | "LOOPBACK_FIXTURE" | "SERVICE_TIER";
export interface ConsultantProfileInspection {
  status: "ready" | "missing" | "invalid";
  reason: string;
  missingFields: string[];
  invalidFields: string[];
}
class InvalidProfileField extends Error {
  constructor(readonly field: ProfileField) { super("invalid_consultant_profile_field"); }
}
function invalid(field: ProfileField): never { throw new InvalidProfileField(field); }

/** Session configuration only: no legacy credentials, dotenv, keychain or network. */
export function resolveConsultantProfile(env: NodeJS.ProcessEnv = process.env): ConsultantProfile | undefined {
  return parseProfile(env).profile;
}

/** Safe operator diagnostics: only fixed text and allowlisted field names. */
export function inspectConsultantProfile(env: NodeJS.ProcessEnv = process.env): ConsultantProfileInspection {
  return parseProfile(env).inspection;
}

function parseProfile(env: NodeJS.ProcessEnv): { profile?: ConsultantProfile; inspection: ConsultantProfileInspection } {
  const missingFields = required.filter(name => env[prefix + name] === undefined || env[prefix + name] === "").map(name => prefix + name);
  if (missingFields.length) return { inspection: { status: "missing", reason: "Set the required consultant fields in the same shell that launches SOAR. Values are never shown by this check.", missingFields, invalidFields: [] } };
  try {
    const text = (name: ProfileField, maximum = 256): string => {
      const value = env[prefix + name]!;
      if (!value || value.length > maximum || value !== value.trim() || /[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(value)) invalid(name);
      return value;
    };
    const integer = (name: ProfileField, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
      const raw = text(name, 16), value = Number(raw);
      if (!/^(0|[1-9][0-9]*)$/u.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(name);
      return value;
    };
    const rawEndpoint = text("ENDPOINT", 2048);
    let endpoint: URL;
    try { endpoint = new URL(rawEndpoint); } catch { invalid("ENDPOINT"); }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || /[\\\x00-\x20]/u.test(rawEndpoint)) invalid("ENDPOINT");
    const loopback = ["127.0.0.1", "[::1]"].includes(endpoint.hostname);
    const fixtureRequested = env[prefix + "LOOPBACK_FIXTURE"] === "true";
    const fixture = fixtureRequested && env.NODE_ENV === "test" && loopback;
    if (fixtureRequested && !fixture) invalid("LOOPBACK_FIXTURE");
    if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && fixture)) invalid("ENDPOINT");
    const apiKey = text("API_KEY", 8192);
    if (!/^[\x21-\x7e]+$/u.test(apiKey)) invalid("API_KEY");
    const serviceTier = env[prefix + "SERVICE_TIER"] === undefined ? undefined : text("SERVICE_TIER");
    if (serviceTier !== undefined && serviceTier !== "default") invalid("SERVICE_TIER");
    const model: ConsultantTextConfig = {
      destinationId: "desktop_consultant", model: text("MODEL"), maxOutputTokens: integer("MAX_OUTPUT_TOKENS", 128, 4096),
      ...(serviceTier === undefined ? {} : { serviceTier }),
      inputMicrousdPerMillion: integer("INPUT_MICROUSD_PER_MILLION"), outputMicrousdPerMillion: integer("OUTPUT_MICROUSD_PER_MILLION"),
      ...(env[prefix + "CACHED_INPUT_MICROUSD_PER_MILLION"] === undefined ? {} : {
        cachedInputMicrousdPerMillion: integer("CACHED_INPUT_MICROUSD_PER_MILLION"),
      }),
    };
    if (model.cachedInputMicrousdPerMillion !== undefined && model.cachedInputMicrousdPerMillion > model.inputMicrousdPerMillion) invalid("CACHED_INPUT_MICROUSD_PER_MILLION");
    const destination: BrokerDestination = {
      id: model.destinationId, kind: "cloud_model", endpoint: endpoint.href, accountId: text("ACCOUNT_ID"),
      credentialVersion: integer("CREDENTIAL_VERSION"), apiKey, syntheticOnly: true, privateDataAdmitted: false,
      requireExactGrant: true, approvalPriceProfileSha256: consultantPriceProfileSha256(model),
      maxResponseBytes: 256 * 1024, timeoutMs: integer("TIMEOUT_MS", 1, 300000),
      ...(fixture ? { loopbackFixture: true } : {}),
    };
    const maxFeeMicrousd = integer("MAX_FEE_MICROUSD");
    const { apiKey: secret, ...publicDestination } = destination;
    // Bind key rotation without exposing a standalone credential-derived digest.
    const identity = digest(canonical({ version: 1, destinationSha256: digest(canonical(publicDestination)),
      model, maxFeeMicrousd, credentialBinding: digest(secret!) }));
    return { profile: Object.freeze({ destination: Object.freeze(destination), model: Object.freeze(model), identity, maxFeeMicrousd }),
      inspection: { status: "ready", reason: "Local configuration syntax and limits pass. Credentials, provider compatibility, current prices and available funds have not been verified. This check sends no request and grants no permission.", missingFields: [], invalidFields: [] } };
  } catch (error) {
    return { inspection: { status: "invalid", reason: "Correct the indicated consultant field using the setup guide. No values or exception details are shown.", missingFields: [], invalidFields: error instanceof InvalidProfileField ? [prefix + error.field] : [] } };
  }
}
