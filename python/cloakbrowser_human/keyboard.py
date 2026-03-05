"""cloakbrowser-human — Human-like keyboard input.

Each character is typed via keyboard.down(key) -> hold -> keyboard.up(key).
Capital letters use Shift wrapping. Shift-symbols use insert_text + synthetic
KeyboardEvents for realistic event logs.
"""

from __future__ import annotations

import random
from typing import TYPE_CHECKING

from .config import HumanConfig, rand, rand_range, sleep_ms

if TYPE_CHECKING:
    from patchright.sync_api import Page

# ---------------------------------------------------------------------------
# Shift-symbol set — characters that require Shift on US QWERTY layout.
# These cannot be reliably typed via keyboard.down() across layouts, so we
# use insert_text + synthetic keydown/keyup dispatched on document.activeElement.
# ---------------------------------------------------------------------------

SHIFT_SYMBOLS = frozenset(
    "@#!$%^&*()_+{}|:\"<>?~"
)


# ---------------------------------------------------------------------------
# Human typing
# ---------------------------------------------------------------------------

def human_type(page: Page, text: str, cfg: HumanConfig) -> None:
    """Type a string character-by-character with human-like timing.

    - Normal lowercase: keyboard.down(key) -> hold -> keyboard.up(key)
    - Uppercase letters: Shift down -> pause -> key down -> hold -> key up -> pause -> Shift up
    - Shift-symbols (@, #, etc.): Shift down -> pause -> insert_text(ch) + synthetic events -> Shift up
    - Chance of a long 'thinking' pause between characters
    """
    for i, ch in enumerate(text):
        if ch.isupper() and ch.isalpha():
            _type_shifted_char(page, ch, cfg)
        elif ch in SHIFT_SYMBOLS:
            _type_shift_symbol(page, ch, cfg)
        else:
            _type_normal_char(page, ch, cfg)

        # Inter-character delay
        if i < len(text) - 1:
            _inter_char_delay(cfg)


# ---------------------------------------------------------------------------
# Internal: character type handlers
# ---------------------------------------------------------------------------

def _type_normal_char(page: Page, ch: str, cfg: HumanConfig) -> None:
    """Type a normal (non-shifted) character via keydown/keyup."""
    page.keyboard.down(ch)
    sleep_ms(rand_range(cfg.key_hold))
    page.keyboard.up(ch)


def _type_shifted_char(page: Page, ch: str, cfg: HumanConfig) -> None:
    """Type an uppercase letter with Shift wrapping."""
    page.keyboard.down("Shift")
    sleep_ms(rand_range(cfg.shift_down_delay))

    page.keyboard.down(ch)
    sleep_ms(rand_range(cfg.key_hold))
    page.keyboard.up(ch)

    sleep_ms(rand_range(cfg.shift_up_delay))
    page.keyboard.up("Shift")


def _type_shift_symbol(page: Page, ch: str, cfg: HumanConfig) -> None:
    """Type a shift-symbol using insert_text + synthetic keyboard events.

    Playwright's keyboard.down() doesn't reliably produce the correct symbol across
    different keyboard layouts. insert_text() inserts the character correctly but
    doesn't generate keydown/keyup events. We combine both: Shift wrapping for
    realistic modifier state + insert_text for correct character + synthetic
    keydown/keyup dispatched on document.activeElement for the event log.
    """
    page.keyboard.down("Shift")
    sleep_ms(rand_range(cfg.shift_down_delay))

    # Insert the character (correct on any layout)
    page.keyboard.insert_text(ch)

    # Dispatch synthetic keydown/keyup on the focused element
    page.evaluate(
        """(key) => {
            const el = document.activeElement;
            if (el) {
                el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
            }
        }""",
        ch,
    )

    sleep_ms(rand_range(cfg.shift_up_delay))
    page.keyboard.up("Shift")


# ---------------------------------------------------------------------------
# Internal: helpers
# ---------------------------------------------------------------------------

def _inter_char_delay(cfg: HumanConfig) -> None:
    """Delay between characters: base +/- spread, with a chance of a long thinking pause."""
    if random.random() < cfg.typing_pause_chance:
        # Long pause — human hesitating
        sleep_ms(rand_range(cfg.typing_pause_range))
    else:
        delay = cfg.typing_delay + (random.random() - 0.5) * 2 * cfg.typing_delay_spread
        sleep_ms(max(10, delay))
