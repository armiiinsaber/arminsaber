# arminsaber.com

Personal site. Static, vanilla HTML/CSS/JS, no build step.

> **Before announcing the site:** remove the
> `<meta name="robots" content="noindex, nofollow">` tag from
> `index.html`. It is there because the page still carries two
> `[ARMIN: …]` placeholders and five `href="#"` links, and the site
> should not be indexed in that state.

One page, one axis: logic at the top, feeling at the bottom. Scroll
position drives `--t`; the accent colour and the typographic register
cool from indigo to chartreuse as you descend. The sticky ribbon plots
every project on that axis and tracks where you are.

## Filling in the blanks

Every fact I could not verify is a visible placeholder in the page,
rendered as a dashed box. Search `index.html` for `[ARMIN:` and replace
each one. Contact hrefs in the footer are `#` placeholders too.

## Deploying

Pushing to `main` deploys via `.github/workflows/deploy.yml`
(GitHub Pages, actions-based). One-time setup in the repo settings:

1. Settings → Pages → Source: **GitHub Actions**
2. Settings → Pages → Custom domain: **arminsaber.com** (the `CNAME`
   file is included for branch-based fallback)
3. DNS: point `arminsaber.com` A records at GitHub Pages, `www` CNAME
   at `<user>.github.io`

## Developing

Any static server works:

```sh
python3 -m http.server 8000
```
