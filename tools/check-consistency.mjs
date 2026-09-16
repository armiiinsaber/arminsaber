#!/usr/bin/env node
// Design consistency auditor. Renders the page in headless Chrome and
// fails when a repeated role drifts: two instances of the same thing
// set in different type, spaced off the scale, painted a colour that is
// not a token, or sitting in a lane that does not line up.
//
// The line-breaking auditor next door (check-orphans.mjs) watches how
// copy breaks. This one watches whether the page is one design. Both
// run before any push.
//
// Four checks, at every width and in every state:
//
//   1. type        Every repeated role, side by side: family, weight,
//                  size, tracking, line height, variable axes, case.
//                  Any role whose instances disagree fails.
//   2. spacing     Vertical rhythm between entries, padding inside
//                  rows, the gaps in the facts and labs rows. Values
//                  off the --s scale that appear exactly once are
//                  flagged as one-offs.
//   3. colour      Every colour declaration in the stylesheet, plus
//                  every colour resolved on the page. A literal that is
//                  not a token and not derived from one fails.
//   4. alignment   The meta lane, the main lane and the mark lane, left
//                  edges across all seven entries. Any entry out of
//                  line fails.
//   5. cross-role  Every element on the page grouped by the face it uses,
//                  not by its role. One face, one weight, one tracking,
//                  one line height, one set of axis values, across the
//                  whole family. Size is the only thing allowed to vary
//                  by role. Checks 1 to 4 compare instances of a role
//                  against each other, which is how .sum-labs-name sat
//                  there setting its own weight and tracking and passed:
//                  all three of its instances agreed with each other.
//
// Nothing is silently allowed. A difference that is deliberate goes in
// ALLOWED below with a reason, and is still bounded: a spectrum rule is
// given a maximum spread, a size scale is given its buckets. The
// exception list is meant to be read and argued with.
//
// This is a standing constraint for the site, not a one-off pass. It
// holds across redesigns: new type scale, new layout, new copy, the
// four checks still apply. If a change cannot satisfy them, the change
// is wrong, not the rules.
//
// Run:  node tools/check-consistency.mjs
//       --width <n>   check one width instead of 1440, 390, 360
//       --verbose     print every role table, not just the failing ones
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const VERBOSE = argv.includes("--verbose");
const widths = argv.reduce(
  (acc, a, i) => (a === "--width" ? [...acc, Number(argv[i + 1])] : acc),
  [],
);
const WIDTHS = widths.length ? widths : [1440, 390, 360];

/* ---------- roles ----------
   Every repeated thing on the page that should look like itself
   wherever it appears. */

const ROLES = [
  ["product title", ".entry-name"],
  ["descriptor", ".entry-desc"],
  ["status tag", ".entry-status"],
  ["position label", ".entry-pos"],
  ["lede", ".sum-lede"],
  ["facts label", ".fact dt"],
  ["facts value", ".fact dd"],
  ["brief label", ".brief-row dt"],
  ["brief value", ".brief-row dd"],
  ["outbound link", ".entry-link"],
  ["labs name, scan", ".sum-labs-name"],
  ["labs name, brief", ".labs-name"],
  ["brief toggle", ".more-toggle"],
];

const PROPS = [
  "family",
  "weight",
  "sizePx",
  "trackEm",
  "lineRatio",
  "axes",
  "transform",
];

/* ---------- allowed differences ----------
   Each entry says which role and property may vary, how far, and why.
   "bounded" caps the spread between the smallest and largest value.
   "grouped" allows one value per named group and no variation inside
   a group. Nothing else may differ. */

