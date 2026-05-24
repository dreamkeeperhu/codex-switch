#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
WINDOWS_DIR = ROOT / "windows"
ICO = WINDOWS_DIR / "CodexSwitch.ico"
TRAY = WINDOWS_DIR / "tray.png"


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


def save_icon() -> None:
    WINDOWS_DIR.mkdir(parents=True, exist_ok=True)
    base = draw_icon(1024)
    base.save(
        ICO,
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    base.resize((32, 32), Image.Resampling.LANCZOS).save(TRAY)


if __name__ == "__main__":
    save_icon()
    print(ICO)
