"""Threaded MP4 frame simulator with pause/resume and surge injection."""

from __future__ import annotations

import threading
import time
from typing import Any

import cv2
import numpy as np


class VideoSimulator:
    """Continuously read frames from a looping MP4 at a target rate."""

    def __init__(self, video_path: str, target_fps: float = 1.0) -> None:
        self._video_path = video_path
        self._target_fps = max(0.1, float(target_fps))
        self._pause = threading.Event()
        self._pause.set()
        self._stop = threading.Event()
        self._frame_lock = threading.Lock()
        self._latest: np.ndarray | None = None
        self._thread: threading.Thread | None = None
        self._frame_index = 0
        self._speed = 1.0
        self._surge_lock = threading.Lock()
        self._surge: dict[str, Any] | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def _run_loop(self) -> None:
        cap = cv2.VideoCapture(self._video_path)
        if not cap.isOpened():
            return
        interval = 1.0 / (self._target_fps * self._speed)
        while not self._stop.is_set():
            self._pause.wait()
            t0 = time.time()
            ok, frame = cap.read()
            if not ok:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                self._frame_index = 0
                continue
            with self._frame_lock:
                self._latest = frame.copy()
                self._frame_index += 1
            elapsed = time.time() - t0
            sleep_for = max(0.0, interval - elapsed)
            if sleep_for > 0:
                time.sleep(sleep_for)
        cap.release()

    def pause(self) -> None:
        self._pause.clear()

    def resume(self) -> None:
        self._pause.set()

    def reset(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        self._stop.clear()
        self._frame_index = 0
        with self._frame_lock:
            self._latest = None
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def set_speed(self, multiplier: float) -> None:
        self._speed = max(0.1, float(multiplier))

    def get_latest_frame(self) -> np.ndarray | None:
        with self._frame_lock:
            if self._latest is None:
                return None
            return self._latest.copy()

    def inject_surge(self, zone_id: str, intensity: float = 2.0, duration_seconds: int = 30) -> None:
        with self._surge_lock:
            self._surge = {
                "zone_id": zone_id,
                "intensity": float(intensity),
                "until": time.time() + int(duration_seconds),
            }

    def get_active_surge(self) -> dict[str, Any] | None:
        with self._surge_lock:
            if self._surge is None:
                return None
            if time.time() > self._surge["until"]:
                self._surge = None
                return None
            return dict(self._surge)
