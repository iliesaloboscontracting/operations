import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clockWithMinutes, distanceLabel, distanceMetres, learnSite, median, outsideWindow, POSTER_GUARD, posterGpsFlag, posterRefusal, posterWindow,
  windowMessage, type GpsRow, type SiteFix,
} from "./rules";

// Wed 11 Nov 2026 (AEDT, UTC+11) - the Rivkin House day.
const syd = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 11, m));
};
const DAY = "2026-11-11", NEXT = "2026-11-12";
const SITE = { lat: -33.8688, lng: 151.2093 };
// ~111 m per 0.001 degree of latitude.
const fix = (person: string, dLat = 0, accuracyM: number | null = 10): SiteFix => ({ lat: SITE.lat + dLat, lng: SITE.lng, accuracyM, person });

test("distance: haversine metres", () => {
  assert.equal(Math.round(distanceMetres(SITE, SITE)), 0);
  const d = distanceMetres(SITE, { lat: SITE.lat + 0.01, lng: SITE.lng });
  assert.ok(Math.abs(d - 1112) < 3, `0.01 deg of latitude ~1112 m, got ${d}`);
  // Sydney -> Melbourne ~713 km.
  const mel = distanceMetres(SITE, { lat: -37.8136, lng: 144.9631 });
  assert.ok(Math.abs(mel - 713_000) < 5_000, String(mel));
  assert.equal(distanceLabel(1800), "1.8 km");
  assert.equal(distanceLabel(1049), "1.0 km");
  assert.equal(distanceLabel(654), "650 m");
  assert.equal(distanceLabel(3), "10 m");
});

test("site location: median of good fixes, thresholds, the person checked left out", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  // Three fixes from two people -> known; one far-out fix doesn't move the median.
  const fixes = [fix("a"), fix("a", 0.0001), fix("b", -0.0001), fix("c", 0.05)];
  const site = learnSite(fixes);
  assert.ok(site && Math.abs(site.lat - SITE.lat) < 0.0002 && site.people === 3 && site.fixes === 4);
  // Too few: 2 fixes; or 3 fixes all from one person.
  assert.equal(learnSite([fix("a"), fix("b")]), null);
  assert.equal(learnSite([fix("a"), fix("a"), fix("a")]), null);
  // Poor accuracy (> 100 m) or unknown accuracy never counts.
  assert.equal(learnSite([fix("a"), fix("b", 0, 150), fix("c", 0, null)]), null);
  assert.ok(learnSite([fix("a"), fix("b", 0, POSTER_GUARD.maxFixAccuracyM), fix("c")]));
  // The person being checked never counts towards their own site.
  assert.ok(learnSite([fix("a"), fix("b"), fix("x")]));
  assert.equal(learnSite([fix("a"), fix("b"), fix("x")], "x"), null);
  assert.equal(learnSite([]), null);
});

const row = (o: Partial<GpsRow> = {}): GpsRow => ({
  signInMethod: "POSTER", status: "TO_CONFIRM", date: DAY, gpsStatus: "OK", gpsLat: SITE.lat, gpsLng: SITE.lng, gpsAccuracyM: 20, ...o,
});

test("flags: no location, far from site - poster only, never rejected or before GPS", () => {
  for (const s of ["DENIED", "UNAVAILABLE", "TIMEOUT", null]) {
    assert.deepEqual(posterGpsFlag(row({ gpsStatus: s, gpsLat: null, gpsLng: null }), SITE), { flag: "NO_LOCATION", note: "No location shared" }, String(s));
    assert.deepEqual(posterGpsFlag(row({ gpsStatus: s, gpsLat: null, gpsLng: null }), null)?.flag, "NO_LOCATION", "no location needs no known site");
  }
  // 1.8 km away.
  assert.deepEqual(posterGpsFlag(row({ gpsLat: SITE.lat + 0.0162 }), SITE), { flag: "FAR_FROM_SITE", note: "1.8 km from site" });
  // Within 500 m + accuracy: fine. 600 m with a 150 m accuracy: fine; with 20 m: far.
  assert.equal(posterGpsFlag(row({ gpsLat: SITE.lat + 0.004 }), SITE), null);
  assert.equal(posterGpsFlag(row({ gpsLat: SITE.lat + 0.0054, gpsAccuracyM: 150 }), SITE), null);
  assert.equal(posterGpsFlag(row({ gpsLat: SITE.lat + 0.0054 }), SITE)?.flag, "FAR_FROM_SITE");
  // Unknown site: no FAR flag.
  assert.equal(posterGpsFlag(row({ gpsLat: SITE.lat + 0.5 }), null), null);
  // Only site posters; never a rejected line; never before phones were asked.
  for (const m of ["SUPERVISOR_QR", "POINT", "MANUAL", "OFFICE"]) assert.equal(posterGpsFlag(row({ signInMethod: m, gpsStatus: "DENIED", gpsLat: null, gpsLng: null }), SITE), null, m);
  assert.equal(posterGpsFlag(row({ status: "REJECTED", gpsStatus: "DENIED", gpsLat: null, gpsLng: null }), SITE), null);
  assert.equal(posterGpsFlag(row({ date: "2026-10-20", gpsStatus: null, gpsLat: null, gpsLng: null }), SITE), null);
  assert.equal(posterGpsFlag(row({ status: "CONFIRMED" }), SITE), null, "on site, confirmed: nothing");
});

