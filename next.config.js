/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // src/instrumentation.ts - the once-a-minute urgent request re-alert check.
    instrumentationHook: true,
    // Sends phone alerts (lib/push.ts); loaded by Node as-is, not bundled.
    serverComponentsExternalPackages: ["web-push"],
  },
};

module.exports = nextConfig;
