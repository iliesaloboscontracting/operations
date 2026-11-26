// How-to videos (Ilies asked 26 Nov 2026: "build the watch videos button") - the narrated players at /site/videos.
//   (1) Source: lib/howtoVideos.ts lists the slugs (never the LCI explainer); the route serves a file named by that list
//       only (the request's slug never reaches a path); the site link page shows "Watch how-to videos" to SUPERVISOR /
//       HANDOVER and "Watch the sign-in video" to DRIVER only; the QR sign-in page links the sign-in video in its own tab,
//       inside the same block as "How signing in works" (hidden on the odometer / pre-start screens).
//   (2) /site/videos: 200 with no login, lists each video, every link token-free (/site/videos/<slug>), no $.
//   (3) Each listed slug: 200 with no login, text/html, exactly the players' CSP, nosniff, cached with an ETag (304 on a
//       repeat), the bytes in howto-videos/, a full document, no $, no outside address but Google Fonts.
//   (4) Unknown slugs, other spellings and ../ tricks 404; POST 405; the raw folder isn't served to a stranger.
//   (5) The supervisor link page opens and its built code holds the tile; the QR sign-in page's server HTML shows the
//       link; no link secret in any video address or page.
//   (6) No outbound call.
// WRITES on the test copy: one yard sign-in point link (POSTER, place YARD) - revoked at the end.
import { readFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

// Written out here on purpose (not imported from the app), so a change to the app's CSP has to be made in both places.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts";
const stripData = (s) => s.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "DATA");
const visibleText = (html) => html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#0*36;|&#x0*24;|&dollar;/gi, "$")
  .replace(/\s+/g, " ");
const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };

