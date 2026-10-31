import { execFile } from "node:child_process";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { digest, sha256Schema } from "./contracts";

export interface FlashNextAdmissionDescriptor { path: string; sha256: string }
export const LOCAL_TOKEN_ADMISSION_STOP = "local_token_admission_denied";
const positive = z.number().int().safe().positive(), count = z.number().int().safe().nonnegative();
const file = z.object({ path: z.string().refine(isAbsolute), sha256: sha256Schema }).strict();
const policySchema = z.object({
  version: z.literal(1), contract: z.literal("flash_next_v1"), model: z.string().min(1).max(256),
  endpointSha256: sha256Schema, maxModelLen: positive, safetyMarginTokens: count,
  tokenizerSha256: sha256Schema, templateSha256: sha256Schema, servingManifest: file,
  helper: file.extend({ configPath: z.string().refine(isAbsolute), configSha256: sha256Schema }).strict(),
  timeoutMs: z.number().int().min(1).max(30_000),
}).strict().refine(p => p.maxModelLen > p.safetyMarginTokens);

/** Persisted hash/count evidence only. Never includes a prompt, token IDs, executable path or helper output. */
export const LocalTokenAdmissionEvidenceSchema = z.object({
  version: z.literal(1), policySha256: sha256Schema, bodySha256: sha256Schema,
  servingManifestSha256: sha256Schema, endpointSha256: sha256Schema,
  tokenizerSha256: sha256Schema, templateSha256: sha256Schema,
  helperSha256: sha256Schema, helperConfigSha256: sha256Schema,
  promptTokens: positive, maxOutputTokens: positive, maxModelLen: positive, safetyMarginTokens: count,
}).strict().refine(e => e.promptTokens <= e.maxModelLen - e.maxOutputTokens - e.safetyMarginTokens);
export type LocalTokenAdmissionEvidence = z.infer<typeof LocalTokenAdmissionEvidenceSchema>;
export const LOCAL_TOKEN_ADMISSION_CODES = ["local_token_admission_missing", "local_token_admission_invalid",
  "local_token_admission_pin_drift", "local_token_admission_helper_failed", "local_token_admission_timeout",
  "local_token_admission_cancelled", "local_token_admission_proof_invalid", "local_token_context_exceeded"] as const;
export type LocalTokenAdmissionCode = typeof LOCAL_TOKEN_ADMISSION_CODES[number];
/** Created only before this request has a committed row; callers may record a provable non-dispatch. */
export class LocalTokenAdmissionError extends Error {
  constructor(readonly code: LocalTokenAdmissionCode, readonly bodySha256?: string, readonly policySha256?: string) {
    super(code); this.name = "LocalTokenAdmissionError";
  }
}
function invalid(code: LocalTokenAdmissionCode = "local_token_admission_pin_drift"): never { throw new LocalTokenAdmissionError(code); }

function pinned(path: string, expected: string, executable = false, maxBytes = 16 * 1024 * 1024): Buffer {
  try {
    if (!isAbsolute(path) || !sha256Schema.safeParse(expected).success) invalid();
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.size > maxBytes || executable && !(before.mode & 0o111)) invalid();
      const bytes = readFileSync(fd), after = lstatSync(path);
      if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || digest(bytes) !== expected) invalid();
      return bytes;
    } finally { closeSync(fd); }
  } catch { return invalid(); }
}

const helperProof = z.object({
  bodySha256: sha256Schema, tokenizerSha256: sha256Schema, templateSha256: sha256Schema,
  servingManifestSha256: sha256Schema, endpointSha256: sha256Schema,
  promptTokens: positive, maxModelLen: positive, fits: z.boolean(), generationDispatched: z.literal(false),
});

