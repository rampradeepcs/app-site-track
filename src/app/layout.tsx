import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PlatformProvider } from "@/lib/platform-store";
import { WorkforceProvider } from "@/lib/store";
import { PREPAINT_SCRIPT } from "@/lib/theme";

/*
 * The app asks for the system face first (SF on Apple platforms) and only
 * falls back to this. SF already ships optical sizing, per-size tracking
 * tables and legibility tuning that no substitute reproduces, so overriding
 * it needs a reason and there isn't one — this is an iOS app.
 *
 * Inter is the fallback rather than the choice: on a device with no SF it
 * is the closest grotesque, and it keeps the app from landing on whatever
 * the platform's default happens to be.
 */
const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Workfence — Workforce Attendance & Live Site Tracking",
    template: "%s · Workfence",
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
    <html lang="en" suppressHydrationWarning className={`${sans.variable} antialiased`}>
      <head>
        {/* Resolves the theme before anything paints. suppressHydrationWarning
            because this script mutates the html element that React is about
            to reconcile — which is the point, and not a mismatch to fix. */}
        <script dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
      </head>
      <body>
        <div className="wf min-h-dvh">
          <PlatformProvider>
            <WorkforceProvider>{children}</WorkforceProvider>
          </PlatformProvider>
        </div>
      </body>
    </html>
  );
}
