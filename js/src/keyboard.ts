/**
 * cloakbrowser-human — Human-like keyboard input.
 *
 * Each character is typed via keyboard.down(key) → hold → keyboard.up(key).
 * Capital letters use Shift wrapping. Shift-symbols use insertText + synthetic
 * KeyboardEvents for realistic event logs.
 *
 * Delays between characters follow a gaussian-like distribution with occasional
 * long "thinking" pauses.
 */

import type { Page } from 'playwright-core';
import { HumanConfig, rand, randRange, sleep } from './config.js';

// ---------------------------------------------------------------------------
// Shift-symbol set — characters that require Shift on US QWERTY layout.
// These cannot be reliably typed via keyboard.down() across layouts, so we
// use insertText + synthetic keydown/keyup dispatched on document.activeElement.
// ---------------------------------------------------------------------------

const SHIFT_SYMBOLS = new Set([
  '@', '#', '!', '$', '%', '^', '&', '*', '(', ')',
  '_', '+', '{', '}', '|', ':', '"', '<', '>', '?', '~',
]);

// ---------------------------------------------------------------------------
// Human typing
// ---------------------------------------------------------------------------

/**
 * Type a string character-by-character with human-like timing.
 *
 * - Normal lowercase: keyboard.down(key) → hold → keyboard.up(key)
 * - Uppercase letters: Shift down → pause → key down → hold → key up → pause → Shift up
 * - Shift-symbols (@, #, etc.): Shift down → pause → insertText(ch) + synthetic keydown/keyup → pause → Shift up
 * - 10% chance of a long "thinking" pause between characters
 */
export async function humanType(
  page: Page,
  text: string,
  cfg: HumanConfig,
): Promise<void> {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (isUpperCase(ch)) {
      await typeShiftedChar(page, ch, cfg);
    } else if (SHIFT_SYMBOLS.has(ch)) {
      await typeShiftSymbol(page, ch, cfg);
    } else {
      await typeNormalChar(page, ch, cfg);
    }

    // Inter-character delay
    if (i < text.length - 1) {
      await interCharDelay(cfg);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: character type handlers
// ---------------------------------------------------------------------------

/** Type a normal (non-shifted) character via keydown/keyup. */
async function typeNormalChar(page: Page, ch: string, cfg: HumanConfig): Promise<void> {
  await page.keyboard.down(ch);
  await sleep(randRange(cfg.key_hold));
  await page.keyboard.up(ch);
}

/** Type an uppercase letter with Shift wrapping. */
async function typeShiftedChar(page: Page, ch: string, cfg: HumanConfig): Promise<void> {
  await page.keyboard.down('Shift');
  await sleep(randRange(cfg.shift_down_delay));

  await page.keyboard.down(ch);
  await sleep(randRange(cfg.key_hold));
  await page.keyboard.up(ch);

  await sleep(randRange(cfg.shift_up_delay));
  await page.keyboard.up('Shift');
}

/**
 * Type a shift-symbol (@, #, !, etc.) using insertText + synthetic keyboard events.
 *
 * Playwright's keyboard.down() doesn't reliably produce the correct symbol across
 * different keyboard layouts. insertText() inserts the character correctly but
 * doesn't generate keydown/keyup events. We combine both: Shift wrapping for
 * realistic modifier state + insertText for correct character + synthetic
 * keydown/keyup dispatched on document.activeElement for the event log.
 */
async function typeShiftSymbol(page: Page, ch: string, cfg: HumanConfig): Promise<void> {
  await page.keyboard.down('Shift');
  await sleep(randRange(cfg.shift_down_delay));

  // Insert the character (correct on any layout)
  await page.keyboard.insertText(ch);

  // Dispatch synthetic keydown/keyup on the focused element so sites see the events
  await page.evaluate((key: string) => {
    const el = document.activeElement;
    if (el) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    }
  }, ch);

  await sleep(randRange(cfg.shift_up_delay));
  await page.keyboard.up('Shift');
}

// ---------------------------------------------------------------------------
// Internal: helpers
// ---------------------------------------------------------------------------

function isUpperCase(ch: string): boolean {
  return ch.length === 1 && ch >= 'A' && ch <= 'Z';
}

/**
 * Delay between characters: base ± spread, with a chance of a long "thinking" pause.
 */
async function interCharDelay(cfg: HumanConfig): Promise<void> {
  if (Math.random() < cfg.typing_pause_chance) {
    // Long pause — human hesitating, looking at screen
    await sleep(randRange(cfg.typing_pause_range));
  } else {
    const delay = cfg.typing_delay + (Math.random() - 0.5) * 2 * cfg.typing_delay_spread;
    await sleep(Math.max(10, delay));
  }
}
