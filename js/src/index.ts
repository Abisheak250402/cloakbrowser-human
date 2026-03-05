/**
 * cloakbrowser-human — Entry point.
 *
 * Wraps CloakBrowser's launch() and intercepts Playwright Page methods
 * (click, type, mouse.move, mouse.click, keyboard.type, mouse.wheel)
 * replacing them with human-like implementations.
 *
 * Original methods remain accessible via page._original.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { HumanConfig, HumanPreset, resolveConfig, rand, randRange, sleep } from './config.js';
import { humanMove, humanClick, clickTarget, humanIdle } from './mouse.js';
import { humanType } from './keyboard.js';
import { scrollToElement } from './scroll.js';

// Re-export for user convenience
export { HumanConfig, HumanPreset, resolveConfig } from './config.js';
export { humanMove, humanClick, humanIdle } from './mouse.js';
export { humanType } from './keyboard.js';
export { scrollToElement } from './scroll.js';

// ---------------------------------------------------------------------------
// Launch options
// ---------------------------------------------------------------------------

export interface HumanLaunchOptions {
  /** Run in headless mode (default: false — human simulation is visual). */
  headless?: boolean;
  /** Human behavior preset: 'default' or 'careful'. */
  humanPreset?: HumanPreset;
  /** Override individual human config parameters. */
  humanConfig?: Partial<HumanConfig>;
  /** Proxy URL string or Playwright proxy object. */
  proxy?: string | { server: string; bypass?: string; username?: string; password?: string };
  /** Any additional options passed through to cloakbrowser's launch(). */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Coalesced events patch (experimental)
// ---------------------------------------------------------------------------

/**
 * Inject the coalesced PointerEvent patch into a page.
 *
 * CDP Input.dispatchMouseEvent doesn't generate coalesced points, so sites
 * that check getCoalescedEvents() see length=1 (bot signal). This patch
 * fabricates 1-3 additional coalesced points with tiny offsets.
 *
 * **Experimental**: advanced anti-fraud may detect this via toString(),
 * cross-origin iframe comparison, or web workers.
 *
 * Must be called via page.evaluate() AFTER page.goto(), not via
 * addInitScript() — the latter breaks HTTP proxy auth in patchright-python.
 */
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
    // Page may have navigated or crashed — non-fatal
  }
}

// ---------------------------------------------------------------------------
// Cursor state tracking
// ---------------------------------------------------------------------------

interface CursorState {
  x: number;
  y: number;
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// Page patching
// ---------------------------------------------------------------------------

/**
 * Detect if an element is an input/textarea.
 */
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

/**
 * Patch a Page object, replacing click/type/mouse/keyboard methods with
 * human-like implementations. Originals are stored in page._original.
 */
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

  // Initialize cursor position (simulate coming from address bar)
  async function ensureCursorInit(): Promise<void> {
    if (!cursor.initialized) {
      cursor.x = rand(cfg.initial_cursor_x[0], cfg.initial_cursor_x[1]);
      cursor.y = rand(cfg.initial_cursor_y[0], cfg.initial_cursor_y[1]);
      await originals.mouseMove(cursor.x, cursor.y);
      cursor.initialized = true;
    }
  }

  // --- page.goto() --- inject coalesced patch after navigation
  (page as any).goto = async function (url: string, options?: any) {
    const response = await originals.goto(url, options);
    if (cfg.patch_coalesced) {
      await injectCoalescedPatch(page);
    }
    return response;
  };

  // --- page.click(selector) --- full human flow: scroll → move → aim → click
  (page as any).click = async function (selector: string, options?: any) {
    await ensureCursorInit();

    // Scroll to element if needed
    const { box, cursorX, cursorY } = await scrollToElement(
      page, selector, cursor.x, cursor.y, cfg,
    );
    cursor.x = cursorX;
    cursor.y = cursorY;

    // Determine click target point
    const isInput = await isInputElement(page, selector);
    const target = clickTarget(box, isInput, cfg);

    // Move to target
    await humanMove(page, cursor.x, cursor.y, target.x, target.y, cfg);
    cursor.x = target.x;
    cursor.y = target.y;

    // Click
    await humanClick(page, isInput, cfg);
  };

