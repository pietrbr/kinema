"""Build decks with PDF figures: with each converter, with none, and with each cropping option.

Usage: uv run --no-project python tests/check_build.py
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "kinetic" / "kinetic.lua"
FIGURE = ROOT / "tests" / "fixtures" / "figure.pdf"
TEX_TOOLS = ("texlua", "latex", "dvisvgm", "kpsewhich", "extractbb")
CONVERTERS = ("pdftocairo", "pdf2svg")
CROP_OPTIONS = {"trim=1cm 0 0 0": "trim option", "viewport=0 0 20 20": "viewport option",
                "bb=0 0 20 20": "bb option", "pagebox=mediabox": "crop box"}
DECK = r"""\documentclass{{beamer}}
\usepackage{{kinetic}}
\begin{{document}}
\begin{{frame}}{{PDF figure}}\includegraphics[{options}]{{figure}}\end{{frame}}
\end{{document}}
"""


def tool_path(tmp: Path, tools: tuple[str, ...]) -> str:
    """A PATH that holds only the given programs."""
    bindir = tmp / "bin"
    shutil.rmtree(bindir, ignore_errors=True)
    bindir.mkdir()
    for tool in tools:
        found = shutil.which(tool)
        if not found:
            sys.exit(f"{tool} not found on PATH")
        (bindir / tool).symlink_to(found)
    return str(bindir)


def build(tmp: Path, path: str, options: str = "width=3cm") -> subprocess.CompletedProcess:
    deck = tmp / "deck.tex"
    deck.write_text(DECK.format(options=options))
    shutil.rmtree(tmp / "deck.kinetic", ignore_errors=True)
    cmd = ["texlua", str(SCRIPT), str(deck)]
    return subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "PATH": path})


def has_svg_figure(tmp: Path) -> bool:
    html = tmp / "deck.html"
    return html.exists() and "image/svg+xml" in html.read_text()


def main() -> int:
    problems = []
    with tempfile.TemporaryDirectory() as name:
        tmp = Path(name)
        shutil.copy(FIGURE, tmp / "figure.pdf")
        for converter in CONVERTERS:
            result = build(tmp, tool_path(tmp, TEX_TOOLS + (converter,)))
            if result.returncode != 0 or not has_svg_figure(tmp):
                problems.append(f"{converter} only: no SVG figure in the deck\n{result.stderr}")
        result = build(tmp, tool_path(tmp, TEX_TOOLS))
        if result.returncode == 0 or "cannot convert" not in result.stderr:
            problems.append(f"no converter: expected a conversion error\n{result.stderr}")
        for options, message in CROP_OPTIONS.items():
            result = build(tmp, os.environ["PATH"], options)
            if result.returncode == 0 or message not in result.stderr.replace("\n", ""):
                problems.append(f"{options}: expected an error naming '{message}'\n{result.stderr}")
    print("\n".join(problems) or "ok")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
