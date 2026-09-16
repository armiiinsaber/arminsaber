#!/usr/bin/env node
// Typographic auditor. Renders the page in headless Chrome and fails on
// four line-breaking faults in visible copy. Runs each width three times,
// once per layer: the collapsed scan rows, then "Expand all" for every
// summary, then every "Full brief" open so layer 3 is covered too.
//
// The four rules, at every width and in every state:
//
//   1. no-wrap      Headings and product names hold one line. h1, h2, h3
//                   and .sum-labs-name must not break. The only escape is
//                   an explicit data-wrap attribute in the markup.
//   2. unbalanced   An element carrying data-wrap="balanced" may wrap, but
//                   evenly: no line shorter than a third of the longest.
//                   The hero headline is the only one on the site.
//   3. over-three   No text block runs past three lines in the scan layer
//                   or in a facts value. Layer 2 ledes and layer 3 brief
//                   fields are exempt, they are meant to be prose.
// Two things are not copy and are never audited: anything inside an
// aria-hidden element (the +/- toggles, the ↗ on links) and mark.ph,
// the to-fill placeholders.
//
//   4. orphan/runt  The last line must not be a single word, and must not
//                   be shorter than a quarter of the line above it. A two
//                   word runt is the same fault as a one word orphan.
//
// This is a standing constraint for the site, not a one-off pass. It holds
// across redesigns: if a change cannot satisfy these four, the change is
// wrong, not the rules.
//
// Run after every copy or type change:  node tools/check-orphans.mjs
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

