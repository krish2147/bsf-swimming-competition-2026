#!/usr/bin/env node
// Freezes the competition into a static results website (no server, no database):
// Best Swimmers (with champion photos), Results / winners by event, and all Timings.
// Output: results-site/ - deploy it to any static host (Render static site, Netlify...).
// Champion photos are saved as served; shrink them afterwards for phones (the committed
// snapshot was resized to 720px JPEGs).
//
//   node scripts/build-results-site.mjs            # reads the live site
//   SITE=https://... node scripts/build-results-site.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = (process.env.SITE || "https://bsf-swimming-competition-2026-production.up.railway.app").replace(/\/$/, "");
const pub = path.join(root, "public");
const out = path.join(root, "results-site");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "data"), { recursive: true });
fs.mkdirSync(path.join(out, "photos"), { recursive: true });

const get = async (p) => { const r = await fetch(SITE + p); if (!r.ok) throw new Error(`${p} -> ${r.status}`); return r; };

// 1. Data snapshot
const results = await (await get("/api/public/results")).json();
const timings = await (await get("/api/public/timings")).json();
const best = await (await get("/api/public/best-swimmers")).json();
let photos = 0;
for (const g of best) for (const s of g.swimmers) {
  if (!s.photo) continue;
  const ref = s.photo.split("/").pop();
  const r = await get(s.photo);
  const ext = { "image/png": "png", "image/webp": "webp" }[r.headers.get("content-type")] || "jpg";
  fs.writeFileSync(path.join(out, "photos", `${ref}.${ext}`), Buffer.from(await r.arrayBuffer()));
  s.photo = `/photos/${ref}.${ext}`;
  photos++;
}
fs.writeFileSync(path.join(out, "data", "results.json"), JSON.stringify(results));
fs.writeFileSync(path.join(out, "data", "timings.json"), JSON.stringify(timings));
fs.writeFileSync(path.join(out, "data", "best-swimmers.json"), JSON.stringify(best));

// 2. Pages and assets, rewritten to read the snapshot and to describe final (not live) results
const swap = (text, pairs) => pairs.reduce((t, [a, b]) => t.split(a).join(b), text);
const js = {
  "best-swimmers.js": [["'/api/public/best-swimmers'", "'/data/best-swimmers.json'"]],
  "live-results.js": [["'/api/public/results'", "'/data/results.json'"]],
  "live-timings.js": [["'/api/public/timings'", "'/data/timings.json'"]],
};
const common = [["Live · provisional", "Final"], ["refreshes automatically", "final results"], ["● LIVE", "FINAL"]];
for (const f of ["styles.css", "mobile-nav.css", "timing-parse.js", "heat-layout.js", "bsf-logo.jpeg", "aark-logo.png"]) {
  if (fs.existsSync(path.join(pub, f))) fs.copyFileSync(path.join(pub, f), path.join(out, f));
}
for (const [f, pairs] of Object.entries(js)) {
  const text = swap(fs.readFileSync(path.join(pub, f), "utf8"), [...pairs, ...common])
    .replace(/status\.textContent='Updated '\+[^;]*;/g, "status.textContent='Final results';");
  fs.writeFileSync(path.join(out, f), text);
}
fs.writeFileSync(path.join(out, "mobile-nav.js"), fs.readFileSync(path.join(pub, "mobile-nav.js"), "utf8").replace(
  /const PUBLIC=\[[^\n]*\];/,
  "const PUBLIC=[['/','Best Swimmers',['/best-swimmers.html']],['/results.html','Winners & Results'],['/timings.html','Timings']];"
));
const finalCopy = (html) => html
  .replace("<h1>Live results</h1>", "<h1>Winners &amp; results</h1>")
  .replace("<h1>Live timings</h1>", "<h1>All timings</h1>")
  .replace(/(id="resultsIntro"[^>]*>)[\s\S]*?<\/p>/, "$1Choose an age group, gender and event to see the winners and every swimmer's final time.</p>")
  .replace(/(id="timingsIntro"[^>]*>)[\s\S]*?<\/p>/, "$1Every swimmer's final time, heat by heat.</p>");
const dropLinks = (html) => finalCopy(html)
  .replace(/<script src="\/registration-status\.js"[^>]*><\/script>\s*/g, "")
  .replace(/<a[^>]*href="\/(events|register|find-ticket)\.html"[^>]*>[\s\S]*?<\/a>/g, "")
  .replace(/href="\/"([^>]*)>([^<]*Home)/g, 'href="/"$1>Best Swimmers');
for (const f of ["results.html", "timings.html", "best-swimmers.html"]) {
  fs.writeFileSync(path.join(out, f), swap(dropLinks(fs.readFileSync(path.join(pub, f), "utf8")), common));
}
fs.copyFileSync(path.join(out, "best-swimmers.html"), path.join(out, "index.html"));

console.log(`results-site/ built: ${results.length} events, ${timings.length} timings, ${best.length} best-swimmer groups, ${photos} champion photos`);
