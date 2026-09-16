# arminsaber.com

Personal site. Static, vanilla HTML/CSS/JS, no build step.

> **Before announcing the site:** remove the
> `<meta name="robots" content="noindex, nofollow">` tag from
> `index.html`. It is there because the page still carries two
> `[ARMIN: …]` placeholders, both in the MELOMANIA entry, and the site
> should not be indexed in that state. The `href="#"` links this note
> used to mention are all filled in.

One page, one axis: logic at the top, feeling at the bottom. Scroll
position drives `--t`; the accent colour cools from indigo to
chartreuse as you descend. The sticky ribbon plots every project on
that axis and tracks where you are.

The type does not move with it. Both faces are fixed: see
[the consistency auditor](#before-every-push) for why.

Each project reads in three layers. The collapsed row is the scan: a
mark, a position, a mini axis, the name, a descriptor of six words or
fewer, a status and a toggle, and nothing else. The first expand is
the summary: two sentences and up to four short facts. A quiet control
under that opens the full brief. Expand all and deep links open the
summary and never the brief.

## House rules

Three constraints hold across any redesign of this site. All three are
enforced by a tool rather than remembered, and all three run before
every push:

- **Typography.** `tools/check-orphans.mjs` fails on four
  line-breaking faults at every width, in every layer.
- **Visual consistency.** `tools/check-consistency.mjs` fails when a
  repeated role drifts: type, spacing, colour or alignment.
- **Links.** `tools/check-links.mjs` requests every outbound link.
- **The auditors themselves.** `tools/check-auditors.mjs` plants ten
  known faults and confirms each one is caught. A green run from the
  first two proves nothing unless this passes too.

The first two are design constraints, not lint. They are written to
survive a redesign: a new type scale, a new layout and new copy all
still have to satisfy them. If a change cannot, the change is wrong,
not the rule. Where something is deliberately inconsistent it goes in
that tool's exception list with a reason and a bound, so the list
itself can be read and argued with.

## Filling in the blanks

Every fact I could not verify is a visible placeholder in the page,
rendered as a dashed box. Search `index.html` for `[ARMIN:` and replace
each one. Two are left, both in the MELOMANIA entry: what the nights
cost and where the series stands. While a field holds one, the
auditor reports it as `defer` and cannot judge its line breaks, so run
`node tools/check-orphans.mjs` again once you fill them in.

## Deploying

Pushing to `main` deploys via `.github/workflows/deploy.yml`
(GitHub Pages, actions-based). One-time setup in the repo settings:

1. Settings → Pages → Source: **GitHub Actions**
2. Settings → Pages → Custom domain: **arminsaber.com** (the `CNAME`
   file is included for branch-based fallback)
3. DNS: point `arminsaber.com` A records at GitHub Pages, `www` CNAME
   at `<user>.github.io`

## Before every push

```sh
node tools/check-links.mjs
```

Requests every outbound link on the page and reports status codes and
TLS errors. Two links are temporarily pointed at platform hosts while
their custom domains are broken — search `index.html` for
`TODO(armin)` to swap them back.

```sh
node tools/check-orphans.mjs
```

The typographic auditor. Renders the page in headless Chrome at nine
widths, three times each, once per layer: the collapsed scan rows, then
every summary open, then every full brief open. It measures where each
word actually sits and fails on four faults.

The widths are every layout boundary in `styles.css` plus the extremes:
1440, 1024, 900, 760, 640, 560, 430, 390, 360. It used to check three,
1440, 390 and 360, and the page was failing at 1024, 900, 768, 640 and
560 the whole time with nobody the wiser.

**1. No wrapped headings or product names.** `h1`, `h2`, `h3` and
`.sum-labs-name` hold one line. A name that breaks in two reads as two
things. The only escape is an explicit `data-wrap` attribute in the
markup, so every exception is visible in the HTML rather than buried
in a stylesheet.

**2. What is allowed to wrap must wrap evenly.** An element carrying
`data-wrap="balanced"` may break, but no line may fall under a third
of the longest. The hero headline is the only one on the site.

**3. Three lines maximum in the scan layer and in a facts value.**
That is `.entry-desc`, `.entry-pos`, `.entry-cat`, `.entry-status` and
the `dt`/`dd` inside `.fact`. Layer 2 ledes and layer 3 brief fields
are exempt and absent from that selector on purpose: they are prose.

**4. No orphans and no runts.** The last line must carry more than one
word, and must be at least a quarter as wide as the line above it. A
two word tail hanging under a full measure is the same fault as a one
word one, so both fail.

Two things are never audited, because neither is copy: anything inside
an `aria-hidden` element (the `+` toggles, the `↗` on links), and any
field still holding an `[ARMIN: …]` placeholder. The browser breaks
the whole string including the placeholder, so the rag says nothing
about the copy that will land there. Those fields are reported as
`defer` on every run and audited normally once they are filled in.

Every failure names the entry, the element, the field, the width, the
state and the full line breakdown, so the fix is usually obvious from
the report alone. Fix with type sizing, tracking, measure or an
explicit break. Do not fix by cutting copy.

**This is a standing constraint for the site.** It is not a one-off
pass tied to the current design, and it survives any future redesign:
new type scale, new layout, new copy, the four rules still hold. If a
change cannot satisfy them, the change is wrong, not the rules. Run it
after any copy or type change, and before every push.

It needs a local Chrome and a copy of `puppeteer-core`; set
`CHROME_PATH` or `PUPPETEER_PATH` if either sits somewhere unusual.
`--shots <dir>` also writes hero, summary and full page screenshots at
each width, `--width <n>` checks one width instead of three, `--url
<url>` audits a running site instead of the working tree.

```sh
node tools/check-consistency.mjs
```

The design consistency auditor. Where the line auditor watches how copy
breaks, this one watches whether the page is still one design. Same nine
widths, same three layers, and it prints every value side by side
so an outlier is obvious.

**1. Type, within a role.** Thirteen repeated roles, from product
titles down to facts labels and outbound links. For each it reports
family, weight, size, tracking, line height, variable axis values and
case, for every instance. A role whose instances disagree fails.

**2. Spacing.** Entry vertical rhythm, padding inside rows, the gaps in
the facts and labs rows, checked against the `--s` scale. A value off
the scale fails however many times it is repeated: four uses of a wrong
number is still a wrong number.

**3. Colour.** Every colour declaration in `styles.css`, plus every
colour resolved on the page. A literal outside `:root` fails, because
`:root` is where tokens are defined and everywhere else should be a
token or a `color-mix` derived from one.

**4. Alignment.** The meta lane, the main lane and the mark lane, left
edges across all seven entries. Any entry out of line fails.

**5. Type, across the whole face.** Every element on the page grouped
by the face it computes to rather than by its role, and compared as
one family. **One face, one weight, one tracking, one line height, one
set of axis values. Size varies by role and never within one.
Everything else would need an exception with a reason, and there are
no exceptions left.**

Check 1 compares instances of a role against each other, so a role
that is internally consistent passes even when it disagrees with every
other role sharing its typeface. That is exactly how `.sum-labs-name`
sat there setting weight 480 and tracking -0.012em against a face
running 575 and -0.032em: all three of its instances agreed with each
other, so nothing complained. Check 5 is what catches that. A value
held by fewer roles than the family's is an outlier and fails.

Nothing is silently allowed. A deliberate difference goes in the
`ALLOWED` list at the top of the file with a reason. **That list is now
empty.** Every value in every face is uniform, and the only thing that
varies across the page is its own spacing scale. Nothing here differs
from its family without being a bug.

Everything that was once in that list is recorded there, with the
reason it went, so a change that wants one back has to argue with the
reason rather than rediscover it. Two are worth knowing about: the
**title register** and the **title sizes**.

Display type was set by where a thing sat on the spectrum, via a
per-section `--st`: `wght` 580 to 460, `SOFT` 0 to 100, `WONK` 0 to 1
and tracking across 0.042em, logic end to feeling end. Driven that hard
it stopped reading as one family. `WONK` swaps in alternate letter
shapes, so the first and last titles were not even the same glyphs, and
nothing on the site caught it. Narrowed until they read as one family
again, it stopped doing anything at all: titles set with the ramp and
with it pinned are indistinguishable at 34px and at 56px.

So the register is **fixed by rule**: weight 575, tracking -0.032em,
line height 1.02, everywhere display type is used. Mono is fixed the
same way at 400 / 0.09em / 1.6, and body at 400 / 0 / 1.6. `--st` is
gone from the stylesheet and the markup rather than left sitting there
unread.

The current families, all uniform:

| face | roles | weight | tracking | line height | sizes at 1440 |
|---|---|---|---|---|---|
| Fraunces | 7 | 575 | -0.032em | 1.02 | 88 / 56 / 22 / 20px |
| Martian Mono | 16 | 400 | 0.09em | 1.6 | 10px, 12.24px |
| Instrument Sans | 6 | 400 | 0 | 1.6 | 17 / 15px |

The size column is the only place variation is expected, and it varies
by role, never within one: all seven product titles are 56px, all
sixteen mono roles are 10px bar the placeholder. If a weight, tracking
or line height column ever shows two numbers, the auditor fails and one
of them is wrong.

None of that touches `--t`. The scroll-driven accent, the ribbon, the
hero plot and the mini axes are unchanged. The spectrum is carried by
colour, by position and by the marks, and that is enough.

The title sizes went the same way and for the same kind of reason.
Product titles came in three sizes, 56 / 46 / 30px at 1440, one per
entry weight class. But entry weight is already carried by the mark,
by the padding around the entry, and by how many fields its brief
holds. As a fourth signal on top of those, the size steps did not read
as hierarchy; seven names running down a page at three sizes read as a
page that had lost track of itself. All seven are now
`clamp(30px, 4vw, 56px)`, checked at all nine audited widths.

`--verbose` prints every role table rather than only the failing ones,
`--width <n>` checks one width instead of three.

```sh
node tools/check-auditors.mjs
node tools/check-auditors.mjs --control
```

The auditor self-test. Plants a known fault, runs the auditor that
should catch it, confirms the right check fired, reverts. Eleven
faults, one per class of thing the other two tools claim to see: a
weight change on one title, a size change on one title, a tracking
change on one mono role, a swapped font family, a hard-coded colour in
a single-line rule, a one word final line, a name forced to wrap, a
misaligned lane, an off-scale spacing value, a nested element inside
one that also holds text, and an element that is visually hidden but
still in the DOM.

**Why this exists.** Both auditors have shipped bugs where the check
silently failed to see the thing it was written to catch: stylesheet
line numbers pointing at a comment-stripped copy, a colour scan blind
to every single-line rule, leaf detection that measured a decorative
arrow instead of the product name beside it, `aria-hidden` glyphs
counted as type. Four separate times, a passing run meant nothing. So
the tools are not trusted on their own say-so.

`--control` runs the patterns against a **clean** tree and fails if any
of them match. That is not ceremony. The first version of this harness
looked for `/orphan/` and `/alignment/`, both of which appear in the
*passing* output, so two faults reported CAUGHT while catching
nothing. A self-test that cannot fail is worse than none.

## What the auditors cannot see

Stated plainly, because a green run is easy to over-read. Each of these
was planted and confirmed to slip through:

- **Hover, focus and any other state.** Everything is measured in its
  resting state. `.entry-name:hover { font-weight: 300 }` passes.
- **Widths between the nine checked**, and anything below 360, which is
  the declared floor. 341 and 320 do fail today; they are out of scope,
  not secretly clean.
- **The marks.** SVG geometry is not audited at all. A mark given nine
  times the stroke width of its siblings passes.
- **Contrast and legibility.** Colour is checked for being a token, not
  for being readable. `.entry-desc { color: var(--bg) }` makes the
  descriptors invisible and passes every check.
- **Whether any of it is any good.** Rhythm, hierarchy, whether the
  copy earns its place, whether the page means what it says. No tool
  here has an opinion, and someone still has to look at the page.

## Developing

Any static server works:

```sh
python3 -m http.server 8000
```
