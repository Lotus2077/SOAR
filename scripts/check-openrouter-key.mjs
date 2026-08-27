import { execFileSync } from "node:child_process";
import process from "node:process";

const service = process.env.SOAR_OPENROUTER_KEYCHAIN_SERVICE ?? "ai.soar.openrouter";
const account = process.env.SOAR_OPENROUTER_KEYCHAIN_ACCOUNT ?? "default";

let key;
try {
  key = execFileSync(
    "/usr/bin/security",
    ["find-generic-password", "-w", "-a", account, "-s", service],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
} catch {
  process.stderr.write(`OpenRouter key is not available in macOS Keychain service ${service}.\n`);
  process.exit(1);
}

if (!key.startsWith(["sk", "or", "v1"].join("-") + "-")) {
  process.stderr.write("The Keychain entry does not contain an OpenRouter inference key.\n");
  process.exit(1);
}

const response = await fetch("https://openrouter.ai/api/v1/key", {
  headers: { Authorization: `Bearer ${key}` },
});
key = undefined;

if (!response.ok) {
  process.stderr.write(`OpenRouter key check failed with HTTP ${response.status}.\n`);
  process.exit(1);
}

const { data } = await response.json();
if (data.is_management_key) {
  process.stderr.write("Refusing a management key for SOAR inference.\n");
  process.exit(1);
}

if (data.limit !== 100 || data.limit_reset !== null) {
  process.stderr.write("OpenRouter key does not have the expected USD 100 non-resetting limit.\n");
  process.exit(1);
}

process.stdout.write(
  `OpenRouter key ready: USD ${data.limit_remaining.toFixed(2)} remaining of USD ${data.limit.toFixed(2)}, no reset, expires ${data.expires_at}.\n`,
);
