"""Density overlays and JPEG snapshots for WebSocket / UI (matches ``test_local`` PNG style)."""

from __future__ import annotations

import base64

import cv2
import numpy as np

from ml.pipeline import GRID_COLS, GRID_ROWS


def _colormap_id() -> int:
    return getattr(cv2, "COLORMAP_TURBO", cv2.COLORMAP_JET)


def density_to_colormap_bgr(density: np.ndarray, scale: str = "log") -> np.ndarray:
    """Map density → BGR heatmap (same scaling as ``test_local``)."""
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


def _embed_colorbar_panel(img: np.ndarray, scale: str) -> np.ndarray:
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


def compose_snapshot_overlay_bgr(
    frame_bgr: np.ndarray,
    density: np.ndarray,
    caption: str,
    scale: str = "log",
) -> np.ndarray:
    """
    Camera frame + heatmap blend + white 6×8 grid + top caption + bottom color bar
    (same recipe as ``test_local.save_heatmap_min_max_pair``).
    """
    if frame_bgr.shape[:2] != density.shape[:2]:
        density = cv2.resize(
            density.astype(np.float32),
            (frame_bgr.shape[1], frame_bgr.shape[0]),
            interpolation=cv2.INTER_LINEAR,
        )
    heat_bgr = density_to_colormap_bgr(density, scale=scale)
    blend = cv2.addWeighted(frame_bgr, 0.45, heat_bgr, 0.55, 0)
    zoned = _draw_zone_grid(blend)
    zoned = _label_top(zoned, caption)
    zoned = _embed_colorbar_panel(zoned, scale)
    return zoned


def snapshot_overlay_jpeg_b64(
    frame_bgr: np.ndarray,
    density: np.ndarray,
    scale: str = "log",
    jpeg_quality: int = 85,
) -> str:
    """Full snapshot image as base64 JPEG (no data URL prefix)."""
    s = float(np.sum(density))
    caption = f"Density snapshot  (map sum = {s:.1f})"
    bgr = compose_snapshot_overlay_bgr(frame_bgr, density, caption, scale=scale)
    ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), int(jpeg_quality)])
    if not ok:
        raise RuntimeError("cv2.imencode failed for snapshot JPEG")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def density_to_heatmap_jpeg_b64(
    density: np.ndarray,
    scale: str = "log",
    jpeg_quality: int = 85,
) -> str:
    """Encode density map only (no frame) as base64 JPEG — legacy helper."""
    bgr = density_to_colormap_bgr(density, scale=scale)
    ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), int(jpeg_quality)])
    if not ok:
        raise RuntimeError("cv2.imencode failed for heatmap JPEG")
    return base64.b64encode(buf.tobytes()).decode("ascii")
