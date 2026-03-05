"""cloakbrowser-human — Human-like Playwright wrapper for CloakBrowser.

Drop-in replacement that intercepts page.click(), page.type(), mouse.move(),
mouse.click(), keyboard.type(), and mouse.wheel() — replacing them with
human-like implementations featuring Bezier curves, natural timing, and
realistic scroll behavior.

Usage:
    from cloakbrowser_human import launch

    browser = launch(headless=False, human_preset="default")
    page = browser.new_page()
    page.goto("https://example.com")
    page.click('input[type="email"]')
    page.type('input[type="email"]', "test@mail.com")
    browser.close()
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from .config import HumanConfig, HumanPreset, resolve_config, rand, rand_range, sleep_ms
from .mouse import human_move, human_click, click_target, human_idle
from .keyboard import human_type
from .scroll import scroll_to_element

__all__ = [
    "launch",
    "launch_context",
    "HumanConfig",
    "HumanPreset",
    "resolve_config",
    "human_move",
    "human_click",
    "click_target",
    "human_idle",
    "human_type",
    "scroll_to_element",
]

__version__ = "0.1.0"

logger = logging.getLogger("cloakbrowser-human")

# ---------------------------------------------------------------------------
# Coalesced events patch (experimental)
# ---------------------------------------------------------------------------

_COALESCED_PATCH = """
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
"""


def _inject_coalesced_patch(page: Any) -> None:
    """Inject the coalesced PointerEvent patch into a page.

    **Experimental**: CDP Input.dispatchMouseEvent doesn't generate coalesced
    points, so sites that check getCoalescedEvents() see length=1 (bot signal).
    This patch fabricates 1-3 additional coalesced points with tiny offsets.

    Must be called via page.evaluate() AFTER page.goto(), not via
    add_init_script() — the latter breaks HTTP proxy auth in patchright-python.
    """
    try:
        page.evaluate(_COALESCED_PATCH)
    except Exception:
        # Page may have navigated or crashed — non-fatal
        pass


# ---------------------------------------------------------------------------
# Cursor state
# ---------------------------------------------------------------------------

class _CursorState:
    __slots__ = ("x", "y", "initialized")

    def __init__(self) -> None:
        self.x: float = 0
        self.y: float = 0
        self.initialized: bool = False


# ---------------------------------------------------------------------------
# Element type detection
# ---------------------------------------------------------------------------

def _is_input_element(page: Any, selector: str) -> bool:
    """Detect if an element is an input/textarea/contenteditable."""
    try:
        return page.evaluate(
            """(sel) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                const tag = el.tagName.toLowerCase();
                return tag === 'input' || tag === 'textarea' || el.getAttribute('contenteditable') === 'true';
            }""",
            selector,
        )
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Page patching
# ---------------------------------------------------------------------------

def _patch_page(page: Any, cfg: HumanConfig, cursor: _CursorState) -> None:
    """Patch a Page object, replacing methods with human-like implementations.

    Originals are stored in page._original.
    """
    # Store originals
    originals = type("Originals", (), {
        "click": page.click,
        "type": page.type,
        "goto": page.goto,
        "mouse_move": page.mouse.move,
        "mouse_click": page.mouse.click,
        "mouse_wheel": page.mouse.wheel,
        "mouse_down": page.mouse.down,
        "mouse_up": page.mouse.up,
        "keyboard_type": page.keyboard.type,
        "keyboard_down": page.keyboard.down,
        "keyboard_up": page.keyboard.up,
        "keyboard_insert_text": page.keyboard.insert_text,
    })()

    page._original = originals

    def _ensure_cursor_init() -> None:
        if not cursor.initialized:
            cursor.x = rand(cfg.initial_cursor_x[0], cfg.initial_cursor_x[1])
            cursor.y = rand(cfg.initial_cursor_y[0], cfg.initial_cursor_y[1])
            originals.mouse_move(cursor.x, cursor.y)
            cursor.initialized = True

    # --- page.goto() --- inject coalesced patch after navigation
    def _human_goto(url: str, **kwargs: Any) -> Any:
        response = originals.goto(url, **kwargs)
        if cfg.patch_coalesced:
            _inject_coalesced_patch(page)
        return response

    # --- page.click(selector) --- full human flow: scroll -> move -> aim -> click
    def _human_click(selector: str, **kwargs: Any) -> None:
        _ensure_cursor_init()

        # Scroll to element if needed
        box, cx, cy = scroll_to_element(page, selector, cursor.x, cursor.y, cfg)
        cursor.x = cx
        cursor.y = cy

        # Determine click target point
        is_input = _is_input_element(page, selector)
        target = click_target(box, is_input, cfg)

        # Move to target
        human_move(page, cursor.x, cursor.y, target.x, target.y, cfg)
        cursor.x = target.x
        cursor.y = target.y

        # Click
        human_click(page, is_input, cfg)

    # --- page.type(selector, text) --- click field first, then type
    def _human_type(selector: str, text: str, **kwargs: Any) -> None:
        # Field switch delay
        sleep_ms(rand_range(cfg.field_switch_delay))

        # Click into the field first
        _human_click(selector)

        # Brief pause after clicking before typing
        sleep_ms(rand(100, 250))

        # Type
        human_type(page, text, cfg)

    # --- page.mouse.move(x, y) ---
    def _human_mouse_move(x: float, y: float, **kwargs: Any) -> None:
        _ensure_cursor_init()
        human_move(page, cursor.x, cursor.y, x, y, cfg)
        cursor.x = x
        cursor.y = y

    # --- page.mouse.click(x, y) ---
    def _human_mouse_click(x: float, y: float, **kwargs: Any) -> None:
        _ensure_cursor_init()
        human_move(page, cursor.x, cursor.y, x, y, cfg)
        cursor.x = x
        cursor.y = y
        human_click(page, False, cfg)

    # --- page.keyboard.type(text) ---
    def _human_keyboard_type(text: str, **kwargs: Any) -> None:
        human_type(page, text, cfg)

    # Apply patches
    page.goto = _human_goto
    page.click = _human_click
    page.type = _human_type
    page.mouse.move = _human_mouse_move
    page.mouse.click = _human_mouse_click
    page.keyboard.type = _human_keyboard_type


# ---------------------------------------------------------------------------
# Browser patching
# ---------------------------------------------------------------------------

def _patch_browser(browser: Any, cfg: HumanConfig) -> None:
    """Patch a Browser so all new contexts and pages are automatically patched."""
    # Patch existing contexts
    for context in browser.contexts:
        _patch_context(context, cfg)

    # Intercept new_context to patch future contexts
    orig_new_context = browser.new_context

    def _patched_new_context(**kwargs: Any) -> Any:
        context = orig_new_context(**kwargs)
        _patch_context(context, cfg)
        return context

    browser.new_context = _patched_new_context

    # Intercept new_page to patch standalone pages
    orig_new_page = browser.new_page

    def _patched_new_page(**kwargs: Any) -> Any:
        page = orig_new_page(**kwargs)
        cursor = _CursorState()
        _patch_page(page, cfg, cursor)
        return page

    browser.new_page = _patched_new_page


def _patch_context(context: Any, cfg: HumanConfig) -> None:
    """Patch a BrowserContext so all new pages are automatically patched."""
    cursor = _CursorState()

    # Patch existing pages
    for page in context.pages:
        _patch_page(page, cfg, cursor)

    # Patch future pages
    context.on("page", lambda page: _patch_page(page, cfg, cursor))


# ---------------------------------------------------------------------------
# launch()
# ---------------------------------------------------------------------------

def launch(
    headless: bool = False,
    human_preset: HumanPreset = "default",
    human_config: dict | None = None,
    proxy: str | dict | None = None,
    **kwargs: Any,
) -> Any:
    """Launch CloakBrowser with human-like behavior patching.

    Works identically to cloakbrowser's launch(), but all pages created
    from the returned browser will have their click/type/mouse/keyboard
    methods replaced with human-like implementations.

    Args:
        headless: Run in headless mode (default False — human sim is visual).
        human_preset: 'default' or 'careful' behavior preset.
        human_config: Dict of individual parameter overrides.
        proxy: Proxy URL or Playwright proxy dict.
        **kwargs: Passed through to cloakbrowser.launch().

    Returns:
        Patched Playwright Browser object.

    Example:
        >>> from cloakbrowser_human import launch
        >>> browser = launch(headless=False, human_preset="default")
        >>> page = browser.new_page()
        >>> page.goto("https://example.com")
        >>> page.click('input[type="email"]')
        >>> page.type('input[type="email"]', "test@mail.com")
        >>> browser.close()
    """
    import cloakbrowser

    cfg = resolve_config(human_preset, human_config)

    browser = cloakbrowser.launch(
        headless=headless,
        proxy=proxy,
        **kwargs,
    )

    _patch_browser(browser, cfg)
    return browser


def launch_context(
    headless: bool = False,
    human_preset: HumanPreset = "default",
    human_config: dict | None = None,
    proxy: str | dict | None = None,
    **kwargs: Any,
) -> Any:
    """Launch CloakBrowser with human-like behavior and return a BrowserContext.

    Convenience wrapper around cloakbrowser's launch_context().

    Args:
        headless: Run in headless mode (default False).
        human_preset: 'default' or 'careful' behavior preset.
        human_config: Dict of individual parameter overrides.
        proxy: Proxy URL or Playwright proxy dict.
        **kwargs: Passed through to cloakbrowser.launch_context().

    Returns:
        Patched Playwright BrowserContext object.
    """
    import cloakbrowser

    cfg = resolve_config(human_preset, human_config)

    context = cloakbrowser.launch_context(
        headless=headless,
        proxy=proxy,
        **kwargs,
    )

    _patch_context(context, cfg)
    return context
