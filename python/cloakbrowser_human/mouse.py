"""cloakbrowser-human — Human-like mouse movement and clicking.

Trajectory: cubic Bezier with random side bias.
Easing: ease-in-out cubic for natural acceleration/deceleration.
Wobble: sinusoidal micro-jitter, maximal mid-path, zero at endpoints.
Burst pattern: 3-5 points sent without pause, then 8-18ms gap.
Overshoot: 15% chance of overshooting target by 3-6px, then correction.
"""

from __future__ import annotations

import math
import random
from typing import TYPE_CHECKING, Tuple

from .config import HumanConfig, rand, rand_range, rand_int_range, sleep_ms

if TYPE_CHECKING:
    from patchright.sync_api import Page


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class Point:
    __slots__ = ("x", "y")

    def __init__(self, x: float, y: float):
        self.x = x
        self.y = y


# ---------------------------------------------------------------------------
# Easing
# ---------------------------------------------------------------------------

def _ease_in_out(t: float) -> float:
    """Cubic ease-in-out: slow start, fast middle, slow end."""
    if t < 0.5:
        return 4 * t * t * t
    return 1 - pow(-2 * t + 2, 3) / 2


# ---------------------------------------------------------------------------
# Bezier
# ---------------------------------------------------------------------------

def _bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: float) -> Point:
    """Evaluate a cubic Bezier at parameter t in [0, 1]."""
    u = 1 - t
    uu = u * u
    uuu = uu * u
    tt = t * t
    ttt = tt * t
    return Point(
        uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    )


def _random_control_points(start: Point, end: Point) -> Tuple[Point, Point]:
    """Generate control points with random lateral bias."""
    dx = end.x - start.x
    dy = end.y - start.y
    dist = math.hypot(dx, dy) or 1
    # Perpendicular direction
    px = -dy / dist
    py = dx / dist
    bias1 = rand(-0.3, 0.3) * dist
    bias2 = rand(-0.3, 0.3) * dist
    return (
        Point(start.x + dx * 0.25 + px * bias1, start.y + dy * 0.25 + py * bias1),
        Point(start.x + dx * 0.75 + px * bias2, start.y + dy * 0.75 + py * bias2),
    )


# ---------------------------------------------------------------------------
# Human mouse movement
# ---------------------------------------------------------------------------

def human_move(
    page: Page,
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
    cfg: HumanConfig,
) -> None:
    """Move the mouse from (start_x, start_y) to (end_x, end_y) with human-like trajectory."""
    dist = math.hypot(end_x - start_x, end_y - start_y)
    if dist < 1:
        return

    steps = max(
        cfg.mouse_min_steps,
        min(cfg.mouse_max_steps, round(dist / cfg.mouse_steps_divisor)),
    )

    start = Point(start_x, start_y)
    end = Point(end_x, end_y)
    cp1, cp2 = _random_control_points(start, end)

    burst_counter = 0
    burst_size = rand_int_range(cfg.mouse_burst_size)

    for i in range(steps + 1):
        progress = i / steps
        eased_t = _ease_in_out(progress)
        pt = _bezier(start, cp1, cp2, end, eased_t)

        # Wobble: sinusoidal jitter, maximal at mid-path, zero at endpoints
        wobble_amp = math.sin(math.pi * progress) * cfg.mouse_wobble_max
        wx = pt.x + (random.random() - 0.5) * 2 * wobble_amp
        wy = pt.y + (random.random() - 0.5) * 2 * wobble_amp

        page.mouse.move(round(wx), round(wy))

        # Burst pattern
        burst_counter += 1
        if burst_counter >= burst_size and i < steps:
            sleep_ms(rand_range(cfg.mouse_burst_pause))
            burst_counter = 0

    # Overshoot: chance the cursor overshoots and corrects
    if random.random() < cfg.mouse_overshoot_chance:
        overshoot_dist = rand_range(cfg.mouse_overshoot_px)
        angle = math.atan2(end_y - start_y, end_x - start_x)
        ov_x = round(end_x + math.cos(angle) * overshoot_dist)
        ov_y = round(end_y + math.sin(angle) * overshoot_dist)
        page.mouse.move(ov_x, ov_y)
        sleep_ms(rand(30, 70))
        # Correct back to target +/-2px
        corr_x = round(end_x + (random.random() - 0.5) * 4)
        corr_y = round(end_y + (random.random() - 0.5) * 4)
        page.mouse.move(corr_x, corr_y)


# ---------------------------------------------------------------------------
# Click target calculation
# ---------------------------------------------------------------------------

def click_target(
    box: dict,
    is_input: bool,
    cfg: HumanConfig,
) -> Point:
    """Determine click target point within an element's bounding box.

    Input fields: left third (5-30% width, 30-70% height).
    Buttons/other: near center (+/-30%).
    """
    if is_input:
        x_frac = rand_range(cfg.click_input_x_range)
        y_frac = rand(0.30, 0.70)
    else:
        x_frac = rand(0.35, 0.65)
        y_frac = rand(0.35, 0.65)
    return Point(
        round(box["x"] + box["width"] * x_frac),
        round(box["y"] + box["height"] * y_frac),
    )


# ---------------------------------------------------------------------------
# Human click
# ---------------------------------------------------------------------------

def human_click(page: Page, is_input: bool, cfg: HumanConfig) -> None:
    """Perform a human-like click: mousedown -> hold -> mouseup."""
    # Pre-click aiming delay
    aim_delay = (
        rand_range(cfg.click_aim_delay_input) if is_input
        else rand_range(cfg.click_aim_delay_button)
    )
    sleep_ms(aim_delay)

    # Click: down -> hold -> up
    hold_time = (
        rand_range(cfg.click_hold_input) if is_input
        else rand_range(cfg.click_hold_button)
    )
    page.mouse.down()
    sleep_ms(hold_time)
    page.mouse.up()


# ---------------------------------------------------------------------------
# Human idle / drift
# ---------------------------------------------------------------------------

def human_idle(
    page: Page,
    seconds: float,
    cx: float,
    cy: float,
    cfg: HumanConfig,
) -> None:
    """Idle drift: cursor stays roughly in place with tiny random movements.

    Args:
        seconds: Approximate duration of idle period.
        cx: Current cursor X position.
        cy: Current cursor Y position.
    """
    import time as _time

    end_time = _time.monotonic() + seconds
    x, y = cx, cy
    while _time.monotonic() < end_time:
        dx = (random.random() - 0.5) * 2 * cfg.idle_drift_px
        dy = (random.random() - 0.5) * 2 * cfg.idle_drift_px
        x += dx
        y += dy
        page.mouse.move(round(x), round(y))
        sleep_ms(rand_range(cfg.idle_pause_range))
