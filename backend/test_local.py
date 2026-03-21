#!/usr/bin/env python3
"""
Try the ML stack on a file you drop in (or pass a path).

  cd backend && source .venv/bin/activate
  python test_local.py /path/to/photo.jpg
  python test_local.py /path/to/clips.mp4
  python test_local.py /path/to/clips.mp4 --heatmap
  python test_local.py /path/to/clips.mp4 --matrix --json heatmap_output/stats.json

With --heatmap: writes heatmap_lowest.png + heatmap_highest.png (video: min/max total density).

Optional: pretrained weights at ml/weights/csrnet_partA.pth or csrnet_partA.pth.tar
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

os.environ.setdefault("OMP_NUM_THREADS", "1")

import cv2
import numpy as np

# Run from backend/ so `ml` resolves
if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml.csrnet import CSRNet
from ml.pipeline import (
    GRID_COLS,
    GRID_ROWS,
    aggregate_density,
    build_grid,
    build_websocket_payload,
    compute_levels,
)


def _load_weights(model: CSRNet) -> None:
    root = os.path.dirname(os.path.abspath(__file__))
    weights_dir = os.path.join(root, "ml", "weights")
    candidates = (
        os.path.join(weights_dir, "csrnet_partA.pth"),
        os.path.join(weights_dir, "csrnet_partA.pth.tar"),
        os.path.join(weights_dir, "PartAmodel_best.pth.tar"),
    )
    for wpath in candidates:
        if os.path.isfile(wpath):
            model.load_weights(wpath)
            return
    print(
        f"(No weights at {candidates[0]} or {candidates[1]} — using random init; counts are not meaningful.)\n"
    )


def _colormap_id() -> int:
    """TURBO reads better than JET for low→high; fallback to JET on older OpenCV."""
    return getattr(cv2, "COLORMAP_TURBO", cv2.COLORMAP_JET)


def _density_to_colormap(density: np.ndarray, scale: str = "log") -> np.ndarray:
    """
    Map density → BGR heatmap. ``scale`` stretches low values so sparse crowds are visible:
    - ``log`` — log1p (default): good for wide dynamic range
    - ``sqrt`` — mild lift of low values
    - ``linear`` — raw density (peaks can wash out faint areas)
    """
    d = np.maximum(density.astype(np.float32), 0.0)
    if scale == "log":
        d = np.log1p(d)
    elif scale == "sqrt":
        d = np.sqrt(d)
    lo = float(np.percentile(d, 1.0))
    hi = float(np.percentile(d, 99.5))
    if hi <= lo:
        hi = lo + 1e-9
    d = np.clip((d - lo) / (hi - lo), 0, 1)
    u8 = (d * 255).astype(np.uint8)
    return cv2.applyColorMap(u8, _colormap_id())


def _embed_colorbar_panel(img: np.ndarray, scale: str) -> np.ndarray:
    """Append a strip under the image with gradient bar + labels (does not cover pixels)."""
    h, w = img.shape[:2]
    pad = 52
    out = np.zeros((h + pad, w, 3), dtype=np.uint8)
    out[:h, :w] = img
    out[h:, :] = (26, 28, 32)
    cmap = _colormap_id()
    bar_h = 18
    y0 = h + 10
    x0 = 14
    x1 = w - 14
    bar_w = max(8, x1 - x0)
    grad = np.linspace(0, 255, bar_w, dtype=np.uint8).reshape(1, -1)
    grad = np.repeat(grad, bar_h, axis=0)
    bar = cv2.applyColorMap(grad, cmap)
    out[y0 : y0 + bar_h, x0:x1] = bar
    cv2.rectangle(out, (x0, y0), (x1, y0 + bar_h), (180, 180, 190), 1, cv2.LINE_AA)
    font = cv2.FONT_HERSHEY_SIMPLEX
    tc = (235, 235, 240)
    cv2.putText(out, "low", (x0, y0 - 4), font, 0.42, tc, 1, cv2.LINE_AA)
    cv2.putText(out, "high", (x1 - 38, y0 - 4), font, 0.42, tc, 1, cv2.LINE_AA)
    cap = f"density color scale ({scale})"
    cv2.putText(out, cap, (x0, y0 + bar_h + 18), font, 0.42, (160, 165, 175), 1, cv2.LINE_AA)
    return out


def _draw_zone_grid(bgr: np.ndarray) -> np.ndarray:
    out = bgr.copy()
    h, w = out.shape[:2]
    for i in range(1, GRID_ROWS):
        y = int(i * h / GRID_ROWS)
        cv2.line(out, (0, y), (w, y), (255, 255, 255), 1, cv2.LINE_AA)
    for j in range(1, GRID_COLS):
        x = int(j * w / GRID_COLS)
        cv2.line(out, (x, 0), (x, h), (255, 255, 255), 1, cv2.LINE_AA)
    return out


def _label_top(bgr: np.ndarray, text: str) -> np.ndarray:
    out = bgr.copy()
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(out, text, (14, 36), font, 0.85, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(out, text, (14, 36), font, 0.85, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def save_heatmap_min_max_pair(
    bgr_lo: np.ndarray,
    density_lo: np.ndarray,
    bgr_hi: np.ndarray,
    density_hi: np.ndarray,
    out_dir: str,
    heat_scale: str = "log",
    colorbar: bool = True,
) -> tuple[str, str]:
    """
    Write exactly two PNGs:
      - heatmap_lowest.png — frame with minimum total density (sum of map)
      - heatmap_highest.png — frame with maximum total density

    Each: camera + heatmap blend, white zone grid, optional colorbar, title strip.
    For a single image input, both files use the same frame (min == max).
    """
    os.makedirs(out_dir, exist_ok=True)

    def _one(bgr: np.ndarray, d: np.ndarray, path: str, caption: str) -> None:
        heat_bgr = _density_to_colormap(d, scale=heat_scale)
        blend = cv2.addWeighted(bgr, 0.45, heat_bgr, 0.55, 0)
        zoned = _draw_zone_grid(blend)
        zoned = _label_top(zoned, caption)
        if colorbar:
            zoned = _embed_colorbar_panel(zoned, heat_scale)
        cv2.imwrite(path, zoned)

    p_lo = os.path.join(out_dir, "heatmap_lowest.png")
    p_hi = os.path.join(out_dir, "heatmap_highest.png")
    s_lo, s_hi = float(density_lo.sum()), float(density_hi.sum())
    _one(bgr_lo, density_lo, p_lo, f"Lowest density  (map sum = {s_lo:.1f})")
    _one(bgr_hi, density_hi, p_hi, f"Highest density  (map sum = {s_hi:.1f})")
    return p_lo, p_hi


_ROW_LETTERS = "ABCDEF"
_LEVEL_ABBR = {"safe": "S", "watch": "W", "warning": "Y", "critical": "C"}


def _cells_to_matrices(cells: list[dict]) -> dict[str, list]:
    """48 cells in row-major order (A1…A8, B1…)."""
    count = [[0.0] * GRID_COLS for _ in range(GRID_ROWS)]
    density_pct = [[0.0] * GRID_COLS for _ in range(GRID_ROWS)]
    growth = [[0.0] * GRID_COLS for _ in range(GRID_ROWS)]
    level = [[""] * GRID_COLS for _ in range(GRID_ROWS)]
    for i, c in enumerate(cells):
        r, col = divmod(i, GRID_COLS)
        count[r][col] = float(c["count"])
        density_pct[r][col] = float(c["density_pct"])
        growth[r][col] = float(c["growth_rate"])
        lvl = c.get("level", "safe")
        level[r][col] = _LEVEL_ABBR.get(lvl, "?")
    return {
        "count": count,
        "density_pct": density_pct,
        "growth_rate": growth,
        "level": level,
    }


def _print_matrix(title: str, rows: list[list], fmt: str) -> None:
    header = "    " + " ".join(f"{j+1:>7}" for j in range(GRID_COLS))
    print(f"\n{title}")
    print(header)
    for r in range(GRID_ROWS):
        line = f"{_ROW_LETTERS[r]}  " + " ".join(fmt.format(rows[r][c]) for c in range(GRID_COLS))
        print(line)


def print_zone_matrices(cells: list[dict]) -> None:
    m = _cells_to_matrices(cells)
    _print_matrix("count (sum of density in zone — model units)", m["count"], "{:7.1f}")
    _print_matrix("density_pct (count / capacity 80)", m["density_pct"], "{:7.3f}")
    _print_matrix("growth_rate", m["growth_rate"], "{:7.3f}")
    _print_matrix("level (S=safe W=watch Y=warning C=critical)", m["level"], "{:>7s}")


def export_zone_json(
    path: str,
    cells: list[dict],
    payload: dict,
    density: np.ndarray | None,
    frame_shape: tuple[int, int] | None,
) -> None:
    mats = _cells_to_matrices(cells)
    out = {
        "frame_height": frame_shape[0] if frame_shape else None,
        "frame_width": frame_shape[1] if frame_shape else None,
        "venue_capacity": payload.get("venue_capacity"),
        "total_count": payload.get("total_count"),
        "cells": cells,
        "matrices_6x8": {
            "rows": list(_ROW_LETTERS),
            "cols": list(range(1, GRID_COLS + 1)),
            **mats,
        },
    }
    if density is not None:
        out["density_map"] = {
            "shape_hw": list(density.shape),
            "sum": float(density.sum()),
            "min": float(density.min()),
            "max": float(density.max()),
            "mean": float(density.mean()),
        }
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"\nQuantitative export written: {path}")


def run_image(
    path: str,
    heatmap: bool,
    out_dir: str,
    show_matrix: bool,
    json_path: str | None,
    heat_scale: str,
    colorbar: bool,
    growth_window: int,
) -> None:
    bgr = cv2.imread(path)
    if bgr is None:
        print(f"Could not read image: {path}")
        sys.exit(1)
    h, w = bgr.shape[:2]
    print(f"Image {path}  shape={w}x{h}")

    model = CSRNet()
    model.eval()
    _load_weights(model)

    t0 = time.perf_counter()
    density = model.infer(bgr)
    ms = (time.perf_counter() - t0) * 1000
    print(f"Infer time: {ms:.0f} ms  density map shape={density.shape}  sum={float(density.sum()):.2f}")

    grid = build_grid(h, w)
    cells = aggregate_density(density, grid)
    history: dict = {}
    cells = compute_levels(cells, history, growth_window=growth_window)
    payload = build_websocket_payload("festival_v1", cells)
    print(
        "Note: growth_rate stays 0 on a single image — it needs repeated frames "
        f"(video) and at least {growth_window} readings per zone in history."
    )
    print(f"total_count (model units) ≈ {payload['total_count']:.1f}")
    worst = max(cells, key=lambda c: c["density_pct"])
    print(f"Highest zone: {worst['id']}  level={worst['level']}  density_pct={worst['density_pct']:.2f}")

    if show_matrix:
        print_zone_matrices(cells)
    if json_path:
        export_zone_json(json_path, cells, payload, density, (h, w))

    if heatmap:
        print(f"Heatmap color scale: {heat_scale} (use --heat-scale linear|sqrt|log)")
        p_lo, p_hi = save_heatmap_min_max_pair(
            bgr, density, bgr, density, out_dir, heat_scale, colorbar
        )
        print(f"\nHeatmap images (single frame → same min/max):\n  {p_lo}\n  {p_hi}")


def run_video(
    path: str,
    max_frames: int,
    heatmap: bool,
    out_dir: str,
    show_matrix: bool,
    json_path: str | None,
    heat_scale: str,
    colorbar: bool,
    growth_window: int,
    sim_fps: float,
) -> None:
    from ml.simulator import VideoSimulator

    print(f"Video {path}  (processing {max_frames} frames, simulator ~{sim_fps} FPS)")
    model = CSRNet()
    model.eval()
    _load_weights(model)

    sim = VideoSimulator(path, target_fps=sim_fps)
    sim.start()
    time.sleep(0.5)
    cell_history: dict = {}
    # Poll slightly slower than the simulator’s frame period so each step sees a new frame.
    poll_sleep = max(0.02, 0.95 / sim_fps)
    print(
        f"Shared zone history (growth_window={growth_window}). "
        f"Need ≥{growth_window} frames for growth_rate; JSON/matrix = last frame."
    )
    last_payload = None
    last_cells = None
    last_d = None
    last_hw: tuple[int, int] | None = None
    best_min: tuple[float, np.ndarray | None, np.ndarray | None] = (float("inf"), None, None)
    best_max: tuple[float, np.ndarray | None, np.ndarray | None] = (float("-inf"), None, None)
    for i in range(max_frames):
        time.sleep(poll_sleep)
        frame = sim.get_latest_frame()
        if frame is None:
            print("  (no frame yet — check file is valid MP4)")
            continue
        h, w = frame.shape[:2]
        d = model.infer(frame)
        grid = build_grid(h, w)
        cells = compute_levels(
            aggregate_density(d, grid), cell_history, growth_window=growth_window
        )
        last_cells, last_d, last_hw = cells, d, (h, w)
        last_payload = build_websocket_payload("festival_v1", cells)
        worst = max(cells, key=lambda c: c["density_pct"])
        s = float(d.sum())
        print(f"  frame {i+1}: {w}x{h}  sum={s:.1f}  hot zone {worst['id']} ({worst['level']})")
        if heatmap:
            if s < best_min[0]:
                best_min = (s, frame.copy(), d.copy())
            if s > best_max[0]:
                best_max = (s, frame.copy(), d.copy())
    if heatmap and best_min[1] is not None and best_max[1] is not None:
        print(f"Heatmap color scale: {heat_scale} (use --heat-scale linear|sqrt|log)")
        p_lo, p_hi = save_heatmap_min_max_pair(
            best_min[1],
            best_min[2],  # type: ignore[arg-type]
            best_max[1],
            best_max[2],  # type: ignore[arg-type]
            out_dir,
            heat_scale,
            colorbar,
        )
        print(
            f"\nHeatmap images (lowest vs highest total density in this run):\n"
            f"  {p_lo}\n  {p_hi}"
        )
    if last_cells is not None and last_payload is not None and last_d is not None and last_hw:
        if show_matrix:
            print_zone_matrices(last_cells)
        if json_path:
            export_zone_json(json_path, last_cells, last_payload, last_d, last_hw)
    sim.pause()


def main() -> None:
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.join(backend_dir, "heatmap_output")

    parser = argparse.ArgumentParser(description="Run CSRNet on an image or video.")
    parser.add_argument("path", help="Path to .jpg/.png or video")
    parser.add_argument(
        "--heatmap",
        action="store_true",
        help="Save density + overlay + zone-grid PNGs (see heatmap_output/)",
    )
    parser.add_argument(
        "--out-dir",
        default=default_out,
        help=f"Directory for PNG outputs (default: {default_out})",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="Open the zone overlay PNG after writing (macOS `open`)",
    )
    parser.add_argument(
        "--matrix",
        action="store_true",
        help="Print 6×8 matrices: count, density_pct, growth_rate, level",
    )
    parser.add_argument(
        "--json",
        metavar="PATH",
        default=None,
        help="Write quantitative JSON (cells + 6×8 matrices + density stats)",
    )
    parser.add_argument(
        "--heat-scale",
        choices=("log", "sqrt", "linear"),
        default="log",
        help="How to map density→color: log=log1p (best for faint crowds), sqrt, or linear",
    )
    parser.add_argument(
        "--no-colorbar",
        action="store_true",
        help="Do not append the low→high color strip under saved heatmap images",
    )
    parser.add_argument(
        "--growth-window",
        type=int,
        default=60,
        metavar="N",
        help="Readings per zone before growth_rate is defined (PRD default 60). "
        "Use a smaller N (e.g. 10) if --max-frames is below 60.",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=3,
        metavar="N",
        help="How many frames to process (each updates zone history). "
        "For a 3s clip and growth_window=60, use at least 60 (e.g. --max-frames 90).",
    )
    parser.add_argument(
        "--sim-fps",
        type=float,
        default=15.0,
        metavar="FPS",
        help="How fast the video simulator pulls frames from the MP4 (higher = more frames through the clip).",
    )
    args = parser.parse_args()

    path = os.path.expanduser(args.path)
    if not os.path.isfile(path):
        print(f"Not a file: {path}")
        sys.exit(1)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".mp4", ".mov", ".avi", ".webm", ".mkv"):
        run_video(
            path,
            max_frames=args.max_frames,
            heatmap=args.heatmap,
            out_dir=args.out_dir,
            show_matrix=args.matrix,
            json_path=args.json,
            heat_scale=args.heat_scale,
            colorbar=not args.no_colorbar,
            growth_window=args.growth_window,
            sim_fps=args.sim_fps,
        )
    else:
        run_image(
            path,
            heatmap=args.heatmap,
            out_dir=args.out_dir,
            show_matrix=args.matrix,
            json_path=args.json,
            heat_scale=args.heat_scale,
            colorbar=not args.no_colorbar,
            growth_window=args.growth_window,
        )

    if args.heatmap and args.open and sys.platform == "darwin":
        hi = os.path.join(args.out_dir, "heatmap_highest.png")
        if os.path.isfile(hi):
            subprocess.run(["open", hi], check=False)


if __name__ == "__main__":
    main()
