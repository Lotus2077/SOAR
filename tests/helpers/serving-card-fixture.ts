/**
 * Machine-readable serving cards for the reader's tests (SC), written by the real writer (`scripts/serving-card.py
 * --policy-out` under python3 -I) from the synthetic probe, with its P10 evidence bound at test time to today's research
 * protocol and role schemas, so no test hard-codes the protocol hash. Invented values only; no address anywhere.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { digest } from "../../src/main/private-agent/contracts";
import { researchProtocolSha256 } from "../../src/main/private-agent/research-pipeline";
import { DEFAULT_RESEARCH_ROLE_POLICY } from "../../src/main/private-agent/research-roles";
import { currentRoleSchemaSha256, parseServingCard, type ServingCardV1 } from "../../src/main/private-agent/serving-card";
import { syntheticProbe } from "./serving-probe-fixture";

export const SERVING_CARD_WRITER = resolve(__dirname, "..", "..", "scripts", "serving-card.py");
/** A stalled child fails its test instead of hanging the suite. */
export const PYTHON_TIMEOUT_MS = 60_000;
/** A well-formed adopting entry ID; the reader checks the format, not the ledger. */
export const ADOPTING_ENTRY = "BL-20261109-1200-e0-serving-card-verified";

/** syntheticProbe() whose P10 export and assessor hashes are today's researchProtocolSha256() and whose schema digests are today's. */
export function currentSyntheticProbe(): Record<string, any> {
  const probe = syntheticProbe(), protocol = researchProtocolSha256();
  probe.P10.schema_sha256 = { ...currentRoleSchemaSha256() };
  probe.P10.schemas_protocol_sha256 = protocol; probe.P10.assessed.protocolSha256 = protocol; probe.roles.protocol_sha256 = protocol;
  return probe;
}

export interface CardWriterRun { status: number | null; stdout: string; stderr: string; probeSha256: string; policy: Buffer | undefined; directory: string }

/**
 * Runs the writer as the operator does, with --policy-out, an empty env file, no SOAR variable and never the repository's
 * .env.local. The temporary directory is removed before returning; its path is returned so a test can check that no
 * message names it.
 */
export function runCardWriter(probe: unknown, extra: string[] = []): CardWriterRun {
  const directory = mkdtempSync(join(tmpdir(), "soar-card-json-"));
  try {
    const input = join(directory, "probe.json"), envFile = join(directory, "empty.env"), out = join(directory, "serving-card.json");
    const raw = Buffer.from(JSON.stringify(probe)); writeFileSync(input, raw); writeFileSync(envFile, "");
    const result = spawnSync("python3", ["-I", SERVING_CARD_WRITER, "--input", input, "--env-file", envFile, "--policy-out", out, ...extra],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, timeout: PYTHON_TIMEOUT_MS });
    let policy: Buffer | undefined;
    try { policy = readFileSync(out); } catch { policy = undefined; }
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, probeSha256: digest(raw), policy, directory };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

/** The writer's proposed card for the current synthetic probe; `mutate` edits the probe first (the alias, for example). */
export function proposedServingCard(mutate?: (probe: Record<string, any>) => void): ServingCardV1 {
  const probe = currentSyntheticProbe(); mutate?.(probe);
  const run = runCardWriter(probe);
  if (run.status !== 0 || run.policy === undefined) throw new Error(`serving_card_writer_failed: ${run.stderr}`);
  return parseServingCard(run.policy);
}

/** The reviewed adoption: decision {adopted, entry}; with `defaults`, today's role policy, K 1 and admission none (no proposal kept). */
export function adopt(card: ServingCardV1, entry: string | null = ADOPTING_ENTRY, options: { defaults?: boolean } = {}): ServingCardV1 {
  const copy = structuredClone(card);
  copy.decision = { status: "adopted", entry };
  if (options.defaults) {
    copy.roles = structuredClone(DEFAULT_RESEARCH_ROLE_POLICY) as ServingCardV1["roles"];
    copy.concurrency = { localStreams: 1 }; copy.admission = { basis: "none" };
  }
  return copy;
}

/** Writes a card (or raw bytes) as the writer formats it; returns the absolute path and the sha256 the pair would pin. */
export function writeCard(directory: string, card: unknown, name = "serving-card.json"): { path: string; sha256: string } {
  const bytes = Buffer.isBuffer(card) ? card : Buffer.from(`${JSON.stringify(card, null, 2)}\n`);
  const path = join(directory, name); writeFileSync(path, bytes);
  return { path, sha256: digest(bytes) };
}
