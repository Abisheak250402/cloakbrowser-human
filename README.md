#  THIS PACKAGE IS CURRENTLY NOT SUPPORTED. ALL FUNCTIONS AND UPDATES WERE MERGED DIRECTLY IN [CloakBrowser](https://github.com/CloakHQ/cloakbrowser). IT HANDLES ALL LOCATOR API METHODS, SO GO ON AND TEST IT. 1 LINE ADDED. CDP FIXED FROM BINARY.

# cloakbrowser-human

**Human-like mouse, keyboard, and scroll for [CloakBrowser](https://github.com/CloakHQ/cloakbrowser).**

Drop-in Playwright wrapper that defeats behavioral bot detection. Write normal Playwright code — the wrapper automatically adds realistic Bezier mouse curves, natural typing rhythms, and smooth wheel-based scrolling.

CloakBrowser solves **fingerprint detection** (WebDriver, CDP, headless flags, GPU inconsistencies). `cloakbrowser-human` solves **behavioral detection** — sites that analyze mouse movement patterns, typing cadence, click coordinates, scroll velocity, and other interaction signals to distinguish humans from bots.

## Motivation

This project was inspired by discussions in the CloakBrowser community about behavioral detection — the growing category of anti-bot systems that go beyond fingerprinting and analyze how users actually interact with a page. Tools like [ghost-cursor](https://github.com/createcontainer/ghost-cursor) address mouse movement in isolation, but no existing solution covers the full picture: mouse trajectories, click timing, typing cadence, scroll patterns, and Shift key handling — all tuned to work together as a drop-in Playwright wrapper.

`cloakbrowser-human` is a **companion package** to [CloakBrowser](https://github.com/CloakHQ/cloakbrowser), not a replacement. CloakBrowser handles the hard part — making Chromium invisible to fingerprint-based detection (WebDriver flags, CDP leaks, headless signals, GPU inconsistencies, and more). This wrapper adds the behavioral layer on top: realistic interaction patterns that satisfy sites analyzing mouse movement entropy, typing speed distributions, and click coordinate variance.

This is a **temporary high-level solution**. The long-term goal is to integrate behavioral humanization directly into the CloakBrowser binary — particularly for signals like [coalesced pointer events](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents), which cannot be fully fixed from a JavaScript wrapper due to Chromium's internal event pipeline. Until that binary-level work is complete, `cloakbrowser-human` bridges the gap and passes current behavioral detection benchmarks.

Special thanks to the contributors who reported behavioral detection failures and helped shape the requirements for this package.

## Demo

| Without wrapper (bot) | With wrapper (human) |
|---|---|
| ![Bot movement](assets/demo-robot.gif) | ![Human movement](assets/demo-human.gif) |

*Straight-line teleportation vs. Bezier curves with wobble, natural scroll, realistic typing.*

## Installation

### JavaScript / Node.js

```bash
npm install cloakbrowser-human
```

> `cloakbrowser` is a required peer dependency — install it separately if you haven't already:
> ```bash
> npm install cloakbrowser
> ```

### Python

```bash
pip install cloakbrowser-human
```

> `cloakbrowser` is installed automatically as a dependency.

## Quick Start

### JavaScript

```javascript
import { launch } from 'cloakbrowser-human';

const browser = await launch({
  headless: false,
  humanPreset: 'default',
  proxy: 'http://user:pass@host:port',
});

const page = await browser.newPage();
await page.goto('https://example.com');

// These look like normal Playwright calls, but execute with human-like behavior:
await page.click('input[type="email"]');
await page.type('input[type="email"]', 'user@example.com');
await page.click('input[type="password"]');
await page.type('input[type="password"]', 'MyP@ssw0rd!');
await page.click('button[type="submit"]');

await browser.close();
```

### Python

```python
from cloakbrowser_human import launch

browser = launch(headless=False, human_preset="default", proxy="http://user:pass@host:port")
page = browser.new_page()
page.goto("https://example.com")

# These look like normal Playwright calls, but execute with human-like behavior:
page.click('input[type="email"]')
page.type('input[type="email"]', "user@example.com")
page.click('input[type="password"]')
page.type('input[type="password"]', "MyP@ssw0rd!")
page.click('button[type="submit"]')

browser.close()
```

## What the Wrapper Does

The wrapper intercepts standard Playwright methods and replaces them with human-like implementations. You write the same code — the behavior changes underneath.

| Playwright Method | What Changes |
|---|---|
| `page.click(selector)` | Auto-scrolls to element via mouse wheel → moves cursor along Bezier curve → aims at realistic click point (left third for inputs, center for buttons) → mousedown/hold/mouseup with natural timing |
| `page.type(selector, text)` | Clicks into field first → types each character via keydown/hold/keyup → Shift wrapping for capitals → random inter-character delays with occasional "thinking" pauses |
| `page.goto(url)` | Normal navigation + injects coalesced events patch (experimental) |
| `page.mouse.move(x, y)` | Bezier curve trajectory with easing, wobble, burst patterns, and optional overshoot |
| `page.mouse.click(x, y)` | Bezier move to target → aim delay → mousedown/hold/mouseup |
| `page.keyboard.type(text)` | Same as `page.type()` but without the click-into-field step |

Original methods remain accessible via `page._original`:

```javascript
// JS
await page._original.click('selector');    // original Playwright click
await page._original.goto('https://...');  // original goto (no coalesced patch)

// Python
page._original.click('selector')
page._original.goto('https://...')
```



## Configuration

### Presets

Two built-in presets control all timing and behavior parameters:

- **`default`** — Normal human speed. Good for most use cases.
- **`careful`** — Slower, more deliberate. Longer pauses, slower typing, more cautious clicks. Use when the target site has aggressive behavioral detection.

```javascript
// JS
const browser = await launch({ humanPreset: 'careful' });

// Python
browser = launch(human_preset="careful")
```

### Custom Overrides

Override individual parameters on top of any preset:

```javascript
// JS
const browser = await launch({
  humanPreset: 'default',
  humanConfig: {
    typing_delay: 90,
    typing_pause_chance: 0.2,
    mouse_overshoot_chance: 0.25,
  },
});
```

```python
# Python
browser = launch(
    human_preset="default",
    human_config={
        "typing_delay": 90,
        "typing_pause_chance": 0.2,
        "mouse_overshoot_chance": 0.25,
    },
)
```

### All Parameters

#### Keyboard

| Parameter | Default | Careful | Description |
|---|---|---|---|
| `typing_delay` | `70` | `100` | Base delay between characters (ms) |
| `typing_delay_spread` | `40` | `50` | Random spread ± from base delay |
| `typing_pause_chance` | `0.1` | `0.15` | Chance of a long "thinking" pause (10%) |
| `typing_pause_range` | `[400, 1000]` | `[500, 1200]` | Duration of thinking pause (ms) |
| `shift_down_delay` | `[30, 70]` | `[40, 90]` | Delay after pressing Shift (ms) |
| `shift_up_delay` | `[20, 50]` | `[30, 70]` | Delay before releasing Shift (ms) |
| `key_hold` | `[15, 35]` | `[20, 45]` | Key hold duration (ms) |
| `field_switch_delay` | `[800, 1500]` | `[1000, 2000]` | Pause between switching fields (ms) |

#### Mouse — Movement

| Parameter | Default | Careful | Description |
|---|---|---|---|
| `mouse_steps_divisor` | `8` | `8` | Steps = distance / divisor |
| `mouse_min_steps` | `25` | `25` | Minimum movement steps |
| `mouse_max_steps` | `80` | `80` | Maximum movement steps |
| `mouse_wobble_max` | `1.5` | `1.5` | Max wobble amplitude (px) |
| `mouse_overshoot_chance` | `0.15` | `0.10` | Chance of overshooting target |
| `mouse_overshoot_px` | `[3, 6]` | `[3, 6]` | Overshoot distance (px) |
| `mouse_burst_size` | `[3, 5]` | `[3, 5]` | Points per burst (no pause) |
| `mouse_burst_pause` | `[8, 18]` | `[12, 25]` | Pause between bursts (ms) |

#### Mouse — Clicks

| Parameter | Default | Careful | Description |
|---|---|---|---|
| `click_aim_delay_input` | `[60, 140]` | `[80, 180]` | Aiming pause before clicking input (ms) |
| `click_aim_delay_button` | `[80, 200]` | `[120, 280]` | Aiming pause before clicking button (ms) |
| `click_hold_input` | `[40, 100]` | `[60, 140]` | Mouse button hold for input (ms) |
| `click_hold_button` | `[60, 150]` | `[80, 200]` | Mouse button hold for button (ms) |
| `click_input_x_range` | `[0.05, 0.30]` | `[0.05, 0.30]` | Click X position in input (fraction of width) |

#### Mouse — Idle

| Parameter | Default | Careful | Description |
|---|---|---|---|
| `idle_drift_px` | `3` | `3` | Drift amplitude during idle (px) |
| `idle_pause_range` | `[300, 1000]` | `[300, 1000]` | Pause between idle micro-movements (ms) |

#### Scroll

| Parameter | Default | Careful | Description |
|---|---|---|---|
| `scroll_delta_base` | `[80, 130]` | `[80, 130]` | Base wheel delta per tick (px) |
| `scroll_delta_variance` | `0.2` | `0.2` | Delta variance ±20% |
| `scroll_pause_fast` | `[60, 150]` | `[100, 200]` | Pause between fast scroll ticks (ms) |
| `scroll_pause_slow` | `[150, 400]` | `[250, 600]` | Pause between slow scroll ticks (ms) |
| `scroll_accel_steps` | `[2, 3]` | `[2, 3]` | Ticks to accelerate |
| `scroll_decel_steps` | `[2, 3]` | `[2, 3]` | Ticks to decelerate |
| `scroll_overshoot_chance` | `0.1` | `0.1` | Chance of scroll overshoot |
| `scroll_overshoot_px` | `[50, 150]` | `[50, 150]` | Overshoot distance (px) |
| `scroll_settle_delay` | `[300, 600]` | `[400, 800]` | Pause after scrolling before action (ms) |
| `scroll_target_zone` | `[0.20, 0.80]` | `[0.20, 0.80]` | Acceptable element position (viewport fraction) |
| `scroll_pre_move_delay` | `[100, 300]` | `[150, 400]` | Pause before starting scroll (ms) |

#### Other

| Parameter | Default | Careful | Description |
|---|---|---|---|
| `initial_cursor_x` | `[400, 700]` | `[400, 700]` | Initial cursor X (simulates address bar origin) |
| `initial_cursor_y` | `[45, 60]` | `[45, 60]` | Initial cursor Y |
| `patch_coalesced` | `true` | `true` | **Experimental**: Patch `getCoalescedEvents()` after navigation |

## Test Results

### deviceandbrowserinfo.com/are_you_a_bot_interactions

Result with wrapper: **`isBot: false`**, all 23 flags `false`, including `suspiciousClientSideBehavior: false`.

### Metrics Comparison

| Metric | Human | Without wrapper | With wrapper |
|---|---|---|---|
| Mouse events | 204 | 546 | 115 |
| Coalesced events (avg) | 2.7 | -1 | 1.0 |
| Mouse dt (ms) | 2-23 | 11-48 | 9-58 |
| Click X coordinates | 559, 565 | 627, 627 | 601, 605, 560 |
| Shift in keydown log | yes | no | yes |
| Key delay min (ms) | 51 | 77 | 46 |
| Key delay avg (ms) | 211 | 295 | 230 |
| Key delay max (ms) | 1278 | 686 | 1476 |

## Known Limitations

### 1. patchright-python proxy bug

`page.add_init_script()` breaks HTTP proxy with authentication in the Python version of patchright (`ERR_TUNNEL_CONNECTION_FAILED`). The workaround is to inject scripts via `page.evaluate()` after `page.goto()` instead. This does **not** affect the JS version. A bug report should be filed in the [patchright-python repository](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python).

### 2. Coalesced events = 1

CDP's `Input.dispatchMouseEvent` does not generate coalesced pointer events at the Chromium level. The JS patch injected via `page.evaluate()` is a temporary workaround that fabricates fake coalesced points. A complete fix requires a binary patch to Chromium (`third_party/blink/renderer/core/input/pointer_event_manager.cc`). Advanced anti-fraud systems may detect the fake via `toString()` comparison, cross-origin iframe inspection, or web worker validation.

### 3. insertText doesn't generate keydown/keyup

`keyboard.insertText()` inserts characters without firing `keydown`/`keyup` events. For normal characters, the wrapper uses `keyboard.down()`/`keyboard.up()` which generate proper events. `insertText` is only used for shift-symbols (`@`, `#`, `!`, etc.) where `keyboard.down()` may produce incorrect characters depending on keyboard layout — wrapped with synthetic `KeyboardEvent` dispatches for the event log.

### 4. Locator API not yet intercepted

The wrapper currently patches `page.click()`, `page.type()`, `page.mouse.*`, and `page.keyboard.*`. Playwright's Locator API (`page.locator('selector').click()`, `.fill()`, `.pressSequentially()`) is **not yet intercepted** and will use original Playwright behavior. Locator support is planned — use `page.click()` and `page.type()` for now.

## API Reference

### `launch(options)` (JS) / `launch(**kwargs)` (Python)

Launch CloakBrowser with human-like behavior patching. All pages created from the returned browser automatically have their interaction methods replaced.

**JS Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `headless` | `boolean` | `false` | Run in headless mode |
| `humanPreset` | `'default' \| 'careful'` | `'default'` | Behavior preset |
| `humanConfig` | `Partial<HumanConfig>` | `undefined` | Override individual parameters |
| `proxy` | `string \| object` | `undefined` | Proxy URL or Playwright proxy config |
| `...` | | | All other options are passed to `cloakbrowser.launch()` |

**Python Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `headless` | `bool` | `False` | Run in headless mode |
| `human_preset` | `str` | `"default"` | Behavior preset |
| `human_config` | `dict` | `None` | Override individual parameters |
| `proxy` | `str \| dict` | `None` | Proxy URL or Playwright proxy config |
| `**kwargs` | | | Passed to `cloakbrowser.launch()` |

**Returns:** Patched Playwright `Browser` object.

### `launchContext(options)` (JS) / `launch_context(**kwargs)` (Python)

Same as `launch()` but returns a `BrowserContext` with common options pre-set. Closing the context also closes the browser.

### `humanMove(raw, startX, startY, endX, endY, config)` (JS) / `human_move(raw, start_x, start_y, end_x, end_y, config)` (Python)

Move the mouse along a human-like Bezier trajectory. `raw` is a RawMouse object (original Playwright mouse methods). Used internally by the wrapper but exported for advanced use cases.

### `humanType(page, raw, text, config)` (JS) / `human_type(page, raw, text, config)` (Python)

Type text character-by-character with human timing. `raw` is a RawKeyboard object. `page` is needed for `evaluate()` calls (synthetic events for shift-symbols). Used internally but exported for direct use.

### `humanIdle(raw, seconds, cx, cy, config)` (JS) / `human_idle(raw, seconds, cx, cy, config)` (Python)

Simulate idle cursor drift for the specified duration. `raw` is a RawMouse object. Useful between actions to appear more natural.

### `scrollToElement(page, raw, selector, cursorX, cursorY, config)` (JS) / `scroll_to_element(page, raw, selector, cursor_x, cursor_y, config)` (Python)

Scroll to make an element visible using realistic mouse wheel events. `raw` is a RawMouse object. `page` is needed for viewport/element queries.

### `resolveConfig(preset, overrides)` (JS) / `resolve_config(preset, overrides)` (Python)

Resolve a preset name + overrides into a full configuration object. Useful for inspecting or modifying config before passing to low-level functions.

## How It Works (Brief)

1. **`launch()`** calls `cloakbrowser.launch()` to start a patched Chromium, then monkey-patches all Browser/Context/Page methods.
2. **`page.click(selector)`** → check element viewport position → if not visible, `mouse.wheel()` scroll with accel/decel → Bezier `mouse.move()` to target → `mouse.down()` → hold → `mouse.up()`.
3. **`page.type(selector, text)`** → field switch delay → click into field → for each char: `keyboard.down(key)` → hold → `keyboard.up(key)` with Shift wrapping for capitals and symbols.
4. **`page.goto(url)`** → normal navigation → inject coalesced events patch.
5. All timing uses randomized ranges, never fixed values. Occasional "thinking" pauses and overshoot add further realism.

## License

[MIT](LICENSE)
