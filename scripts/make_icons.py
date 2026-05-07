#!/usr/bin/env python3
"""Generate Longshot PWA icons.

Visual: warm cream background, three stacked rectangles (a stitched stack),
with a small connecting "thread" between them, in the brand orange.
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "images"
OUT.mkdir(parents=True, exist_ok=True)

# Brand
BG       = (255, 248, 238)   # cream
ACCENT   = (255, 138, 43)    # orange
ACCENT_D = (216, 106, 15)    # deep orange
INK      = (31, 26, 20)


def draw_logo(size: int, maskable: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG + (255,))
    d   = ImageDraw.Draw(img)

    # Maskable icons need their content inside ~80% safe zone
    pad = int(size * 0.18) if maskable else int(size * 0.14)
    inner = size - 2 * pad

    # Three stacked sheets (looks like a stitched-together long screenshot)
    sheet_w   = int(inner * 0.62)
    sheet_x   = pad + (inner - sheet_w) // 2
    gap       = int(inner * 0.04)
    sheet_h   = (inner - 2 * gap) // 3
    radius    = int(sheet_h * 0.18)

    # Bottom-most darker, top brightest — gives depth
    sheets = [
        (sheet_x, pad,                              ACCENT,    INK),
        (sheet_x, pad + sheet_h + gap,              ACCENT,    INK),
        (sheet_x, pad + 2 * (sheet_h + gap),        ACCENT,    INK),
    ]
    for (x, y, fill, _) in sheets:
        d.rounded_rectangle(
            (x, y, x + sheet_w, y + sheet_h),
            radius=radius,
            fill=fill,
        )

    # Inner content lines on each sheet — shows "long page"
    line_color = (255, 255, 255, 200)
    for (x, y, _, _) in sheets:
        for row in range(3):
            ly = y + int(sheet_h * 0.25) + row * int(sheet_h * 0.22)
            lx1 = x + int(sheet_w * 0.16)
            lx2 = x + sheet_w - int(sheet_w * 0.16)
            line_h = max(2, int(sheet_h * 0.06))
            d.rounded_rectangle((lx1, ly, lx2, ly + line_h),
                                radius=line_h // 2, fill=line_color)

    # "Stitch" thread between sheets — small dashes connecting them
    for i in range(2):
        y_top = pad + (i + 1) * sheet_h + i * gap
        cx = sheet_x + sheet_w // 2
        for k in range(3):
            yy = y_top - 1 + k * (gap // 3 + 1)
            dot = max(2, int(size * 0.012))
            d.ellipse((cx - dot, yy - dot, cx + dot, yy + dot), fill=ACCENT_D)

    return img


def save_png(img: Image.Image, name: str):
    p = OUT / name
    img.save(p, "PNG", optimize=True)
    print(f"  wrote {p.relative_to(OUT.parent)}")


def main():
    print("Rendering Longshot icons →", OUT)

    sizes = {
        "icon-192.png": 192,
        "icon-512.png": 512,
        "apple-touch-icon.png": 180,
        "favicon.png": 64,
    }
    for name, size in sizes.items():
        save_png(draw_logo(size), name)

    # Maskable icon (Android adaptive)
    save_png(draw_logo(512, maskable=True), "icon-maskable.png")
    print("Done.")


if __name__ == "__main__":
    main()
