"""cloakbrowser-human — Human-like scrolling via mouse wheel events.

Uses mouse.wheel() to simulate physical scroll wheel rotation. Never uses
scrollIntoView() or window.scrollTo() — those are detectable as programmatic.

Scroll pattern: accelerate -> cruise -> decelerate, mimicking real hand movement.
Includes occasional overshoot and correction.
"""

from __future__ import annotations

import math
import random
from typing import TYPE_CHECKING, Optional, Tuple

from .config import HumanConfig, rand, rand_range, rand_int_range, sleep_ms
from .mouse import human_move

if TYPE_CHECKING:
    from patchright.sync_api import Page


# ---------------------------------------------------------------------------
# Element visibility check
# ---------------------------------------------------------------------------

def _is_in_viewport(
    bounds: dict,
    viewport_height: int,
    cfg: HumanConfig,
) -> bool:
    """Check if an element is within the visible viewport zone defined by config."""
    top_edge = bounds["y"]
    bottom_edge = bounds["y"] + bounds["height"]
    zone_top = viewport_height * cfg.scroll_target_zone[0]
    zone_bottom = viewport_height * cfg.scroll_target_zone[1]
    return top_edge >= zone_top and bottom_edge <= zone_bottom


# ---------------------------------------------------------------------------
# Get bounding box
# ---------------------------------------------------------------------------

def _get_element_box(page: Page, selector: str) -> Optional[dict]:
    """Get the bounding box of an element, or None if not found."""
    try:
        el = page.locator(selector).first
        box = el.bounding_box(timeout=2000)
        return box
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Scroll to element
# ---------------------------------------------------------------------------

def scroll_to_element(
    page: Page,
    selector: str,
    cursor_x: float,
    cursor_y: float,
    cfg: HumanConfig,
) -> Tuple[dict, float, float]:
    """Scroll the page until the element is in the visible viewport zone.

    Uses mouse.wheel() with acceleration/deceleration pattern.

    Returns:
        Tuple of (bounding_box, cursor_x, cursor_y) after scrolling.
    """
    viewport = page.viewport_size
    if not viewport:
        raise RuntimeError("Viewport size not available")

    viewport_height = viewport["height"]
    viewport_width = viewport["width"]

    # Get element's current position
    box = _get_element_box(page, selector)
    if box is None:
        sleep_ms(200)
        box = _get_element_box(page, selector)
        if box is None:
            raise RuntimeError(f"Element not found: {selector}")

    # Already visible?
    if _is_in_viewport(box, viewport_height, cfg):
        return box, cursor_x, cursor_y

    # Move cursor toward center of viewport before scrolling (human behavior)
    scroll_area_x = round(viewport_width * rand(0.3, 0.7))
    scroll_area_y = round(viewport_height * rand(0.3, 0.7))
    human_move(page, cursor_x, cursor_y, scroll_area_x, scroll_area_y, cfg)
    cursor_x = scroll_area_x
    cursor_y = scroll_area_y
    sleep_ms(rand_range(cfg.scroll_pre_move_delay))

    # Determine scroll direction and distance
    target_y = viewport_height * rand(cfg.scroll_target_zone[0], cfg.scroll_target_zone[1])
    element_center = box["y"] + box["height"] / 2
    distance_to_scroll = element_center - target_y  # positive = need to scroll down

    direction = 1 if distance_to_scroll > 0 else -1
    abs_distance = abs(distance_to_scroll)
    avg_delta = (cfg.scroll_delta_base[0] + cfg.scroll_delta_base[1]) / 2
    total_clicks = max(3, math.ceil(abs_distance / avg_delta))
    accel_steps = rand_int_range(cfg.scroll_accel_steps)
    decel_steps = rand_int_range(cfg.scroll_decel_steps)

    scrolled = 0

    for i in range(total_clicks):
        # Determine delta and pause based on phase
        if i < accel_steps:
            # Acceleration phase — slow, small deltas
            delta = rand(80, 100)
            pause = rand_range(cfg.scroll_pause_slow)
        elif i >= total_clicks - decel_steps:
            # Deceleration phase — slow down
            delta = rand(60, 90)
            pause = rand_range(cfg.scroll_pause_slow)
        else:
            # Cruise phase — fast
            delta = rand_range(cfg.scroll_delta_base)
            pause = rand_range(cfg.scroll_pause_fast)

        # Apply variance to delta
        delta *= 1 + (random.random() - 0.5) * 2 * cfg.scroll_delta_variance
        delta = round(delta) * direction

        page.mouse.wheel(0, delta)
        scrolled += abs(delta)
        sleep_ms(pause)

        # Check if element is now visible periodically
        if i % 3 == 2 or i == total_clicks - 1:
            box = _get_element_box(page, selector)
            if box and _is_in_viewport(box, viewport_height, cfg):
                break

        # Don't scroll more than necessary
        if scrolled >= abs_distance * 1.1:
            break

    # Overshoot: chance of overshooting then correcting
    if random.random() < cfg.scroll_overshoot_chance:
        overshoot_px = rand_range(cfg.scroll_overshoot_px) * direction
        page.mouse.wheel(0, round(overshoot_px))
        sleep_ms(rand_range(cfg.scroll_settle_delay))

        # Correct back with 1-2 small clicks
        corrections = rand_int_range((1, 2))
        for _ in range(corrections):
            corr_delta = rand(40, 80) * -direction
            page.mouse.wheel(0, round(corr_delta))
            sleep_ms(rand(100, 250))

    # Settle delay — human waits for page to "arrive"
    sleep_ms(rand_range(cfg.scroll_settle_delay))

    # Re-query final position
    box = _get_element_box(page, selector)
    if box is None:
        raise RuntimeError(f"Element lost after scrolling: {selector}")

    return box, cursor_x, cursor_y
