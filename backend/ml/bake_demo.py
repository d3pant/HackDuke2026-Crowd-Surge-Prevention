"""Precompute three CSRNet snapshots (beginning / middle / end) for a demo MP4 — no realtime loop."""

from __future__ import annotations

import time
from typing import Any

import cv2

from ml.heatmap_render import snapshot_overlay_jpeg_b64
from ml.pipeline import (
    aggregate_density,
    build_grid,
    build_websocket_payload,
    compute_levels,
)


def _count_frames_sequential(video_path: str) -> int:
    """
    True frame count by decoding the file once. Do not trust CAP_PROP_FRAME_COUNT —
    it is often wrong for MP4/H.264 and causes invalid indices (e.g. 488).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return 0
    try:
        n = 0
        while True:
            ok, _ = cap.read()
            if not ok:
                break
            n += 1
        return max(n, 1)
    finally:
        cap.release()


def _read_frame_bgr_seek(cap: cv2.VideoCapture, index: int) -> np.ndarray | None:
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(index))
    ok, frame = cap.read()
    if not ok or frame is None:
        return None
    return frame


def _read_frame_bgr_sequential(cap: cv2.VideoCapture, index: int) -> np.ndarray | None:
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    frame = None
    for _ in range(int(index) + 1):
        ok, frame = cap.read()
        if not ok or frame is None:
            return None
    return frame


def _read_frame_one_capture(video_path: str, index: int) -> np.ndarray | None:
    """Seek then sequential fallback on a single open capture."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None
    try:
        idx = max(0, int(index))
        frame = _read_frame_bgr_seek(cap, idx)
        if frame is not None:
            return frame
        return _read_frame_bgr_sequential(cap, idx)
    finally:
        cap.release()


def _read_frame_bgr(video_path: str, index: int) -> np.ndarray | None:
    """
    One fresh VideoCapture per call so decoder state from the previous segment
    cannot break the next (middle/end) read.
    """
    frame = _read_frame_one_capture(video_path, index)
    if frame is not None:
        return frame
    # Last resort: index may be off-by-one if count vs decode disagree.
    for j in range(int(index) - 1, -1, -1):
        frame = _read_frame_one_capture(video_path, j)
        if frame is not None:
            return frame
    return None


def precompute_demo_bundle_sync(video_path: str, model: Any) -> dict[str, Any]:
    """
    Three passes only: frames at start, middle, end of file.
    Returns JSON-serializable bundle for GET /api/density/bake.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    if fps <= 0:
        fps = 24.0
    cap.release()

    total = _count_frames_sequential(video_path)
    if total <= 0:
        raise RuntimeError("Empty video or could not count frames")

    duration_sec = float(total) / fps

    idx_begin = 0
    idx_mid = min(max(0, total // 2), total - 1)
    idx_end = total - 1

    specs = [
        ("beginning", idx_begin),
        ("middle", idx_mid),
        ("end", idx_end),
    ]

    segments: list[dict[str, Any]] = []
    for key, fidx in specs:
        frame = _read_frame_bgr(video_path, fidx)
        if frame is None:
            raise RuntimeError(f"Failed to read frame at index {fidx} (total_frames={total})")

        h, w = frame.shape[0], frame.shape[1]
        grid = build_grid(h, w)
        density_map = model.infer(frame)
        cells = aggregate_density(density_map, grid)
        hist: dict[str, Any] = {}
        cells = compute_levels(cells, hist)
        payload = build_websocket_payload("festival_v1", cells)
        b64 = snapshot_overlay_jpeg_b64(frame, density_map)

        seg_payload = dict(payload)
        seg_payload["heatmap_jpeg_b64"] = b64
        seg_payload["snapshot_index"] = len(segments) + 1
        seg_payload["heatmap_slot_label"] = key
        seg_payload["frame_index"] = int(fidx)

        segments.append(
            {
                "key": key,
                "label": key,
                "frame_index": int(fidx),
                "heatmap_jpeg_b64": b64,
                "payload": payload,
            }
        )

    return {
        "duration_sec": round(duration_sec, 3),
        "frame_count": int(total),
        "fps": round(fps, 3),
        "segments": segments,
        "baked_at": int(time.time()),
    }
