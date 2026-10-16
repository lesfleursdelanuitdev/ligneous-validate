# GEDCOM Checker: design handoff, Layout C (2026-10-16)

The chosen design is **Layout C: compact header and a 2-column grid**.

## Decisions taken when building it (momolig, 2026-10-16)

- **Fonts are self-hosted.** Instrument Serif and Outfit are bundled with the site, not loaded from fonts.googleapis.com. A Google request would break the "Nothing is uploaded" promise, the CSP and the privacy test.
- **Text colours that failed WCAG AA are darkened.** Backgrounds, borders and the amber badge tint are unchanged.

  | Text | Design value | Used instead |
  |---|---|---|
  | Amber (warning badge, active pill) | `#C4956A` | `#93653A` |
  | Light text | `#9CA3AF` | `#6B7484` |
  | Faint text | `#B0A99D` | `#7E7566` |

  At the design values, these three measured about 2.3–2.6:1.
- **Tweakable props become fixed tokens.** The design's props (`{{accent}}`, `{{bg}}`) are replaced by CSS tokens set to the defaults: accent `#1A3C34`, background `#FCFBF9`.
- **Things the design left open:**
  - **Error badge:** a soft red tint with dark red text.
  - **Hint badge:** an accent tint with accent text.
  - **Phone width:** one card column below about 640px.
  - **An opened finding** opens in place, in its own column. It shows the line viewer (which scrolls sideways inside itself) and "How to fix it". (At first it spanned both columns, but that reflowed every card below it; changed 2026-10-16.)
  - **The repair section:** a white card in the same style, placed between the toolbar and the findings.
  - **Dark mode** is derived from the same tokens.
- **Wording and behaviour stay exactly as before.** Only the look changes.

---

## Colour palette

| Token | Hex | Usage |
| --- | --- | --- |
| Accent | `#1A3C34` | Nav wordmark, headings, section titles, CTA button background, links, filter checkboxes |
| Secondary / amber | `#C4956A` (text: `#93653A`) | Warning badge text, active filter pill text, link hover colour |
| Warning badge background | `rgba(196, 149, 106, 0.12)` | Translucent amber behind WARNING labels |
| Background | `#FCFBF9` | Page background |
| Surface | `rgba(237, 232, 223, 0.3)` | Upload dropzone fill |
| Card background | `#FFFFFF` | File info strip, finding cards |
| Text | `#1A1A1A` | Primary body text, stat numbers, card titles |
| Muted | `#6B7280` | Body copy, nav links, card descriptions, filter labels |
| Light text | `#9CA3AF` (text: `#6B7484`) | Stat labels, metadata labels, upload hint, "Tools" label |
| Faint text | `#B0A99D` (text: `#7E7566`) | Line numbers in cards, privacy note below the upload |
| Border | `#E5E0D7` | Card borders, dividers, filter pill borders, file info row 1 separator |
| Light border | `#F0EBE3` | File info row 2 top border (inner separator) |
| Dashed border | `#D5CFC4` | Upload dropzone border, download button borders, footer dot separator |
| Nav divider | `#DDD8CF` | Vertical line between "ligneous" and "Tools" |

## Typography

The display face is **Instrument Serif** and the body face is **Outfit**, both with a `system-ui` fallback.

| Element | Family | Weight | Size | Other |
| --- | --- | --- | --- | --- |
| Page title (h1) | Instrument Serif | 400 | `clamp(36px, 4.5vw, 56px)` | Line height 1.1, letter spacing -1.2px, italic `<em>` on "file" |
| Section headings (h2) | Instrument Serif | 400 | 26px | Accent colour |
| Nav wordmark | Instrument Serif | 400 | 26px | Letter spacing -0.3px |
| File name in the info strip | Instrument Serif | 400 | 20px | Letter spacing -0.3px, accent colour |
| Stat numbers | Outfit | 500 | 22px | `#1A1A1A` |
| Hero subtitle | Outfit | 300 | `clamp(15px, 1.2vw, 18px)` | Line height 1.65, max width 440px |
| Body / descriptions | Outfit | 300 | 13–15px | Line height 1.55 for card text |
| Card titles (h4) | Outfit | 500 | 14px | `#1A1A1A` |
| Nav links | Outfit | 400 | 15px | Muted |
| Filter pill labels | Outfit | — | 13px | Muted or amber |
| Buttons (CTA) | Outfit | 500 | 15px | 13px for toolbar buttons |
| Metadata labels | Outfit | 400 | 12px | Uppercase, letter spacing 0.5px, light text |
| Metadata values | Outfit | 400 | 13px | `#1A1A1A` |
| Stat labels | Outfit | 400 | 12px | Light text |
| WARNING badge | — | 600 | 11px | Uppercase, letter spacing 0.5px |
| "Tools" label | — | 500 | 11px | Uppercase, letter spacing 0.5px |
| Privacy note | Outfit | 300 | 13px | Faint text |
| Upload hint | Outfit | 300 | 14px | Light text |

