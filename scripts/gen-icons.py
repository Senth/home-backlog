#!/usr/bin/env python3
"""Regenerates the app icon SVG and every rasterized icon target.

Run from the repo root: `yarn icons` (needs rsvg-convert).

The mark is a house whose interior is a three-column kanban board — the app's
actual differentiator, and legible down to 32px because it is four shapes and
six bars, nothing finer.

Every target is drawn from the same geometry with three colours swapped:

    tile        green square, white house, white cards   (app + PWA icons)
    foreground  transparent, white house, white cards    (Android adaptive)
    monochrome  transparent, white house, white cards    (Android themed)

For the adaptive and themed variants the columns are cut out rather than
painted, so the launcher's own background shows through them exactly where the
green would have been.
"""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / ".tmp/icons"

# Must match `primary` in theme/index.ts and `theme_color` in the manifest.
GREEN = "#2E7D32"
WHITE = "#FFFFFF"
NONE = "none"

# --- geometry, designed in a 1024x1024 box ----------------------------------
SIZE = 1024

TILE_RADIUS = 180.0  # iOS-ish squircle approximation for the standalone tile

ROOF_APEX = (512.0, 132.0)
ROOF_LEFT = (118.0, 486.0)
ROOF_RIGHT = (906.0, 486.0)

BODY_X0, BODY_X1 = 186.0, 838.0
BODY_Y0, BODY_Y1 = 446.0, 906.0
BODY_RADIUS = 32.0

COLUMNS = 3
COL_X0, COL_X1 = 236.0, 788.0
COL_Y0, COL_Y1 = 516.0, 856.0
COL_GAP = 30.0
COL_RADIUS = 18.0

CARD_INSET = 20.0
CARD_HEIGHT = 54.0
CARD_GAP = 22.0
CARD_RADIUS = 13.0
CARD_COUNTS = (3, 2, 1)


def rect(x, y, w, h, r, fill):
    return (
        f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" '
        f'rx="{r:.2f}" ry="{r:.2f}" fill="{fill}"/>'
    )


def house(ink):
    """Roof triangle plus body, as one filled path."""
    ax, ay = ROOF_APEX
    lx, ly = ROOF_LEFT
    rx, ry = ROOF_RIGHT
    roof = (
        f'<path d="M {ax:.1f},{ay:.1f} L {rx:.1f},{ry:.1f} '
        f'L {lx:.1f},{ly:.1f} Z" fill="{ink}"/>'
    )
    body = rect(
        BODY_X0,
        BODY_Y0,
        BODY_X1 - BODY_X0,
        BODY_Y1 - BODY_Y0,
        BODY_RADIUS,
        ink,
    )
    return roof + body


def column_geometry():
    total = COL_X1 - COL_X0
    col_w = (total - COL_GAP * (COLUMNS - 1)) / COLUMNS
    for index in range(COLUMNS):
        yield COL_X0 + index * (col_w + COL_GAP), col_w


def columns(fill):
    """The three board columns, as holes or as painted shapes."""
    col_h = COL_Y1 - COL_Y0
    return "".join(
        rect(col_x, COL_Y0, col_w, col_h, COL_RADIUS, fill)
        for col_x, col_w in column_geometry()
    )


def cards(ink):
    """The bars inside each column: a backlog draining into a single done card."""
    parts = []
    for index, (col_x, col_w) in enumerate(column_geometry()):
        card_y = COL_Y0 + CARD_INSET
        for _ in range(CARD_COUNTS[index]):
            parts.append(
                rect(
                    col_x + CARD_INSET,
                    card_y,
                    col_w - CARD_INSET * 2,
                    CARD_HEIGHT,
                    CARD_RADIUS,
                    ink,
                )
            )
            card_y += CARD_HEIGHT + CARD_GAP
    return "".join(parts)


def svg(background, ink, *, radius=TILE_RADIUS, scale=1.0):
    """One icon. `scale` shrinks the art around the centre for safe zones.

    The columns are always *cut out* of the house rather than painted over it.
    On the tile that reveals the green square underneath; on the transparent
    adaptive foreground it reveals whatever the launcher paints, which app.json
    sets to the same green. One geometry, both results.
    """
    mask = (
        '<mask id="columns" maskUnits="userSpaceOnUse" '
        f'x="0" y="0" width="{SIZE}" height="{SIZE}">'
        + rect(0, 0, SIZE, SIZE, 0, WHITE)
        + columns("#000000")
        + "</mask>"
    )

    art = f'<g mask="url(#columns)">{house(ink)}</g>{cards(ink)}'
    if scale != 1.0:
        offset = SIZE / 2 * (1 - scale)
        art = (
            f'<g transform="translate({offset:.2f},{offset:.2f}) '
            f'scale({scale:.4f})">{art}</g>'
        )

    layers = []
    if background != NONE:
        layers.append(rect(0, 0, SIZE, SIZE, radius, background))
    layers.append(art)

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" '
        f'height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">'
        + f"<defs>{mask}</defs>"
        + "".join(layers)
        + "</svg>"
    )


def render(name, markup, targets):
    BUILD.mkdir(parents=True, exist_ok=True)
    source = BUILD / f"{name}.svg"
    source.write_text(markup, encoding="utf-8")

    for path, size in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "rsvg-convert",
                "--width", str(size),
                "--height", str(size),
                "--output", str(path),
                str(source),
            ],
            check=True,
        )
        print(f"  {path.relative_to(ROOT)}  {size}x{size}")


def main():
    assets = ROOT / "assets/images"
    icons = ROOT / "public/icons"

    # The rounded tile: app icon, favicon, splash mark, and the PWA "any" icons.
    tile = svg(GREEN, WHITE)
    (assets / "icon.svg").parent.mkdir(parents=True, exist_ok=True)
    (assets / "icon.svg").write_text(tile, encoding="utf-8")
    print("tile")
    render(
        "tile",
        tile,
        [
            (assets / "icon.png", 1024),
            (assets / "splash-icon.png", 512),
            (assets / "favicon.png", 48),
            (icons / "icon-192.png", 192),
            (icons / "icon-512.png", 512),
        ],
    )

    # Maskable: full bleed, art inside the 80% safe circle so any mask can crop.
    print("maskable")
    render(
        "maskable",
        svg(GREEN, WHITE, radius=0.0, scale=0.78),
        [
            (icons / "maskable-192.png", 192),
            (icons / "maskable-512.png", 512),
        ],
    )

    # Android adaptive foreground: no background of its own — app.json paints it
    # green — and the art lives inside the 66% safe zone the launcher may crop.
    print("adaptive")
    foreground = svg(NONE, WHITE, scale=0.66)
    render("foreground", foreground, [(assets / "android-icon-foreground.png", 1024)])
    render("monochrome", foreground, [(assets / "android-icon-monochrome.png", 1024)])


if __name__ == "__main__":
    main()
