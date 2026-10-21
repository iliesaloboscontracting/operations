import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";
import "./globals.css";
import AppFrame from "@/components/AppFrame";

// Self-hosted at build time (no runtime request to Google), swapped in as the
// default sans font in tailwind.config.ts - a plain system-font look was the
// biggest single thing making this read as unfinished rather than professional.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Serif headline font - Tracking page only (its own redesigned look), not the
// app-wide default. Exposed as a CSS variable here (same pattern as Inter)
// so only the one page that opts in via this class actually uses it.
const lora = Lora({ subsets: ["latin"], variable: "--font-lora", display: "swap" });

export const metadata: Metadata = {
  title: "Operations",
  description: "Command centre, projects and registers for crew, plant and hire.",
  // Installs on a phone as "Lobos Ops" (22 Oct 2026). Next links the manifest
  // with crossorigin=use-credentials, so it passes Cloudflare Access.
  // Supervisors' links override all of this with "Lobos Site".
  manifest: "/ops.webmanifest",
  icons: { icon: "/icons/ops-192.png", apple: "/icons/ops-180.png" },
  appleWebApp: { capable: true, title: "Lobos Ops", statusBarStyle: "black" },
};
export const viewport: Viewport = { themeColor: "#090B0E" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable}`}>
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
