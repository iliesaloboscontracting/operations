import type { Metadata } from "next";
import { CirclePlay } from "lucide-react";
import SiteBrand from "@/components/site/SiteBrand";
import { howtoVideoPath, howtoVideosFor, videoLength } from "@/lib/howtoVideos";
import manifest from "../../../../howto-videos/manifest.json";
import BackButton from "./BackButton";

// How-to videos (Ilies asked 26 Nov 2026: "build the watch videos button"): the list a supervisor / hand-over link's
// "Watch how-to videos" tile opens. No token in it or in its links (forwarding it gives nothing away), no login, no
// fetch, no money - the titles and lengths are static (lib/howtoVideos.ts + howto-videos/manifest.json).
export const metadata: Metadata = {
  title: "How-to videos",
  robots: { index: false, follow: false },
  icons: { icon: "/site/icons/site-192.png?v=wolf", apple: "/site/icons/site-180.png?v=wolf" },
};

const lengths = manifest as Record<string, { seconds?: number } | undefined>;

export default function HowtoVideosPage() {
  const videos = howtoVideosFor("supervisor");
  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-5">
      <div className="mb-5 flex items-center justify-between">
        <SiteBrand />
        <span className="text-sm text-gray-400">How-to videos</span>
      </div>
      <BackButton />
      <h1 className="mb-1 text-xl font-semibold text-gray-100">How-to videos</h1>
      <p className="mb-5 text-sm text-gray-400">Short videos with a voice-over. Turn your sound on, then press Play.</p>
      <div className="space-y-3" data-testid="howto-video-list">
        {videos.map((v) => {
          const len = videoLength(lengths[v.slug]?.seconds);
          return (
            <a key={v.slug} href={howtoVideoPath(v.slug)} data-testid={`howto-video-${v.slug}`}
              className="flex w-full items-center gap-4 rounded-2xl border border-edge bg-panel p-4 text-left active:scale-[0.99]">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-600/20 text-brand-300"><CirclePlay size={22} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-gray-100">{v.title}</span>
                <span className="block text-sm text-gray-500">{v.blurb}</span>
                {len && <span className="mt-1 block text-xs text-gray-400">{`${len} min`}</span>}
              </span>
            </a>
          );
        })}
      </div>
      <p className="mt-8 text-center text-xs text-gray-600">Each video opens full screen. Press Back at the top to come back here.</p>
    </div>
  );
}
