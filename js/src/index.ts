/**
 * cloakbrowser-human — Entry point.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { HumanConfig, HumanPreset, resolveConfig, rand, randRange, sleep } from './config.js';
import { RawMouse, RawKeyboard, humanMove, humanClick, clickTarget, humanIdle } from './mouse.js';
import { humanType } from './keyboard.js';
import { scrollToElement } from './scroll.js';

export { HumanConfig, HumanPreset, resolveConfig } from './config.js';
export { humanMove, humanClick, humanIdle, RawMouse, RawKeyboard } from './mouse.js';
export { humanType } from './keyboard.js';
export { scrollToElement } from './scroll.js';

// ---------------------------------------------------------------------------
// Launch options
// ---------------------------------------------------------------------------

export interface HumanLaunchOptions {
  headless?: boolean;
  humanPreset?: HumanPreset;
  humanConfig?: Partial<HumanConfig>;
  proxy?: string | { server: string; bypass?: string; username?: string; password?: string };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Coalesced events patch
// ---------------------------------------------------------------------------

const COALESCED_PATCH = `
(() => {
  if (window.__coalescedPatched) return;
  window.__coalescedPatched = true;
  const original = PointerEvent.prototype.getCoalescedEvents;
  PointerEvent.prototype.getCoalescedEvents = function() {
    const real = original.call(this);
    if (real.length <= 1) {
      const count = 1 + Math.floor(Math.random() * 3);
      const fake = [this];
      for (let i = 0; i < count; i++) {
        fake.push(new PointerEvent(this.type, {
          clientX: this.clientX + (Math.random() - 0.5) * 2,
          clientY: this.clientY + (Math.random() - 0.5) * 2,
          pointerId: this.pointerId,
          pointerType: this.pointerType,
          bubbles: false
        }));
      }
      return fake;
    }
    return real;
  };
})();
`;

async function injectCoalescedPatch(page: Page): Promise<void> {
  try {
    await page.evaluate(COALESCED_PATCH);
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Cursor state
// ---------------------------------------------------------------------------

interface CursorState {
  x: number;
  y: number;
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// Page patching
// ---------------------------------------------------------------------------

async function isInputElement(page: Page, selector: string): Promise<boolean> {
  try {
    return await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || el.getAttribute('contenteditable') === 'true';
    }, selector);
  } catch {
    return false;
  }
}

function patchPage(page: Page, cfg: HumanConfig, cursor: CursorState): void {
  // Store originals
  const originals = {
    click: page.click.bind(page),
    type: page.type.bind(page),
    goto: page.goto.bind(page),
    mouseMove: page.mouse.move.bind(page.mouse),
    mouseClick: page.mouse.click.bind(page.mouse),
    mouseWheel: page.mouse.wheel.bind(page.mouse),
    mouseDown: page.mouse.down.bind(page.mouse),
    mouseUp: page.mouse.up.bind(page.mouse),
    keyboardType: page.keyboard.type.bind(page.keyboard),
    keyboardDown: page.keyboard.down.bind(page.keyboard),
    keyboardUp: page.keyboard.up.bind(page.keyboard),
    keyboardInsertText: page.keyboard.insertText.bind(page.keyboard),
  };

  (page as any)._original = originals;

  // Raw interfaces — pass these to humanMove/humanClick/etc
  // so they call originals, not the patched methods
  const rawMouse: RawMouse = {
    move: originals.mouseMove,
    down: originals.mouseDown,
    up: originals.mouseUp,
    wheel: originals.mouseWheel,
  };

  const rawKeyboard: RawKeyboard = {
    down: originals.keyboardDown,
    up: originals.keyboardUp,
    type: originals.keyboardType,
    insertText: originals.keyboardInsertText,
  };

  // Initialize cursor
  async function ensureCursorInit(): Promise<void> {
    if (!cursor.initialized) {
      cursor.x = rand(cfg.initial_cursor_x[0], cfg.initial_cursor_x[1]);
      cursor.y = rand(cfg.initial_cursor_y[0], cfg.initial_cursor_y[1]);
      await originals.mouseMove(cursor.x, cursor.y);
      cursor.initialized = true;
    }
  }

  // --- page.goto() ---
  (page as any).goto = async function (url: string, options?: any) {
    const response = await originals.goto(url, options);
    if (cfg.patch_coalesced) {
      await injectCoalescedPatch(page);
    }
    return response;
  };

  // --- page.click(selector) ---
  (page as any).click = async function (selector: string, options?: any) {
    await ensureCursorInit();

    const { box, cursorX, cursorY } = await scrollToElement(
      page, rawMouse, selector, cursor.x, cursor.y, cfg,
    );
    cursor.x = cursorX;
    cursor.y = cursorY;

    const isInput = await isInputElement(page, selector);
    const target = clickTarget(box, isInput, cfg);

    await humanMove(rawMouse, cursor.x, cursor.y, target.x, target.y, cfg);
    cursor.x = target.x;
    cursor.y = target.y;

    await humanClick(rawMouse, isInput, cfg);
  };

  // --- page.type(selector, text) ---
  (page as any).type = async function (selector: string, text: string, options?: any) {
    await sleep(randRange(cfg.field_switch_delay));
    await (page as any).click(selector);
    await sleep(rand(100, 250));
    await humanType(page, rawKeyboard, text, cfg);
  };

  // --- page.mouse.move(x, y) ---
  (page as any).mouse.move = async function (x: number, y: number, options?: any) {
    await ensureCursorInit();
    await humanMove(rawMouse, cursor.x, cursor.y, x, y, cfg);
    cursor.x = x;
    cursor.y = y;
  };

  // --- page.mouse.click(x, y) ---
  (page as any).mouse.click = async function (x: number, y: number, options?: any) {
    await ensureCursorInit();
    await humanMove(rawMouse, cursor.x, cursor.y, x, y, cfg);
    cursor.x = x;
    cursor.y = y;
    await humanClick(rawMouse, false, cfg);
  };

  // --- page.keyboard.type(text) ---
  (page as any).keyboard.type = async function (text: string, options?: any) {
    await humanType(page, rawKeyboard, text, cfg);
  };
}

// ---------------------------------------------------------------------------
// Browser / Context patching
// ---------------------------------------------------------------------------

function patchContext(context: BrowserContext, cfg: HumanConfig): void {
  const cursor: CursorState = { x: 0, y: 0, initialized: false };

  for (const page of context.pages()) {
    patchPage(page, cfg, cursor);
  }

  context.on('page', (page: Page) => {
    patchPage(page, cfg, cursor);
  });
}

function patchBrowser(browser: Browser, cfg: HumanConfig): void {
  for (const context of browser.contexts()) {
    patchContext(context, cfg);
  }

  const origNewContext = browser.newContext.bind(browser);
  (browser as any).newContext = async function (...args: any[]) {
    const context = await origNewContext(...args);
    patchContext(context, cfg);
    return context;
  };

  (browser as any).newPage = async function (options?: any) {
    const context = await (browser as any).newContext(options);
    const page = await context.newPage();
    return page;
  };

}

// ---------------------------------------------------------------------------
// launch()
// ---------------------------------------------------------------------------

export async function launch(options: HumanLaunchOptions = {}): Promise<Browser> {
  const {
    humanPreset = 'default',
    humanConfig: humanOverrides,
    headless = false,
    ...cloakOptions
  } = options;

  const cfg = resolveConfig(humanPreset, humanOverrides);

  const cloakbrowser = await import('cloakbrowser');
  const browser = await cloakbrowser.launch({
    headless,
    ...cloakOptions,
  });

  patchBrowser(browser, cfg);
  return browser;
}

export async function launchContext(options: HumanLaunchOptions = {}): Promise<BrowserContext> {
  const {
    humanPreset = 'default',
    humanConfig: humanOverrides,
    headless = false,
    ...cloakOptions
  } = options;

  const cfg = resolveConfig(humanPreset, humanOverrides);

  const cloakbrowser = await import('cloakbrowser');
  const context = await cloakbrowser.launchContext({
    headless,
    ...cloakOptions,
  });

  patchContext(context, cfg);
  return context;
}
