"""Render the running PWA into a phone-shaped screenshot."""
from __future__ import annotations

import sys
import time

from playwright.sync_api import sync_playwright


def main(url: str, out_full: str, out_hero: str) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
        context = browser.new_context(
            viewport={"width": 412, "height": 915},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36",
        )
        page = context.new_page()
        page.goto(url, wait_until="networkidle")
        time.sleep(6)                             # let signals + charts refresh
        page.screenshot(path=out_full, full_page=True)
        # Hero: first ~915 px (viewport = above-the-fold)
        page.screenshot(path=out_hero, full_page=False)
        browser.close()
        print("saved", out_full, out_hero)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
