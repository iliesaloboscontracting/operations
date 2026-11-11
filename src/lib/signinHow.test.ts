import { test } from "node:test";
import assert from "node:assert/strict";
import { locationKind, locationLabel, signInHow, signOutHow } from "./signinHow";

test("how they signed in - every way in", () => {
  assert.equal(signInHow("SUPERVISOR_QR"), "Supervisor's QR");
  assert.equal(signInHow("SUPERVISOR_QR", { handover: true }), "Hand-over QR");
  assert.equal(signInHow("POSTER"), "Site poster");
  assert.equal(signInHow("POINT", { place: "VEHICLE" }), "Truck QR");
  assert.equal(signInHow("POINT", { place: "OFFICE" }), "Office QR");
  assert.equal(signInHow("POINT", { place: "YARD" }), "Yard QR");
  assert.equal(signInHow("MANUAL"), "Supervisor tick");
  assert.equal(signInHow("MANUAL", { handover: true }), "Hand-over tick");
  assert.equal(signInHow("OFFICE"), "Office - missed sign-in");
});

test("how they signed out - only when it differs", () => {
  assert.equal(signOutHow("POSTER", "POSTER"), null);
  assert.equal(signOutHow("POSTER", null), null);
  assert.equal(signOutHow("POSTER", "MANUAL"), "out: supervisor");
  assert.equal(signOutHow("SUPERVISOR_QR", "MANUAL", { handover: true }), "out: hand-over");
  assert.equal(signOutHow("SUPERVISOR_QR", "OFFICE"), "out: office");
  assert.equal(signOutHow("SUPERVISOR_QR", "MOVED"), "out: moved site");
  assert.equal(signOutHow("MANUAL", "SUPERVISOR_QR"), "out: supervisor's QR");
  assert.equal(signOutHow("SUPERVISOR_QR", "POSTER"), "out: site poster");
  assert.equal(signOutHow("OFFICE", "POINT", { place: "VEHICLE" }), "out: Truck QR");
});

test("location status - words for every state, never the position", () => {
  assert.equal(locationLabel("OK"), "Location shared");
  assert.equal(locationLabel("DENIED"), "Location refused");
  assert.equal(locationLabel("UNAVAILABLE"), "Location unavailable");
  // PS-057: slow GPS reads differently from refused (and from unavailable).
  assert.equal(locationLabel("TIMEOUT"), "Location timed out");
  assert.notEqual(locationLabel("TIMEOUT"), locationLabel("DENIED"));
  assert.equal(locationLabel(null), "Location not asked");
  assert.equal(locationLabel(undefined), "Location not asked");
  assert.equal(locationKind("something else"), "NOT_ASKED");
});
