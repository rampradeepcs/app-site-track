import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { WorkforceProvider } from "@/lib/store";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SiteTrack — Workforce Attendance & Live Site Tracking",
    template: "%s · SiteTrack",
  },
  description:
    "Geofenced attendance, selfie check-in, live GPS movement tracking and daily work updates for construction sites.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0f16",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} antialiased`}>
      <body>
        <div className="wf min-h-dvh">
          <WorkforceProvider>{children}</WorkforceProvider>
        </div>
      </body>
    </html>
  );
}