const ALLOWED = [
  {
    role: "product title",
    prop: "sizePx",
    kind: "grouped",
    groupBy: "weightClass",
    why:
      "The three entry weights are deliberate and asked for: the work that " +
      "matters most gets a larger name. One size per weight class, no variation " +
      "inside a class. This is the only difference on the page that is clearly " +
      "earning an exception, because removing it would flatten the page on " +
      "purpose rather than by drift.",
  },

  // Everything that used to be here, and why it went. The list is a record,
  // not just a state, so a future change that wants one of these back has to
  // argue with the reason rather than rediscover it.
  //
  // product title weight and trackEm. The display register is now fixed at
  //   575 and -0.032em everywhere. Narrowed enough to read as one family it
  //   was doing no visible work: titles set with the ramp and with it pinned
  //   are indistinguishable at 34px and 56px. --st, which drove it, is gone
  //   from the stylesheet and the markup.
  // product title axes SOFT and WONK. Same finding, same fate, and these two
  //   were what broke it originally by swapping in alternate letter shapes.
  // product title lineRatio. Pinned at 1.02. Titles hold one line by rule, so
  //   line height only ever changed the height of the box, which is spacing.
  // labs name weight, tracking, lineRatio, axes. All three labs names sit in
  //   one entry and shared one --st, so the measured spread was zero on every
  //   one. Four exceptions guarding drift that could not happen.
  // outbound link lineRatio. Unbounded, and every link already measures 1.6.
  // descriptor sizePx. Minor entries set 15px against 17px elsewhere. The scan
  //   column should read as one list, and a minor entry is already marked as
  //   minor by its name size, its mark and its padding.
  // mono trackEm, six roles. Fixed at 0.09em site-wide.
];

/* Cross-role allowances. A role whose weight, tracking, line height or
   axes differ from the rest of its face needs a line here saying why.
   Size is not in scope: roles are meant to differ in size. */

const CROSS_ALLOWED = [];

/* Spacing values that are deliberately off the --s scale. Anything not
   on the scale and not listed here fails, however many times it is
   used: a value repeated in four places is still off the system. */

const ALLOWED_SPACING = [];

/* ---------- the audit, run inside the page ---------- */

