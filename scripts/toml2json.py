#!/usr/bin/env python3
"""Convert hardware.toml and cloud.toml to JSON for the web frontend.

Output format: [[key, {fields}], ...] matching the Vec<(String, Spec)> shape
used by the Rust code.
"""

import json
import os
import sys

# toml is in the stdlib since Python 3.11; fall back to tomli for older versions.
try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib  # type: ignore[no-redef]
    except ImportError:
        print("error: Python 3.11+ or `pip install tomli` required", file=sys.stderr)
        sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "web", "data")


def convert(src_name: str, top_key: str, out_name: str) -> int:
    src = os.path.join(DATA, src_name)
    with open(src, "rb") as f:
        data = tomllib.load(f)

    entries = data.get(top_key, {})
    result = [[key, val] for key, val in sorted(entries.items())]

    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, out_name)
    with open(dst, "w") as f:
        json.dump(result, f, separators=(",", ":"))

    print(f"{src_name} -> {out_name}: {len(result)} entries")
    return len(result)


def main() -> None:
    hw = convert("hardware.toml", "gpu", "hardware.json")
    cl = convert("cloud.toml", "cloud", "cloud.json")
    print(f"done: {hw} GPUs, {cl} cloud offerings")


if __name__ == "__main__":
    main()
