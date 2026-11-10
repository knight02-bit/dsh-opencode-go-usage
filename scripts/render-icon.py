"""Render assets/icon-180.png (a 180x180 raster twin of icon.svg).

The storefront tile in awesome-dsh-plugin only accepts GitHub-hosted raster
images, so the plugin needs a PNG next to the SVG it ships for the DSH slot.
Geometry mirrors icon.svg (64x64 viewBox) scaled to 180px, drawn at 4x and
downsampled so the arcs stay smooth.
"""

from pathlib import Path

from PIL import Image, ImageDraw

S = 180
SS = 4  # supersample factor
U = S * SS / 64  # svg unit -> device px

SLATE_900 = (15, 23, 42, 255)
SLATE_800 = (30, 41, 59, 255)
SLATE_700 = (51, 65, 85, 255)
SLATE_200 = (226, 232, 240, 255)
SKY = (56, 189, 248, 255)
CYAN = (34, 211, 238, 255)


def px(v: float) -> float:
    return v * U


def main() -> None:
    canvas = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # rounded background: x=2 y=2 w=60 h=60 rx=16
    draw.rounded_rectangle(
        [px(2), px(2), px(62), px(62)], radius=px(16), fill=SLATE_900
    )

    cx, cy, r = px(32), px(40), px(18)
    box = [cx - r, cy - r, cx + r, cy + r]
    stroke = px(7)

    def arc(start: float, end: float, color) -> None:
        draw.arc(box, start=start, end=end, fill=color, width=round(stroke))

    def cap(angle_deg: float, color) -> None:
        import math

        a = math.radians(angle_deg)
        x = cx + r * math.cos(a)
        y = cy + r * math.sin(a)
        half = stroke / 2
        draw.ellipse([x - half, y - half, x + half, y + half], fill=color)

    # track: the whole top half, 180deg -> 360deg
    arc(180, 360, SLATE_800)
    for angle in (180.0, 360.0):
        cap(angle, SLATE_800)

    # used segments, endpoints taken from the svg paths. The two colours are
    # painted as one capped run plus an uncapped overlay, so the seam between
    # them does not grow a second round cap.
    used_left, used_mid, used_right = 180.0, 246.9, 291.8
    arc(used_left, used_right, SKY)
    for angle in (used_left, used_right):
        cap(angle, SKY)
    arc(used_mid, used_right, CYAN)
    cap(used_right, CYAN)

    # needle: from the hub to (41, 31)
    draw.line(
        [cx, cy, px(41), px(31)], fill=SLATE_200, width=round(px(3)), joint="curve"
    )
    hub = px(4)
    draw.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=SLATE_200)

    # baseline bar: x=18 y=47 w=28 h=4 rx=2
    draw.rounded_rectangle(
        [px(18), px(47), px(46), px(51)], radius=px(2), fill=SLATE_700
    )

    out = Path(__file__).resolve().parents[1] / "assets" / "icon-180.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.resize((S, S), Image.LANCZOS).save(out, optimize=True)
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