test("window: day shift 7am-3:30pm -> 6:00am to 5:30pm", () => {
  const w = posterWindow({ date: DAY, shift: "DAY", start: "7am", end: "3:30pm" })!;
  assert.equal(w.opens.toISOString(), syd(DAY, "06:00").toISOString());
  assert.equal(w.closes.toISOString(), syd(DAY, "17:30").toISOString());
  assert.equal(windowMessage(w), "This site's sign-in QR works from 6:00am to 5:30pm. If you're on site now, see your supervisor.");
  assert.equal(outsideWindow(w, syd(DAY, "05:59")), windowMessage(w));
  assert.equal(outsideWindow(w, syd(DAY, "06:00")), null);
  assert.equal(outsideWindow(w, syd(DAY, "08:38")), null);
  assert.equal(outsideWindow(w, syd(DAY, "17:30")), null);
  assert.equal(outsideWindow(w, syd(DAY, "20:11")), windowMessage(w), "the 8:11pm sign-in is refused");
  assert.equal(clockWithMinutes(syd(DAY, "00:05")), "12:05am");
  assert.equal(clockWithMinutes(syd(DAY, "12:00")), "12:00pm");
});

test("window: night shifts run over midnight", () => {
  const w = posterWindow({ date: DAY, shift: "NIGHT", start: "10pm", end: "6am" })!;
  assert.equal(w.opens.toISOString(), syd(DAY, "21:00").toISOString());
  assert.equal(w.closes.toISOString(), syd(NEXT, "08:00").toISOString());
  assert.match(windowMessage(w), /from 9:00pm to 8:00am the next morning\./);
  assert.equal(outsideWindow(w, syd(NEXT, "02:00")), null);
  assert.equal(outsideWindow(w, syd(NEXT, "07:59")), null);
  assert.ok(outsideWindow(w, syd(NEXT, "08:01")));
  assert.ok(outsideWindow(w, syd(DAY, "20:30")));
  // A night shift starting after midnight starts the next morning.
  const late = posterWindow({ date: DAY, shift: "NIGHT", start: "12:30am", end: "6am" })!;
  assert.equal(late.opens.toISOString(), syd(DAY, "23:30").toISOString(), "12:30am next morning less an hour");
  assert.equal(late.closes.toISOString(), syd(NEXT, "08:00").toISOString());
  // A day shift finishing after midnight.
  const over = posterWindow({ date: DAY, shift: "DAY", start: "2pm", end: "1am" })!;
  assert.equal(over.closes.toISOString(), syd(NEXT, "03:00").toISOString());
});

test("window: unclear times -> no window (allowed, as today)", () => {
  for (const [start, end] of [["TBC", "3:30pm"], ["7am", null], [null, null], ["7am", "3:30"], ["", ""]] as const)
    assert.equal(posterWindow({ date: DAY, shift: "DAY", start, end }), null, `${start}-${end}`);
  assert.equal(outsideWindow(null, syd(DAY, "23:00")), null);
});

test("only a site poster's sign-IN is ever windowed - sign-out never", () => {
  const w = posterWindow({ date: DAY, shift: "DAY", start: "7am", end: "3:30pm" });
  const late = syd(DAY, "20:11");
  assert.ok(posterRefusal({ action: "IN", method: "POSTER", window: w, now: late, windowOn: true }));
  for (const action of ["OUT", "STATUS"]) assert.equal(posterRefusal({ action, method: "POSTER", window: w, now: late, windowOn: true }), null, action);
  for (const method of ["SUPERVISOR_QR", "POINT", "MANUAL", "OFFICE"]) assert.equal(posterRefusal({ action: "IN", method, window: w, now: late, windowOn: true }), null, method);
  assert.equal(posterRefusal({ action: "IN", method: "POSTER", window: w, now: late, windowOn: false }), null, "POSTER_WINDOW=off");
  assert.equal(posterRefusal({ action: "IN", method: "POSTER", window: null, now: late, windowOn: true }), null, "no times");
  assert.equal(posterRefusal({ action: "IN", method: "POSTER", window: w, now: syd(DAY, "08:38"), windowOn: true }), null, "inside");
});
