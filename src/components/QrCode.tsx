"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";

// A QR code drawn in the browser (qrcode-generator - no network call, no
// image service). White background with a quiet zone so phone cameras pick
// it up off a dark screen.
export default function QrCode({ text, size = 260, className = "" }: { text: string; size?: number; className?: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  }, [text]);
  return (
    <div
      className={`rounded-xl bg-white p-2 ${className}`}
      style={{ width: size, height: size }}
      // The SVG is generated locally from the text above - no outside markup.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// The same QR as a standalone SVG string - for the printed site poster.
export function qrSvg(text: string) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
}
