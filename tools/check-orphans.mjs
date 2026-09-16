#!/usr/bin/env node
// Renders the page in headless Chrome and fails if any line of visible
// copy ends with a single word on its own. Runs each width twice, once
// collapsed and once with "Expand all" on, so the briefs are covered.
// Run after every copy change:  node tools/check-orphans.mjs
//
//   --shots <dir>   also write hero + full-page screenshots there
//   --width <n>     check one width instead of 1440, 390, 360 (repeatable)
//   --url <url>     audit a running site instead of the local files
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

/* ---------- arguments ---------- */

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const widths = argv.reduce(
  (acc, a, i) => (a === "--width" ? [...acc, Number(argv[i + 1])] : acc),
  [],
);
const WIDTHS = widths.length ? widths : [1440, 390, 360];
const SHOTS = flag("--shots");
const EXTERNAL = flag("--url");

/* ---------- dependencies ----------
   puppeteer-core is not a dependency of this repo (there is no build
   step and no package.json); it is picked up from wherever npm has
   already put it, including an npx cache. */

function loadPuppeteer() {
  const candidates = [
    "puppeteer",
    "puppeteer-core",
    ...(process.env.PUPPETEER_PATH ? [process.env.PUPPETEER_PATH] : []),
  ];
  for (const id of candidates) {
    try {
      return require(id);
    } catch {}
  }
  const npx = path.join(process.env.HOME || "", ".npm", "_npx");
  for (const dir of safeDirs(npx)) {
    const p = path.join(npx, dir, "node_modules", "puppeteer-core");
    try {
      return require(p);
    } catch {}
  }
  fail(
    "puppeteer-core not found.\n" +
      "  Install it:  npm i -g puppeteer-core\n" +
      "  Or point at an existing copy:  PUPPETEER_PATH=/path/to/puppeteer-core node tools/check-orphans.mjs",
  );
}

function safeDirs(dir) {
  try {
    return require("node:fs").readdirSync(dir);
  } catch {
    return [];
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const { existsSync } = require("node:fs");
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) fail("No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.");
  return hit;
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

/* ---------- static server over the working tree ---------- */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      let rel = decodeURIComponent(req.url.split("?")[0]);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/* ---------- the audit, run inside the page ---------- */

function auditOrphans() {
  // leaf-ish blocks that carry copy; a block holding another of these
  // is a wrapper and is skipped so lines are not counted twice
  const SEL = "p, h1, h2, h3, dd, dt, li, figcaption, button, a.mono";
  const found = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (el.querySelector(SEL)) continue;
    if (el.closest("[hidden]")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (!el.getClientRects().length) continue;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      // decorative glyphs (the +/- toggle, the ↗ on links) are not copy
      acceptNode: (node) =>
        node.parentElement && node.parentElement.closest('[aria-hidden="true"]')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });

    // measure every word where it actually sits, then group by line box
    const words = [];
    let node;
    while ((node = walker.nextNode())) {
      for (const m of node.nodeValue.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) continue;
        words.push({ word: m[0], top: rect.top });
      }
    }
    if (words.length < 2) continue;

    const lines = [];
    for (const w of words) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(line.top - w.top) < 3) line.words.push(w.word);
      else lines.push({ top: w.top, words: [w.word] });
    }
    const last = lines[lines.length - 1];
    if (lines.length > 1 && last.words.length === 1) {
      found.push({
        where: el.className || el.tagName.toLowerCase(),
        lines: lines.length,
        orphan: last.words[0],
        text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 72),
      });
    }
  }
  return found;
}

/* ---------- run ---------- */

const puppeteer = loadPuppeteer();
const server = EXTERNAL ? null : await serve();
const base = EXTERNAL || `http://127.0.0.1:${server.address().port}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--hide-scrollbars"],
});

let failures = 0;
for (const width of WIDTHS) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width < 500 ? 844 : 900, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 300));

  console.log(`\n=== ${width}px ===`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `hero-${width}.png`) });

  const hits = (await page.evaluate(auditOrphans)).map((h) => ({ ...h, state: "collapsed" }));

  // again with every brief open — most of the copy lives in there
  await page.evaluate(() => document.querySelector(".expand-all")?.click());
  await new Promise((r) => setTimeout(r, 900));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `full-${width}.png`), fullPage: true });
  hits.push(...(await page.evaluate(auditOrphans)).map((h) => ({ ...h, state: "expanded" })));

  if (!hits.length) console.log("ok    no orphans");
  for (const h of hits) {
    failures++;
    console.log(`FAIL  "${h.orphan}" alone on line ${h.lines} of ${h.lines}  [${h.where}, ${h.state}]`);
    console.log(`      ${h.text}`);
  }
  await page.close();
}

await browser.close();
server?.close();

console.log(
  failures
    ? `\n${failures} orphan${failures === 1 ? "" : "s"}. Rewrite the line so the last line carries two words or more.`
    : `\nNo orphans at ${WIDTHS.join("px, ")}px, collapsed or expanded.`,
);
if (SHOTS) console.log(`Screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
