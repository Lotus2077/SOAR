import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ANTHROPIC_API_VERSION } from "../../src/main/private-agent/anthropic";

const SCRIPT = resolve(__dirname, "..", "..", "scripts", "with-claude-key.sh");
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0)) step(); });
/** Stand-ins for macOS `security` and `curl` on PATH: the Keychain answers a synthetic key; curl records its config and answers `status`. */
function stubs(status: string) {
  const dir = mkdtempSync(join(tmpdir(), "soar-claude-key-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "security"), "#!/bin/sh\n[ \"$1\" = find-generic-password ] && printf 'sk-ant-kc-0001\\n'\n");
  writeFileSync(join(dir, "curl"), `#!/bin/sh\ncat > "${dir}/curl-config"\nprintf '%s\\n' "$@" > "${dir}/curl-args"\nprintf '${status}'\n`);
  for (const name of ["security", "curl"]) chmodSync(join(dir, name), 0o755);
  return { dir, env: { ...process.env, PATH: `${dir}:/usr/bin:/bin`, USER: "synthetic", SOAR_PHASE2_CLOUD_API_KEY: "sk-oai-nopass-01" } };
}

describe("scripts/with-claude-key.sh", () => {
  it("pins the same API version as the adapter", () => {
    expect(readFileSync(SCRIPT, "utf8")).toContain(`API_VERSION=${ANTHROPIC_API_VERSION}\n`);
  });

  it("runs the command with only the Claude key, never the OpenAI one", () => {
    const s = stubs("200");
    const out = execFileSync(SCRIPT, ["/usr/bin/env"], { env: s.env, encoding: "utf8" });
    expect(out).toContain("SOAR_CLAUDE_CLOUD_API_KEY=sk-ant-kc-0001\n");
    expect(out).not.toContain("SOAR_PHASE2_CLOUD_API_KEY");
  });

  it("checks the key with one model-list request whose headers travel on stdin, and exits non-zero unless 200", () => {
    const s = stubs("200");
    const passed = spawnSync(SCRIPT, ["--check"], { env: s.env, encoding: "utf8" });
    expect(passed.status).toBe(0); expect(passed.stdout).toContain("models endpoint HTTP 200");
    expect(readFileSync(join(s.dir, "curl-config"), "utf8")).toBe(`header = "x-api-key: sk-ant-kc-0001"\nheader = "anthropic-version: ${ANTHROPIC_API_VERSION}"\n`);
    const args = readFileSync(join(s.dir, "curl-args"), "utf8");
    expect(args).toContain("https://api.anthropic.com/v1/models\n"); expect(args).not.toContain("sk-ant");
    const refused = spawnSync(SCRIPT, ["--check"], { env: stubs("401").env, encoding: "utf8" });
    expect(refused.status).not.toBe(0); expect(refused.stdout).toContain("HTTP 401"); expect(refused.stdout + refused.stderr).not.toContain("sk-ant");
  });
});