function auditPage() {
  // leaf-ish blocks that carry copy; a block holding another of these
  // is a wrapper and is skipped so lines are not counted twice
  const SEL =
    "p, h1, h2, h3, dd, dt, li, figcaption, button, a.mono, .sum-labs-name, .entry-status";
  // rule 1: headings and product names hold one line
  const NOWRAP = "h1, h2, h3, .sum-labs-name";
  // rule 3: the scan row and the facts values are capped at three lines.
  // Ledes and brief fields are prose and are deliberately absent here.
  const CAP = ".entry-desc, .entry-pos, .entry-cat, .entry-status, .fact dt, .fact dd";
  const CAP_LINES = 3;
  const RUNT = 0.25;      // last line against the line above it
  const BALANCE = 1 / 3;  // shortest line against the longest

  const found = [];
  const deferred = [];

  for (const el of document.querySelectorAll(SEL)) {
    if (el.querySelector(SEL)) continue;
    if (el.closest("[hidden]")) continue;

    // A field still holding a to-fill placeholder is scaffolding. The
    // browser breaks the whole string including the placeholder, so its
    // rag says nothing about the copy that will land there, and binding
    // it now would leave a stale break behind once it is filled. Report
    // it as deferred rather than passing it silently or failing it.
    if (el.querySelector("mark.ph")) {
      const ph = el.closest(".entry");
      deferred.push({
        where: [ph && `#${ph.id}`, el.closest(".brief-row, .fact")?.querySelector("dt")?.textContent.trim()]
          .filter(Boolean)
          .join(" "),
      });
      continue;
    }
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
        words.push({ word: m[0], top: rect.top, left: rect.left, right: rect.right });
      }
    }
    if (!words.length) continue;

    const lines = [];
    for (const w of words) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(line.top - w.top) < 3) {
        line.words.push(w.word);
        line.right = Math.max(line.right, w.right);
      } else {
        lines.push({ top: w.top, words: [w.word], left: w.left, right: w.right });
      }
    }
    for (const l of lines) l.px = Math.round(l.right - l.left);

    // name the element the way a person would look for it: which entry,
    // which element, and for a labelled row, which field
    const tag = el.className
      ? `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join(".")}`
      : el.tagName.toLowerCase();
    const entry = el.closest(".entry");
    const field = el.closest(".brief-row, .fact")?.querySelector("dt")?.textContent.trim();
    const where = [entry && `#${entry.id}`, tag, field && `"${field}"`]
      .filter(Boolean)
      .join(" ");
    const breakdown = lines.map((l) => ({
      px: l.px,
      n: l.words.length,
      text: l.words.join(" "),
    }));
    const fail = (rule, detail) =>
      found.push({ rule, where, detail, lines: breakdown });

    const mayWrap = el.hasAttribute("data-wrap");

    // 1. headings and product names hold one line
    if (el.matches(NOWRAP) && !mayWrap && lines.length > 1) {
      fail("no-wrap", `${lines.length} lines, must hold 1`);
    }

    // 2. what is allowed to wrap must wrap evenly
    if (mayWrap && el.dataset.wrap === "balanced" && lines.length > 1) {
      const px = lines.map((l) => l.px);
      const shortest = Math.min(...px);
      const longest = Math.max(...px);
      if (shortest < longest * BALANCE) {
        fail(
          "unbalanced",
          `shortest line ${shortest}px is ${Math.round((shortest / longest) * 100)}% of the longest ${longest}px, floor ${Math.round(BALANCE * 100)}%`,
        );
      }
    }

    // 3. three-line cap in the scan layer and in facts values
    if (el.matches(CAP) && lines.length > CAP_LINES) {
      fail("over-three", `${lines.length} lines, cap ${CAP_LINES}`);
    }

    // 4. no orphan, and no runt either
    if (lines.length > 1) {
      const last = lines[lines.length - 1];
      const prev = lines[lines.length - 2];
      if (last.words.length === 1) {
        fail("orphan", `"${last.words[0]}" alone on the last line`);
      } else if (last.px < prev.px * RUNT) {
        fail(
          "runt",
          `last line ${last.px}px is ${Math.round((last.px / prev.px) * 100)}% of the ${prev.px}px above it, floor ${Math.round(RUNT * 100)}%`,
        );
      }
    }
  }

  return { found, deferred };
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
const byRule = {};
for (const width of WIDTHS) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width < 500 ? 844 : 900, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 300));

  console.log(`\n=== ${width}px ===`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `hero-${width}.png`) });

  let scan = await page.evaluate(auditPage);
  const hits = scan.found.map((h) => ({ ...h, state: "collapsed" }));
  const skipped = new Map(scan.deferred.map((d) => [d.where, true]));

  // again with every summary open — layer 2
  await page.evaluate(() => document.querySelector(".expand-all")?.click());
  await new Promise((r) => setTimeout(r, 900));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `summary-${width}.png`), fullPage: true });
  scan = await page.evaluate(auditPage);
  hits.push(...scan.found.map((h) => ({ ...h, state: "layer 2" })));
  scan.deferred.forEach((d) => skipped.set(d.where, true));

  // and once more with every full brief open — layer 3, where most of
  // the copy actually lives
  await page.evaluate(() =>
    document.querySelectorAll(".entry-more .more-toggle").forEach((b) => b.click()),
  );
  await new Promise((r) => setTimeout(r, 900));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `full-${width}.png`), fullPage: true });
  scan = await page.evaluate(auditPage);
  hits.push(...scan.found.map((h) => ({ ...h, state: "layer 3" })));
  scan.deferred.forEach((d) => skipped.set(d.where, true));

  if (!hits.length) console.log("ok    all four rules pass in every layer");
  for (const where of skipped.keys()) {
    console.log(`defer ${where} — still holds a placeholder, audited once it is filled`);
  }
  for (const h of hits) {
    failures++;
    byRule[h.rule] = (byRule[h.rule] || 0) + 1;
    console.log(`FAIL  ${h.rule.padEnd(10)} ${h.where}   [${width}px, ${h.state}]`);
    console.log(`      ${h.detail}`);
    h.lines.forEach((l, i) =>
      console.log(
        `      ${String(i + 1).padStart(2)}  ${String(l.px).padStart(4)}px  ${String(l.n).padStart(2)}w  ${l.text}`,
      ),
    );
  }
  await page.close();
}

await browser.close();
server?.close();

const HOW = {
  "no-wrap": "size the type, tighten the tracking or widen the lane so the name holds one line",
  unbalanced: "rebalance the break, the shortest line must reach a third of the longest",
  "over-three": "shorten the value or widen its column, this block is capped at three lines",
  orphan: "rewrite or bind the tail so the last line carries two words or more",
  runt: "bind the tail with non-breaking spaces, or rewrite, so the last line fills",
};

if (failures) {
  console.log(`\n${failures} failure${failures === 1 ? "" : "s"} across ${WIDTHS.join("px, ")}px:`);
  for (const [rule, n] of Object.entries(byRule)) {
    console.log(`  ${String(n).padStart(3)} ${rule.padEnd(10)} ${HOW[rule]}`);
  }
} else {
  console.log(
    `\nClean at ${WIDTHS.join("px, ")}px, in all three layers: no wrapped headings, ` +
      `the hero breaks evenly, nothing over three lines where it is capped, no orphans and no runts.`,
  );
}
if (SHOTS) console.log(`Screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
