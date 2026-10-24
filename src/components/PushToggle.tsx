"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

// "Phone alerts": turns notifications on or off for THIS phone/browser, and
// sends a test. Used on the Requests page (Admins, /api/push, /sw.js) and on
// supervisors' links (24 Oct 2026: their own api + /site/sw.js, which is told
// the link's address so a tapped alert opens it). Android Chrome works from
// the normal browser; an iPhone only once the app is on the Home Screen.

const toKey = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const deviceLabel = () => {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os} - ${br}`;
};

export default function PushToggle({
  api = "/api/push",
  sw = "/sw.js",
  home,
  align = "end",
}: {
  api?: string;
  sw?: string;
  home?: string; // supervisor link page - remembered by the service worker
  align?: "start" | "end";
} = {}) {
  const [supported, setSupported] = useState(true);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setSupported(false);
    const reg = await navigator.serviceWorker.register(sw);
    if (home) {
      const ready = await navigator.serviceWorker.ready;
      ready.active?.postMessage({ home });
    }
    const sub = await reg.pushManager.getSubscription();
    setOn(!!sub && Notification.permission === "granted");
  }, [sw, home]);
  useEffect(() => {
    check().catch(() => setSupported(false));
  }, [check]);

  async function turnOn() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch(api);
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't start alerts."));
      const { publicKey } = (await res.json()) as { publicKey: string | null };
      if (!publicKey) throw new Error("Phone alerts aren't set up on the server yet.");
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked - allow them for this site in the browser settings, then try again.");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
      const save = await apiFetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), label: deviceLabel() }) });
      if (!save.ok) throw new Error(await serverErrorMessage(save, "Couldn't save this phone."));
      setOn(true);
      setMsg("Alerts are on for this device.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await apiFetch(api, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setOn(false);
      setMsg("Alerts are off for this device.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    const res = await apiFetch(`${api}/test`, { method: "POST" });
    setMsg(res.ok ? "Test sent - it should arrive in a few seconds." : await serverErrorMessage(res, "Couldn't send the test."));
    setBusy(false);
  }

  if (!supported) {
    const iPhone = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
    return (
      <span className="text-xs text-gray-500">
        {iPhone ? "On iPhone: add this app to your Home Screen (Share → Add to Home Screen), open it from there, then turn alerts on." : "This browser can't show phone alerts."}
      </span>
    );
  }
  return (
    <div className={`flex flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}>
      <div className="flex gap-2">
        {on ? (
          <>
            <span className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              <Bell size={15} /> Alerts on
            </span>
            <button onClick={test} disabled={busy} className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2">Send test</button>
            <button onClick={turnOff} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-gray-400 hover:bg-panel2">
              <BellOff size={15} /> Off
            </button>
          </>
        ) : (
          <button onClick={turnOn} disabled={busy || on === null} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />} Turn on phone alerts
          </button>
        )}
      </div>
      {msg && <span className={`max-w-xs text-xs text-gray-400 ${align === "end" ? "text-right" : ""}`}>{msg}</span>}
    </div>
  );
}
