import type { Metadata } from "next";

// Crew sign-in pages (opened from a QR on the photos address): the wolf as
// the tab / shortcut icon, served from /site/ like the rest of these pages.
export const metadata: Metadata = {
  title: "Lobos sign-in",
  icons: { icon: "/site/icons/site-192.png", apple: "/site/icons/site-180.png" },
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
