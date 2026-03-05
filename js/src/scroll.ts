/**
 * cloakbrowser-human — Human-like scrolling via mouse wheel events.
 *
 * Uses mouse.wheel() to simulate physical scroll wheel rotation. Never uses
 * scrollIntoView() or window.scrollTo() — those are detectable as programmatic.
 *
 * Scroll pattern: accelerate → cruise → decelerate, mimicking real hand movement.
 * Includes occasional overshoot and correction.
 */

import type { Page } from 'playwright-core';
import { HumanConfig, rand, randRange, randIntRange, sleep } from './config.js';
import { humanMove } from './mouse.js';

// ---------------------------------------------------------------------------
// Element visibility check
// ---------------------------------------------------------------------------

interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Check if an element is within the visible viewport zone defined by config.
 */
function isInViewport(
  bounds: ElementBounds,
  viewportHeight: number,
  cfg: HumanConfig,
): boolean {
  const topEdge = bounds.y;
  const bottomEdge = bounds.y + bounds.height;
  const zoneTop = viewportHeight * cfg.scroll_target_zone[0];
  const zoneBottom = viewportHeight * cfg.scroll_target_zone[1];
  return topEdge >= zoneTop && bottomEdge <= zoneBottom;
}

// ---------------------------------------------------------------------------
// Scroll to element
// ---------------------------------------------------------------------------

/**
 * Scroll the page until the element identified by `selector` is in the visible
 * viewport zone. Uses mouse.wheel() with acceleration/deceleration pattern.
 *
 * @returns The updated bounding box of the element after scrolling.
 */
export async function scrollToElement(
  page: Page,
  selector: string,
  cursorX: number,
  cursorY: number,
  cfg: HumanConfig,
): Promise<{ box: ElementBounds; cursorX: number; cursorY: number }> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport size not available');

  // Get element's current position
  let box = await getElementBox(page, selector);
  if (!box) {
    // Element may not exist yet — wait a bit
    await sleep(200);
    box = await getElementBox(page, selector);
    if (!box) throw new Error(`Element not found: ${selector}`);
  }

  // Already visible?
  if (isInViewport(box, viewport.height, cfg)) {
    return { box, cursorX, cursorY };
  }

  // Move cursor toward center of viewport before scrolling (human behavior)
  const scrollAreaX = Math.round(viewport.width * rand(0.3, 0.7));
  const scrollAreaY = Math.round(viewport.height * rand(0.3, 0.7));
  await humanMove(page, cursorX, cursorY, scrollAreaX, scrollAreaY, cfg);
  cursorX = scrollAreaX;
  cursorY = scrollAreaY;
  await sleep(randRange(cfg.scroll_pre_move_delay));

  // Determine scroll direction and distance
  const targetY = viewport.height * rand(cfg.scroll_target_zone[0], cfg.scroll_target_zone[1]);
  const elementCenter = box.y + box.height / 2;
  let distanceToScroll = elementCenter - targetY; // positive = need to scroll down

  const direction = distanceToScroll > 0 ? 1 : -1;
  const absDistance = Math.abs(distanceToScroll);
  const avgDelta = (cfg.scroll_delta_base[0] + cfg.scroll_delta_base[1]) / 2;
  const totalClicks = Math.max(3, Math.ceil(absDistance / avgDelta));
  const accelSteps = randIntRange(cfg.scroll_accel_steps);
  const decelSteps = randIntRange(cfg.scroll_decel_steps);

  let scrolled = 0;

  for (let i = 0; i < totalClicks; i++) {
    // Determine delta and pause based on phase (accel / cruise / decel)
    let delta: number;
    let pause: number;

    if (i < accelSteps) {
      // Acceleration phase — slow, small deltas
      delta = rand(80, 100);
      pause = randRange(cfg.scroll_pause_slow);
    } else if (i >= totalClicks - decelSteps) {
      // Deceleration phase — slow down
      delta = rand(60, 90);
      pause = randRange(cfg.scroll_pause_slow);
    } else {
      // Cruise phase — fast
      delta = randRange(cfg.scroll_delta_base);
      pause = randRange(cfg.scroll_pause_fast);
    }

    // Apply variance to delta
    delta *= 1 + (Math.random() - 0.5) * 2 * cfg.scroll_delta_variance;
    delta = Math.round(delta) * direction;

    await page.mouse.wheel(0, delta);
    scrolled += Math.abs(delta);
    await sleep(pause);

    // Check if element is now visible (re-query position periodically)
    if (i % 3 === 2 || i === totalClicks - 1) {
      box = await getElementBox(page, selector);
      if (box && isInViewport(box, viewport.height, cfg)) {
        break;
      }
    }

    // Don't scroll more than necessary
    if (scrolled >= absDistance * 1.1) break;
  }

  // Overshoot: 10% chance of overshooting then correcting
  if (Math.random() < cfg.scroll_overshoot_chance) {
    const overshootPx = randRange(cfg.scroll_overshoot_px) * direction;
    await page.mouse.wheel(0, Math.round(overshootPx));
    await sleep(randRange(cfg.scroll_settle_delay));

    // Correct back with 1-2 small clicks
    const corrections = randIntRange([1, 2]);
    for (let c = 0; c < corrections; c++) {
      const corrDelta = rand(40, 80) * -direction;
      await page.mouse.wheel(0, Math.round(corrDelta));
      await sleep(rand(100, 250));
    }
  }

  // Settle delay — human waits for page to "arrive"
  await sleep(randRange(cfg.scroll_settle_delay));

  // Re-query final position
  box = await getElementBox(page, selector);
  if (!box) throw new Error(`Element lost after scrolling: ${selector}`);

  return { box, cursorX, cursorY };
}

// ---------------------------------------------------------------------------
// Helper: get bounding box
// ---------------------------------------------------------------------------

async function getElementBox(page: Page, selector: string): Promise<ElementBounds | null> {
  const el = page.locator(selector).first();
  try {
    const box = await el.boundingBox({ timeout: 2000 });
    return box;
  } catch {
    return null;
  }
}