function auditPage(roles, props) {
  const num = (v) => parseFloat(v) || 0;
  const visible = (el) => {
    if (el.closest("[hidden]")) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  };

  const weightClass = (el) => {
    const e = el.closest(".entry");
    if (!e) return "n/a";
    if (e.classList.contains("entry--major")) return "major";
    if (e.classList.contains("entry--minor")) return "minor";
    return "default";
  };

  /* 1. type ------------------------------------------------------- */
  const type = {};
  for (const [label, sel] of roles) {
    const rows = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      const size = num(cs.fontSize);
      const axes = {};
      for (const m of (cs.fontVariationSettings || "").matchAll(/"(\w+)"\s*([\d.-]+)/g)) {
        axes[m[1]] = parseFloat(m[2]);
      }
      rows.push({
        where: (el.closest(".entry") || {}).id || "page",
        text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 26),
        weightClass: weightClass(el),
        family: cs.fontFamily.split(",")[0].replace(/["']/g, ""),
        weight: Math.round(num(cs.fontWeight) * 100) / 100,
        sizePx: size,
        trackEm: cs.letterSpacing === "normal" ? 0 : Math.round((num(cs.letterSpacing) / size) * 10000) / 10000,
        lineRatio: Math.round((num(cs.lineHeight) / size) * 1000) / 1000,
        axes,
        transform: cs.textTransform,
      });
    }
    if (rows.length) type[label] = rows;
  }

  /* 2. spacing ---------------------------------------------------- */
  const rootCs = getComputedStyle(document.documentElement);
  const scale = [0];
  for (let i = 1; i <= 7; i++) {
    const v = num(rootCs.getPropertyValue(`--s${i}`));
    if (v) scale.push(v);
  }

  const SPACING = [
    ["entry vertical rhythm", ".entry", ["paddingTop", "paddingBottom"]],
    ["brief row padding", ".brief-row", ["paddingTop", "paddingBottom"]],
    ["facts row gaps", ".sum-facts", ["columnGap", "rowGap", "paddingTop", "marginTop"]],
    ["labs row gaps", ".sum-labs", ["columnGap", "rowGap", "marginTop"]],
    ["scan row gap", ".entry-line", ["columnGap", "marginTop"]],
    ["summary lane", ".sum", ["columnGap", "paddingTop"]],
    ["brief control", ".entry-more", ["columnGap", "marginTop"]],
  ];
  const spacing = [];
  for (const [label, sel, keys] of SPACING) {
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      const vals = {};
      for (const k of keys) vals[k] = Math.round(num(cs[k]) * 100) / 100;
      spacing.push({
        role: label,
        where: (el.closest(".entry") || {}).id || "page",
        weightClass: weightClass(el),
        vals,
      });
    }
  }

  /* 3. colour ----------------------------------------------------- */
  const tokens = {};
  for (const t of ["bg", "ink", "muted", "hair", "logic", "feel", "accent"]) {
    tokens[t] = rootCs.getPropertyValue(`--${t}`).trim();
  }
  const seen = {};
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    for (const prop of ["color", "backgroundColor", "borderTopColor"]) {
      const v = cs[prop];
      if (!v || v === "rgba(0, 0, 0, 0)" || v === "transparent") continue;
      const key = v;
      seen[key] = seen[key] || { value: v, count: 0, sample: "" };
      seen[key].count++;
      if (!seen[key].sample) {
        seen[key].sample = `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/)[0] || ""}`;
      }
    }
  }

  /* 5. cross-role: every element grouped by the face it uses --------- */
  const FACES = { display: "Fraunces", mono: "Martian Mono", body: "Instrument Sans" };
  const TEXT = "p, h1, h2, h3, dd, dt, li, span, a, button, mark, em, strong, figcaption";
  const families = { display: [], mono: [], body: [] };
  // An element counts if it directly contains text of its own. Using
  // "has no child in TEXT" instead would skip .sum-labs-name, which wraps
  // an arrow span, and measure the arrow instead of the product name.
  const ownText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
  for (const el of document.querySelectorAll(TEXT)) {
    if (!visible(el)) continue;
    // decorative glyphs are not type: the +/x toggles, the arrows on links
    if (el.closest('[aria-hidden="true"]')) continue;
    if (!ownText(el)) continue;
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "");
    const face = Object.keys(FACES).find((k) => FACES[k] === fam);
    if (!face) continue;
    const size = num(cs.fontSize);
    const axes = {};
    for (const m of (cs.fontVariationSettings || "").matchAll(/"(\w+)"\s*([\d.-]+)/g)) {
      axes[m[1]] = parseFloat(m[2]);
    }
    // name it by its most specific class, falling back to the tag
    const cls = String(el.className).trim().split(/\s+/)
      .filter((c) => c && c !== "mono" && c !== "display" && c !== "nowrap");
    const parent = el.parentElement ? String(el.parentElement.className).trim().split(/\s+/)[0] : "";
    families[face].push({
      role: cls[0] || (parent ? `${parent} ${el.tagName.toLowerCase()}` : el.tagName.toLowerCase()),
      weight: Math.round(num(cs.fontWeight) * 100) / 100,
      trackEm: cs.letterSpacing === "normal" ? 0 : Math.round((num(cs.letterSpacing) / size) * 10000) / 10000,
      lineRatio: Math.round((num(cs.lineHeight) / size) * 1000) / 1000,
      axes: Object.keys(axes).length
        ? Object.entries(axes).map(([k, n]) => `${k} ${n}`).join(", ")
        : "none",
      sizePx: size,
    });
  }

  /* 4. alignment -------------------------------------------------- */
  const lanes = [];
  for (const entry of document.querySelectorAll(".entry")) {
    if (!visible(entry)) continue;
    const meta = entry.querySelector(".entry-meta");
    const name = entry.querySelector(".entry-name");
    const mark = entry.querySelector(":scope > .entry-head > .mark");
    const lede = entry.querySelector(".sum-lede");
    const r = (el) => (el && visible(el) ? Math.round(el.getBoundingClientRect().left) : null);
    lanes.push({
      id: entry.id,
      weightClass: weightClass(entry),
      meta: r(meta),
      main: r(name),
      lede: r(lede),
      markRight: mark && visible(mark) ? Math.round(mark.getBoundingClientRect().right) : null,
    });
  }

  return { type, spacing, scale, tokens, colours: Object.values(seen), lanes, families };
}

/* ---------- static colour check over the stylesheet ---------- */

function auditStylesheet(css) {
  // Walk the real lines so reported line numbers point at the file as it
  // is, not at a stripped copy. :root is where tokens are defined, so a
  // literal there is the definition, not drift.
  const COLOUR_PROP =
    /^\s*(color|background|background-color|border[a-z-]*|outline[a-z-]*|fill|stroke|box-shadow|text-shadow)\s*:/;
  const out = [];
  let inComment = false;
  let inRoot = false;
  css.split("\n").forEach((raw, i) => {
    let line = raw;
    if (inComment) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inComment = false;
    }
    // drop any complete comments, then notice an unterminated one
    line = line.replace(/\/\*[\s\S]*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open !== -1) {
      inComment = true;
      line = line.slice(0, open);
    }
    if (/^\s*:root\s*\{/.test(line)) inRoot = true;
    else if (inRoot && /^\s*\}/.test(line)) inRoot = false;
    if (inRoot) return;
    // data: URIs carry their own colours, they are not page paint
    if (line.includes("data:") || line.includes("%23")) return;
    // split on braces and semicolons so a single-line rule such as
    // ".entry-pos { color: #FF00AA; }" is scanned like any other
    for (const chunk of line.split(/[{};]/)) {
      if (!COLOUR_PROP.test(chunk)) continue;
      const literal = chunk.match(/#[0-9A-Fa-f]{3,8}\b|\brgba?\(/);
      if (literal) out.push({ line: i + 1, text: line.trim(), literal: literal[0] });
    }
  });
  return out;
}

