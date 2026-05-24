#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICONSET = ROOT / "macos" / "CodexSwitch.iconset"
ICNS = ROOT / "macos" / "CodexSwitch.icns"
PREVIEW = ROOT / "macos" / "CodexSwitch-preview.png"


def u(value: float, scale: float) -> int:
    return round(value * scale)


def draw_icon(size: int) -> Image.Image:
    scale = size / 1024
    black = (0, 0, 0, 255)
    white = (255, 255, 255, 255)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    margin = u(82, scale)
    radius = u(205, scale)
    stroke = max(2, u(28, scale))
    draw.rounded_rectangle(
        (margin, margin, size - margin, size - margin),
        radius=radius,
        fill=white,
        outline=black,
        width=stroke,
    )

    body = (u(272, scale), u(458, scale), u(746, scale), u(728, scale))
    draw.rounded_rectangle(
        body,
        radius=u(76, scale),
        outline=black,
        width=max(8, u(56, scale)),
    )

    shackle_width = max(8, u(58, scale))
    shackle = [
        (u(396, scale), u(468, scale)),
        (u(396, scale), u(332, scale)),
        (u(438, scale), u(232, scale)),
        (u(570, scale), u(232, scale)),
        (u(628, scale), u(334, scale)),
    ]
    draw.line(shackle, fill=black, width=shackle_width, joint="curve")
    radius_cap = shackle_width // 2
    for x, y in shackle:
        draw.ellipse((x - radius_cap, y - radius_cap, x + radius_cap, y + radius_cap), fill=black)

    draw.ellipse(
        (u(478, scale), u(552, scale), u(546, scale), u(620, scale)),
        fill=black,
    )
    draw.rounded_rectangle(
        (u(498, scale), u(602, scale), u(526, scale), u(678, scale)),
        radius=u(14, scale),
        fill=black,
    )

    return canvas


def save_iconset() -> None:
    if ICONSET.exists():
        shutil.rmtree(ICONSET)
    ICONSET.mkdir(parents=True)

    base = draw_icon(1024)
    base.save(PREVIEW)
    sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for target_size, filename in sizes:
        base.resize((target_size, target_size), Image.Resampling.LANCZOS).save(ICONSET / filename)
    subprocess.run(["iconutil", "-c", "icns", str(ICONSET), "-o", str(ICNS)], check=True)


if __name__ == "__main__":
    try:
        save_iconset()
    except Exception as exc:
        print(f"failed to build icon: {exc}", file=sys.stderr)
        sys.exit(1)
    print(ICNS)
