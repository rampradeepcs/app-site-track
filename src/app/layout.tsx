import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { PlatformProvider } from "@/lib/platform-store";
import { WorkforceProvider } from "@/lib/store";
import { PREPAINT_SCRIPT } from "@/lib/theme";
import { DemoBar } from "@/components/demo/DemoBar";
import { NativeChrome } from "@/components/NativeChrome";
import { ToastHost } from "@/components/ToastHost";
import { TileCache } from "@/components/TileCache";

/*
 * The face is the identity, so the webfont leads the stack (workforce.css
 * puts var(--font-sans) first). Plus Jakarta Sans is the choice: a tight
 * geometric grotesque in the spirit of Uber Move — heavy at the top of the
 * scale, plain at body size — and it renders the same on every platform,
 * which is the point of a monochrome system: the type IS the brand.
 */
const sans = Plus_Jakarta_Sans({
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
  themeColor: "#000000",
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
            <WorkforceProvider>
              {children}
              <NativeChrome />
              <TileCache />
              <ToastHost />
              <DemoBar />
            </WorkforceProvider>
          </PlatformProvider>
        </div>
      </body>
    </html>
  );
}
