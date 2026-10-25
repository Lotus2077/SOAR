/**
 * H2a schema check: does the owned vLLM server's OpenAPI schema list `cache_salt` on the chat-completions request?
 *
 * Reads the endpoint from the same configuration the app uses (`.env.local`), fetches `/openapi.json` at the server's
 * origin, and prints one JSON line: the served version, whether `cache_salt` is a ChatCompletionRequest property and its
 * length constraints (the schema's bound; the server's request validator is stricter, 128 characters and no `@`, `/`,
 * `\` or NUL). It never prints the endpoint and sends no prompt. Exit 0 when the field is listed, 1 otherwise, 2 when the
 * schema could not be read. Host-side metadata only, but the Phase 4 track treats every request to the box as a box use and
 * runs it only in an owner-declared idle window or after Oct 27 (BL-20261025-0939).
 *
 *   pnpm check:vllm-schema
 */
import { loadConfig } from "../src/main/config";

async function main(): Promise<number> {
  const config = loadConfig();
  const base = new URL(config.vllm.baseUrl);
  const schemaUrl = new URL("/openapi.json", base.origin);
  const headers: Record<string, string> = config.vllm.apiKey ? { authorization: `Bearer ${config.vllm.apiKey}` } : {};
  let schema: unknown;
  try {
    const response = await fetch(schemaUrl, { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { process.stdout.write(`${JSON.stringify({ schemaRead: false, httpStatus: response.status })}\n`); return 2; }
    schema = await response.json();
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schemaRead: false, error: error instanceof Error ? error.name : "unknown" })}\n`); return 2;
  }
  const root = schema as { info?: { version?: unknown }; components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> } };
  const request = root.components?.schemas?.ChatCompletionRequest;
  const field = request?.properties?.cache_salt as { minLength?: unknown; maxLength?: unknown; anyOf?: { minLength?: unknown; maxLength?: unknown }[] } | undefined;
  const constraints = field ? (field.anyOf?.find(option => option.minLength !== undefined || option.maxLength !== undefined) ?? field) : undefined;
  const result = { schemaRead: true, servedVersion: typeof root.info?.version === "string" ? root.info.version : null,
    chatCompletionRequestInSchema: request !== undefined, cacheSaltInSchema: field !== undefined,
    cacheSaltConstraints: constraints ? { minLength: constraints.minLength ?? null, maxLength: constraints.maxLength ?? null } : null };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.cacheSaltInSchema ? 0 : 1;
}

main().then(code => { process.exitCode = code; }, error => { process.stdout.write(`${JSON.stringify({ schemaRead: false, error: error instanceof Error ? error.name : "unknown" })}\n`); process.exitCode = 2; });
