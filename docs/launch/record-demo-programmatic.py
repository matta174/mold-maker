"""
Drive the live mold-maker app via Playwright and record a WebM of a complete
demo flow — loading the sample, sweeping the parting plane slider, tilting
the cut angle, generating a mold, switching envelope shapes. The resulting
WebM is fed through record-demo.sh for palette-optimized GIF/MP4 output.

Why programmatic: reproducibility. A human screen recording drifts every
time you re-record; this script produces the same demo every run, so you
can regenerate the README GIF against a new UI/build without re-planning
the capture.

Setup (one time, Linux or WSL):
    pip install playwright
    python3 -m playwright install chromium

Run:
    python3 docs/launch/record-demo-programmatic.py
    # Raw WebM lands at /tmp/demo_capture/*.webm
    bash docs/launch/record-demo.sh /tmp/demo_capture/*.webm docs/demo.gif --width 900 --fps 18
    bash docs/launch/record-demo.sh /tmp/demo_capture/*.webm docs/demo.mp4 --width 1080 --fps 24 --mp4

Notes:
- Uses `--use-gl=swiftshader` so WebGL renders on CPU — works on headless
  CI boxes with no GPU. Rendering quality is fine for a demo; for a polished
  launch-day recording, do it on a real machine with GPU acceleration.
- Slider interactions use React's own value setter + synthetic input/change
  events. A plain DOM `click()` or `.value = ...` assignment does NOT fire
  React's onChange handlers.
- Native Playwright `.click(force=True)` on button ElementHandles fires real
  pointer events, which React *does* respect.
- End of the video may have an extra second or two of idle; trim with
  `ffmpeg -ss 1.5 -t 22 ... -c copy trimmed.webm` before passing to
  record-demo.sh.
"""
from pathlib import Path
import time
from playwright.sync_api import sync_playwright

OUT_DIR = Path("/tmp/demo_capture")
OUT_DIR.mkdir(parents=True, exist_ok=True)
for p in OUT_DIR.glob("*.webm"):
    p.unlink()

URL = "https://matta174.github.io/mold-maker/"
VIEWPORT = {"width": 1280, "height": 720}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")


def set_slider(page, aria_label: str, value: float):
    """Set a range input via React-aware value setter + input/change events.
    React monkey-patches the native value setter; to notify React, we have
    to call the PROTOTYPE setter and then dispatch events."""
    page.evaluate(
        """(args) => {
            const el = document.querySelector('input[aria-label="' + args.label + '"]');
            if (!el) throw new Error('slider not found: ' + args.label);
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            ).set;
            setter.call(el, String(args.value));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        {"label": aria_label, "value": value},
    )


def animate_slider(page, aria_label: str, start: float, end: float, steps: int = 12, step_ms: int = 70):
    """Move a slider smoothly from start to end, one React-triggered step at
    a time, so each intermediate value is actually rendered in the video."""
    for i in range(1, steps + 1):
        t = start + (end - start) * (i / steps)
        set_slider(page, aria_label, t)
        page.wait_for_timeout(step_ms)


def click_button_by_text(page, text: str, timeout_ms: int = 5000):
    """Click the first <button> whose trimmed text matches exactly. Uses
    Playwright's real pointer click so React synthetic events fire."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        handle = page.evaluate_handle(
            """(txt) => {
                const btn = [...document.querySelectorAll('button')]
                    .find(b => b.textContent.trim() === txt);
                return btn || null;
            }""",
            text,
        )
        element = handle.as_element()
        if element is not None:
            element.click(force=True)
            return True
        page.wait_for_timeout(200)
    raise TimeoutError(f"button not found: {text!r}")


def main():
    video_path = None
    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--use-gl=swiftshader", "--enable-webgl"]
        )
        context = browser.new_context(
            viewport=VIEWPORT,
            record_video_dir=str(OUT_DIR),
            record_video_size=VIEWPORT,
        )
        page = context.new_page()

        try:
            log(f"navigating to {URL}")
            page.goto(URL, wait_until="networkidle", timeout=45000)
            page.wait_for_timeout(1500)

            log("clicking 'Try Sample'")
            click_button_by_text(page, "Try Sample")
            # Model load + three.js viewport init
            page.wait_for_timeout(3500)

            log("sweeping plane position 0.5 -> 0.75 -> 0.35 -> 0.5")
            animate_slider(page, "Plane position", 0.5, 0.75, steps=12, step_ms=80)
            page.wait_for_timeout(400)
            animate_slider(page, "Plane position", 0.75, 0.35, steps=16, step_ms=70)
            page.wait_for_timeout(400)
            animate_slider(page, "Plane position", 0.35, 0.5, steps=10, step_ms=70)
            page.wait_for_timeout(500)

            log("tilting cut angle 0 -> 18°")
            animate_slider(page, "Cut angle in degrees", 0, 18, steps=14, step_ms=90)
            page.wait_for_timeout(900)

            log("clicking Generate Mold (1st)")
            click_button_by_text(page, "Generate Mold")
            # Let CSG worker complete + viewport update
            page.wait_for_timeout(5000)

            log("switching envelope shape to Rounded")
            click_button_by_text(page, "Rounded")
            page.wait_for_timeout(700)

            # After first generate the button may have renamed; try both
            log("regenerating with rounded envelope")
            try:
                click_button_by_text(page, "Generate Mold", timeout_ms=2000)
            except TimeoutError:
                try:
                    click_button_by_text(page, "Regenerate", timeout_ms=2000)
                except TimeoutError:
                    log("  no regenerate button visible; continuing")
            page.wait_for_timeout(4500)

            log("recording complete")
        finally:
            context.close()
            browser.close()

    videos = sorted(OUT_DIR.glob("*.webm"), key=lambda p: p.stat().st_mtime, reverse=True)
    if videos:
        video_path = videos[0]
        log(f"video written: {video_path} ({video_path.stat().st_size / 1024:.1f} KB)")
        print(str(video_path))
    else:
        log("NO VIDEO FOUND")


if __name__ == "__main__":
    main()
