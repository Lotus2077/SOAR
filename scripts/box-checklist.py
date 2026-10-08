#!/usr/bin/env python3
"""SOAR box checklist: a read-only, summary-only inventory of the inference box.

Run it on the Linux machine you have a shell on (the Jetson itself, or an
appliance's application module). For complete results run it with sudo:

    sudo python3 box-checklist.py

It changes nothing on the system. It prints only whitelisted facts: versions,
flag names and on/off values, counts, port numbers, service names and public
package-repository hosts. It never prints IP addresses, hostnames, usernames,
API keys, tokens, environment values other than known on/off flags, raw command
lines, or file paths other than the model directory's final name.

Review the output before sharing it with anyone, including an AI assistant.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import platform
import re
import subprocess
import sys
import urllib.request

TIMEOUT_S = 10
ENGINE_PATTERN = re.compile(r"vllm|sglang|trtllm|tensorrt_llm|llama-server|llama_cpp|ollama|tritonserver", re.I)
SAFE_VALUE = re.compile(r"^[A-Za-z0-9_.:+\-]{1,40}$")
VALUE_FLAGS = (
    "--served-model-name", "--reasoning-parser", "--tool-call-parser", "--quantization",
    "--kv-cache-dtype", "--max-model-len", "--gpu-memory-utilization", "--tensor-parallel-size",
    "--max-num-seqs", "--dtype", "--port", "--max-num-batched-tokens",
)
BOOL_FLAGS = (
    "--enable-auto-tool-choice", "--enable-prefix-caching", "--no-enable-prefix-caching",
    "--enable-log-requests", "--enable-log-outputs", "--disable-log-requests",
    "--disable-uvicorn-access-log", "--trust-remote-code", "--enable-chunked-prefill",
)
ENV_FLAGS = (
    "VLLM_NO_USAGE_STATS", "DO_NOT_TRACK", "HF_HUB_OFFLINE", "HF_HUB_DISABLE_TELEMETRY",
    "TRANSFORMERS_OFFLINE", "VLLM_LOGGING_LEVEL", "VLLM_SERVER_DEV_MODE", "VLLM_CONFIGURE_LOGGING",
)
SECRET_ENV = ("VLLM_API_KEY", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "OPENAI_API_KEY")
SERVICE_WATCH = re.compile(
    r"apport|whoopsie|tailscale|zerotier|headscale|wg-quick|wireguard|openvpn|frp|ngrok|cloudflared|"
    r"snapd|ubuntu-advantage|ua-|motd|unattended|packagekit|telemetry|metrics|report|docker|containerd|"
    r"ssh|nvidia|jtop|rminte|tianshan|rm01|ota|avahi|cups|bluetooth|networkmanager|wpa_supplicant|vllm",
    re.I,
)

lines: list[str] = []


def emit(key: str, value: object) -> None:
    lines.append(f"{key}: {value}")


def run(cmd: list[str]) -> tuple[int | None, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_S)
        return proc.returncode, proc.stdout
    except (OSError, subprocess.SubprocessError):
        return None, ""


def read_text(path: str) -> str | None:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return None


def safe(value: object) -> str:
    text = str(value).strip()
    return text if SAFE_VALUE.match(text) else "<set, not shown>"


def address_class(address: str) -> str:
    host = address.strip("[]").split("%", 1)[0]
    if host in ("*", "0.0.0.0", "::"):
        return "all-interfaces"
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return "unparsed"
    if ip.is_loopback:
        return "loopback"
    if isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"):
        return "cgnat(tailscale-range)"
    if ip.is_private or ip.is_link_local:
        return "private-lan"
    return "public"


def split_host_port(endpoint: str) -> tuple[str, str]:
    host, _, port = endpoint.rpartition(":")
    return host, port


def parse_engine_args(argv: list[str]) -> dict[str, object]:
    """Extract whitelisted facts from an inference server's argv."""
    facts: dict[str, object] = {}
    args = list(argv)
    model = None
    for index, arg in enumerate(args):
        if arg == "serve" and index + 1 < len(args) and not args[index + 1].startswith("-"):
            model = args[index + 1]
    values: dict[str, str] = {}
    present: set[str] = set()
    index = 0
    while index < len(args):
        arg = args[index]
        if arg.startswith("--"):
            name, eq, inline = arg.partition("=")
            present.add(name)
            if eq:
                values[name] = inline
            elif index + 1 < len(args) and not args[index + 1].startswith("--"):
                values[name] = args[index + 1]
        index += 1
    model = values.get("--model", model)
    if model:
        repo_id = not model.startswith(("/", ".", "~")) and re.match(r"^[\w.\-]+/[\w.\-]+$", model)
        facts["model"] = model if repo_id else safe(os.path.basename(model.rstrip("/")))
        facts["_model_ref"] = model
    for flag in VALUE_FLAGS:
        if flag in values:
            facts[flag] = safe(values[flag])
    for flag in BOOL_FLAGS:
        facts[flag] = "yes" if flag in present else "no"
    facts["--api-key"] = "set" if "--api-key" in present else "not set"
    if "--allowed-origins" in present:
        facts["--allowed-origins"] = "wildcard" if "*" in values.get("--allowed-origins", "") else "restricted"
    else:
        facts["--allowed-origins"] = "default (wildcard)"
    if "--host" in values:
        facts["--host class"] = address_class(values["--host"])
        facts["_host"] = values["--host"]
    else:
        facts["--host class"] = "default (all-interfaces)"
    if "--speculative-config" in values:
        try:
            spec = json.loads(values["--speculative-config"])
            facts["speculative method"] = safe(spec.get("method", "unspecified"))
            facts["speculative tokens"] = safe(spec.get("num_speculative_tokens", "unspecified"))
        except (ValueError, AttributeError):
            facts["speculative method"] = "set, unparsed"
    else:
        facts["speculative method"] = "none"
    facts["custom chat template"] = "yes" if "--chat-template" in present else "no"
    facts["launch config file"] = "yes (not parsed)" if "--config" in present else "no"
    return facts


