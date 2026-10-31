#!/usr/bin/env python3
"""Extract the user's existing colored segmentation into static SVG paths.

No model, inference, download, or remote API is used. See
public/photos/segments-SOURCES.txt for the supplied image and reproduction setup.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_SIZE = (1920, 1080)
OUTPUT_SIZE = (1408, 792)
SCALE = OUTPUT_SIZE[0] / SOURCE_SIZE[0]
SUBJECTS = (
    {"id": "kien", "label": "Kien", "color": (220, 134, 255), "seed": (450, 540)},
    {"id": "bluejay", "label": "Blue Jay", "color": (215, 66, 18), "seed": (1020, 520)},
)


def extract_mask(source, subject):
    # These exact, flat RGB values are the supplied PNG's outline strokes, not
    # colors inferred from the person, mascot, or underlying photograph.
    outline = np.all(source == subject["color"], axis=2).astype(np.uint8)
    if not outline.any():
        raise ValueError(f"Missing supplied {subject['id']} outline color")
    filled = outline.copy()
    x, y = subject["seed"]
    if filled[y, x]:
        raise ValueError(f"Interior seed intersects {subject['id']} outline")
    cv2.floodFill(filled, None, (x, y), 2)
    # The image frame closes the outline where each subject leaves the photo.
    # Include the painted boundary itself, including its frame-edge fragments.
    return (filled == 2) | (outline != 0)


def coordinate(value):
    return f"{value:.2f}".rstrip("0").rstrip(".")


def contour_path(mask):
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    paths = []
    for contour in contours:
        points = contour.astype(np.float32) * SCALE
        # Retain holes with evenodd SVG filling; simplify by at most 0.65 pixels
        # in the final 1408x792 coordinate space, not a percentage of perimeter.
        points = cv2.approxPolyDP(points, 0.65, True).reshape(-1, 2)
        if len(points) < 3:
            continue
        points[points[:, 0] >= (SOURCE_SIZE[0] - 1) * SCALE, 0] = OUTPUT_SIZE[0]
        points[points[:, 1] >= (SOURCE_SIZE[1] - 1) * SCALE, 1] = OUTPUT_SIZE[1]
        paths.append("M" + "L".join(f"{coordinate(x)} {coordinate(y)}" for x, y in points) + "Z")
    return "".join(paths)


def describe_subject(subject, mask):
    ys, xs = np.nonzero(mask)
    x, y = int(xs.min()), int(ys.min())
    right, bottom = int(xs.max()) + 1, int(ys.max()) + 1
    head_x = float(np.median(xs[ys <= y + 6]))
    return {
        "id": subject["id"],
        "label": subject["label"],
        "path": contour_path(mask),
        "bounds": {
            "x": round(x * SCALE, 2),
            "y": round(y * SCALE, 2),
            "width": round((right - x) * SCALE, 2),
            "height": round((bottom - y) * SCALE, 2),
        },
        "anchor": {"x": round(head_x * SCALE, 2), "y": round(y * SCALE, 2)},
    }


def write_previews(directory, photo, source, masks):
    directory.mkdir(parents=True, exist_ok=True)
    overlay = photo.astype(np.float32) * 0.6
    for subject, mask in zip(SUBJECTS, masks):
        identity = subject["id"]
        Image.fromarray(mask.astype(np.uint8) * 255).save(directory / f"{identity}-source-mask.png")
        source_preview = source.copy()
        source_preview[~mask] //= 3
        Image.fromarray(source_preview).save(directory / f"{identity}-source-extraction.png")
        scaled = cv2.resize(mask.astype(np.uint8), OUTPUT_SIZE, interpolation=cv2.INTER_NEAREST).astype(bool)
        Image.fromarray(scaled.astype(np.uint8) * 255).save(directory / f"{identity}-mask.png")
        Image.fromarray(np.dstack((photo, scaled.astype(np.uint8) * 255))).save(directory / f"{identity}-cutout.png")
        overlay[scaled] = photo[scaled] * 0.62 + np.asarray(subject["color"]) * 0.38
        contours, _ = cv2.findContours(scaled.astype(np.uint8), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(overlay, contours, -1, subject["color"], 1)
    Image.fromarray(np.clip(overlay, 0, 255).astype(np.uint8)).save(directory / "subjects-overlay.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Local user-supplied sam_1463556455893292.png")
    parser.add_argument("--output", type=Path, default=ROOT / "src/data/photo-segments.json")
    parser.add_argument("--preview-dir", type=Path, help="Optional local preview destination, e.g. /tmp/photo-segments")
    args = parser.parse_args()
    source = np.array(Image.open(args.input).convert("RGB"))
    if (source.shape[1], source.shape[0]) != SOURCE_SIZE:
        parser.error("The supplied segmentation must be the original 1920x1080 PNG")
    masks = [extract_mask(source, subject) for subject in SUBJECTS]
    if np.any(masks[0] & masks[1]):
        parser.error("The supplied subject outlines must enclose distinct nonoverlapping regions")
    subjects = [describe_subject(subject, mask) for subject, mask in zip(SUBJECTS, masks)]
    data = {"width": OUTPUT_SIZE[0], "height": OUTPUT_SIZE[1], "subjects": subjects}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    if args.preview_dir:
        photo = np.array(Image.open(ROOT / "public/photos/campus-1408.webp").convert("RGB"))
        write_previews(args.preview_dir, photo, source, masks)
    for subject in subjects:
        print(f"{subject['id']}: supplied contour bounds {subject['bounds']}, anchor {subject['anchor']}")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
