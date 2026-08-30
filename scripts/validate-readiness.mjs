import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { validateJsonSchema } from "./json-schema-contract.mjs";
import { secretPatterns } from "./secret-patterns.mjs";

const root = process.cwd();
const errors = [];
const execFileAsync = promisify(execFile);

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function readJsonLines(relativePath) {
  const text = await readFile(path.join(root, relativePath), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${relativePath}:${index + 1}: ${error.message}`);
      }
    });
}

function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

function validateWorkloads(records, expectedTrack, minimum) {
  requireValue(
    records.length >= minimum,
    `${expectedTrack}: expected at least ${minimum} workloads, found ${records.length}`,
  );

  for (const [index, record] of records.entries()) {
    const location = `${expectedTrack}:${index + 1}`;
    requireValue(typeof record.id === "string" && record.id.length > 0, `${location}: missing id`);
    requireValue(record.track === expectedTrack, `${location}: wrong track`);
    requireValue(typeof record.source?.dataset === "string", `${location}: missing source.dataset`);
    requireValue(typeof record.source?.recordId === "string", `${location}: missing source.recordId`);
    requireValue(/^https:\/\//.test(record.source?.url ?? ""), `${location}: source URL must use HTTPS`);
    requireValue(/^[0-9a-f]{40}$/.test(record.source?.revision ?? ""), `${location}: source revision is not a 40-character commit`);
    requireValue(typeof record.task?.delivery === "string", `${location}: missing task.delivery`);
    requireValue(typeof record.task?.fixture === "string", `${location}: missing task.fixture`);
    requireValue(typeof record.evaluator?.kind === "string", `${location}: missing evaluator.kind`);
    requireValue(
      typeof record.evaluator?.commandOrProtocol === "string",
      `${location}: missing evaluator.commandOrProtocol`,
    );
    requireValue(Array.isArray(record.tags) && record.tags.length > 0, `${location}: missing tags`);
  }
}

async function listRepositoryFiles() {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout
    .split("\0")
    .filter(Boolean)
    .map((relative) => path.join(root, relative));
}

const [research, coding, providers, providerSchema, workloadSchema, sources] =
  await Promise.all([
    readJsonLines("benchmarks/research.jsonl"),
    readJsonLines("benchmarks/coding.jsonl"),
    readJson("config/providers.readiness.example.json"),
    readJson("config/providers.readiness.schema.json"),
    readJson("benchmarks/workload.schema.json"),
    readJson("benchmarks/sources.json"),
  ]);

const draft202012 = "https://json-schema.org/draft/2020-12/schema";
requireValue(
  providerSchema.$schema === draft202012,
  "provider readiness snapshot schema must declare JSON Schema Draft 2020-12",
);
requireValue(
  workloadSchema.$schema === draft202012,
  "workload schema must declare JSON Schema Draft 2020-12",
);

for (const error of validateJsonSchema(providers, providerSchema, {
  label: "config/providers.readiness.example.json",
})) {
  errors.push(error);
}
for (const [index, record] of research.entries()) {
  for (const error of validateJsonSchema(record, workloadSchema, {
    label: `benchmarks/research.jsonl:${index + 1}`,
  })) {
    errors.push(error);
  }
}
for (const [index, record] of coding.entries()) {
  for (const error of validateJsonSchema(record, workloadSchema, {
    label: `benchmarks/coding.jsonl:${index + 1}`,
  })) {
    errors.push(error);
  }
}

validateWorkloads(research, "research", 20);
validateWorkloads(coding, "coding", 20);

const ids = [...research, ...coding].map((record) => record.id);
requireValue(new Set(ids).size === ids.length, "workload IDs must be globally unique");

const pinnedDatasets = new Map(
  sources.suites.map((suite) => [suite.dataset, suite.revision]),
);
for (const record of [...research, ...coding]) {
  requireValue(
    pinnedDatasets.get(record.source.dataset) === record.source.revision,
    `${record.id}: manifest revision does not match benchmarks/sources.json`,
  );
}

const expectedLocalCapabilities = [
  "chat_completions",
  "reasoning_effort",
  "streaming",
  "structured_json_schema",
  "tool_calling",
];
const runtimeProviders = Array.isArray(providers.runtimeProviders)
  ? providers.runtimeProviders
  : [];
const localProviders = runtimeProviders.filter(
  (provider) => provider.id === "local-vllm",
);
const local = localProviders[0];
requireValue(
  localProviders.length === 1,
  "provider metadata must contain exactly one local-vllm runtime input map",
);
requireValue(
  local?.status === "implemented_runtime_input_map",
  "local provider metadata must identify itself as an implemented runtime input map",
);
requireValue(
  local?.costPolicyEnv === "SOAR_VLLM_COST_POLICY",
  "local provider must resolve its explicit cost policy from the environment",
);
requireValue(
  providers.status === "non_runtime_snapshot" &&
    providers.purpose === "non_runtime_provider_and_campaign_planning_snapshot" &&
    providers.proposedCloudCampaign?.status ===
      "proposed_unapproved_non_runtime",
  "provider readiness data must identify itself as a proposed, unapproved non-runtime snapshot",
);
requireValue(
  JSON.stringify(local?.capabilities) ===
    JSON.stringify(expectedLocalCapabilities),
  `local provider capabilities must exactly match the runtime vocabulary: ${expectedLocalCapabilities.join(", ")}`,
);

function collectActiveEnvironmentMappings(value, location, findings) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectActiveEnvironmentMappings(entry, `${location}[${index}]`, findings),
    );
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (
      /env$/iu.test(key) ||
      (typeof entry === "string" && /^SOAR_[A-Z0-9_]+$/u.test(entry))
    ) {
      findings.push(childLocation);
    }
    collectActiveEnvironmentMappings(entry, childLocation, findings);
  }
}

const proposedCloudEnvironmentMappings = [];
collectActiveEnvironmentMappings(
  providers.proposedCloudCampaign,
  "proposedCloudCampaign",
  proposedCloudEnvironmentMappings,
);
requireValue(
  proposedCloudEnvironmentMappings.length === 0,
  `proposed cloud metadata must not expose active environment mappings: ${proposedCloudEnvironmentMappings.join(", ")}`,
);

const exampleEnv = await readFile(path.join(root, ".env.example"), "utf8");
const env = Object.fromEntries(
  exampleEnv
    .split("\n")
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

requireValue(
  /^https?:\/\/.+\/v1$/.test(env.SOAR_VLLM_BASE_URL),
  "vLLM base URL must use HTTP(S) and end in /v1",
);
requireValue(
  local?.costPolicyEnv !== undefined &&
    env[local.costPolicyEnv] === "local_zero_cost",
  "vLLM zero-cost accounting must be an explicit local_zero_cost declaration",
);
for (const inactiveName of [
  "SOAR_OPENROUTER_BASE_URL",
  "SOAR_OPENROUTER_API_KEY",
  "SOAR_OPENROUTER_MODEL",
  "SOAR_OPENROUTER_ENABLED",
  "SOAR_OPENROUTER_KEYCHAIN_SERVICE",
  "SOAR_OPENROUTER_KEYCHAIN_ACCOUNT",
  "SOAR_CAMPAIGN_BUDGET_USD",
  "SOAR_AUTOMATIC_STOP_USD",
  "SOAR_MAX_PAID_EPISODE_USD",
]) {
  requireValue(
    !(inactiveName in env),
    `.env.example must not advertise inactive runtime input ${inactiveName}`,
  );
}

const files = await listRepositoryFiles();

for (const file of files) {
  const content = await readFile(file, "utf8").catch(() => "");
  const relative = path.relative(root, file);
  for (const secret of secretPatterns) {
    requireValue(!secret.pattern.test(content), `${relative}: contains a possible ${secret.name}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `SOAR readiness metadata valid: ${research.length} research workloads, ${coding.length} coding workloads, no high-confidence tracked-file secret-pattern match.\n`,
  );
}
