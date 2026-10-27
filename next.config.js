/** @type {import('next').NextConfig} */
const nextConfig = {
  // No next/image anywhere; the optimiser is off as well as refused in
  // middleware (Next 14 security holes, Oct 2026 - kept on Next 15).
  images: { unoptimized: true },
  // Sends phone alerts (lib/push.ts); loaded by Node as-is, not bundled.
  // (Next 15: was experimental.serverComponentsExternalPackages. The
  // instrumentation hook - src/instrumentation.ts - is on by default now.)
  serverExternalPackages: ["web-push"],
  // SEC-009 (27 Oct 2026): no "X-Powered-By: Next.js".
  poweredByHeader: false,
  // SEC-009: on every response. SAMEORIGIN (not DENY) because our own pages show files in frames; the camera,
  // microphone and location stay allowed for our own pages (receipt photos, sign-in GPS on links).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
