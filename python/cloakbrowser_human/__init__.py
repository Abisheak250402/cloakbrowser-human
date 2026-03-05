"""cloakbrowser-human — Human-like Playwright wrapper for CloakBrowser."""

from __future__ import annotations

import logging
from typing import Any, Optional

from .config import HumanConfig, HumanPreset, resolve_config, rand, rand_range, sleep_ms
from .mouse import RawMouse, RawKeyboard, human_move, human_click, click_target, human_idle
from .keyboard import human_type
from .scroll import scroll_to_element

__all__ = [
    "launch", "launch_context",
    "HumanConfig", "HumanPreset", "resolve_config",
    "human_move", "human_click", "click_target", "human_idle",
    "human_type", "scroll_to_element",
]
__version__ = "0.1.0"

logger = logging.getLogger("cloakbrowser-human")

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
    try:
        page.evaluate(_COALESCED_PATCH)
    except Exception:
        pass


class _CursorState:
    __slots__ = ("x", "y", "initialized")
    def __init__(self) -> None:
        self.x: float = 0
        self.y: float = 0
        self.initialized: bool = False


def _is_input_element(page: Any, selector: str) -> bool:
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


def _patch_page(page: Any, cfg: HumanConfig, cursor: _CursorState) -> None:
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

    raw_mouse: RawMouse = type("_RawMouse", (), {
        "move": originals.mouse_move,
        "down": originals.mouse_down,
        "up": originals.mouse_up,
        "wheel": originals.mouse_wheel,
    })()

    raw_keyboard: RawKeyboard = type("_RawKeyboard", (), {
        "down": originals.keyboard_down,
        "up": originals.keyboard_up,
        "type": originals.keyboard_type,
        "insert_text": originals.keyboard_insert_text,
    })()

    def _ensure_cursor_init() -> None:
        if not cursor.initialized:
            cursor.x = rand(cfg.initial_cursor_x[0], cfg.initial_cursor_x[1])
            cursor.y = rand(cfg.initial_cursor_y[0], cfg.initial_cursor_y[1])
            originals.mouse_move(cursor.x, cursor.y)
            cursor.initialized = True

    def _human_goto(url: str, **kwargs: Any) -> Any:
        response = originals.goto(url, **kwargs)
        if cfg.patch_coalesced:
            _inject_coalesced_patch(page)
        return response

    def _human_click(selector: str, **kwargs: Any) -> None:
        _ensure_cursor_init()
        box, cx, cy = scroll_to_element(page, raw_mouse, selector, cursor.x, cursor.y, cfg)
        cursor.x = cx
        cursor.y = cy
        is_input = _is_input_element(page, selector)
        target = click_target(box, is_input, cfg)
        human_move(raw_mouse, cursor.x, cursor.y, target.x, target.y, cfg)
        cursor.x = target.x
        cursor.y = target.y
        human_click(raw_mouse, is_input, cfg)

    def _human_type(selector: str, text: str, **kwargs: Any) -> None:
        sleep_ms(rand_range(cfg.field_switch_delay))
        _human_click(selector)
        sleep_ms(rand(100, 250))
        human_type(page, raw_keyboard, text, cfg)

    def _human_mouse_move(x: float, y: float, **kwargs: Any) -> None:
        _ensure_cursor_init()
        human_move(raw_mouse, cursor.x, cursor.y, x, y, cfg)
        cursor.x = x
        cursor.y = y

    def _human_mouse_click(x: float, y: float, **kwargs: Any) -> None:
        _ensure_cursor_init()
        human_move(raw_mouse, cursor.x, cursor.y, x, y, cfg)
        cursor.x = x
        cursor.y = y
        human_click(raw_mouse, False, cfg)

    def _human_keyboard_type(text: str, **kwargs: Any) -> None:
        human_type(page, raw_keyboard, text, cfg)

    page.goto = _human_goto
    page.click = _human_click
    page.type = _human_type
    page.mouse.move = _human_mouse_move
    page.mouse.click = _human_mouse_click
    page.keyboard.type = _human_keyboard_type


def _patch_context(context: Any, cfg: HumanConfig) -> None:
    cursor = _CursorState()
    for page in context.pages:
        _patch_page(page, cfg, cursor)
    context.on("page", lambda page: _patch_page(page, cfg, cursor))


def _patch_browser(browser: Any, cfg: HumanConfig) -> None:
    for context in browser.contexts:
        _patch_context(context, cfg)

    orig_new_context = browser.new_context

    def _patched_new_context(**kwargs: Any) -> Any:
        context = orig_new_context(**kwargs)
        _patch_context(context, cfg)
        return context

    browser.new_context = _patched_new_context

    # Fix: use new_context inside new_page to avoid slow CDP round-trip
    def _patched_new_page(**kwargs: Any) -> Any:
        context = browser.new_context(**kwargs)
        page = context.new_page()
        return page

    browser.new_page = _patched_new_page


def launch(
    headless: bool = False,
    human_preset: HumanPreset = "default",
    human_config: dict | None = None,
    proxy: str | dict | None = None,
    **kwargs: Any,
) -> Any:
    import cloakbrowser
    cfg = resolve_config(human_preset, human_config)
    browser = cloakbrowser.launch(headless=headless, proxy=proxy, **kwargs)
    _patch_browser(browser, cfg)
    return browser


def launch_context(
    headless: bool = False,
    human_preset: HumanPreset = "default",
    human_config: dict | None = None,
    proxy: str | dict | None = None,
    **kwargs: Any,
) -> Any:
    import cloakbrowser
    cfg = resolve_config(human_preset, human_config)
    context = cloakbrowser.launch_context(headless=headless, proxy=proxy, **kwargs)
    _patch_context(context, cfg)
    return context
