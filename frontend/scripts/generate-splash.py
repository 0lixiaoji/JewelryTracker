"""Generate Android full-screen splash PNGs from source image.

The source image is composited onto a canvas matching common phone aspect ratios
(9:19.5 portrait, 19.5:9 landscape). The source image is scaled to fit within
the canvas while maintaining its aspect ratio, centered, with background color
filling any extra space — so the splash fills the entire screen seamlessly.

Used as android:windowBackground in a launch theme for true full-screen splash.
"""
import os
from PIL import Image

SOURCE = r"e:\ClaudeProject\JewelryTracker\3e7c0babb4a2f3b9f900ab9e3aca835b.jpg"
RES_DIR = r"e:\ClaudeProject\JewelryTracker\frontend\android\app\src\main\res"
BG_COLOR = (44, 36, 22)  # #2c2416 — dark warm brown

# Target screen aspect ratios (modern phones)
PORTRAIT_ASPECT = 9 / 19.5    # width / height ≈ 0.4615
LANDSCAPE_ASPECT = 19.5 / 9   # width / height ≈ 2.1667

# Android density buckets
DENSITIES = [
    ("mdpi",    1.0),
    ("hdpi",    1.5),
    ("xhdpi",   2.0),
    ("xxhdpi",  3.0),
    ("xxxhdpi", 4.0),
]

# Base portrait width (mdpi). Height is derived from target aspect ratio.
BASE_PORTRAIT_W = 360  # dp


def composite_image(src: Image.Image, canvas_w: int, canvas_h: int) -> Image.Image:
    """Place src centered on a BG_COLOR canvas, scaled to fit while keeping aspect ratio."""
    canvas = Image.new("RGB", (canvas_w, canvas_h), BG_COLOR)

    # Scale source to fit within canvas
    src_aspect = src.width / src.height
    canvas_aspect = canvas_w / canvas_h

    if src_aspect > canvas_aspect:
        # Source is wider — fit by width
        new_w = canvas_w
        new_h = int(canvas_w / src_aspect)
    else:
        # Source is taller — fit by height
        new_h = canvas_h
        new_w = int(canvas_h * src_aspect)

    scaled = src.resize((new_w, new_h), Image.LANCZOS)

    # Center on canvas
    x = (canvas_w - new_w) // 2
    y = (canvas_h - new_h) // 2
    canvas.paste(scaled, (x, y))
    return canvas


def main():
    src = Image.open(SOURCE).convert("RGB")
    src_aspect = src.width / src.height
    print(f"Source: {src.width}x{src.height}, aspect: {src_aspect:.4f}")
    print(f"Target phone aspect — portrait: {PORTRAIT_ASPECT:.4f}, landscape: {LANDSCAPE_ASPECT:.4f}")

    for suffix, scale in DENSITIES:
        # Portrait — canvas matches phone screen aspect ratio
        pw = int(BASE_PORTRAIT_W * scale)
        ph = int(pw / PORTRAIT_ASPECT)
        port_img = composite_image(src, pw, ph)
        port_dir = os.path.join(RES_DIR, f"drawable-port-{suffix}")
        port_path = os.path.join(port_dir, "splash.png")
        port_img.save(port_path, "PNG")
        print(f"  {port_path} ({pw}x{ph})")

        # Landscape — canvas matches phone screen aspect ratio
        lh = int(BASE_PORTRAIT_W * scale)
        lw = int(lh * LANDSCAPE_ASPECT)
        land_img = composite_image(src, lw, lh)
        land_dir = os.path.join(RES_DIR, f"drawable-land-{suffix}")
        land_path = os.path.join(land_dir, "splash.png")
        land_img.save(land_path, "PNG")
        print(f"  {land_path} ({lw}x{lh})")

    # Default drawable/splash.png (use xxxhdpi portrait)
    default_path = os.path.join(RES_DIR, "drawable", "splash.png")
    xxxhdpi_w = int(BASE_PORTRAIT_W * 4)
    xxxhdpi_h = int(xxxhdpi_w / PORTRAIT_ASPECT)
    default_img = composite_image(src, xxxhdpi_w, xxxhdpi_h)
    default_img.save(default_path, "PNG")
    print(f"  {default_path} ({xxxhdpi_w}x{xxxhdpi_h})")

    print("\nDone! All splash.png files generated (phone aspect ratio, full-screen).")


if __name__ == "__main__":
    main()
