#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools==4.68.0", "brotli==1.2.1", "certifi"]
# ///
"""Rebuild the Ubuntu Mono symbols faces from Iosevka Fixed.

Edit VERSION, run `npm run vendor:iosevka`, and commit the result. The
script downloads the Iosevka Fixed release from GitHub and subsets its
regular and bold faces to the symbols that the Ubuntu Mono subsets lack.
It writes each subset and Iosevka's license to assets/unity/fonts/.
"""

import io
import shutil
import ssl
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import certifi
from fontTools import subset
from fontTools.ttLib import TTFont

VERSION = "34.9.0"
RELEASE = f"https://github.com/be5invis/Iosevka/releases/download/v{VERSION}/PkgTTF-IosevkaFixed-{VERSION}.zip"
LICENSE = f"https://raw.githubusercontent.com/be5invis/Iosevka/v{VERSION}/LICENSE.md"

FONTS = Path(__file__).resolve().parent.parent / "assets" / "unity" / "fonts"

# Each weight that Ubuntu Mono ships, with the Iosevka style that
# supplies its symbols.
WEIGHTS = {"400": "Regular", "700": "Bold"}

# Arrows, Box Drawing, Block Elements, and Geometric Shapes, minus U+2191
# and U+2193, which the Ubuntu Mono latin subset draws. The unicode-range
# of each symbols face in main.css repeats this list.
UNICODES = [c for c in (*range(0x2190, 0x2200), *range(0x2500, 0x2600)) if c not in (0x2191, 0x2193)]

# The vertical metrics that each subset copies from Ubuntu Mono, so a line
# that draws a symbol keeps the height that Ubuntu Mono gives it.
HHEA = ("ascent", "descent", "lineGap")
OS2 = ("sTypoAscender", "sTypoDescender", "sTypoLineGap", "usWinAscent", "usWinDescent")
USE_TYPO_METRICS = 1 << 7

# certifi's roots, because a Python that uv installs might not find the
# system's.
TLS = ssl.create_default_context(cafile=certifi.where())


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, context=TLS) as response:
        return response.read()


def build(source: TTFont, reference: TTFont, out: Path) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = []
    # Keep the copyright and license records that the OFL asks each copy
    # to carry.
    options.name_IDs = ["*"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(source)

    for name in HHEA:
        setattr(source["hhea"], name, getattr(reference["hhea"], name))
    for name in OS2:
        setattr(source["OS/2"], name, getattr(reference["OS/2"], name))
    source["OS/2"].fsSelection = (source["OS/2"].fsSelection & ~USE_TYPO_METRICS) | (
        reference["OS/2"].fsSelection & USE_TYPO_METRICS
    )

    advance = {reference["hmtx"][glyph][0] for glyph in reference.getBestCmap().values()}
    widths = {source["hmtx"][glyph][0] for glyph in source.getBestCmap().values()}
    if len(advance) != 1 or widths != advance:
        raise SystemExit(f"{out.name}: advances {sorted(widths)} differ from Ubuntu Mono's {sorted(advance)}")
    missing = sorted(set(UNICODES) - set(source.getBestCmap()))
    if missing:
        raise SystemExit(f"{out.name}: Iosevka Fixed lacks {', '.join(f'U+{c:04X}' for c in missing)}")

    subset.save_font(source, str(out), options)
    print(f"{out.name}: {len(UNICODES)} glyphs, {out.stat().st_size} bytes")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vendor-iosevka-") as work:
        archive = Path(work) / "iosevka.zip"
        print(f"downloading {RELEASE}")
        with urllib.request.urlopen(RELEASE, context=TLS) as response, archive.open("wb") as file:
            shutil.copyfileobj(response, file)
        with zipfile.ZipFile(archive) as release:
            members = {Path(name).name: name for name in release.namelist()}
            for weight, style in WEIGHTS.items():
                data = release.read(members[f"IosevkaFixed-{style}.ttf"])
                # Keep the release's timestamp, so two runs write the same bytes.
                source = TTFont(io.BytesIO(data), recalcTimestamp=False)
                reference = TTFont(FONTS / f"ubuntu-mono-{weight}-latin.woff2")
                build(source, reference, FONTS / f"iosevka-fixed-{weight}-symbols.woff2")

    (FONTS / "iosevka-LICENSE.md").write_bytes(fetch(LICENSE))


if __name__ == "__main__":
    main()
