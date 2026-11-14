# Popup Liquid-Glass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the SilentTube toolbar popup with a liquid-glass look, changing only its stylesheet.

**Architecture:** One CSS file. Add glass custom properties to `:root` and the dark-mode block, then override the existing popup selectors. No markup or script changes.

**Tech Stack:** Plain CSS (custom properties, `backdrop-filter`, `@media` queries). Verification uses `node --test` and a browser check.

**Spec:** `docs/superpowers/specs/2026-11-14-popup-liquid-glass-design.md`

## Global Constraints

- Only `src/popup.css` changes. No edits to `popup.html`, `popup.js`, or class names.
- Popup body stays `width: 360px; max-height: 580px`.
- Light and dark modes both keep readable text (body text contrast of at least 4.5:1 against the surface).
- Keep the existing focus rings (`outline: 2px solid var(--focus)`).

## Review Focus

- Browser without `backdrop-filter` (older Zen/Firefox): surfaces must still be readable on an opaque fallback fill.
- User has `prefers-reduced-transparency` or `prefers-reduced-motion` on: surfaces go solid and transitions stop.
- Dark mode with a bright system background: text on glass must stay legible.
- Switch knob after restyle: it must still reach the on position without overflowing the track.
- Long "Your videos" list in a 580px popup: scrolling must stay smooth and the blur must not clip.

## Task 1: Glass restyle of popup.css

**Files:**
- Modify: `src/popup.css` (variables at lines 1-27, body at 38-50, and the component rules listed below)

**Interfaces:**
- Consumes: existing class names in `popup.html` and `popup.js` (`.header`, `.section`, `.section-heading`, `.section-body`, `.page-note`, `.field-note`, `.text-input`, `.textarea`, `.btn`, `.btn.secondary`, `.count`, `.video-item`, `.remove`, `.switch`, `.toggle`).
- Produces: none. No other task depends on this.

- [ ] **Step 1: Add glass tokens to the variable blocks**

In the `:root` block, add these custom properties (light values):

```css
--glass-fill: rgba(255, 255, 255, 0.55);
--glass-fill-strong: rgba(255, 255, 255, 0.72);
--glass-edge: rgba(255, 255, 255, 0.85);
--glass-shadow: 0 8px 28px rgba(15, 23, 42, 0.12);
--glass-blur: blur(24px) saturate(180%);
--backdrop-tint-a: #ffd6e0;
--backdrop-tint-b: #cfe6ff;
--backdrop-tint-c: #e6ffe9;
```

In the dark-mode `:root` block, add the same names with dark values:

```css
--glass-fill: rgba(40, 40, 46, 0.5);
--glass-fill-strong: rgba(50, 50, 58, 0.68);
--glass-edge: rgba(255, 255, 255, 0.14);
--glass-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
--backdrop-tint-a: #4a1a2a;
--backdrop-tint-b: #1a2f52;
--backdrop-tint-c: #173a2a;
```

- [ ] **Step 2: Give the body a soft gradient backdrop**

Replace the `background: var(--bg);` line in the `body` rule with a layered gradient built from the tint tokens, and keep `background-attachment: fixed` off (the popup is not scrollable at the page level beyond its own body):

```css
background:
  radial-gradient(120% 80% at 0% 0%, var(--backdrop-tint-a), transparent 60%),
  radial-gradient(120% 90% at 100% 30%, var(--backdrop-tint-b), transparent 60%),
  radial-gradient(120% 90% at 40% 100%, var(--backdrop-tint-c), transparent 65%),
  var(--bg);
```

- [ ] **Step 3: Turn the header and sections into glass cards**

- `.header`: add a glass fill, blur, edge, and radius. Remove `border-bottom`. Example:
  `background: var(--glass-fill); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); border: 1px solid var(--glass-edge); border-radius: 18px; box-shadow: var(--glass-shadow);`
- `.section`: same glass treatment with `border-radius: 16px`, `margin-bottom: 10px`, and padding `0 14px`. Remove the `border-bottom` rule and its `:last-of-type` reset.
- Adjust `main` padding so the cards have a gap from the window edge (`padding: 4px 12px 16px`).
- `.section-heading`, `.section-body`: keep layout; only adjust horizontal padding if the card padding changed.

- [ ] **Step 4: Glass the smaller surfaces**

- `.page-note`, `.count`, `.video-item:hover`: use `background: var(--glass-fill-strong)` with the same blur and edge as the header.
- `.text-input`, `textarea`, `.color-input`: `background: var(--glass-fill)`, `border: 1px solid var(--glass-edge)`, `backdrop-filter: var(--glass-blur)`. Keep the focus rule.
- `.remove:hover`: use `var(--glass-fill-strong)` instead of `var(--surface-hover)`.

- [ ] **Step 5: Restyle buttons and the switch**

- `.btn`: replace the solid `var(--text)` background with a tinted glass pill: `background: color-mix(in srgb, var(--focus) 70%, transparent); color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 4px 12px rgba(0,0,0,0.15); transition: transform 0.15s ease, opacity 0.15s ease;`. Add `.btn:active { transform: scale(0.97); }`. Keep the `opacity: 0.85` hover.
- `.btn.secondary`: `background: var(--glass-fill-strong); color: var(--text); border: 1px solid var(--glass-edge);`
- `.switch`: glass track `background: var(--switch-off)` stays for off; on state keeps `var(--switch-on)`. Add `box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);`. Change the knob transition to `transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)`. The knob size and `translateX(16px)` stay the same, so the travel still fits the 36px track.

- [ ] **Step 6: Add the fallbacks and reduced-motion/transparency rules**

Add at the end of the file:

```css
@supports not (backdrop-filter: blur(1px)) {
  :root {
    --glass-fill: var(--surface);
    --glass-fill-strong: var(--surface-hover);
  }
}

@media (prefers-reduced-transparency: reduce) {
  :root {
    --glass-fill: var(--surface);
    --glass-fill-strong: var(--surface-hover);
  }

  .header,
  .section,
  .page-note,
  .text-input,
  textarea,
  .btn.secondary {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
  }
}
```

- [ ] **Step 7: Run the existing tests**

Run: `cd /Users/zorigoo/Projects/SilentTube && node --test`
Expected: all tests pass (the suite only covers `src/shared.js`, so this confirms nothing else moved).

- [ ] **Step 8: Verify the popup visually**

Open `src/popup.html` in Chrome (via `chrome-use` or the in-app browser) and check, in light and dark mode:
- header, sections, inputs, buttons, switches, and the video list all render as glass cards
- text is readable in both modes
- the switch knob reaches the on position
- the 580px scroll still works

Expected: no visual regressions in the popup layout, with the glass look present. Record the result in the final report.

- [ ] **Step 9: Commit**

```bash
git add src/popup.css docs/superpowers/specs/2026-11-14-popup-liquid-glass-design.md docs/superpowers/plans/2026-11-14-popup-liquid-glass.md
git commit -m "style: liquid-glass popup theme"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-11-14-popup-liquid-glass.md`, with the design in `docs/superpowers/specs/2026-11-14-popup-liquid-glass-design.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven**: a fresh subagent implements the task and a fresh reviewer checks it. Most thorough, but it costs extra context for a single CSS file.
- **Native**: I implement the change myself in this session, then one reviewer checks the branch. Cheapest and fastest for a one-file change.

For this plan I recommend **Native**, because there is one task and one file, so a shipped mistake is cheap to fix. Does the plan capture what you want, and which approach should we use?

