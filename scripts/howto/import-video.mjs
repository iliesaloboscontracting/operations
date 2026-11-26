#!/usr/bin/env node
// Import (or update) a how-to video player into the app (Ilies asked 26 Nov 2026: "build the watch videos button").
//
//   node scripts/howto/import-video.mjs "<path to the player .html>" <slug>
//   e.g. node scripts/howto/import-video.mjs "../operations-agent-log/reports/Sign-in how-to video - voiced (26 Nov 2026).html" sign-in
//
// Then commit howto-videos/<slug>.html and howto-videos/manifest.json. That's all an update needs. A NEW video also
// needs its entry in src/lib/howtoVideos.ts (HOWTO_VIDEOS - title, one line, who sees it); the route serves only the
// slugs listed there, so an imported file nobody listed is never served.
//
// What it does:
//   - reads the player (written for a host that wraps it: no doctype / html / head / body tags) and refuses one that
//     already is a full document, has a dollar figure, names any outside address but Google Fonts, or would fetch /
//     send / frame / post anything (the page's CSP would block those anyway - this catches it before a commit);
//   - wraps it: <!doctype html><html lang="en-AU"><head> charset + viewport (+ noindex, an empty icon) ... </html>;
//   - adds a "Back" link to the player's top bar (history back to the page you came from; on the sign-in screen the
//     video opens in its own tab, so Back closes that tab; opened on its own it goes to the list, /site/videos);
//   - writes LF line endings, and records the length (the players' own scene timings), size and sha256 in
//     howto-videos/manifest.json for the list page.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(ROOT, "howto-videos");
const CATALOGUE = path.join(ROOT, "src", "lib", "howtoVideos.ts");
const ALLOWED_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

const die = (msg) => { console.error(`import-video: ${msg}`); process.exit(1); };

const [src, slug] = process.argv.slice(2);
if (!src || !slug) die('usage: node scripts/howto/import-video.mjs "<player .html>" <slug>');
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) die(`slug "${slug}" must be lower-case words joined by "-"`);
if (/lci/i.test(slug)) die("the LCI explainer is for the directors and the office, not the crew screens");
if (!existsSync(src)) die(`no file at ${src}`);

let html = readFileSync(src, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
const text = html.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "DATA"); // the words, without the embedded files

if (/<!doctype|<html[\s>]|<body[\s>]/i.test(text)) die("this is already a full document (doctype / html / body) - import the player as the video maker wrote it");
if (/\$\s?\d/.test(text)) die("there is a dollar figure in it - crew screens never carry money");
const hosts = [...new Set([...text.matchAll(/https?:\/\/([^/"'\s)>]+)/g)].map((m) => m[1]))];
const outside = hosts.filter((h) => !ALLOWED_HOSTS.has(h));
if (outside.length) die(`it names outside addresses other than Google Fonts: ${outside.join(", ")}`);
const sends = text.match(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|<iframe|<form\b|<embed\b|<object\b|\bimport\(/i);
if (sends) die(`it would load or send something (${sends[0]}) - the players are self-contained`);
if (/\beval\(|new Function\(/.test(text)) die("it uses eval / new Function, which the page's CSP refuses");
if (/\bsrc=["']\s*(?!data:|#)/i.test(html)) die("an image / audio source that is not embedded (data:) - embed it");

// The length the player itself shows: each scene's data-dur, stretched (as the player does) to fit a recorded voice
// that runs longer - RDUR holds the recordings' lengths, one per scene, and the player allows 0.8 s after each.
const durs = [...text.matchAll(/data-dur="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
const rdur = (text.match(/var RDUR = \[([\d.,\s]+)\]/)?.[1] ?? "").split(",").map((x) => parseFloat(x)).filter((x) => Number.isFinite(x));
const seconds = durs.reduce((s, d, i) => s + (rdur.length === durs.length ? Math.max(d, rdur[i] + 0.8) : d), 0);
if (!seconds) console.warn("import-video: no data-dur scene timings found - the list page won't show a length");

const catalogue = existsSync(CATALOGUE) ? readFileSync(CATALOGUE, "utf8") : "";
const listed = new RegExp(`slug:\\s*"${slug}"`).test(catalogue);

// The Back link: in the player's top bar when it has one, else a small fixed button top-left.
const BACK_STYLE = `<style>
.howto-back{display:inline-flex;align-items:center;gap:4px;flex:none;color:inherit;text-decoration:none;font:600 14px/1 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:7px 10px 7px 8px;border:1px solid rgba(255,255,255,.28);border-radius:8px;white-space:nowrap}
.howto-back:focus-visible{outline:2px solid #1ea7dc;outline-offset:2px}
.howto-back.float{position:fixed;top:10px;left:10px;z-index:1000;background:#090B0E;color:#f3f6fb}
</style>`;
const BACK_LINK = (cls) => `<a class="howto-back${cls}" href="/site/videos" aria-label="Back"><span aria-hidden="true">&#8249;</span> Back</a>`;
const BACK_SCRIPT = `<script>
(function(){
  var a = document.querySelector('.howto-back'); if (!a) return;
  a.addEventListener('click', function(e){
    var ours = false;
    try { ours = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch(_){}
    if (ours && history.length > 1){ e.preventDefault(); history.back(); return; }
    if (ours && history.length === 1){ e.preventDefault(); window.close(); setTimeout(function(){ location.href = a.href; }, 300); }
  });
})();
</script>`;

const TOP = /<header class="top">/;
let backPlacement;
if (TOP.test(html)) { html = html.replace(TOP, (m) => `${m}\n    ${BACK_LINK("")}`); backPlacement = "in the player's top bar"; }
else { html = `${html.replace(/\s*$/, "")}\n${BACK_LINK(" float")}`; backPlacement = "as a floating button (no top bar found)"; }

const out = [
  "<!doctype html>",
  '<html lang="en-AU">',
  "<head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta name="robots" content="noindex">',
  '<link rel="icon" href="data:,">',
  BACK_STYLE,
  html.replace(/\s*$/, ""),
  BACK_SCRIPT,
  "</html>",
  "",
].join("\n");

mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, `${slug}.html`);
writeFileSync(file, out, "utf8");

const manifestFile = path.join(OUT_DIR, "manifest.json");
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : {};
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
manifest[slug] = {
  seconds: Math.round(seconds * 10) / 10,
  bytes: Buffer.byteLength(out),
  sha256: createHash("sha256").update(out).digest("hex"),
  source: path.basename(src),
  imported: day,
};
const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
writeFileSync(manifestFile, JSON.stringify(sorted, null, 2) + "\n", "utf8");

const m = Math.floor(seconds);
console.log(`howto-videos/${slug}.html: ${(Buffer.byteLength(out) / 1e6).toFixed(1)} MB, ${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}, Back link ${backPlacement}.`);
console.log(listed
  ? `"${slug}" is listed in src/lib/howtoVideos.ts - commit howto-videos/${slug}.html and howto-videos/manifest.json.`
  : `NOTE: "${slug}" is NOT listed in src/lib/howtoVideos.ts yet - add its entry (title, one line, who sees it) or it won't be served.`);