def identity() -> None:
    emit("script", "soar-box-checklist v1 (summary only; review before sharing)")
    emit("running as root", "yes" if hasattr(os, "geteuid") and os.geteuid() == 0 else "no (some checks skipped)")
    emit("os family", platform.system())
    if platform.system() != "Linux":
        emit("note", "this checklist targets the Linux inference box; results on this OS are not meaningful")
    emit("architecture", platform.machine())
    release = read_text("/etc/os-release") or ""
    match = re.search(r'^PRETTY_NAME="?([^"\n]+)', release, re.M)
    emit("os release", match.group(1) if match else "unknown")
    model = read_text("/proc/device-tree/model")
    emit("device-tree model", model.strip("\x00\n ") if model else "none (not a Jetson or not readable)")
    tegra = read_text("/etc/nv_tegra_release")
    emit("nv_tegra_release", tegra.splitlines()[0].strip("# ")[:120] if tegra else "none")
    code, out = run(["dpkg-query", "-W", "-f=${Package} ${Version}\\n", "nvidia-l4t-core", "nvidia-jetpack"])
    for row in out.splitlines():
        emit("package", row.strip())
    emit("cpu count", os.cpu_count())
    meminfo = read_text("/proc/meminfo") or ""
    for key in ("MemTotal", "SwapTotal"):
        found = re.search(rf"^{key}:\s+(\d+) kB", meminfo, re.M)
        if found:
            emit(key, f"{int(found.group(1)) / 1048576:.1f} GiB")
    code, out = run(["nvpmodel", "-q"])
    mode = re.search(r"NV Power Mode:\s*(.+)", out)
    emit("nvpmodel mode", mode.group(1).strip() if mode else "unavailable")


