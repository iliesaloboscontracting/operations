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

// Sampled from the Lobos Contracting logo's underline bar (public/logo.png),
// pinned as the 600 shade - the rest of the scale is generated around it (same
// hue, a taper on saturation/lightness) so buttons, badges and focus rings can
// use brand-50..950 the same way the rest of the app uses blue-*, red-*, etc.,
// instead of a generic Tailwind blue standing in for the brand everywhere. It's
// built in the same "normal" orientation as colors.blue etc. (50 lightest, 950
// darkest) so it can go through the same flip() as those below - a component
// using e.g. brand-950/30 as a subtle background tint gets a light tint here,
// matching how blue-950/30 etc. already behave in this light theme.
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
const BRAND_HUE = 197;
const brandBase: Record<number, string> = {
  50: hslToHex(BRAND_HUE, 70, 97),
  100: hslToHex(BRAND_HUE, 75, 93),
  200: hslToHex(BRAND_HUE, 80, 85),
  300: hslToHex(BRAND_HUE, 85, 74),
  400: hslToHex(BRAND_HUE, 92, 60),
  500: hslToHex(BRAND_HUE, 96, 47),
  600: "#0184B8", // the logo colour itself - TINT_SWAP leaves 600 unmoved, so this
  //                 stays the literal logo colour whichever way LIGHT is set.
  700: hslToHex(BRAND_HUE, 95, 29),
  800: hslToHex(BRAND_HUE, 90, 24),
  900: hslToHex(BRAND_HUE, 85, 20),
  950: hslToHex(BRAND_HUE, 80, 12),
};

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
      brand: { ...flip(brandBase, TINT_SWAP), DEFAULT: "#0184B8" },
    }
  : { brand: { ...brandBase, DEFAULT: "#0184B8" } };

const surface = LIGHT
  ? { canvas: "#f3f6fb", panel: "#ffffff", panel2: "#eef2f8", edge: "#d9e0ec" }
  : { canvas: "#0b0f19", panel: "#111827", panel2: "#1f2937", edge: "#2d3748" };

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
        sidebar,
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
