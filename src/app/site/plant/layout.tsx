import type { Metadata } from "next";

// Plant pre-start pages (stage 2, opened from a machine's QR sticker on the photos address) - not a sign-in.
export const metadata: Metadata = {
  title: "Lobos pre-start",
  icons: { icon: "/site/icons/site-192.png?v=wolf", apple: "/site/icons/site-180.png?v=wolf" },
};

export default function PlantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
