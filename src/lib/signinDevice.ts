"use client";

// The crew sign-in phone's own memory (browser storage only): who they are, a device id, and since 2 Nov 2026 the
// travel pass a real sign-in gave them (lib/signin.ts makeTravelPass). Shared by /site/in/[code] and /site/in/travel.
import { useEffect, useRef } from "react";

export const ME_KEY = "lobos-signin-me";
export const DEVICE_KEY = "lobos-signin-device";
export const PASS_KEY = "lobos-travel-pass";

export function store<T>(key: string, value?: T | null): T | null {
  try {
    if (value === null) localStorage.removeItem(key);
    else if (value !== undefined) localStorage.setItem(key, JSON.stringify(value));
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function deviceId() {
  let id = store<string>(DEVICE_KEY);
  if (!id) id = store(DEVICE_KEY, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
  return id ?? "";
}

export type Gps = { status: string; lat?: number; lng?: number; accuracy?: number };

// One quiet position (Accounts stage 2 rule): asked for once `when` is true (the browser asks permission the first
// time); `take()` waits at most 1.5 s for it, then goes without. A refusal never holds anything up. Never tracked.
export function useQuietGps(when: boolean) {
  const gps = useRef<Gps | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (!when || asked.current) return;
    asked.current = true;
    if (!("geolocation" in navigator)) { gps.current = { status: "UNAVAILABLE" }; return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { gps.current = { status: "OK", lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; },
      (e) => { gps.current = { status: e.code === 1 ? "DENIED" : e.code === 3 ? "TIMEOUT" : "UNAVAILABLE" }; },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120_000 },
    );
  }, [when]);
  return async function take(): Promise<Gps> {
    for (let i = 0; i < 15 && !gps.current; i++) await new Promise((r) => setTimeout(r, 100));
    return gps.current ?? { status: "TIMEOUT" };
  };
}
