"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

// A finger signature on the phone (variation dockets, 25 Nov 2026). White "paper", black ink, so it prints like the
// paper docket. touch-action: none so signing never scrolls the page. Each finished stroke hands back a PNG data URL
// (Clear -> null). A dot or a tiny scribble doesn't count as signed.
const HEIGHT = 170;

export default function SignaturePad({ label, onChange, disabled = false }: { label: string; onChange: (png: string | null) => void; disabled?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const ink = useRef(0); // how far the pen has travelled, in CSS px
  const [signed, setSigned] = useState(false);

  const setup = useCallback(() => {
    const c = canvas.current, w = wrap.current;
    if (!c || !w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(200, Math.floor(w.clientWidth));
    c.width = Math.floor(width * dpr);
    c.height = Math.floor(HEIGHT * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${HEIGHT}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, HEIGHT);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ink.current = 0;
    setSigned(false);
  }, []);
  useEffect(() => { setup(); }, [setup]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    e.preventDefault();
    const ctx = canvas.current?.getContext("2d");
    const p = point(e);
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ink.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const ok = ink.current >= 40;
    setSigned(ok);
    onChange(ok && canvas.current ? canvas.current.toDataURL("image/png") : null);
  };
  const clear = () => { setup(); onChange(null); };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm text-gray-300">{label}</span>
        <button type="button" onClick={clear} className="flex items-center gap-1 rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 active:bg-panel2"><Eraser size={16} /> Clear</button>
      </div>
      <div ref={wrap} className={`overflow-hidden rounded-xl border-2 ${signed ? "border-emerald-500/70" : "border-edge"}`}>
        <canvas
          ref={canvas}
          aria-label={label}
          className="block bg-white"
          style={{ touchAction: "none" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
        />
      </div>
      <p className={`mt-1 text-xs ${signed ? "text-emerald-300" : "text-gray-500"}`}>{signed ? "Signed ✓" : "Sign in the white box with a finger."}</p>
    </div>
  );
}
