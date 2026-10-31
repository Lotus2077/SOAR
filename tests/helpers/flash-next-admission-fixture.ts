import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../../src/main/private-agent/contracts";
import { loadFlashNextTokenAdmission } from "../../src/main/private-agent/flash-next-admission";

/** Synthetic executable counter only. No tokenizer/model/network/credential access; never live parity evidence. */
export function flashNextAdmissionFixture(options: {
  endpoint?: string; model?: string; contextTokens?: number; promptTokens?: number; safetyMarginTokens?: number;
  timeoutMs?: number; mode?: "valid" | "hang" | "bad-body" | "bad-fit" | "invalid-json"; delayMs?: number;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "soar-token-proof-")), helper = join(root, "counter.mjs"), config = join(root, "config.json"),
    manifest = join(root, "serving.json"), policyPath = join(root, "policy.json");
  const endpoint = options.endpoint ?? "http://127.0.0.1:9999/v1/chat/completions", model = options.model ?? "qualified-flash",
    contextTokens = options.contextTokens ?? 1024;
  writeFileSync(manifest, JSON.stringify({ synthetic: true }));
  const configValue = { promptTokens: options.promptTokens ?? 1, maxModelLen: contextTokens,
    tokenizerSha256: digest("synthetic tokenizer"), templateSha256: digest("synthetic template"),
    endpointSha256: digest(endpoint), servingManifestSha256: digest(readFileSync(manifest)),
    mode: options.mode ?? "valid", delayMs: options.delayMs ?? 0 };
  writeFileSync(config, JSON.stringify(configValue));
  writeFileSync(helper, `#!${process.execPath}
import { readFileSync } from 'node:fs';
const config=JSON.parse(readFileSync(${JSON.stringify(config)},'utf8'));
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const input=JSON.parse(raw),body=JSON.parse(input.body);
if(config.mode==='hang'){setInterval(()=>{},1000);}else{
const proof={bodySha256:config.mode==='bad-body'?'0'.repeat(64):input.bodySha256,
tokenizerSha256:config.tokenizerSha256,templateSha256:config.templateSha256,
endpointSha256:config.endpointSha256,servingManifestSha256:config.servingManifestSha256,
promptTokens:config.promptTokens,maxModelLen:config.maxModelLen,
fits:config.mode==='bad-fit'?false:config.promptTokens+body.max_tokens<=config.maxModelLen,generationDispatched:false};
setTimeout(()=>console.log(config.mode==='invalid-json'?'INVALID':JSON.stringify(proof)),config.delayMs);}
`);
  chmodSync(helper, 0o700);
  const policy = { version: 1 as const, contract: "flash_next_v1" as const, model, endpointSha256: digest(endpoint), maxModelLen: contextTokens,
    safetyMarginTokens: options.safetyMarginTokens ?? 0, tokenizerSha256: configValue.tokenizerSha256, templateSha256: configValue.templateSha256,
    servingManifest: { path: manifest, sha256: digest(readFileSync(manifest)) },
    helper: { path: helper, sha256: digest(readFileSync(helper)), configPath: config, configSha256: digest(readFileSync(config)) },
    timeoutMs: options.timeoutMs ?? 30000 };
  writeFileSync(policyPath, JSON.stringify(policy));
  const descriptor = { path: policyPath, sha256: digest(readFileSync(policyPath)) };
  return { root, descriptor, policy, admission: loadFlashNextTokenAdmission(descriptor), endpoint, model, contextTokens,
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
