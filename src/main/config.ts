import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const vllmBaseUrlSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      message: "SOAR_VLLM_BASE_URL must use HTTP or HTTPS",
    });
  }
  if (url.pathname !== "/v1" || url.search !== "" || url.hash !== "") {
    context.addIssue({
      code: "custom",
      message:
        "SOAR_VLLM_BASE_URL must be the exact /v1 API base without a resource path, query, or fragment",
    });
  }
});

const environmentSchema = z.object({
  SOAR_VLLM_BASE_URL: vllmBaseUrlSchema.default(
    "http://localhost:8000/v1",
  ),
  SOAR_VLLM_API_KEY: z.string().optional(),
  SOAR_VLLM_MODEL: z.string().trim().min(1).max(256).default("RM-01 VLM"),
  SOAR_VLLM_COST_POLICY: z
    .enum(["local_zero_cost"])
    .default("local_zero_cost"),
  SOAR_ALLOW_INSECURE_VLLM_HTTP: booleanString,
  SOAR_PROVIDER_MODE: z.enum(["local", "fake"]).default("local"),
  SOAR_FAKE_DELAY_MS: z.coerce.number().int().min(0).max(5_000).default(12),
  SOAR_DB_PATH: z.string().optional(),
  SOAR_TEST_WORKSPACE: z.string().optional(),
  SOAR_MAX_INFERENCE_ROUNDS: z.coerce.number().int().min(1).max(32).default(24),
  SOAR_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(32).default(24),
  SOAR_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(65_536).default(8_192),
  SOAR_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(300_000),
  SOAR_CONTEXT_MAX_INPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(2_048)
    .max(1_048_576)
    .default(16_384),
  SOAR_CONTEXT_SAFETY_MARGIN: z.coerce.number().min(0.05).max(0.5).default(0.2),
});

export interface SoarConfig {
  providerMode: "local" | "fake";
  fakeDelayMs: number;
  vllm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    costPolicy: "local_zero_cost";
    maxOutputTokens: number;
    timeoutMs: number;
  };
  databasePath?: string;
  testWorkspace?: string;
  limits: {
    inferenceRounds: number;
    toolCalls: number;
  };
  context: {
    maxInputTokens: number;
    safetyMargin: number;
  };
}

export interface LoadConfigOptions {
  appPath?: string;
  userDataPath?: string;
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
}

function loadEnvironmentFiles(options: LoadConfigOptions): NodeJS.ProcessEnv {
  const environment = { ...(options.environment ?? process.env) };
  const cwd = options.cwd ?? process.cwd();
  const appPath = options.appPath ?? cwd;
  const candidates = [
    environment.SOAR_ENV_FILE,
    options.userDataPath ? path.join(options.userDataPath, ".env.local") : undefined,
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
    path.join(appPath, ".env.local"),
    path.join(appPath, ".env"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of new Set(candidates)) {
    if (!existsSync(candidate)) continue;
    const parsed = dotenv.parse(readFileSync(candidate));
    for (const [name, value] of Object.entries(parsed)) {
      if (environment[name] === undefined) environment[name] = value;
    }
  }

  return environment;
}

export function loadConfig(options: LoadConfigOptions = {}): SoarConfig {
  const env = environmentSchema.parse(loadEnvironmentFiles(options));
  const url = new URL(env.SOAR_VLLM_BASE_URL);
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

  if (url.protocol === "http:" && !isLoopback && !env.SOAR_ALLOW_INSECURE_VLLM_HTTP) {
    throw new Error(
      "Remote plaintext vLLM requires SOAR_ALLOW_INSECURE_VLLM_HTTP=true in the machine-local environment.",
    );
  }

  return {
    providerMode: env.SOAR_PROVIDER_MODE,
    fakeDelayMs: env.SOAR_FAKE_DELAY_MS,
    vllm: {
      baseUrl: env.SOAR_VLLM_BASE_URL,
      apiKey: env.SOAR_VLLM_API_KEY || "local-vllm",
      model: env.SOAR_VLLM_MODEL,
      costPolicy: env.SOAR_VLLM_COST_POLICY,
      maxOutputTokens: env.SOAR_MAX_OUTPUT_TOKENS,
      timeoutMs: env.SOAR_REQUEST_TIMEOUT_MS,
    },
    databasePath: env.SOAR_DB_PATH,
    testWorkspace: env.SOAR_TEST_WORKSPACE,
    limits: {
      inferenceRounds: env.SOAR_MAX_INFERENCE_ROUNDS,
      toolCalls: env.SOAR_MAX_TOOL_CALLS,
    },
    context: {
      maxInputTokens: env.SOAR_CONTEXT_MAX_INPUT_TOKENS,
      safetyMargin: env.SOAR_CONTEXT_SAFETY_MARGIN,
    },
  };
}
