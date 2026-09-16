#!/usr/bin/env node
// Auditor self-test. Plants a known fault, runs the auditor that should
// catch it, confirms the right check fired, reverts. Ten faults, one per
// class of thing the other two tools claim to see.
//
// This exists because both auditors have shipped bugs where the check
// silently failed to see the thing it was written to catch: line numbers
// pointing at a stripped copy of the stylesheet, a colour scan blind to
// single-line rules, leaf detection that measured a decorative arrow
// instead of the product name beside it, aria-hidden glyphs counted as
// type. A green run means nothing on its own. This is what makes it
// mean something.
//
// Two rules keep it honest:
//
//   Every expected pattern must match a FAIL line, never a summary line.
//   An earlier version looked for /orphan/ and /alignment/, both of
//   which appear in the PASSING output ("no orphans and no runts",
//   "alignment ok"), so two faults reported CAUGHT without anything
//   being caught at all.
//
//   Planting is verified, not assumed. Fault 5 first used copy that
//   text-wrap:balance quietly repaired, so the fault never existed and
//   the miss looked like an auditor gap. The copy now runs long enough
//   that the balancer gives up.
//
// Run:  node tools/check-auditors.mjs        all ten
//       node tools/check-auditors.mjs 3,7    only those
//       node tools/check-auditors.mjs --control
//                                            prove no pattern matches a
//                                            clean run, which is what
//                                            makes a CAUGHT meaningful
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CSS = path.join(root, "styles.css");
const HTML = path.join(root, "index.html");

const FAULTS = [
  { n: 1, what: "weight change on one product title only",
    css: "#echoes .entry-name { font-weight: 640; }",
    tool: "consistency", want: /FAIL {2}product title · weight/ },
  { n: 2, what: "tracking change on one mono role only",
    css: ".entry-status { letter-spacing: 0.15em; }",
    tool: "consistency", want: /FAIL {2}cross-role {2}mono · trackEm/ },
  { n: 3, what: "different font family on one element",
    css: "#klenz .entry-name { font-family: Georgia, serif; }",
    tool: "consistency", want: /FAIL {2}product title · family/ },
  { n: 4, what: "hard-coded colour in a single-line rule",
    css: ".entry-status { color: #FF00AA; }",
    tool: "consistency", want: /FAIL {2}styles\.css:\d+ {2}raw literal #FF00AA/ },
  { n: 5, what: "one word final line in a brief field",
    html: [
      "<dd>It got used, which is the only bar. We&rsquo;re still on it, and Strava feeds the running data automatically. WHOOP sleep is next.</dd>",
      "<dd>It got used, which is the only bar we ever agreed to hold ourselves to, and we kept at it for month after month after month without ever once stopping to ask whether a single part of what we had built was genuinely working for anybody at all, or whether we had simply grown used to the sight of it sitting there on the screen every morning, unchanged and unexamined and quietly accruing the kind of weight that makes a thing hard to remove later, incomprehensibly.</dd>",
    ],
    tool: "orphans", want: /FAIL\s+orphan\s/ },
  { n: 6, what: "product name forced to wrap at 390",
    css: "#melomaniac-studios .entry-name { font-size: 44px; }",
    tool: "orphans", want: /FAIL\s+no-wrap\s/ },
  { n: 7, what: "an element whose lane does not align",
    css: "#echoes .entry-meta { margin-left: 12px; }",
    tool: "consistency", want: /FAIL {2}alignment/ },
  { n: 8, what: "spacing value off the scale by a few pixels",
    css: ".brief-row { padding-top: 26px; }",
    tool: "consistency", want: /FAIL {2}spacing {2}26px/ },
  { n: 9, what: "nested element whose parent also holds text",
    css: ".probe-nested { font-weight: 700; }",
    html: ["which is the only bar.", "which is the <span class=\"probe-nested\">only</span> bar."],
    tool: "consistency", want: /FAIL {2}cross-role {2}body · weight/ },
  { n: 10, what: "element visually hidden but still in the DOM",
    css: ".probe-hidden { opacity: 0; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.3em; }",
    html: ["<h2 class=\"display entry-name\">Echoes</h2>",
           "<h2 class=\"display entry-name\">Echoes</h2><span class=\"probe-hidden\">drift</span>"],
    tool: "consistency", want: /FAIL {2}cross-role {2}mono · trackEm/ },
];

const runOnce = (tool) => {
  try {
    return execFileSync("node", [path.join(root, `tools/check-${tool}.mjs`)],
      { cwd: root, encoding: "utf8", maxBuffer: 40e6 });
  } catch (e) { return (e.stdout || "") + (e.stderr || ""); }
};
// headless Chrome occasionally drops a navigation; a run that never
// reached its summary line is a crash, not a result, so try again
const run = (tool) => {
  for (let i = 0; i < 3; i++) {
    const out = runOnce(tool);
    if (/Clean at|Consistent at|failure|orphan|FAIL/.test(out) && !/Navigating frame was detached/.test(out)) return out;
  }
  return "HARNESS: tool crashed three times";
};

if (process.argv.includes("--control")) {
  const outO = run("orphans"), outC = run("consistency");
  let bad = 0;
  for (const f of FAULTS) {
    const out = f.tool === "orphans" ? outO : outC;
    if (f.want.test(out)) { bad++; console.log(`FALSE POSITIVE  ${f.n}: ${f.want} matches a CLEAN run`); }
    else console.log(`ok   ${String(f.n).padStart(2)}. pattern absent from a clean run`);
  }
  console.log(bad
    ? `\n${bad} pattern(s) match a clean run. Those faults would report CAUGHT without catching anything.`
    : "\nNo pattern matches a clean run: every CAUGHT is a real detection.");
  process.exit(bad ? 1 : 0);
}

const only = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2].split(",").map(Number)
  : null;
