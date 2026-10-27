# 0002 — The blue palette

Date: 2026-10-27. Status: accepted.

## Where the colours came from

The user has a Saber-themed Windows cursor set. **No artwork was used** — the
icons are copyrighted and nothing from them ships. What was taken is colour
_statistics_: a script decoded the RIFF/ANI frames, collected opaque pixels
across six cursors (147,456 px), and reported the dominant hues.

The blue family (hue 170–260, saturation >= 15%) covered 9.2% of the opaque
area and clustered tightly:

| Hex       | Hue | Sat | Light | Share of blues |
| --------- | --- | --- | ----- | -------------- |
| `#383888` | 240 | 42% | 38%   | 14.8%          |
| `#0858B8` | 213 | 92% | 38%   | 13.7%          |
| `#084888` | 210 | 89% | 28%   | 7.4%           |
| `#082868` | 220 | 86% | 22%   | 6.9%           |
| `#3868D8` | 222 | 67% | 53%   | 6.3%           |
| `#68A8F8` | 213 | 91% | 69%   | 3.2%           |
| `#38C8F8` | 195 | 93% | 60%   | 3.2%           |

**Median hue 220, median saturation 67%.** So: an azure spine at 213–222, a cyan
highlight near 195, indigo depth at 240.

## What the theme does with it

- **Light accent `#0B57BE`** — the cursors' strongest azure (`#0858B8`), nudged
  until a white label clears 4.5:1 (lands at 6.73:1).
- **Dark accent `#6FACF7`** — their light sky blue. The deep azure disappears
  against a dark ground, so the dark theme is a retune, not an inversion.
- **Neutrals tinted toward hue 220** rather than flat grey, so borders, shadows
  and secondary text sit in the accent's family (ui-guidelines §13). Shadows in
  the light theme are tinted `#081528`, not black.

## `onAccent` / `onDanger` exist because of a real bug

The first pass hardcoded `Colors.white` on the primary button. That is fine in
light mode (6.73:1) and **unreadable in dark mode: 2.35:1**, because the dark
accent is a light blue. The label colour is now a token that flips with the
theme — dark mode puts `#0B0F17` on the accent, at 8.15:1.

This is exactly the class of bug that survives a visual check and dies to a
measurement, so `test/contrast_test.dart` now asserts every foreground/background
pair on both themes, including the label-on-fill pairs.

## Reproducing the extraction

The script lives in the scratchpad, not the repo — it reads from the user's
Downloads folder and has no place in version control. It is ~100 lines:
parse RIFF `LIST`/`icon` chunks, decode each frame with Pillow, quantize to a
16-step grid, and rank by opaque coverage.
