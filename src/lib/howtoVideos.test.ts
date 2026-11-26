// How-to videos (Ilies asked 26 Nov 2026): the slug allowlist and the players' CSP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { HOWTO_VIDEOS, findHowtoVideo, howtoVideoCsp, howtoVideoHeaders, howtoVideoPath, howtoVideosFor, videoLength, HOWTO_LIST_PATH } from "./howtoVideos";

test("only the listed slugs are found - exact match, nothing normalised", () => {
  assert.equal(findHowtoVideo("sign-in")?.file, "sign-in.html");
  assert.equal(findHowtoVideo("variation-docket")?.file, "variation-docket.html");
  for (const bad of ["", "Sign-in", "sign-in ", " sign-in", "sign-in.html", "sign-in/", "../sign-in", "..", "../../.env", "..%2F.env",
    "sign%2Din", "lci", "lci-explainer", "site-documents", "manifest", "manifest.json", "constructor", "__proto__", "toString"]) {
    assert.equal(findHowtoVideo(bad), null, `"${bad}" is not a video`);
  }
  for (const bad of [undefined, null, 1, {}, ["sign-in"]]) assert.equal(findHowtoVideo(bad), null);
});

test("slugs and file names are plain (no path pieces) and the file is <slug>.html", () => {
  const slugs = new Set<string>();
  for (const v of HOWTO_VIDEOS) {
    assert.match(v.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.equal(v.file, `${v.slug}.html`);
    assert.ok(!slugs.has(v.slug), "no duplicate slug");
    slugs.add(v.slug);
    assert.ok(!/\$\s?\d/.test(v.title + v.blurb + v.short), "no dollar figure in the list words");
  }
});

test("each listed video is in the repo, wrapped in a full document, with no money and no outside address but Google Fonts", () => {
  for (const v of HOWTO_VIDEOS) {
    const file = path.join(process.cwd(), "howto-videos", v.file);
    assert.ok(existsSync(file), `${v.file} is in howto-videos/`);
    const html = readFileSync(file, "utf8");
    assert.ok(html.startsWith('<!doctype html>\n<html lang="en-AU">\n<head>\n<meta charset="utf-8">'), `${v.file} starts with the skeleton`);
    assert.ok(html.trimEnd().endsWith("</html>"));
    assert.ok(!html.includes("\r"), "LF line endings");
    const text = html.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "DATA");
    assert.ok(!/\$\s?\d/.test(text), `no dollar figure in ${v.file}`);
    const hosts = new Set([...text.matchAll(/https?:\/\/([^/"'\s)>]+)/g)].map((m) => m[1]));
    for (const h of hosts) assert.ok(["fonts.googleapis.com", "fonts.gstatic.com"].includes(h), `${v.file} names only Google Fonts (found ${h})`);
    assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|<iframe|<form\b/i.test(text), `${v.file} sends nothing anywhere`);
  }
});

test("the LCI explainer is never a crew video", () => {
  assert.ok(!HOWTO_VIDEOS.some((v) => /lci/i.test(v.slug + v.title + v.file)));
});

test("who sees which: supervisors get the list, drivers and crew the sign-in video only", () => {
  assert.deepEqual(howtoVideosFor("supervisor").map((v) => v.slug), ["sign-in", "variation-docket"]);
  assert.deepEqual(howtoVideosFor("driver").map((v) => v.slug), ["sign-in"]);
  assert.deepEqual(howtoVideosFor("crew").map((v) => v.slug), ["sign-in"]);
});

test("addresses are token-free", () => {
  assert.equal(HOWTO_LIST_PATH, "/site/videos");
  assert.equal(howtoVideoPath("sign-in"), "/site/videos/sign-in");
});

test("the CSP allows exactly inline script / style, Google Fonts and data: images and audio", () => {
  const csp = howtoVideoCsp();
  const d = Object.fromEntries(csp.split(";").map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]));
  assert.deepEqual(d, {
    "default-src": "'none'",
    "script-src": "'unsafe-inline'",
    "style-src": "'unsafe-inline' https://fonts.googleapis.com",
    "font-src": "https://fonts.gstatic.com",
    "img-src": "data:",
    "media-src": "data:",
    "connect-src": "'none'",
    "frame-src": "'none'",
    "object-src": "'none'",
    "base-uri": "'none'",
    "form-action": "'none'",
    "frame-ancestors": "'none'",
    sandbox: "allow-scripts",
  });
  assert.ok(!/allow-same-origin/.test(csp), "HV-001: never same-origin - the player can't reach the link's storage");
  assert.ok(!/unsafe-eval|blob:|\*|'self'|http:/.test(csp), "no eval, blob:, wildcard, self or plain http");
});

test("the headers: html, the CSP, nosniff, cached with an ETag, not indexed", () => {
  const h = howtoVideoHeaders('"abc"');
  assert.equal(h["Content-Type"], "text/html; charset=utf-8");
  assert.equal(h["Content-Security-Policy"], howtoVideoCsp());
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.match(h["Cache-Control"], /^public, max-age=\d+/);
  assert.equal(h.ETag, '"abc"');
  assert.equal(h["X-Robots-Tag"], "noindex");
});

test("video length reads as m:ss", () => {
  assert.equal(videoLength(274), "4:34");
  assert.equal(videoLength(230), "3:50");
  assert.equal(videoLength(65.4), "1:05");
  assert.equal(videoLength(0), null);
  assert.equal(videoLength(undefined), null);
  assert.equal(videoLength(Number.NaN), null);
});
