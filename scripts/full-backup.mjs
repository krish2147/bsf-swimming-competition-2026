#!/usr/bin/env node
// Downloads EVERYTHING from the live competition site into one folder, using the admin PIN.
// Needs Node 18 or newer, nothing else.
//
//   ADMIN_PIN=xxxx node full-backup.mjs
//   (optional) SITE=https://your-site.example node full-backup.mjs
//
// Saves: every registration (CSV + JSON), each swimmer's photo and payment screenshot,
// timings, results, best swimmers, relays, schools, audit log, certificates and heat list.
import fs from "fs";
import path from "path";

const SITE = (process.env.SITE || "https://bsf-swimming-competition-2026-production.up.railway.app").replace(/\/$/, "");
const PIN = process.env.ADMIN_PIN;
if (!PIN) { console.error("Run it as:  ADMIN_PIN=your-pin node full-backup.mjs"); process.exit(1); }

const stamp = new Date().toISOString().slice(0, 10);
const out = path.resolve(`talent-dream-full-backup-${stamp}`);
for (const d of ["", "swimmer-photos", "payment-screenshots", "champion-photos", "documents"]) fs.mkdirSync(path.join(out, d), { recursive: true });

let cookie = "";
async function call(p, opts = {}) {
  const res = await fetch(SITE + p, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res;
}
const json = async (p) => { const r = await call(p); if (!r.ok) throw new Error(`${p} -> ${r.status}`); return r.json(); };
const save = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));
const safe = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
const ext = (type) => ({ "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/gif": "gif" }[type] || "jpg");
const csv = (rows, cols) => "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => {
  let v = r[c]; if (v && typeof v === "object") v = JSON.stringify(v); v = String(v ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}).join(","))].join("\n");

console.log(`Logging in to ${SITE} ...`);
const login = await call("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: PIN }) });
if (!login.ok) { console.error("Login failed - check the PIN."); process.exit(1); }

// 1. Registrations (every swimmer, all details)
const regs = await json("/api/admin/payments");
save("registrations.json", regs);
save("registrations.csv", csv(regs, ["registration_id", "full_name", "school_name", "gender", "dob", "age_category", "phone", "email", "guardian_name", "events_json", "amount", "payment_utr", "payment_status", "checkin_status", "created_at"]));
console.log(`  ${regs.length} registrations`);

// 2. Photos and payment screenshots
let photos = 0, proofs = 0;
for (const r of regs) {
  const base = `${safe(r.registration_id)}_${safe(r.full_name)}`;
  for (const [kind, dir] of [["photo", "swimmer-photos"], ["proof", "payment-screenshots"]]) {
    const res = await call(`/api/media/${encodeURIComponent(r.registration_id)}/${kind}`);
    if (!res.ok) continue;
    fs.writeFileSync(path.join(out, dir, `${base}.${ext(res.headers.get("content-type"))}`), Buffer.from(await res.arrayBuffer()));
    kind === "photo" ? photos++ : proofs++;
  }
}
console.log(`  ${photos} swimmer photos, ${proofs} payment screenshots`);

// 3. Results, timings, best swimmers (+ champion photos)
const results = await json("/api/public/results"); save("results.json", results);
const timings = await json("/api/public/timings"); save("timings.json", timings);
save("timings.csv", csv(timings.map((t) => ({ ...t, category: t.meta?.category, gender: t.meta?.gender, event: t.meta?.label })), ["category", "gender", "event", "heat_no", "lane_no", "full_name", "school_name", "timing_text", "status"]));
const best = await json("/api/public/best-swimmers"); save("best-swimmers.json", best);
for (const g of best) for (const s of g.swimmers) if (s.photo) {
  const res = await call(s.photo); if (!res.ok) continue;
  fs.writeFileSync(path.join(out, "champion-photos", `${safe(g.category)}_${safe(g.gender)}_${safe(s.full_name)}.${ext(res.headers.get("content-type"))}`), Buffer.from(await res.arrayBuffer()));
}
console.log(`  ${results.length} events with results, ${timings.length} timings, ${best.length} best-swimmer groups`);

// 4. Relays, schools, audit log
try {
  const relayEvents = await json("/api/admin/relay-events");
  const relays = [];
  for (const e of relayEvents) relays.push(await json(`/api/admin/relays?eventKey=${encodeURIComponent(e.event_key)}`));
  save("relays.json", relays);
  console.log(`  ${relays.length} relay events`);
} catch (e) { console.log("  relays: skipped (" + e.message + ")"); }
for (const [p, name] of [["/api/admin/schools.csv", "schools.csv"], ["/api/admin/audit", "admin-audit.json"]]) {
  const r = await call(p); if (r.ok) save(name, Buffer.from(await r.arrayBuffer()));
}

// 5. Printable documents
for (const [p, name] of [
  ["/api/admin/merit-certificates.pdf", "merit-certificates.pdf"],
  ["/api/admin/relay-certificates.pdf", "relay-certificates.pdf"],
  ["/api/admin/heat-list.docx", "heat-list.docx"],
]) {
  const r = await call(p);
  if (r.ok) { save(path.join("documents", name), Buffer.from(await r.arrayBuffer())); console.log(`  ${name}`); }
}

console.log(`\nDone. Everything is in:\n  ${out}\nCopy this folder to Google Drive. It contains children's personal details - keep it private.`);
