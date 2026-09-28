"""Freeze already provisioned local assets. This command does not download or infer."""
import argparse
import json
from pathlib import Path
import sys

from adapter import sha
from calibrate import CASE_SECONDS, MAX_RSS, PASS_SECONDS, file_sha, inventory_paths


def prepare(root: Path, output: Path) -> dict:
    root = root.resolve()
    assets = root / "assets"
    model = assets / "checkpoint/model.safetensors"
    if file_sha(model) != "9c262cbe68a0c8a50590a648ef8341a2b7d3be1fa11dfb79893fe0b03ce57b5c":
        raise ValueError("checkpoint_binding")
    paths = [Path(__file__).resolve().parent, assets, root / "venv/lib", root / "provision"]
    roots = [str(path) for path in paths]
    evidence = ("manifest.json", "schema.md", "verification.json", "score.py",
                "scorer-verification.json", "runtime-source-review.json")
    standalone = [str(Path(sys.executable).resolve())] + [str(root / "evaluation" / name) for name in evidence]
    files = inventory_paths(roots, standalone)
    bindings = [{"path": str(path), "bytes": path.stat().st_size, "sha256": file_sha(path)}
                for path in files]
    frozen = {"schemaVersion": 1, "opfRevision": "f7f00ca7fb869683eb732c010299d901457f19c3",
              "checkpointRevision": "7ffa9a043d54d1be65afb281eddf0ffbe629385b",
              "checkpoint": str(assets / "checkpoint"), "opfSource": str(assets / "opf-source"),
              "englishModel": str(assets / "english-model"), "tokenizerCache": str(assets / "tiktoken-cache"),
              "chineseModel": str(assets / "chinese-model"),
              "limits": {"peakRssBytes": MAX_RSS, "caseSeconds": CASE_SECONDS,
                         "passSeconds": PASS_SECONDS, "threads": 4},
              "roots": roots, "standalone": standalone,
              "files": bindings, "canAuthorizeDisclosure": False}
    raw = (json.dumps(frozen, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    with output.open("xb") as stream:
        stream.write(raw)
    return {"freezeSha256": sha(raw), "files": len(bindings),
            "boundBytes": sum(item["bytes"] for item in bindings)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(Path(args.root), Path(args.output))))
