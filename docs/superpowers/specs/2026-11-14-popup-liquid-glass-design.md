# Popup liquid-glass restyle: design

**Status:** approved (2026-11-14)

## Intent
Make the toolbar popup look like iOS 26 liquid glass: translucent, blurred, softly lit surfaces with rounded cards and springy controls.

## Goals
- Restyle the popup panel only.
- Keep all text, controls, and behavior identical.

## Non-goals
- True refraction (SVG displacement filters do not work with `backdrop-filter` in Chrome or Zen).
- Any change to YouTube pages, `popup.html`, `popup.js`, or class names.

## Constraints
- `src/popup.css` is the only file changed.
- The popup is 360px wide and up to 580px tall.
- Light and dark modes both need readable text.
- Zen and Firefox must still render the popup correctly.

## Approach (chosen)
Stylesheet-only. A soft gradient backdrop sits behind the popup so the glass has something to blur. Header, sections, notes, count pill, and inputs get a translucent fill with `backdrop-filter: blur(24px) saturate(180%)`, a 1px bright inner edge, and a soft shadow. Sections become rounded cards. The primary button becomes a tinted glass pill; the switch gets a glass track and a larger knob with a spring transition.

Fallbacks: browsers without `backdrop-filter` get a more opaque fill. `prefers-reduced-transparency` and `prefers-reduced-motion` get solid surfaces and no animation.

## Alternatives considered
- SVG displacement refraction: not supported by `backdrop-filter` in the target browsers.
- Restyle the YouTube page too: out of scope for this round.

## Calls made without asking
- Gradient colors and blur radii are chosen during implementation and checked visually.