def engine_processes() -> list[tuple[int, dict[str, object]]]:
    found: list[tuple[int, dict[str, object]]] = []
    if not os.path.isdir("/proc"):
        emit("inference processes", "cannot inspect (/proc missing)")
        return found
    for pid_text in os.listdir("/proc"):
        if not pid_text.isdigit():
            continue
        raw = None
        try:
            with open(f"/proc/{pid_text}/cmdline", "rb") as handle:
                raw = handle.read()
        except OSError:
            continue
        argv = [part.decode("utf-8", "replace") for part in raw.split(b"\0") if part]
        if not argv or not ENGINE_PATTERN.search(" ".join(argv[:4])):
            continue
        if "box-checklist" in " ".join(argv):
            continue
        facts = parse_engine_args(argv)
        facts["engine"] = ENGINE_PATTERN.search(" ".join(argv[:4])).group(0).lower()
        found.append((int(pid_text), facts))
    emit("inference processes found", len(found))
    return found


def process_env(pid: int) -> None:
    try:
        with open(f"/proc/{pid}/environ", "rb") as handle:
            pairs = [p.decode("utf-8", "replace") for p in handle.read().split(b"\0") if p]
    except OSError:
        emit(f"  pid {pid} environment", "not readable (run with sudo)")
        return
    env = dict(pair.split("=", 1) for pair in pairs if "=" in pair)
    for name in ENV_FLAGS:
        emit(f"  env {name}", safe(env[name]) if name in env else "unset")
    for name in SECRET_ENV:
        emit(f"  env {name}", "set" if env.get(name) else "unset")
    home = env.get("HOME")
    if home:
        marker = f"/proc/{pid}/root{home}/.config/vllm/do_not_track"
        emit("  vllm do_not_track file", "present" if os.path.exists(marker) else "absent or unreadable")


def model_config(pid: int, model_ref: str) -> None:
    candidates = [model_ref, f"/proc/{pid}/root{model_ref}"] if model_ref.startswith("/") else [model_ref]
    for base in candidates:
        config_path = os.path.join(base, "config.json")
        text = read_text(config_path)
        if text is None:
            continue
        emit("  config.json sha256", hashlib.sha256(text.encode("utf-8")).hexdigest())
        try:
            config = json.loads(text)
        except ValueError:
            emit("  config.json", "unparsed")
            return
        text_config = config.get("text_config", {}) if isinstance(config.get("text_config"), dict) else {}
        emit("  architectures", ",".join(map(safe, config.get("architectures", []))) or "unknown")
        emit("  model_type", safe(config.get("model_type", "unknown")))
        quant = config.get("quantization_config") or text_config.get("quantization_config") or {}
        emit("  quant_method", safe(quant.get("quant_method", "none")) if isinstance(quant, dict) else "unparsed")
        for key in ("num_hidden_layers", "num_experts", "num_experts_per_tok", "num_nextn_predict_layers",
                    "mtp_num_hidden_layers", "max_position_embeddings"):
            value = config.get(key, text_config.get(key))
            if value is not None:
                emit(f"  {key}", safe(value))
        total = 0
        count = 0
        try:
            for name in os.listdir(base):
                if name.endswith(".safetensors"):
                    count += 1
                    total += os.path.getsize(os.path.join(base, name))
        except OSError:
            pass
        emit("  safetensors files", count)
        emit("  safetensors size", f"{total / 1073741824:.1f} GiB")
        return
    emit("  config.json", "not found from this machine (model may live on another module or in a container)")


def engine_version(facts: dict[str, object]) -> None:
    port = facts.get("--port", "8000")
    if not str(port).isdigit():
        return
    host = str(facts.get("_host", "127.0.0.1"))
    if address_class(host) == "all-interfaces":
        host = "127.0.0.1"
    url_host = f"[{host}]" if ":" in host else host
    try:
        with urllib.request.urlopen(f"http://{url_host}:{port}/version", timeout=5) as response:
            version = json.loads(response.read(2048)).get("version", "unknown")
            emit("  engine version (/version)", safe(version))
    except (OSError, ValueError):
        emit("  engine version (/version)", "not reachable from this machine")


