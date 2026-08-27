import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const errors = [];

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

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if ([".git", "node_modules", "benchmarks/cache", "benchmarks/runs"].includes(entry.name)) {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (/^\.env\.(?!example$)/.test(relative)) continue;
    if (entry.isDirectory()) files.push(...(await listFiles(absolute)));
    if (entry.isFile()) files.push(absolute);
  }

  return files;
}

const [research, coding, providers, sources] = await Promise.all([
  readJsonLines("benchmarks/research.jsonl"),
  readJsonLines("benchmarks/coding.jsonl"),
  readJson("config/providers.example.json"),
  readJson("benchmarks/sources.json"),
]);

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

const cloud = providers.providers.find((provider) => provider.id === "openrouter-cloud-primary");
requireValue(cloud?.modelEnv === "SOAR_OPENROUTER_MODEL", "cloud provider must resolve its model from the environment");
requireValue(cloud?.enabledEnv === "SOAR_OPENROUTER_ENABLED", "cloud provider must have an explicit enable gate");
requireValue(cloud?.marginalPriceUsdPerMillionTokens?.input === 0.06, "cloud input price snapshot must be USD 0.06/M");
requireValue(cloud?.marginalPriceUsdPerMillionTokens?.output === 0.12, "cloud output price snapshot must be USD 0.12/M");
requireValue(cloud?.providerRouting?.sort === "price", "cloud provider routing must prefer price");
requireValue(cloud?.providerRouting?.maxPriceUsdPerMillionTokens?.input === 0.08, "unexpected cloud input price ceiling");
requireValue(cloud?.providerRouting?.maxPriceUsdPerMillionTokens?.output === 0.18, "unexpected cloud output price ceiling");

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

requireValue(env.SOAR_OPENROUTER_MODEL === "deepseek/deepseek-v4-flash-0731", "unexpected OpenRouter model slug");
requireValue(env.SOAR_OPENROUTER_ENABLED === "false", "example configuration must keep paid calls disabled");
requireValue(/^https?:\/\/.+\/v1$/.test(env.SOAR_VLLM_BASE_URL), "vLLM base URL must use HTTP(S) and end in /v1");
requireValue(Number(env.SOAR_CAMPAIGN_BUDGET_USD) === 100, "campaign ceiling must be USD 100");
requireValue(Number(env.SOAR_AUTOMATIC_STOP_USD) === 90, "automatic stop must be USD 90");
requireValue(Number(env.SOAR_MAX_PAID_EPISODE_USD) === 0.75, "paid episode cap must be USD 0.75");

const credentialPrefix = ["sk", "or", "v1"].join("-");
const credentialPattern = new RegExp(`${credentialPrefix}-[A-Za-z0-9_-]{20,}`);
const files = await listFiles(root);

for (const file of files) {
  if (file === new URL(import.meta.url).pathname) continue;
  const content = await readFile(file, "utf8").catch(() => "");
  const relative = path.relative(root, file);
  requireValue(!credentialPattern.test(content), `${relative}: contains an OpenRouter credential`);
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `SOAR readiness valid: ${research.length} research workloads, ${coding.length} coding workloads, no tracked live secret.\n`,
  );
}
