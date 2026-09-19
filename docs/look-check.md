# The look check

Before a site's domain moves to the stack, the look check proves the rebuilt pages look like the
design that was approved, instead of somebody deciding they look close enough.

It takes pairs. Each pair is a reference, which is either a prototype file on disk with a page state
or the live URL of the site being replaced, and the rebuilt page on the stack. Both sides are
captured in the same run, seconds apart, at 390px and 1280px, and compared pixel by pixel. Above the
page's threshold the run fails and the reference, the rebuilt screenshot and the diff image come
back as artifacts.

Comparing a stored baseline would answer a different question. A baseline tells you the rebuilt site
changed since yesterday. This tells you it matches the approved design today.

## The pair list is the site's

The pages are data, not code. The list lives in the site's own repository, next to the prototypes it
points at, and nothing in barakoPress knows the site exists.

```json
{
  "defaults": {
    "widths": [390, 1280],
    "maxDiffRatio": 0.001,
    "rebuiltBase": "${REBUILT_BASE}",
    "mask": [".site-clock"]
  },
  "pairs": [
    {
      "id": "home",
      "reference": "prototypes/RC Koronadal Site.dc.html",
      "rebuilt": "/",
      "maxDiffRatio": 0.004,
      "mask": {
        "reference": ["#comp-news"],
        "rebuilt": [".news-feed"]
      }
    },
    {
      "id": "about",
      "reference": { "file": "prototypes/RC Koronadal Site.dc.html", "hash": "#about" },
      "rebuilt": "/about"
    },
    {
      "id": "projects",
      "reference": "https://rckoronadal.org/projects",
      "rebuilt": "/projects"
    }
  ]
}
```

Every key, and what happens when it is left out:

| Key | Where | Default | What it does |
| --- | --- | --- | --- |
| `id` | pair | required | Names the page in the report and in the artifact path. Letters, digits, dots, dashes and underscores. |
| `reference` | pair | required | The approved design. A relative string is a file next to the pair list, a string starting with `/` or `http` is a URL. |
| `rebuilt` | pair | required | The page on the stack. Same rules. |
| `widths` | both | `[390, 1280]` | Viewport widths, one capture and one comparison each. |
| `viewportHeight` | both | `900` | The viewport height. Full page capture makes it mostly invisible, except to anything sized in `vh`. |
| `fullPage` | both | `true` | Capture the whole page rather than the first screen. |
| `maxDiffRatio` | both | `0.001` | The share of pixels allowed to differ, 0 to 1. Above it the pair fails. |
| `pixelThreshold` | both | `0.1` | How far one pixel's colour may move before it counts as different, 0 to 1. |
| `fixedTime` | both | `2026-01-01T09:00:00.000Z` | The clock both sides render against. |
| `mask` | both | none | Selectors painted over before the comparison. A list applies to both sides, or `{ both, reference, rebuilt }`. |
| `block` | both | none | URL globs refused during the capture: analytics, embeds, anything pulling live content. |
| `referenceBase`, `rebuiltBase` | defaults | none | Joined onto a `rebuilt` or `reference` written as a path. |

`${NAME}` in any URL, base or file path is read from the environment. A name that is not set is an
error, so a base that quietly became empty cannot turn every URL into a path.

An unknown key is refused, not ignored. A threshold written `maxDiffratio` would leave the page on
the default and the gate would look healthy passing everything.

### The threshold is per page, not per run

One number for the whole site has to be set for the worst page, and then every other page is being
checked at that page's tolerance. How much a page legitimately moves is a property of the page: a
contact page is fixed text and should sit near zero, while a page carrying a news feed and a
member count has a floor no amount of masking gets under. So `defaults.maxDiffRatio` is the strict
number and a page that has earned a looser one says so, in one line, where a reviewer can see it.

Mask first, raise the threshold second. A threshold raised to cover a feed also covers the footer
falling apart.

## What makes a run flake, and what is done about each

A look check that flakes is switched off within a week, which leaves the migration with no gate at
all. Each of these is shut down in `look/capture.ts`:

| Source | What is done |
| --- | --- |
| Fonts | `document.fonts.ready` is awaited after the scroll, so nothing is captured mid swap. |
| Motion | `prefers-reduced-motion: reduce` on the context, CSS durations and delays zeroed, and the screenshot taken with animations disabled, which rewinds what is left. |
| Caret blink | The caret is hidden and the focused element is blurred, so no focus ring either. |
| Scrollbars | Hidden on both sides, so an overlay scrollbar cannot paint on one capture and not the other. |
| Lazy images | Forced eager, then the page is scrolled top to bottom and back, so an observer that ignores the attribute still fires. Images are awaited decoded. |
| Dates and clocks | Both sides run on one fixed clock, so anything the page computes from the current time lands on the same pixel. |
| Locale and timezone | Pinned to `en-US` and UTC, because date and number formatting follows them. |
| Dark mode | Pinned to light, so a runner's preference cannot flip one side. |
| Device pixel ratio | Pinned to 1 and the screenshot scaled in CSS pixels. |
| Service workers | Blocked, so a previous run cannot serve a previous page. |
| Live content | Refused by URL with `block`, and what is left is masked. |

What is left is masks, and a mask that stops matching is reported rather than dropped. A selector
that silently matches nothing leaves a live region in the comparison and produces a failure nobody
can explain.

Give a masked element a stable box. A count that renders 900 one day and 1000 the next changes the
width of its own mask, and the edge of the mask is then a difference.

## Running it

In CI, from a site repository:

```yaml
jobs:
  look:
    uses: BaryoDev/barakoPress/.github/workflows/look-check.yml@master
    with:
      pairs: look/pairs.json
      variables: '{"REBUILT_BASE":"https://staging.rckoronadal.org"}'
```

Every page's difference goes to the job summary whether the run passed or failed, because a page
sitting at four fifths of its threshold is the next failure and nobody sees that in a green tick.
The images are uploaded when it fails.

Locally, from a checkout of this repository:

```bash
npm ci
npx playwright install chromium
LOOK_PAIRS=/path/to/site/look/pairs.json REBUILT_BASE=https://staging.example npm run look
```

`LOOK_OUTPUT` moves the output, which defaults to `look-results`: `summary.md`, `summary.json` and
`pages/<id>/<width>/{reference,rebuilt,diff}.png`.

## Proving it still works

```bash
npm run look:selftest
```

Two runs over one pair list of fixture pages. The first serves pages that match the prototype on
disk and has to come back green at both widths. The second serves the same pages with the hero
heading in a different colour and has to fail the home pair, pass the about pair, and leave the
three images behind. CI runs it on every push. A check nobody has watched fail is not yet a gate.