def sockets() -> None:
    code, out = run(["ss", "-H", "-tlnp"])
    if code is None:
        emit("listening sockets", "ss unavailable")
        return
    seen = set()
    for row in out.splitlines():
        cols = row.split()
        if len(cols) < 4:
            continue
        host, port = split_host_port(cols[3])
        proc = re.search(r'users:\(\("([^"]+)"', row)
        seen.add((port, address_class(host), proc.group(1) if proc else "?"))
    for port, klass, name in sorted(seen, key=lambda item: (int(item[0]) if item[0].isdigit() else 0, item[1])):
        emit("listening", f"port {port} on {klass} by {name}")
    code, out = run(["ss", "-H", "-tnp", "state", "established"])
    counts: dict[tuple[str, str, str], int] = {}
    for row in out.splitlines():
        cols = row.split()
        if len(cols) < 4:
            continue
        host, port = split_host_port(cols[3])
        proc = re.search(r'users:\(\("([^"]+)"', row)
        key = (address_class(host), port, proc.group(1) if proc else "?")
        counts[key] = counts.get(key, 0) + 1
    if not counts:
        emit("established connections", "none")
    for (klass, port, name), count in sorted(counts.items()):
        emit("established", f"{count} x to {klass} port {port} by {name}")


def services() -> None:
    code, out = run(["systemctl", "list-units", "--type=service", "--state=running", "--no-legend", "--plain"])
    names = [row.split()[0] for row in out.splitlines() if row.split()]
    emit("running services", len(names))
    for name in names:
        if SERVICE_WATCH.search(name):
            emit("  watched service running", name)
    code, out = run(["systemctl", "list-timers", "--all", "--no-legend", "--plain"])
    for row in out.splitlines():
        for token in row.split():
            if token.endswith(".timer") and re.search(r"update|motd|apport|telemetry|report|ota|upgrade", token, re.I):
                emit("  watched timer", token)
    hosts = set()
    for directory, _, files in os.walk("/etc/apt"):
        for name in files:
            if not name.endswith((".list", ".sources")):
                continue
            for match in re.finditer(r"https?://([A-Za-z0-9.\-]+)", read_text(os.path.join(directory, name)) or ""):
                hosts.add(match.group(1).lower())
    for host in sorted(hosts):
        emit("  package repository host", host)


