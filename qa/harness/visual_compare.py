#!/usr/bin/env python3
"""Strict PNG comparison for AlphaDesk visual regression checks.

The Node harness captures deterministic screenshots; this helper keeps the
pixel math dependency-free for Node by using Pillow, which is already present in
the Codex workspace runtime.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--diff", required=True)
    parser.add_argument("--pixel-threshold", type=int, default=1)
    parser.add_argument("--max-changed-ratio", type=float, default=0.0001)
    parser.add_argument("--max-mean-delta", type=float, default=0.03)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    baseline_path = Path(args.baseline)
    current_path = Path(args.current)
    diff_path = Path(args.diff)

    baseline = Image.open(baseline_path).convert("RGBA")
    current = Image.open(current_path).convert("RGBA")

    if baseline.size != current.size:
        result = {
            "pass": False,
            "reason": "dimension-mismatch",
            "baselineSize": baseline.size,
            "currentSize": current.size,
            "baseline": str(baseline_path),
            "current": str(current_path),
        }
        print(json.dumps(result))
        return 1

    width, height = baseline.size
    total_pixels = width * height
    changed_pixels = 0
    total_delta = 0
    max_delta = 0

    diff = Image.new("RGBA", baseline.size, (0, 0, 0, 0))
    baseline_px = baseline.load()
    current_px = current.load()
    diff_px = diff.load()

    for y in range(height):
        for x in range(width):
            a = baseline_px[x, y]
            b = current_px[x, y]
            channel_deltas = [abs(a[i] - b[i]) for i in range(4)]
            pixel_delta = max(channel_deltas)
            total_delta += sum(channel_deltas[:3])
            max_delta = max(max_delta, pixel_delta)
            if pixel_delta > args.pixel_threshold:
                changed_pixels += 1
                diff_px[x, y] = (255, 48, 48, 210)

    changed_ratio = changed_pixels / total_pixels if total_pixels else 0
    mean_delta = total_delta / (total_pixels * 3) if total_pixels else 0
    passed = (
        changed_ratio <= args.max_changed_ratio
        and mean_delta <= args.max_mean_delta
    )

    diff_path.parent.mkdir(parents=True, exist_ok=True)
    if changed_pixels:
        diff.save(diff_path)

    result = {
        "pass": passed,
        "changedPixels": changed_pixels,
        "totalPixels": total_pixels,
        "changedRatio": changed_ratio,
        "meanDelta": mean_delta,
        "maxDelta": max_delta,
        "pixelThreshold": args.pixel_threshold,
        "maxChangedRatio": args.max_changed_ratio,
        "maxMeanDelta": args.max_mean_delta,
        "baseline": str(baseline_path),
        "current": str(current_path),
        "diff": str(diff_path) if changed_pixels else None,
    }
    print(json.dumps(result))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
