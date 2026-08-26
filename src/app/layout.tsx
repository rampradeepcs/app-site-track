import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { PlatformProvider } from "@/lib/platform-store";
import { WorkforceProvider } from "@/lib/store";
import { PREPAINT_SCRIPT } from "@/lib/theme";

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
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable} antialiased`}>
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
