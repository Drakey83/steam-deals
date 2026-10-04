"""Generate build/icon.png and build/icon.ico for Steam Deals.

Procedural icon: rounded square with a deep-blue to teal-green diagonal gradient,
a soft top highlight, and a white percent mark. Rendered at 1024 px and downsampled
so every size in the .ico is crisp. Requires Pillow.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build"
OUT.mkdir(exist_ok=True)

S = 1024  # render size


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def diagonal_gradient(size, c_top_left, c_bottom_right):
    """Diagonal gradient built on a small canvas and upscaled (fast, smooth)."""
    n = 256
    px = []
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))
            px.append(lerp(c_top_left, c_bottom_right, t))
    g = Image.new("RGB", (n, n))
    g.putdata(px)
    return g.resize((size, size), Image.BICUBIC)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def render(size=S):
    base = diagonal_gradient(size, (18, 86, 190), (73, 196, 158))  # blue -> teal green
    base = base.convert("RGBA")

    # Soft highlight at the top for depth.
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.ellipse((-size * 0.2, -size * 0.55, size * 1.2, size * 0.55), fill=(255, 255, 255, 46))
    hl = hl.filter(ImageFilter.GaussianBlur(size * 0.08))
    base = Image.alpha_composite(base, hl)

    # Subtle vignette toward the bottom-right.
    vg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vg)
    vd.ellipse((size * 0.35, size * 0.35, size * 1.4, size * 1.4), fill=(0, 20, 50, 70))
    vg = vg.filter(ImageFilter.GaussianBlur(size * 0.12))
    base = Image.alpha_composite(base, vg)

    # Percent mark: two rings and a diagonal bar, with a soft drop shadow.
    mark = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    md = ImageDraw.Draw(mark)
    r = size * 0.125
    stroke = int(size * 0.075)
    c1 = (size * 0.335, size * 0.335)
    c2 = (size * 0.665, size * 0.665)
    for cx, cy in (c1, c2):
        md.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, 255), width=stroke)
    bar_w = int(size * 0.085)
    md.line((size * 0.715, size * 0.265, size * 0.285, size * 0.735), fill=(255, 255, 255, 255), width=bar_w)
    # round caps for the bar
    for cx, cy in ((size * 0.715, size * 0.265), (size * 0.285, size * 0.735)):
        md.ellipse((cx - bar_w / 2, cy - bar_w / 2, cx + bar_w / 2, cy + bar_w / 2), fill=(255, 255, 255, 255))

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow.paste((5, 20, 45, 110), (0, 0, size, size), mark.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.02))
    shadow = shadow.transform(shadow.size, Image.AFFINE, (1, 0, -size * 0.004, 0, 1, -size * 0.012))

    base = Image.alpha_composite(base, shadow)
    base = Image.alpha_composite(base, mark)

    # Clip to a rounded square.
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), rounded_mask(size, int(size * 0.225)))
    return out


def main():
    big = render(S)
    png512 = big.resize((512, 512), Image.LANCZOS)
    png512.save(OUT / "icon.png")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [big.resize((s, s), Image.LANCZOS) for s in sizes]
    frames[-1].save(OUT / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    print(f"wrote {OUT / 'icon.png'} and {OUT / 'icon.ico'} ({', '.join(map(str, sizes))})")


if __name__ == "__main__":
    main()
