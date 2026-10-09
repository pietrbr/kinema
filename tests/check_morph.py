"""Inspect the morph cases of tests/fixtures/morph-limits.html in the middle of each morph.

Usage: uv run --no-project --with playwright python tests/check_morph.py tests/fixtures/morph-limits.html
"""

import sys
from pathlib import Path

from check_browsers import launchers
from playwright.sync_api import Error, sync_playwright

MID = 0.5
OVERLAY_PATHS = "[...document.querySelectorAll('#overlay path')].map((p) => [p.getAttribute('d'), p.getAttribute('fill-rule')])"
LABEL_VISIBLE = (
    "[...document.querySelectorAll('.page')[4].querySelectorAll('[data-zl-morph] use')]"
    ".some((u) => getComputedStyle(u).visibility !== 'hidden')"
)


def ring(paths) -> str | None:
    d, rule = paths[0]
    if d.count("M") != 2 or rule != "evenodd":
        return f"ring: expected two outlines with evenodd, got {d.count('M')} outlines and fill-rule {rule}"
    return None


def curve(paths) -> str | None:
    if "Z" in paths[0][0]:
        return "open curve: the morph path is closed"
    return None


def check(page, url: str) -> list[str]:
    problems = []
    for start, test in ((1, ring), (3, curve)):
        page.goto(f"{url}?page={start}&freeze={MID}")
        page.keyboard.press("ArrowRight")
        paths = page.evaluate(OVERLAY_PATHS)
        problem = test(paths) if paths else f"page {start}: no morph path in the overlay"
        if problem:
            problems.append(problem)
    page.goto(f"{url}?page=5&freeze={MID}")
    page.keyboard.press("ArrowRight")
    if not page.evaluate(LABEL_VISIBLE):
        problems.append("label: the unchanged label is hidden during the morph")
    return problems


def main(deck: Path) -> int:
    url = deck.as_uri()
    failed = False
    with sync_playwright() as p:
        for name, launch in launchers(p):
            try:
                browser = launch()
            except Error as exc:
                print(f"{name:9s} skipped: {exc.message.splitlines()[0]}")
                continue
            problems = check(browser.new_page(), url)
            failed |= bool(problems)
            print(f"{name:9s} {problems or 'ok'}")
            browser.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]).resolve()))
