import type { Metadata } from "next";

// A supervisor's link installs as its own phone app ("Lobos Site").
export function generateMetadata({ params }: { params: { token: string } }): Metadata {
  return {
    title: "Lobos Site",
    manifest: `/site/${params.token}/app.webmanifest`,
    icons: { icon: "/site/icons/site-192.png", apple: "/site/icons/site-180.png" },
    appleWebApp: { capable: true, title: "Lobos Site", statusBarStyle: "black" },
  };
}

export default function SiteLinkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
