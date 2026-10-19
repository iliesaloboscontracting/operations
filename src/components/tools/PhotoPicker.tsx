"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw } from "lucide-react";
import { resizePhoto } from "@/lib/imageResize";
import { serverErrorMessage } from "@/lib/apiFetch";

// One photo slot: take (on a phone it opens the camera) or choose a photo,
// shrink it, upload it as a tool photo of `kind`, and hand back its id.
export default function PhotoPicker({
  kind,
  label,
  hint,
  photoId,
  onChange,
  uploadUrl = "/api/tools/photos",
  big,
}: {
  kind: "PLATE" | "CONDITION" | "FAULT" | "CHECK";
  label: string;
  hint?: string;
  photoId: string | null;
  onChange: (photoId: string | null) => void;
  uploadUrl?: string; // the Site photos page uploads through the supervisor's link
  big?: boolean; // taller target for phones on site
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The page cleared this slot (e.g. after sending) - drop the old preview too.
  useEffect(() => {
    if (!photoId) setPreview(null);
  }, [photoId]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await resizePhoto(file);
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, dataUrl }),
      });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't upload the photo."));
      const { id } = await res.json();
      setPreview(dataUrl);
      onChange(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  // Site uploads can't load photos back (no login) - they show the local preview only.
  const src = preview ?? (photoId && uploadUrl === "/api/tools/photos" ? `/api/tools/photos/${photoId}` : null);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-gray-400">{label}</div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className={`relative flex ${big ? "h-52" : "h-40"} w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-edge bg-panel2 text-gray-400 hover:border-brand-500 hover:text-gray-200`}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="h-full w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs">
            <Camera size={22} />
            Take or choose photo
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-slate-900/60 text-xs text-gray-200">
            <Loader2 size={16} className="mr-1 animate-spin" /> Uploading…
          </span>
        )}
        {src && !busy && (
          <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-gray-200">
            <RotateCcw size={10} /> Retake
          </span>
        )}
      </button>
      {hint && !error && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>}
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}
