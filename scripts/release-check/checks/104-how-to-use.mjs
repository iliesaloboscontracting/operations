// "How to use" guides on the crew screens (Ilies, 24 Nov 2026: "yes build how to use, deploy once passes").
//   (1) The words: src/lib/howTo.ts is static (no fetch / API / storage / database), has no "$" and no dollar figure; the
//       driver guide has the golden rule (Sign out once, at the very end) and the truck's QR; regional travel says the
//       company truck = truck QR only and Start travel is for passengers / own car; the supervisor guide names the tiles.
//   (2) Who gets it: guideForLink gives DRIVER, SUPERVISOR and HANDOVER a guide and nothing else (POSTER, OFFICE, the
//       yard's shared link); the site link page shows the "How to use" tile only from guideForLink; the built page code
//       holds the guides; the link pages open (DRIVER, SUPERVISOR, HANDOVER, OFFICE) and the link replies (GET
//       /api/site/<link>) carry no new "howto" field and no $ - POSTER and OFFICE are given nothing new.
//   (3) The QR sign-in page renders "How signing in works" (server HTML), only off the odometer / pre-start screens
//       (source), and sign-in still works: a yard point scan -> IN -> OUT, saved and closed.
//   (4) No outbound call.
// WRITES on the test copy: two made-up people, a project + today's job, a supervisor / driver / hand-over / office link,
// a yard point, one yard sign-in (signed out); links revoked, people switched off, the project archived at the end.
import { readFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };

