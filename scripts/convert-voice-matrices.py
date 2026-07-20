#!/usr/bin/env python3
"""
Download voice .pt tensors from hexgrad/Kokoro-82M and write the full
[510, 256] style matrix into each voice JSON in the CoreML cache dir.

The CoreML port collapsed each [510, 1, 256] tensor to a single averaged
embedding. This script restores the full matrix so the Swift inference code
can pick the row matching the actual token count, matching the reference
Python implementation's behavior.
"""

import json
import sys
from pathlib import Path

import torch
from huggingface_hub import hf_hub_download, list_repo_files

CACHE_DIR = Path.home() / "Library/Caches/qwen3-speech/models/aufklarer/Kokoro-82M-CoreML/voices"
SOURCE_REPO = "hexgrad/Kokoro-82M"


def convert_voice(name: str) -> bool:
    json_path = CACHE_DIR / f"{name}.json"
    if not json_path.exists():
        print(f"  skip {name}: no JSON in cache")
        return False

    try:
        pt_path = hf_hub_download(SOURCE_REPO, f"voices/{name}.pt", local_dir_use_symlinks=False)
    except Exception as e:
        print(f"  skip {name}: download failed — {e}")
        return False

    tensor = torch.load(pt_path, weights_only=True)  # [510, 1, 256]
    if tensor.ndim == 3:
        tensor = tensor.squeeze(1)  # → [510, 256]
    elif tensor.ndim == 1:
        # Already a single vector — nothing to do
        print(f"  skip {name}: source is 1-D, no matrix available")
        return False

    matrix = tensor.float().tolist()  # [[float * 256] * 510]

    with open(json_path) as f:
        data = json.load(f)

    data["matrix"] = matrix

    with open(json_path, "w") as f:
        json.dump(data, f, separators=(",", ":"))

    print(f"  ok {name}: {tensor.shape[0]} rows × {tensor.shape[1]} dims")
    return True


def main():
    if not CACHE_DIR.exists():
        print(f"Cache dir not found: {CACHE_DIR}")
        sys.exit(1)

    pt_files = [
        f for f in list_repo_files(SOURCE_REPO)
        if f.startswith("voices/") and f.endswith(".pt")
    ]
    names = [Path(f).stem for f in pt_files]
    print(f"Found {len(names)} voices in {SOURCE_REPO}")

    ok = sum(convert_voice(n) for n in names)
    print(f"\nDone: {ok}/{len(names)} voices updated")


if __name__ == "__main__":
    main()