  // --- page.type(selector, text) --- click field first, then type
  (page as any).type = async function (selector: string, text: string, options?: any) {
    // Field switch delay (simulates human looking at the next field)
    await sleep(randRange(cfg.field_switch_delay));

    // Click into the field first
    await (page as any).click(selector);

    // Brief pause after clicking before typing (human settles)
    await sleep(rand(100, 250));

    // Type
    await humanType(page, text, cfg);
  };

  // --- page.mouse.move(x, y) ---
  (page as any).mouse.move = async function (x: number, y: number, options?: any) {
    await ensureCursorInit();
    await humanMove(page, cursor.x, cursor.y, x, y, cfg);
    cursor.x = x;
    cursor.y = y;
  };

  // --- page.mouse.click(x, y) ---
  (page as any).mouse.click = async function (x: number, y: number, options?: any) {
    await ensureCursorInit();
    await humanMove(page, cursor.x, cursor.y, x, y, cfg);
    cursor.x = x;
    cursor.y = y;
    await humanClick(page, false, cfg);
  };

  // --- page.keyboard.type(text) ---
  (page as any).keyboard.type = async function (text: string, options?: any) {
    await humanType(page, text, cfg);
  };
}

// ---------------------------------------------------------------------------
// Browser / Context patching
// ---------------------------------------------------------------------------

/**
 * Patch a BrowserContext so all new pages are automatically patched.
 */
function patchContext(context: BrowserContext, cfg: HumanConfig): void {
  const cursor: CursorState = { x: 0, y: 0, initialized: false };

  // Patch existing pages
  for (const page of context.pages()) {
    patchPage(page, cfg, cursor);
  }

  // Patch future pages
  context.on('page', (page: Page) => {
    patchPage(page, cfg, cursor);
  });
}

/**
 * Patch a Browser so all new contexts and pages are automatically patched.
 */
function patchBrowser(browser: Browser, cfg: HumanConfig): void {
  // Patch existing contexts
  for (const context of browser.contexts()) {
    patchContext(context, cfg);
  }

  // Intercept newContext to patch future contexts
  const origNewContext = browser.newContext.bind(browser);
  (browser as any).newContext = async function (...args: any[]) {
    const context = await origNewContext(...args);
    patchContext(context, cfg);
    return context;
  };

  // Intercept newPage to patch standalone pages
  const origNewPage = browser.newPage.bind(browser);
  (browser as any).newPage = async function (...args: any[]) {
    const page = await origNewPage(...args);
    const cursor: CursorState = { x: 0, y: 0, initialized: false };
    patchPage(page, cfg, cursor);
    return page;
  };
}

// ---------------------------------------------------------------------------
// launch()
// ---------------------------------------------------------------------------

/**
 * Launch CloakBrowser with human-like behavior patching.
 *
 * Works identically to cloakbrowser's `launch()`, but all pages created
 * from the returned browser will have their click/type/mouse/keyboard
 * methods replaced with human-like implementations.
 *
 * @example
 * ```ts
 * import { launch } from 'cloakbrowser-human';
 *
 * const browser = await launch({ headless: false, humanPreset: 'default' });
 * const page = await browser.newPage();
 * await page.goto('https://example.com');
 * await page.click('input[type="email"]');
 * await page.type('input[type="email"]', 'test@mail.com');
 * await browser.close();
 * ```
 */
export async function launch(options: HumanLaunchOptions = {}): Promise<Browser> {
  const {
    humanPreset = 'default',
    humanConfig: humanOverrides,
    headless = false,
    ...cloakOptions
  } = options;

  const cfg = resolveConfig(humanPreset, humanOverrides);

  // Dynamic import so cloakbrowser is a peer dependency, not bundled
  const cloakbrowser = await import('cloakbrowser');
  const browser = await cloakbrowser.launch({
    headless,
    ...cloakOptions,
  });

  patchBrowser(browser, cfg);
  return browser;
}

/**
 * Launch CloakBrowser with human-like behavior and return a BrowserContext.
 * Convenience wrapper around cloakbrowser's launchContext().
 */
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