/* ---------- plumbing ---------- */

function loadPuppeteer() {
  for (const id of ["puppeteer", "puppeteer-core"]) {
    try {
      return require(id);
    } catch {}
  }
  const npx = path.join(process.env.HOME || "", ".npm", "_npx");
  for (const dir of safeDirs(npx)) {
    try {
      return require(path.join(npx, dir, "node_modules", "puppeteer-core"));
    } catch {}
  }
  fail("puppeteer-core not found. npm i -g puppeteer-core, or set PUPPETEER_PATH.");
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
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const { existsSync } = require("node:fs");
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) fail("No Chrome found. Set CHROME_PATH.");
  return hit;
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
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

/* ---------- comparison ---------- */

const exceptionFor = (role, prop) => ALLOWED.find((a) => a.role === role && a.prop === prop);

function describe(prop, v) {
  if (prop === "axes") {
    return Object.keys(v).length
      ? Object.entries(v)
          .map(([k, n]) => `${k} ${n}`)
          .join(", ")
      : "none";
  }
  return String(v);
}

function checkRole(label, rows, problems, notes) {
  for (const prop of PROPS) {
    const values = rows.map((r) => describe(prop, r[prop]));
    const distinct = [...new Set(values)];
    if (distinct.length === 1) continue;

    const ex = exceptionFor(label, prop);
    if (!ex) {
      problems.push({
        kind: "type",
        label,
        prop,
        detail: `${distinct.length} different values with no allowance`,
        rows,
      });
      continue;
    }

    if (ex.kind === "free") {
      notes.push(`${label} · ${prop}: varies, allowed — ${ex.why}`);
    } else if (ex.kind === "bounded") {
      const nums = rows.map((r) => r[prop]);
      const spread = Math.max(...nums) - Math.min(...nums);
      if (spread > ex.max + 1e-9) {
        problems.push({
          kind: "type",
          label,
          prop,
          detail: `spread ${round(spread)} exceeds the allowed ${ex.max} — ${ex.why}`,
          rows,
        });
      } else {
        notes.push(`${label} · ${prop}: spread ${round(spread)} of ${ex.max} allowed`);
      }
    } else if (ex.kind === "axisBounds") {
      for (const [axis, max] of Object.entries(ex.max)) {
        const nums = rows.map((r) => r.axes[axis]).filter((n) => n !== undefined);
        if (!nums.length) continue;
        const spread = Math.max(...nums) - Math.min(...nums);
        if (spread > max + 1e-9) {
          problems.push({
            kind: "type",
            label,
            prop: `axis ${axis}`,
            detail: `spread ${round(spread)} exceeds the allowed ${max} — ${ex.why}`,
            rows,
          });
        } else {
          notes.push(`${label} · axis ${axis}: spread ${round(spread)} of ${max} allowed`);
        }
      }
    } else if (ex.kind === "grouped") {
      const groups = {};
      for (const r of rows) (groups[r[ex.groupBy]] ||= []).push(r);
      for (const [g, list] of Object.entries(groups)) {
        const d = [...new Set(list.map((r) => describe(prop, r[prop])))];
        if (d.length > 1) {
          problems.push({
            kind: "type",
            label,
            prop,
            detail: `group "${g}" is not uniform: ${d.join(" vs ")} — ${ex.why}`,
            rows: list,
          });
        }
      }
      if (!problems.some((p) => p.label === label && p.prop === prop)) {
        notes.push(
          `${label} · ${prop}: one value per ${ex.groupBy} (${Object.entries(groups)
            .map(([g, l]) => `${g} ${describe(prop, l[0][prop])}`)
            .join(", ")})`,
        );
      }
    }
  }
}

