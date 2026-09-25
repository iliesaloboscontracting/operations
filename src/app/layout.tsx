import type { Metadata } from "next";
import "./globals.css";
import AppFrame from "@/components/AppFrame";

export const metadata: Metadata = {
  title: "Operate",
  description: "Command centre, projects and registers for crew, plant and hire.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
