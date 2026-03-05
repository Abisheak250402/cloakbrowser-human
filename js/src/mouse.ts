/**
 * cloakbrowser-human — Human-like mouse movement and clicking.
 *
 * Trajectory: cubic Bezier with random side bias.
 * Easing: ease-in-out cubic for natural acceleration/deceleration.
 * Wobble: sinusoidal micro-jitter, maximal mid-path, zero at endpoints.
 * Burst pattern: 3-5 points sent without pause, then 8-18ms gap.
 * Overshoot: 15% chance of overshooting target by 3-6px, then correction.
 */

import type { Page, Mouse } from 'playwright-core';
import { HumanConfig, rand, randRange, randIntRange, sleep } from './config.js';

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

/** Cubic ease-in-out: slow start, fast middle, slow end. */
function easeInOut(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// Bezier
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

/** Evaluate a cubic Bezier at parameter t ∈ [0, 1]. */
function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/** Generate control points with random lateral bias so the curve bends naturally. */
function randomControlPoints(start: Point, end: Point): [Point, Point] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  // Perpendicular direction
  const px = -dy / (dist || 1);
  const py = dx / (dist || 1);
  // Side bias: offset perpendicular to the straight path
  const bias1 = rand(-0.3, 0.3) * dist;
  const bias2 = rand(-0.3, 0.3) * dist;
  return [
    {
      x: start.x + dx * 0.25 + px * bias1,
      y: start.y + dy * 0.25 + py * bias1,
    },
    {
      x: start.x + dx * 0.75 + px * bias2,
      y: start.y + dy * 0.75 + py * bias2,
    },
  ];
}

// ---------------------------------------------------------------------------
// Human mouse movement
// ---------------------------------------------------------------------------

/**
 * Move the mouse from (startX, startY) to (endX, endY) with human-like trajectory.
 * Uses Bezier curves, easing, wobble, and burst patterns.
 */
export async function humanMove(
  page: Page,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  cfg: HumanConfig,
): Promise<void> {
  const dist = Math.hypot(endX - startX, endY - startY);
  if (dist < 1) return;

  const steps = Math.max(
    cfg.mouse_min_steps,
    Math.min(cfg.mouse_max_steps, Math.round(dist / cfg.mouse_steps_divisor)),
  );

  const start: Point = { x: startX, y: startY };
  const end: Point = { x: endX, y: endY };
  const [cp1, cp2] = randomControlPoints(start, end);

  let burstCounter = 0;
  const burstSize = randIntRange(cfg.mouse_burst_size);

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const easedT = easeInOut(progress);
    const pt = bezier(start, cp1, cp2, end, easedT);

    // Wobble: sinusoidal jitter, maximal at mid-path, zero at endpoints
    const wobbleAmp = Math.sin(Math.PI * progress) * cfg.mouse_wobble_max;
    const wx = pt.x + (Math.random() - 0.5) * 2 * wobbleAmp;
    const wy = pt.y + (Math.random() - 0.5) * 2 * wobbleAmp;

    await page.mouse.move(Math.round(wx), Math.round(wy));

    // Burst pattern: send burstSize points without pause, then pause
    burstCounter++;
    if (burstCounter >= burstSize && i < steps) {
      await sleep(randRange(cfg.mouse_burst_pause));
      burstCounter = 0;
    }
  }

  // Overshoot: 15% chance the cursor overshoots and corrects
  if (Math.random() < cfg.mouse_overshoot_chance) {
    const overshootDist = randRange(cfg.mouse_overshoot_px);
    const angle = Math.atan2(endY - startY, endX - startX);
    const ovX = Math.round(endX + Math.cos(angle) * overshootDist);
    const ovY = Math.round(endY + Math.sin(angle) * overshootDist);
    await page.mouse.move(ovX, ovY);
    await sleep(rand(30, 70));
    // Correct back to target ±2px
    const corrX = Math.round(endX + (Math.random() - 0.5) * 4);
    const corrY = Math.round(endY + (Math.random() - 0.5) * 4);
    await page.mouse.move(corrX, corrY);
  }
}

// ---------------------------------------------------------------------------
// Human click
// ---------------------------------------------------------------------------

/**
 * Determine the click target point within an element's bounding box.
 * - Input fields: left third (5-30% width, 30-70% height)
 * - Buttons/other: near center (±30% width, ±30% height)
 */
export function clickTarget(
  box: { x: number; y: number; width: number; height: number },
  isInput: boolean,
  cfg: HumanConfig,
): Point {
  if (isInput) {
    const xFrac = randRange(cfg.click_input_x_range);
    const yFrac = rand(0.30, 0.70);
    return {
      x: Math.round(box.x + box.width * xFrac),
      y: Math.round(box.y + box.height * yFrac),
    };
  }
  // Button or generic element — near center
  const xFrac = rand(0.35, 0.65);
  const yFrac = rand(0.35, 0.65);
  return {
    x: Math.round(box.x + box.width * xFrac),
    y: Math.round(box.y + box.height * yFrac),
  };
}

/**
 * Perform a human-like click: mousedown → hold → mouseup.
 * The mouse must already be at the target position.
 */
export async function humanClick(
  page: Page,
  isInput: boolean,
  cfg: HumanConfig,
): Promise<void> {
  // Pre-click aiming delay
  const aimDelay = isInput
    ? randRange(cfg.click_aim_delay_input)
    : randRange(cfg.click_aim_delay_button);
  await sleep(aimDelay);

  // Click: down → hold → up
  const holdTime = isInput
    ? randRange(cfg.click_hold_input)
    : randRange(cfg.click_hold_button);
  await page.mouse.down();
  await sleep(holdTime);
  await page.mouse.up();
}

// ---------------------------------------------------------------------------
// Human idle / drift
// ---------------------------------------------------------------------------

/**
 * Idle drift: cursor stays roughly in place with tiny random movements.
 * Used when the "user" is reading or waiting.
 *
 * @param seconds - approximate duration of idle period
 * @param cx - current cursor X
 * @param cy - current cursor Y
 */
export async function humanIdle(
  page: Page,
  seconds: number,
  cx: number,
  cy: number,
  cfg: HumanConfig,
): Promise<void> {
  const endTime = Date.now() + seconds * 1000;
  let x = cx;
  let y = cy;
  while (Date.now() < endTime) {
    const dx = (Math.random() - 0.5) * 2 * cfg.idle_drift_px;
    const dy = (Math.random() - 0.5) * 2 * cfg.idle_drift_px;
    x += dx;
    y += dy;
    await page.mouse.move(Math.round(x), Math.round(y));
    await sleep(randRange(cfg.idle_pause_range));
  }
}
