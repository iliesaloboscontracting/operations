"use client";

import { Download, Video } from "lucide-react";

// One stored photo or video on an office page (large uploads, 10 Nov 2026) - Day Review, the daily site report (and its
// directors' copy), the job page's reports and /faults. `src` is the page's own guarded photo route: for a bucket
// upload it redirects to a 5-minute signed read. A video plays in place (preload: just its first frame) with a Download
// link - an iPhone video (HEVC) may not play in Chrome on Windows, so Download always works. Printed, a video is a
// plain box: "Video - see online" (the daily site report's print styles show .media-print-note and hide .media-video).
export default function MediaTile({ src, video, alt, className = "", imgClassName, title }: {
  src: string; video?: boolean; alt: string; className?: string; imgClassName?: string; title?: string;
}) {
  if (!video) return (
    <a href={src} target="_blank" rel="noreferrer" className={`block ${className}`} title={title}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={imgClassName} />
    </a>
  );
  const dl = `${src}${src.includes("?") ? "&" : "?"}download=1`;
  return (
    <div className={`min-w-0 ${className}`} title={title}>
      <div className="media-video">
        <video src={src} controls preload="metadata" playsInline className={`${imgClassName ?? ""} bg-black`} aria-label={alt} />
        <a href={dl} className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-brand-400 underline"><Download size={12} /> Download</a>
      </div>
      <div className="media-print-note hidden items-center gap-1.5 rounded border border-gray-400 px-2 py-3 text-xs">
        <Video size={14} /> Video – see online
      </div>
    </div>
  );
}