## Layout and spacing

There are two content widths: 720px for the upload hero and 1120px for the results. The nav stretches to 1440px. Side padding is `clamp(24px, 5vw, 80px)` throughout.

| Region | Max width | Padding | Notes |
| --- | --- | --- | --- |
| Nav | 1440px | `28px clamp(24px, 5vw, 80px)` | Flex row, space-between, wraps at gap 16px |
| Hero / upload | 720px | `clamp(40px, 5vw, 72px) clamp(24px, 5vw, 80px) 40px` | Centred, text-align centre |
| Upload dropzone | — | `clamp(36px, 4vw, 56px) 32px` | 2px dashed border, 12px radius |
| CTA button | — | `13px 28px` | 6px radius |
| Dividers | 1120px | `0 clamp(24px, 5vw, 80px)` | 1px solid border colour |
| File info strip | 1120px | `32px clamp(24px, 5vw, 80px) 0` | Section padding |
| File info card | — | `24px 28px` | White card, 1px border, 10px radius, 16px gap between rows |
| Toolbar | 1120px | `24px clamp(24px, 5vw, 80px) 0` | Flex row, wraps, gap 12px 24px |
| Finding sections | 1120px | `32px clamp(24px, 5vw, 80px) 0` | 40px top padding from the second section on |
| Section heading | — | margin-bottom 20px | Flex row with the count, baseline-aligned, gap 10px |
| Card grid | — | — | `repeat(2, minmax(0, 1fr))`, gap 12px. 1 column below about 640px |
| Card | — | `20px 22px` | White card, 1px border, 10px radius |
| Footer | 1120px | `56px clamp(24px, 5vw, 80px) 40px` | Flex row, centred, gap 20px |
| Filter pills | — | `7px 14px` | 100px radius, 1px border |
| Download buttons | — | `7px 16px` | 6px radius, 1px border |

## Components

- **Nav.** The wordmark "ligneous" (Instrument Serif 26px, accent), a 1px vertical divider (`#DDD8CF`), then a "TOOLS" label (11px, uppercase, weight 500, light text). The links on the right are "Back to Ligneous" (https://ligneous.org/) and "Source code" (the GitHub repo), with a 36px gap between them.
- **Hero.** The h1 "Check your GEDCOM <em>file</em>". Under it, the subtitle (max width 440px). Then the dropzone: a 2px dashed `#D5CFC4` border, the surface fill, a 36×36 upload icon (stroke `#9CA3AF`, width 1.2), the accent "Choose a file" button and the hint "or drop it here". The privacy note sits below the dropzone.
- **File info strip.** A white card with two rows.
  - **Row 1:** the file name (Instrument Serif 20px, accent), a 24px-tall vertical divider, then the people, families and sources stats. Each stat is a 22px/500 number with a 12px light label.
  - **Row 2:** two inner groups that wrap independently. Group 1 is YEARS · MADE WITH. Group 2 is VERSION · ENCODING. Dot separators are `#DDD8CF`, with `gap: 6px 0`.
- **Toolbar.**
  - The italic summary, at `flex: 1 1 300px`.
  - Three filter pills: a 15×15 checkbox square (3px radius, accent or amber fill, white check) followed by the label.
  - Two download buttons, "Text" and "Spreadsheet", each with a 14×14 download arrow.
- **Finding cards.**
  - Grouped under section headings: Instrument Serif 26px, with the count in parentheses (14px, light text, weight 300).
  - Each card has a badge row with the severity badge (`3px 10px` padding, 4px radius) and the line number (13px, faint). Then the title (14px/500) and the description (13px/300, muted, line height 1.55).
  - Badge to title: 8px. Title to description: 6px.
- **Footer.** "Made by Ligneous" · "Source code". Links are 14px/400, accent colour.

## Responsive behaviour

There are no breakpoints apart from the 1-column card grid. Everything else responds through `clamp()`, `flex-wrap` and `minmax`.

## Severity badges

| Severity | Badge background | Badge text | Filter pill text |
| --- | --- | --- | --- |
| Error | soft red tint | dark red (≥4.5:1) | muted |
| Warning | `rgba(196, 149, 106, 0.12)` | `#93653A` | `#93653A` |
| Hint | accent tint | accent | muted |
