"""Build tests/fixtures/pdf-trim.tex with each converter and check the colors of each cropped page.

Usage: uv run --no-project --with playwright --with pillow python tests/check_crop.py
"""

import io
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from check_browsers import VIEWPORT, launchers
from check_build import CONVERTERS, SCRIPT, TEX_TOOLS, tool_path
from PIL import Image
from playwright.sync_api import Error, sync_playwright

DECK = Path(__file__).resolve().parent / "fixtures" / "pdf-trim.tex"
EXPECTED = {1: "blue", 2: "red", 3: "blue"}
MIN_PIXELS = 1000
STRONG = 200
WEAK = 60
SETTLE_MS = 300


def count_colors(png: bytes) -> dict[str, int]:
    counts = {"blue": 0, "red": 0}
    for n, (r, g, b) in Image.open(io.BytesIO(png)).convert("RGB").getcolors(1 << 24):
        if b > STRONG and r < WEAK and g < WEAK:
            counts["blue"] += n
        elif r > STRONG and g < WEAK and b < WEAK:
            counts["red"] += n
    return counts


def build(path: str) -> str | None:
    shutil.rmtree(DECK.with_suffix(".kinema"), ignore_errors=True)
    result = subprocess.run(["texlua", str(SCRIPT), str(DECK)], capture_output=True, text=True,
                            env={**os.environ, "PATH": path})
    return None if result.returncode == 0 else result.stderr


def check_pages(page) -> list[str]:
    problems = []
    for number, color in EXPECTED.items():
        page.goto(f"{DECK.with_suffix('.html').as_uri()}?page={number}")
        page.wait_for_timeout(SETTLE_MS)
        counts = count_colors(page.screenshot())
        other = "red" if color == "blue" else "blue"
        if counts[color] < MIN_PIXELS or counts[other] > 0:
            problems.append(f"page {number}: expected only {color}, got {counts}")
    return problems


def main() -> int:
    failed = False
    checked = 0
    with sync_playwright() as p, tempfile.TemporaryDirectory() as name:
        for converter in CONVERTERS:
            error = build(tool_path(Path(name), TEX_TOOLS + (converter,)))
            if error:
                print(f"{converter}: build failed\n{error}")
                failed = True
                continue
            for browser_name, launch in launchers(p):
                try:
                    browser = launch()
                except Error as exc:
                    print(f"{browser_name:9s} skipped: {exc.message.splitlines()[0]}")
                    continue
                try:
                    problems = check_pages(browser.new_page(viewport=VIEWPORT))
                except Error as exc:
                    problems = [exc.message.splitlines()[0]]
                finally:
                    browser.close()
                checked += 1
                failed |= bool(problems)
                print(f"{converter:10s} {browser_name:9s} {problems or 'ok'}")
    shutil.rmtree(DECK.with_suffix(".kinema"), ignore_errors=True)
    if checked == 0:
        print("no browser ran")
        return 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
