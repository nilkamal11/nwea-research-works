"""Build the deterministic browser dataset from the validated snapshot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .analytics import ROOT, ResearchAnalytics

OUTPUT = ROOT / "python-d3" / "data.json"


def serialize(analytics: ResearchAnalytics | None = None) -> bytes:
    data = (analytics or ResearchAnalytics()).bootstrap()
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if the checked-in export differs from a fresh build")
    args = parser.parse_args()
    expected = serialize()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != expected:
            print("Export is out of date. Run python -m python_d3.export")
            return 1
        print("Python/D3 export is current")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(expected)
    print(f"Wrote {OUTPUT.name} ({len(expected):,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
