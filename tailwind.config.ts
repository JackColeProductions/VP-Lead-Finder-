import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // LeadFlow brand palette — dark-first with warm amber accent
        background: {
          DEFAULT: "#0a0a0a", // neutral-950
          elevated: "#171717", // neutral-900
          subtle: "#262626", // neutral-800
        },
        foreground: {
          DEFAULT: "#f5f5f5", // neutral-100
          muted: "#a3a3a3", // neutral-400
          subtle: "#737373", // neutral-500
        },
        border: {
          DEFAULT: "#262626", // neutral-800
          subtle: "#171717", // neutral-900
        },
        accent: {
          DEFAULT: "#f5a623", // warm amber / gold
          hover: "#e69718",
          muted: "rgba(245, 166, 35, 0.12)",
          ring: "rgba(245, 166, 35, 0.35)",
        },
      },
      fontFamily: {
        serif: ["var(--font-instrument-serif)", "ui-serif", "Georgia", "serif"],
        sans: [
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      fontSize: {
        display: ["clamp(2.5rem, 5vw, 4rem)", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(245, 166, 35, 0.35), 0 8px 32px -8px rgba(245, 166, 35, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