export default {
  id: "how-to-use", title: "How to use: static money-free guides on DRIVER / SUPERVISOR / HANDOVER links and the QR sign-in screen, nothing new for POSTER / OFFICE, sign-in unchanged",
  writes: true, timeoutMs: 180_000,
  applies: (c) => c.hasPath("src/lib/howTo.ts") || "needs lib/howTo.ts",
  async run(t, c) {
    const read = (rel) => { try { return readFileSync(path.join(c.p.appDir, rel), "utf8"); } catch { return ""; } };
    const net0 = netLines(c);

    // (1) The words (source).
    const howTo = read("src/lib/howTo.ts");
    const view = read("src/components/site/HowToGuide.tsx");
    t.ok(howTo.length > 0 && view.length > 0, "lib/howTo.ts and components/site/HowToGuide.tsx are there");
    t.ok(!howTo.includes("$") && noMoney(howTo), "no \"$\" or dollar figure anywhere in the guide text");
    for (const [name, s] of [["lib/howTo.ts", howTo], ["HowToGuide.tsx", view]]) {
      t.ok(!/\bfetch\(|\/api\/|localStorage|sessionStorage|prisma|XMLHttpRequest|navigator\.sendBeacon/.test(s), `${name} is static - no fetch, API, storage or database`);
    }
    t.ok(/Only press Sign out once, at the very end of your day/.test(howTo) && /Never sign out in between/.test(howTo), "the golden rule: one place at a time, Sign out once at the very end");
    t.ok((howTo.match(/truck's QR/g) ?? []).length >= 4, "the driver guide uses the truck's QR");
    t.ok(/Driving the company truck:[^\n]*Don't press Start travel/.test(howTo) && /Passenger, or in your own car[^\n]*Start travel[^\n]*If it asks, pick Passenger or Own car\/ute/.test(howTo),
      "regional: company truck = truck QR only, never Start travel; Start travel for passengers / own car (both before and after the travel-mode release)");
    const tiles = ["Sign in crew", "Confirm all", "Approve hours", "Talk through your day", "Make a request", "My requests", "Hire on my site", "Add receipt", "Reimbursement", "Bins", "Got it"];
    const missing = tiles.filter((x) => !howTo.includes(x));
    t.ok(missing.length === 0, "the supervisor guide names the link's real tiles", missing.join(", "));

    // (2) Who gets it (source).
    const fn = howTo.slice(howTo.indexOf("export function guideForLink"), howTo.indexOf("export function guideText"));
    const gives = [...fn.matchAll(/if \(kind === "([A-Z]+)"\) return ([A-Z_]+);/g)].map((m) => `${m[1]}=${m[2]}`).sort().join(",");
    t.ok(/if \(shared\) return null;/.test(fn) && gives === "DRIVER=DRIVER_GUIDE,HANDOVER=HANDOVER_GUIDE,SUPERVISOR=SUPERVISOR_GUIDE" && (fn.match(/return /g) ?? []).length === 5 && /return null;\s*\}/.test(fn),
      "guideForLink: only DRIVER / SUPERVISOR / HANDOVER get a guide, everything else (POSTER, OFFICE, the yard) gets none", gives);
    const page = read("src/app/site/[token]/page.tsx");
    t.ok(/const howTo = info \? guideForLink\(info\.kind, !!info\.shared\) : null;/.test(page) && /\{howTo && \(\s*<Big icon=\{<BookOpen/.test(page) && /mode === "howto" && howTo && <HowToGuideView/.test(page),
      "the site link page shows the How to use tile and screen only when guideForLink gives one");
    t.ok(!/fetch\([^)]*howto/i.test(page), "...and fetches nothing for it");

    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const people = [], links = [];
    const mk = async (name, extra = {}) => { const r = await db.resource.create({ data: { name: `${name} ${tag}`, type: "PERSONNEL", category: "Labourer", role: "General labour", status: "AVAILABLE", ...extra } }); people.push(r.id); return r; };
    const S = await mk("RC104 super", { category: "Site Manager", role: "Supervisor" }), D = await mk("RC104 driver", { category: "Truck Driver" });
    const P = await db.project.create({ data: { name: `RC104 job ${tag}`, status: "ACTIVE" } });
    const J = await db.job.create({ data: { projectId: P.id, title: P.name, date: new Date(`${c.today}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
    await db.assignment.create({ data: { jobId: J.id, resourceId: S.id, role: "Supervisor" } });
    const L = {
      sup: await makeLink(db, "SUPERVISOR", S.id),
      drv: await makeLink(db, "DRIVER", D.id),
      handover: await makeLink(db, "HANDOVER", S.id, { jobId: J.id, expiresAt: new Date(Date.now() + 36 * 3_600_000) }),
      office: await makeLink(db, "OFFICE", S.id),
      poster: await makeLink(db, "POSTER", null, { projectId: P.id }),
      yard: await makeLink(db, "POSTER", null, { place: "YARD" }),
    };
    links.push(...Object.values(L).map((l) => l.id));

    try {
      // The link pages open; the link replies carry nothing new and no $.
      let scripts = new Set();
      for (const [name, link] of [["driver", L.drv], ["supervisor", L.sup], ["hand-over", L.handover], ["office", L.office]]) {
        const r = await c.text(c.sitePage(link), null);
        t.ok(r.status === 200 && !/Application error/.test(r.text), `the ${name} link's page opens`, r.status);
        for (const m of r.text.matchAll(/<script[^>]+src="([^"]+\.js)"/g)) scripts.add(m[1]);
      }
      for (const [name, link, want] of [["driver", L.drv, 200], ["supervisor", L.sup, 200], ["hand-over", L.handover, 200], ["office", L.office, 200], ["poster", L.poster, null]]) {
        const r = await c.text(c.site(link), null);
        if (want) t.status(r.status, want, `GET /api/site/<${name} link>`);
        t.ok(!/howto|how_to|howTo/i.test(r.text), `the ${name} link's reply has no How-to field (nothing new from the server)`);
        t.ok(noMoney(r.text), `no $ in the ${name} link's reply`);
      }
      // The built page code holds the guides (the page is drawn on the phone, so they're in its JavaScript).
      let code = "";
      for (const src of scripts) { if (!src.startsWith("/_next/")) continue; const r = await c.text(src, null); if (r.status === 200) code += r.text; }
      t.ok(code.includes("How to use - drivers") && code.includes("How to use - supervisors") && code.includes("How to use - running sign-in today"),
        "the built site link page holds the driver, supervisor and hand-over guides", `${scripts.size} scripts`);

      // (3) The QR sign-in page: the link is in the server HTML; only off the odometer / pre-start screens (source).
      const signinSrc = read("src/app/site/in/[code]/page.tsx");
      t.ok(/\{!\(done && \(odometer \|\| prestart\)\) && \(\s*<div[^>]*>\s*<HowToLink guide=\{SIGNIN_GUIDE\}/.test(signinSrc), "the sign-in page hides the link on the odometer and pre-start screens");
      t.ok(/noSkip=\{prestartRequired\}/.test(signinSrc) && signinSrc.indexOf("<HowToLink") > signinSrc.lastIndexOf("<PrestartCheck"), "...the required pre-start is untouched and the link comes after it in the page");
      const sp = await c.text(`/site/in/${encodeURIComponent(L.yard.secret)}`, null);
      t.ok(sp.status === 200 && sp.text.includes("How signing in works") && !/Application error/.test(sp.text), "the QR sign-in page shows \"How signing in works\"", sp.status);
      t.ok(noMoney(sp.text), "no $ in the QR sign-in page");

      // Sign-in still works.
      const scan = await c.json(`/api/site/in/${encodeURIComponent(L.yard.secret)}`, null);
      const ticket = scan.body?.ticket, jobId = scan.body?.jobs?.[0]?.id ?? L.yard.id; // a sign-in point's "job" is the point
      if (t.ok(scan.status === 200 && !!ticket && !!jobId, "the yard QR scan answers", scan.status)) {
        const dev = `rc104-${tag}`;
        const sign = async (action) => { const r = await c.post("/api/site/in/sign", null, { ticket, jobId, action, deviceId: dev, gps: { status: "DENIED" }, resourceId: D.id }); return { status: r.status, text: await r.text().catch(() => "") }; };
        const inR = await sign("IN");
        t.ok(inR.status === 200, "signing in at the yard still works", `${inR.status} ${inR.text.slice(0, 120)}`);
        const open = await db.siteAttendance.findFirst({ where: { resourceId: D.id, place: "YARD", signOutAt: null } });
        t.ok(!!open, "...and is saved");
        const outR = await sign("OUT");
        t.ok(outR.status === 200, "signing out still works", outR.status);
        t.ok((await db.siteAttendance.count({ where: { resourceId: D.id, signOutAt: null } })) === 0, "...and closes it");
        t.ok(noMoney(inR.text + outR.text), "no $ in the sign-in replies");
      }

      // (4) Nothing called outside.
      t.ok(netLines(c) === net0, "no outbound connection attempted during this check");
    } finally {
      await db.siteAttendance.updateMany({ where: { resourceId: { in: people }, signOutAt: null }, data: { signOutAt: new Date(), signOutMethod: "OFFICE" } });
      await db.siteLink.updateMany({ where: { id: { in: links } }, data: { revokedAt: new Date() } });
      await db.resource.updateMany({ where: { id: { in: people } }, data: { active: false } });
      await db.project.update({ where: { id: P.id }, data: { status: "COMPLETED", archived: true } }).catch(() => {});
    }
  },
};
