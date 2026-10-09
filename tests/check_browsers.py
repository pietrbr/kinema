"""Step through a built deck in several browser engines; report errors and save mid-transition screenshots.

Usage: uv run --no-project --with playwright python tests/check_browsers.py <deck.html> <out-dir>
"""

import sys
from pathlib import Path

from playwright.sync_api import Error, sync_playwright

BRAVE = Path("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser")
VIEWPORT = {"width": 1280, "height": 720}
MID = 0.5
STEP_TIMEOUT_MS = 5000
HIDDEN_IN_OVERLAY = (
    "[...document.querySelectorAll('#overlay *')]"
    ".filter((e) => getComputedStyle(e).visibility === 'hidden').length"
)


def launchers(p):
    yield "chromium", lambda: p.chromium.launch()
    yield "chrome", lambda: p.chromium.launch(channel="chrome")
    if BRAVE.exists():
        yield "brave", lambda: p.chromium.launch(executable_path=str(BRAVE))
    yield "firefox", lambda: p.firefox.launch()
    yield "webkit", lambda: p.webkit.launch()


def walk(page, url: str, count: int) -> list[int]:
    page.goto(f"{url}?speed=0.3")
    ends = []
    for key in ("ArrowRight", "ArrowLeft"):
        for _ in range(count - 1):
            page.keyboard.press(key)
            page.wait_for_function("!window.zlides.busy", timeout=STEP_TIMEOUT_MS)
        ends.append(page.evaluate("window.zlides.page"))
    return ends


def main(deck: Path, out: Path) -> int:
    out.mkdir(parents=True, exist_ok=True)
    url = deck.as_uri()
    failed = False
    with sync_playwright() as p:
        for name, launch in launchers(p):
            try:
                browser = launch()
            except Error as exc:
                print(f"{name:9s} skipped: {exc.message.splitlines()[0]}")
                continue
            errors = []
            page = browser.new_page(viewport=VIEWPORT)
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(url)
            count = page.evaluate("document.querySelectorAll('.page').length")
            for start in range(1, count):
                page.goto(f"{url}?page={start}&freeze={MID}")
                page.keyboard.press("ArrowRight")
                page.screenshot(path=out / f"{name}-{start:02d}to{start + 1:02d}.png")
                if page.evaluate(HIDDEN_IN_OVERLAY):
                    errors.append(f"hidden overlay element in transition {start}->{start + 1}")
            try:
                ends = walk(page, url, count)
                page.keyboard.press("?")
                if not page.is_visible("#help"):
                    errors.append("help overlay did not open")
                page.keyboard.press("Escape")
                if page.is_visible("#help"):
                    errors.append("help overlay did not close")
            except Error as exc:
                ends = []
                errors.append(f"navigation stopped: {exc.message.splitlines()[0]}")
            ok = ends == [count, 1] and not errors
            failed |= not ok
            print(f"{name:9s} {browser.version:16s} pages={count} ends={ends} errors={errors}")
            browser.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()))
