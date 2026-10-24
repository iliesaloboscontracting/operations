/** @type {import('next').NextConfig} */
const nextConfig = {
  // No next/image anywhere; the optimiser is off as well as refused in
  // middleware (Next 14 security holes, Oct 2026).
  images: { unoptimized: true },
  experimental: {
    // src/instrumentation.ts - the once-a-minute urgent request re-alert check.
    instrumentationHook: true,
    // Sends phone alerts (lib/push.ts); loaded by Node as-is, not bundled.
    serverComponentsExternalPackages: ["web-push"],
  },
};

module.exports = nextConfig;
