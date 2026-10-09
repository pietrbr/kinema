"""Build tests/fixtures/pdf-figure.tex with and without the PDF converters on PATH.

Usage: uv run --no-project python tests/check_build.py
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DECK = ROOT / "tests" / "fixtures" / "pdf-figure.tex"
TEX_TOOLS = ("texlua", "latex", "dvisvgm", "kpsewhich", "extractbb")
BUILD = ["texlua", str(ROOT / "scripts" / "zlides" / "zlides.lua"), str(DECK)]


def build(path: str) -> subprocess.CompletedProcess:
    shutil.rmtree(DECK.with_suffix(".zlides"), ignore_errors=True)
    return subprocess.run(BUILD, capture_output=True, text=True, env={**os.environ, "PATH": path})


def tex_only_path(tmp: Path) -> str:
    """A PATH with only the TeX programs that the build calls, so no PDF converter is found."""
    for tool in TEX_TOOLS:
        found = shutil.which(tool)
        if not found:
            sys.exit(f"{tool} not found on PATH")
        (tmp / tool).symlink_to(found)
    return str(tmp)


def main() -> int:
    problems = []
    result = build(os.environ["PATH"])
    if result.returncode != 0 or "image/svg+xml" not in DECK.with_suffix(".html").read_text():
        problems.append(f"with converters: no SVG figure in the deck\n{result.stderr}")
    with tempfile.TemporaryDirectory() as tmp:
        result = build(tex_only_path(Path(tmp)))
        if result.returncode == 0 or "cannot convert" not in result.stderr:
            problems.append(f"without converters: expected a conversion error\n{result.stderr}")
    print("\n".join(problems) or "ok")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