export default {
  id: "howto-videos", title: "How-to videos: public token-free players at /site/videos with their own CSP, allowlisted slugs only, the tile on SUPERVISOR / HANDOVER links, the sign-in video on DRIVER links and the QR sign-in screen",
  writes: true, timeoutMs: 180_000,
  applies: (c) => c.hasPath("src/lib/howtoVideos.ts") || "needs lib/howtoVideos.ts",
  async run(t, c) {
    const read = (rel) => { try { return readFileSync(path.join(c.p.appDir, rel), "utf8"); } catch { return ""; } };
    const net0 = netLines(c);

    // (1) Source.
    const lib = read("src/lib/howtoVideos.ts");
    const slugs = [...lib.matchAll(/^\s*slug: "([a-z0-9-]+)",$/gm)].map((m) => m[1]);
    t.ok(slugs.length >= 3 && slugs.includes("sign-in") && slugs.includes("variation-docket") && slugs.includes("site-documents"), "lib/howtoVideos.ts lists sign-in, variation-docket and site-documents", slugs.join(","));
    t.ok(/slug: "site-documents",[\s\S]{0,400}?audience: \["supervisor"\],/.test(lib), "site-documents is for supervisor / hand-over links only (not drivers or the sign-in screen)");
    t.ok(!/slug: "[^"]*lci/i.test(lib), "the LCI explainer is not a crew video");
    t.ok(!/\bfetch\(|prisma|\/api\/|localStorage|from "node:fs"/.test(lib), "the catalogue is plain data - no fetch, API, database or file reading");
    const route = read("src/app/site/videos/[slug]/route.ts");
    t.ok(/const video = findHowtoVideo\(\(await params\)\.slug\);\s*if \(!video\) return notFound\(\);/.test(route)
      && /path\.join\(process\.cwd\(\), "howto-videos", file\)/.test(route) && /load\(video\.slug, video\.file\)/.test(route)
      && (route.match(/path\.join\(/g) ?? []).length === 1 && !/export async function (POST|PUT|PATCH|DELETE)/.test(route),
      "the route serves only a listed slug, from the file name the list gives (the request never reaches a path); GET only");
    const page = read("src/app/site/[token]/page.tsx");
    t.ok(/\{\(info\.kind === "SUPERVISOR" \|\| info\.kind === "HANDOVER"\) && \(\s*<Big icon=\{<CirclePlay size=\{22\} \/>\} title="Watch how-to videos"[^\n]*window\.location\.href = HOWTO_LIST_PATH;/.test(page),
      "the site link page shows \"Watch how-to videos\" to SUPERVISOR and HANDOVER links only, opening /site/videos");
    t.ok(/\{driver && \(\s*<Big icon=\{<CirclePlay size=\{22\} \/>\} title="Watch the sign-in video"[^\n]*howtoVideoPath\("sign-in"\)/.test(page)
      && (page.match(/CirclePlay size=\{22\}/g) ?? []).length === 2,
      "...and \"Watch the sign-in video\" to a DRIVER link only; nothing for OFFICE / the yard");
    const signin = read("src/app/site/in/[code]/page.tsx");
    t.ok(/\{!\(done && \(odometer \|\| prestart\)\) && \(\s*<div[^>]*>\s*<HowToLink guide=\{SIGNIN_GUIDE\} label="How signing in works" \/>[\s\S]{0,400}<a href=\{howtoVideoPath\("sign-in"\)\} target="_blank" rel="noopener"[^>]*>\s*<CirclePlay size=\{15\} \/> Watch the sign-in video\s*<\/a>\s*<\/div>/.test(signin),
      "the QR sign-in page links the sign-in video in its own tab, next to \"How signing in works\" (hidden on the odometer / pre-start screens)");

    const db = c.db;
    if (!db) return t.block("no test database handle");
    const yard = await makeLink(db, "POSTER", null, { place: "YARD" });
    const secrets = [yard.secret, c.links?.sup?.secret, c.links?.office?.secret].filter(Boolean);
    const noSecret = (s) => secrets.every((x) => !s.includes(x));
    try {
      // (2) The list.
      const list = await c.text("/site/videos", null);
      t.ok(list.status === 200 && !/Application error/.test(list.text), "/site/videos opens with no login", list.status);
      const hrefs = [...list.text.matchAll(/href="(\/site\/videos[^"]*)"/g)].map((m) => m[1]);
      for (const s of slugs) t.ok(hrefs.includes(`/site/videos/${s}`), `the list links /site/videos/${s}`, hrefs.join(","));
      t.ok(hrefs.every((h) => /^\/site\/videos\/[a-z0-9-]+$/.test(h)), "every video address on the list is /site/videos/<slug> - nothing else in it", hrefs.join(","));
      const listWords = visibleText(list.text);
      t.ok(/Signing in and out/.test(listWords) && /Variation dockets/.test(listWords) && /Site documents/.test(listWords) && (listWords.match(/\b\d:\d\d min\b/g) ?? []).length === slugs.length,
        "the list shows each title and its length", listWords.slice(0, 200));
      t.ok(noMoney(visibleText(list.text)) && noSecret(list.text), "no $ and no link secret on the list page");

      // (3) Each player.
      for (const s of slugs) {
        const url = `/site/videos/${s}`;
        const r = await c.get(url, null);
        const body = await r.text();
        t.status(r, 200, `GET ${url} (no login)`);
        t.ok((r.headers.get("content-type") ?? "").startsWith("text/html"), `${s}: text/html`, r.headers.get("content-type"));
        t.ok(r.headers.get("content-security-policy") === CSP, `${s}: exactly the players' CSP (inline script / style, Google Fonts, data: images and audio, nothing else)`, r.headers.get("content-security-policy"));
        t.ok(/\bnosniff\b/.test(r.headers.get("x-content-type-options") ?? ""), `${s}: nosniff`);
        t.ok(/^public, max-age=\d{4,}/.test(r.headers.get("cache-control") ?? "") && !!r.headers.get("etag"), `${s}: cached, with an ETag`, r.headers.get("cache-control"));
        const disk = read(`howto-videos/${s}.html`);
        t.ok(disk.length > 0 && body === disk, `${s}: the bytes in howto-videos/${s}.html`, `${body.length} vs ${disk.length}`);
        t.ok(body.startsWith('<!doctype html>\n<html lang="en-AU">\n<head>\n<meta charset="utf-8">\n<meta name="viewport"') && body.trimEnd().endsWith("</html>"), `${s}: a full document (doctype, html, head, charset, viewport)`);
        const words = stripData(body);
        t.ok(noMoney(words) && noMoney(visibleText(body)), `${s}: no $ figure`);
        const hosts = [...new Set([...words.matchAll(/https?:\/\/([^/"'\s)>]+)/g)].map((m) => m[1]))];
        t.ok(hosts.every((h) => h === "fonts.googleapis.com" || h === "fonts.gstatic.com"), `${s}: no outside address but Google Fonts`, hosts.join(","));
        t.ok(/data:audio\/mpeg;base64,/.test(body), `${s}: the narration is embedded (data:audio/mpeg)`);
        t.ok(noSecret(body), `${s}: no link secret in it`);
        const again = await c.req("GET", url, null, undefined, { "If-None-Match": r.headers.get("etag") ?? "" });
        t.status(again, 304, `${s}: a repeat with its ETag`);
      }

      // (4) Refused.
      for (const bad of ["/site/videos/nope", "/site/videos/SIGN-IN", "/site/videos/sign-in.html", "/site/videos/sign-in%20", "/site/videos/lci",
        "/site/videos/lci-explainer", "/site/videos/manifest.json", "/site/videos/manifest", "/site/videos/site-document", "/site/videos/site-documents.html", "/site/videos/__proto__",
        "/site/videos/%2E%2E%2Fpackage.json", "/site/videos/..%2F..%2F.env", "/site/videos/sign-in%2F..%2F..%2F.env", "/site/videos/..%5Cpackage.json",
        "/site/videos/sign-in/extra"]) {
        const r = await c.get(bad, null);
        const txt = await r.text();
        t.ok(r.status === 404 && !/data:audio\/mpeg/.test(txt) && !/"dependencies"|AUTH_SECRET|DATABASE_URL/.test(txt), `${bad} -> 404, nothing served`, r.status);
      }
      const post = await c.req("POST", "/site/videos/sign-in", null, {});
      t.status(post, 405, "POST /site/videos/sign-in");
      const raw = await c.get("/howto-videos/sign-in.html", null);
      const rawText = await raw.text();
      t.ok(raw.status !== 200 && !/data:audio\/mpeg/.test(rawText), "the howto-videos folder itself isn't served to a stranger", raw.status);

      // (5) The screens.
      if (c.links?.sup) {
        const sp = await c.text(c.sitePage(c.links.sup), null);
        t.ok(sp.status === 200 && !/Application error/.test(sp.text), "the supervisor link's page opens", sp.status);
        let code = "";
        for (const m of sp.text.matchAll(/<script[^>]+src="([^"]+\.js)"/g)) { if (!m[1].startsWith("/_next/")) continue; const r = await c.text(m[1], null); if (r.status === 200) code += r.text; }
        t.ok(code.includes("Watch how-to videos") && code.includes("Watch the sign-in video") && code.includes("/site/videos"), "the built site link page holds the tile and the video address");
        const api = await c.text(c.site(c.links.sup), null);
        t.ok(api.status === 200 && !/howto|\/site\/videos/i.test(api.text) && noMoney(api.text), "the link reply carries nothing new (the tile is static) and no $", api.status);
      } else t.note("no SUPERVISOR link in the snapshot - the link page part was not run");
      const qr = await c.text(`/site/in/${encodeURIComponent(yard.secret)}`, null);
      t.ok(qr.status === 200 && /How signing in works/.test(qr.text), "the QR sign-in page opens", qr.status);
      const a = qr.text.match(/<a[^>]*href="\/site\/videos\/sign-in"[^>]*>/)?.[0] ?? "";
      t.ok(/Watch the sign-in video/.test(visibleText(qr.text)) && /target="_blank"/.test(a) && /rel="noopener"/.test(a), "...and shows \"Watch the sign-in video\" (its own tab) in its server HTML", a);
      const videoHrefs = [...qr.text.matchAll(/href="([^"]*videos[^"]*)"/g)].map((m) => m[1]);
      t.ok(videoHrefs.length > 0 && videoHrefs.every((h) => h === "/site/videos/sign-in") && noSecret(videoHrefs.join(" ")), "the video address on the sign-in page is token-free", videoHrefs.join(","));
      t.ok(noMoney(visibleText(qr.text)), "no $ on the QR sign-in page");

      // (6) Nothing called outside.
      t.ok(netLines(c) === net0, "no outbound connection attempted during this check");
    } finally {
      await db.siteLink.update({ where: { id: yard.id }, data: { revokedAt: new Date() } }).catch(() => {});
    }
  },
};
