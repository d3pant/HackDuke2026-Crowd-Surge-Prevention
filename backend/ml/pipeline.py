"""Grid aggregation, surge-aware counts, level computation, WebSocket payload."""

from __future__ import annotations

import time
from collections import deque
from typing import Any

import numpy as np

GRID_ROWS = 6
GRID_COLS = 8
TOTAL_CELLS = 48
DEFAULT_CELL_CAPACITY = 80
VENUE_TOTAL_CAPACITY = 12000

_ROW_LETTERS = "ABCDEF"


def build_grid(frame_h: int, frame_w: int) -> list[dict]:
    """Build 6×8 zone grid (Z-A1 … Z-F8) covering the frame."""
    cell_h = frame_h / GRID_ROWS
    cell_w = frame_w / GRID_COLS
    grid: list[dict] = []
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            letter = _ROW_LETTERS[row]
            zid = f"Z-{letter}{col + 1}"
            r0 = int(row * cell_h)
            r1 = int((row + 1) * cell_h) if row < GRID_ROWS - 1 else frame_h
            c0 = int(col * cell_w)
            c1 = int((col + 1) * cell_w) if col < GRID_COLS - 1 else frame_w
            grid.append(
                {
                    "id": zid,
                    "row": row,
                    "col": col,
                    "row_start": r0,
                    "row_end": r1,
                    "col_start": c0,
                    "col_end": c1,
                    "capacity": DEFAULT_CELL_CAPACITY,
                }
            )
    return grid


def aggregate_density(density_map: np.ndarray, grid: list[dict]) -> list[dict]:
    """Sum density in each cell region; add ``count`` to each cell dict."""
    out: list[dict] = []
    for cell in grid:
        rs, re = cell["row_start"], cell["row_end"]
        cs, ce = cell["col_start"], cell["col_end"]
        patch = density_map[rs:re, cs:ce]
        total = float(np.sum(patch)) if patch.size else 0.0
        c = {**cell, "count": total}
        out.append(c)
    return out


def apply_surge_to_counts(cells: list[dict], surge: dict[str, Any] | None) -> list[dict]:
    """Multiply ``count`` for ``surge['zone_id']`` while surge is active."""
    if not surge:
        return cells
    now = time.time()
    if now > surge.get("until", 0):
        return cells
    zid = surge.get("zone_id")
    intensity = float(surge.get("intensity", 2.0))
    out = []
    for c in cells:
        cc = dict(c)
        if cc["id"] == zid:
            cc["count"] = float(cc["count"]) * intensity
        out.append(cc)
    return out


def compute_levels(
    cells: list[dict],
    history: dict[str, Any],
    growth_window: int = 60,
) -> list[dict]:
    """
    Enrich cells with density_pct, growth_rate, level.
    ``history[zone_id]`` holds ``counts`` (deque maxlen ``growth_window``) and ``prev_level``.
    Growth is defined only after ``growth_window`` readings exist; until then ``growth_rate`` is 0.
    PRD default: ``growth_window=60`` (compare current count to the oldest in that window).
    """
    enriched: list[dict] = []
    for cell in cells:
        zid = cell["id"]
        if zid not in history:
            history[zid] = {"counts": deque(maxlen=growth_window), "prev_level": "safe"}
        h = history[zid]
        counts: deque[float] = h["counts"]
        prev_level: str = h["prev_level"]

        capacity = float(cell["capacity"])
        current_count = float(cell["count"])
        density_pct = current_count / capacity if capacity else 0.0

        if len(counts) < growth_window:
            growth_rate = 0.0
        else:
            old = counts[0]
            growth_rate = (current_count - old) / max(old, 1.0)

        level_was_warning = prev_level == "warning"
        level_was_watch = prev_level == "watch"

        if density_pct >= 0.95 or (level_was_warning and growth_rate > 0.15):
            level = "critical"
        elif density_pct >= 0.80 or (level_was_watch and growth_rate > 0.10):
            level = "warning"
        elif density_pct >= 0.60:
            level = "watch"
        else:
            level = "safe"

        counts.append(current_count)
        h["prev_level"] = level

        enriched.append(
            {
                **cell,
                "density_pct": density_pct,
                "growth_rate": growth_rate,
                "level": level,
            }
        )
    return enriched


def _alert_message(zone_id: str, density_pct: float, growth_rate: float) -> str:
    label = zone_id.replace("Z-", "", 1) if zone_id.startswith("Z-") else zone_id
    return (
        f"Surge detected — Zone {label} at {density_pct * 100:.1f}% capacity "
        f"with {growth_rate * 100:.0f}% growth"
    )


def build_websocket_payload(venue_id: str, cells: list[dict]) -> dict[str, Any]:
    """Build density WebSocket JSON dict (grid + alerts)."""
    total_count = sum(float(c["count"]) for c in cells)
    alerts: list[dict[str, Any]] = []
    for c in cells:
        lvl = c.get("level", "safe")
        if lvl in ("warning", "critical"):
            alerts.append(
                {
                    "zone_id": c["id"],
                    "level": lvl,
                    "count": float(c["count"]),
                    "capacity": int(c["capacity"]),
                    "density_pct": float(c["density_pct"]),
                    "growth_rate": float(c["growth_rate"]),
                    "message": _alert_message(
                        c["id"], float(c["density_pct"]), float(c["growth_rate"])
                    ),
                }
            )
    return {
        "timestamp": int(time.time()),
        "venue_id": venue_id,
        "total_count": total_count,
        "venue_capacity": VENUE_TOTAL_CAPACITY,
        "grid": {
            "rows": GRID_ROWS,
            "cols": GRID_COLS,
            "cells": [
                {
                    "id": c["id"],
                    "row": c["row"],
                    "col": c["col"],
                    "count": float(c["count"]),
                    "capacity": int(c["capacity"]),
                    "level": c["level"],
                    "density_pct": float(c["density_pct"]),
                    "growth_rate": float(c["growth_rate"]),
                }
                for c in cells
            ],
        },
        "alerts": alerts,
    }


def _self_test() -> None:
    h, w = 720, 1280
    grid = build_grid(h, w)
    dmap = np.zeros((h, w), dtype=np.float32)
    target = grid[0]
    dmap[target["row_start"] : target["row_end"], target["col_start"] : target["col_end"]] = 10.0
    agg = aggregate_density(dmap, grid)
    assert agg[0]["count"] > 0, "spiked cell should be nonzero"
    for i, c in enumerate(agg):
        if i != 0:
            assert c["count"] == 0.0, f"cell {i} should be zero"

    hist: dict[str, Any] = {}
    hi_cell = {
        "id": "Z-A1",
        "row": 0,
        "col": 0,
        "count": 0.95 * DEFAULT_CELL_CAPACITY,
        "capacity": DEFAULT_CELL_CAPACITY,
    }
    out = compute_levels([hi_cell], hist)
    assert out[0]["level"] == "critical", "density_pct >= 0.95 => critical"

    print("pipeline self-tests passed")


if __name__ == "__main__":
    _self_test()