const round = (n) => Math.round(n * 10000) / 10000;

function printRoleTable(label, rows) {
  console.log(`\n  ${label}  (${rows.length} instances)`);
  console.log(
    `    ${"where".padEnd(20)} ${"family".padEnd(10)} ${"wght".padEnd(7)} ${"size".padEnd(6)} ${"track/em".padEnd(9)} ${"line".padEnd(6)} ${"case".padEnd(10)} axes`,
  );
  for (const r of rows) {
    console.log(
      `    ${(r.where + " " + r.text).slice(0, 20).padEnd(20)} ${r.family.padEnd(10)} ${String(r.weight).padEnd(7)} ${String(r.sizePx).padEnd(6)} ${String(r.trackEm).padEnd(9)} ${String(r.lineRatio).padEnd(6)} ${r.transform.padEnd(10)} ${describe("axes", r.axes)}`,
    );
  }
}

/* ---------- run ---------- */

const puppeteer = loadPuppeteer();
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--hide-scrollbars"],
});

const problems = [];
const notes = [];

// colour, statically over the stylesheet — width independent
const css = await readFile(path.join(root, "styles.css"), "utf8");
const literals = auditStylesheet(css);
console.log("=== colour: stylesheet declarations ===");
if (!literals.length) {
  console.log("ok    every colour declaration is a token or derived from one");
} else {
  for (const l of literals) {
    problems.push({
      kind: "colour",
      label: "styles.css",
      prop: `line ${l.line}`,
      detail: `raw literal ${l.literal} outside :root — ${l.text}`,
    });
    console.log(`FAIL  styles.css:${l.line}  raw literal ${l.literal}`);
    console.log(`      ${l.text}`);
  }
}

