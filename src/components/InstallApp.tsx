"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

// "Install the app" prompt (22 Oct 2026) for the phone apps - Lobos Ops
// (office) and Lobos Site (each supervisor's link). Android/Chrome: an
// Install button. iPhone: Apple has no install button, so a short "Share ->
// Add to Home Screen" note. Hidden once it's running as the installed app,
// on a computer, or after "Not now" (remembered on this phone).

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// Chrome can fire this before the component is on screen - catch it early.
let early: InstallEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    early = e as InstallEvent;
  });
}

const DISMISS_KEY = "lobos-install-dismissed";

export default function InstallApp({ appName }: { appName: string }) {
  const [android, setAndroid] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {}
    // Phones and tablets only - a laptop doesn't need the app.
    if (installed || dismissed || !window.matchMedia("(pointer: coarse)").matches) return;
    const ua = navigator.userAgent;
    const iPhone = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (iPhone) {
      setIos(true);
      setHidden(false);
    }
    if (early) {
      setAndroid(early);
      setHidden(false);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setAndroid(e as InstallEvent);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const notNow = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  if (hidden || (!android && !ios)) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-500/40 bg-brand-600/15 p-3 text-sm text-gray-200">
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-gray-100">Install {appName} on this phone</div>
        {android ? (
          <>
            <div className="mb-2 text-gray-400">Opens like an app from your home screen - no browser, no link to find.</div>
            <button
              onClick={async () => {
                await android.prompt();
                const { outcome } = await android.userChoice;
                if (outcome === "accepted") setHidden(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 font-semibold text-white"
            >
              <Download size={15} /> Install
            </button>
          </>
        ) : (
          <div className="text-gray-400">
            In Safari, tap <Share size={14} className="inline align-text-bottom" /> <b className="text-gray-200">Share</b>, then <b className="text-gray-200">Add to Home Screen</b>.
          </div>
        )}
      </div>
      <button onClick={notNow} className="rounded p-1 text-gray-500" aria-label="Not now">
        <X size={16} />
      </button>
    </div>
  );
}
