/** @type {import('next').NextConfig} */
const nextConfig = {
  // No next/image anywhere; the optimiser is off as well as refused in
  // middleware (Next 14 security holes, Oct 2026 - kept on Next 15).
  images: { unoptimized: true },
  // Sends phone alerts (lib/push.ts); loaded by Node as-is, not bundled.
  // (Next 15: was experimental.serverComponentsExternalPackages. The
  // instrumentation hook - src/instrumentation.ts - is on by default now.)
  serverExternalPackages: ["web-push"],
};

module.exports = nextConfig;
