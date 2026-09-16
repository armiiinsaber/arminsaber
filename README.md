# arminsaber.com

Personal site. Static, vanilla HTML/CSS/JS, no build step.

> **Before announcing the site:** remove the
> `<meta name="robots" content="noindex, nofollow">` tag from
> `index.html`. It is there because the page still carries two
> `[ARMIN: …]` placeholders, both in the MELOMANIA entry, and the site
> should not be indexed in that state. The `href="#"` links this note
> used to mention are all filled in.

One page, one axis: logic at the top, feeling at the bottom. Scroll
position drives `--t`; the accent colour and the typographic register
cool from indigo to chartreuse as you descend. The sticky ribbon plots
every project on that axis and tracks where you are.

Each project reads in three layers. The collapsed row is the scan: a
mark, a position, a mini axis, the name, a descriptor of six words or
fewer, a status and a toggle, and nothing else. The first expand is
the summary: two sentences and up to four short facts. A quiet control
under that opens the full brief. Expand all and deep links open the
summary and never the brief.

## House rules

Two constraints hold across any redesign of this site, and both are
enforced rather than remembered:

- **Typography.** `tools/check-orphans.mjs` fails the build on four
  line-breaking faults at every width, in every layer. See
  [Before every push](#before-every-push) for all four.
- **Links.** `tools/check-links.mjs` requests every outbound link.

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

The typographic auditor. Renders the page in headless Chrome at 1440,
390 and 360, three times per width, once per layer: the collapsed scan
rows, then every summary open, then every full brief open. It measures
where each word actually sits and fails on four faults.

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

## Developing

Any static server works:

```sh
python3 -m http.server 8000
```
