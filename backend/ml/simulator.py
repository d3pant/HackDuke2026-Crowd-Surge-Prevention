"""Threaded MP4 frame simulator with pause/resume and surge injection."""

from __future__ import annotations

import os
import threading
import time
from typing import Any

import cv2
import numpy as np


def _probe_total_frames(cap: cv2.VideoCapture) -> int:
    """Use container metadata when sane; otherwise count by reading (then seek back to 0)."""
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if n > 0:
        return n
    count = 0
    while True:
        ok, _ = cap.read()
        if not ok:
            break
        count += 1
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    return max(count, 1)


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
        # All three heatmap frames are latched on file pass 1 (begin / mid / end). Pass 2+ only changes
        # which stored snapshot the API shows (see get_playback_loop + heatmap_storage on the app).
        self._playback_loop = 1
        self._frames_in_loop = 0
        self._total_frames = max(1, int(os.getenv("SIMULATOR_ESTIMATED_TOTAL_FRAMES", "300")))
        # Filled on each EOF from actual frames read (CAP_PROP_FRAME_COUNT is often 0 or wrong for MP4).
        self._measured_loop_frames = 0
        self._heatmap_slots_done: set[int] = set()
        self._heatmap_jobs: list[tuple[int, np.ndarray]] = []

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
        self._total_frames = _probe_total_frames(cap)
        interval = 1.0 / (self._target_fps * self._speed)
        while not self._stop.is_set():
            self._pause.wait()
            t0 = time.time()
            ok, frame = cap.read()
            if not ok:
                with self._frame_lock:
                    if self._frames_in_loop > 0:
                        self._measured_loop_frames = self._frames_in_loop
                    if (
                        3 not in self._heatmap_slots_done
                        and self._playback_loop == 1
                        and self._latest is not None
                    ):
                        self._heatmap_slots_done.add(3)
                        self._heatmap_jobs.append((3, self._latest.copy()))
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                self._playback_loop += 1
                self._frames_in_loop = 0
                self._frame_index = 0
                elapsed = time.time() - t0
                sleep_for = max(0.0, interval - elapsed)
                if sleep_for > 0:
                    time.sleep(sleep_for)
                continue

            self._frames_in_loop += 1
            self._frame_index += 1
            total = max(self._total_frames, 1)
            mid = total // 2
            win_beg = min(15, max(3, total // 50))
            win_mid = max(8, total // 25)
            win_end = min(25, max(4, total // 40))

            with self._frame_lock:
                self._latest = frame.copy()
                queued = {s for s, _ in self._heatmap_jobs}
                if self._playback_loop != 1:
                    pass
                elif (
                    1 not in self._heatmap_slots_done
                    and 1 not in queued
                    and self._frames_in_loop <= win_beg
                ):
                    self._heatmap_slots_done.add(1)
                    self._heatmap_jobs.append((1, frame.copy()))
                elif (
                    2 not in self._heatmap_slots_done
                    and 2 not in queued
                    and abs(self._frames_in_loop - mid) <= win_mid
                ):
                    self._heatmap_slots_done.add(2)
                    self._heatmap_jobs.append((2, frame.copy()))
                elif (
                    3 not in self._heatmap_slots_done
                    and 3 not in queued
                    and self._frames_in_loop >= total - win_end
                ):
                    self._heatmap_slots_done.add(3)
                    self._heatmap_jobs.append((3, frame.copy()))

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
        self._playback_loop = 1
        self._frames_in_loop = 0
        self._measured_loop_frames = 0
        self._heatmap_slots_done = set()
        with self._frame_lock:
            self._latest = None
            self._heatmap_jobs = []
        self._pause.set()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def set_speed(self, multiplier: float) -> None:
        self._speed = max(0.1, float(multiplier))

    def get_latest_frame(self) -> np.ndarray | None:
        with self._frame_lock:
            if self._latest is None:
                return None
            return self._latest.copy()

    def get_playback_loop(self) -> int:
        """1-based index of the current pass through the file (increments on each EOF)."""
        with self._frame_lock:
            return int(self._playback_loop)

    def consume_frame_and_snapshot_slot(self) -> tuple[np.ndarray | None, int | None]:
        """
        Frame for this pipeline tick plus optional heatmap slot 1|2|3.

        When a slot is returned, the frame is the exact frame latched for that heatmap
        (beginning / middle / end of the first file pass). Otherwise returns the latest frame
        for normal inference with ``slot is None``.
        """
        with self._frame_lock:
            if self._heatmap_jobs:
                slot, fr = self._heatmap_jobs.pop(0)
                return fr.copy(), slot
            if self._latest is None:
                return None, None
            return self._latest.copy(), None

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
