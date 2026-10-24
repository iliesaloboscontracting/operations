import type { Metadata } from "next";

// A supervisor's link installs as its own phone app ("Lobos Site").
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Lobos Site",
    manifest: `/site/${token}/app.webmanifest`,
    icons: { icon: "/site/icons/site-192.png?v=wolf", apple: "/site/icons/site-180.png?v=wolf" },
    appleWebApp: { capable: true, title: "Lobos Site", statusBarStyle: "black" },
  };
}

export default function SiteLinkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
