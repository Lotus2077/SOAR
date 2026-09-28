import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

export const CONSULTANT_MODEL = "synthetic-text-consultant";
export const CONSULTANT_ADVICE = "Synthetic advisory response: preserve the original input and verify the saved result. This advice is not independent acceptance.";
export const CONSULTANT_FIXTURE_KEY = "synthetic-consultation-http-fixture-only";

/** One local text response; never contacts an inference provider or records headers. */
export async function generalTaskConsultantFixture(malformed = false) {
  const requests: { method: string; path: string; body: string }[] = [];
  const errors: string[] = [], responses: string[] = [];
  const server = createServer(async (request, response) => {
    const fail = (reason: string) => { errors.push(reason); response.writeHead(400).end("synthetic_fixture_error"); };
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") return fail("unexpected_route");
    try {
      let bytes = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 192 * 1024) { fail("request_too_large"); request.destroy(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: request.method, path: request.url, body });
      if (requests.length !== 1) return fail("unplanned_consultant_request");
      const decoded = JSON.parse(body);
      if (request.headers.authorization !== `Bearer ${CONSULTANT_FIXTURE_KEY}` || decoded.model !== CONSULTANT_MODEL || decoded.stream !== false ||
          decoded.max_tokens !== 4096 || decoded.service_tier !== "default" || Object.keys(decoded).sort().join(",") !== "max_tokens,messages,model,service_tier,stream" ||
          !Array.isArray(decoded.messages) || decoded.messages.length !== 2 || decoded.messages[1]?.role !== "user") return fail("request_contract_mismatch");
      const responseText = JSON.stringify({
        model: CONSULTANT_MODEL, service_tier: "default",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: CONSULTANT_ADVICE,
          ...(malformed ? { tool_calls: [{ id: "forbidden-consultant-tool", type: "function", function: { name: "execute", arguments: "{}" } }] } : {}) } }],
        usage: { prompt_tokens: 32, completion_tokens: 16, total_tokens: 48 },
      });
      responses.push(responseText); response.writeHead(200, { "content-type": "application/json" }).end(responseText);
    } catch { fail("invalid_request"); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, responses, errors,
    async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}

/** Normal local execution, with only an explicit synthetic consultant profile. */
export function consultationDesktopEnvironment(root: string, localOrigin: string, consultantOrigin: string, imageId: string): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER", "DISPLAY", "XAUTHORITY", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) {
    if (process.env[name] !== undefined) inherited[name] = process.env[name]!;
  }
  return { ...inherited, NODE_ENV: "test", SOAR_PROVIDER_MODE: "local", SOAR_ENABLE_HYBRID_SIMULATION: "false",
    SOAR_DB_PATH: path.join(root, "desktop.sqlite"), SOAR_VLLM_BASE_URL: `${localOrigin}/v1`,
    SOAR_VLLM_MODEL: "synthetic-general-tools", SOAR_VLLM_API_KEY: "", SOAR_VLLM_COST_POLICY: "local_zero_cost",
    SOAR_ALLOW_INSECURE_VLLM_HTTP: "true", SOAR_MAX_OUTPUT_TOKENS: "4096", SOAR_REQUEST_TIMEOUT_MS: "30000",
    SOAR_GENERAL_TASK_IMAGE_ID: imageId, SOAR_PATCH_MODE: "scripted", SOAR_PATCH_API_KEY: "", SOAR_PATCH_LOCAL_API_KEY: "", SOAR_TEST_WORKSPACE: "",
    SOAR_GENERAL_CONSULTANT_LOOPBACK_FIXTURE: "true", SOAR_GENERAL_CONSULTANT_ENDPOINT: `${consultantOrigin}/v1/chat/completions`,
    SOAR_GENERAL_CONSULTANT_MODEL: CONSULTANT_MODEL, SOAR_GENERAL_CONSULTANT_ACCOUNT_ID: "synthetic-desktop-fixture", SOAR_GENERAL_CONSULTANT_CREDENTIAL_VERSION: "1",
    SOAR_GENERAL_CONSULTANT_API_KEY: CONSULTANT_FIXTURE_KEY, SOAR_GENERAL_CONSULTANT_MAX_OUTPUT_TOKENS: "4096",
    SOAR_GENERAL_CONSULTANT_SERVICE_TIER: "default",
    SOAR_GENERAL_CONSULTANT_INPUT_MICROUSD_PER_MILLION: "1000000", SOAR_GENERAL_CONSULTANT_OUTPUT_MICROUSD_PER_MILLION: "2000000",
    SOAR_GENERAL_CONSULTANT_TIMEOUT_MS: "30000", SOAR_GENERAL_CONSULTANT_MAX_FEE_MICROUSD: "100000",
  };
}
