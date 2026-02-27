#!/usr/bin/env python3
"""Lightly decontaminate white fringing on semi-transparent sprite edges.

Usage:
  python3 scripts/assets/decontaminate-alpha.py --input assets/images
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Decontaminate white matte from RGBA sprite edges.")
    parser.add_argument("--input", default="assets/images", help="Input image directory.")
    parser.add_argument(
        "--pattern",
        default="*_*.webp",
        help="Glob pattern, default matches *_idle.webp and *_hit.webp with extra filtering.",
    )
    parser.add_argument(
        "--strength",
        type=float,
        default=0.35,
        help="Blend strength between original and decontaminated color [0..1].",
    )
    parser.add_argument(
        "--min-alpha",
        type=int,
        default=8,
        help="Minimum alpha value to process (0..255).",
    )
    parser.add_argument(
        "--max-alpha",
        type=int,
        default=252,
        help="Maximum alpha value to process (0..255).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print targets only, do not modify files.")
    return parser.parse_args()


def clamp_u8(value: float) -> int:
    if value < 0:
        return 0
    if value > 255:
        return 255
    return int(round(value))


def decontaminate_pixel(channel: int, alpha: int, strength: float) -> int:
    # Recover pre-multiplied contamination against white:
    # observed = alpha * true + (1 - alpha) * 255
    a = alpha / 255.0
    c = channel / 255.0
    recovered = (c - (1.0 - a)) / max(a, 1e-6)
    recovered = max(0.0, min(1.0, recovered))
    mixed = (1.0 - strength) * c + strength * recovered
    return clamp_u8(mixed * 255.0)


def process_image(path: Path, strength: float, min_alpha: int, max_alpha: int) -> tuple[int, int]:
    im = Image.open(path).convert("RGBA")
    pixels = im.load()
    width, height = im.size
    total = width * height
    touched = 0

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a <= min_alpha or a >= max_alpha:
                continue
            nr = decontaminate_pixel(r, a, strength)
            ng = decontaminate_pixel(g, a, strength)
            nb = decontaminate_pixel(b, a, strength)
            if (nr, ng, nb) != (r, g, b):
                pixels[x, y] = (nr, ng, nb, a)
                touched += 1

    im.save(path, format="WEBP", lossless=True, method=6)
    return touched, total


def main() -> int:
    args = parse_args()
    input_dir = Path(args.input)
    if not input_dir.exists() or not input_dir.is_dir():
        raise SystemExit(f"Input directory not found: {input_dir}")

    strength = max(0.0, min(1.0, float(args.strength)))
    min_alpha = max(0, min(255, int(args.min_alpha)))
    max_alpha = max(0, min(255, int(args.max_alpha)))
    if min_alpha >= max_alpha:
        raise SystemExit("--min-alpha must be lower than --max-alpha")

    all_candidates = sorted(input_dir.glob(args.pattern))
    targets = [p for p in all_candidates if p.name.endswith("_idle.webp") or p.name.endswith("_hit.webp")]
    if not targets:
        print("No matching files.")
        return 0

    backup_dir = input_dir / "_backup_before_decontaminate"
    print(f"Targets: {len(targets)}")
    print(f"Strength: {strength:.2f}, alpha window: ({min_alpha}, {max_alpha})")
    if args.dry_run:
        for p in targets:
            print(f"[dry-run] {p}")
        return 0

    backup_dir.mkdir(parents=True, exist_ok=True)
    for path in targets:
        backup_path = backup_dir / path.name
        if not backup_path.exists():
            shutil.copy2(path, backup_path)

    changed_files = 0
    for path in targets:
        touched, total = process_image(path, strength, min_alpha, max_alpha)
        changed_files += 1
        print(f"{path.name}: touched={touched}/{total}")

    print(f"Processed files: {changed_files}")
    print(f"Backup: {backup_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
