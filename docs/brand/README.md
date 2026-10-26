# Digarr brand

The mark is a record pulled from the crate: a black vinyl disc whose label is a chip. The look around it comes from the release posters: two-color print on paper, black ink and one red, with record grooves that branch into clusters of dots.

## Logo files

| File | Use |
| --- | --- |
| `digarr-mark.svg` | The record on light backgrounds |
| `digarr-mark-dark.svg` | The record on dark backgrounds (adds a white rim so the disc separates from the page) |
| `digarr-wordmark.svg`, `digarr-wordmark-dark.svg` | "digarr" with the red dot, dark ink or white ink |
| `digarr-lockup.svg`, `digarr-lockup-dark.svg` | Record and wordmark side by side; the README header |
| `digarr-icon.svg` | App icon: the record on a paper tile. Source for the PWA icons, the Apple touch icon and `docs/logo.png` (the Unraid icon) |
| `digarr-favicon.svg` | Small-size version for 32 px and below: disc, red label and spindle hole, no grooves or chip. Served as `/icon.svg` |

Every variant is drawn from the same geometry, so the disc, grooves, label and chip match across files. Recolor nothing: the variant choice handles light and dark.

## Usage

- Clear space around the record is at least the red label's radius (about 22% of the record's width). Around the wordmark, keep the height of the dot.
- Minimum sizes: the full record 48 px, the lockup 160 px wide. Below 48 px use `digarr-favicon.svg`.
- Red appears in exactly two places: the record label and the dot over the i. Do not add red elsewhere in the mark, and never set the whole word in red.
- In the app header the name stays live text in the theme's brand color; the drawn wordmark is for static surfaces (README, releases, posters, listings).
- Do not rotate, outline, add shadows or glows, place the dark variant on light backgrounds, or stretch the lockup.

## Color

| Role | Value | Where |
| --- | --- | --- |
| Logo red | `#e00000` | The label and the dot; also the default `youtarr-dark` theme accent |
| Ink | `#0f0f0f` | The disc, the chip, dark wordmark, the app's default ground |
| White | `#ffffff` | Dark-variant wordmark and rim |
| Paper | `#ece8de` | App icon tile, poster background |
| Print red | `#cd3e3b` | Posters and article art only. Softer than the logo red, as if printed |
| Night | `#131517` | Dark posters |

Posters use paper or night as the ground, ink as the only dark, and one red. No gradients beyond the paper's grain.

## Type

- The wordmark is drawn, not typeset. Do not rebuild it in a font.
- The app uses Roboto Flex.
- Posters: a heavy serif or grotesque for the headline, a typewriter-style monospace for the tagline ("Self-hosted music discovery"), version numbers and the `github.com/iuliandita/digarr` line.

## Art direction

Release and article art follows the posters on iuliandita.com (the v1.19.0, v2.0.0 and 300-stars pieces):

- Print feel: screenprint or risograph texture, visible paper grain, flat ink, slight misregistration is fine.
- Grooves as line work: fine concentric or flowing lines taken from a record, often running off the page.
- Discovery as dots: groove lines branch into clusters of black dots joined by thin lines, a few of them red. The red dots are the finds.
- One hero object per piece, drawn as a technical illustration with hatching: a record, a deck, a cartridge, a crate.
- Layout for 4:5 posters: wordmark top left, hero object in the middle or bleeding off an edge, one short claim at the bottom, the monospace GitHub line under it.
- The record mark may appear inside the art, for example as the label of a large record, as long as it stays round and readable.

Avoid: neon, glow, chrome, 3D renders, gradients, robots or brains, stock "AI" imagery, more than one accent color, and generic waveform or equalizer bars.

### Prompt template

Use this as a starting point for generated release art, then place the real wordmark and text on top rather than letting the generator draw them.

```text
Two-color print poster, 4:5, on textured cream paper (#ece8de). Black ink and a single warm red (#cd3e3b), no other colors.
Hero: <one object, e.g. a vinyl record seen at an angle, cropped by the right edge>, drawn as a hatched technical illustration.
Fine record-groove lines flow across the page and branch into clusters of black dots connected by thin lines; a few dots are red.
Leave clear space at the top left for a wordmark and at the bottom for one line of text. Screenprint texture, flat ink, no gradients, no glow, no lettering.
```

For a dark piece, swap the paper for a near-black ground (#131517) and draw the hero in cream ink with red accents.
