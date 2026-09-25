import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

// Theme switch. The app's classes were written for a dark UI (light text on dark
// tints), so the light theme is produced by flipping the palette rather than
// touching every component: dark shades (700-950) become light tints, light
// shades (50-300) become dark text. Mid tones (400-600) - buttons, badges,
// accents - stay as they are. Set LIGHT = false to go back to the dark theme.
const LIGHT = true;

const TINT_SWAP: Record<number, number> = {
  50: 950, 100: 900, 200: 800, 300: 700, 400: 400, 500: 500,
  600: 600, 700: 300, 800: 200, 900: 100, 950: 50,
};
const GRAY_SWAP: Record<number, number> = { ...TINT_SWAP, 400: 600, 600: 400 };

function flip(scale: Record<string | number, string>, swap: Record<number, number>) {
  return Object.fromEntries(
    Object.entries(swap).map(([k, v]) => [k, scale[v]])
  );
}

const flipped: Record<string, Record<string, string>> = LIGHT
  ? {
      gray: flip(colors.gray, GRAY_SWAP),
      blue: flip(colors.blue, TINT_SWAP),
      amber: flip(colors.amber, TINT_SWAP),
      red: flip(colors.red, TINT_SWAP),
      purple: flip(colors.purple, TINT_SWAP),
      emerald: flip(colors.emerald, TINT_SWAP),
      orange: flip(colors.orange, TINT_SWAP),
      teal: flip(colors.teal, TINT_SWAP),
    }
  : {};

const surface = LIGHT
  ? { canvas: "#f3f6fb", panel: "#ffffff", panel2: "#eef2f8", edge: "#d9e0ec" }
  : { canvas: "#0b0f19", panel: "#111827", panel2: "#1f2937", edge: "#2d3748" };

// Sampled from the Lobos Contracting logo's underline bar (public/logo.png).
const brand = "#0184B8";

// The sidebar is a fixed dark navy regardless of the light/dark theme toggle above,
// so it gets its own token rather than riding the flipped `panel`/`gray` scales.
const sidebar = "#0B1B33";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ...surface,
        ...flipped,
        brand,
        sidebar,
      },
    },
  },
  plugins: [],
};
export default config;