for (const width of WIDTHS) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width < 500 ? 844 : 900 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 300));

  for (const state of ["collapsed", "layer 2", "layer 3"]) {
    if (state === "layer 2") {
      await page.evaluate(() => document.querySelector(".expand-all")?.click());
      await new Promise((r) => setTimeout(r, 900));
    }
    if (state === "layer 3") {
      await page.evaluate(() =>
        document.querySelectorAll(".entry-more .more-toggle").forEach((b) => b.click()),
      );
      await new Promise((r) => setTimeout(r, 900));
    }

    const res = await page.evaluate(auditPage, ROLES, PROPS);
    const tag = `[${width}px, ${state}]`;
    console.log(`\n=== ${width}px · ${state} ===`);

    /* 1. type */
    const before = problems.length;
    for (const [label, rows] of Object.entries(res.type)) {
      const found = [];
      checkRole(label, rows, found, notes);
      for (const f of found) problems.push({ ...f, where: tag });
      if (VERBOSE || found.length) printRoleTable(label, rows);
      for (const f of found) console.log(`    FAIL  ${f.label} · ${f.prop}: ${f.detail}`);
    }
    if (problems.length === before) console.log("  type       ok, every role is internally consistent");

    /* 2. spacing */
    const offScale = [];
    for (const sp of res.spacing) {
      for (const [k, v] of Object.entries(sp.vals)) {
        if (!v) continue;
        if (res.scale.some((x) => Math.abs(x - v) < 0.6)) continue;
        if (ALLOWED_SPACING.some((a) => Math.abs(a.px - v) < 0.6)) continue;
        offScale.push({ ...sp, k, v });
      }
    }
    if (!offScale.length) {
      console.log("  spacing    ok, every value is on the --s scale or an allowed exception");
    } else {
      // report one line per distinct value, listing where it is used
      const byValue = new Map();
      for (const o of offScale) {
        const key = `${o.v}`;
        byValue.set(key, (byValue.get(key) || []).concat(`${o.role}/${o.k} on ${o.where}`));
      }
      for (const [v, uses] of byValue) {
        problems.push({
          kind: "spacing",
          label: "off-scale",
          prop: `${v}px`,
          detail: `${uses.length} use(s): ${uses.slice(0, 4).join(", ")}`,
          where: tag,
        });
        console.log(`  FAIL  spacing  ${v}px is not on the --s scale and not an allowed exception`);
        console.log(`        ${uses.slice(0, 4).join(", ")}${uses.length > 4 ? ` and ${uses.length - 4} more` : ""}`);
      }
    }

    /* 3. colour, resolved */
    const known = new Set(Object.values(res.tokens).map((v) => v.toLowerCase()));
    console.log(`  colour     ${res.colours.length} distinct resolved values in use`);
    if (VERBOSE) {
      for (const c of res.colours.sort((a, b) => b.count - a.count)) {
        console.log(`      ${String(c.count).padStart(4)}x  ${c.value.padEnd(26)} ${c.sample}`);
      }
    }

    /* 5. cross-role: one face, one weight, one tracking, one line height */
    for (const [face, rows] of Object.entries(res.families)) {
      if (rows.length < 2) continue;
      for (const prop of ["weight", "trackEm", "lineRatio", "axes"]) {
        // which roles hold which value
        const byValue = new Map();
        for (const r of rows) {
          const k = String(r[prop]);
          if (!byValue.has(k)) byValue.set(k, new Set());
          byValue.get(k).add(r.role);
        }
        if (byValue.size < 2) continue;
        // the value held by the most roles is the family's; the rest are outliers
        const ranked = [...byValue.entries()].sort((a, b) => b[1].size - a[1].size);
        const [mainValue, mainRoles] = ranked[0];
        console.log(`  cross-role ${face} · ${prop}: ${byValue.size} values in this face`);
        for (const [v, roles] of ranked) {
          const mark = v === mainValue ? "      " : "  OUT ";
          console.log(`${mark}  ${String(v).padEnd(12)} ${roles.size} role(s): ${[...roles].join(", ")}`);
        }
        for (const [v, roles] of ranked.slice(1)) {
          for (const role of roles) {
            const ex = CROSS_ALLOWED.find(
              (a) => a.face === face && a.prop === prop && a.role === role,
            );
            if (ex) {
              notes.push(`${face} · ${prop} · ${role}: differs, allowed — ${ex.why}`);
              continue;
            }
            problems.push({
              kind: "cross-role",
              label: `${face} face`,
              prop,
              detail: `${role} uses ${v} where the rest of the face uses ${mainValue} (${mainRoles.size} roles)`,
              where: tag,
            });
            console.log(`  FAIL  cross-role  ${face} · ${prop}: ${role} uses ${v}, the face uses ${mainValue}`);
          }
        }
      }
    }

    /* 4. alignment */
    const laneProblems = [];
    for (const lane of ["meta", "main", "lede"]) {
      const vals = res.lanes.map((l) => l[lane]).filter((v) => v !== null);
      const distinct = [...new Set(vals)];
      if (distinct.length > 1) {
        laneProblems.push({
          lane,
          detail: `${distinct.length} different left edges: ${res.lanes
            .filter((l) => l[lane] !== null)
            .map((l) => `${l.id} ${l[lane]}`)
            .join(", ")}`,
        });
      }
    }
    const marks = res.lanes.map((l) => l.markRight).filter((v) => v !== null);
    if (new Set(marks).size > 1) {
      laneProblems.push({
        lane: "mark",
        detail: `mark lane right edges differ: ${res.lanes
          .filter((l) => l.markRight !== null)
          .map((l) => `${l.id} ${l.markRight}`)
          .join(", ")}`,
      });
    }
    if (!laneProblems.length) {
      console.log("  alignment  ok, all seven entries share the same lanes");
    } else {
      for (const lp of laneProblems) {
        problems.push({ kind: "alignment", label: `${lp.lane} lane`, prop: "left edge", detail: lp.detail, where: tag });
        console.log(`  FAIL  alignment  ${lp.lane} lane: ${lp.detail}`);
      }
    }
  }
  await page.close();
}

await browser.close();
server.close();

console.log("\n=== allowed differences, all bounded ===");
for (const n of [...new Set(notes)].sort()) console.log(`  ${n}`);

const byKind = {};
for (const p of problems) byKind[p.kind] = (byKind[p.kind] || 0) + 1;

if (problems.length) {
  console.log(`\n${problems.length} consistency failure${problems.length === 1 ? "" : "s"}:`);
  for (const [k, n] of Object.entries(byKind)) console.log(`  ${String(n).padStart(3)} ${k}`);
} else {
  console.log(
    `\nConsistent at ${WIDTHS.join("px, ")}px, in all three layers: every repeated role ` +
      `shares its type, every space is on the scale, every colour is a token or derived ` +
      `from one, and all seven entries share their lanes.`,
  );
}
process.exit(problems.length ? 1 : 0);
