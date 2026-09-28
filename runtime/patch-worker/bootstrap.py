"""Install only the pinned borrowed core and verify its wheel/source identity."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import urllib.request
import venv

ROOT = pathlib.Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--venv", required=True)
    args = parser.parse_args()
    target = pathlib.Path(args.venv).resolve()
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10 or later is required")
    venv.EnvBuilder(with_pip=True, symlinks=True).create(target)
    python = target / "bin" / "python"
    lock = json.loads((ROOT / "runtime-lock.json").read_text())
    with tempfile.TemporaryDirectory(prefix="soar-runtime-install-") as directory:
        wheel = pathlib.Path(directory) / "mini_swe_agent-2.4.6-py3-none-any.whl"
        with urllib.request.urlopen(lock["wheelUrl"], timeout=60) as response:
            data = response.read(2_000_000)
        if hashlib.sha256(data).hexdigest() != lock["wheelSha256"]:
            raise SystemExit("mini-swe-agent wheel checksum mismatch")
        wheel.write_bytes(data)
        subprocess.run([str(python), "-m", "pip", "install", "--no-deps", str(wheel)], check=True)
        dependency_file = pathlib.Path(directory) / "dependencies.txt"
        dependency_file.write_text("\n".join(line for line in (ROOT / "requirements.txt").read_text().splitlines()
                                             if not line.startswith("mini-swe-agent")))
        subprocess.run([str(python), "-m", "pip", "install", "--no-deps", "-r", str(dependency_file)], check=True)
    subprocess.run([str(python), str(ROOT / "worker.py"), "--check-runtime"], check=True)


if __name__ == "__main__":
    main()