/** A host-owned, hash-pinned executable interface. No model/provider callback can supply a count. */
export class FlashNextTokenAdmission {
  private readonly policy!: z.infer<typeof policySchema>;
  readonly sha256: string;
  private readonly descriptor: Readonly<FlashNextAdmissionDescriptor>;
  constructor(descriptor: FlashNextAdmissionDescriptor) {
    this.descriptor = Object.freeze({ ...descriptor }); this.sha256 = descriptor.sha256;
    try { this.policy = policySchema.parse(JSON.parse(pinned(descriptor.path, descriptor.sha256, false, 65536).toString("utf8"))); }
    catch { return invalid("local_token_admission_invalid"); }
    this.verifyPins();
  }
  private verifyPins(): void {
    const p = this.policy;
    pinned(this.descriptor.path, this.sha256, false, 65536);
    pinned(p.servingManifest.path, p.servingManifest.sha256);
    pinned(p.helper.path, p.helper.sha256, true);
    pinned(p.helper.configPath, p.helper.configSha256, false, 65536);
  }
  private request(body: string, endpoint: string, model: string, contextTokens: number): { maxOutputTokens: number; bodySha256: string } {
    const p = this.policy;
    try {
      const parsed = JSON.parse(body) as { model?: unknown; max_tokens?: unknown };
      if (model !== p.model || parsed.model !== p.model || contextTokens !== p.maxModelLen || digest(endpoint) !== p.endpointSha256 ||
          !Number.isSafeInteger(parsed.max_tokens) || (parsed.max_tokens as number) <= 0) invalid("local_token_admission_invalid");
      return { maxOutputTokens: parsed.max_tokens as number, bodySha256: digest(body) };
    } catch (error) { if (error instanceof LocalTokenAdmissionError) throw error; return invalid("local_token_admission_invalid"); }
  }
  /** Rechecked synchronously inside the dispatch transaction after all asynchronous preparation. */
  validateAtCommit(evidence: LocalTokenAdmissionEvidence, body: string, endpoint: string, model: string, contextTokens: number): void {
    this.verifyPins();
    const request = this.request(body, endpoint, model, contextTokens), p = this.policy;
    if (!LocalTokenAdmissionEvidenceSchema.safeParse(evidence).success || evidence.policySha256 !== this.sha256 ||
        evidence.bodySha256 !== request.bodySha256 || evidence.maxOutputTokens !== request.maxOutputTokens ||
        evidence.maxModelLen !== p.maxModelLen || evidence.safetyMarginTokens !== p.safetyMarginTokens ||
        evidence.endpointSha256 !== p.endpointSha256 || evidence.servingManifestSha256 !== p.servingManifest.sha256 ||
        evidence.tokenizerSha256 !== p.tokenizerSha256 || evidence.templateSha256 !== p.templateSha256 ||
        evidence.helperSha256 !== p.helper.sha256 || evidence.helperConfigSha256 !== p.helper.configSha256) invalid();
  }
  async admit(body: string, endpoint: string, model: string, contextTokens: number, signal?: AbortSignal, timeoutMs = 30_000): Promise<LocalTokenAdmissionEvidence> {
    const bodySha256 = digest(body);
    try {
      if (signal?.aborted) invalid("local_token_admission_cancelled");
      this.verifyPins();
      const request = this.request(body, endpoint, model, contextTokens), p = this.policy;
      const input = JSON.stringify({ operation: "tokenize", body, bodySha256,
        servingManifestSha256: p.servingManifest.sha256, endpointSha256: p.endpointSha256, helperConfigSha256: p.helper.configSha256 });
      const raw = await new Promise<string>((resolve, reject) => {
        let finished = false, force: ReturnType<typeof setTimeout> | undefined;
        const finish = (code?: LocalTokenAdmissionCode, stdout?: string) => {
          if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener("abort", cancel);
          if (code) {
            child.kill("SIGTERM"); force = setTimeout(() => child.kill("SIGKILL"), 1000); force.unref();
            reject(new LocalTokenAdmissionError(code));
          } else resolve(stdout!);
        };
        const cancel = () => finish("local_token_admission_cancelled");
        const child = execFile(p.helper.path, [], { maxBuffer: 65536, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" } },
          (error, stdout) => { clearTimeout(force); finish(error ? "local_token_admission_helper_failed" : undefined, stdout); });
        child.once("close", () => clearTimeout(force));
        const timer = setTimeout(() => finish("local_token_admission_timeout"), Math.min(p.timeoutMs, timeoutMs));
        signal?.addEventListener("abort", cancel, { once: true });
        child.stdin?.on("error", () => finish("local_token_admission_helper_failed"));
        child.stdin?.end(`${input}\n`);
        if (signal?.aborted) cancel();
      });
      if (signal?.aborted) invalid("local_token_admission_cancelled");
      let proof: z.infer<typeof helperProof>;
      try { proof = helperProof.parse(JSON.parse(raw)); } catch { return invalid("local_token_admission_proof_invalid"); }
      if (proof.bodySha256 !== bodySha256 || proof.tokenizerSha256 !== p.tokenizerSha256 || proof.templateSha256 !== p.templateSha256 ||
          proof.servingManifestSha256 !== p.servingManifest.sha256 || proof.endpointSha256 !== p.endpointSha256 || proof.maxModelLen !== p.maxModelLen ||
          proof.fits !== (proof.promptTokens <= p.maxModelLen - request.maxOutputTokens)) invalid("local_token_admission_proof_invalid");
      if (proof.promptTokens > p.maxModelLen - request.maxOutputTokens - p.safetyMarginTokens) invalid("local_token_context_exceeded");
      const evidence = Object.freeze({ version: 1 as const, policySha256: this.sha256, bodySha256,
        servingManifestSha256: p.servingManifest.sha256, endpointSha256: p.endpointSha256,
        tokenizerSha256: p.tokenizerSha256, templateSha256: p.templateSha256,
        helperSha256: p.helper.sha256, helperConfigSha256: p.helper.configSha256,
        promptTokens: proof.promptTokens, maxOutputTokens: request.maxOutputTokens, maxModelLen: p.maxModelLen, safetyMarginTokens: p.safetyMarginTokens });
      this.validateAtCommit(evidence, body, endpoint, model, contextTokens);
      return evidence;
    } catch (error) {
      const code = error instanceof LocalTokenAdmissionError ? error.code : "local_token_admission_helper_failed";
      throw new LocalTokenAdmissionError(code, bodySha256, this.sha256);
    }
  }
}
export function loadFlashNextTokenAdmission(descriptor: FlashNextAdmissionDescriptor): FlashNextTokenAdmission {
  return new FlashNextTokenAdmission(descriptor);
}