const cssOrig = readFileSync(CSS, "utf8");
const htmlOrig = readFileSync(HTML, "utf8");
const results = [];

for (const f of FAULTS) {
  if (only && !only.includes(f.n)) continue;
  let css = cssOrig, html = htmlOrig, ok = true;
  if (f.css) css += `\n/* PLANTED FAULT ${f.n} */\n${f.css}\n`;
  if (f.html) {
    const [from, to] = f.html;
    if (!html.includes(from)) { console.log(`  fault ${f.n}: anchor not found, cannot plant`); ok = false; }
    else html = html.replace(from, to);
  }
  if (!ok) { results.push({ ...f, caught: null, note: "could not plant" }); continue; }
  writeFileSync(CSS, css); writeFileSync(HTML, html);

  const outO = run("orphans"), outC = run("consistency");
  const out = f.tool === "orphans" ? outO : outC;
  const caught = f.want.test(out);
  const other = f.tool === "orphans" ? /failure|FAIL/.test(outC) : /FAIL/.test(outO);
  results.push({ ...f, caught, other });

  writeFileSync(CSS, cssOrig); writeFileSync(HTML, htmlOrig);
  console.log(`${caught ? "CAUGHT " : "SLIPPED"}  ${String(f.n).padStart(2)}. ${f.what}`);
  if (!caught) {
    const lines = out.split("\n").filter(l => /FAIL|failure|Clean|Consistent/.test(l)).slice(0, 4);
    console.log(`          expected ${f.want}\n          got: ${lines.join(" | ").slice(0, 200)}`);
  }
}
writeFileSync(CSS, cssOrig); writeFileSync(HTML, htmlOrig);
const caught = results.filter((r) => r.caught).length;
console.log(`\n${caught} of ${results.length} caught`);
if (caught < results.length) {
  console.log("A slip is either a real gap in the auditor or a fault that never planted. Check which before fixing.");
}
process.exitCode = caught < results.length ? 1 : 0;
const slipped = results.filter(r => r.caught === false);
if (slipped.length) console.log("SLIPPED: " + slipped.map(r => r.n).join(", "));
