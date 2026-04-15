import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Geist } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "LeadFlow — Verified YouTube creator leads for video editors",
    template: "%s · LeadFlow",
  },
  description:
    "10+ verified YouTube creator leads delivered daily. Define your ICP, and LeadFlow finds monetizing creators with contact info, ready to hire an editor.",
  applicationName: "LeadFlow",
  keywords: [
    "video editor leads",
    "YouTube creator outreach",
    "freelance video editing",
    "creator CRM",
    "ICP lead generation",
  ],
  openGraph: {
    type: "website",
    title: "LeadFlow — Verified YouTube creator leads for video editors",
    description:
      "Define your ICP once. Get 10+ qualified YouTube creator leads delivered daily.",
    siteName: "LeadFlow",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${geistSans.variable} dark`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
