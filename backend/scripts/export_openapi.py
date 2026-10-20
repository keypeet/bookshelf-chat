"""Write the Studio API contract to src/lib/studio/openapi.json.

    uv run --directory backend python scripts/export_openapi.py [--check]

--check exits 1 when the file differs from what the code produces.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import ROOT, Settings  # noqa: E402
from app.main import create_app  # noqa: E402

TARGET = ROOT / "src" / "lib" / "studio" / "openapi.json"


def main() -> int:
    settings = Settings.from_env({}, root=ROOT)  # the contract must not depend on local env
    text = json.dumps(create_app(settings).openapi(), ensure_ascii=False, indent=2) + "\n"
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.is_file() else ""
        if current != text:
            print(f"{TARGET.relative_to(ROOT)} is stale: run npm run api:types", file=sys.stderr)
            return 1
        print(f"{TARGET.relative_to(ROOT)} matches the backend.")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
