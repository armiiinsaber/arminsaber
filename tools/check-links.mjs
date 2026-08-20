#!/usr/bin/env node
// Requests every outbound href in index.html; reports status and TLS
// errors. Run before every push:  node tools/check-links.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = await readFile(path.join(root, "index.html"), "utf8");
// anchors + the stylesheet URL; preconnect/dns-prefetch hints are
// origin-only and 404 by design, so they are excluded
const hrefs = [...new Set([
  ...[...html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/<link[^>]+>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('rel="stylesheet"'))
    .map((tag) => (tag.match(/href="(https?:\/\/[^"]+)"/) || [])[1])
    .filter(Boolean),
])];

let failures = 0;
for (const url of hrefs) {
  try {
    // GET, not HEAD — some hosts reject HEAD
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
    const mark = res.ok ? "ok " : (failures++, "FAIL");
    console.log(`${mark}  ${res.status}  ${url}${res.redirected ? `  -> ${res.url}` : ""}`);
  } catch (e) {
    failures++;
    const cause = e.cause?.code || e.cause?.message || e.name;
    console.log(`FAIL  ---  ${url}  (${cause}${/CERT|SSL|TLS/i.test(String(cause) + String(e.cause)) ? " — TLS error" : ""})`);
  }
}
console.log(failures ? `\n${failures} failing link(s)` : "\nall links healthy");
process.exit(failures ? 1 : 0);
