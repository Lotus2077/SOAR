"""Run an unmodified copy of scripts/serving-probe.py against a loopback fake of a vLLM endpoint served by this process, and print what
the fake received (BL-20261116-0839-e0-registry-modes-design's test of the probe mode against the probe's real output).

    python3 -I tests/helpers/serving-probe-fake.py <repository root> <empty work directory> <research protocol sha256>

The copy runs from <work>/scripts, so its run directory lands under <work>/.soar/experiments; nothing is written to the repository and no
address but 127.0.0.1 is contacted. Its environment names proxies on a loopback port nothing listens on, in every form urllib reads: the
probe connects directly whatever they say (BL-20261116-1033-serving-probe-direct-transport-design), so a request that took a proxy would
never reach the fake. P6 is skipped: its ten one-second load samples only slow the test, and its record's shape is covered
by the synthetic probe. Every string the fake serves that a registry row must never carry is in LEAKS."""
import hashlib
import json
import os
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT, WORK, PROTOCOL = sys.argv[1], sys.argv[2], sys.argv[3]
ALIAS = "Fake-Served-Alias"
LEAKS = (ALIAS, "secret-weights", "private-alpha", "0.0.0-fake", "/srv/models")
received = {"chat": 0, "stream": 0, "tokenize": 0}
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def send(self, status, data, kind="application/json"):
        self.send_response(status)
        self.send_header("content-type", kind)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        routes = {"/v1/models": {"data": [{"id": ALIAS, "root": "/srv/models/secret-weights", "max_model_len": 262144}]}, "/version": {"version": "0.0.0-fake"},
                  "/openapi.json": {"info": {"version": "0.0.0-fake"}, "paths": {"/tokenize": {}},
                                    "components": {"schemas": {"ChatCompletionRequest": {"properties": {"response_format": {}, "chat_template_kwargs": {}, "cache_salt": {}}}}}}}
        if self.path == "/metrics":
            return self.send(200, b"vllm:num_requests_running 0\nvllm:num_requests_waiting 0\n", "text/plain")
        if self.path in routes:
            return self.send(200, json.dumps(routes[self.path]).encode())
        return self.send(404, b"{}")

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        if self.path == "/tokenize":
            with lock:
                received["tokenize"] += 1
            return self.send(200, json.dumps({"count": 7}).encode())
        if self.path != "/v1/chat/completions":
            return self.send(404, b"{}")
        with lock:
            received["chat"] += 1
            received["stream"] += 1 if body.get("stream") else 0
        if body.get("max_tokens", 0) > 100000:
            # P9's context guard: an error body naming a path, which the probe keeps only as a length and a digest.
            return self.send(400, json.dumps({"error": "max_tokens exceeds the context of /srv/models/secret-weights"}).encode())
        content = json.dumps({"version": 2, "questions": []}) if body.get("response_format") else "ready"
        usage = {"prompt_tokens": 11, "completion_tokens": 3, "prompt_tokens_details": {"cached_tokens": 2}}
        if body.get("stream"):
            chunks = [{"model": ALIAS, "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}]},
                      {"model": ALIAS, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}, {"model": ALIAS, "choices": [], "usage": usage}]
            return self.send(200, b"".join(f"data: {json.dumps(chunk)}\n\n".encode() for chunk in chunks) + b"data: [DONE]\n\n", "text/event-stream")
        message = {"role": "assistant", "content": content}
        if body.get("tools"):
            message = {"role": "assistant", "content": None, "tool_calls": [{"function": {"name": "write_file", "arguments": json.dumps({"path": "out.txt", "content": "x"})}}]}
        return self.send(200, json.dumps({"id": "x", "model": ALIAS, "choices": [{"index": 0, "message": message, "finish_reason": "stop"}], "usage": usage}).encode())


class Server(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main() -> None:
    os.makedirs(os.path.join(WORK, "scripts"))
    shutil.copy(os.path.join(ROOT, "scripts", "serving-probe.py"), os.path.join(WORK, "scripts", "serving-probe.py"))
    server = Server(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    roles, modes = ("plan", "extract", "synthesis"), ("on", "off")
    body = lambda role, mode: {"model": ALIAS, "messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}], "max_tokens": 64, "stream": mode == "on"}
    # A role export of version 2, the shape pnpm probe:export-schemas writes, with a source id that looks like a path.
    export = {"version": 2, "protocolSha256": PROTOCOL, "outputTokens": {"plan": 64}, "thinking": {"plan": "model"}, "requestSettings": {"model": ALIAS},
              "schemas": {role: {"type": "object"} for role in roles}, "systems": {role: "s" for role in roles},
              "payloads": {"plan": {"units": ["U1"], "sourceIds": ["input/corpus/private-alpha.md"], "userContent": "u"}, "extract": {"userContent": "u"},
                           "synthesis": {"userContent": "u"}},
              "requests": {role: {mode: {"body": body(role, mode), "bodySha256": hashlib.sha256(json.dumps(body(role, mode)).encode()).hexdigest()} for mode in modes}
                           for role in roles}}
    with open(os.path.join(WORK, "role-schemas.json"), "w", encoding="utf-8") as handle:
        json.dump(export, handle)
    open(os.path.join(WORK, "empty.env"), "w").close()
    dead = socket.socket()
    dead.bind(("127.0.0.1", 0))
    proxy = f"http://127.0.0.1:{dead.getsockname()[1]}"
    dead.close()
    environment = {"PATH": "/usr/bin:/bin", "http_proxy": proxy, "https_proxy": proxy, "HTTP_PROXY": proxy, "HTTPS_PROXY": proxy,
                   "SOAR_VLLM_BASE_URL": f"http://127.0.0.1:{server.server_address[1]}/v1", "SOAR_VLLM_MODEL": ALIAS}
    probe = subprocess.run(["python3", "-I", os.path.join(WORK, "scripts", "serving-probe.py"), "--schemas", os.path.join(WORK, "role-schemas.json"),
                            "--env-file", os.path.join(WORK, "empty.env"), "--skip", "P6", "--p10-calls", "2", "--p11-sizes", "50", "--p11-ks", "1,2"],
                           env=environment, capture_output=True, text=True, timeout=240)
    server.shutdown()
    saved = [line.split()[1] for line in probe.stdout.splitlines() if line.startswith("saved ")]
    print(json.dumps({"exit": probe.returncode, "runDir": os.path.join(WORK, ".soar", "experiments", saved[0]) if saved else None, "received": received,
                      "leaks": list(LEAKS) + ["127.0.0.1"], "stderr": probe.stderr[-400:]}))


main()