def hardening() -> None:
    core = (read_text("/proc/sys/kernel/core_pattern") or "").strip()
    emit("crash dumps piped to apport", "yes" if "apport" in core else "no")
    apport = read_text("/etc/default/apport") or ""
    emit("apport enabled in /etc/default/apport", "yes" if re.search(r"^enabled=1", apport, re.M) else "no or absent")
    code, out = run(["sshd", "-T"])
    if code == 0:
        for key in ("passwordauthentication", "permitrootlogin", "pubkeyauthentication"):
            found = re.search(rf"^{key}\s+(\S+)", out, re.M)
            emit(f"sshd {key}", found.group(1) if found else "unknown")
    else:
        emit("sshd effective config", "unavailable (needs sudo or sshd absent)")
    code, out = run(["getent", "passwd", "rm01"])
    if code == 0 and out:
        code, status = run(["passwd", "-S", "rm01"])
        parts = status.split()
        emit("vendor default account rm01", f"exists; status {parts[1] if len(parts) > 1 else '?'}; last change {parts[2] if len(parts) > 2 else '?'}")
    else:
        emit("vendor default account rm01", "absent")
    code, out = run(["lsblk", "-J", "-o", "NAME,TYPE,FSTYPE,MOUNTPOINT"])
    try:
        devices = json.loads(out).get("blockdevices", []) if out else []
    except ValueError:
        devices = []
    flat: list[dict[str, object]] = []
    stack = list(devices)
    while stack:
        node = stack.pop()
        flat.append(node)
        stack.extend(node.get("children", []) or [])
    emit("any encrypted block device", "yes" if any(d.get("type") == "crypt" or d.get("fstype") == "crypto_LUKS" for d in flat) else "no")
    root_crypt = False
    for node in devices:
        stack = [(node, False)]
        while stack:
            current, under_crypt = stack.pop()
            is_crypt = under_crypt or current.get("type") == "crypt"
            if current.get("mountpoint") == "/":
                root_crypt = is_crypt
            stack.extend((child, is_crypt) for child in current.get("children", []) or [])
    emit("root filesystem on encrypted device", "yes" if root_crypt else "no")
    swaps = (read_text("/proc/swaps") or "").splitlines()[1:]
    emit("active swap devices", len(swaps))
    code, out = run(["nft", "list", "ruleset"])
    if code == 0:
        for hook in ("input", "output", "forward"):
            found = re.search(rf"hook {hook} priority [^;]+;\s*policy (\w+);", out)
            emit(f"nftables {hook} policy", found.group(1) if found else "no base chain")
    else:
        emit("nftables", "unavailable (needs sudo or nft absent)")
    code, out = run(["ufw", "status"])
    emit("ufw", out.splitlines()[0] if code == 0 and out else "unavailable")
    code, out = run(["docker", "info", "--format", "{{.ServerVersion}} runtime={{.DefaultRuntime}}"])
    emit("docker", out.strip() if code == 0 and out.strip() else "unavailable")
    code, out = run(["docker", "ps", "--format", "{{.Image}}"])
    for image in sorted(set(out.split())):
        emit("  running image", image)


def self_test() -> int:
    argv = ["python3", "-m", "vllm.entrypoints.openai.api_server", "--model", "/home/someone/models/Qwen3.8-27B-FP8",
            "--served-model-name", "RM-01 VLM", "--api-key", "sk-secret", "--host", "10.1.2.3", "--port=58000",
            "--speculative-config", '{"method": "mtp", "num_speculative_tokens": 3}', "--enable-prefix-caching"]
    facts = parse_engine_args(argv)
    printable = {k: v for k, v in facts.items() if not k.startswith("_")}
    rendered = json.dumps(printable)
    assert facts["model"] == "Qwen3.8-27B-FP8", facts
    assert "sk-secret" not in rendered and "10.1.2.3" not in rendered and "someone" not in rendered, rendered
    assert facts["--api-key"] == "set" and facts["--host class"] == "private-lan", facts
    assert facts["speculative method"] == "mtp" and facts["--port"] == "58000", facts
    assert facts["--served-model-name"] == "<set, not shown>", facts
    serve = parse_engine_args(["vllm", "serve", "Qwen/Qwen3.8-27B-FP8", "--reasoning-parser", "qwen3"])
    assert serve["model"] == "Qwen/Qwen3.8-27B-FP8" and serve["--reasoning-parser"] == "qwen3", serve
    assert address_class("100.101.1.1") == "cgnat(tailscale-range)"
    assert address_class("::1") == "loopback" and address_class("8.8.8.8") == "public"
    assert address_class("fe80::1%eth0") == "private-lan" and address_class("*") == "all-interfaces"
    print("self-test passed")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    identity()
    for pid, facts in engine_processes():
        emit("inference process", f"pid {pid} engine {facts['engine']}")
        for key, value in facts.items():
            if not key.startswith("_") and key != "engine":
                emit(f"  {key}", value)
        process_env(pid)
        if isinstance(facts.get("_model_ref"), str):
            model_config(pid, str(facts["_model_ref"]))
        engine_version(facts)
    sockets()
    services()
    hardening()
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
